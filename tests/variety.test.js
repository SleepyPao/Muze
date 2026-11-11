'use strict';
/* Every game is different (a per-game seed). These tests check MANY seeds: every game must be as correct as the
 * hand-made classic one - true place sentences, dead ends, solvable mazes, unambiguous warm-up pictures - and the
 * same seed must always give exactly the same game. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { MR, fresh } = require('./helper');
const { data, maze, guide } = MR;

const SEEDS = [];
for (let i = 0; i < 300; i++) SEEDS.push(i);
for (let i = 0; i < 60; i++) SEEDS.push(data.seedFromText('seed-' + i));        // big 32-bit seeds too
const same = (a, b) => a.x === b.x && a.y === b.y;
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const lmOf = (m, id) => m.landmarks.find((l) => l.id === id);

/** Everything that defines a game, as plain data (to compare two builds). */
function snapshot() {
  return JSON.stringify({
    items: data.items.map((it) => [it.id, it.look, it.colour, it.place, it.template, it.junctions]),
    maps: data.items.map((it) => { const m = data.goMap(it.id); return [m.tiles, m.landmarks, m.item, m.pickupFrom, m.start]; }),
    warm: data.warmupSet().map((q) => [q.id, q.instruction || q.sentence, q.options.map((o) => o.id || o), q.correct, q.map.tiles, q.map.landmarks]),
    guide: data.routeIds.map((r) => data.DIFFICULTIES.map((d) => data.guideMaze(r, d).id))
  });
}

