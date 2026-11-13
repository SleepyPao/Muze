/* Maze Rescue - closed game data: things, Go maps, Guide mazes, warm-up questions, hints, canned lines.
 * Pure (no DOM). Requires core.js and maze.js. Everything Pip may ever "know" is in this file.
 * Each game is different: a per-game seed picks the things, their looks, the Go maps, the warm-up and the Guide
 * maze variants (see "the game's own content" below). Every sentence that can come out is still from this file.
 * All pupil-facing text is English at about A2 level. */
(function (root) {
  'use strict';
  var MR = root.MR = root.MR || {};
  var maze = MR.maze;
  var data = MR.data = {};

  /* ------------------------------------------------------------------ landmarks */
  /** Closed landmark vocabulary. solid:false = Pip walks through it (it sits ON a path tile);
   *  solid:true = it stands on a lawn tile beside the path.
   *  `name` is the ONE name of the landmark: Pip's sentences (facts, warm-up, "I can't see a ..."), the map legend
   *  and the hints all use it (data.landmarkName). `words` are the bare nouns a pupil may say instead: "the tree",
   *  "the big tree", "fountain" and "blue fountain" all mean the same landmark (data.landmarkFromWords). */
  data.landmarkTypes = {
    fountain:   { name: 'blue fountain', solid: true,  words: ['fountain'] },
    tree:       { name: 'big tree',      solid: true,  words: ['tree'] },
    bridge:     { name: 'bridge',        solid: false, words: ['bridge'] },
    red_door:   { name: 'red door',      solid: false, words: ['red door'] },
    green_door: { name: 'green door',    solid: false, words: ['green door'] },
    windmill:   { name: 'windmill',      solid: true,  words: ['windmill', 'mill'] },
    scarecrow:  { name: 'scarecrow',     solid: true,  words: ['scarecrow'] },
    well:       { name: 'well',          solid: true,  words: ['well'] },
    bench:      { name: 'bench',         solid: true,  words: ['bench', 'seat'] },
    /* real-world places (the University Station route only; never shuffled into the mazes) */
    station:    { name: 'station',       solid: true,  words: ['station', 'mtr station', 'mtr', 'train station', 'university station'] },
    bus_stop:   { name: 'bus stop',      solid: true,  words: ['bus stop'] },
    shop:       { name: 'shop',          solid: true,  words: ['shop', 'store'] },
    library:    { name: 'library',       solid: true,  words: ['library'] }
  };
  data.landmarkIds = Object.keys(data.landmarkTypes);
  data.landmarkIds.forEach(function (id) { data.landmarkTypes[id].phrase = 'the ' + data.landmarkTypes[id].name; });
  /** The gate at the end of a Guide maze is called "the way out" everywhere (legend, hints, Pip). */
  data.EXIT_NAME = 'way out';

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
  /** THE name of a landmark type id, the same in Pip's lines, the legend and the hints:
   *  'tree' -> 'big tree', 'fountain' -> 'blue fountain', 'red_door' -> 'red door', 'door' -> 'door', 'exit' -> 'way out'. */
  data.landmarkName = function (type) {
    var t = data.landmarkTypes[type];
    if (t) return t.name;
    if (type === 'exit') return data.EXIT_NAME;
    return String(type || '').replace(/_/g, ' ');
  };

  data.SOLID_TYPES = ['fountain', 'tree', 'windmill', 'scarecrow', 'well', 'bench'];
  data.DOOR_TYPES = ['red_door', 'green_door'];
  /* landmarks that are low enough that Pip stays visible when he stands just above (behind) them */
  var LOW_TYPES = ['fountain', 'well', 'bench'];
  data.LOW_TYPES = LOW_TYPES;
  /* landmarks no wider than a tile (the tree and the windmill reach about half a tile to each side) */
  var NARROW_TYPES = LOW_TYPES.concat(['scarecrow']);
  data.NARROW_TYPES = NARROW_TYPES;
  /**
   * What a solid landmark spot allows, so that Pip is never hidden behind a landmark:
   *   'low'    a path tile just above it: a tall landmark (tree, windmill, scarecrow) would be drawn over Pip there
   *   'narrow' a path tile diagonally above it: the tree's leaves / the windmill's sails would cover half of Pip
   *   null     anything
   * tiles = the map's rows ('.' = path).
   */
  function spotNeed(tiles, x, y) {
    var up = tiles[y - 1] || '';
    if (up.charAt(x) === '.') return 'low';
    if (up.charAt(x - 1) === '.' || up.charAt(x + 1) === '.') return 'narrow';
    return null;
  }
  function allows(need, type) {
    return need === 'low' ? LOW_TYPES.indexOf(type) >= 0 : (need === 'narrow' ? NARROW_TYPES.indexOf(type) >= 0 : true);
  }
  /** Solid landmark types for a list of spots (each {need}) from a shuffled list of types: 'low' spots are filled first,
   *  then 'narrow' spots, then the rest, each time with the first type in the shuffled order that the spot allows.
   *  (Every map has few enough 'low' / 'narrow' spots for this to work; a unit test checks it for many seeds.) */
  function fitSolids(spots, shuffled) {
    var out = [], used = {};
    ['low', 'narrow', null].forEach(function (pass) {
      spots.forEach(function (sp, i) {
        if (sp.need !== pass) return;
        for (var k = 0; k < shuffled.length; k++) {
          if (!used[k] && allows(sp.need, shuffled[k])) { used[k] = true; out[i] = shuffled[k]; return; }
        }
        for (k = 0; k < shuffled.length; k++) if (!used[k]) { used[k] = true; out[i] = shuffled[k]; return; }   /* never needed */
      });
    });
    return out;
  }
  /** True when every type of `solids` is allowed in its spot. */
  function solidsFit(spots, solids) {
    for (var i = 0; i < spots.length; i++) if (!allows(spots[i].need, solids[i])) return false;
    return true;
  }
  /* The same promise, checked by geometry (unit test over many seeds; the e2e test compares this table with the
   * real pictures of js/sprites.js): the solid part of each landmark picture, in pixels relative to the top left
   * corner of its own tile (a tile is 16 px): [left, top, right, bottom], over all animation frames and both door
   * directions. Pip's picture on his tile is PIP_BOX. */
  data.TILE_PX = 16;
  data.PIP_BOX = [0, -6, 15, 13];
  data.SPRITE_BOX = {
    fountain: [-2, -7, 17, 14], tree: [-6, -16, 22, 15], bridge: [0, -4, 15, 15], red_door: [-2, -14, 17, 17],
    green_door: [-2, -14, 17, 17], windmill: [-7, -25, 23, 14], scarecrow: [-3, -14, 18, 15], well: [-1, -10, 17, 14],
    bench: [0, 3, 15, 14], exit: [-1, -14, 16, 15],
    station: [-4, -16, 19, 15], bus_stop: [1, -12, 14, 15], shop: [-3, -12, 18, 15], library: [-5, -18, 20, 15]
  };
  /** At most this part of Pip's picture may be behind a landmark. The low ones (fountain, well, bench) hide his
   *  feet at most (the well: 8 of his 20 rows = 0.4); a scarecrow just below him would hide 0.6, a tree or windmill more. */
  data.MAX_HIDDEN = 0.4;
  /**
   * How much of Pip (0..1) is hidden when he stands on tile (x, y) of a map: the largest part of his picture that
   * is behind ONE landmark picture drawn in front of him. Rows are drawn top to bottom, so only a landmark on a
   * LOWER row is in front of Pip (the bridge is part of the ground and hides nothing).
   * @param {object} map  @param {number} x  @param {number} y  @param {{showExit?:boolean}} [o]
   */
  data.pipHidden = function (map, x, y, o) {
    var T = data.TILE_PX, P = data.PIP_BOX, worst = 0;
    var list = (map.landmarks || []).slice();
    if (map.exit && !(o && o.showExit === false)) list.push({ type: 'exit', x: map.exit.x, y: map.exit.y });
    var area = (P[2] - P[0] + 1) * (P[3] - P[1] + 1);
    list.forEach(function (lm) {
      var B = data.SPRITE_BOX[lm.type];
      if (!B || lm.type === 'bridge' || lm.y <= y) return;
      var dx = (lm.x - x) * T, dy = (lm.y - y) * T;
      var w = Math.min(P[2], B[2] + dx) - Math.max(P[0], B[0] + dx) + 1;
      var h = Math.min(P[3], B[3] + dy) - Math.max(P[1], B[1] + dy) + 1;
      if (w > 0 && h > 0) worst = Math.max(worst, (w * h) / area);
    });
    return worst;
  };
  function phrase(type) { return data.landmarkTypes[type].phrase; }
  function copyXY(p) { return p ? { x: p.x, y: p.y } : null; }

  /* ------------------------------------------------------------------ seeded random numbers */
  /** Small seeded PRNG (mulberry32). The same seed always gives the same numbers, in the browser and in Node.
   *  @returns {{next():number, int(n):number, pick(arr), shuffle(arr):Array, bool():boolean}} */
  data.rng = function (seed) {
    var a = seed >>> 0;
    function next() {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      int: function (n) { return Math.floor(next() * n); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      shuffle: function (arr) {
        var out = arr.slice();
        for (var i = out.length - 1; i > 0; i--) { var j = Math.floor(next() * (i + 1)), t = out[i]; out[i] = out[j]; out[j] = t; }
        return out;
      },
      bool: function () { return next() < 0.5; }
    };
  };
  /** A fresh random 32-bit seed for a new game. */
  data.newSeed = function () { return Math.floor(Math.random() * 4294967296) >>> 0; };
  /** A stable 32-bit seed from any text (e.g. a class number for example evidence). */
  data.seedFromText = function (s) {
    var h = 2166136261;
    s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };

  /* ------------------------------------------------------------------ the things Pip may need (closed pool) */
  /** The seven kinds of fact Pip can give about a thing. A thing's card has THREE of them: 'place' always (the Go
   *  stage needs it) + two of the other six, chosen by the game's seed (data.slotsOf). So the pupil has to ask
   *  different questions for different things.
   *    name   What do you need?        -> "I need a key."
   *    colour What colour is it?       -> "It is yellow."
   *    size   Is it big or small?      -> "It is small."
   *    whose  Whose is it?             -> "It is my grandma’s."
   *    why    Why do you need it?      -> "I need it to see at night."
   *    when   When did you lose it?    -> "I lost it this morning."
   *    place  Where is it?             -> "It is behind the red door, next to the well."
   *  (Logs written before this had 'look' = size + colour in one sentence; MR.log still counts those.) */
  data.FACTS = ['name', 'colour', 'size', 'whose', 'why', 'when', 'place'];
  data.EXTRA_FACTS = ['name', 'colour', 'size', 'whose', 'why', 'when'];   /* a card has two of these + 'place' */
  data.SLOTS_PER_ITEM = 3;
  /** What the card calls each kind of fact: it tells the pupil what to find out. */
  data.FACT_LABELS = { name: 'What', colour: 'Colour', size: 'Size', whose: 'Whose', why: 'Why', when: 'When', place: 'Where' };
  data.ITEM_COUNT = 4;
  /** Whose thing it is: "It is my mum’s." */
  data.OWNERS = ['mum', 'dad', 'sister', 'brother', 'grandma', 'grandpa', 'friend', 'teacher'];
  /** When Pip lost it: "I lost it this morning." */
  data.WHENS = ['this morning', 'today', 'yesterday', 'last night', 'on Monday', 'last week'];
  data.SIZES = ['small', 'big'];
  data.COLOURS = ['red', 'blue', 'green', 'yellow', 'brown', 'pink', 'purple', 'orange'];
  /** Colours a child could mix up on a small picture. One game never uses both colours of a pair, so
   *  "It is small and orange." can only be one of the four things. */
  data.CONFUSABLE_COLOURS = [['yellow', 'orange'], ['red', 'orange'], ['brown', 'orange'], ['red', 'pink'], ['pink', 'purple'], ['yellow', 'brown']];
  function coloursClash(a, b) {
    return data.CONFUSABLE_COLOURS.some(function (p) { return (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a); });
  }
  data.coloursClash = coloursClash;
  /** The first n colours of a shuffled list that do not clash with one another (there are always at least four). */
  function distinctColours(shuffled, n) {
    var out = [];
    for (var i = 0; i < shuffled.length && out.length < n; i++) {
      var c = shuffled[i];
      if (!out.some(function (o) { return coloursClash(o, c); })) out.push(c);
    }
    return out;
  }
  /** Eight common things that are easy to draw. Each game uses four of them. `colour` = the colour when no game is on. */
  data.POOL = [
    { id: 'key',  noun: 'key',  name: 'a key',  sizes: ['small'],        colour: 'yellow', why: 'I need it to open the gate.' },
    { id: 'map',  noun: 'map',  name: 'a map',  sizes: ['small', 'big'], colour: 'brown',  why: 'I need it to find my way home.' },
    { id: 'lamp', noun: 'lamp', name: 'a lamp', sizes: ['small', 'big'], colour: 'red',    why: 'I need it to see at night.' },
    { id: 'bag',  noun: 'bag',  name: 'a bag',  sizes: ['small', 'big'], colour: 'green',  why: 'I need it to carry my things.' },
    { id: 'book', noun: 'book', name: 'a book', sizes: ['small', 'big'], colour: 'blue',   why: 'I need it to read a story.' },
    { id: 'ball', noun: 'ball', name: 'a ball', sizes: ['small', 'big'], colour: 'orange', why: 'I need it to play a game.' },
    { id: 'hat',  noun: 'hat',  name: 'a hat',  sizes: ['small', 'big'], colour: 'purple', why: 'I need it because the sun is hot.' },
    { id: 'cup',  noun: 'cup',  name: 'a cup',  sizes: ['small', 'big'], colour: 'pink',   why: 'I need it to drink water.' }
  ];
  data.POOL.forEach(function (p) { p.colours = data.COLOURS; });
  data.poolIds = data.POOL.map(function (p) { return p.id; });
  function poolItem(id) {
    for (var i = 0; i < data.POOL.length; i++) if (data.POOL[i].id === id) return data.POOL[i];
    return null;
  }
  /* The ONE sentence for each kind of fact (every possible sentence is listed by data.allFactTexts for the voice). */
  function nameText(p) { return 'I need ' + p.name + '.'; }
  function colourText(colour) { return 'It is ' + colour + '.'; }
  function sizeText(size) { return 'It is ' + size + '.'; }
  function whoseText(owner) { return 'It is my ' + owner + '’s.'; }
  function whenText(when) { return 'I lost it ' + when + '.'; }
  /** Card order of fact kinds: data.FACTS order, so 'place' is always the last slot. */
  function sortSlots(list) {
    return list.slice().sort(function (a, b) { return data.FACTS.indexOf(a) - data.FACTS.indexOf(b); });
  }
  /**
   * The two extra fact kinds (besides 'place') of each of the four things of a game: 8 slots = all six kinds at
   * least once + two repeats, never the same pair on two things, in a random thing order.
   * @returns {string[][]} four pairs, each sorted in data.FACTS order
   */
  function pickSlotPairs(r) {
    var six = r.shuffle(data.EXTRA_FACTS);
    var pairs = [[six[0], six[1]], [six[2], six[3]], [six[4], six[5]]].map(sortSlots);
    var all = [];
    for (var i = 0; i < 6; i++) for (var j = i + 1; j < 6; j++) all.push([data.EXTRA_FACTS[i], data.EXTRA_FACTS[j]]);
    var free = all.filter(function (p) { return !pairs.some(function (q) { return q[0] === p[0] && q[1] === p[1]; }); });
    pairs.push(r.pick(free));
    return r.shuffle(pairs);
  }
  data.pickSlotPairs = pickSlotPairs;

  /* ------------------------------------------------------------------ Go map templates
   * Four hand-made map shapes. Each has 2 junctions. A branch has landmark SLOTS:
   *   kind 'door'  : a door on a path tile (red / green door)
   *   kind 'solid' : a solid landmark on the lawn beside the branch (fountain, tree, windmill, scarecrow, well, bench)
   *   kind 'bridge': the bridge over water (always the bridge)
   * Junction 1's correct branch is fixed by the shape (it leads to junction 2). At junction 2 every branch with an
   * `item` spot may hold the thing; the place sentence uses `prep` and is TRUE for whichever branch is chosen:
   *   'next to'     the landmark touches the thing
   *   'in front of' the thing is just below (nearer the viewer than) the landmark
   *   'opposite'    landmark - path - thing in one line (across the path)
   *   'behind'      the door is on the way, the thing is past it
   *   'between'     (junction 1 only) the branch runs between the two landmarks */
  var TEMPLATES = {
    A: {
      id: 'A',
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
      start: { x: 10, y: 9, facing: 'N' },
      j: [
        { at: { x: 10, y: 8 }, prep: 'behind', correct: 0, branches: [
          { end: { x: 7, y: 5 }, slots: [{ x: 9, y: 8, kind: 'door' }] },
          { end: { x: 13, y: 6 }, slots: [{ x: 11, y: 8, kind: 'door' }] }] },
        { at: { x: 7, y: 5 }, prep: 'next to', branches: [
          { end: { x: 3, y: 3 }, slots: [{ x: 2, y: 3, kind: 'solid' }], item: { x: 3, y: 3 } },
          { end: { x: 7, y: 1 }, slots: [{ x: 6, y: 1, kind: 'solid' }], item: { x: 7, y: 1 } },
          { end: { x: 11, y: 3 }, slots: [{ x: 9, y: 5, kind: 'bridge' }] }] }
      ]
    },
    B: {
      id: 'B',
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
      start: { x: 4, y: 9, facing: 'N' },
      j: [
        { at: { x: 4, y: 8 }, prep: 'opposite', correct: 0, branches: [
          { end: { x: 7, y: 5 }, slots: [{ x: 8, y: 7, kind: 'solid' }] },
          { end: { x: 1, y: 6 }, slots: [{ x: 2, y: 7, kind: 'solid' }] }] },
        { at: { x: 7, y: 5 }, prep: 'in front of', branches: [
          { end: { x: 7, y: 2 }, slots: [{ x: 7, y: 1, kind: 'solid' }], item: { x: 7, y: 2 } },
          { end: { x: 3, y: 3 }, slots: [{ x: 3, y: 2, kind: 'solid' }], item: { x: 3, y: 3 } },
          { end: { x: 11, y: 3 }, slots: [{ x: 11, y: 2, kind: 'solid' }], item: { x: 11, y: 3 } }] }
      ]
    },
    C: {
      id: 'C',
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
      start: { x: 7, y: 9, facing: 'N' },
      j: [
        { at: { x: 7, y: 7 }, prep: 'between', correct: 0, branches: [
          { end: { x: 7, y: 3 }, slots: [{ x: 6, y: 5, kind: 'solid' }, { x: 8, y: 5, kind: 'solid' }] },
          { end: { x: 1, y: 5 }, slots: [{ x: 2, y: 5, kind: 'solid' }] },
          { end: { x: 13, y: 5 }, slots: [{ x: 12, y: 5, kind: 'solid' }] }] },
        { at: { x: 7, y: 3 }, prep: 'behind', branches: [
          { end: { x: 11, y: 1 }, slots: [{ x: 9, y: 3, kind: 'door' }], item: { x: 11, y: 1 } },
          { end: { x: 3, y: 1 }, slots: [{ x: 5, y: 3, kind: 'door' }], item: { x: 3, y: 1 } }] }
      ]
    },
    D: {
      id: 'D',
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
      start: { x: 10, y: 1, facing: 'S' },
      j: [
        { at: { x: 10, y: 2 }, prep: 'next to', correct: 0, branches: [
          { end: { x: 7, y: 5 }, slots: [{ x: 8, y: 3, kind: 'solid' }] },
          { end: { x: 13, y: 4 }, slots: [{ x: 12, y: 3, kind: 'solid' }] }] },
        { at: { x: 7, y: 5 }, prep: 'opposite', branches: [
          { end: { x: 11, y: 7 }, slots: [{ x: 10, y: 7, kind: 'solid' }], item: { x: 12, y: 7 } },
          { end: { x: 3, y: 7 }, slots: [{ x: 2, y: 7, kind: 'solid' }], item: { x: 4, y: 7 } },
          { end: { x: 7, y: 9 }, slots: [{ x: 7, y: 7, kind: 'bridge' }] }] }
      ]
    }
  };
  data.TEMPLATE_IDS = ['A', 'B', 'C', 'D'];
  data.goTemplates = TEMPLATES;
  function slotCount(tpl, kind) {
    var n = 0;
    tpl.j.forEach(function (J) { J.branches.forEach(function (B) { B.slots.forEach(function (s) { if (s.kind === kind) n++; }); }); });
    return n;
  }
  /** The solid slots of a template in slot order, each {x, y, low}. */
  function solidSpots(tpl) {
    var out = [];
    tpl.j.forEach(function (J) { J.branches.forEach(function (B) { B.slots.forEach(function (s) {
      if (s.kind === 'solid') out.push({ x: s.x, y: s.y, need: spotNeed(tpl.tiles, s.x, s.y) });
    }); }); });
    return out;
  }
  /** Branch indexes of junction 2 that can hold the thing. */
  function winnable(tpl) {
    var out = [];
    tpl.j[1].branches.forEach(function (B, i) { if (B.item) out.push(i); });
    return out;
  }
  /** choice {doors:[type...], solids:[type...]} -> landmark types per junction, per branch, per slot (template order). */
  function assignTypes(tpl, choice) {
    var di = 0, si = 0;
    return tpl.j.map(function (J) {
      return J.branches.map(function (B) {
        return B.slots.map(function (s) {
          if (s.kind === 'door') return choice.doors[di++];
          if (s.kind === 'solid') return choice.solids[si++];
          return 'bridge';
        });
      });
    });
  }
  function clause(prep, types) {
    if (prep === 'between') return 'between ' + phrase(types[0]) + ' and ' + phrase(types[1]);
    return prep + ' ' + phrase(types[0]);
  }
  function branchLabel(types) {
    if (types.length > 1) return 'path between the ' + data.landmarkName(types[0]) + ' and the ' + data.landmarkName(types[1]);
    return /_door$/.test(types[0]) ? data.landmarkName(types[0]) : data.landmarkName(types[0]) + ' path';
  }
  function placeText(tpl, types, win) {
    return 'It is ' + clause(tpl.j[0].prep, types[0][tpl.j[0].correct]) + ', ' + clause(tpl.j[1].prep, types[1][win]) + '.';
  }

  /** Build one thing + its Go map from a template.
   *  look: {size, colour, owner, when, extra:[two fact kinds]}; choice: {doors, solids, win}. Returns {item, map}. */
  function buildThing(p, look, tpl, choice) {
    var types = assignTypes(tpl, choice), win = choice.win;
    var correct = [tpl.j[0].correct, win];
    var place = placeText(tpl, types, win);
    var item = {
      id: p.id, noun: p.noun, name: p.name,
      size: look.size, colour: look.colour, owner: look.owner, when: look.when,
      /* the three kinds of fact on this thing's card (what the pupil has to ask), 'place' last */
      slots: sortSlots(look.extra.concat(['place'])),
      /* the closed fact table of this thing: one canonical sentence per kind */
      facts: { name: nameText(p), colour: colourText(look.colour), size: sizeText(look.size), whose: whoseText(look.owner),
        why: p.why, when: whenText(look.when), place: place },
      place: place,
      template: tpl.id,
      junctions: tpl.j.map(function (J, ji) {
        return { clue: clause(J.prep, types[ji][correct[ji]]), options: types[ji].map(branchLabel), correct: correct[ji] };
      })
    };
    var lms = [];
    tpl.j.forEach(function (J, ji) {
      J.branches.forEach(function (B, bi) {
        B.slots.forEach(function (s, si) { var t = types[ji][bi][si]; lms.push({ id: t, type: t, x: s.x, y: s.y }); });
      });
    });
    var wb = tpl.j[1].branches[win];
    var def = {
      id: 'go_' + p.id, itemId: p.id, template: tpl.id,
      tiles: tpl.tiles.slice(), landmarks: lms,
      start: { x: tpl.start.x, y: tpl.start.y, facing: tpl.start.facing },
      item: copyXY(wb.item), pickupFrom: copyXY(wb.end),
      junctions: tpl.j.map(function (J, ji) {
        return { at: copyXY(J.at), branches: J.branches.map(function (B, bi) { return { end: copyXY(B.end), landmarks: types[ji][bi].slice() }; }) };
      })
    };
    return { item: item, map: finishGoMap(def, item) };
  }
  /* Branch order == option order in the fact table. `landmarks` lists the landmark ids that mark the branch.
   * The correct branch of junction 0 ends at junction 1; the correct branch of junction 1 ends at `pickupFrom`. */
  function finishGoMap(def, item) {
    maze.prepare(def);
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

  /* ------------------------------------------------------------------ the classic game (no seed)
   * Used for a game saved before games were random (it has no seed) and as the default before a game starts.
   * These are the original four things, word for word. */
  var CLASSIC = [
    { id: 'key', tpl: 'A', size: 'small', colour: 'yellow', owner: 'grandpa', when: 'this morning', extra: ['name', 'colour'],
      choice: { doors: ['red_door', 'green_door'], solids: ['fountain', 'tree'], win: 0 } },
    { id: 'map', tpl: 'B', size: 'big', colour: 'brown', owner: 'teacher', when: 'yesterday', extra: ['size', 'whose'],
      choice: { doors: [], solids: ['windmill', 'scarecrow', 'tree', 'well', 'bench'], win: 0 } },
    { id: 'lamp', tpl: 'C', size: 'small', colour: 'red', owner: 'grandma', when: 'last night', extra: ['why', 'when'],
      choice: { doors: ['green_door', 'red_door'], solids: ['tree', 'well', 'scarecrow', 'windmill'], win: 0 } },
    { id: 'bag', tpl: 'D', size: 'big', colour: 'green', owner: 'mum', when: 'on Monday', extra: ['name', 'whose'],
      choice: { doors: [], solids: ['scarecrow', 'tree', 'bench', 'fountain'], win: 0 } }
  ];
  function classicContent() {
    var items = [], goMaps = {};
    CLASSIC.forEach(function (c) {
      var b = buildThing(poolItem(c.id), c, TEMPLATES[c.tpl], c.choice);
      items.push(b.item); goMaps[c.id] = b.map;
    });
    return { seed: null, items: items, goMaps: goMaps, guide: null, warmup: null };
  }

  /* ------------------------------------------------------------------ Guide mazes: 2 routes x 2 difficulties */
  function gm(def) { def.kind = 'guide'; return maze.prepare(def); }
  data.routeIds = ['r1', 'r2', 'r3', 'r4'];
  /** r3 + r4 are the last level, in a real place: a simple street map near University Station (MTR). Pip has an exam
   *  today. r3: from the station to the library, to get the book "Cute Gordon". r4: back to the station before the
   *  train leaves (`timed`: a clock runs while it is the pupil's turn; MR.data.trainSeconds).
   *  Both are the same in every game (`fixed`), drawn as streets and buildings (`theme: 'city'`), and the goal is a
   *  real place (`goal`) instead of the garden gate (`noGate`: the exit tile is the street in front of that place). */
  data.ROUTE_TITLES = { r1: 'Way out 1', r2: 'Way out 2', r3: 'To the library', r4: 'Back to the station' };
  data.BOOK_TITLE = 'Cute Gordon';
  /** Seconds on the train clock (r4). They only count while it is the pupil's turn (not while Pip talks or walks,
   *  or the AI thinks). Each missed train gives TRAIN_EXTRA more seconds for the next try. */
  data.TRAIN_SECONDS = { standard: 240, simple: 300 };
  data.TRAIN_EXTRA = 60;
  data.trainSeconds = function (difficulty, tries) {
    return (data.TRAIN_SECONDS[difficulty === 'simple' ? 'simple' : 'standard'] || 240) + data.TRAIN_EXTRA * (tries || 0);
  };
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
          { type: 'tree', x: 1, y: 4 }, { type: 'fountain', x: 8, y: 5 }, { type: 'windmill', x: 6, y: 1 },
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
          { type: 'tree', x: 1, y: 4 }, { type: 'fountain', x: 8, y: 5 }, { type: 'windmill', x: 6, y: 1 },
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
          { type: 'bench', x: 13, y: 5 }, { type: 'red_door', x: 10, y: 4 }, { type: 'tree', x: 6, y: 4 },
          { type: 'fountain', x: 7, y: 9 }, { type: 'scarecrow', x: 11, y: 8 }, { type: 'windmill', x: 4, y: 4 },
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
          { type: 'bench', x: 13, y: 5 }, { type: 'red_door', x: 10, y: 4 }, { type: 'tree', x: 6, y: 4 },
          { type: 'fountain', x: 7, y: 9 }, { type: 'scarecrow', x: 10, y: 6 }
        ],
        start: { x: 13, y: 1, facing: 'S' }, exit: { x: 0, y: 8 }
      })
    }
  };

  /* Pip has just come out of the station (it stands behind the start tile) and wants to go to the library.
   * Every landmark stands ABOVE a street, so nothing ever hides Pip. A corner comes at the end of each street, so
   * "go straight" works, and "go straight until the bus stop" names the same corner in words. Pip walks this map both
   * ways (r3 there, r4 back): a dead end only ever branches off the SIDE of a street (the lane below the tree), never
   * straight on from a corner, or "go straight" would take Pip past the corner into it on the way back. */
  var CITY_LANDMARKS = [
    { type: 'station', x: 1, y: 7 }, { type: 'shop', x: 3, y: 7 }, { type: 'bus_stop', x: 5, y: 4 }, { type: 'tree', x: 7, y: 4 },
    { type: 'library', x: 13, y: 1 }, { type: 'fountain', x: 11, y: 1 },  /* the fountain: what Pip sees first on the way back */
    { type: 'bench', x: 10, y: 5 }                                          /* the corner below the library street */
  ];
  data.guideMazes.r3 = {
    standard: gm({
      id: 'r3_standard', routeId: 'r3', difficulty: 'standard', fixed: true, theme: 'city', noGate: true, goal: 'library',
      tiles: [
        '###############',
        '###############',
        '#########.....#',
        '#########.#####',
        '#########.#####',
        '#####.....#####',
        '#####.#.#######',
        '#####.#.#######',
        '#.....#########',
        '###############',
        '###############'
      ],
      landmarks: CITY_LANDMARKS.slice(),
      start: { x: 1, y: 8, facing: 'E' }, exit: { x: 13, y: 2 }
    }),
    simple: gm({
      id: 'r3_simple', routeId: 'r3', difficulty: 'simple', fixed: true, theme: 'city', noGate: true, goal: 'library',
      tiles: [
        '###############',
        '###############',
        '#########.....#',
        '#########.#####',
        '#########.#####',
        '#####.....#####',
        '#####.#########',
        '#####.#########',
        '#.....#########',
        '###############',
        '###############'
      ],
      landmarks: CITY_LANDMARKS.slice(),
      start: { x: 1, y: 8, facing: 'E' }, exit: { x: 13, y: 2 }
    })
  };
  /* The way back: the same streets. Pip comes out of the library facing west; the goal is the street in front of
   * the station, where Pip started r3. */
  data.guideMazes.r4 = {
    standard: gm({
      id: 'r4_standard', routeId: 'r4', difficulty: 'standard', fixed: true, theme: 'city', noGate: true, goal: 'station', timed: true,
      tiles: data.guideMazes.r3.standard.tiles.slice(),
      landmarks: CITY_LANDMARKS.slice(),
      start: { x: 13, y: 2, facing: 'W' }, exit: { x: 1, y: 8 }
    }),
    simple: gm({
      id: 'r4_simple', routeId: 'r4', difficulty: 'simple', fixed: true, theme: 'city', noGate: true, goal: 'station', timed: true,
      tiles: data.guideMazes.r3.simple.tiles.slice(),
      landmarks: CITY_LANDMARKS.slice(),
      start: { x: 13, y: 2, facing: 'W' }, exit: { x: 1, y: 8 }
    })
  };

  function baseGuideMaze(route, difficulty) {
    var id = typeof route === 'number' ? data.routeIds[route] : route;
    var r = data.guideMazes[id];
    return r ? (r[difficulty === 'simple' ? 'simple' : 'standard']) : null;
  }
  function solidCount(mz) {
    return mz.landmarks.filter(function (lm) { return data.landmarkTypes[lm.type] && data.landmarkTypes[lm.type].solid; }).length;
  }
  /** Id of a maze variant: '<base id>~m<0|1>~p<one digit per solid landmark = index in SOLID_TYPES>', e.g. 'r1_standard~m1~p30152'. */
  function variantId(base, v) { return base.id + '~m' + (v.mirror ? 1 : 0) + '~p' + v.perm.slice(0, solidCount(base)).join(''); }

  var variantCache = {};
  /**
   * Any Guide maze from its id (the id is what the log stores as maze_id). 'r1_standard' -> the hand-made maze;
   * 'r1_standard~m1~p30152' -> that maze mirrored left <-> right (m1) with the solid landmarks set to SOLID_TYPES[3], [0], ...
   * in the order of the hand-made list. Doors and the bridge never change. Returns null for an unknown / broken id.
   */
  data.guideMazeById = function (id) {
    var m = /^(r\d+)_(standard|simple)(?:~m([01])~p([0-9]*))?$/.exec(String(id || ''));
    if (!m || !data.guideMazes[m[1]]) return null;
    var base = data.guideMazes[m[1]][m[2]];
    if (m[3] == null) return base;
    if (variantCache[id]) return variantCache[id];
    var digits = m[4].split('').map(Number), seen = {};
    if (digits.length !== solidCount(base)) return null;
    for (var i = 0; i < digits.length; i++) {
      if (digits[i] >= data.SOLID_TYPES.length || seen[digits[i]]) return null;
      seen[digits[i]] = true;
    }
    var mirror = m[3] === '1', W = base.cols, si = 0;
    function mx(x) { return mirror ? W - 1 - x : x; }
    function mf(f) { return mirror && (f === 'E' || f === 'W') ? (f === 'E' ? 'W' : 'E') : f; }
    var def = {
      id: id, routeId: base.routeId, difficulty: base.difficulty, baseId: base.id, mirrored: mirror,
      tiles: base.tiles.map(function (row) { return mirror ? row.split('').reverse().join('') : row; }),
      landmarks: base.landmarks.map(function (lm) {
        var solid = data.landmarkTypes[lm.type].solid;
        return { type: solid ? data.SOLID_TYPES[digits[si++]] : lm.type, x: mx(lm.x), y: lm.y };
      }),
      start: { x: mx(base.start.x), y: base.start.y, facing: mf(base.start.facing) },
      exit: { x: mx(base.exit.x), y: base.exit.y }
    };
    variantCache[id] = gm(def);
    return variantCache[id];
  };
  /** route: 0 | 1 | 'r1' | 'r2'; difficulty: 'standard' (default) | 'simple'.
   *  During a game this is the game's own variant (mirrored or not, landmarks shuffled); otherwise the hand-made maze. */
  data.guideMaze = function (route, difficulty) {
    var base = baseGuideMaze(route, difficulty);
    if (!base) return null;
    var v = current.guide && current.guide[base.routeId];
    if (!v || base.fixed) return base;
    /* the game's order of the six solid types, fitted to this maze so that no landmark can hide Pip (spotNeed) */
    var spots = base.landmarks.filter(function (lm) { return data.landmarkTypes[lm.type].solid; })
      .map(function (lm) { return { need: spotNeed(base.tiles, lm.x, lm.y) }; });
    var types = fitSolids(spots, v.perm.map(function (i) { return data.SOLID_TYPES[i]; }));
    var perm = types.map(function (t) { return data.SOLID_TYPES.indexOf(t); });
    return data.guideMazeById(variantId(base, { mirror: v.mirror, perm: perm }));
  };

  /* ------------------------------------------------------------------ warm-up (does NOT use the item facts) */
  function wm(tiles, landmarks, start) {
    return maze.prepare({ id: 'warmup', tiles: tiles.slice(), landmarks: landmarks || [], start: start });
  }
  var T_UP = ['#######', '#.....#', '###.###', '###.###', '#######'];
  var CROSS = ['#######', '###.###', '###.###', '#.....#', '###.###', '###.###', '#######'];
  var LAWN = ['#######', '#,,,,,#', '#,,,,,#', '#,,,,,#', '#######'];
  var LAWN_PATH = ['#######', '#,,,,,#', '#.....#', '#,,,,,#', '#######'];
  var PREPS = ['next to', 'behind', 'in front of', 'between', 'opposite'];
  data.PREPOSITIONS = PREPS;
  function lmName(t) { return 'the ' + data.landmarkName(t); }

  /* type 'path': read/hear `instruction`, click one of `options` (each a list of tiles). `approach` = tiles Pip walks first.
   *   Pip always walks AWAY from the viewer (facing N) here, so the pupil's left is Pip's left: a warm-up question can
   *   never depend on whose left is meant (Pip cannot ask back in the warm-up). That question belongs to Guide.
   * type 'prep': look at the picture (Pip + landmarks on `map`), pick the word for the gap in `sentence`.
   *   Pictures are seen from the viewer, and Pip always looks AT the viewer (facing S), like a photo:
   *   "behind" = Pip stands further up the screen and the landmark (solid, never see-through here) hides his legs;
   *   "in front of" = Pip stands nearer the viewer, in front of the landmark.
   *   `wrong` lists the words that are clearly false for the picture; two of them are offered with the right one. */
  function tUp(instruction, landmarks, correct) {
    return { type: 'path', instruction: instruction, map: wm(T_UP, landmarks, { x: 3, y: 3, facing: 'N' }),
      approach: [{ x: 3, y: 2 }, { x: 3, y: 1 }],
      options: [{ id: 'left', tiles: [{ x: 2, y: 1 }, { x: 1, y: 1 }] }, { id: 'right', tiles: [{ x: 4, y: 1 }, { x: 5, y: 1 }] }], correct: correct };
  }
  function cross(instruction, landmarks, correct) {
    /* every arm is two tiles long, so each "click here" arrow has its own tile and none sits on Pip's hat */
    return { type: 'path', instruction: instruction, map: wm(CROSS, landmarks, { x: 3, y: 5, facing: 'N' }),
      approach: [{ x: 3, y: 4 }, { x: 3, y: 3 }],
      options: [{ id: 'left', tiles: [{ x: 2, y: 3 }, { x: 1, y: 3 }] }, { id: 'straight', tiles: [{ x: 3, y: 2 }, { x: 3, y: 1 }] }, { id: 'right', tiles: [{ x: 4, y: 3 }, { x: 5, y: 3 }] }],
      correct: correct };
  }
  function prep(r, word, sentence, tiles, landmarks, pip, wrong) {
    var opts = r.shuffle([word].concat(r.shuffle(wrong).slice(0, 2)));
    return { type: 'prep', sentence: sentence, map: wm(tiles, landmarks), pip: pip, options: opts, correct: opts.indexOf(word) };
  }
  /** Every kind of warm-up question. Each maker takes the game's random numbers and picks the landmarks. */
  var WARM = {
    /* ---- path: read and click */
    turn_left_at: function (r) { var s = r.pick(data.SOLID_TYPES); return tUp('Turn left at ' + lmName(s) + '.', [{ type: s, x: 3, y: 0 }], 0); },
    turn_right_at: function (r) { var s = r.pick(data.SOLID_TYPES); return tUp('Turn right at ' + lmName(s) + '.', [{ type: s, x: 3, y: 0 }], 1); },
    /* the landmarks stand just below the top path, where Pip walks: low ones only, so Pip is never hidden */
    next_to_left: function (r) {
      var s = r.shuffle(LOW_TYPES);
      return tUp('Take the path next to ' + lmName(s[0]) + '.', [{ type: s[0], x: 1, y: 2 }, { type: s[1], x: 5, y: 2 }], 0);
    },
    next_to_right: function (r) {
      var s = r.shuffle(LOW_TYPES);
      return tUp('Take the path next to ' + lmName(s[0]) + '.', [{ type: s[1], x: 1, y: 2 }, { type: s[0], x: 5, y: 2 }], 1);
    },
    door_left: function (r) {
      var d = r.shuffle(data.DOOR_TYPES);
      return tUp('Go through ' + lmName(d[0]) + '.', [{ type: d[0], x: 2, y: 1 }, { type: d[1], x: 4, y: 1 }], 0);
    },
    door_right: function (r) {
      var d = r.shuffle(data.DOOR_TYPES);
      return tUp('Go through ' + lmName(d[0]) + '.', [{ type: d[1], x: 2, y: 1 }, { type: d[0], x: 4, y: 1 }], 1);
    },
    cross_straight: function () { return cross('Go straight. Do not turn.', [], 1); },
    cross_left: function () { return cross('Turn left here.', [], 0); },
    cross_right: function () { return cross('Turn right here.', [], 2); },
    walk_to: function (r) {
      var s = r.shuffle(data.SOLID_TYPES), arm = r.int(3);
      return cross('Walk to ' + lmName(s[arm]) + '.', [{ type: s[0], x: 1, y: 2 }, { type: s[1], x: 3, y: 0 }, { type: s[2], x: 5, y: 2 }], arm);
    },
    /* ---- prep: look and choose the word */
    next_to_r: function (r) {
      var s = r.pick(data.SOLID_TYPES);
      return prep(r, 'next to', 'Pip is ___ ' + lmName(s) + '.', LAWN, [{ type: s, x: 4, y: 2 }], { x: 3, y: 2, facing: 'S' }, ['behind', 'in front of', 'between', 'opposite']);
    },
    next_to_l: function (r) {
      var s = r.pick(data.SOLID_TYPES);
      return prep(r, 'next to', 'Pip is ___ ' + lmName(s) + '.', LAWN, [{ type: s, x: 2, y: 2 }], { x: 3, y: 2, facing: 'S' }, ['behind', 'in front of', 'between', 'opposite']);
    },
    behind_1: function (r) {
      var s = r.pick(LOW_TYPES);
      return prep(r, 'behind', 'Pip is ___ ' + lmName(s) + '.', LAWN, [{ type: s, x: 3, y: 2 }], { x: 3, y: 1, facing: 'S' }, ['in front of', 'between', 'opposite']);
    },
    behind_2: function (r) {
      var s = r.pick(LOW_TYPES);
      return prep(r, 'behind', 'Pip is ___ ' + lmName(s) + '.', LAWN, [{ type: s, x: 2, y: 3 }], { x: 2, y: 2, facing: 'S' }, ['in front of', 'between', 'opposite']);
    },
    in_front_1: function (r) {
      var s = r.pick(data.SOLID_TYPES);
      return prep(r, 'in front of', 'Pip is ___ ' + lmName(s) + '.', LAWN, [{ type: s, x: 3, y: 1 }], { x: 3, y: 2, facing: 'S' }, ['behind', 'between', 'opposite']);
    },
    in_front_2: function (r) {
      var s = r.pick(data.SOLID_TYPES);
      return prep(r, 'in front of', 'Pip is ___ ' + lmName(s) + '.', LAWN, [{ type: s, x: 4, y: 2 }], { x: 4, y: 3, facing: 'S' }, ['behind', 'between', 'opposite']);
    },
    between: function (r) {
      var s = r.shuffle(data.SOLID_TYPES);
      return prep(r, 'between', 'Pip is ___ ' + lmName(s[0]) + ' and ' + lmName(s[1]) + '.', LAWN,
        [{ type: s[0], x: 2, y: 2 }, { type: s[1], x: 4, y: 2 }], { x: 3, y: 2, facing: 'S' }, ['behind', 'in front of', 'opposite']);
    },
    between_wide: function (r) {
      var s = r.shuffle(data.SOLID_TYPES);
      return prep(r, 'between', 'Pip is ___ ' + lmName(s[0]) + ' and ' + lmName(s[1]) + '.', LAWN,
        [{ type: s[0], x: 1, y: 2 }, { type: s[1], x: 5, y: 2 }], { x: 3, y: 2, facing: 'S' }, ['next to', 'behind', 'opposite']);
    },
    opposite_below: function (r) {
      var s = r.pick(data.SOLID_TYPES);
      return prep(r, 'opposite', 'Pip is ___ ' + lmName(s) + '.', LAWN_PATH, [{ type: s, x: 3, y: 1 }], { x: 3, y: 3, facing: 'N' }, ['next to', 'between', 'behind']);
    },
    opposite_above: function (r) {
      var s = r.pick(LOW_TYPES);
      return prep(r, 'opposite', 'Pip is ___ ' + lmName(s) + '.', LAWN_PATH, [{ type: s, x: 3, y: 3 }], { x: 3, y: 1, facing: 'S' }, ['next to', 'between', 'in front of']);
    }
  };
  data.WARMUP_KINDS = {
    path: ['turn_left_at', 'turn_right_at', 'next_to_left', 'next_to_right', 'door_left', 'door_right', 'cross_straight', 'cross_left', 'cross_right', 'walk_to'],
    /* one path question from each family per game, so every game practises all five kinds of instruction */
    pathFamilies: { turn: ['turn_left_at', 'turn_right_at'], next_to: ['next_to_left', 'next_to_right'], door: ['door_left', 'door_right'],
      cross: ['cross_straight', 'cross_left', 'cross_right'], walk_to: ['walk_to'] },
    prep: { 'next to': ['next_to_r', 'next_to_l'], 'behind': ['behind_1', 'behind_2'], 'in front of': ['in_front_1', 'in_front_2'],
      'between': ['between', 'between_wide'], 'opposite': ['opposite_below', 'opposite_above'] }
  };
  data.WARMUP_COUNT = 10;
  /** One warm-up question of a kind, with landmarks picked by the random numbers `r` (or by `seed`). */
  data.warmupQuestion = function (kind, r) {
    if (!WARM[kind]) return null;
    if (typeof r === 'number' || r == null) r = data.rng(r || 0);
    var q = WARM[kind](r);
    q.id = 'w_' + kind; q.kind = kind;
    return q;
  };
  /** 10 questions for a game: one path question of each family (turn at / next to / door / crossing / walk to) +
   *  one question for each of the 5 prepositions, in a random order, path and prep taking turns. */
  function makeWarmup(r) {
    var fam = data.WARMUP_KINDS.pathFamilies;
    var paths = r.shuffle(Object.keys(fam)).map(function (f) { return r.pick(fam[f]); });
    var preps = r.shuffle(PREPS).map(function (p) { return r.pick(data.WARMUP_KINDS.prep[p]); });
    var out = [];
    for (var i = 0; i < 5; i++) { out.push(data.warmupQuestion(paths[i], r)); out.push(data.warmupQuestion(preps[i], r)); }
    return out;
  }
  /** Every instruction a warm-up path question can use (for the pre-recorded voice). */
  data.allWarmupInstructions = function () {
    var out = ['Go straight. Do not turn.', 'Turn left here.', 'Turn right here.'];
    data.SOLID_TYPES.forEach(function (s) {
      out.push('Turn left at ' + lmName(s) + '.', 'Turn right at ' + lmName(s) + '.', 'Walk to ' + lmName(s) + '.');
    });
    LOW_TYPES.forEach(function (s) { out.push('Take the path next to ' + lmName(s) + '.'); });
    data.DOOR_TYPES.forEach(function (d) { out.push('Go through ' + lmName(d) + '.'); });
    return out;
  };

  /* ------------------------------------------------------------------ hint ladder (spec 4.2.7) */
  /** Level 1 = general pointer; level 2 = sentence starter (using level 2 marks that fact `assisted`). */
  data.hints = {
    name:   { 1: 'Ask what I need.',        2: 'What do you …?' },
    colour: { 1: 'Ask about the colour.',   2: 'What colour …?' },
    size:   { 1: 'Ask about the size.',     2: 'Is it big or …?' },
    whose:  { 1: 'Ask whose thing it is.',  2: 'Whose …?' },
    why:    { 1: 'Ask why I need it.',      2: 'Why do you …?' },
    when:   { 1: 'Ask when I lost it.',     2: 'When did you …?' },
    place:  { 1: 'Ask about the place.',    2: 'Where is …?' }
  };
  /* Guide hints are not fixed sentences: js/guide-hint.js works them out from where Pip is now. */

  /* ------------------------------------------------------------------ canned lines (never written by the model) */
  data.text = {
    askOpen: 'I need something. Ask me!',
    askNext: 'I need one more thing. Ask me!',
    askAllFacts: 'Now you know it all. Let’s go and find it!',
    sayAgain: 'Sorry, can you say that again?',
    clarify: {
      place: 'Do you mean where it is?',
      name: 'Do you mean what I need?',
      colour: 'Do you mean what colour it is?',
      size: 'Do you mean how big it is?',
      whose: 'Do you mean whose it is?',
      why: 'Do you mean why I need it?',
      when: 'Do you mean when I lost it?',
      look: 'Do you mean what it looks like?',
      generic: 'Sorry, I don’t understand. What do you want to know?'
    },
    /* a clear question about something that is NOT on this thing's card: no fact */
    offCard: 'I can’t tell you that. Look at your card.',
    redirect: 'I am lost, so please ask me about the thing I need.',
    goIntro: 'Which way? Click a path.',
    deadEnd: 'Dead end. Go back and ask Pip again.',
    gotItem: 'I got it! Thank you!',
    guideOpen: 'I can’t see the way out. Tell me where to go!',
    cityOpen: 'I have an exam today! But first I need a book from the library.',
    cityBook: 'It is called Cute Gordon. Please help me get to the library!',
    cityGoal: 'I am at the library. I found Cute Gordon!',
    trainOpen: 'My train leaves soon! Please help me get back to the station. Quick!',
    trainGoal: 'I am at the station! I can catch my train. Thank you!',
    trainGone: 'Oh no! The train has gone.',
    trainAgain: 'The next train comes soon. Help me again, quick!',
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

  /* ================================================================== the game's own content (per seed)
   * Every new game gets a random seed (MR.state.begin). The seed decides, always in the same way:
   *   - which 4 of the 8 things Pip needs, in which order, and how each one looks (size + colour)
   *   - which THREE kinds of fact are on each thing's card ('place' + two others: pickSlotPairs), whose it is and
   *     when Pip lost it
   *   - which Go map shape each thing gets, which landmark stands where, and which last branch hides the thing
   *   - the 10 warm-up questions (kinds, order and landmarks)
   *   - for each Guide route: mirrored or not, and which solid landmark stands where
   * MR.data.useSession(seed) switches data.items / goMap() / guideMaze() / warmupSet() to that game.
   * useSession(null) switches back to the classic game (the four original things). */
  var current = null;
  var sessionCache = {};
  var CLASSIC_CONTENT = classicContent();
  CLASSIC_CONTENT.warmup = makeWarmup(data.rng(0));

  /** Build (but do not switch to) the content of a game. Pure: the same seed always gives the same content. */
  data.makeSession = function (seed) {
    seed = seed >>> 0;
    if (sessionCache[seed]) return sessionCache[seed];
    var r = data.rng(seed);
    var picks = r.shuffle(data.POOL).slice(0, data.ITEM_COUNT);
    var shapes = r.shuffle(data.TEMPLATE_IDS);
    var colours = distinctColours(r.shuffle(data.COLOURS), data.ITEM_COUNT);   /* four colours nobody can mix up */
    /* The questions of this game come from their own random numbers, so the things, colours and maps of a seed are
     * the same as before the cards had different questions (a saved game keeps its content). */
    var r2 = data.rng((seed ^ 0x51ED270B) >>> 0);
    var pairs = pickSlotPairs(r2), owners = r2.shuffle(data.OWNERS), whens = r2.shuffle(data.WHENS);
    var items = [], goMaps = {};
    picks.forEach(function (p, i) {
      var colour = colours[i], size = r.pick(p.sizes), tpl = TEMPLATES[shapes[i]];
      var choice = { doors: r.shuffle(data.DOOR_TYPES), solids: fitSolids(solidSpots(tpl), r.shuffle(data.SOLID_TYPES)), win: r.pick(winnable(tpl)) };
      var b = buildThing(p, { size: size, colour: colour, owner: owners[i], when: whens[i], extra: pairs[i] }, tpl, choice);
      items.push(b.item); goMaps[p.id] = b.map;
    });
    var guide = {};
    /* only the two mazes vary; the real-world routes (r3, r4) are fixed and use no random numbers */
    ['r1', 'r2'].forEach(function (rid) { guide[rid] = { mirror: r.bool(), perm: r.shuffle([0, 1, 2, 3, 4, 5]) }; });
    var content = { seed: seed, items: items, goMaps: goMaps, guide: guide, warmup: makeWarmup(r) };
    var keys = Object.keys(sessionCache);
    if (keys.length > 20) delete sessionCache[keys[0]];
    sessionCache[seed] = content;
    return content;
  };

  function apply(content) {
    current = content;
    data.items = content.items;
    data.itemIds = content.items.map(function (it) { return it.id; });
    data.goMaps = content.goMaps;
    data.warmup = content.warmup;
  }
  /**
   * Switch the game content to the game of this seed (a whole number 0..4294967295), or back to the classic
   * game with null. Call it whenever the pupil changes (MR.state does). Emits 'data:session'.
   * @param {number|null} seed
   * @param {string} [difficulty]  kept for information (Guide mazes are chosen per call of guideMaze)
   * @returns the content {seed, items, goMaps, guide, warmup}
   */
  data.useSession = function (seed, difficulty) {
    var hasSeed = seed !== null && seed !== undefined && seed !== '' && !isNaN(Number(seed));
    var before = current;
    apply(hasSeed ? data.makeSession(Number(seed)) : CLASSIC_CONTENT);
    current.difficulty = difficulty || null;
    if (before !== current && MR.emit) MR.emit('data:session', { seed: current.seed });
    return current;
  };
  /** Seed of the game in use, or null for the classic game. */
  data.sessionSeed = function () { return current ? current.seed : null; };

  /** Item in this game (by index 0..3 or id); an id of any of the 8 things also works (the teacher view shows
   *  pupils who had other things) - those come without facts / slots. */
  data.getItem = function (idOrIndex) {
    if (typeof idOrIndex === 'number') return data.items[idOrIndex] || null;
    for (var i = 0; i < data.items.length; i++) if (data.items[i].id === idOrIndex) return data.items[i];
    return poolItem(idOrIndex);
  };
  /** The ONLY text Pip may use to give a fact. fact: one of data.FACTS. */
  data.factText = function (itemId, fact) {
    var it = data.getItem(itemId);
    if (!it) return '';
    if (it.facts) return it.facts[fact] || '';
    return fact === 'name' ? nameText(it) : '';
  };
  /** The three kinds of fact on a thing's card, in card order ('place' is always the last one). The pupil must ask
   *  about exactly these; a question about any other kind gets no fact. [] for a thing that is not in this game. */
  data.slotsOf = function (itemOrId) {
    var it = itemOrId && typeof itemOrId === 'object' ? itemOrId : data.getItem(itemOrId);
    return it && it.slots ? it.slots.slice() : [];
  };
  /** True when the pupil is asked for this thing's name (otherwise it is a surprise until Pip picks it up). */
  data.nameIsSlot = function (itemOrId) { return data.slotsOf(itemOrId).indexOf('name') >= 0; };
  /** Colour name of a thing in this game (its icon is drawn in this colour). */
  /**
   * The "Which one is it?" step at the end of Go: three things lie at the hiding place and the pupil must pick Pip's,
   * using the TWO facts on the card besides 'place'. One wrong thing differs only in the first of these facts, the
   * other only in the second, so both facts are needed. Deterministic for a game (seed) and thing.
   * @returns {Array<{key:string, thing:string, colour:string, size:string, owner:string, when:string,
   *                  tags:string[], correct:boolean, differs:(string|null)}>}  three options in display order
   */
  data.claimOptions = function (itemOrId) {
    var it = data.getItem(typeof itemOrId === 'object' ? itemOrId.id : itemOrId);
    if (!it || !it.slots) return [];
    var extra = it.slots.filter(function (f) { return f !== 'place'; });
    var r = data.rng(((data.sessionSeed() || 1) ^ data.seedFromText('claim:' + it.id)) >>> 0);
    var base = { thing: it.id, colour: it.colour, size: it.size, owner: it.owner, when: it.when };
    var usedThings = [it.id];
    function other(list, not) { return r.pick(list.filter(function (v) { return not.indexOf(v) < 0; })); }
    function variant(kind) {
      var v = { thing: base.thing, colour: base.colour, size: base.size, owner: base.owner, when: base.when };
      if (kind === 'name' || kind === 'why') { v.thing = other(data.poolIds, usedThings); usedThings.push(v.thing); }
      else if (kind === 'colour') v.colour = r.pick(data.COLOURS.filter(function (c) { return c !== base.colour && !coloursClash(c, base.colour); }));
      else if (kind === 'size') v.size = base.size === 'big' ? 'small' : 'big';
      else if (kind === 'whose') v.owner = other(data.OWNERS, [base.owner]);
      else if (kind === 'when') v.when = other(data.WHENS, [base.when]);
      v.differs = kind; v.correct = false;
      return v;
    }
    base.differs = null; base.correct = true;
    var list = r.shuffle([base].concat(extra.map(variant)));
    list.forEach(function (o, i) {
      o.key = 'c' + i;
      o.tags = [];
      if (extra.indexOf('whose') >= 0) o.tags.push(o.owner.charAt(0).toUpperCase() + o.owner.slice(1) + '’s');
      if (extra.indexOf('when') >= 0) o.tags.push('Lost ' + o.when);
    });
    return list;
  };
  data.itemColour = function (itemId) {
    var it = data.getItem(itemId);
    return it ? it.colour : null;
  };
  /** This game's four things, for the log ('session' record) and the teacher view: the thing, its colour (icon),
   *  the three kinds of fact on its card (`slots`) and their sentences (`facts`). `name` and `place` are always there. */
  data.sessionFacts = function () {
    return data.items.map(function (it) {
      var facts = {};
      it.slots.forEach(function (f) { facts[f] = it.facts[f]; });
      return { id: it.id, colour: it.colour, name: it.facts.name, place: it.place, slots: it.slots.slice(), facts: facts };
    });
  };
  data.goMap = function (itemIdOrIndex) {
    var it = data.getItem(itemIdOrIndex);
    return it ? (data.goMaps[it.id] || null) : null;
  };
  /** The 10 warm-up questions of this game. */
  data.warmupSet = function () { return data.warmup.slice(0, data.WARMUP_COUNT); };

  /* ------------------------------------------------------------------ every possible fact (voice + validators) */
  function permutations(list, n) {
    if (n === 0) return [[]];
    var out = [];
    list.forEach(function (x, i) {
      var rest = list.slice(0, i).concat(list.slice(i + 1));
      permutations(rest, n - 1).forEach(function (p) { out.push([x].concat(p)); });
    });
    return out;
  }
  var allFactsMemo = null;
  /** Every sentence Pip can ever use to give a fact, in any game (all seven kinds). Sorted. */
  data.allFactTexts = function () {
    if (allFactsMemo) return allFactsMemo.slice();
    var set = {};
    data.POOL.forEach(function (p) { set[nameText(p)] = true; set[p.why] = true; });
    data.COLOURS.forEach(function (c) { set[colourText(c)] = true; });
    data.SIZES.forEach(function (z) { set[sizeText(z)] = true; });
    data.OWNERS.forEach(function (o) { set[whoseText(o)] = true; });
    data.WHENS.forEach(function (w) { set[whenText(w)] = true; });
    CLASSIC_CONTENT.items.forEach(function (it) { data.FACTS.forEach(function (f) { set[it.facts[f]] = true; }); });
    data.TEMPLATE_IDS.forEach(function (tid) {
      var tpl = TEMPLATES[tid];
      permutations(data.DOOR_TYPES, slotCount(tpl, 'door')).forEach(function (doors) {
        permutations(data.SOLID_TYPES, slotCount(tpl, 'solid')).forEach(function (solids) {
          if (!solidsFit(solidSpots(tpl), solids)) return;      /* a game never puts a tall landmark there */
          var types = assignTypes(tpl, { doors: doors, solids: solids });
          winnable(tpl).forEach(function (w) { set[placeText(tpl, types, w)] = true; });
        });
      });
    });
    allFactsMemo = Object.keys(set).sort();
    return allFactsMemo.slice();
  };

  /** Every word that could leak a fact (item nouns, colours, sizes, owners, reasons, times, landmark words, place
   *  prepositions): every word of every fact sentence except the few frame words below. Model-written text may
   *  not use any of them (MR.ai.validateReply). Every fact sentence keeps at least one such word (unit test), so no
   *  fact can be written with frame words alone. */
  data.FACT_FRAME_WORDS = ['it', 'is', 'and', 'the', 'to', 'of', 'in', 'a', 'i', 'need', 'my', 's', 'lost', 'on', 'at', 'this', 'last', 'because',
    'see', 'find', 'way', 'things', 'play'];      /* Pip needs these himself ("I can't see a house.", "Which way?") */
  data.factWords = (function () {
    var set = {};
    function add(s) { String(s).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).forEach(function (w) { if (w) set[w] = true; }); }
    data.POOL.forEach(function (p) { add(p.noun); });
    data.SIZES.forEach(add); data.COLOURS.forEach(add); data.OWNERS.forEach(add);
    data.allFactTexts().forEach(add);
    data.landmarkIds.forEach(function (id) { data.landmarkTypes[id].words.forEach(add); });
    data.FACT_FRAME_WORDS.forEach(function (w) { delete set[w]; });
    return Object.keys(set).sort();
  })();

  /* ------------------------------------------------------------------ an example solution (demo evidence, tests) */
  /**
   * Fewest instructions from `from` (default: the start) to the exit of a Guide maze.
   * @returns {Array<{type:'turn', dir:'left'|'right'} | {type:'forward', steps:number}>} or null if there is no way.
   */
  data.guideSolution = function (mz, from) {
    from = from || mz.start;
    var key = function (s) { return s.x + ',' + s.y + ',' + s.f; };
    var start = { x: from.x, y: from.y, f: from.facing };
    var prev = {}; prev[key(start)] = null;
    var queue = [start];
    while (queue.length) {
      var s = queue.shift();
      if (mz.exit && s.x === mz.exit.x && s.y === mz.exit.y) {
        var out = [], k = key(s);
        while (prev[k]) { out.unshift(prev[k].act); k = key(prev[k].from); }
        return out;
      }
      var next = [{ x: s.x, y: s.y, f: maze.LEFT_OF[s.f], act: { type: 'turn', dir: 'left' } },
        { x: s.x, y: s.y, f: maze.RIGHT_OF[s.f], act: { type: 'turn', dir: 'right' } }];
      var d = maze.DIRS[s.f], x = s.x + d.dx, y = s.y + d.dy, n = 1;
      while (maze.isWalkable(mz, x, y)) { next.push({ x: x, y: y, f: s.f, act: { type: 'forward', steps: n } }); x += d.dx; y += d.dy; n++; }
      for (var i = 0; i < next.length; i++) {
        var nk = key(next[i]);
        if (!(nk in prev)) { prev[nk] = { from: s, act: next[i].act }; queue.push({ x: next[i].x, y: next[i].y, f: next[i].f }); }
      }
    }
    return null;
  };

  apply(CLASSIC_CONTENT);
})(typeof window !== 'undefined' ? window : globalThis);
