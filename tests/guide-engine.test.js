'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MR } = require('./helper');
const { guide, data, rules, maze } = MR;
const say = (mz, run, text, ctx) => guide.execute(mz, run, rules.parseGuide(text, ctx).actions);

test('validateActions / validateOutput reject anything outside the three action types', () => {
  assert.ok(guide.validateActions([{ type: 'forward', steps: 2 }, { type: 'turn', dir: 'left' }, { type: 'stop' }]).ok);
  assert.deepEqual(guide.validateActions([{ type: 'forward', until: 'red door' }]).actions, [{ type: 'forward', until: 'red_door' }]);
  for (const bad of [[{ type: 'jump' }], [{ type: 'turn', dir: 'up' }], [{ type: 'forward', steps: 0 }], [{ type: 'forward', steps: 2.5 }],
    [{ type: 'forward', until: 'castle' }], 'forward', [null], [{ type: 'teleport', x: 1, y: 1 }]]) {
    assert.equal(guide.validateActions(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(guide.validateOutput({ actions: [{ type: 'fly' }], clarify: null }), null);
  assert.equal(guide.validateOutput({ actions: [], clarify: null }), null);
  assert.equal(guide.validateOutput('x'), null);
  assert.deepEqual(guide.validateOutput({ actions: [], clarify: 'Left or right?' }), { actions: [], clarify: 'Left or right?' });
  assert.deepEqual(guide.validateOutput({ actions: [{ type: 'stop' }], clarify: 'x' }), { actions: [{ type: 'stop' }], clarify: null });
});

test('route 1 (standard) can be solved with landmark instructions; trail and exit are tracked', () => {
  const mz = data.guideMaze('r1', 'standard'), run = guide.newRun(mz);
  let r = say(mz, run, 'Go straight until the big tree');
  assert.equal(r.status, 'ok');
  assert.deepEqual({ x: run.x, y: run.y }, { x: 1, y: 5 });
  assert.equal(r.steps[0].type, 'move'); assert.equal(r.steps[0].path.length, 4);
  r = say(mz, run, 'Turn right, then walk to the fountain and turn left');
  assert.equal(r.status, 'ok'); assert.equal(run.facing, 'N'); assert.deepEqual({ x: run.x, y: run.y }, { x: 7, y: 5 });
  r = say(mz, run, 'go straight until the windmill. turn right.');
  assert.deepEqual({ x: run.x, y: run.y, f: run.facing }, { x: 7, y: 1, f: 'E' });
  r = say(mz, run, 'walk to the bridge');
  assert.deepEqual({ x: run.x, y: run.y }, { x: 10, y: 1 });
  r = say(mz, run, 'go straight');
  assert.equal(r.status, 'exit'); assert.equal(r.reached_exit, true); assert.equal(r.say, 'I am out! Thank you!');
  assert.equal(run.finished, true);
  assert.equal(run.trail.length, 1 + 4 + 6 + 4 + 7);
  assert.equal(guide.execute(mz, run, [{ type: 'forward' }]).status, 'invalid', 'nothing runs after the exit');
});

test('"go straight" walks to the END of the corridor (Pip does not stop at side paths)', () => {
  const mz = data.guideMaze('r1', 'standard'), run = guide.newRun(mz);
  let r = say(mz, run, 'go straight');
  assert.equal(r.status, 'ok');
  assert.deepEqual({ x: run.x, y: run.y }, { x: 1, y: 5 }, 'passes the side path at (1,7) and stops at the corner');
  r = say(mz, run, 'go straight');
  assert.equal(r.status, 'wall', 'at the end of the corridor there is a wall');
  // to stop earlier the pupil says where
  const run2 = guide.newRun(mz);
  say(mz, run2, 'go straight 2 steps');
  assert.deepEqual({ x: run2.x, y: run2.y }, { x: 1, y: 7 });
});

test('acceptance: hitting a wall does not end the game; Pip stays and the pupil can go on', () => {
  const mz = data.guideMaze('r1', 'standard'), run = guide.newRun(mz);
  let r = say(mz, run, 'turn left and go straight');
  assert.equal(r.status, 'wall'); assert.equal(r.say, 'There is a wall.'); assert.equal(r.hit_wall, true);
  assert.deepEqual({ x: run.x, y: run.y }, mz.start && { x: 1, y: 9 });
  assert.equal(r.steps[r.steps.length - 1].type, 'bump');
  assert.equal(run.finished, false);
  r = say(mz, run, 'turn right. go forward 10 steps, turn right');
  assert.equal(r.status, 'wall', 'walks as far as possible, then bumps');
  assert.deepEqual({ x: run.x, y: run.y, f: run.facing }, { x: 1, y: 5, f: 'N' }, 'the later turn is not run');
  assert.equal(r.executed, 1);
  r = say(mz, run, 'turn right and go forward 2 steps');
  assert.equal(r.status, 'ok'); assert.deepEqual({ x: run.x, y: run.y }, { x: 3, y: 5 });
  assert.equal(run.wallHits, 2);
});

test('until a landmark Pip cannot see -> clarify, Pip does not move', () => {
  const mz = data.guideMaze('r1', 'standard'), run = guide.newRun(mz);
  const r = say(mz, run, 'go straight until the fountain');
  assert.equal(r.status, 'clarify'); assert.equal(r.clarify.kind, 'landmark');
  assert.equal(r.say, 'I can’t see a blue fountain. What can I see?', 'Pip uses the landmark\'s one name (legend, hints, facts)');
  assert.deepEqual({ x: run.x, y: run.y }, { x: 1, y: 9 });
  assert.deepEqual(guide.visibleNames(mz, run), ['big tree']);
  assert.equal(say(mz, run, 'go to the way out').say, 'I can’t see a way out. What can I see?');
  const r2 = say(mz, run, 'go to the bench');
  assert.equal(r2.say, 'I can’t see a bench. What can I see?');
});

test('stop ends the instruction list', () => {
  const mz = data.guideMaze('r1', 'simple'), run = guide.newRun(mz);
  const r = say(mz, run, 'go forward 2 steps, stop, go forward 2 steps');
  assert.equal(r.status, 'ok'); assert.deepEqual({ x: run.x, y: run.y }, { x: 1, y: 7 });
  assert.equal(r.steps[r.steps.length - 1].type, 'stop');
});

test('left / right rule: asked once per route when Pip faces the viewer', () => {
  const mz = data.guideMaze('r2', 'standard'), run = guide.newRun(mz);
  assert.equal(run.facing, 'S');
  let r = say(mz, run, 'go straight until the bench and turn right and go straight');
  assert.equal(r.status, 'clarify'); assert.equal(r.clarify.kind, 'whose');
  assert.equal(r.say, 'My right or your right?');
  assert.deepEqual({ x: run.x, y: run.y, f: run.facing }, { x: 13, y: 4, f: 'S' }, 'walked, but did not turn yet');
  assert.deepEqual(r.pending, [{ type: 'turn', dir: 'right' }, { type: 'forward' }]);
  // pupil answers "your right" = Pip's right = west
  const ans = rules.parseGuide('your right', { expect: 'whose', pendingDir: r.clarify.dir });
  r = guide.execute(mz, run, guide.mergeAnswer(r.pending, ans.actions));
  assert.equal(r.status, 'ok'); assert.equal(run.facing, 'W'); assert.equal(r.note, null);
  assert.deepEqual({ x: run.x, y: run.y }, { x: 7, y: 4 });
  // facing S again later in the same route: no second question
  r = say(mz, run, 'turn left');
  assert.equal(run.facing, 'S');
  r = say(mz, run, 'go straight until the fountain, turn right');
  assert.equal(r.status, 'ok'); assert.equal(run.facing, 'W');
  r = say(mz, run, 'go to the exit');
  assert.equal(r.status, 'exit');
});

test('left / right rule: "my left" (the pupil\'s side) is mirrored when Pip faces the viewer, with a teaching note', () => {
  const mz = data.guideMaze('r2', 'simple'), run = guide.newRun(mz);
  let r = say(mz, run, 'turn left');
  assert.equal(r.status, 'clarify'); assert.equal(r.say, 'My left or your left?');
  const ans = rules.parseGuide('my left', { expect: 'whose', pendingDir: 'left' });
  r = guide.execute(mz, run, guide.mergeAnswer(r.pending, ans.actions));
  assert.equal(run.facing, maze.turn('S', 'right'), 'screen-left = Pip\'s right when he faces the viewer');
  assert.equal(r.note, 'OK! Your left is my right now.');
  // an explicit "your left" never triggers the question
  const run2 = guide.newRun(mz);
  r = say(mz, run2, 'turn your left');
  assert.equal(r.status, 'ok'); assert.equal(run2.facing, 'E'); assert.equal(run2.whoseMode, 'your');
});

test('no question when Pip faces away from the viewer', () => {
  const mz = data.guideMaze('r1', 'simple'), run = guide.newRun(mz);
  const r = say(mz, run, 'turn left');
  assert.equal(r.status, 'ok'); assert.equal(run.facing, 'W');
});

test('all eight maps (2 mazes + University Station to the library and back, 2 levels each) are solvable with a scripted solution', () => {
  const scripts = {
    r1: ['go straight until the tree', 'turn right', 'go straight until the fountain', 'turn left', 'go straight until the windmill', 'turn right', 'go to the exit'],
    r2: ['go straight until the bench', 'turn your right', 'go straight until the tree', 'turn left', 'go straight until the fountain', 'turn right', 'go to the exit'],
    r3: ['go straight', 'turn left', 'go straight until the bus stop', 'turn right', 'go straight', 'turn left', 'go straight', 'turn right', 'go straight until the library'],
    /* back to the station: Pip faces the viewer when he walks south; "my left" (the pupil's) is remembered for the last turn */
    r4: ['go straight', 'turn left', 'go straight until the bench', 'turn my left', 'go straight until the bus stop', 'turn left', 'go straight', 'turn left', 'go straight until the station']
  };
  for (const r of data.routeIds) for (const d of data.DIFFICULTIES) {
    const mz = data.guideMaze(r, d), run = guide.newRun(mz);
    let last;
    for (const line of scripts[r]) { last = say(mz, run, line); assert.notEqual(last.status, 'wall', `${mz.id}: ${line}`); assert.notEqual(last.status, 'clarify', `${mz.id}: ${line}`); }
    assert.equal(last.status, 'exit', mz.id);
  }
});

test('left / right rule: Pip remembers the answer for the rest of the route and never switches meaning', () => {
  const mz = data.guideMaze('r2', 'standard');
  for (const [answer, expectFacing] of [['my left', 'W'], ['your left', 'E']]) {
    const run = guide.newRun(mz);
    let r = say(mz, run, 'go straight');                          // Pip still faces the viewer
    r = say(mz, run, 'turn left');
    assert.equal(r.status, 'clarify');
    const ans = rules.parseGuide(answer, { expect: 'whose', pendingDir: 'left' });
    r = guide.execute(mz, run, guide.mergeAnswer(r.pending, ans.actions));
    assert.equal(run.facing, expectFacing, answer);
    assert.equal(run.whoseMode, answer.startsWith('my') ? 'my' : 'your');
    // turn back to face the viewer, then an unqualified turn: no second question, same meaning as before
    r = guide.execute(mz, run, [{ type: 'turn', dir: expectFacing === 'W' ? 'left' : 'right', whose: 'your' }]);
    assert.equal(run.facing, 'S');
    r = say(mz, run, 'turn left');
    assert.equal(r.status, 'ok', 'asked only once per route');
    assert.equal(run.facing, expectFacing, 'same meaning of "left" as the pupil chose');
    assert.equal(r.note, null, 'the teaching note is said only the first time');
  }
});

/* ------------------------------------------------------------------ turn around = ONE half turn */
test('"turn around" / "go back" is one 180-degree move in every facing and every mode; it never asks and never touches whoseMode', () => {
  const mz = data.guideMaze('r2', 'standard');
  for (const text of ['turn around', 'Turn back.', 'go back', 'turn round', 'Pip, turn right around please']) {
    assert.deepEqual(rules.parseGuide(text).actions, [{ type: 'turn', dir: 'around' }], text);
    for (const mode of [null, 'your', 'my']) for (const f of maze.FACINGS) {
      const run = guide.newRun(mz);
      run.facing = f; run.whoseMode = mode; run.whoseAsked = false;
      const r = say(mz, run, text);
      const tag = `${text} facing ${f} mode ${mode}`;
      assert.equal(r.status, 'ok', tag);
      assert.equal(r.clarify, null, tag + ': no "My left or your left?"');
      assert.equal(r.note, null, tag);
      assert.equal(run.facing, maze.OPPOSITE[f], tag + ': Pip looks the other way');
      assert.equal(run.whoseMode, mode, tag + ': whoseMode is not read or set');
      assert.equal(run.whoseAsked, false, tag);
      assert.deepEqual(r.steps, [{ type: 'turn', dir: 'around', facing: maze.OPPOSITE[f] }], tag + ': one step');
      assert.deepEqual({ x: run.x, y: run.y }, { x: mz.start.x, y: mz.start.y }, tag + ': Pip does not walk');
    }
  }
  // twice = back where he looked before
  const run = guide.newRun(mz); run.whoseMode = 'my';
  say(mz, run, 'turn around'); say(mz, run, 'turn around');
  assert.equal(run.facing, 'S');
  // in a chain: "go straight, turn around and go straight" comes back
  const run2 = guide.newRun(mz);
  const r2 = say(mz, run2, 'go forward 2 steps, turn around and go forward 2 steps');
  assert.equal(r2.status, 'ok'); assert.deepEqual({ x: run2.x, y: run2.y, f: run2.facing }, { x: mz.start.x, y: mz.start.y, f: 'N' });
});

test('validateActions: {turn, around} is allowed (model output too) and never keeps "whose"', () => {
  assert.deepEqual(guide.validateActions([{ type: 'turn', dir: 'around', whose: 'my' }]).actions, [{ type: 'turn', dir: 'around' }]);
  assert.deepEqual(guide.validateOutput({ actions: [{ type: 'turn', dir: 'around' }, { type: 'forward' }], clarify: null }).actions,
    [{ type: 'turn', dir: 'around' }, { type: 'forward' }]);
  assert.equal(guide.validateActions([{ type: 'turn', dir: 'back' }]).ok, false);
  // answering "My left or your left?" with "turn around": the question is dropped, Pip turns around
  const mz = data.guideMaze('r2', 'standard'), run = guide.newRun(mz);
  let r = say(mz, run, 'turn left');
  assert.equal(r.status, 'clarify');
  const a = rules.parseGuide('turn around', { expect: 'whose', pendingDir: 'left' }).actions;
  assert.ok(!(a[0].type === 'turn' && a[0].whose), 'not an answer: the screen does not merge it');
  r = guide.execute(mz, run, a);
  assert.equal(run.facing, 'N'); assert.equal(run.whoseMode, null);
});

test('left / right rule: "her left", "their left", "Pip\'s left" mean Pip\'s side', () => {
  const mz = data.guideMaze('r2', 'standard');
  for (const text of ['her left', 'their left', 'Pip’s left', "pip's left", 'his left', 'your left', 'hers', 'theirs']) {
    const run = guide.newRun(mz);
    let r = say(mz, run, 'turn left');
    assert.equal(r.say, 'My left or your left?');
    const ans = rules.parseGuide(text, { expect: 'whose', pendingDir: 'left' });
    assert.deepEqual(ans.actions, [{ type: 'turn', dir: 'left', whose: 'your' }], text);
    r = guide.execute(mz, run, guide.mergeAnswer(r.pending, ans.actions));
    assert.equal(run.facing, 'E', text + ': Pip\'s own left when he faces the viewer is screen right');
    assert.equal(run.whoseMode, 'your', text);
  }
  assert.deepEqual(rules.parseGuide('turn to her right').actions, [{ type: 'turn', dir: 'right', whose: 'your' }]);
  assert.deepEqual(rules.parseGuide('turn their left').actions, [{ type: 'turn', dir: 'left', whose: 'your' }]);
  assert.deepEqual(rules.parseGuide('go to Pip’s left').actions, [{ type: 'turn', dir: 'left', whose: 'your' }, { type: 'forward' }]);
});

test('left / right rule: a later "your left" / "my left" is done as said but never changes what Pip remembers', () => {
  const mz = data.guideMaze('r2', 'standard');
  const faceS = (run) => { run.facing = 'S'; };
  for (const [first, other, plainLeft] of [['my', 'your', 'W'], ['your', 'my', 'E']]) {
    const run = guide.newRun(mz);
    let r = say(mz, run, 'turn left');
    r = guide.execute(mz, run, guide.mergeAnswer(r.pending, rules.parseGuide(first + ' left', { expect: 'whose', pendingDir: 'left' }).actions));
    assert.equal(run.whoseMode, first); assert.equal(run.facing, plainLeft);
    assert.equal(r.note, first === 'my' ? 'OK! Your left is my right now.' : null);
    faceS(run);
    r = say(mz, run, 'turn ' + other + ' left');                 // explicit, the other meaning
    assert.equal(r.status, 'ok');
    assert.equal(run.facing, plainLeft === 'W' ? 'E' : 'W', 'the explicit turn is done exactly as said');
    assert.equal(run.whoseMode, first, 'Pip still remembers the first answer');
    assert.equal(r.note, null, 'no "Your left is my right now." when nothing changes');
    faceS(run);
    r = say(mz, run, 'turn left');                               // plain again
    assert.equal(r.status, 'ok', 'no new question');
    assert.equal(run.facing, plainLeft, 'plain "left" means what the pupil chose first');
  }
  // before Pip has asked, an explicit turn while he faces the viewer IS the answer
  const run = guide.newRun(mz);
  const r = say(mz, run, 'turn my left');
  assert.equal(run.whoseMode, 'my'); assert.equal(run.facing, 'W'); assert.equal(r.note, 'OK! Your left is my right now.');
  // ... but not while Pip looks to the side
  const run2 = guide.newRun(mz); run2.facing = 'E';
  say(mz, run2, 'turn your left');
  assert.equal(run2.whoseMode, null); assert.equal(run2.facing, 'N');
});

/* ------------------------------------------------------------------ replay = the live game (resume after a reload) */
/* the Guide screen's loop without the screen: parse, merge an answer, execute, log exactly what was executed */
function liveSession(M, mz, rid) {
  const s = { run: guide.newRun(mz), pending: null, pendingDir: null, ctx: {} };
  s.send = (text) => {
    const p = rules.parseGuide(text, s.ctx);
    if (!p.actions.length) {
      M.log.guideTurn({ route_id: rid, maze_id: mz.id, sent_text: text, parsed_actions: [], clarify_triggered: true, ai_reply: p.clarify });
      if (p.clarifyKind === 'dir') s.ctx = { expect: 'dir' }; else if (!s.pending) s.ctx = {};
      return null;
    }
    let actions = p.actions;
    if (s.pending) { if (actions[0].type === 'turn' && actions[0].whose) actions = guide.mergeAnswer(s.pending, actions); s.pending = null; s.pendingDir = null; }
    const res = guide.execute(mz, s.run, actions);
    M.log.guideTurn({ route_id: rid, maze_id: mz.id, sent_text: text, parsed_actions: actions, clarify_triggered: res.status === 'clarify',
      hit_wall: res.hit_wall, reached_exit: res.reached_exit, ai_reply: res.say || 'OK' });
    s.ctx = {};
    if (res.status === 'clarify' && res.clarify.kind === 'whose') { s.pending = res.pending; s.pendingDir = res.clarify.dir; s.ctx = { expect: 'whose', pendingDir: res.clarify.dir }; }
    return res;
  };
  s.restart = () => { s.run = guide.newRun(mz); s.pending = null; s.pendingDir = null; s.ctx = {}; M.log.event('guide', 'restart', { route_id: rid, maze_id: mz.id }); };
  return s;
}
function rnd(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

test('replay() gives back the live run after ANY play (position, facing, trail, whoseMode, pending question): a reload loses nothing', () => {
  const { fresh } = require('./helper');
  const LINES = ['turn left', 'turn right', 'go straight', 'go forward 2 steps', 'turn around', 'my left', 'your left', 'her right', 'turn my right',
    'turn your left', 'turn', 'left', 'banana', 'go to the bench', 'walk to the house', 'go back', 'mine', 'go straight until the well', 'RESTART'];
  let pendings = 0, modes = { my: 0, your: 0 }, checked = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const M = fresh();
    M.state.begin('5C-' + seed, seed % 2 ? 'standard' : 'simple', { seed });
    const rid = seed % 3 ? 'r2' : 'r1', mz = data.guideMaze(rid, M.state.get().difficulty);
    const s = liveSession(M, mz, rid), r = rnd(seed * 2654435761);
    const n = 1 + Math.floor(r() * 14);
    for (let i = 0; i < n && !s.run.finished; i++) {
      const line = LINES[Math.floor(r() * LINES.length)];
      if (line === 'RESTART') s.restart(); else s.send(line);
      // "reload" after every line: what replay rebuilds from the log must be the live game
      const rep = guide.replay(M.log.forStudent('5C-' + seed))[rid];
      const tag = `seed ${seed} after "${line}"`;
      assert.ok(rep, tag);
      assert.deepEqual(rep.run, JSON.parse(JSON.stringify(s.run)), tag + ': same run');
      assert.deepEqual(rep.pending, s.pending, tag + ': same pending question');
      assert.equal(rep.pendingDir, s.pendingDir, tag);
      assert.deepEqual(rep.trail, s.run.trail, tag);
      assert.equal(rep.reached, s.run.finished, tag);
      if (rep.pending) pendings++;
      if (rep.run.whoseMode) modes[rep.run.whoseMode]++;
      checked++;
    }
  }
  data.useSession(null);
  assert.ok(checked > 500 && pendings > 20 && modes.my > 20 && modes.your > 20, `enough cases: ${checked} reloads, ${pendings} pending, ${JSON.stringify(modes)}`);
});

test('replay(): the lines since the last "Start again" come back for the history list; a restart with no new line is a fresh run', () => {
  const { fresh } = require('./helper');
  const M = fresh();
  M.state.begin('5C-1', 'standard', { seed: 11 });
  const mz = data.guideMaze('r2', 'standard'), s = liveSession(M, mz, 'r2');
  s.send('go straight'); s.send('turn left'); s.send('my left'); s.send('go straight 9 steps'); s.send('fly');
  let rep = guide.replay(M.log.forStudent('5C-1')).r2;
  assert.deepEqual(rep.said.map((h) => h.kind), ['ok', 'ask', 'ok', 'wall', 'ask']);
  assert.deepEqual(rep.said.map((h) => h.text), ['go straight', 'turn left', 'my left', 'go straight 9 steps', 'fly']);
  assert.equal(rep.run.whoseMode, 'my'); assert.equal(rep.instructions, 5); assert.equal(rep.run.instructions, 4);
  s.restart();
  rep = guide.replay(M.log.forStudent('5C-1')).r2;
  assert.deepEqual(rep.said, []); assert.equal(rep.run.whoseMode, null, 'Start again forgets the answer, live and in the replay');
  assert.deepEqual(rep.trail, [{ x: mz.start.x, y: mz.start.y }]);
  assert.equal(rep.instructions, 5, 'the teacher still counts every line');
  s.send('turn left');
  rep = guide.replay(M.log.forStudent('5C-1')).r2;
  assert.ok(rep.pending && rep.pendingDir === 'left');
  data.useSession(null);
});

test('replay() still shows OLD log records (before ENGINE 2) the way the pupil saw them', () => {
  const mz = data.guideMazes.r2.standard;
  const rec = (i, actions, extra) => Object.assign({ stage: 'guide', event: 'turn', route_id: 'r2', maze_id: mz.id, sent_text: 'x', parsed_actions: actions,
    timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString() }, extra);
  // old "turn around" = two left turns; with the old remembered "my" mode Pip ended facing the viewer again (S -> W -> S)
  const old = [rec(1, [{ type: 'turn', dir: 'left', whose: 'my' }]), rec(2, [{ type: 'turn', dir: 'right', whose: 'your' }]),
    rec(3, [{ type: 'turn', dir: 'left' }, { type: 'turn', dir: 'left' }])];
  let rep = guide.replay(old).r2;
  assert.equal(rep.run.facing, 'S', 'replayed with the old rule');
  // old: an explicit "your left" replaced the remembered meaning
  const old2 = [rec(1, [{ type: 'turn', dir: 'left', whose: 'my' }]), rec(2, [{ type: 'turn', dir: 'left', whose: 'your' }]), rec(3, [{ type: 'turn', dir: 'left', whose: 'your' }])];
  rep = guide.replay(old2).r2;
  assert.equal(rep.run.whoseMode, 'your');
  // the same records written by the new engine keep the first answer
  rep = guide.replay(old2.map((e) => Object.assign({ engine: guide.ENGINE }, e))).r2;
  assert.equal(rep.run.whoseMode, 'my');
  // new records: one half turn
  rep = guide.replay([rec(1, [{ type: 'turn', dir: 'around' }], { engine: guide.ENGINE })]).r2;
  assert.equal(rep.run.facing, 'N');
  assert.equal(guide.ENGINE, 3);
  // ENGINE 3: plain "go straight" walks to the end of the corridor; records from engine 2 replay with the junction stop
  const r1 = data.guideMazes.r1.standard;
  const fwd = (engine) => guide.replay([{ stage: 'guide', event: 'turn', route_id: 'r1', maze_id: r1.id, sent_text: 'go straight',
    parsed_actions: [{ type: 'forward' }], timestamp: new Date(2026, 0, 1).toISOString(), engine }]).r1.run;
  assert.equal(fwd(2).y, 7, 'old record: stopped at the first junction');
  assert.equal(fwd(3).y, 5, 'new record: end of the corridor');
});