/* ------------------------------------------------------------------ Go maps */
function checkGoMap(it, m, tag) {
  // tree-shaped (no loops) and connected
  let tiles = 0, edges = 0;
  for (let y = 0; y < m.rows; y++) for (let x = 0; x < m.cols; x++) {
    if (!maze.isWalkable(m, x, y)) continue;
    tiles++;
    if (maze.isWalkable(m, x + 1, y)) edges++;
    if (maze.isWalkable(m, x, y + 1)) edges++;
    assert.ok(maze.findPath(m, m.start, { x, y }), `${tag}: (${x},${y}) reachable`);
  }
  assert.equal(edges, tiles - 1, `${tag}: no loops`);
  assert.equal(m.junctions.length, 2);
  assert.deepEqual(m.approach[m.approach.length - 1], m.junctions[0].at);
  const types = m.landmarks.map((l) => l.type);
  assert.equal(new Set(types).size, types.length, `${tag}: each landmark type once`);
  for (const lm of m.landmarks) {
    assert.ok(data.landmarkTypes[lm.type], `${tag}: ${lm.type} in the closed vocabulary`);
    assert.equal(maze.isWalkable(m, lm.x, lm.y), !data.landmarkTypes[lm.type].solid, `${tag}: ${lm.type} on the right kind of tile`);
  }
  m.junctions.forEach((j, ji) => {
    const fact = it.junctions[ji];
    assert.equal(j.branches.length, fact.options.length);
    assert.ok(j.branches.length >= 2 && j.branches.length <= 3);
    assert.ok(it.place.includes(fact.clue), `${tag}: clue "${fact.clue}" is in "${it.place}"`);
    const firstSteps = new Set();
    j.branches.forEach((b, bi) => {
      assert.equal(b.label, fact.options[bi]);
      assert.equal(b.correct, bi === fact.correct);
      assert.ok(b.path.length >= 2);
      assert.deepEqual(b.path[b.path.length - 1], b.end);
      firstSteps.add(b.path[0].x + ',' + b.path[0].y);
      if (!b.correct || ji === 1) assert.equal(maze.neighbors(m, b.end.x, b.end.y).length, 1, `${tag} j${ji} b${bi}: dead end`);
      // each branch is marked by its own landmarks only
      for (const id of b.landmarks) {
        const lm = lmOf(m, id);
        assert.ok(b.path.some((t) => maze.isAtLandmark(lm, t.x, t.y)), `${tag}: ${id} is on its branch`);
        for (const other of j.branches) if (other !== b) assert.ok(!other.path.some((t) => maze.isAtLandmark(lm, t.x, t.y)), `${tag}: ${id} marks one branch only`);
      }
    });
    assert.equal(firstSteps.size, j.branches.length, `${tag}: branches leave in different directions`);
    // the clue names exactly the landmarks of the correct branch
    const right = j.branches[fact.correct];
    for (const id of right.landmarks) assert.ok(fact.clue.includes(data.landmarkTypes[id].phrase), `${tag}: clue names ${id}`);
    for (const b of j.branches) if (b !== right) for (const id of b.landmarks) assert.ok(!fact.clue.includes(data.landmarkTypes[id].phrase), `${tag}: clue does not name a wrong branch's ${id}`);
  });
  const c0 = m.junctions[0].branches[m.junctions[0].correct];
  assert.deepEqual(c0.end, m.junctions[1].at, `${tag}: correct branch 1 leads to junction 2`);
  const J1 = m.junctions[1], c1 = J1.branches[J1.correct];
  assert.deepEqual(c1.end, m.pickupFrom, `${tag}: correct branch 2 leads to the thing`);
  assert.ok(maze.isWalkable(m, m.pickupFrom.x, m.pickupFrom.y));
  assert.ok(dist(m.item, m.pickupFrom) <= 1);
  // nothing on a wrong branch is at (or next to) the thing
  for (const j of m.junctions) for (const b of j.branches) if (!b.correct) {
    assert.ok(!b.path.some((t) => dist(t, m.item) <= 1), `${tag}: a wrong branch does not reach the thing`);
  }
  // the second clue is TRUE on the map
  const lm = lmOf(m, c1.landmarks[0]), clue = it.junctions[1].clue;
  if (/^next to /.test(clue)) assert.equal(dist(lm, m.item), 1, `${tag}: "${clue}" touches the thing`);
  else if (/^in front of /.test(clue)) assert.ok(lm.x === m.item.x && lm.y === m.item.y - 1, `${tag}: "${clue}": thing just below the landmark`);
  else if (/^opposite /.test(clue)) {
    assert.ok(lm.x + m.item.x === 2 * m.pickupFrom.x && lm.y + m.item.y === 2 * m.pickupFrom.y, `${tag}: "${clue}": landmark - path - thing`);
    assert.ok(!maze.isWalkable(m, m.item.x, m.item.y));
  } else if (/^behind /.test(clue)) {
    assert.ok(/_door$/.test(lm.type));
    const k = c1.path.findIndex((t) => same(t, lm));
    assert.ok(k >= 0 && k < c1.path.length - 1, `${tag}: "${clue}": the door is on the way, the thing is past it`);
  } else assert.fail(`${tag}: unexpected clue "${clue}"`);
  // the first clue is true for branch 1
  const clue0 = it.junctions[0].clue;
  assert.match(clue0, /^(behind|next to|opposite|between) /);
  if (/^between /.test(clue0)) assert.equal(c0.landmarks.length, 2);
}

test('classic game (no seed) is the original fact table, word for word', () => {
  fresh();
  data.useSession(null);
  assert.deepEqual(data.items.map((i) => i.id), ['key', 'map', 'lamp', 'bag']);
  assert.deepEqual(data.items.map((i) => i.place), [
    'It is behind the red door, next to the blue fountain.',
    'It is opposite the windmill, in front of the big tree.',
    'It is between the big tree and the well, behind the green door.',
    'It is next to the scarecrow, opposite the bench.']);
  assert.deepEqual(data.items.map((i) => i.look), ['It is small and yellow.', 'It is old and brown.', 'It is red and very bright.', 'It is big and green.']);
  assert.equal(data.guideMaze('r1').id, 'r1_standard');
  assert.equal(data.sessionSeed(), null);
  for (const it of data.items) checkGoMap(it, data.goMap(it.id), 'classic ' + it.id);
});

