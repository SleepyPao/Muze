/* Maze Rescue - scene renderer: top-down 3/4 pixel view on a SQUARE grid (not isometric), fixed camera.
 * Browser only. Requires core.js, maze.js, data.js, sprites.js.
 *
 * The scene is drawn at base resolution (16 px per tile) into a <canvas>; CSS scales it by an INTEGER factor with
 * `image-rendering: pixelated`, so pixels stay crisp. One requestAnimationFrame loop per scene; destroy() stops it.
 *
 *   var sc = MR.render.createScene(containerEl, map, opts)
 *     opts: { item:{id,x,y}?, showExit:true, facingArrow:false, maxScale:5, fit:'contain', label:'' }
 *   sc.setPip(x, y, facing)            place Pip at once (no animation)
 *   sc.pip()                           -> {x, y, facing}
 *   sc.walk(path, opts) -> Promise     path [{x,y}] of adjacent tiles (Pip's own tile not included); faces each step
 *   sc.turn(facing) -> Promise         turn in place (short pause so the pupil sees it)
 *   sc.bump() -> Promise               bump into a wall in front (surprised "!")
 *   sc.emote('?'|'!'|'heart'|'...'|null, ms)   bubble above Pip
 *   sc.setHighlights([{id, tiles:[{x,y}], color:'#ffd84a', pulse:true}])  clickable / hint areas
 *   sc.setMarkers([{x, y, dir:'N'|'E'|'S'|'W'}])   bouncing arrows ("click here")
 *   sc.onTileClick(fn(x, y, ev))       pointer / touch on a tile
 *   sc.addTrail(tiles) / sc.clearTrail() / sc.setTrail(tiles)  footprints on walked tiles
 *   sc.pickupItem() -> Promise         the item pops up, glows and bursts into stars, then disappears
 *   sc.burst(x, y, n)                  star particles at a tile
 *   sc.setItemVisible(bool)
 *   sc.resize()                        recompute the integer scale (called automatically on window resize)
 *   sc.tileRect(x, y) -> DOMRect-like  screen rectangle of a tile (for DOM labels)
 *   sc.destroy()
 *   sc.canvas
 *
 *   MR.render.drawPortrait(canvas, emotion)   Pip's big head (5 emotions) into any canvas
 *   MR.render.drawItemIcon(canvas, itemId)    item icon into any canvas
 *   MR.render.drawPip(canvas, facing)         a standing Pip (for small pictures)
 */
