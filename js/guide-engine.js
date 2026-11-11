/* Maze Rescue - Guide stage executor. Pure. Requires core.js, maze.js, data.js.
 * The game (this file) decides everything: whether a move is possible, wall hits, the exit. The AI only parses.
 *
 * LEFT / RIGHT RULE (documented in docs/ARCHITECTURE.md, "Left / right rule"):
 *   - When Pip faces away from the viewer (N) the pupil's left IS Pip's left: no problem.
 *   - When Pip faces the viewer (S), "left" can mean two things (spec 4.4). The first unqualified turn in that
 *     position makes Pip ask "My left or your left?" (status 'clarify', kind 'whose'). Pip does not turn yet.
 *   - The pupil answers "your left" (= Pip's own left) or "my left" (= the pupil's left, the screen side).
 *     Pip REMEMBERS the answer for the rest of the route (run.whoseMode = 'your' | 'my') and never asks again:
 *     every later unqualified turn while facing S follows the same meaning, so Pip never silently switches.
 *   - A pupil-side turn while facing S is mirrored. The first time, Pip says "OK! Your left is my right now."
 *   - A turn that already says "your left" / "Pip's left" / "her left" / "my left" is never questioned and is done
 *     exactly as said. Said while facing S BEFORE Pip has asked, it is the answer (it sets the mode). Later it does
 *     NOT change what Pip remembers: an unqualified "left" keeps the meaning the pupil chose first.
 *   - When Pip faces E or W a turn is Pip's own turn (pupil-side left/right would mean "go backwards").
 *   - "Turn around" / "go back" is ONE half turn ({type:'turn', dir:'around'}). It has no left or right, so it never
 *     asks the question and never reads or sets run.whoseMode.
 *
 * Log records written before ENGINE 2 hold "turn around" as two left turns and let an explicit "your left" replace
 * the remembered meaning. guide.replay() runs those old records with the old rule (opts.legacy), so a teacher still
 * sees the walk the pupil saw. Before ENGINE 3 a plain "go straight" stopped at every junction; now Pip walks to
 * the end of the corridor (old records replay with opts.stopAtJunctions).
 */