test(`fuzz ${SEEDS.length} seeds: 4 different things, true place sentences, dead ends, nothing reachable on a wrong path`, () => {
  const templatesSeen = new Set(), winsSeen = new Set(), itemsSeen = new Set();
  for (const seed of SEEDS) {
    data.useSession(seed);
    assert.equal(data.sessionSeed(), seed >>> 0);
    assert.equal(data.items.length, 4);
    assert.equal(new Set(data.items.map((i) => i.id)).size, 4, `seed ${seed}: 4 distinct things`);
    assert.equal(new Set(data.items.map((i) => i.colour)).size, 4, `seed ${seed}: 4 different colours`);
    assert.deepEqual(data.items.map((i) => i.template).sort(), ['A', 'B', 'C', 'D'], 'each map shape once');
    data.items.forEach((it, k) => {
      itemsSeen.add(it.id);
      assert.ok(data.poolIds.includes(it.id));
      assert.equal(data.getItem(k), it); assert.equal(data.getItem(it.id), it);
      assert.equal(data.factText(it.id, 'name'), 'I need ' + it.name + '.');
      assert.match(it.name, /^an? [a-z]+$/);
      assert.equal(it.look, 'It is ' + it.size + ' and ' + it.colour + '.');
      assert.ok(data.SIZES.includes(it.size) && data.COLOURS.includes(it.colour));
      assert.match(it.place, /^It is [a-z ]+, [a-z ]+\.$/);
      assert.ok(it.place.split(' ').length <= 14, `short sentence: ${it.place}`);
      const m = data.goMap(it.id);
      checkGoMap(it, m, `seed ${seed} ${it.id}`);
      templatesSeen.add(it.template + ':' + it.junctions[1].correct);
      winsSeen.add(it.junctions[1].correct);
    });
  }
  assert.equal(itemsSeen.size, 8, 'all 8 things are used');
  assert.ok(winsSeen.has(0) && winsSeen.has(1) && winsSeen.has(2), 'the thing is not always on the same branch');
  assert.equal(templatesSeen.size, 2 + 3 + 2 + 2, 'every possible hiding place is used');
});

test('same seed -> identical game; resume rebuilds the same content; different seeds differ', () => {
  const snaps = new Set();
  for (const seed of [5, 77, 4000000000, 123456]) {
    data.useSession(seed); const a = snapshot();
    data.useSession(seed + 1); data.useSession(null);
    data.useSession(seed); const b = snapshot();
    assert.equal(a, b, `seed ${seed} rebuilds identically`);
    snaps.add(a);
  }
  assert.equal(snaps.size, 4, 'different seeds give different games');
  // place sentences vary a lot from game to game
  const places = new Set();
  for (let s = 0; s < 100; s++) { data.useSession(s); data.items.forEach((it) => places.add(it.place)); }
  assert.ok(places.size > 60, `${places.size} different place sentences in 100 games`);
  // through MR.state: a new game logs its seed + facts; resume (also after a reload) gives back the same game
  const M = fresh();
  M.state.begin('5A-12', 'standard', { seed: 99 });
  const first = snapshot();
  assert.equal(M.state.sessionSeed(), 99);
  const ev = M.log.sessionOf('5A-12');
  assert.equal(ev.seed, 99);
  assert.deepEqual(ev.items.map((i) => i.place), data.items.map((i) => i.place));
  assert.deepEqual(ev.items[0], { id: data.items[0].id, colour: data.items[0].colour, name: 'I need ' + data.items[0].name + '.', look: data.items[0].look, place: data.items[0].place });
  M.state.begin('5A-13', 'standard');                   // another pupil, another (random) game
  assert.notEqual(M.state.sessionSeed(), 99);
  M.state.begin('5A-12');                               // first pupil comes back
  assert.equal(snapshot(), first, 'resume gets back the same game');
  M.state.init();                                       // page reload
  assert.equal(snapshot(), first, 'reload gets back the same game');
  M.state.signOut();
  assert.equal(data.sessionSeed(), null, 'no pupil -> classic content');
  // a game saved before seeds existed plays the classic content
  const all = M.storage.get('mr.sessions.v1'); delete all['5A-12'].seed; M.storage.set('mr.sessions.v1', all);
  M.state.begin('5A-12');
  assert.deepEqual(data.items.map((i) => i.id), ['key', 'map', 'lamp', 'bag']);
  // random seeds are 32-bit and differ
  const seeds = new Set(); for (let i = 0; i < 20; i++) seeds.add(data.newSeed());
  assert.ok(seeds.size > 15 && [...seeds].every((s) => s >= 0 && s <= 4294967295 && Math.floor(s) === s));
});

