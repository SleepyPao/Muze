'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MR } = require('./helper');
const { data, maze } = MR;

test('fact table: 4 items, each with 3 card slots (place + 2 others), 7 fact sentences and 2 junctions of 2-3 options', () => {
  assert.equal(data.items.length, 4);
  assert.equal(data.items[0].id, 'key');
  assert.equal(data.items[0].place, 'It is behind the red door, next to the blue fountain.');
  for (const it of data.items) {
    assert.match(it.name, /^an? \w+$/);
    assert.equal(data.slotsOf(it).length, 3);
    assert.equal(data.slotsOf(it)[2], 'place', 'place is always the last slot');
    for (const f of data.FACTS) assert.match(data.factText(it.id, f), /^(It is|I need|I lost) .+\.$/, f);
    assert.equal(data.factText(it.id, 'place'), it.place);
    assert.match(it.place, /^It is .+\.$/);
    assert.equal(it.junctions.length, 2);
    for (const j of it.junctions) {
      assert.ok(j.options.length >= 2 && j.options.length <= 3);
      assert.ok(j.correct >= 0 && j.correct < j.options.length);
      assert.ok(it.place.includes(j.clue), `${it.id}: clue "${j.clue}" is part of the place sentence`);
    }
    assert.equal(data.factText(it.id, 'name'), 'I need ' + it.name + '.');
  }
});

test('place sentences practise all five prepositions', () => {
  const all = data.items.map(i => i.place).join(' ');
  for (const p of data.PREPOSITIONS) assert.ok(all.includes(p), p);
});

test('every landmark on every map is in the closed vocabulary', () => {
  const maps = [...Object.values(data.goMaps), ...data.warmup.map(w => w.map)];
  for (const r of data.routeIds) for (const d of data.DIFFICULTIES) maps.push(data.guideMazes[r][d]);
  for (const m of maps) {
    for (const lm of m.landmarks) {
      assert.ok(data.landmarkTypes[lm.type], `${m.id}: ${lm.type}`);
      const solid = data.landmarkTypes[lm.type].solid;
      assert.equal(maze.isWalkable(m, lm.x, lm.y), !solid, `${m.id}: ${lm.type} on the right kind of tile`);
    }
  }
});

test('landmarkFromWords', () => {
  assert.equal(data.landmarkFromWords('the blue fountain'), 'fountain');
  assert.equal(data.landmarkFromWords('big tree'), 'tree');
  assert.equal(data.landmarkFromWords('red door'), 'red_door');
  assert.equal(data.landmarkFromWords('the door'), 'door');
  assert.equal(data.landmarkFromWords('exit'), 'exit');
  assert.equal(data.landmarkFromWords('house'), null);
});

test('Go maps: tree-shaped, branches match the fact table, wrong branches are dead ends', () => {
  for (const it of data.items) {
    const m = data.goMap(it.id);
    assert.ok(m, it.id);
    // tree-shaped: (#edges == #path tiles - 1) and connected
    let tiles = 0, edges = 0;
    for (let y = 0; y < m.rows; y++) for (let x = 0; x < m.cols; x++) {
      if (!maze.isWalkable(m, x, y)) continue;
      tiles++;
      if (maze.isWalkable(m, x + 1, y)) edges++;
      if (maze.isWalkable(m, x, y + 1)) edges++;
      assert.ok(maze.findPath(m, m.start, { x, y }), `${it.id}: (${x},${y}) reachable`);
    }
    assert.equal(edges, tiles - 1, `${it.id}: no loops`);
    assert.equal(m.junctions.length, 2);
    assert.deepEqual(m.approach[m.approach.length - 1], m.junctions[0].at);
    m.junctions.forEach((j, ji) => {
      assert.equal(j.branches.length, it.junctions[ji].options.length);
      const firstSteps = new Set();
      j.branches.forEach((b, bi) => {
        assert.equal(b.label, it.junctions[ji].options[bi]);
        assert.equal(b.correct, bi === it.junctions[ji].correct);
        assert.ok(b.path.length >= 2, 'branch has a visible length');
        firstSteps.add(b.path[0].x + ',' + b.path[0].y);
        assert.deepEqual(b.path[b.path.length - 1], b.end);
        for (const id of b.landmarks) assert.ok(m.landmarks.find(l => l.id === id), `${it.id}: landmark ${id}`);
        if (!b.correct) assert.equal(maze.neighbors(m, b.end.x, b.end.y).length, 1, `${it.id} j${ji} b${bi}: dead end`);
        // the approach / previous junction is never part of a branch
        assert.ok(!b.path.some(t => t.x === m.start.x && t.y === m.start.y));
      });
      assert.equal(firstSteps.size, j.branches.length, 'branches leave the junction in different directions');
    });
    const c0 = m.junctions[0].branches[m.junctions[0].correct];
    assert.deepEqual(c0.end, m.junctions[1].at, 'correct branch 0 leads to junction 1');
    const c1 = m.junctions[1].branches[m.junctions[1].correct];
    assert.deepEqual(c1.end, m.pickupFrom, 'correct branch 1 leads to the item');
    assert.ok(Math.abs(m.item.x - m.pickupFrom.x) + Math.abs(m.item.y - m.pickupFrom.y) <= 1);
    // every branch is marked by a landmark Pip passes ("at") or that stands at its end
    for (const j of m.junctions) for (const b of j.branches) for (const id of b.landmarks) {
      const lm = m.landmarks.find(l => l.id === id);
      assert.ok(b.path.some(t => maze.isAtLandmark(lm, t.x, t.y)), `${it.id}: ${id} is on its branch`);
      for (const other of j.branches) if (other !== b) {
        assert.ok(!other.path.some(t => maze.isAtLandmark(lm, t.x, t.y)), `${it.id}: ${id} marks one branch only`);
      }
    }
  }
});

