/* Maze Rescue - original pixel art, drawn in code (no image files). Browser only (uses <canvas>).
 * Everything here is pre-rendered once into small offscreen canvases and cached.
 * Base unit: 16x16 px tiles. The renderer scales the whole scene by an integer factor with smoothing off.
 *
 *   MR.sprites.pip(facing 'N'|'E'|'S'|'W', frame 0|1|2)  -> canvas 16x20  (frame 0 idle, 1/2 walk)
 *   MR.sprites.item(id)                                  -> canvas 16x16  (key, map, lamp, bag)
 *   MR.sprites.landmark(type, frame, orient)            -> {canvas, ox, oy}  (draw at tileX*16+ox, tileY*16+oy)
 *   MR.sprites.portrait(emotion)                         -> canvas 32x32  (neutral, happy, confused, thinking, surprised)
 *   MR.sprites.star() / heart() / glyph(ch)              -> small canvases for effects
 *   MR.sprites.PAL                                       -> the palette
 * All art is original and made for this project (see docs/CREDITS.md). */
(function (root) {
  'use strict';
  var MR = root.MR = root.MR || {};
  var doc = root.document;
  var S = MR.sprites = {};

  var PAL = S.PAL = {
    k: '#3a2830',   /* outline */
    h: '#e2b467', H: '#b07c3c', b: '#d2463c',          /* hat, hat shade, hat band */
    s: '#ffd9b8', S: '#eeb48e', c: '#ff9e9e',          /* skin, skin shade, cheek */
    r: '#7a4a2a', R: '#5a3420',                         /* hair */
    e: '#2a2440', w: '#ffffff', m: '#b4434a',          /* eye, eye light, mouth */
    g: '#4fb477', G: '#2f8a5a',                         /* shirt */
    p: '#c0702e', P: '#8c4c1e',                         /* backpack */
    n: '#3d5a9e', f: '#5a3a22',                         /* trousers, shoes */
    y: '#ffd84a', Y: '#fff3a8', o: '#d9a520',           /* yellow (key) */
    t: '#e8d3a2', T: '#b89a62', u: '#8a6a3a',           /* parchment (map) */
    x: '#e04848', X: '#a82c38', z: '#fff6c8',           /* red (lamp), glow */
    v: '#5cbf4a', V: '#37862f', q: '#a8e07a',           /* green (bag) */
    a: '#9aa3ad', A: '#6c7480', B: '#c8d0d8'            /* metal / stone */
  };

  function canvas(w, h) {
    var c = doc.createElement('canvas'); c.width = w; c.height = h;
    var ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    return c;
  }
  /** Paint a string sprite. rows: array of strings, '.' = transparent, other chars = PAL keys. */
  function paint(ctx, rows, ox, oy, pal, mirror) {
    pal = pal || PAL;
    for (var y = 0; y < rows.length; y++) {
      var r = rows[y];
      for (var x = 0; x < r.length; x++) {
        var ch = r.charAt(x);
        if (ch === '.' || ch === ' ') continue;
        var col = pal[ch]; if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect((ox || 0) + (mirror ? r.length - 1 - x : x), (oy || 0) + y, 1, 1);
      }
    }
  }
  S.paint = paint;
  function fromRows(rows, mirror, pal) {
    var w = 0; rows.forEach(function (r) { w = Math.max(w, r.length); });
    var c = canvas(w, rows.length);
    paint(c.getContext('2d'), rows.map(function (r) { while (r.length < w) r += '.'; return r; }), 0, 0, pal, mirror);
    return c;
  }
  S.fromRows = fromRows;
  var cache = {};
  function cached(key, make) { return cache[key] || (cache[key] = make()); }

  /* ------------------------------------------------------------------ Pip on the map (16 x 20) */
  var HAT = [
    '....kkkkkkkk....',
    '...khhhhhhhhk...',
    '...khhhhhhhhk...',
    '...kbbbbbbbbk...',
    '.kkhhhhhhhhhhkk.',
    'kHHHHHHHHHHHHHHk'
  ];
  var HAT_E = [
    '.....kkkkkkk....',
    '....khhhhhhhk...',
    '....khhhhhhhk...',
    '....kbbbbbbbk...',
    '..kkhhhhhhhhhkk.',
    '.kHHHHHHHHHHHHHk'
  ];
  var PIP = {
    S: HAT.concat([
      '.kkrrrrrrrrrrkk.',
      '..krrssssssrrk..',
      '..kswesssswesk..',
      '..kseesssseesk..',
      '..kcsssmmsssck..',
      '...kSssssssSk...',
      '...kggggggggk...',
      '..kpgggGGgggpk..',
      '..ksggggggggsk..',
      '...kGGGGGGGGk...',
      '...knnnnnnnnk...'
    ]),
    N: HAT.concat([
      '.kkrrrrrrrrrrkk.',
      '..krrrrrrrrrrk..',
      '..krrrrrrrrrrk..',
      '..krrrrRRrrrrk..',
      '..kSrrrrrrrrSk..',
      '...kSSSSSSSSk...',
      '...kppppppppk...',
      '..kgpPPPPPPpgk..',
      '..ksppppppppsk..',
      '...kPPPPPPPPk...',
      '...knnnnnnnnk...'
    ]),
    E: HAT_E.concat([
      '..krrrrrrrssskk.',
      '..krrrrrssssssk.',
      '..krrrrsssswesk.',
      '..krrrsssssseek.',
      '..kSrrssssscsk..',
      '...kSsssssssk...',
      '..kpkggggggk....',
      '.kpppgggggsk....',
      '.kPPpggggggk....',
      '..kkkGGGGGGk....',
      '....knnnnnnk....'
    ])
  };
  var LEGS = {
    front: [
      ['...knnk..knnk...', '..kfffk..kfffk..', '..kkkkk..kkkkk..'],
      ['...knnk..knnk...', '...kffk..kfffk..', '....kk...kkkkk..'],
      ['...knnk..knnk...', '..kfffk..kffk...', '..kkkkk...kk....']
    ],
    side: [
      ['....knnnnnnk....', '....kfffkfffk...', '....kkkkkkkkk...'],
      ['...knnk..knnk...', '..kfffk..kfffk..', '..kkkkk..kkkkk..'],
      ['....knnnnnnk....', '....kfffkfffk...', '....kkkkkkkkk...']
    ]
  };
  /** Pip map sprite. frame 0 = standing, 1 / 2 = walking (bob + legs). */
  S.pip = function (facing, frame) {
    frame = frame || 0;
    return cached('pip' + facing + frame, function () {
      var mirror = facing === 'W';
      var body = PIP[facing === 'W' ? 'E' : facing];
      var legs = (facing === 'E' || facing === 'W' ? LEGS.side : LEGS.front)[frame];
      var c = canvas(16, 20), ctx = c.getContext('2d');
      var bob = frame === 0 ? 0 : (frame === 1 ? 0 : 1);
      paint(ctx, body, 0, bob, PAL, mirror);
      paint(ctx, legs, 0, 17, PAL, mirror);
      return c;
    });
  };

  /* ------------------------------------------------------------------ items (16 x 16) */
  var ITEMS = {
    key: [
      '................',
      '......kkkk......',
      '.....kyyyyk.....',
      '....kyYkkyyk....',
      '....kyk..kyk....',
      '....kyykkyyk....',
      '.....kyyyyk.....',
      '......kyok......',
      '......kyok......',
      '......kyokkk....',
      '......kyoyyk....',
      '......kyokkk....',
      '......kyok......',
      '......kyoyyk....',
      '......kkkkk.....',
      '................'
    ],
    map: [
      '................',
      '................',
      '..kkkkkkkkkkkk..',
      '.kTttttttttttTk.',
      '.kTtuuttttxtttk.',
      '.kTttutttxxtttk.',
      '.kTtttuutxtxttk.',
      '.kTttttttuttttk.',
      '.kTttxtttuuttTk.',
      '.kTtttttttutttk.',
      '.kTttttttttxtTk.',
      '.kTtttttttxtxtk.',
      '.kTTTTTTTTTTTTk.',
      '..kkkkkkkkkkkk..',
      '................',
      '................'
    ],
    lamp: [
      '.......kk.......',
      '......k..k......',
      '......k..k......',
      '.....kkkkkk.....',
      '....kXXXXXXk....',
      '...kxzzzzzzxk...',
      '...kxzYYYYzxk...',
      '...kxzYyyYzxk...',
      '...kxzYyyYzxk...',
      '...kxzYYYYzxk...',
      '...kxzzzzzzxk...',
      '....kXXXXXXk....',
      '.....kxxxxk.....',
      '....kkkkkkkk....',
      '................',
      '................'
    ],
    bag: [
      '................',
      '.....kkkkkk.....',
      '....kk....kk....',
      '....k......k....',
      '...kkkkkkkkkk...',
      '..kvqqvvvvvvvk..',
      '.kvqvvvvvvvvvVk.',
      '.kvvvkkkkkkvvVk.',
      '.kvvvkyyyykvvVk.',
      '.kvvvkkkkkkvvVk.',
      '.kvvvvvvvvvvvVk.',
      '.kvvvvvvvvvvVVk.',
      '.kVvvvvvvvvVVVk.',
      '..kVVVVVVVVVVk..',
      '...kkkkkkkkkk...',
      '................'
    ]
  };
  S.itemIds = Object.keys(ITEMS);
  S.item = function (id) {
    return cached('item' + id, function () { return fromRows(ITEMS[id] || ITEMS.key); });
  };

  /* ------------------------------------------------------------------ small effect sprites */
  S.star = function (big) {
    return cached('star' + (big ? 1 : 0), function () {
      return fromRows(big ? [
        '...k...', '..kyk..', 'kkyYykk', 'kyYYYyk', '.kyyyk.', '.kykyk.', '.k...k.'
      ] : ['.y.', 'yYy', '.y.']);
    });
  };
  S.heart = function () { return cached('heart', function () { return fromRows(['.kk.kk.', 'kxxkxxk', 'kxzxxxk', '.kxxxk.', '..kxk..', '...k...']); }); };
  var GLYPHS = {
    '?': ['.kkkk.', 'kwwwwk', 'kwkkwk', '..kwwk', '.kwwk.', '.kwk..', '.kk...', '.kwk..', '.kk...'],
    '!': ['.kk.', 'kwwk', 'kwwk', 'kwwk', 'kwwk', '.kk.', 'kwwk', '.kk.'],
    '.': ['kkkkkkkkkk', 'kwkkwkkwkk', 'kkkkkkkkkk']
  };
  S.glyph = function (ch) { return cached('glyph' + ch, function () { return fromRows(GLYPHS[ch] || GLYPHS['?']); }); };

  /* ------------------------------------------------------------------ landmarks */
  function px(ctx, x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w || 1, h || 1); }
  function ellipse(ctx, cx, cy, rx, ry, col) {
    ctx.fillStyle = col;
    for (var y = -ry; y <= ry; y++) {
      var half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.0001))));
      ctx.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2, 1);
    }
  }
  S.px = px; S.ellipse = ellipse;

  var LM = {};
  /* each maker returns {canvas, ox, oy}; (ox, oy) = where the canvas' top-left goes relative to the tile's top-left */
  LM.fountain = function (frame) {
    var c = canvas(22, 24), g = c.getContext('2d');
    ellipse(g, 11, 20, 10, 3, 'rgba(0,0,0,0.18)');
    ellipse(g, 11, 17, 10, 4, PAL.k);
    ellipse(g, 11, 16, 9, 3, '#c9cfd6');
    px(g, 2, 16, 18, 3, '#9aa3ad'); px(g, 1, 16, 1, 3, PAL.k); px(g, 20, 16, 1, 3, PAL.k);
    px(g, 2, 19, 18, 1, PAL.k);
    ellipse(g, 11, 15, 8, 2, '#3f8fe0');
    px(g, 5, 15, 3, 1, '#9fd4ff'); px(g, 13, 14, 2, 1, '#9fd4ff');
    /* pillar + bowl */
    px(g, 9, 8, 4, 7, PAL.k); px(g, 10, 8, 2, 7, '#c9cfd6');
    ellipse(g, 11, 8, 5, 1, PAL.k); px(g, 7, 7, 8, 1, '#c9cfd6'); px(g, 8, 8, 6, 1, '#3f8fe0');
    /* water: animated drops */
    var drops = [[11, 1], [8, 3], [14, 3], [7, 6], [15, 6]];
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i], off = (frame + i) % 4;
      px(g, d[0], d[1] + off, 1, 2, off % 2 ? '#9fd4ff' : '#5fb0ff');
    }
    px(g, 10, 2 + (frame % 2), 2, 4, '#9fd4ff');
    var rip = frame % 4;
    px(g, 4 + rip, 15, 2, 1, '#ffffff'); px(g, 15 - rip, 16, 2, 1, '#cfe9ff');
    return { canvas: c, ox: -3, oy: -8 };
  };
  LM.tree = function (frame) {
    var c = canvas(30, 36), g = c.getContext('2d');
    ellipse(g, 15, 33, 11, 3, 'rgba(0,0,0,0.2)');
    px(g, 12, 22, 6, 12, PAL.k); px(g, 13, 22, 4, 11, '#8a5a32'); px(g, 13, 22, 1, 11, '#a8743e');
    px(g, 11, 32, 8, 1, PAL.k);
    var sway = frame % 2;
    ellipse(g, 15 + sway, 14, 14, 11, PAL.k);
    ellipse(g, 15 + sway, 14, 13, 10, '#2f8a3a');
    ellipse(g, 10 + sway, 11, 7, 6, '#46a845');
    ellipse(g, 19 + sway, 9, 7, 6, '#46a845');
    ellipse(g, 15 + sway, 17, 9, 5, '#3a9a40');
    ellipse(g, 9 + sway, 8, 3, 2, '#7fd36a');
    ellipse(g, 18 + sway, 6, 3, 2, '#7fd36a');
    px(g, 8 + sway, 17, 2, 2, '#e04848'); px(g, 21 + sway, 15, 2, 2, '#e04848'); px(g, 15 + sway, 11, 2, 2, '#e04848');
    return { canvas: c, ox: -7, oy: -20 };
  };
  LM.windmill = function (frame) {
    var c = canvas(32, 44), g = c.getContext('2d');
    ellipse(g, 16, 41, 9, 2, 'rgba(0,0,0,0.2)');
    /* tower */
    for (var y = 0; y < 22; y++) {
      var half = 5 + Math.floor(y / 5);
      px(g, 16 - half - 1, 19 + y, half * 2 + 2, 1, PAL.k);
      px(g, 16 - half, 19 + y, half * 2, 1, y % 6 === 5 ? '#e0cfa8' : '#f3e6c4');
      px(g, 16 + half - 3, 19 + y, 3, 1, '#d8c39a');
    }
    px(g, 14, 33, 5, 8, PAL.k); px(g, 15, 34, 3, 7, '#8a5a32');
    px(g, 19, 25, 3, 3, PAL.k); px(g, 20, 26, 1, 1, '#9fd4ff');
    /* roof */
    for (y = 0; y < 8; y++) { var r = 1 + y; px(g, 16 - r - 1, 12 + y, r * 2 + 2, 1, PAL.k); px(g, 16 - r, 12 + y, r * 2, 1, y % 3 === 2 ? '#a82c38' : '#d2463c'); }
    /* sails (4 frames of rotation) */
    var hub = { x: 16, y: 18 }, ang = frame * Math.PI / 8;
    for (var i = 0; i < 4; i++) {
      var a = ang + i * Math.PI / 2;
      for (var t = 2; t <= 15; t++) {
        var sx = Math.round(hub.x + Math.cos(a) * t), sy = Math.round(hub.y + Math.sin(a) * t);
        px(g, sx, sy, 1, 1, '#6b4a2a');
        if (t > 4) {
          var nx = Math.round(-Math.sin(a) * 2), ny = Math.round(Math.cos(a) * 2);
          px(g, sx + nx, sy + ny, 1, 1, '#ffffff');
          px(g, Math.round(sx + nx / 2), Math.round(sy + ny / 2), 1, 1, '#f0e8dc');
        }
      }
    }
    px(g, hub.x - 1, hub.y - 1, 3, 3, PAL.k); px(g, hub.x, hub.y, 1, 1, PAL.y);
    return { canvas: c, ox: -8, oy: -28 };
  };
  LM.scarecrow = function (frame) {
    var c = canvas(22, 30), g = c.getContext('2d');
    ellipse(g, 11, 28, 6, 2, 'rgba(0,0,0,0.2)');
    px(g, 10, 14, 2, 15, '#6b4a2a');
    var sw = frame % 2;
    /* arms */
    px(g, 1, 13 + sw, 20, 2, '#6b4a2a');
    px(g, 0, 12 + sw, 2, 4, '#ffd84a'); px(g, 20, 12 + sw, 2, 4, '#ffd84a');
    /* shirt */
    px(g, 6, 12, 10, 9, PAL.k); px(g, 7, 13, 8, 7, '#3d7ad6'); px(g, 7, 16, 8, 1, '#2c5aa8'); px(g, 10, 13, 2, 7, '#e04848');
    px(g, 7, 20, 2, 2, '#ffd84a'); px(g, 13, 20, 2, 2, '#ffd84a');
    /* head */
    ellipse(g, 11, 8, 4, 4, PAL.k); ellipse(g, 11, 8, 3, 3, '#e8d3a2');
    px(g, 9, 7, 1, 1, PAL.k); px(g, 12, 7, 1, 1, PAL.k); px(g, 9, 10, 4, 1, PAL.k);
    /* straw hat */
    px(g, 4, 4, 14, 2, PAL.k); px(g, 5, 4, 12, 1, '#e6b84a'); px(g, 7, 0, 8, 4, PAL.k); px(g, 8, 1, 6, 3, '#f0c85a'); px(g, 8, 3, 6, 1, '#d2463c');
    return { canvas: c, ox: -3, oy: -14 };
  };
  LM.well = function () {
    var c = canvas(20, 26), g = c.getContext('2d');
    ellipse(g, 10, 23, 9, 2, 'rgba(0,0,0,0.2)');
    /* posts + roof */
    px(g, 2, 6, 2, 13, '#6b4a2a'); px(g, 16, 6, 2, 13, '#6b4a2a');
    for (var y = 0; y < 6; y++) { px(g, 4 - y + 4, y, 12 + (y * 2) - 8 + 4, 1, PAL.k); px(g, 9 - y, y + 1, 2 + y * 2, 1, y % 2 ? '#a82c38' : '#d2463c'); }
    px(g, 1, 6, 18, 2, PAL.k); px(g, 2, 6, 16, 1, '#d2463c');
    px(g, 9, 8, 1, 5, '#6b4a2a'); px(g, 8, 12, 3, 3, '#8a5a32');
    /* stone ring */
    px(g, 1, 14, 18, 8, PAL.k); px(g, 2, 15, 16, 6, '#9aa3ad');
    px(g, 2, 15, 16, 2, '#3a5a8a');
    for (var i = 0; i < 4; i++) { px(g, 3 + i * 4, 18, 3, 1, '#c8d0d8'); px(g, 5 + i * 4, 20, 2, 1, '#6c7480'); }
    return { canvas: c, ox: -2, oy: -10 };
  };
  LM.bench = function () {
    var c = canvas(18, 14), g = c.getContext('2d');
    ellipse(g, 9, 12, 8, 1, 'rgba(0,0,0,0.2)');
    px(g, 1, 1, 16, 5, PAL.k); px(g, 2, 2, 14, 1, '#c0803e'); px(g, 2, 4, 14, 1, '#c0803e');
    px(g, 1, 6, 16, 3, PAL.k); px(g, 2, 7, 14, 1, '#d89a52');
    px(g, 2, 9, 2, 3, PAL.k); px(g, 14, 9, 2, 3, PAL.k);
    return { canvas: c, ox: -1, oy: 2 };
  };
  /* doors stand ON a path tile. orient 'ns' = the corridor runs up/down (door seen from the front), 'ew' = left/right */
  function door(col, dark, orient) {
    var c = canvas(20, 30), g = c.getContext('2d');
    if (orient === 'ew') {
      /* the corridor runs left / right: the open door leaf stands against the back hedge, big and easy to see */
      px(g, 2, 2, 16, 22, PAL.k); px(g, 3, 3, 14, 20, col);
      px(g, 3, 3, 14, 2, dark); px(g, 5, 7, 4, 6, dark); px(g, 11, 7, 4, 6, dark); px(g, 5, 15, 4, 6, dark); px(g, 11, 15, 4, 6, dark);
      px(g, 6, 8, 2, 4, 'rgba(255,255,255,0.35)'); px(g, 12, 8, 2, 4, 'rgba(255,255,255,0.35)');
      px(g, 14, 13, 2, 2, PAL.y); px(g, 14, 13, 1, 1, PAL.k);
      px(g, 0, 22, 4, 8, PAL.k); px(g, 1, 23, 2, 6, '#c8d0d8'); px(g, 16, 22, 4, 8, PAL.k); px(g, 17, 23, 2, 6, '#c8d0d8');
      return { canvas: c, ox: -2, oy: -12 };
    }
    /* the corridor runs up / down: a coloured arch, the door leaf open against the left post */
    px(g, 0, 4, 5, 26, PAL.k); px(g, 1, 5, 3, 24, col); px(g, 1, 5, 1, 24, dark);
    px(g, 15, 4, 5, 26, PAL.k); px(g, 16, 5, 3, 24, col); px(g, 18, 5, 1, 24, dark);
    px(g, 0, 0, 20, 7, PAL.k); px(g, 1, 1, 18, 5, col); px(g, 1, 5, 18, 1, dark); px(g, 3, 2, 14, 1, 'rgba(255,255,255,0.4)');
    px(g, 4, 8, 6, 21, PAL.k); px(g, 5, 9, 4, 19, col); px(g, 5, 9, 1, 19, dark); px(g, 6, 11, 2, 6, dark); px(g, 6, 20, 2, 6, dark); px(g, 8, 17, 1, 2, PAL.y);
    return { canvas: c, ox: -2, oy: -14 };
  }
  LM.red_door = function (frame, orient) { return door('#e04848', '#a82c38', orient); };
  LM.green_door = function (frame, orient) { return door('#4caf50', '#2f7a33', orient); };
  /* the bridge is drawn as ground by the renderer (S.bridgeTile); as an entity it only adds the hand rails */
  LM.bridge = function (frame, orient) {
    var c = canvas(16, 20), g = c.getContext('2d');
    if (orient === 'ew') {
      px(g, 0, 4, 16, 2, PAL.k); px(g, 0, 4, 16, 1, '#b07c3c');
      for (var i = 1; i < 16; i += 5) px(g, i, 4, 1, 5, '#6b4a2a');
      return { canvas: c, ox: 0, oy: -4 };
    }
    px(g, 0, 0, 2, 20, PAL.k); px(g, 14, 0, 2, 20, PAL.k);
    px(g, 0, 0, 1, 20, '#b07c3c'); px(g, 15, 0, 1, 20, '#b07c3c');
    return { canvas: c, ox: 0, oy: -4 };
  };
  LM.exit = function (frame) {
    var c = canvas(18, 30), g = c.getContext('2d');
    var glow = frame % 4;
    ellipse(g, 9, 22, 8, 6, 'rgba(255,240,140,' + (0.3 + glow * 0.08) + ')');
    /* wooden arch with a flower garland */
    px(g, 0, 4, 3, 26, PAL.k); px(g, 1, 5, 1, 24, '#c8903e');
    px(g, 15, 4, 3, 26, PAL.k); px(g, 16, 5, 1, 24, '#c8903e');
    px(g, 0, 0, 18, 6, PAL.k); px(g, 1, 1, 16, 4, '#d89a4a'); px(g, 1, 4, 16, 1, '#8c5a2a');
    for (var i = 1; i < 17; i += 3) px(g, i, 1 + (i % 2), 2, 2, i % 6 === 1 ? '#ff7ab0' : (i % 6 === 4 ? '#ffd84a' : '#ffffff'));
    /* a little green flag on top */
    px(g, 8, -0, 1, 1, PAL.k);
    var sp = [[5, 12], [12, 16], [9, 9], [5, 20], [12, 9]];
    for (i = 0; i < sp.length; i++) if ((frame + i) % 3 === 0) { px(g, sp[i][0], sp[i][1] - 1, 1, 3, '#fff6c8'); px(g, sp[i][0] - 1, sp[i][1], 3, 1, '#fff6c8'); }
    return { canvas: c, ox: -1, oy: -14 };
  };
  S.landmarkTypes = Object.keys(LM);
  /** frames: animated landmarks have 4 (fountain, windmill, exit) or 2 (tree, scarecrow) frames; others 1. */
  S.landmarkFrames = { fountain: 4, windmill: 4, exit: 4, tree: 2, scarecrow: 2 };
  S.landmark = function (type, frame, orient) {
    var n = S.landmarkFrames[type] || 1, f = (frame || 0) % n;
    return cached('lm' + type + f + (orient || ''), function () { return (LM[type] || LM.bench)(f, orient); });
  };

  /* ------------------------------------------------------------------ portrait (32 x 32) */
  function portrait(emotion) {
    var c = canvas(32, 32), g = c.getContext('2d');
    var K = PAL.k;
    /* shoulders: shirt + red scarf + backpack strap */
    px(g, 5, 27, 22, 5, K); px(g, 6, 28, 20, 4, PAL.g); px(g, 6, 30, 20, 2, PAL.G);
    px(g, 9, 26, 14, 3, K); px(g, 10, 26, 12, 2, '#e04848'); px(g, 14, 28, 4, 3, '#e04848'); px(g, 14, 30, 4, 1, '#a82c38');
    px(g, 7, 28, 2, 4, PAL.p); px(g, 23, 28, 2, 4, PAL.p);
    /* ears */
    px(g, 5, 16, 3, 5, K); px(g, 6, 17, 2, 3, PAL.S); px(g, 24, 16, 3, 5, K); px(g, 24, 17, 2, 3, PAL.S);
    /* face */
    ellipse(g, 16, 18, 10, 9, K);
    ellipse(g, 16, 18, 9, 8, PAL.s);
    px(g, 8, 23, 16, 1, PAL.S); px(g, 10, 25, 12, 1, PAL.S);
    /* hair fringe */
    px(g, 7, 9, 18, 4, K); px(g, 8, 10, 16, 3, PAL.r);
    px(g, 8, 13, 3, 3, PAL.r); px(g, 21, 13, 3, 3, PAL.r); px(g, 13, 13, 3, 1, PAL.r); px(g, 7, 13, 1, 4, K); px(g, 24, 13, 1, 4, K);
    px(g, 11, 10, 3, 1, PAL.R); px(g, 18, 11, 3, 1, PAL.R);
    /* hat */
    px(g, 9, 1, 14, 7, K); px(g, 10, 2, 12, 5, PAL.h); px(g, 11, 2, 3, 1, '#f3d08a');
    px(g, 10, 5, 12, 2, PAL.b);
    px(g, 2, 7, 28, 3, K); px(g, 3, 7, 26, 1, PAL.h); px(g, 3, 8, 26, 1, PAL.H);

    function eyesOpen(dx, dy) {
      dx = dx || 0; dy = dy || 0;
      px(g, 10, 15, 4, 5, K); px(g, 18, 15, 4, 5, K);
      px(g, 11 + dx, 16 + dy, 1, 1, PAL.w); px(g, 19 + dx, 16 + dy, 1, 1, PAL.w);
      px(g, 12, 18, 1, 1, '#5a4a8a'); px(g, 20, 18, 1, 1, '#5a4a8a');
    }
    function cheeks() { px(g, 8, 20, 3, 2, PAL.c); px(g, 21, 20, 3, 2, PAL.c); }

    switch (emotion) {
      case 'happy':
        /* ^ ^ eyes, big open smile, sparkle */
        px(g, 10, 17, 1, 1, K); px(g, 11, 16, 2, 1, K); px(g, 13, 17, 1, 1, K);
        px(g, 18, 17, 1, 1, K); px(g, 19, 16, 2, 1, K); px(g, 21, 17, 1, 1, K);
        cheeks(); px(g, 8, 19, 3, 3, PAL.c); px(g, 21, 19, 3, 3, PAL.c);
        px(g, 13, 21, 6, 1, K); px(g, 13, 22, 6, 2, PAL.m); px(g, 12, 21, 1, 2, K); px(g, 19, 21, 1, 2, K); px(g, 13, 24, 6, 1, K);
        px(g, 14, 23, 4, 1, '#ff8a9a');
        px(g, 28, 12, 1, 5, PAL.y); px(g, 26, 14, 5, 1, PAL.y); px(g, 28, 14, 1, 1, PAL.w);
        px(g, 2, 15, 1, 3, PAL.y); px(g, 1, 16, 3, 1, PAL.y);
        break;
      case 'confused':
        /* one brow up, uneven eyes, wavy mouth, big "?" */
        px(g, 10, 13, 4, 1, K); px(g, 18, 14, 4, 1, K);
        px(g, 11, 16, 2, 3, K); px(g, 19, 17, 2, 2, K); px(g, 11, 16, 1, 1, PAL.w);
        cheeks();
        px(g, 13, 22, 2, 1, K); px(g, 15, 21, 2, 1, K); px(g, 17, 22, 2, 1, K);
        px(g, 24, 13, 2, 3, '#7fc8ff'); px(g, 25, 12, 1, 1, '#7fc8ff');
        S.paint(g, GLYPHS['?'], 25, 0);
        break;
      case 'thinking':
        /* eyes looking up, flat mouth, hand on chin, dots */
        px(g, 10, 15, 4, 5, K); px(g, 18, 15, 4, 5, K);
        px(g, 12, 15, 1, 2, PAL.w); px(g, 20, 15, 1, 2, PAL.w);
        px(g, 10, 13, 4, 1, K); px(g, 18, 12, 4, 1, K);
        px(g, 14, 22, 4, 1, K); px(g, 18, 21, 1, 1, K);
        px(g, 19, 23, 6, 6, K); px(g, 20, 24, 4, 4, PAL.s); px(g, 20, 22, 2, 2, K); px(g, 20, 23, 1, 1, PAL.s);
        px(g, 25, 2, 2, 2, PAL.w); px(g, 28, 1, 2, 2, PAL.w); px(g, 29, 5, 2, 2, PAL.w);
        px(g, 24, 2, 1, 2, K); px(g, 27, 1, 1, 2, K); px(g, 28, 5, 1, 2, K);
        break;
      case 'surprised':
        /* big round eyes, high brows, "O" mouth, "!" */
        px(g, 9, 12, 5, 1, K); px(g, 18, 12, 5, 1, K);
        px(g, 9, 14, 6, 6, K); px(g, 17, 14, 6, 6, K);
        px(g, 10, 15, 4, 4, PAL.w); px(g, 18, 15, 4, 4, PAL.w);
        px(g, 11, 16, 2, 2, K); px(g, 19, 16, 2, 2, K);
        px(g, 14, 21, 4, 4, K); px(g, 15, 22, 2, 2, PAL.m);
        S.paint(g, GLYPHS['!'], 27, 1);
        break;
      default: /* neutral / waiting */
        eyesOpen();
        cheeks();
        px(g, 14, 22, 4, 1, K); px(g, 13, 21, 1, 1, K); px(g, 18, 21, 1, 1, K);
    }
    return c;
  }
  S.EMOTIONS = ['neutral', 'happy', 'confused', 'thinking', 'surprised'];
  S.portrait = function (emotion) {
    if (S.EMOTIONS.indexOf(emotion) < 0) emotion = 'neutral';
    return cached('portrait' + emotion, function () { return portrait(emotion); });
  };
})(typeof window !== 'undefined' ? window : globalThis);