test('getItem finds every pool thing (teacher view of other pupils); unknown ids give null', () => {
  data.useSession(1);
  for (const id of data.poolIds) { const it = data.getItem(id); assert.ok(it && it.id === id && it.noun === id); }
  assert.equal(data.getItem('castle'), null);
  assert.equal(data.getItem(7), null);
  fresh();
  const M = MR;
  M.state.begin('6A-1', 'standard', { seed: 3 });
  const notMine = data.poolIds.find((id) => !data.itemIds.includes(id));
  M.log.askTurn({ item_id: notMine, sent_text: 'Where is it?', result: { category: 'place', fact_given: 'place', reply: 'x' } });
  assert.equal(M.log.aggregate()[0].facts_asked, 1, 'facts about any pool thing are counted');
});

/* ------------------------------------------------------------------ warm-up */
const PRED = {
  'next to': (pip, lms) => lms.some((l) => dist(l, pip) === 1),
  'behind': (pip, lms) => lms.some((l) => l.x === pip.x && l.y > pip.y),
  'in front of': (pip, lms) => lms.some((l) => l.x === pip.x && l.y < pip.y),
  'between': (pip, lms) => lms.some((a) => lms.some((b) => a.y === pip.y && b.y === pip.y && a.x < pip.x && pip.x < b.x)),
  'opposite': (pip, lms, map) => lms.some((l) => l.x === pip.x && Math.abs(l.y - pip.y) === 2 && maze.isWalkable(map, pip.x, (l.y + pip.y) / 2))
};
function checkWarmQuestion(q, tag) {
  const text = (q.instruction || q.sentence).toLowerCase();
  for (const id of data.poolIds) assert.ok(!new RegExp('\\b' + id + '\\b').test(text), `${tag}: does not mention a thing (${id})`);
  for (const lm of q.map.landmarks) assert.ok(data.landmarkTypes[lm.type] && maze.isWalkable(q.map, lm.x, lm.y) === !data.landmarkTypes[lm.type].solid, `${tag}: ${lm.type}`);
  assert.ok(q.correct >= 0 && q.correct < q.options.length);
  if (q.type === 'prep') {
    assert.equal(q.options.length, 3);
    assert.equal(new Set(q.options).size, 3);
    assert.equal((q.sentence.match(/___/g) || []).length, 1);
    const word = q.options[q.correct];
    for (const o of q.options) {
      assert.ok(data.PREPOSITIONS.includes(o));
      assert.equal(PRED[o](q.pip, q.map.landmarks, q.map), o === word, `${tag}: "${o}" is ${o === word ? 'true' : 'false'} in the picture (${q.sentence})`);
    }
    for (const lm of q.map.landmarks) {
      assert.ok(q.sentence.includes('the ' + data.landmarkName(lm.type)), `${tag}: the sentence names the ${lm.type}`);
      if (lm.x === q.pip.x && lm.y > q.pip.y) assert.ok(['fountain', 'well', 'bench'].includes(lm.type), `${tag}: a tall ${lm.type} would hide Pip`);
    }
    return word;
  }
  // path: Pip walks AWAY from the viewer (facing N), so screen-left = Pip's left
  const at = q.approach[q.approach.length - 1];
  const lastDir = maze.facingBetween(q.approach.length > 1 ? q.approach[q.approach.length - 2] : q.map.start, at);
  assert.equal(lastDir, 'N', `${tag}: Pip must arrive facing away from the viewer`);
  assert.equal(q.map.start.facing, 'N');
  for (const t of q.approach) assert.ok(maze.isWalkable(q.map, t.x, t.y));
  for (const o of q.options) for (const t of o.tiles) assert.ok(maze.isWalkable(q.map, t.x, t.y));
  const right = q.options[q.correct], wrong = q.options.filter((o) => o !== right);
  const lmIn = (re) => q.map.landmarks.find((l) => re.test(q.instruction) && q.instruction.includes('the ' + data.landmarkName(l.type)));
  if (/\b(left|right)\b/i.test(q.instruction)) {
    const want = /\bleft\b/i.test(q.instruction) ? 'W' : 'E';
    assert.equal(maze.facingBetween(at, right.tiles[0]), want, `${tag}: screen side = Pip's side`);
  }
  if (/^Turn (left|right) at /.test(q.instruction)) assert.equal(dist(lmIn(/at/), at), 1, `${tag}: Pip turns AT the landmark`);
  if (/^Take the path next to /.test(q.instruction) || /^Walk to /.test(q.instruction)) {
    const lm = lmIn(/./);
    assert.ok(right.tiles.some((t) => dist(t, lm) === 1), `${tag}: the landmark is at the right path`);
    for (const w of wrong) assert.ok(!w.tiles.some((t) => dist(t, lm) === 1), `${tag}: ...and not at a wrong path`);
  }
  if (/^Go through /.test(q.instruction)) {
    const lm = lmIn(/./);
    assert.ok(right.tiles.some((t) => same(t, lm)) && !wrong.some((w) => w.tiles.some((t) => same(t, lm))), `${tag}: the door is on the right path only`);
  }
  if (/^Go straight/.test(q.instruction)) assert.equal(maze.facingBetween(at, right.tiles[0]), 'N');
  return null;
}