(function (root) {
  'use strict';
  var MR = root.MR;
  var doc = root.document;
  var S = MR.sprites, maze = MR.maze;
  var render = MR.render = {};
  var T = 16;           /* tile size */
  var PAD_DEFAULT = 18; /* extra pixels above row 0 for tall sprites (each scene computes what it needs) */

  function hash(x, y, s) { var h = (x * 374761393 + y * 668265263 + (s || 0) * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
  function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w || 1, h || 1); }

  /* ------------------------------------------------------------------ static ground */
  var GRASS = ['#8fd16a', '#86ca62', '#93d570'];
  function drawGrass(g, x, y, ox, oy) {
    px(g, ox, oy, T, T, GRASS[Math.floor(hash(x, y, 1) * 3)]);
    for (var i = 0; i < 5; i++) {
      var gx = Math.floor(hash(x, y, 10 + i) * 15), gy = Math.floor(hash(x, y, 20 + i) * 14);
      px(g, ox + gx, oy + gy, 1, 2, '#6fb34e');
    }
    var r = hash(x, y, 3);
    if (r < 0.22) {                                   /* little flowers */
      var cols = ['#ffffff', '#ffd84a', '#ff8fb8', '#b48cff'];
      var c = cols[Math.floor(hash(x, y, 4) * cols.length)];
      var fx = 3 + Math.floor(hash(x, y, 5) * 9), fy = 3 + Math.floor(hash(x, y, 6) * 9);
      px(g, ox + fx, oy + fy - 1, 1, 1, c); px(g, ox + fx - 1, oy + fy, 3, 1, c); px(g, ox + fx, oy + fy + 1, 1, 1, c);
      px(g, ox + fx, oy + fy, 1, 1, '#ffb43a');
    } else if (r < 0.27) {                            /* a mushroom */
      var mx = 4 + Math.floor(hash(x, y, 7) * 8), my = 5 + Math.floor(hash(x, y, 8) * 7);
      px(g, ox + mx, oy + my + 2, 2, 2, '#f3e6c4'); px(g, ox + mx - 1, oy + my, 4, 2, '#e04848'); px(g, ox + mx, oy + my, 1, 1, '#ffffff');
    }
  }
  function drawPath(g, x, y, ox, oy, map) {
    px(g, ox, oy, T, T, '#d9c08c');
    /* flagstones: 2 x 2 stones with a little jitter */
    var stones = [[1, 1, 6, 6], [9, 1, 6, 6], [1, 9, 6, 6], [9, 9, 6, 6]];
    for (var i = 0; i < 4; i++) {
      var s = stones[i], j = Math.floor(hash(x, y, 30 + i) * 2);
      px(g, ox + s[0] + j, oy + s[1], s[2], s[3], hash(x, y, 40 + i) < 0.5 ? '#efe0b8' : '#e8d5a6');
      px(g, ox + s[0] + j, oy + s[1] + s[3] - 1, s[2], 1, '#c9ae78');
    }
    /* soft grass edge where the path meets lawn */
    if (maze.tileAt(map, x, y - 1) === ',') px(g, ox, oy, T, 1, '#a6d47c');
    if (maze.tileAt(map, x - 1, y) === ',') px(g, ox, oy, 1, T, '#a6d47c');
  }
  function drawWater(g, ox, oy) {
    px(g, ox, oy, T, T, '#4a9de8');
    px(g, ox, oy, T, 2, '#2f7ac4');
  }
  function drawBridgeDeck(g, ox, oy, orient) {
    drawWater(g, ox, oy);
    if (orient === 'ew') {
      px(g, ox, oy + 3, T, 11, '#3a2830');
      for (var i = 0; i < T; i += 3) { px(g, ox + i, oy + 4, 2, 9, '#c8903e'); px(g, ox + i + 2, oy + 4, 1, 9, '#8c5a2a'); }
    } else {
      px(g, ox + 1, oy, 14, T, '#3a2830');
      for (var j = 0; j < T; j += 3) { px(g, ox + 2, oy + j, 12, 2, '#c8903e'); px(g, ox + 2, oy + j + 2, 12, 1, '#8c5a2a'); }
    }
  }
  /* hedge: the top face is lifted 4 px (height), a darker front face shows when the tile below is open */
  var HEDGE_LIFT = 4;
  function drawHedge(g, map, x, y, ox, oy) {
    var below = maze.tileAt(map, x, y + 1) !== '#' || y + 1 >= map.rows;
    var top = oy - HEDGE_LIFT;
    px(g, ox, top, T, T, '#3f9a4a');
    for (var i = 0; i < 6; i++) {
      var lx = Math.floor(hash(x, y, 50 + i) * 14), ly = Math.floor(hash(x, y, 60 + i) * 11);
      px(g, ox + lx, top + ly, 2, 2, i % 2 ? '#56b85a' : '#2f7d3a');
    }
    px(g, ox + 2 + Math.floor(hash(x, y, 70) * 10), top + 2 + Math.floor(hash(x, y, 71) * 7), 1, 1, '#9be08a');
    /* outlines toward open tiles */
    if (maze.tileAt(map, x, y - 1) !== '#') px(g, ox, top, T, 1, '#2a5e30');
    if (maze.tileAt(map, x - 1, y) !== '#') px(g, ox, top, 1, T, '#2a5e30');
    if (maze.tileAt(map, x + 1, y) !== '#') px(g, ox + T - 1, top, 1, T, '#2a5e30');
    if (below && y + 1 < map.rows) {
      px(g, ox, oy + T - HEDGE_LIFT - 1, T, HEDGE_LIFT + 1, '#2c6e36');
      for (var k = 0; k < T; k += 4) px(g, ox + k + (y % 2), oy + T - HEDGE_LIFT, 1, HEDGE_LIFT - 1, '#245a2c');
      px(g, ox, oy + T - 1, T, 1, 'rgba(0,0,0,0.25)');
    }
  }
  function corridorOrient(map, x, y) {
    var ns = maze.isWalkable(map, x, y - 1) || maze.isWalkable(map, x, y + 1);
    var ew = maze.isWalkable(map, x - 1, y) || maze.isWalkable(map, x + 1, y);
    return ew && !ns ? 'ew' : 'ns';
  }

  function buildGround(map, PAD) {
    var w = map.cols * T, h = map.rows * T + PAD;
    var c = doc.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    /* sky-ish lawn behind the top padding */
    px(g, 0, 0, w, PAD, '#7cc35a');
    for (var y = 0; y < map.rows; y++) {
      for (var x = 0; x < map.cols; x++) {
        var ch = maze.tileAt(map, x, y), ox = x * T, oy = PAD + y * T;
        if (ch === '.') drawPath(g, x, y, ox, oy, map);
        else if (ch === '~') drawWater(g, ox, oy);
        else drawGrass(g, x, y, ox, oy);
      }
    }
    /* bridge decks are part of the ground */
    (map.landmarks || []).forEach(function (lm) {
      if (lm.type === 'bridge') drawBridgeDeck(g, lm.x * T, PAD + lm.y * T, corridorOrient(map, lm.x, lm.y));
    });
    /* shadows cast by hedges onto the tile below */
    for (y = 0; y < map.rows - 1; y++) for (x = 0; x < map.cols; x++) {
      if (maze.tileAt(map, x, y) === '#' && maze.tileAt(map, x, y + 1) !== '#') px(g, x * T, PAD + (y + 1) * T, T, 2, 'rgba(30,60,30,0.22)');
    }
    return c;
  }
  /* hedges of one row, pre-rendered (drawn in y order so they hide what stands behind them) */
  function buildHedgeRows(map) {
    var rows = [];
    for (var y = 0; y < map.rows; y++) {
      var c = doc.createElement('canvas'); c.width = map.cols * T; c.height = T + HEDGE_LIFT;
      var g = c.getContext('2d'); g.imageSmoothingEnabled = false;
      var any = false;
      for (var x = 0; x < map.cols; x++) if (maze.tileAt(map, x, y) === '#') { drawHedge(g, map, x, y, x * T, HEDGE_LIFT); any = true; }
      rows.push(any ? c : null);
    }
    return rows;
  }

  /* ------------------------------------------------------------------ scene */
  render.createScene = function (container, map, opts) {
    opts = opts || {};
    /* only as much top padding as the tallest sprite in the first rows needs */
    var PAD = 2;
    (map.landmarks || []).forEach(function (lm) {
      var spr = S.landmark(lm.type, 0, corridorOrient(map, lm.x, lm.y));
      PAD = Math.max(PAD, -(lm.y * T + spr.oy));
    });
    if (map.exit && opts.showExit !== false) PAD = Math.max(PAD, -(map.exit.y * T + S.landmark('exit', 0).oy));
    var W = map.cols * T, H = map.rows * T + PAD;
    var cv = doc.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.className = 'mr-scene';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', opts.label || 'The maze');
    container.appendChild(cv);
    var g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    var ground = buildGround(map, PAD), hedges = buildHedgeRows(map);

    var start = map.start || { x: 0, y: 0, facing: 'S' };
    var pip = { x: start.x, y: start.y, facing: start.facing || 'S', walking: false, frame: 0, hidden: !map.start, bumpT: 0 };
    var item = opts.item ? { id: opts.item.id, x: opts.item.x, y: opts.item.y, visible: true, pop: 0 } : null;
    var trail = [], highlights = [], markers = [], particles = [], emote = null;
    var clickFn = null, alive = true, raf = 0, scale = 1, t0 = performance.now(), now = 0;
    var fast = function () { return !!(MR.flags && MR.flags.fast); };

    function resize() {
      var r = container.getBoundingClientRect();
      var max = opts.maxScale || 5;
      var s = Math.floor(Math.min((r.width || W) / W, (r.height || H) / H));
      if (!(s >= 1)) s = 1;
      scale = Math.min(max, s);
      cv.style.width = (W * scale) + 'px';
      cv.style.height = (H * scale) + 'px';
    }
    var onResize = function () { if (alive) resize(); };
    root.addEventListener('resize', onResize);
    resize();
    /* the container may get its size a frame later (flex layout) */
    root.requestAnimationFrame(function () { if (alive) resize(); });

    function tileFromEvent(ev) {
      var r = cv.getBoundingClientRect();
      var sx = (ev.clientX - r.left) / (r.width / W), sy = (ev.clientY - r.top) / (r.height / H);
      return { x: Math.floor(sx / T), y: Math.floor((sy - PAD) / T) };
    }
    cv.addEventListener('pointerdown', function (ev) {
      if (!clickFn) return;
      var t = tileFromEvent(ev);
      if (t.x < 0 || t.y < 0 || t.x >= map.cols || t.y >= map.rows) return;
      clickFn(t.x, t.y, ev);
    });
    cv.addEventListener('pointermove', function (ev) {
      if (!clickFn || !highlights.length) { cv.style.cursor = ''; return; }
      var t = tileFromEvent(ev), hit = false;
      highlights.forEach(function (h) { (h.tiles || []).forEach(function (q) { if (q.x === t.x && q.y === t.y) hit = true; }); });
      cv.style.cursor = hit ? 'pointer' : '';
    });

    /* ---------------- drawing */
    function drawEntitySprite(spr, tx, ty) { g.drawImage(spr.canvas, Math.round(tx * T + spr.ox), Math.round(PAD + ty * T + spr.oy)); }
    function drawPipSprite() {
      if (pip.hidden) return;
      var frame = pip.walking ? (Math.floor(now / 140) % 2) + 1 : 0;
      var bx = 0, by = 0;
      if (pip.bumpT > 0) {
        var k = Math.sin((1 - pip.bumpT) * Math.PI) * 4, d = maze.DIRS[pip.facing];
        bx = d.dx * k; by = d.dy * k;
      }
      var X = Math.round(pip.x * T + bx), Y = Math.round(PAD + pip.y * T + by - 6);
      /* shadow */
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(X + 3, Y + 18, 10, 2); g.fillRect(X + 4, Y + 17, 8, 4);
      g.drawImage(S.pip(pip.facing, frame), X, Y - (pip.walking && frame === 1 ? 1 : 0));
    }
    function drawFacingArrow() {
      if (!opts.facingArrow || pip.hidden || pip.walking) return;
      var d = maze.DIRS[pip.facing];
      var off = pip.facing === 'N' ? 21 : 13;
      var cx = Math.round(pip.x * T + 8 + d.dx * off), cy = Math.round(PAD + pip.y * T + 9 + d.dy * off);
      var bob = Math.round(Math.sin(now / 220) * 1.5);
      cx += d.dx * bob; cy += d.dy * bob;
      /* a chevron pointing in the facing direction */
      for (var i = 0; i < 4; i++) {
        var a = 3 - i;
        var pts = pip.facing === 'N' ? [[cx - a, cy - 1 + i], [cx + a, cy - 1 + i]] :
          pip.facing === 'S' ? [[cx - a, cy + 1 - i], [cx + a, cy + 1 - i]] :
            pip.facing === 'E' ? [[cx + 1 - i, cy - a], [cx + 1 - i, cy + a]] : [[cx - 1 + i, cy - a], [cx - 1 + i, cy + a]];
        pts.forEach(function (p) { px(g, p[0] - 1, p[1] - 1, 3, 3, '#3a2830'); });
      }
      for (i = 0; i < 4; i++) {
        var b = 3 - i;
        var q = pip.facing === 'N' ? [[cx - b, cy - 1 + i], [cx + b, cy - 1 + i]] :
          pip.facing === 'S' ? [[cx - b, cy + 1 - i], [cx + b, cy + 1 - i]] :
            pip.facing === 'E' ? [[cx + 1 - i, cy - b], [cx + 1 - i, cy + b]] : [[cx - 1 + i, cy - b], [cx - 1 + i, cy + b]];
        q.forEach(function (p) { px(g, p[0], p[1], 1, 1, '#ffd84a'); });
      }
    }
    function drawItem() {
      if (!item || !item.visible) return;
      var bob = Math.round(Math.sin(now / 300) * 1.5) - Math.round(item.pop * 14);
      var X = item.x * T, Y = PAD + item.y * T;
      var pulse = 0.25 + 0.15 * Math.sin(now / 250);
      g.fillStyle = 'rgba(255,240,140,' + (pulse + item.pop * 0.4) + ')';
      g.beginPath(); g.ellipse(X + 8, Y + 9, 9 + item.pop * 6, 6 + item.pop * 4, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(X + 4, Y + 13, 8, 2);
      g.drawImage(S.item(item.id), X, Y - 2 + bob);
    }
    function drawTrail() {
      for (var i = 0; i < trail.length; i++) {
        var t = trail[i], X = t.x * T, Y = PAD + t.y * T;
        var f = t.facing || 'N', horiz = f === 'E' || f === 'W';
        g.fillStyle = 'rgba(120,80,40,0.45)';
        if (horiz) { g.fillRect(X + 4, Y + 6, 2, 1); g.fillRect(X + 10, Y + 9, 2, 1); }
        else { g.fillRect(X + 6, Y + 4, 1, 2); g.fillRect(X + 9, Y + 10, 1, 2); }
      }
    }
    function drawHighlights() {
      var a = 0.35 + 0.25 * Math.sin(now / 200);
      highlights.forEach(function (h) {
        var col = h.color || '#ffd84a';
        (h.tiles || []).forEach(function (t) {
          var X = t.x * T, Y = PAD + t.y * T;
          g.globalAlpha = h.pulse === false ? 0.45 : a;
          g.fillStyle = col; g.fillRect(X + 1, Y + 1, T - 2, T - 2);
          g.globalAlpha = 1;
          g.fillStyle = col; g.fillRect(X, Y, T, 1); g.fillRect(X, Y + T - 1, T, 1); g.fillRect(X, Y, 1, T); g.fillRect(X + T - 1, Y, 1, T);
        });
      });
    }
    function drawMarkers() {
      var bob = Math.round(Math.abs(Math.sin(now / 180)) * 3);
      markers.forEach(function (m) {
        var X = m.x * T + 8, Y = PAD + m.y * T + 8, d = maze.DIRS[m.dir || 'S'];
        X -= d.dx * bob; Y -= d.dy * bob;
        /* a fat arrow pointing in m.dir */
        var len = 5;
        for (var i = -len; i <= 1; i++) {
          var w = i > -2 ? 0 : 1;
          if (d.dx) { px(g, X + i * d.dx - (d.dx < 0 ? 0 : 0), Y - w - 1, 1, 3 + 2 * w, '#3a2830'); }
          else { px(g, X - w - 1, Y + i * d.dy, 3 + 2 * w, 1, '#3a2830'); }
        }
        for (i = 0; i < 4; i++) {
          if (d.dx) px(g, X + (2 - i) * d.dx, Y - i, 1, i * 2 + 1, i === 3 ? '#3a2830' : '#ffffff');
          else px(g, X - i, Y + (2 - i) * d.dy, i * 2 + 1, 1, i === 3 ? '#3a2830' : '#ffffff');
        }
      });
    }
    function drawParticles(dt) {
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.life -= dt; if (p.life <= 0) { particles.splice(i, 1); continue; }
        p.x += p.vx * dt / 16; p.y += p.vy * dt / 16; p.vy += 0.05 * dt / 16;
        g.globalAlpha = Math.min(1, p.life / 300);
        g.drawImage(S.star(p.big), Math.round(p.x), Math.round(p.y));
        g.globalAlpha = 1;
      }
    }
    function drawEmote() {
      if (!emote || pip.hidden) return;
      if (now > emote.until) { emote = null; return; }
      var X = Math.round(pip.x * T) + 9, Y = Math.round(PAD + pip.y * T) - 22;
      var spr = emote.kind === 'heart' ? S.heart() : S.glyph(emote.kind === '...' ? '.' : emote.kind);
      var w = spr.width + 4, h = spr.height + 4;
      px(g, X - 1, Y - 1, w + 2, h + 2, '#3a2830'); px(g, X, Y, w, h, '#ffffff'); px(g, X + 2, Y + h + 1, 3, 2, '#3a2830'); px(g, X + 3, Y + h, 1, 2, '#ffffff');
      g.drawImage(spr, X + 2, Y + 2);
    }

    var last = performance.now();
    function frame(ts) {
      if (!alive) return;
      var dt = Math.min(64, ts - last); last = ts; now = ts - t0;
      g.drawImage(ground, 0, 0);
      /* water shimmer + grass sway (cheap overlays) */
      var wf = Math.floor(now / 300) % 4;
      for (var y = 0; y < map.rows; y++) for (var x = 0; x < map.cols; x++) {
        var ch = maze.tileAt(map, x, y);
        if (ch === '~') { px(g, x * T + ((wf * 3 + y) % 12) + 1, PAD + y * T + 6, 3, 1, '#9fd4ff'); px(g, x * T + ((wf * 5 + 7) % 12), PAD + y * T + 11, 2, 1, '#cfe9ff'); }
        else if (ch === ',' && hash(x, y, 90) < 0.35) {
          var sway = Math.sin(now / 600 + x * 0.7 + y) > 0 ? 1 : 0;
          var gx = x * T + 3 + Math.floor(hash(x, y, 91) * 10), gy = PAD + y * T + 4 + Math.floor(hash(x, y, 92) * 8);
          px(g, gx + sway, gy, 1, 1, '#5aa83e'); px(g, gx, gy + 1, 1, 2, '#5aa83e'); px(g, gx + 2 - sway, gy + 1, 1, 1, '#5aa83e'); px(g, gx + 2, gy + 2, 1, 1, '#5aa83e');
        }
      }
      drawTrail();
      drawHighlights();
      /* y-sorted pass: per row, entities standing in the row, then the hedges of the next row hide their feet */
      var lf = Math.floor(now / 220);
      var pipRow = Math.round(pip.y);
      for (y = 0; y < map.rows; y++) {
        if (hedges[y]) g.drawImage(hedges[y], 0, PAD + y * T - HEDGE_LIFT);
        (map.landmarks || []).forEach(function (lm) {
          if (lm.y !== y) return;
          drawEntitySprite(S.landmark(lm.type, lf, corridorOrient(map, lm.x, lm.y)), lm.x, lm.y);
        });
        if (opts.showExit !== false && map.exit && map.exit.y === y) drawEntitySprite(S.landmark('exit', lf), map.exit.x, map.exit.y);
        if (item && item.y === y) drawItem();
        if (pipRow === y) { drawPipSprite(); drawFacingArrow(); }
      }
      drawMarkers();
      drawParticles(dt);
      drawEmote();
      raf = root.requestAnimationFrame(frame);
    }
    raf = root.requestAnimationFrame(frame);

    /* ---------------- tweening */
    function tween(ms, fn) {
      if (fast() || ms <= 0) { fn(1); return Promise.resolve(); }
      return new Promise(function (resolve) {
        var s = performance.now();
        (function step() {
          if (!alive) return resolve();
          var k = Math.min(1, (performance.now() - s) / ms);
          fn(k);
          if (k >= 1) resolve(); else root.requestAnimationFrame(step);
        })();
      });
    }
    var busy = Promise.resolve();
    function queue(fn) { busy = busy.then(fn, fn); return busy; }

    var sc = {
      canvas: cv, map: map,
      setPip: function (x, y, facing) { pip.x = x; pip.y = y; if (facing) pip.facing = facing; pip.hidden = false; pip.walking = false; },
      hidePip: function () { pip.hidden = true; },
      pip: function () { return { x: Math.round(pip.x), y: Math.round(pip.y), facing: pip.facing }; },
      walk: function (path, o) {
        o = o || {};
        var ms = o.msPerTile || 200;
        return queue(function () {
          var steps = (path || []).slice();
          function next() {
            if (!alive || !steps.length) { pip.walking = false; return Promise.resolve(); }
            var to = steps.shift(), from = { x: Math.round(pip.x), y: Math.round(pip.y) };
            var f = maze.facingBetween(from, to);
            if (f) pip.facing = f;
            pip.walking = true;
            if (o.trail !== false) trail.push({ x: from.x, y: from.y, facing: pip.facing });
            if (MR.audio) MR.audio.sfx('step');
            return tween(ms, function (k) { pip.x = from.x + (to.x - from.x) * k; pip.y = from.y + (to.y - from.y) * k; }).then(next);
          }
          return next().then(function () { pip.walking = false; if (o.trail !== false && o.trailEnd) trail.push({ x: Math.round(pip.x), y: Math.round(pip.y), facing: pip.facing }); });
        });
      },
      turn: function (facing) {
        return queue(function () { pip.facing = facing; if (MR.audio) MR.audio.sfx('turn'); return tween(260, function () {}); });
      },
      bump: function () {
        return queue(function () {
          if (MR.audio) MR.audio.sfx('bump');
          sc.emote('!', 1400);
          return tween(380, function (k) { pip.bumpT = 1 - k; }).then(function () { pip.bumpT = 0; });
        });
      },
      emote: function (kind, ms) { emote = kind ? { kind: kind, until: now + (ms || 1500) } : null; },
      setHighlights: function (list) { highlights = list || []; },
      clearHighlights: function () { highlights = []; cv.style.cursor = ''; },
      setMarkers: function (list) { markers = list || []; },
      onTileClick: function (fn) { clickFn = fn; },
      addTrail: function (tiles) { (tiles || []).forEach(function (t) { trail.push({ x: t.x, y: t.y, facing: t.facing }); }); },
      setTrail: function (tiles) {
        trail = [];
        (tiles || []).forEach(function (t, i, a) {
          var n = a[i + 1], f = n ? maze.facingBetween(t, n) : (a[i - 1] ? maze.facingBetween(a[i - 1], t) : 'N');
          trail.push({ x: t.x, y: t.y, facing: f || 'N' });
        });
      },
      clearTrail: function () { trail = []; },
      burst: function (x, y, n) {
        n = n || 14;
        for (var i = 0; i < n; i++) {
          var a = (i / n) * Math.PI * 2;
          particles.push({ x: x * T + 6, y: PAD + y * T + 2, vx: Math.cos(a) * (1 + (i % 3) * 0.5), vy: Math.sin(a) * 1.4 - 1.2, life: 700 + (i % 4) * 120, big: i % 3 === 0 });
        }
      },
      pickupItem: function () {
        return queue(function () {
          if (!item) return Promise.resolve();
          if (MR.audio) MR.audio.sfx('pickup');
          sc.burst(item.x, item.y, 18);
          return tween(650, function (k) { item.pop = Math.sin(k * Math.PI / 2); }).then(function () {
            return tween(250, function () {});
          }).then(function () { item.visible = false; item.pop = 0; });
        });
      },
      setItemVisible: function (on) { if (item) item.visible = !!on; },
      resize: resize,
      scale: function () { return scale; },
      tileRect: function (x, y) {
        var r = cv.getBoundingClientRect(), k = r.width / W;
        return { left: r.left + x * T * k, top: r.top + (PAD + y * T) * k, width: T * k, height: T * k };
      },
      /** Wait until queued walks / turns are finished. */
      idle: function () { return busy; },
      /** For tests / debugging: what is on screen now. */
      debugState: function () {
        return { pip: { x: pip.x, y: pip.y, facing: pip.facing, walking: pip.walking }, highlights: highlights.map(function (h) { return { id: h.id, tiles: h.tiles }; }),
          markers: markers.length, item: item ? { visible: item.visible } : null, trail: trail.length, emote: emote && emote.kind };
      },
      destroy: function () {
        var i = render.active.indexOf(sc); if (i >= 0) render.active.splice(i, 1);
        alive = false; root.cancelAnimationFrame(raf); root.removeEventListener('resize', onResize);
        if (cv.parentNode) cv.parentNode.removeChild(cv);
      }
    };
    render.active.push(sc);
    return sc;
  };
  /** Scenes now on screen (newest last). Used by tests and the debug console. */
  render.active = [];

  /* ------------------------------------------------------------------ small canvases */
  function blit(canvas, spr) {
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var k = Math.max(1, Math.floor(Math.min(canvas.width / spr.width, canvas.height / spr.height)));
    var w = spr.width * k, h = spr.height * k;
    ctx.drawImage(spr, Math.floor((canvas.width - w) / 2), Math.floor((canvas.height - h) / 2), w, h);
  }
  render.drawPortrait = function (canvas, emotion) { if (canvas) blit(canvas, S.portrait(emotion)); };
  render.drawItemIcon = function (canvas, itemId) { if (canvas) blit(canvas, S.item(itemId)); };
  render.drawPip = function (canvas, facing) { if (canvas) blit(canvas, S.pip(facing || 'S', 0)); };
  render.TILE = T; render.PAD = PAD_DEFAULT;
})(typeof window !== 'undefined' ? window : globalThis);
