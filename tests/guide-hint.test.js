'use strict';
/* Guide hints (js/guide-hint.js): level 1 = what Pip can see now, level 2 = the next good instruction.
 * The key promise: a level-2 hint is always TRUE. Typing it (through the real parser) and running it with the real
 * engine moves Pip one instruction closer to the way out - from the start, and after any wrong moves. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { MR } = require('./helper');
if (!MR.guide.nextStep) require(path.join(__dirname, '..', 'js', 'guide-hint.js'));
const { guide, data, rules, maze } = MR;

const MAZES = [];
for (const rid of data.routeIds) for (const diff of ['standard', 'simple']) MAZES.push([rid + '/' + diff, data.guideMaze(rid, diff)]);

/* the guide screen's loop, without the screen: send text, keep the "My left or your left?" question pending */
function makeSession(mz) {
  const s = { run: guide.newRun(mz), pending: null, ctx: {} };
  s.send = (text) => {
    const p = rules.parseGuide(text, s.ctx);
    if (!p.actions.length) return { status: 'parse', clarify: p.clarify, clarifyKind: p.clarifyKind };
    let actions = p.actions;
    if (s.pending) { if (actions[0].type === 'turn' && actions[0].whose) actions = guide.mergeAnswer(s.pending, actions); s.pending = null; }
    const res = guide.execute(mz, s.run, actions);
    s.ctx = {};
    if (res.status === 'clarify' && res.clarify.kind === 'whose') { s.pending = res.pending; s.ctx = { expect: 'whose', pendingDir: res.clarify.dir }; }
    return res;
  };
  s.hint = () => guide.nextStep(mz, s.run, { pending: s.pending });
  return s;
}
/* follow level-2 hints only; returns the number of hints used */
function followHints(mz, s, label) {
  const before = guide.distanceLeft(mz, s.run);
  let n = 0;
  while (!s.run.finished) {
    const h = s.hint();
    assert.ok(h.say, label + ': a hint sentence at ' + JSON.stringify([s.run.x, s.run.y, s.run.facing]) + ' ' + h.text);
    assert.ok(h.text.startsWith('Try: '), label + ': ' + h.text);
    const left = s.pending ? Infinity : guide.distanceLeft(mz, s.run);
    const res = s.send(h.say);
    assert.notEqual(res.status, 'parse', label + ': the parser understands "' + h.say + '" (' + res.clarify + ')');
    assert.notEqual(res.status, 'wall', label + ': "' + h.say + '" does not hit a wall');
    assert.notEqual(res.status, 'invalid', label + ': "' + h.say + '" is valid');
    if (res.status === 'clarify') assert.equal(res.clarify.kind, 'whose', label + ': only the left/right question may come back, got ' + res.say);
    else if (left !== Infinity) assert.equal(guide.distanceLeft(mz, s.run), left - (h.kind === 'around' ? 2 : 1), label + ': "' + h.say + '" is one step closer');
    if (h.to && res.status !== 'clarify') assert.deepEqual({ x: s.run.x, y: s.run.y, facing: s.run.facing }, h.to, label + ': Pip ends where the hint said');
    if (++n > 40) assert.fail(label + ': hints do not reach the exit');
  }
  assert.ok(n <= before + 2, label + `: ${n} hints for ${before} instructions (+ at most the left/right question)`);
  return n;
}
/* tiny seeded random */
function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

test('plan() finds a shortest way out (same length as maze.minInstructions) on every Guide maze', () => {
  for (const [name, mz] of MAZES) {
    const p = guide.plan(mz, mz.start);
    assert.ok(p && p.length, name);
    assert.equal(p.length, maze.minInstructions(mz), name);
  }
});

test('following only level-2 hints from the start reaches the exit (both routes x both difficulties)', () => {
  for (const [name, mz] of MAZES) {
    const s = makeSession(mz);
    const n = followHints(mz, s, name);
    assert.ok(s.run.finished && s.run.wallHits === 0, name);
    assert.ok(n >= maze.minInstructions(mz), name);
  }
});

test('hints are still true after wrong moves, walls, "my left" answers and half-answered questions (random play)', () => {
  const WRONG = ['turn left', 'turn right', 'go straight', 'go straight 2 steps', 'go forward 1 step', 'turn around',
    'go straight 9 steps', 'my left', 'your right', 'turn my left', 'turn your right', 'walk to the tree', 'go to the bench'];
  let trials = 0;
  for (const [name, mz] of MAZES) {
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed * 7919 + name.length), s = makeSession(mz);
      const k = 1 + Math.floor(r() * 8);
      for (let i = 0; i < k && !s.run.finished; i++) s.send(WRONG[Math.floor(r() * WRONG.length)]);
      if (s.run.finished) continue;
      followHints(mz, s, `${name} seed ${seed}`);
      trials++;
    }
  }
  assert.ok(trials > 400, 'enough random trials: ' + trials);
});