test(`fuzz ${SEEDS.length} seeds: warm-up = 10 questions (5 path + 5 prep), all five prepositions, never ambiguous`, () => {
  const kinds = new Set(), instr = new Set(), all = new Set(data.allWarmupInstructions());
  for (const seed of SEEDS) {
    data.useSession(seed);
    const qs = data.warmupSet();
    assert.equal(qs.length, 10);
    assert.deepEqual(qs.map((q) => q.type), ['path', 'prep', 'path', 'prep', 'path', 'prep', 'path', 'prep', 'path', 'prep']);
    const paths = qs.filter((q) => q.type === 'path');
    assert.equal(new Set(paths.map((q) => q.kind)).size, 5, 'five different kinds of path question');
    const fam = data.WARMUP_KINDS.pathFamilies;
    assert.deepEqual(Object.keys(fam).map((f) => paths.filter((q) => fam[f].includes(q.kind)).length), [1, 1, 1, 1, 1], 'one of each family');
    const words = qs.map((q, i) => checkWarmQuestion(q, `seed ${seed} q${i} ${q.id}`)).filter(Boolean);
    assert.deepEqual(words.slice().sort(), data.PREPOSITIONS.slice().sort(), 'one question for each preposition');
    qs.forEach((q) => { kinds.add(q.kind); if (q.instruction) { instr.add(q.instruction); assert.ok(all.has(q.instruction), q.instruction); } });
  }
  assert.ok(kinds.size >= 20, `pool of ${kinds.size} question kinds (>= 20)`);
  assert.ok(instr.size >= 20, `${instr.size} different instructions used`);
  // every kind on its own, with many landmark choices
  for (const k of [...data.WARMUP_KINDS.path, ...Object.values(data.WARMUP_KINDS.prep).flat()]) {
    for (let s = 0; s < 40; s++) checkWarmQuestion(data.warmupQuestion(k, s), `${k} #${s}`);
  }
});

/* ------------------------------------------------------------------ Guide maze variants */
function solveThroughEngine(mz) {
  const run = guide.newRun(mz);
  for (let n = 0; n < 40 && !run.finished; n++) {
    const plan = data.guideSolution(mz, { x: run.x, y: run.y, facing: run.facing });
    const a = Object.assign({}, plan[0]);
    if (a.type === 'turn' && run.facing === 'S') a.whose = 'your';
    const res = guide.execute(mz, run, [a]);
    assert.ok(res.status === 'ok' || res.status === 'exit', `${mz.id}: ${JSON.stringify(a)} -> ${res.status}`);
  }
  return run;
}

