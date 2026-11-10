/* Maze Rescue - closed game data: fact table, Go maps, Guide mazes, warm-up questions, hints, canned lines.
 * Pure (no DOM). Requires core.js and maze.js. Everything Pip may ever "know" is in this file.
 * All pupil-facing text is English at about A2 level. */
(function (root) {
  'use strict';
  var MR = root.MR = root.MR || {};
  var maze = MR.maze;
  var data = MR.data = {};

  /* ------------------------------------------------------------------ landmarks */
  /** Closed landmark vocabulary. solid:false = Pip walks through it (it sits ON a path tile);
   *  solid:true = it stands on a lawn tile beside the path. `name` is the phrase used in sentences. */
  data.landmarkTypes = {
    fountain:   { name: 'fountain',   phrase: 'the blue fountain', solid: true,  words: ['fountain'] },
    tree:       { name: 'tree',       phrase: 'the big tree',      solid: true,  words: ['tree'] },
    bridge:     { name: 'bridge',     phrase: 'the bridge',        solid: false, words: ['bridge'] },
    red_door:   { name: 'red door',   phrase: 'the red door',      solid: false, words: ['red door'] },
    green_door: { name: 'green door', phrase: 'the green door',    solid: false, words: ['green door'] },
    windmill:   { name: 'windmill',   phrase: 'the windmill',      solid: true,  words: ['windmill', 'mill'] },
    scarecrow:  { name: 'scarecrow',  phrase: 'the scarecrow',     solid: true,  words: ['scarecrow'] },
    well:       { name: 'well',       phrase: 'the well',          solid: true,  words: ['well'] },
    bench:      { name: 'bench',      phrase: 'the bench',         solid: true,  words: ['bench', 'seat'] }
  };
  data.landmarkIds = Object.keys(data.landmarkTypes);

  /** Map a pupil / model phrase to a landmark type id.
   *  Returns one of data.landmarkIds, 'door' (any door), 'exit', or null when it is not in the closed vocabulary. */
  data.landmarkFromWords = function (phrase) {
    var p = String(phrase || '').toLowerCase().replace(/[_-]/g, ' ').replace(/[^a-z ]/g, ' ');
    p = p.replace(/\b(the|a|an|big|blue|old|little|small|tall|next|first)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!p) return null;
    if (/^(exit|gate|way out|end|finish)$/.test(p)) return 'exit';
    if (p === 'red door') return 'red_door';
    if (p === 'green door') return 'green_door';
    if (p === 'door') return 'door';
    for (var i = 0; i < data.landmarkIds.length; i++) {
      var id = data.landmarkIds[i];
      if (data.landmarkTypes[id].words.indexOf(p) >= 0) return id;
    }
    return null;
  };
  /** Display name for a landmark type id ('red_door' -> 'red door', 'door' -> 'door', 'exit' -> 'exit'). */
  data.landmarkName = function (type) {
    var t = data.landmarkTypes[type];
    return t ? t.name : String(type || '').replace(/_/g, ' ');
  };

  /* ------------------------------------------------------------------ fact table (closed, spec 5.1) */
  data.items = [
    {
      id: 'key', name: 'a key', noun: 'key',
      look: 'It is small and yellow.',
      place: 'It is behind the red door, next to the blue fountain.',
      junctions: [
        { clue: 'the red door', options: ['red door', 'green door'], correct: 0 },
        { clue: 'next to the blue fountain', options: ['fountain path', 'tree path', 'bridge path'], correct: 0 }
      ]
    },
    {
      id: 'map', name: 'a map', noun: 'map',
      look: 'It is old and brown.',
      place: 'It is opposite the windmill, in front of the big tree.',
      junctions: [
        { clue: 'opposite the windmill', options: ['windmill path', 'scarecrow path'], correct: 0 },
        { clue: 'in front of the big tree', options: ['tree path', 'well path', 'bench path'], correct: 0 }
      ]
    },
    {
      id: 'lamp', name: 'a lamp', noun: 'lamp',
      look: 'It is red and very bright.',
      place: 'It is between the big tree and the well, behind the green door.',
      junctions: [
        { clue: 'between the big tree and the well', options: ['path between the tree and the well', 'scarecrow path', 'windmill path'], correct: 0 },
        { clue: 'behind the green door', options: ['green door', 'red door'], correct: 0 }
      ]
    },
    {
      id: 'bag', name: 'a bag', noun: 'bag',
      look: 'It is big and green.',
      place: 'It is next to the scarecrow, opposite the bench.',
      junctions: [
        { clue: 'next to the scarecrow', options: ['scarecrow path', 'tree path'], correct: 0 },
        { clue: 'opposite the bench', options: ['bench path', 'fountain path', 'bridge path'], correct: 0 }
      ]
    }
  ];
  data.itemIds = data.items.map(function (it) { return it.id; });
  data.FACTS = ['name', 'look', 'place'];
  data.getItem = function (idOrIndex) {
    if (typeof idOrIndex === 'number') return data.items[idOrIndex] || null;
    for (var i = 0; i < data.items.length; i++) if (data.items[i].id === idOrIndex) return data.items[i];
    return null;
  };
  /** The ONLY text Pip may use to give a fact. fact: 'name' | 'look' | 'place'. */
  data.factText = function (itemId, fact) {
    var it = data.getItem(itemId);
    if (!it) return '';
    if (fact === 'name') return 'I need ' + it.name + '.';
    return it[fact] || '';
  };

  /* ------------------------------------------------------------------ Go maps (one per item) */
  function goMap(def) {
    maze.prepare(def);
    var item = data.getItem(def.itemId);
    def.approach = maze.findPath(def, def.start, def.junctions[0].at).slice(1);
    def.junctions.forEach(function (j, ji) {
      var fact = item.junctions[ji];
      j.index = ji; j.clue = fact.clue; j.correct = fact.correct;
      j.branches.forEach(function (b, bi) {
        b.option = bi; b.label = fact.options[bi]; b.correct = bi === fact.correct;
        b.path = maze.findPath(def, j.at, b.end).slice(1);
      });
    });
    return def;
  }
  /* Branch order == option order in the fact table. `landmarks` lists the landmark ids that mark the branch.
   * The correct branch of junction 0 ends at junction 1; the correct branch of junction 1 ends at `pickupFrom`. */
  data.goMaps = {
    key: goMap({
      id: 'go_key', itemId: 'key',
      tiles: [
        '###############',
        '#######.#######',
        '#######.#######',
        '###.###.###.###',
        '###.###.#~#.###',
        '###.........###',
        '#######.#~###.#',
        '#######.#####.#',
        '#######.......#',
        '##########.####',
        '###############'
      ],
      landmarks: [
        { id: 'red_door', type: 'red_door', x: 9, y: 8 }, { id: 'green_door', type: 'green_door', x: 11, y: 8 },
        { id: 'fountain', type: 'fountain', x: 2, y: 3 }, { id: 'tree', type: 'tree', x: 6, y: 1 },
        { id: 'bridge', type: 'bridge', x: 9, y: 5 }
      ],
      start: { x: 10, y: 9, facing: 'N' },
      item: { x: 3, y: 3 }, pickupFrom: { x: 3, y: 3 },
      junctions: [
        { at: { x: 10, y: 8 }, branches: [{ end: { x: 7, y: 5 }, landmarks: ['red_door'] }, { end: { x: 13, y: 6 }, landmarks: ['green_door'] }] },
        { at: { x: 7, y: 5 }, branches: [{ end: { x: 3, y: 3 }, landmarks: ['fountain'] }, { end: { x: 7, y: 1 }, landmarks: ['tree'] }, { end: { x: 11, y: 3 }, landmarks: ['bridge'] }] }
      ]
    }),
    map: goMap({
      id: 'go_map', itemId: 'map',
      tiles: [
        '###############',
        '###############',
        '#######.#######',
        '###.###.###.###',
        '###.###.###.###',
        '###.........###',
        '#.#####.#######',
        '#.#####.#######',
        '#.......#######',
        '####.##########',
        '###############'
      ],
      landmarks: [
        { id: 'windmill', type: 'windmill', x: 8, y: 7 }, { id: 'scarecrow', type: 'scarecrow', x: 2, y: 7 },
        { id: 'tree', type: 'tree', x: 7, y: 1 }, { id: 'well', type: 'well', x: 3, y: 2 }, { id: 'bench', type: 'bench', x: 11, y: 2 }
      ],
      start: { x: 4, y: 9, facing: 'N' },
      item: { x: 7, y: 2 }, pickupFrom: { x: 7, y: 2 },
      junctions: [
        { at: { x: 4, y: 8 }, branches: [{ end: { x: 7, y: 5 }, landmarks: ['windmill'] }, { end: { x: 1, y: 6 }, landmarks: ['scarecrow'] }] },
        { at: { x: 7, y: 5 }, branches: [{ end: { x: 7, y: 2 }, landmarks: ['tree'] }, { end: { x: 3, y: 3 }, landmarks: ['well'] }, { end: { x: 11, y: 3 }, landmarks: ['bench'] }] }
      ]
    }),
    lamp: goMap({
      id: 'go_lamp', itemId: 'lamp',
      tiles: [
        '###############',
        '###.#######.###',
        '###.#######.###',
        '###.........###',
        '#######.#######',
        '#.#####.#####.#',
        '#.#####.#####.#',
        '#.............#',
        '#######.#######',
        '#######.#######',
        '###############'
      ],
      landmarks: [
        { id: 'tree', type: 'tree', x: 6, y: 5 }, { id: 'well', type: 'well', x: 8, y: 5 },
        { id: 'scarecrow', type: 'scarecrow', x: 2, y: 5 }, { id: 'windmill', type: 'windmill', x: 12, y: 5 },
        { id: 'green_door', type: 'green_door', x: 9, y: 3 }, { id: 'red_door', type: 'red_door', x: 5, y: 3 }
      ],
      start: { x: 7, y: 9, facing: 'N' },
      item: { x: 11, y: 1 }, pickupFrom: { x: 11, y: 1 },
      junctions: [
        { at: { x: 7, y: 7 }, branches: [{ end: { x: 7, y: 3 }, landmarks: ['tree', 'well'] }, { end: { x: 1, y: 5 }, landmarks: ['scarecrow'] }, { end: { x: 13, y: 5 }, landmarks: ['windmill'] }] },
        { at: { x: 7, y: 3 }, branches: [{ end: { x: 11, y: 1 }, landmarks: ['green_door'] }, { end: { x: 3, y: 1 }, landmarks: ['red_door'] }] }
      ]
    }),
    bag: goMap({
      id: 'go_bag', itemId: 'bag',
      tiles: [
        '###############',
        '##########.####',
        '#######.......#',
        '#######.#####.#',
        '#######.#####.#',
        '###.........###',
        '###.###.###.###',
        '###.##~.~##.###',
        '#######.#######',
        '#######.#######',
        '###############'
      ],
      landmarks: [
        { id: 'scarecrow', type: 'scarecrow', x: 8, y: 3 }, { id: 'tree', type: 'tree', x: 12, y: 3 },
        { id: 'bench', type: 'bench', x: 10, y: 7 }, { id: 'fountain', type: 'fountain', x: 2, y: 7 },
        { id: 'bridge', type: 'bridge', x: 7, y: 7 }
      ],
      start: { x: 10, y: 1, facing: 'S' },
      item: { x: 12, y: 7 }, pickupFrom: { x: 11, y: 7 },
      junctions: [
        { at: { x: 10, y: 2 }, branches: [{ end: { x: 7, y: 5 }, landmarks: ['scarecrow'] }, { end: { x: 13, y: 4 }, landmarks: ['tree'] }] },
        { at: { x: 7, y: 5 }, branches: [{ end: { x: 11, y: 7 }, landmarks: ['bench'] }, { end: { x: 3, y: 7 }, landmarks: ['fountain'] }, { end: { x: 7, y: 9 }, landmarks: ['bridge'] }] }
      ]
    })
  };
  data.goMap = function (itemIdOrIndex) {
    var it = data.getItem(itemIdOrIndex);
    return it ? data.goMaps[it.id] : null;
  };

  /* ------------------------------------------------------------------ Guide mazes: 2 routes x 2 difficulties */
  function gm(def) { def.kind = 'guide'; return maze.prepare(def); }
  data.routeIds = ['r1', 'r2'];
  data.DIFFICULTIES = ['standard', 'simple'];
  data.guideMazes = {
    r1: {
      /* Pip starts with his back to the viewer: his left is the pupil's left. */
      standard: gm({
        id: 'r1_standard', routeId: 'r1', difficulty: 'standard',
        tiles: [
          '###############',
          '#######........',
          '####.##.##~####',
          '####.##......##',
          '####.##.####.##',
          '#.......####.##',
          '#.##########.##',
          '#....#######.##',
          '#.#############',
          '#.#############',
          '###############'
        ],
        landmarks: [
          { type: 'fountain', x: 1, y: 4 }, { type: 'tree', x: 8, y: 5 }, { type: 'windmill', x: 6, y: 1 },
          { type: 'bridge', x: 10, y: 1 }, { type: 'scarecrow', x: 4, y: 1 }, { type: 'well', x: 12, y: 8 }
        ],
        start: { x: 1, y: 9, facing: 'N' }, exit: { x: 14, y: 1 }
      }),
      simple: gm({
        id: 'r1_simple', routeId: 'r1', difficulty: 'simple',
        tiles: [
          '###############',
          '#######........',
          '#######.##~####',
          '#######...#####',
          '#######.#######',
          '#.......#######',
          '#.#############',
          '#.#############',
          '#.#############',
          '#.#############',
          '###############'
        ],
        landmarks: [
          { type: 'fountain', x: 1, y: 4 }, { type: 'tree', x: 8, y: 5 }, { type: 'windmill', x: 6, y: 1 },
          { type: 'bridge', x: 10, y: 1 }, { type: 'well', x: 10, y: 3 }
        ],
        start: { x: 1, y: 9, facing: 'N' }, exit: { x: 14, y: 1 }
      })
    },
    r2: {
      /* Pip starts facing the viewer: his left is the pupil's right ("My left or your left?"). */
      standard: gm({
        id: 'r2_standard', routeId: 'r2', difficulty: 'standard',
        tiles: [
          '###############',
          '#############.#',
          '##########....#',
          '#############.#',
          '#######.......#',
          '####.##.#######',
          '####.##....####',
          '####.##.##.####',
          '........##.####',
          '###############',
          '###############'
        ],
        landmarks: [
          { type: 'bench', x: 13, y: 5 }, { type: 'red_door', x: 10, y: 4 }, { type: 'scarecrow', x: 6, y: 4 },
          { type: 'tree', x: 7, y: 9 }, { type: 'fountain', x: 11, y: 8 }, { type: 'windmill', x: 4, y: 4 },
          { type: 'well', x: 9, y: 2 }
        ],
        start: { x: 13, y: 1, facing: 'S' }, exit: { x: 0, y: 8 }
      }),
      simple: gm({
        id: 'r2_simple', routeId: 'r2', difficulty: 'simple',
        tiles: [
          '###############',
          '#############.#',
          '#############.#',
          '#############.#',
          '#######.......#',
          '#######.#######',
          '#######...#####',
          '#######.#######',
          '........#######',
          '###############',
          '###############'
        ],
        landmarks: [
          { type: 'bench', x: 13, y: 5 }, { type: 'red_door', x: 10, y: 4 }, { type: 'scarecrow', x: 6, y: 4 },
          { type: 'tree', x: 7, y: 9 }, { type: 'fountain', x: 10, y: 6 }
        ],
        start: { x: 13, y: 1, facing: 'S' }, exit: { x: 0, y: 8 }
      })
    }
  };
  /** route: 0 | 1 | 'r1' | 'r2'; difficulty: 'standard' (default) | 'simple'. */
  data.guideMaze = function (route, difficulty) {
    var id = typeof route === 'number' ? data.routeIds[route] : route;
    var r = data.guideMazes[id];
    return r ? (r[difficulty === 'simple' ? 'simple' : 'standard']) : null;
  };

  /* ------------------------------------------------------------------ warm-up (does NOT use the item facts) */
  function wm(tiles, landmarks, start) {
    return maze.prepare({ id: 'warmup', tiles: tiles, landmarks: landmarks || [], start: start });
  }
  var T_UP = ['#######', '#.....#', '###.###', '###.###', '#######'];
  var T_DOWN = ['#######', '###.###', '###.###', '#.....#', '#######'];
  var CROSS = ['#######', '###.###', '#.....#', '###.###', '###.###', '#######'];
  var LAWN = ['#######', '#,,,,,#', '#,,,,,#', '#,,,,,#', '#######'];
  var LAWN_PATH = ['#######', '#,,,,,#', '#.....#', '#,,,,,#', '#######'];
  var L = [{ x: 2, y: 1 }, { x: 1, y: 1 }], R = [{ x: 4, y: 1 }, { x: 5, y: 1 }];
  var PREPS = ['next to', 'behind', 'in front of', 'between', 'opposite'];
  data.PREPOSITIONS = PREPS;

  /* type 'path': read/hear `instruction`, click one of `options` (each a list of tiles). `approach` = tiles Pip walks first.
   * type 'prep': look at the picture (Pip + landmarks on `map`), pick the word for the gap in `sentence`. */
  data.warmup = [
    { id: 'w_path_1', type: 'path', instruction: 'Turn left at the tree.',
      map: wm(T_UP, [{ type: 'tree', x: 3, y: 0 }], { x: 3, y: 3, facing: 'N' }),
      approach: [{ x: 3, y: 2 }, { x: 3, y: 1 }], options: [{ id: 'left', tiles: L }, { id: 'right', tiles: R }], correct: 0 },
    { id: 'w_prep_1', type: 'prep', sentence: 'Pip is ___ the tree.',
      map: wm(LAWN, [{ type: 'tree', x: 4, y: 2 }]), pip: { x: 3, y: 2, facing: 'S' },
      options: ['next to', 'behind', 'between'], correct: 0 },
    { id: 'w_path_2', type: 'path', instruction: 'Turn right at the fountain.',
      map: wm(T_UP, [{ type: 'fountain', x: 3, y: 0 }], { x: 3, y: 3, facing: 'N' }),
      approach: [{ x: 3, y: 2 }, { x: 3, y: 1 }], options: [{ id: 'left', tiles: L }, { id: 'right', tiles: R }], correct: 1 },
    { id: 'w_prep_2', type: 'prep', sentence: 'Pip is ___ the fountain.',
      map: wm(LAWN, [{ type: 'fountain', x: 3, y: 2 }]), pip: { x: 3, y: 1, facing: 'S' },
      options: ['in front of', 'behind', 'opposite'], correct: 1 },
    { id: 'w_path_3', type: 'path', instruction: 'Go straight. Do not turn.',
      map: wm(CROSS, [], { x: 3, y: 4, facing: 'N' }),
      approach: [{ x: 3, y: 3 }, { x: 3, y: 2 }],
      options: [{ id: 'left', tiles: [{ x: 2, y: 2 }, { x: 1, y: 2 }] }, { id: 'straight', tiles: [{ x: 3, y: 1 }] }, { id: 'right', tiles: [{ x: 4, y: 2 }, { x: 5, y: 2 }] }], correct: 1 },
    { id: 'w_prep_3', type: 'prep', sentence: 'Pip is ___ the windmill.',
      map: wm(LAWN, [{ type: 'windmill', x: 3, y: 1 }]), pip: { x: 3, y: 2, facing: 'S' },
      options: ['behind', 'next to', 'in front of'], correct: 2 },
    { id: 'w_path_4', type: 'path', instruction: 'Take the path next to the windmill.',
      map: wm(T_UP, [{ type: 'windmill', x: 5, y: 2 }, { type: 'scarecrow', x: 1, y: 2 }], { x: 3, y: 3, facing: 'N' }),
      approach: [{ x: 3, y: 2 }, { x: 3, y: 1 }], options: [{ id: 'left', tiles: L }, { id: 'right', tiles: R }], correct: 1 },
    { id: 'w_prep_4', type: 'prep', sentence: 'Pip is ___ the tree and the well.',
      map: wm(LAWN, [{ type: 'tree', x: 2, y: 2 }, { type: 'well', x: 4, y: 2 }]), pip: { x: 3, y: 2, facing: 'S' },
      options: ['between', 'opposite', 'behind'], correct: 0 },
    { id: 'w_path_5', type: 'path', instruction: 'Turn left at the well.',
      note: 'Pip is looking at you. Pip’s left is on your right.',
      map: wm(T_DOWN, [{ type: 'well', x: 3, y: 4 }], { x: 3, y: 1, facing: 'S' }),
      approach: [{ x: 3, y: 2 }, { x: 3, y: 3 }],
      options: [{ id: 'screen-left', tiles: [{ x: 2, y: 3 }, { x: 1, y: 3 }] }, { id: 'screen-right', tiles: [{ x: 4, y: 3 }, { x: 5, y: 3 }] }], correct: 1 },
    { id: 'w_prep_5', type: 'prep', sentence: 'Pip is ___ the scarecrow.',
      map: wm(LAWN_PATH, [{ type: 'scarecrow', x: 3, y: 1 }]), pip: { x: 3, y: 3, facing: 'N' },
      options: ['next to', 'opposite', 'between'], correct: 1 },
    { id: 'w_path_6', type: 'path', instruction: 'Go through the red door.',
      map: wm(T_UP, [{ type: 'green_door', x: 2, y: 1 }, { type: 'red_door', x: 4, y: 1 }], { x: 3, y: 3, facing: 'N' }),
      approach: [{ x: 3, y: 2 }, { x: 3, y: 1 }], options: [{ id: 'left', tiles: L }, { id: 'right', tiles: R }], correct: 1 },
    { id: 'w_prep_6', type: 'prep', sentence: 'Pip is ___ the bench.',
      map: wm(LAWN, [{ type: 'bench', x: 3, y: 2 }]), pip: { x: 3, y: 1, facing: 'S' },
      options: ['behind', 'next to', 'between'], correct: 0 }
  ];
  data.WARMUP_COUNT = 10;
  /** The 10 questions used in a session (the first 10; the last two are spares). */
  data.warmupSet = function () { return data.warmup.slice(0, data.WARMUP_COUNT); };

  /* ------------------------------------------------------------------ hint ladder (spec 4.2.7) */
  /** Level 1 = general pointer; level 2 = sentence starter (using level 2 marks that fact `assisted`). */
  data.hints = {
    name:  { 1: 'Ask what I need.',          2: 'What do you …?' },
    look:  { 1: 'Ask what it looks like.',   2: 'What does it …?' },
    place: { 1: 'Ask about the place.',      2: 'Where is …?' }
  };
  data.guideHints = {
    1: 'Tell me: go straight, turn left, turn right or stop.',
    2: 'Go straight until the … Then turn …'
  };

  /* ------------------------------------------------------------------ canned lines (never written by the model) */
  data.text = {
    askOpen: 'I need something. Ask me!',
    askNext: 'I need one more thing. Ask me!',
    askAllFacts: 'Now you know it all. Let’s go and find it!',
    sayAgain: 'Sorry, can you say that again?',
    clarify: {
      place: 'Do you mean where it is?',
      look: 'Do you mean what it looks like?',
      name: 'Do you mean what I need?',
      generic: 'Sorry, I don’t understand. What do you want to know?'
    },
    redirect: 'I am lost, so please ask me about the thing I need.',
    goIntro: 'Which way? Click a path.',
    deadEnd: 'Dead end. Go back and ask Pip again.',
    gotItem: 'I got it! Thank you!',
    guideOpen: 'I can’t see the way out. Tell me where to go!',
    wall: 'There is a wall.',
    leftOrRight: 'Left or right?',
    whose: function (dir) { return 'My ' + dir + ' or your ' + dir + '?'; },
    whoseNote: function (dir) { return 'OK! Your ' + dir + ' is my ' + (dir === 'left' ? 'right' : 'left') + ' now.'; },
    cantSee: function (thing) {
      thing = String(thing || 'that').replace(/^(the|a|an)\s+/i, '');
      return 'I can’t see ' + (/^[aeiou]/i.test(thing) ? 'an ' : 'a ') + thing + '. What can I see?';
    },
    guideUnclear: 'Sorry, I don’t understand. Where do I go?',
    guideOneWord: function (word) { return word.charAt(0).toUpperCase() + word.slice(1) + '? Tell me more, please.'; },
    alreadyThere: 'I am here already.',
    exit: 'I am out! Thank you!',
    story: [
      'This is Pip. Pip is a little explorer.',
      'Pip is lost in a big green maze!',
      'Pip needs four things to get out.',
      'Ask Pip good questions. Then help Pip find the way.'
    ]
  };

  /* ------------------------------------------------------------------ words used by validators */
  /** Every word that could leak a fact (item nouns, landmark words, look adjectives, place prepositions). */
  data.factWords = (function () {
    var set = {};
    function add(s) { String(s).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).forEach(function (w) { if (w) set[w] = true; }); }
    data.items.forEach(function (it) { add(it.noun); add(it.look); add(it.place); });
    data.landmarkIds.forEach(function (id) { data.landmarkTypes[id].words.forEach(add); });
    ['it', 'is', 'and', 'the', 'very', 'to', 'of', 'in', 'a'].forEach(function (w) { delete set[w]; });
    return Object.keys(set).sort();
  })();
})(typeof window !== 'undefined' ? window : globalThis);