(function (root) {
  'use strict';
  var MR = root.MR = root.MR || {};
  var maze = MR.maze;
  var guide = MR.guide = {};

  /** Version of the rules in execute(). Stored with every Guide turn in the log (field `engine`). */
  guide.ENGINE = 3;
  guide.MAX_ACTIONS = 12;
  guide.MAX_STEPS = 20;

  /** A fresh run for one route. The run object is the single source of truth for Pip in the Guide stage.
   *  @returns {{mazeId, x, y, facing, trail:[{x,y}], whoseAsked:boolean, whoseMode:(null|'your'|'my'), finished:boolean, instructions:number, wallHits:number}} */
  guide.newRun = function (mz) {
    return {
      mazeId: mz.id, x: mz.start.x, y: mz.start.y, facing: mz.start.facing,
      trail: [{ x: mz.start.x, y: mz.start.y }],
      whoseAsked: false, whoseMode: null, finished: false, instructions: 0, wallHits: 0
    };
  };

  /** Check and normalise an action list (from the rules OR the model).
   *  @returns {{ok:boolean, actions:Array, reason:string}}  ok:false => treat as "not understood". */
  guide.validateActions = function (actions) {
    if (!Array.isArray(actions)) return { ok: false, actions: [], reason: 'not an array' };
    if (actions.length > guide.MAX_ACTIONS) return { ok: false, actions: [], reason: 'too many actions' };
    var out = [];
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      if (!a || typeof a !== 'object') return { ok: false, actions: [], reason: 'bad action' };
      if (a.type === 'stop') { out.push({ type: 'stop' }); continue; }
      if (a.type === 'turn') {
        if (a.dir === 'around') { out.push({ type: 'turn', dir: 'around' }); continue; }   /* never has `whose` */
        if (a.dir !== 'left' && a.dir !== 'right') return { ok: false, actions: [], reason: 'bad turn dir' };
        var t = { type: 'turn', dir: a.dir };
        if (a.whose === 'your' || a.whose === 'my') t.whose = a.whose;
        out.push(t); continue;
      }
      if (a.type === 'forward') {
        var f = { type: 'forward' };
        if (a.until != null && a.until !== '') {
          var lm = MR.data.landmarkFromWords(a.until);
          if (!lm) return { ok: false, actions: [], reason: 'unknown landmark: ' + a.until };
          f.until = lm;
        } else if (a.steps != null) {
          var n = Number(a.steps);
          if (!(n >= 1 && n <= guide.MAX_STEPS) || Math.floor(n) !== n) return { ok: false, actions: [], reason: 'bad steps' };
          f.steps = n;
        }
        out.push(f); continue;
      }
      return { ok: false, actions: [], reason: 'unknown type: ' + a.type };
    }
    return { ok: true, actions: out, reason: '' };
  };

  /** Validate a whole parser output {actions, clarify}. Returns a clean {actions, clarify} or null if illegal. */
  guide.validateOutput = function (obj) {
    if (!obj || typeof obj !== 'object') return null;
    var v = guide.validateActions(obj.actions == null ? [] : obj.actions);
    if (!v.ok) return null;
    var clarify = (typeof obj.clarify === 'string' && obj.clarify.trim()) ? obj.clarify.trim() : null;
    if (!v.actions.length && !clarify) return null;
    if (v.actions.length) clarify = null;
    return { actions: v.actions, clarify: clarify };
  };

  /** Landmark type names Pip can see straight ahead (for the AI prompt and for hints), nearest first. */
  guide.visibleNames = function (mz, run) {
    return maze.visibleAhead(mz, run, run.facing).map(function (v) { return MR.data.landmarkName(v.type); });
  };

  /** After "My left or your left?": the answer's actions replace the pending turn, the rest of the plan follows. */
  guide.mergeAnswer = function (pending, answerActions) {
    return (answerActions || []).concat((pending || []).slice(1));
  };

  /**
   * Execute a validated action list. MUTATES run (x, y, facing, trail, whoseAsked, whoseMode, finished, instructions, wallHits).
   * @param {{legacy?:boolean}} [opts]  legacy:true = the rules before ENGINE 2 (only for replaying old log records)
   * @returns {{
   *   status: 'ok'|'wall'|'clarify'|'exit'|'invalid',
   *   steps: Array<{type:'move', path:[{x,y}], facing} | {type:'turn', dir:'left'|'right'|'around', facing} | {type:'bump', facing} | {type:'stop'}>,
   *   say: (string|null),            // what Pip says at the end ("There is a wall.", the clarifying question, "I am out! Thank you!")
   *   note: (string|null),           // teaching remark after a mirrored turn ("OK! Your left is my right now.")
   *   clarify: (null|{kind:'whose'|'landmark', text:string, dir?:string, landmark?:string}),
   *   pending: (null|Array),         // for kind 'whose': the actions not yet run, starting with the turn in question
   *   executed: number,              // actions fully carried out
   *   hit_wall: boolean, reached_exit: boolean
   * }}
   */
  guide.execute = function (mz, run, actions, opts) {
    var T = MR.data.text, legacy = !!(opts && opts.legacy);
    var res = { status: 'ok', steps: [], say: null, note: null, clarify: null, pending: null, executed: 0, hit_wall: false, reached_exit: false };
    var v = guide.validateActions(actions);
    if (!v.ok || !v.actions.length || run.finished) { res.status = 'invalid'; res.say = T.guideUnclear; return res; }
    actions = v.actions;
    run.instructions++;

    function atExit() { return !!mz.exit && run.x === mz.exit.x && run.y === mz.exit.y; }
    /* walk up to `max` tiles; `stopAt(x,y,n)` may end the walk early. Returns true if a wall stopped Pip. */
    function walk(max, stopAt) {
      var d = maze.DIRS[run.facing], path = [], blocked = false;
      for (var n = 0; n < max; n++) {
        var nx = run.x + d.dx, ny = run.y + d.dy;
        if (!maze.isWalkable(mz, nx, ny)) { blocked = true; break; }
        run.x = nx; run.y = ny; path.push({ x: nx, y: ny }); run.trail.push({ x: nx, y: ny });
        if (atExit()) break;
        if (stopAt && stopAt(nx, ny, n + 1)) break;
      }
      if (path.length) res.steps.push({ type: 'move', path: path, facing: run.facing });
      return blocked;
    }
    function wall() {
      res.steps.push({ type: 'bump', facing: run.facing });
      res.status = 'wall'; res.say = T.wall; res.hit_wall = true; run.wallHits++;
    }

    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      if (a.type === 'stop') { res.steps.push({ type: 'stop' }); res.executed++; break; }

      if (a.type === 'turn' && a.dir === 'around') {
        /* a half turn is the same for Pip and for the pupil: no question, and whoseMode is not touched */
        run.facing = maze.OPPOSITE[run.facing];
        res.steps.push({ type: 'turn', dir: 'around', facing: run.facing });
        res.executed++;
        continue;
      }
      if (a.type === 'turn') {
        var dir = a.dir, whose = a.whose || null;
        if (run.facing === 'S' && !whose) {
          if (!run.whoseMode) {
            run.whoseAsked = true;
            res.status = 'clarify'; res.say = T.whose(dir);
            res.clarify = { kind: 'whose', text: res.say, dir: dir };
            res.pending = actions.slice(i);
            return res;
          }
          whose = run.whoseMode;                                /* the pupil already told Pip what "left" means */
        }
        /* the answer (facing the viewer) sets the meaning ONCE; a later "your left" / "my left" is done as said
         * but does not change what Pip remembers */
        var sets = !!a.whose && run.facing === 'S' && (legacy || !run.whoseMode);
        if (whose === 'my' && run.facing === 'S') {
          dir = dir === 'left' ? 'right' : 'left';
          if (legacy ? run.whoseMode !== 'my' : sets) res.note = T.whoseNote(a.dir);   /* explain only the first time */
        }
        if (sets) { run.whoseAsked = true; run.whoseMode = a.whose; }
        run.facing = maze.turn(run.facing, dir);
        res.steps.push({ type: 'turn', dir: dir, facing: run.facing });
        res.executed++;
        continue;
      }

      /* forward */
      if (a.until) {
        var seen = maze.visibleAhead(mz, run, run.facing), target = null;
        for (var s = 0; s < seen.length; s++) {
          if (maze.landmarkMatches(seen[s], a.until)) { target = seen[s]; break; }
        }
        if (!target) {
          var here = maze.landmarksAt(mz, run.x, run.y).some(function (lm) { return maze.landmarkMatches(lm, a.until); });
          if (here) { res.executed++; continue; }                     /* already at it: nothing to walk */
          var name = MR.data.landmarkName(a.until);
          res.status = 'clarify'; res.say = T.cantSee(name);
          res.clarify = { kind: 'landmark', text: res.say, landmark: name };
          return res;
        }
        walk(target.dist);
      } else if (a.steps) {
        if (walk(a.steps)) { wall(); return res; }
      } else {
        /* "go straight" (ENGINE 3): walk on to the END of the corridor - Pip does not stop at side paths.
         * To stop earlier the pupil must say where: "... until the well", "... 2 steps", "turn left at the well".
         * (Before ENGINE 3 Pip stopped at every junction; old log records are replayed that way: opts.stopAtJunctions.) */
        if (maze.clearAhead(mz, run, run.facing) === 0) { wall(); return res; }
        walk(guide.MAX_STEPS * 2, opts && opts.stopAtJunctions ? function (x, y) { return maze.isJunction(mz, x, y); } : null);
      }
      res.executed++;
      if (atExit()) { res.status = 'exit'; res.say = T.exit; res.reached_exit = true; run.finished = true; return res; }
    }
    return res;
  };

  /**
   * Rebuild each route's walk from log records alone (works on imported logs too): every Guide turn's
   * parsed_actions are executed again on a fresh run; a 'restart' event starts a new run.
   * The Guide screen uses the same function to go on after a page reload, so the pupil, the Review screen and the
   * teacher always see the same walk.
   * @param {Array} entries  log records of ONE pupil (any order)
   * @returns {{[routeId:string]: {mazeId:string, trail:[{x,y}], reached:boolean, instructions:number, wallHits:number,
   *   run:object,                    // a copy of the live run after the last record: x, y, facing, trail, whoseMode, ...
   *   pending:(null|Array),          // the actions still waiting for "My left or your left?" (when that was Pip's last line)
   *   pendingDir:(null|'left'|'right'),
   *   said:Array<{text:string, kind:'ok'|'wall'|'ask'|'exit'|'fail'}>   // the pupil's lines since the last (re)start
   * }}}
   *   instructions = all lines the pupil sent on this route (also before a "Start again"); run.instructions = this run only.
   */
  guide.replay = function (entries) {
    var out = {}, st = {};
    function begin(rid, mz) { st[rid] = { run: guide.newRun(mz), pending: null, pendingDir: null, said: [] }; }
    function snapshot(rid, mz, count) {
      var s = st[rid], run = MR.util.clone(s.run);
      out[rid] = { mazeId: mz.id, trail: run.trail.slice(), reached: run.finished, instructions: count, wallHits: run.wallHits,
        run: run, pending: s.pending ? MR.util.clone(s.pending) : null, pendingDir: s.pendingDir, said: s.said.slice() };
    }
    (entries || []).slice().sort(function (a, b) { return a.timestamp < b.timestamp ? -1 : (a.timestamp > b.timestamp ? 1 : 0); })
      .forEach(function (e) {
        if (e.stage !== 'guide' || !e.route_id) return;
        var rid = e.route_id, mz = findMaze(e.maze_id, rid);
        if (!mz) return;
        var count = out[rid] ? out[rid].instructions : 0;
        if (e.event === 'restart' || !st[rid] || st[rid].run.mazeId !== mz.id) {
          begin(rid, mz);
          if (e.event === 'restart') snapshot(rid, mz, count);
        }
        if (e.event !== 'turn') return;
        var s = st[rid], run = s.run, res = null;
        if (e.parsed_actions && e.parsed_actions.length && !run.finished) {
          res = guide.execute(mz, run, e.parsed_actions, { legacy: !(e.engine >= 2), stopAtJunctions: !(e.engine >= 3) });
          var whose = res.status === 'clarify' && res.clarify && res.clarify.kind === 'whose';
          s.pending = whose ? res.pending : null;
          s.pendingDir = whose ? res.clarify.dir : null;
        }
        s.said.push({ text: e.sent_text || '', kind: e.ai_failed ? 'fail' : (res && res.status === 'exit' ? 'exit' :
          (res && res.status === 'wall' ? 'wall' : (!res || res.status === 'clarify' || res.status === 'invalid' ? 'ask' : 'ok'))) });
        snapshot(rid, mz, count + 1);
      });
    return out;
  };
  function findMaze(mazeId, routeId) {
    /* a game's own maze variant (mirrored / landmarks moved) is rebuilt from its id alone, e.g. 'r1_standard~m1~p30152' */
    var v = mazeId && MR.data.guideMazeById ? MR.data.guideMazeById(mazeId) : null;
    if (v && v.routeId === routeId) return v;
    var r = MR.data.guideMazes[routeId];
    if (!r) return null;
    if (mazeId) for (var k in r) if (r[k].id === mazeId) return r[k];
    return r.standard;
  }
})(typeof window !== 'undefined' ? window : globalThis);