test(`fuzz ${SEEDS.length} seeds: Guide variants (mirrored / landmarks moved) are solvable, need >= 5 instructions and round-trip by id`, () => {
  const ids = new Set(), mirrors = new Set();
  for (const seed of SEEDS) {
    data.useSession(seed);
    for (const r of data.routeIds) {
      for (const d of data.DIFFICULTIES) {
        const mz = data.guideMaze(r, d), base = data.guideMazes[r][d], tag = `seed ${seed} ${mz.id}`;
        assert.match(mz.id, new RegExp('^' + base.id + '~m[01]~p[0-5]+$'));
        assert.equal(mz.routeId, r); assert.equal(mz.difficulty, d);
        assert.equal(data.guideMazeById(mz.id), mz, `${tag}: guideMazeById round-trips`);
        ids.add(mz.id); mirrors.add(mz.mirrored);
        const min = maze.minInstructions(mz);
        assert.ok(min >= 5 && min < 20, `${tag}: shortest solution ${min}`);
        assert.equal(min, maze.minInstructions(base), `${tag}: as hard as the hand-made maze`);
        assert.ok(maze.findPath(mz, mz.start, mz.exit));
        const types = mz.landmarks.map((l) => l.type);
        assert.equal(new Set(types).size, types.length, `${tag}: each landmark type once`);
        for (const lm of mz.landmarks) assert.equal(maze.isWalkable(mz, lm.x, lm.y), !data.landmarkTypes[lm.type].solid, `${tag}: ${lm.type} on the right tile`);
        assert.deepEqual(mz.landmarks.filter((l) => !data.landmarkTypes[l.type].solid).map((l) => l.type), base.landmarks.filter((l) => !data.landmarkTypes[l.type].solid).map((l) => l.type), 'doors / bridge stay');
        assert.ok(maze.visibleAhead(mz, mz.start, mz.start.facing).length >= 1, `${tag}: a landmark is visible from the start`);
        assert.equal(mz.start.facing === 'S', base.start.facing === 'S', 'facing the viewer or not does not change');
        let junctions = 0, baseJ = 0;
        for (let y = 0; y < mz.rows; y++) for (let x = 0; x < mz.cols; x++) { if (maze.isJunction(mz, x, y)) junctions++; if (maze.isJunction(base, x, y)) baseJ++; }
        assert.equal(junctions, baseJ);
        if (seed < 60) assert.ok(solveThroughEngine(mz).finished, `${tag}: Pip gets out through the engine`);
      }
    }
  }
  assert.ok(mirrors.has(true) && mirrors.has(false), 'some mazes are mirrored, some are not');
  assert.ok(ids.size > 300, `${ids.size} different maze variants`);
  // ids that are not real mazes
  for (const bad of ['', 'r3_standard', 'r1_hard', 'r1_standard~m2~p01234', 'r1_standard~m1~p0123', 'r1_standard~m1~p00123', 'r1_standard~m1~p91234', null]) {
    assert.equal(data.guideMazeById(bad), null, String(bad));
  }
  assert.equal(data.guideMazeById('r2_simple'), data.guideMazes.r2.simple);
});

/* A tall landmark (tree, windmill, scarecrow) is drawn up over the tile above it: if Pip can walk there he is hidden.
 * So on every map a game makes, a tile just below a path tile only ever holds a low landmark (fountain, well, bench). */
