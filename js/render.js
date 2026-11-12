/* Maze Rescue - scene renderer: top-down 3/4 pixel view on a SQUARE grid (not isometric), fixed camera.
 * Browser only. Requires core.js, maze.js, data.js, sprites.js.
 *
 * The scene is drawn at base resolution (16 px per tile) into a <canvas>; CSS scales it by an INTEGER factor with
 * `image-rendering: pixelated`, so pixels stay crisp. One requestAnimationFrame loop per scene; destroy() stops it.
 *
 *   var sc = MR.render.createScene(containerEl, map, opts)
 *     opts: { item:{id,x,y,hidden?}? (hidden: not drawn until pickupItem), solidLandmarks:false (true = landmarks may hide Pip),
 *              showExit:true, facingArrow:false, maxScale:5, fit:'contain', label:'' }
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
 *   sc.landmarks()                     -> [{id, type, x, y}] the map's landmarks + the exit gate (type 'exit') when shown
 *   sc.landmarkAt(x, y)                -> {id, type, x, y} | null   landmark standing on that tile
 *   sc.hitLandmark(clientX, clientY)   -> {id, type, x, y} | null   landmark whose PICTURE is under the pointer (front first)
 *   sc.onLandmarkClick(fn(lm, ev))     tap on a landmark picture (independent of onTileClick; both may fire)
 *   sc.ping(x, y, {ms:2400})           a landmark (or tile) blinks with a yellow frame and a bouncing arrow
 *   sc.showLabel(x, y, text, ms) -> el a small name label above the landmark / tile (DOM, crisp text); ms 0 = stays
 *   sc.hideLabels()
 *   sc.destroy()
 *   sc.canvas
 *
 *   MR.render.drawPortrait(canvas, emotion)   Pip's big head (5 emotions) into any canvas
 *   MR.render.drawItemIcon(canvas, itemId)    item icon into any canvas
 *   MR.render.drawPip(canvas, facing)         a standing Pip (for small pictures)
 *   MR.render.drawLandmarkIcon(canvas, type)  a landmark (or 'exit') fitted into any canvas (legend icons)
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
    /* mystery:true = the pupil was not asked for the thing's name: it is a "?" parcel until Pip picks it up */
    var item = opts.item ? { id: opts.item.id, x: opts.item.x, y: opts.item.y, visible: !opts.item.hidden, pop: 0, mystery: !!opts.item.mystery } : null;
    var trail = [], highlights = [], markers = [], particles = [], emote = null, pings = [], labels = [];
    var clickFn = null, lmClickFn = null, alive = true, raf = 0, scale = 1, t0 = performance.now(), now = 0;
    var fast = function () { return !!(MR.flags && MR.flags.fast); };

    function resize() {
      var r = container.getBoundingClientRect();
      var max = opts.maxScale || 5;
      var fit = Math.min((r.width || W) / W, (r.height || H) / H);
      /* whole numbers keep the pixels crisp; on small screens (fit < 3) quarter steps use the room much better,
       * and below 1 the map simply shrinks to fit - it must never be wider than the screen */
      var s = fit >= 3 ? Math.floor(fit) : Math.floor(fit * 4) / 4;
      if (!(s > 0)) s = 1;
      if (s < 0.5) s = Math.max(0.25, fit);
      scale = Math.min(max, s);
      cv.style.width = Math.floor(W * scale) + 'px';
      cv.style.height = Math.floor(H * scale) + 'px';
    }
    var onResize = function () { if (alive) { resize(); placeLabels(); } };
    root.addEventListener('resize', onResize);
    resize();
    /* the container may get its size a frame later (flex layout) */
    root.requestAnimationFrame(function () { if (alive) { resize(); placeLabels(); } });

    function tileFromEvent(ev) {
      var r = cv.getBoundingClientRect();
      var sx = (ev.clientX - r.left) / (r.width / W), sy = (ev.clientY - r.top) / (r.height / H);
      return { x: Math.floor(sx / T), y: Math.floor((sy - PAD) / T) };
    }
    cv.addEventListener('pointerdown', function (ev) {
      if (lmClickFn) { var lm = hitLandmark(ev.clientX, ev.clientY); if (lm) lmClickFn(lm, ev); }
      if (!clickFn) return;
      var t = tileFromEvent(ev);
      if (t.x < 0 || t.y < 0 || t.x >= map.cols || t.y >= map.rows) return;
      clickFn(t.x, t.y, ev);
    });
    cv.addEventListener('pointermove', function (ev) {
      var hit = false;
      if (clickFn && highlights.length) {
        var t = tileFromEvent(ev);
        highlights.forEach(function (h) { (h.tiles || []).forEach(function (q) { if (q.x === t.x && q.y === t.y) hit = true; }); });
      }
      if (!hit && lmClickFn) hit = !!hitLandmark(ev.clientX, ev.clientY);
      cv.style.cursor = hit ? 'pointer' : '';
    });

    /* ---------------- landmarks: list, hit test, ping, labels */
    function allLandmarks() {
      var out = (map.landmarks || []).map(function (lm) { return { id: lm.id || lm.type, type: lm.type, x: lm.x, y: lm.y }; });
      if (map.exit && opts.showExit !== false) out.push({ id: 'exit', type: 'exit', x: map.exit.x, y: map.exit.y });
      return out;
    }
    function landmarkAt(x, y) {
      var all = allLandmarks();
      for (var i = 0; i < all.length; i++) if (all[i].x === x && all[i].y === y) return all[i];
      return null;
    }
    /* the sprite's box in base pixels (falls back to the tile) */
    function spriteBox(x, y) {
      var lm = landmarkAt(x, y), box = { x: x * T, y: PAD + y * T, w: T, h: T };
      if (!lm) return box;
      var spr = lm.type === 'exit' ? S.landmark('exit', 0) : S.landmark(lm.type, 0, corridorOrient(map, lm.x, lm.y));
      var bx = x * T + spr.ox, by = PAD + y * T + spr.oy, bw = spr.canvas.width, bh = spr.canvas.height;
      var x0 = Math.min(box.x, bx), y0 = Math.min(box.y, by);
      return { x: x0, y: y0, w: Math.max(box.x + T, bx + bw) - x0, h: Math.max(box.y + T, by + bh) - y0 };
    }
    function hitLandmark(clientX, clientY) {
      var r = cv.getBoundingClientRect();
      if (!r.width) return null;
      var bx = (clientX - r.left) / (r.width / W), by = (clientY - r.top) / (r.height / H);
      var all = allLandmarks().sort(function (a, b) { return b.y - a.y; });   /* the front one first */
      for (var i = 0; i < all.length; i++) {
        var b = spriteBox(all[i].x, all[i].y);
        if (bx >= b.x && bx < b.x + b.w && by >= b.y && by < b.y + b.h) return all[i];
      }
      return null;
    }
    function placeLabel(lb) {
      var box = spriteBox(lb.x, lb.y);
      var cr = cv.getBoundingClientRect(), pr = container.getBoundingClientRect(), k = cr.width / W;
      if (!k) return;
      var left = cr.left - pr.left + container.scrollLeft + (box.x + box.w / 2) * k;
      var top = cr.top - pr.top + container.scrollTop + box.y * k - 4;
      /* keep the whole label inside the box (it is centred on `left`) */
      var half = lb.el.offsetWidth / 2, maxX = container.clientWidth + container.scrollLeft - half - 2;
      left = Math.max(container.scrollLeft + half + 2, Math.min(maxX, left));
      lb.el.style.left = Math.round(left) + 'px';
      lb.el.style.top = Math.round(top) + 'px';
      /* no room above (top row), or it would cover Pip: put it under the landmark instead */
      var lh = lb.el.offsetHeight / k, lw = lb.el.offsetWidth / k, lx = box.x + box.w / 2 - lw / 2, ly = box.y - 4 / k - lh;
      var px0 = pip.x * T, py0 = PAD + pip.y * T - 6;
      var onPip = !pip.hidden && lx < px0 + T && lx + lw > px0 && ly < py0 + 22 && ly + lh > py0;
      var below = top - lb.el.offsetHeight < 2 || onPip;
      lb.el.classList.toggle('is-below', below);
      if (below) lb.el.style.top = Math.round(cr.top - pr.top + container.scrollTop + (box.y + box.h) * k + 4) + 'px';
    }
    function placeLabels() { labels.forEach(placeLabel); }
    function removeLabel(lb) {
      clearTimeout(lb.timer);
      if (lb.el.parentNode) lb.el.parentNode.removeChild(lb.el);
      var i = labels.indexOf(lb); if (i >= 0) labels.splice(i, 1);
    }

    /* ---------------- drawing */
    function drawEntitySprite(spr, tx, ty) { g.drawImage(spr.canvas, Math.round(tx * T + spr.ox), Math.round(PAD + ty * T + spr.oy)); }
    /* shadow:false = Pip only (the second pass that keeps Pip in front of a landmark, see frame()) */
    function drawPipSprite(shadow) {
      if (pip.hidden) return;
      var frame = pip.walking ? (Math.floor(now / 140) % 2) + 1 : 0;
      var bx = 0, by = 0;
      if (pip.bumpT > 0) {
        var k = Math.sin((1 - pip.bumpT) * Math.PI) * 4, d = maze.DIRS[pip.facing];
        bx = d.dx * k; by = d.dy * k;
      }
      var X = Math.round(pip.x * T + bx), Y = Math.round(PAD + pip.y * T + by - 6);
      /* shadow */
      if (shadow !== false) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(X + 3, Y + 18, 10, 2); g.fillRect(X + 4, Y + 17, 8, 4); }
      g.drawImage(S.pip(pip.facing, frame), X, Y - (pip.walking && frame === 1 ? 1 : 0));
    }
    /* Pip is never covered by a landmark. Rows are drawn top to bottom, so a landmark (or the gate) on a LOWER row
     * is drawn after Pip and its top could hide his legs (e.g. the well just below the end of a corridor). Pip is
     * drawn once more, only inside the picture box of each such landmark (MR.data.SPRITE_BOX), so hedges still hide
     * his feet as before. */
    function drawPipInFront(pipRow) {
      if (pip.hidden) return;
      var boxes = MR.data.SPRITE_BOX, list = (map.landmarks || []).slice();
      if (opts.showExit !== false && map.exit) list.push({ type: 'exit', x: map.exit.x, y: map.exit.y });
      list.forEach(function (lm) {
        var B = boxes[lm.type];
        if (!B || lm.type === 'bridge' || lm.y <= pipRow || lm.y - pipRow > 2 || Math.abs(lm.x - pip.x) > 2) return;
        g.save();
        g.beginPath();
        g.rect(lm.x * T + B[0], PAD + lm.y * T + B[1], B[2] - B[0] + 1, B[3] - B[1] + 1);
        g.clip();
        drawPipSprite(false);
        g.restore();
      });
    }
    /* The yellow chevron that shows where Pip is looking. It sits on the side Pip faces and its TIP points the
     * same way (facing E: a ">" to the right of Pip). Rows / columns run from the wide end (near Pip) to the tip. */
    function facingArrowPoints() {
      var d = maze.DIRS[pip.facing];
      var off = pip.facing === 'N' ? 21 : 13;
      var cx = Math.round(pip.x * T + 8 + d.dx * off), cy = Math.round(PAD + pip.y * T + 9 + d.dy * off);
      var bob = Math.round(Math.sin(now / 220) * 1.5);
      cx += d.dx * bob; cy += d.dy * bob;
      var pts = [];
      for (var i = 0; i < 4; i++) {
        var a = 3 - i;                                   /* half width: 3 at the wide end, 0 at the tip */
        var px0 = cx + d.dx * (i - 1), py0 = cy + d.dy * (i - 1);   /* i steps along the facing direction */
        if (d.dx) { pts.push([px0, py0 - a]); pts.push([px0, py0 + a]); }
        else { pts.push([px0 - a, py0]); pts.push([px0 + a, py0]); }
      }
      return { points: pts, tip: pts[pts.length - 1], centre: [cx, cy] };
    }
    function drawFacingArrow() {
      if (!opts.facingArrow || pip.hidden || pip.walking) return;
      var pts = facingArrowPoints().points;
      pts.forEach(function (p) { px(g, p[0] - 1, p[1] - 1, 3, 3, '#3a2830'); });
      pts.forEach(function (p) { px(g, p[0], p[1], 1, 1, '#ffd84a'); });
    }
    function drawItem() {
      if (!item || !item.visible) return;
      var bob = Math.round(Math.sin(now / 300) * 1.5) - Math.round(item.pop * 14);
      var X = item.x * T, Y = PAD + item.y * T;
      var pulse = 0.25 + 0.15 * Math.sin(now / 250);
      g.fillStyle = 'rgba(255,240,140,' + (pulse + item.pop * 0.4) + ')';
      g.beginPath(); g.ellipse(X + 8, Y + 9, 9 + item.pop * 6, 6 + item.pop * 4, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(X + 4, Y + 13, 8, 2);
      if (!item.mystery) { g.drawImage(S.item(item.id), X, Y - 2 + bob); return; }
      /* a small parcel with a "?" on it */
      var py = Y - 1 + bob;
      px(g, X + 2, py + 2, 12, 12, '#3a2830'); px(g, X + 3, py + 3, 10, 10, '#f3d9a4'); px(g, X + 3, py + 11, 10, 2, '#d9b77c');
      [[6, 4, 4, 1], [5, 5, 2, 1], [9, 5, 2, 1], [9, 6, 2, 1], [8, 7, 2, 1], [7, 8, 2, 1], [7, 10, 2, 2]].forEach(function (r) {
        px(g, X + r[0], py + r[1], r[2], r[3], '#b0452f');
      });
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
    /* a blinking yellow frame around the landmark + a bouncing arrow above it */
    function drawPings() {
      for (var i = pings.length - 1; i >= 0; i--) {
        var p = pings[i];
        if (now > p.until) { pings.splice(i, 1); continue; }
        var b = spriteBox(p.x, p.y), t = now - p.start;
        var on = Math.floor(t / 260) % 2 === 0;
        var grow = 1 + Math.round((Math.sin(t / 130) + 1) * 1.5);
        var x0 = b.x - grow, y0 = b.y - grow, w = b.w + grow * 2, h = b.h + grow * 2;
        var col = on ? (p.color || '#ffd84a') : '#ffffff';
        px(g, x0 - 1, y0 - 1, w + 2, 4, '#3a2830'); px(g, x0 - 1, y0 + h - 3, w + 2, 4, '#3a2830');
        px(g, x0 - 1, y0 - 1, 4, h + 2, '#3a2830'); px(g, x0 + w - 3, y0 - 1, 4, h + 2, '#3a2830');
        px(g, x0, y0, w, 2, col); px(g, x0, y0 + h - 2, w, 2, col); px(g, x0, y0, 2, h, col); px(g, x0 + w - 2, y0, 2, h, col);
        /* arrow pointing down at it (or up from below when there is no room on top) */
        var cx = Math.round(b.x + b.w / 2), bob = Math.round(Math.abs(Math.sin(t / 160)) * 3);
        var up = y0 - 12 < 0, ay = up ? y0 + h + 3 + bob : y0 - 4 - bob;
        /* row r of the arrow: widest at the far end, the tip toward the landmark */
        for (var r = 0; r < 4; r++) {
          var half = 3 - r, yy = up ? ay + 3 - r : ay - 3 + r;
          px(g, cx - half - 1, yy - 1, half * 2 + 3, 3, '#3a2830');
        }
        for (r = 0; r < 4; r++) {
          var hw = 3 - r, y2 = up ? ay + 3 - r : ay - 3 + r;
          px(g, cx - hw, y2, hw * 2 + 1, 1, col);
        }
      }
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
          /* a landmark right in front of Pip (the tile below him) would cover him: draw it see-through */
          /* (not in pictures with opts.solidLandmarks, e.g. the warm-up "behind" picture: there the landmark must hide him) */
          var covers = !opts.solidLandmarks && !pip.hidden && lm.y === pipRow + 1 && Math.abs(lm.x - pip.x) < 0.6 && lm.type !== 'bridge';
          if (covers) g.globalAlpha = 0.4;
          drawEntitySprite(S.landmark(lm.type, lf, corridorOrient(map, lm.x, lm.y)), lm.x, lm.y);
          g.globalAlpha = 1;
        });
        if (opts.showExit !== false && map.exit && map.exit.y === y) drawEntitySprite(S.landmark('exit', lf), map.exit.x, map.exit.y);
        if (item && item.y === y) drawItem();
        if (pipRow === y) drawPipSprite();
      }
      if (!opts.solidLandmarks) drawPipInFront(pipRow);       /* no landmark ever covers Pip */
      drawFacingArrow();            /* after every row, so no hedge or landmark can hide where Pip is looking */
      drawPings();
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
          item.mystery = false;                 /* now the pupil sees what it is */
          item.visible = true;
          sc.burst(item.x, item.y, 18);
          return tween(650, function (k) { item.pop = Math.sin(k * Math.PI / 2); }).then(function () {
            return tween(250, function () {});
          }).then(function () { item.visible = false; item.pop = 0; });
        });
      },
      setItemVisible: function (on) { if (item) item.visible = !!on; },
      resize: function () { if (alive) { resize(); placeLabels(); } },
      scale: function () { return scale; },
      landmarks: function () { return allLandmarks(); },
      landmarkAt: function (x, y) { return landmarkAt(x, y); },
      hitLandmark: function (clientX, clientY) { return hitLandmark(clientX, clientY); },
      onLandmarkClick: function (fn) { lmClickFn = fn || null; },
      /** Make a landmark (or a tile) blink for ms (default 2400). A new ping on the same tile restarts it. */
      ping: function (x, y, o) {
        o = o || {};
        pings = pings.filter(function (p) { return p.x !== x || p.y !== y; });
        pings.push({ x: x, y: y, start: now, until: now + (o.ms || 2400), color: o.color });
      },
      /** Name label above a landmark / tile. One label per tile (a new one replaces it). ms 0 = until hideLabels(). */
      showLabel: function (x, y, text, ms) {
        if (!alive) return null;
        labels.filter(function (l) { return l.x === x && l.y === y; }).forEach(removeLabel);
        if (root.getComputedStyle && root.getComputedStyle(container).position === 'static') container.style.position = 'relative';
        var el = doc.createElement('span');
        el.className = 'mr-maplabel';
        el.textContent = String(text || '');
        el.setAttribute('role', 'status');
        container.appendChild(el);
        var lb = { x: x, y: y, el: el, timer: 0 };
        labels.push(lb);
        placeLabel(lb);
        if (ms !== 0) lb.timer = setTimeout(function () { removeLabel(lb); }, ms || 2600);
        return el;
      },
      hideLabels: function () { labels.slice().forEach(removeLabel); },
      tileRect: function (x, y) {
        var r = cv.getBoundingClientRect(), k = r.width / W;
        return { left: r.left + x * T * k, top: r.top + (PAD + y * T) * k, width: T * k, height: T * k };
      },
      /** Wait until queued walks / turns are finished. */
      idle: function () { return busy; },
      /** For tests / debugging: what is on screen now. */
      debugState: function () {
        return { pip: { x: pip.x, y: pip.y, facing: pip.facing, walking: pip.walking }, highlights: highlights.map(function (h) { return { id: h.id, tiles: h.tiles }; }),
          markers: markers.length, item: item ? { visible: item.visible, mystery: item.mystery } : null, trail: trail.length, emote: emote && emote.kind,
          pings: pings.map(function (p) { return { x: p.x, y: p.y }; }), labels: labels.map(function (l) { return { x: l.x, y: l.y, text: l.el.textContent }; }),
          /* the facing chevron in base pixels (tests): tip = its point, centre = its middle, pipCentre = the middle of Pip's tile */
          arrow: opts.facingArrow && !pip.hidden ? (function () { var a = facingArrowPoints(); return { tip: a.tip, centre: a.centre, pipCentre: [pip.x * T + 8, PAD + pip.y * T + 8] }; })() : null };
      },
      destroy: function () {
        var i = render.active.indexOf(sc); if (i >= 0) render.active.splice(i, 1);
        alive = false; root.cancelAnimationFrame(raf); root.removeEventListener('resize', onResize);
        labels.slice().forEach(removeLabel); pings = []; lmClickFn = null;
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
  /** A landmark ('fountain', 'red_door', ... or 'exit') fitted into a small canvas (whole pixels when it fits). */
  render.drawLandmarkIcon = function (canvas, type) {
    if (!canvas) return;
    var spr = S.landmark(type, 0, type === 'bridge' ? 'ew' : undefined).canvas;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (type === 'bridge') {                       /* the deck is part of the ground: draw a little bit of water + deck */
      var gc = doc.createElement('canvas'); gc.width = T; gc.height = T;
      drawBridgeDeck(gc.getContext('2d'), 0, 0, 'ew');
      var kb = Math.max(1, Math.floor(Math.min(canvas.width / T, canvas.height / T)));
      ctx.drawImage(gc, Math.floor((canvas.width - T * kb) / 2), Math.floor((canvas.height - T * kb) / 2), T * kb, T * kb);
    }
    var k = Math.min(canvas.width / spr.width, canvas.height / spr.height);
    if (k >= 1) k = Math.floor(k);
    var w = Math.round(spr.width * k), h = Math.round(spr.height * k);
    ctx.drawImage(spr, Math.floor((canvas.width - w) / 2), Math.floor((canvas.height - h) / 2), w, h);
  };
  render.TILE = T; render.PAD = PAD_DEFAULT;
})(typeof window !== 'undefined' ? window : globalThis);
