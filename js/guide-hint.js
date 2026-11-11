/* Maze Rescue - Guide hints. Pure. Requires core.js, maze.js, data.js, guide-engine.js (load it right after guide-engine.js).
 *
 * Two hint levels, both computed from where Pip IS NOW (never a fixed sentence), so they are always true:
 *   level 1  MR.guide.lookHint(maze, run)          what Pip can see from here ("Pip is looking up. Pip can see the fountain.")
 *   level 2  MR.guide.nextStep(maze, run, opts)    the next good instruction on a shortest way out
 *                                                  ("Try: Go straight until the fountain." / "Try: Turn right.")
 * The level-2 sentence (`say`) is plain pupil English that MR.rules.parseGuide understands, and it is checked by
 * running it on a copy of the run with MR.guide.execute (the game itself), so it can never send Pip somewhere else.
 *
 * Left / right (see guide-engine.js): when Pip faces the viewer (S) the hint follows run.whoseMode:
 *   'my'  -> the pupil's own side:  "Turn left. (Your left is Pip's right.)"
 *   'your' or not asked yet -> Pip's side: "Turn right. (Pip's right is your left.)"
 * While Pip waits for "My left or your left?" (opts.pending), level 2 gives the answer: "Pip's right."
 */
(function (root) {
  'use strict';
  var MR = root.MR = root.MR || {};
  var maze = MR.maze;
  var guide = MR.guide = MR.guide || {};

  /** Legend / hint name for a landmark type ('tree' -> 'big tree', 'exit' -> 'way out'). There is ONE list of names,
   *  in js/data.js (MR.data.landmarkName): Pip, the legend and the hints all use it, and the parser understands it. */
  guide.label = function (type) { return MR.data.landmarkName(type); };

  var OTHER = { left: 'right', right: 'left' };
  var LOOK = { N: 'Pip is looking up.', S: 'Pip is looking down, at you.', E: 'Pip is looking to the right.', W: 'Pip is looking to the left.' };
  var LOOK_WALL = { N: 'Pip is looking up, at a wall.', S: 'Pip is looking down, at a wall.', E: 'Pip is looking to the right, at a wall.', W: 'Pip is looking to the left, at a wall.' };

  function atExit(mz, x, y) { return !!mz.exit && mz.exit.x === x && mz.exit.y === y; }
  function cloneRun(run) {
    var c = {}, k;
    for (k in run) c[k] = run[k];
    c.trail = (run.trail || []).slice();
    return c;
  }
  function listJoin(a) {
    if (a.length <= 1) return a.join('');
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }
  /** The landmark object (with x, y) behind a visibleAhead / landmarksAt entry. */
  function findLandmark(mz, id) {
    if (id === 'exit' && mz.exit) return { id: 'exit', type: 'exit', x: mz.exit.x, y: mz.exit.y };
    var lms = mz.landmarks || [];
    for (var i = 0; i < lms.length; i++) if (lms[i].id === id) return lms[i];
    return null;
  }

  /**
   * Shortest plan from a state to the exit, counted in instructions (a turn, or one straight walk of any length),
   * the same measure as MR.maze.minInstructions. BFS over (x, y, facing).
   * @param {object} mz  a Guide maze  @param {{x,y,facing}} from
   * @returns {Array<{type:'turn', dir:'left'|'right', facing:string} | {type:'forward', steps:number, to:{x,y}, facing:string}>|null}
   *   [] when already on the exit, null when there is no way out.
   */
  guide.plan = function (mz, from) {
    if (!mz.exit) return null;
    var key = function (s) { return s.x + ',' + s.y + ',' + s.f; };
    var s0 = { x: from.x, y: from.y, f: from.facing };
    var prev = {}; prev[key(s0)] = null;
    var queue = [s0];
    while (queue.length) {
      var s = queue.shift();
      if (atExit(mz, s.x, s.y)) {
        var out = [], k = key(s);
        while (prev[k]) { out.unshift(prev[k].move); k = prev[k].from; }
        return out;
      }
      var next = [];
      /* straight walks first, so that among equally short plans Pip prefers to keep going */
      var d = maze.DIRS[s.f], x = s.x + d.dx, y = s.y + d.dy, n = 1;
      while (maze.isWalkable(mz, x, y)) {
        next.push({ st: { x: x, y: y, f: s.f }, move: { type: 'forward', steps: n, to: { x: x, y: y }, facing: s.f } });
        if (atExit(mz, x, y)) break;                       /* Pip always stops on the exit */
        x += d.dx; y += d.dy; n++;
      }
      next.push({ st: { x: s.x, y: s.y, f: maze.LEFT_OF[s.f] }, move: { type: 'turn', dir: 'left', facing: maze.LEFT_OF[s.f] } });
      next.push({ st: { x: s.x, y: s.y, f: maze.RIGHT_OF[s.f] }, move: { type: 'turn', dir: 'right', facing: maze.RIGHT_OF[s.f] } });
      for (var i = 0; i < next.length; i++) {
        var nk = key(next[i].st);
        if (!(nk in prev)) { prev[nk] = { from: key(s), move: next[i].move }; queue.push(next[i].st); }
      }
    }
    return null;
  };
  /** Instructions still needed from a run's position (Infinity when there is no way). */
  guide.distanceLeft = function (mz, run) {
    var p = guide.plan(mz, run);
    return p ? p.length : Infinity;
  };

  /** Run actions on a COPY of the run (the real game rules). A "My left or your left?" question is answered with
   *  `answerWhose` ('your' | 'my') when given. @returns {{run, res}} */
  function simulate(mz, run, actions, answerWhose) {
    var c = cloneRun(run);
    var res = guide.execute(mz, c, actions);
    if (res.status === 'clarify' && res.clarify && res.clarify.kind === 'whose' && answerWhose) {
      var ans = [{ type: 'turn', dir: res.clarify.dir, whose: answerWhose }];
      res = guide.execute(mz, c, guide.mergeAnswer(res.pending, ans));
    }
    return { run: c, res: res };
  }
  function lands(sim, x, y, facing) {
    var st = sim.res.status;
    return (st === 'ok' || st === 'exit') && sim.run.x === x && sim.run.y === y && sim.run.facing === facing;
  }

  /**
   * Level 1: what Pip can see from where he stands, in short A2 sentences, using the legend names.
   * @returns {{level:1, text:string, facing:string, wall:boolean, visible:Array<{id,type,x,y,name}>, at:Array<{id,type,x,y,name}>}}
   */
  guide.lookHint = function (mz, run) {
    var parts = [];
    var at = maze.landmarksAt(mz, run.x, run.y).filter(function (l) { return l.type !== 'exit'; }).map(function (l) {
      var lm = findLandmark(mz, l.id) || l;
      return { id: lm.id, type: lm.type, x: lm.x, y: lm.y, name: guide.label(lm.type) };
    });
    if (at.length) parts.push('Pip is at the ' + at[0].name + '.');
    var wall = maze.clearAhead(mz, run, run.facing) === 0;
    var visible = [], seenType = {};
    if (wall) parts.push(LOOK_WALL[run.facing] + ' Turn first.');
    else {
      parts.push(LOOK[run.facing]);
      maze.visibleAhead(mz, run, run.facing).forEach(function (v) {
        if (seenType[v.type] || visible.length >= 3) return;
        seenType[v.type] = true;
        var lm = findLandmark(mz, v.id);
        if (lm) visible.push({ id: lm.id, type: lm.type, x: lm.x, y: lm.y, name: guide.label(lm.type) });
      });
      if (visible.length) parts.push('Pip can see ' + listJoin(visible.map(function (v) { return 'the ' + v.name; })) + '.');
      else parts.push('Pip can only see the path.');
    }
    if (run.facing === 'S') parts.push('Pip’s left is your right.');
    return { level: 1, text: parts.join(' '), facing: run.facing, wall: wall, visible: visible, at: at };
  };

  /**
   * Level 2: the next good instruction from Pip's CURRENT position and facing (first step of a shortest plan).
   * @param {object} mz   the Guide maze
   * @param {object} run  the live run (not changed)
   * @param {{pending?:Array}} [opts]  pending = the actions waiting for "My left or your left?" (guide screen keeps them)
   * @returns {{level:2, kind:'forward'|'turn'|'around'|'answer'|'done'|'none',
   *            say:string,        // what the pupil can type, e.g. "Go straight until the fountain." ('' for done / none)
   *            note:string,       // left / right help in brackets, or ''
   *            text:string,       // "Try: " + say + note   (what the hint box shows)
   *            actions:Array,     // the parsed actions of `say` (engine format)
   *            landmark:(null|{id,type,x,y,name}),   // the landmark named in `say` (for a ping on the map)
   *            to:(null|{x,y,facing}),               // where Pip will be after it
   *            left:number}}      // instructions left on the shortest plan from here
   */
  guide.nextStep = function (mz, run, opts) {
    opts = opts || {};
    var out = { level: 2, kind: 'none', say: '', note: '', text: '', actions: [], landmark: null, to: null, left: 0 };
    function done(o) { o.text = o.say ? 'Try: ' + o.say + (o.note ? ' ' + o.note : '') : o.text; return o; }
    if (run.finished || atExit(mz, run.x, run.y)) { out.kind = 'done'; out.text = 'Pip is out!'; return out; }

    /* Pip is waiting for "My left or your left?": give the answer that leaves Pip closest to the way out */
    var pending = opts.pending && opts.pending.length && opts.pending[0].type === 'turn' ? opts.pending : null;
    if (pending) {
      var best = null;
      ['left', 'right'].forEach(function (dir) {
        var actions = guide.mergeAnswer(pending, [{ type: 'turn', dir: dir, whose: 'your' }]);
        var sim = simulate(mz, run, actions, null);
        var left = sim.run.finished ? 0 : guide.distanceLeft(mz, sim.run);
        if (sim.res.status === 'wall') left += 0.5;            /* same distance: prefer no bump */
        if (!best || left < best.left) best = { dir: dir, left: left, sim: sim };
      });
      out.kind = 'answer';
      out.say = 'Pip’s ' + best.dir + '.';
      out.note = '(That is your ' + OTHER[best.dir] + '.)';
      out.actions = [{ type: 'turn', dir: best.dir, whose: 'your' }];
      out.to = { x: best.sim.run.x, y: best.sim.run.y, facing: best.sim.run.facing };
      out.left = best.left;
      return done(out);
    }

    var p = guide.plan(mz, run);
    if (!p || !p.length) { out.text = 'Press “Start again”.'; return out; }
    out.left = p.length;
    var m = p[0];

    if (m.type === 'forward') {
      out.kind = 'forward';
      out.to = { x: m.to.x, y: m.to.y, facing: m.facing };
      var cands = [], seen = {};
      maze.visibleAhead(mz, run, run.facing).forEach(function (v) {
        if (seen[v.type]) return; seen[v.type] = true;
        var lm = findLandmark(mz, v.id);
        cands.push({
          actions: [{ type: 'forward', until: v.type }],
          say: v.type === 'exit' ? 'Go straight to the way out.' : 'Go straight until the ' + guide.label(v.type) + '.',
          landmark: lm ? { id: lm.id, type: lm.type, x: lm.x, y: lm.y, name: guide.label(lm.type) } : null
        });
      });
      cands.push({ actions: [{ type: 'forward', steps: m.steps }], say: 'Go straight ' + m.steps + (m.steps === 1 ? ' step.' : ' steps.') });
      cands.push({ actions: [{ type: 'forward' }], say: 'Go straight.' });
      for (var i = 0; i < cands.length; i++) {
        if (lands(simulate(mz, run, cands[i].actions, null), m.to.x, m.to.y, m.facing)) {
          out.say = cands[i].say; out.actions = cands[i].actions; out.landmark = cands[i].landmark || null;
          return done(out);
        }
      }
      return done(out);                                       /* not reached: "N steps" always fits */
    }

    /* a turn (in Pip's own terms: m.dir) */
    var n2 = p[1];
    if (n2 && n2.type === 'turn' && n2.dir === m.dir) {            /* two turns the same way = "Turn around." (no left / right needed) */
      var around = [{ type: 'turn', dir: 'around' }];
      if (lands(simulate(mz, run, around, null), run.x, run.y, n2.facing)) {
        out.kind = 'around'; out.say = 'Turn around.'; out.actions = around;
        out.to = { x: run.x, y: run.y, facing: n2.facing }; out.left = p.length - 1;
        return done(out);
      }
    }
    out.kind = 'turn';
    out.to = { x: run.x, y: run.y, facing: m.facing };
    var dir = m.dir;
    if (run.facing === 'S') {
      if (run.whoseMode === 'my') {                          /* the pupil said "my left" = the pupil's side */
        out.say = 'Turn ' + OTHER[dir] + '.';
        out.note = '(Your ' + OTHER[dir] + ' is Pip’s ' + dir + '.)';
        out.actions = [{ type: 'turn', dir: OTHER[dir] }];
      } else {
        out.say = 'Turn ' + dir + '.';
        out.note = '(Pip’s ' + dir + ' is your ' + OTHER[dir] + '.)';
        out.actions = [{ type: 'turn', dir: dir }];
      }
    } else {
      out.say = 'Turn ' + dir + '.';
      out.actions = [{ type: 'turn', dir: dir }];
    }
    return done(out);
  };
})(typeof window !== 'undefined' ? window : globalThis);