function checkNoTallUnderPath(m, tag) {
  for (const lm of m.landmarks) {
    if (!data.landmarkTypes[lm.type].solid) continue;
    if (maze.isWalkable(m, lm.x, lm.y - 1)) assert.ok(data.LOW_TYPES.includes(lm.type), `${tag}: a tall ${lm.type} at ${lm.x},${lm.y} would hide Pip on the path above it`);
    /* the tree's leaves and the windmill's sails reach half a tile to each side */
    if (maze.isWalkable(m, lm.x - 1, lm.y - 1) || maze.isWalkable(m, lm.x + 1, lm.y - 1)) assert.ok(data.NARROW_TYPES.includes(lm.type), `${tag}: a wide ${lm.type} at ${lm.x},${lm.y} would cover half of Pip on the path diagonally above it`);
  }
}
test(`fuzz ${SEEDS.length} seeds: no tall / wide landmark stands just below a path (Pip is never hidden) in Go maps, Guide mazes, warm-up`, () => {
  fresh();
  for (const r of data.routeIds) for (const d of data.DIFFICULTIES) checkNoTallUnderPath(data.guideMazes[r][d], 'hand-made ' + r + '_' + d);
  for (const seed of SEEDS) {
    data.useSession(seed);
    for (const it of data.items) checkNoTallUnderPath(data.goMap(it.id), `seed ${seed} go ${it.id}`);
    for (const r of data.routeIds) for (const d of data.DIFFICULTIES) checkNoTallUnderPath(data.guideMaze(r, d), `seed ${seed} ${data.guideMaze(r, d).id}`);
    for (const q of data.warmupSet()) if (q.type === 'path') checkNoTallUnderPath(q.map, `seed ${seed} warm-up ${q.kind}`);
  }
  data.useSession(null);
});

test('teacher replay rebuilds a variant route from the log alone (maze_id)', () => {
  const M = fresh();
  M.state.begin('5B-02', 'simple', { seed: 4242 });
  const mz = data.guideMaze('r2', 'simple');
  assert.ok(/~m[01]~p/.test(mz.id));
  const run = guide.newRun(mz);
  const plan = data.guideSolution(mz);
  for (const a0 of plan) {
    const a = Object.assign({}, a0);
    if (a.type === 'turn' && run.facing === 'S') a.whose = 'your';
    const res = guide.execute(mz, run, [a]);
    M.log.guideTurn({ route_id: 'r2', maze_id: mz.id, sent_text: 'x', parsed_actions: [a], reached_exit: res.reached_exit });
  }
  assert.ok(run.finished);
  const entries = M.log.forStudent('5B-02');
  data.useSession(null);                                  // the teacher's device has no game on
  const rep = guide.replay(entries).r2;
  assert.equal(rep.mazeId, mz.id);
  assert.equal(rep.reached, true);
  assert.deepEqual(rep.trail, run.trail);
});

/* ------------------------------------------------------------------ words: validators + voice */
test('validators know every thing of the pool: task words, no fact leaks in model text', () => {
  fresh();
  for (const id of data.poolIds) {
    assert.equal(MR.rules.classifyAsk('I love you. Where is the ' + id + '?').category, 'place', `${id} counts as a task word`);
    assert.ok(data.factWords.includes(id));
    assert.equal(MR.ai.validateReply('Do you mean the ' + id + '?', 'unclear'), false, `model text may not name the ${id}`);
  }
  for (const w of data.factWords) assert.equal(MR.ai.isAllowedWord(w), false, `"${w}" can never be in model-written text`);
  for (const c of data.COLOURS) assert.ok(data.factWords.includes(c));
});

test('every fact of every game and every warm-up instruction is in the voice line list (tools/voice/lines.js)', () => {
  const out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'voice', 'lines.js')], { encoding: 'utf8' }));
  const lines = new Set(out);
  const facts = new Set(data.allFactTexts());
  for (const seed of SEEDS) {
    data.useSession(seed);
    for (const it of data.items) for (const f of data.FACTS) {
      const t = data.factText(it.id, f);
      assert.ok(facts.has(t), `allFactTexts has "${t}"`);
      assert.ok(lines.has(t), `voice line list has "${t}"`);
    }
    for (const q of data.warmupSet()) if (q.instruction) assert.ok(lines.has(q.instruction), q.instruction);
  }
  data.useSession(null);
  for (const it of data.items) for (const f of data.FACTS) assert.ok(lines.has(data.factText(it.id, f)), 'classic: ' + f);
  for (const t of data.allWarmupInstructions()) assert.ok(lines.has(t), t);
  assert.ok(out.length < 400, `${out.length} lines to record`);
});