test('hints stay true on the per-game maze variants (mirrored, landmarks moved), from the start and after wrong moves', (t) => {
  if (!data.useSession) { t.skip('no per-game content in data.js'); return; }
  const WRONG = ['turn left', 'turn right', 'go straight', 'go straight 2 steps', 'turn around', 'my right', 'your left'];
  const ids = new Set();
  try {
    for (let seed = 1; seed <= 40; seed++) {
      data.useSession(seed);
      for (const rid of data.routeIds) for (const diff of ['standard', 'simple']) {
        const mz = data.guideMaze(rid, diff);
        ids.add(mz.id);
        followHints(mz, makeSession(mz), `seed ${seed} ${mz.id}`);
        for (let k = 1; k <= 5; k++) {
          const r = rng(seed * 31 + k), s = makeSession(mz);
          for (let i = 0; i < 1 + Math.floor(r() * 6) && !s.run.finished; i++) s.send(WRONG[Math.floor(r() * WRONG.length)]);
          if (!s.run.finished) followHints(mz, s, `seed ${seed} ${mz.id} wrong ${k}`);
        }
      }
    }
  } finally { data.useSession(null); }
  assert.ok(ids.size > 20, 'many different variants were tried: ' + ids.size);
});

test('facing the pupil: turn hints follow run.whoseMode and explain both sides', () => {
  const mz = data.guideMaze('r2', 'standard');
  /* route 2: Pip starts facing the viewer at the top right; the corridor goes down first */
  const s = makeSession(mz);
  s.send('go straight 3 steps');                         /* now at the junction, facing S, the way on is Pip's right (screen left) */
  assert.equal(s.run.facing, 'S');
  let h = s.hint();
  assert.equal(h.kind, 'turn');
  assert.equal(h.text, 'Try: Turn right. (Pip’s right is your left.)', 'not asked yet: Pip\'s side');
  /* pupil types it, Pip asks "My right or your right?", the hint now gives the answer */
  let res = s.send(h.say);
  assert.equal(res.status, 'clarify'); assert.equal(res.say, 'My right or your right?');
  h = s.hint();
  assert.equal(h.kind, 'answer');
  assert.equal(h.text, 'Try: Pip’s right. (That is your left.)');
  res = s.send(h.say);
  assert.equal(s.run.whoseMode, 'your'); assert.equal(s.run.facing, 'W');

  /* "my" mode: the pupil means their own side -> the hint uses the pupil's side too */
  const s2 = makeSession(mz);
  s2.send('go straight 3 steps');
  s2.send('turn my left');                               /* = Pip's right, sets whoseMode 'my' */
  assert.equal(s2.run.whoseMode, 'my'); assert.equal(s2.run.facing, 'W');
  s2.run.facing = 'S';                                   /* pretend Pip faces the pupil again */
  h = s2.hint();
  assert.equal(h.text, 'Try: Turn left. (Your left is Pip’s right.)');
  s2.send(h.say);
  assert.equal(s2.run.facing, 'W', 'typing the hint turns Pip to his right');
});

test('a wrong pending question gets the answer that helps most', () => {
  const mz = data.guideMaze('r2', 'standard');
  const s = makeSession(mz);
  s.send('go straight 3 steps');
  const res = s.send('turn left');                       /* the wrong way (Pip's left = a wall) */
  assert.equal(res.status, 'clarify');
  const h = s.hint();
  assert.equal(h.say, 'Pip’s right.', 'answer with the useful side, not the side the pupil asked about');
  followHints(mz, s, 'pending');
});

test('level 1 says what Pip can see from here, with legend names', () => {
  const mz = data.guideMaze('r1', 'standard'), run = guide.newRun(mz);
  let h = guide.lookHint(mz, run);
  assert.match(h.text, /Pip is looking up\. /);
  assert.match(h.text, /Pip can see the big tree/);
  assert.ok(h.visible.every((v) => typeof v.x === 'number' && typeof v.y === 'number'));
  run.facing = 'W';
  h = guide.lookHint(mz, run);
  assert.equal(h.wall, true);
  assert.match(h.text, /Pip is looking to the left, at a wall\. Turn first\./);
  /* facing the viewer: explain the mirror */
  const mz2 = data.guideMaze('r2', 'standard'), run2 = guide.newRun(mz2);
  h = guide.lookHint(mz2, run2);
  assert.match(h.text, /Pip is looking down, at you\./);
  assert.match(h.text, /Pip’s left is your right\./);
  /* the big tree and the way out use the legend names */
  assert.equal(guide.label('tree'), 'big tree');
  assert.equal(guide.label('exit'), 'way out');
  assert.equal(data.landmarkFromWords(guide.label('tree')), 'tree', 'legend names are understood by the parser');
  for (const id of data.landmarkIds.concat(['exit'])) assert.equal(data.landmarkFromWords(guide.label(id)), id, id);
});

test('hints are short A2 sentences and use a landmark when one marks the stop', () => {
  let landmarkHints = 0;
  for (const [name, mz] of MAZES) {
    const s = makeSession(mz);
    while (!s.run.finished) {
      const h2 = s.hint(), h1 = guide.lookHint(mz, s.run);
      for (const t of [h1.text, h2.text]) {
        assert.ok(t.length <= 115, name + ': short: ' + t);
        assert.ok(!/…|\.\.\./.test(t), name + ': no gaps to fill: ' + t);
      }
      if (/until the|to the way out/.test(h2.say)) landmarkHints++;
      s.send(h2.say);
    }
  }
  assert.ok(landmarkHints >= 4, 'some hints name a landmark: ' + landmarkHints);
  const mz = data.guideMaze('r1', 'standard'), run = guide.newRun(mz);
  run.finished = true;
  assert.equal(guide.nextStep(mz, run).kind, 'done');
});