test('Guide mazes: 2 routes x 2 difficulties, solvable, shortest solution >= 5 instructions', () => {
  for (const r of data.routeIds) {
    const counts = {};
    for (const d of data.DIFFICULTIES) {
      const m = data.guideMaze(r, d);
      assert.ok(m, `${r}/${d}`);
      assert.ok(maze.isWalkable(m, m.start.x, m.start.y));
      assert.ok(maze.isWalkable(m, m.exit.x, m.exit.y));
      assert.ok(maze.findPath(m, m.start, m.exit), `${m.id} solvable (BFS)`);
      const min = maze.minInstructions(m);
      assert.ok(min >= 5 && min < 20, `${m.id}: shortest solution is ${min} instructions`);
      let junctions = 0;
      for (let y = 0; y < m.rows; y++) for (let x = 0; x < m.cols; x++) if (maze.isJunction(m, x, y)) junctions++;
      counts[d] = junctions;
      const types = m.landmarks.map(l => l.type);
      assert.equal(new Set(types).size, types.length, `${m.id}: each landmark type appears once`);
      // the first corridor has a landmark to aim for ("go straight until the ...")
      assert.ok(maze.visibleAhead(m, m.start, m.start.facing).length >= 1, `${m.id}: a landmark is visible from the start`);
    }
    assert.ok(counts.simple < counts.standard, `${r}: simple has fewer junctions (${counts.simple} < ${counts.standard})`);
  }
  assert.equal(data.guideMaze(0).id, 'r1_standard');
  assert.equal(data.guideMaze(1, 'simple').id, 'r2_simple');
  assert.equal(data.guideMaze('r2').start.facing, 'S');
});

test('warm-up: 10+ questions of two types that do not use the item facts', () => {
  assert.ok(data.warmup.length >= 10);
  assert.equal(data.warmupSet().length, 10);
  const used = new Set();
  for (const q of data.warmup) {
    assert.ok(['path', 'prep'].includes(q.type));
    assert.ok(q.correct >= 0 && q.correct < q.options.length);
    const text = (q.instruction || q.sentence).toLowerCase();
    for (const it of data.items) assert.ok(!new RegExp('\\b' + it.noun + '\\b').test(text), `${q.id} does not mention the ${it.noun}`);
    if (q.type === 'prep') {
      assert.ok(q.sentence.includes('___'));
      for (const o of q.options) assert.ok(data.PREPOSITIONS.includes(o));
      used.add(q.options[q.correct]);
    } else {
      for (const o of q.options) for (const t of o.tiles) assert.ok(maze.isWalkable(q.map, t.x, t.y), `${q.id} option tile walkable`);
      for (const t of q.approach) assert.ok(maze.isWalkable(q.map, t.x, t.y));
    }
  }
  assert.equal(used.size, 5, 'all five prepositions are a correct answer somewhere');
  const set = data.warmupSet();
  assert.ok(set.filter(q => q.type === 'path').length >= 4 && set.filter(q => q.type === 'prep').length >= 4);
});

test('hint ladder has two levels per fact', () => {
  for (const f of data.FACTS) { assert.ok(data.hints[f][1]); assert.ok(data.hints[f][2]); }
  assert.equal(data.hints.place[1], 'Ask about the place.');
  assert.equal(data.hints.colour[1], 'Ask about the colour.');
  assert.equal(data.hints.colour[2], 'What colour …?');
  assert.deepEqual(data.FACTS, ['name', 'colour', 'size', 'whose', 'why', 'when', 'place']);
  for (const f of data.FACTS) { assert.ok(data.FACT_LABELS[f], f); assert.match(data.text.clarify[f], /^Do you mean .+\?$/); }
});

test('warm-up turn questions never depend on whose left is meant (Pip walks away from the viewer)', () => {
  for (const q of data.warmup.filter((w) => w.type === 'path')) {
    const at = q.approach[q.approach.length - 1];
    const lastDir = MR.maze.facingBetween(q.approach.length > 1 ? q.approach[q.approach.length - 2] : q.map.start, at);
    assert.equal(lastDir, 'N', q.id + ': Pip must arrive facing away from the viewer');
    if (/\b(left|right)\b/i.test(q.instruction)) {
      const want = /\bleft\b/i.test(q.instruction) ? 'W' : 'E';
      const pick = q.options[q.correct].tiles[0];
      assert.equal(MR.maze.facingBetween(at, pick), want, q.id + ': screen side = Pip\'s side');
    }
  }
});
