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
  let r = say(mz, run, 'Go straight until the fountain');
  assert.equal(r.status, 'ok');
  assert.deepEqual({ x: run.x, y: run.y }, { x: 1, y: 5 });
  assert.equal(r.steps[0].type, 'move'); assert.equal(r.steps[0].path.length, 4);
  r = say(mz, run, 'Turn right, then walk to the tree and turn left');
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

test('"go straight" stops at the next junction or at the end of the corridor', () => {
  const mz = data.guideMaze('r1', 'standard'), run = guide.newRun(mz);
  say(mz, run, 'go straight');
  assert.deepEqual({ x: run.x, y: run.y }, { x: 1, y: 7 }, 'stops at the first junction');
  say(mz, run, 'go straight');
  assert.deepEqual({ x: run.x, y: run.y }, { x: 1, y: 5 }, 'then at the corner');
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
  const r = say(mz, run, 'go straight until the tree');
  assert.equal(r.status, 'clarify'); assert.equal(r.clarify.kind, 'landmark');
  assert.equal(r.say, 'I can’t see a tree. What can I see?');
  assert.deepEqual({ x: run.x, y: run.y }, { x: 1, y: 9 });
  assert.deepEqual(guide.visibleNames(mz, run), ['fountain']);
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
  r = say(mz, run, 'go straight until the tree, turn right');
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
  assert.equal(r.status, 'ok'); assert.equal(run2.facing, 'E'); assert.equal(run2.whoseAsked, true);
});

test('no question when Pip faces away from the viewer', () => {
  const mz = data.guideMaze('r1', 'simple'), run = guide.newRun(mz);
  const r = say(mz, run, 'turn left');
  assert.equal(r.status, 'ok'); assert.equal(run.facing, 'W');
});

test('all four mazes are solvable through the engine with a scripted solution', () => {
  const scripts = {
    r1: ['go straight until the fountain', 'turn right', 'go straight until the tree', 'turn left', 'go straight until the windmill', 'turn right', 'go to the exit'],
    r2: ['go straight until the bench', 'turn your right', 'go straight until the scarecrow', 'turn left', 'go straight until the tree', 'turn right', 'go to the exit']
  };
  for (const r of data.routeIds) for (const d of data.DIFFICULTIES) {
    const mz = data.guideMaze(r, d), run = guide.newRun(mz);
    let last;
    for (const line of scripts[r]) { last = say(mz, run, line); assert.notEqual(last.status, 'wall', `${mz.id}: ${line}`); assert.notEqual(last.status, 'clarify', `${mz.id}: ${line}`); }
    assert.equal(last.status, 'exit', mz.id);
  }
});
