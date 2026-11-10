/* Maze Rescue - grid helpers shared by data, the Guide engine, the renderer and the screens.
 * Pure. A "map" is { cols, rows, tiles:[string], landmarks:[{id,type,x,y}], start:{x,y,facing}, exit?:{x,y} }.
 * Tile chars: '#' hedge (wall)  '.' path (the ONLY walkable tile)  ',' lawn (decor, not walkable)  '~' water (not walkable)
 * Facings: 'N' (up / away from the viewer), 'E' (screen right), 'S' (down / toward the viewer), 'W' (screen left). */
(function (root) {
  'use strict';
  var MR = root.MR = root.MR || {};
  var maze = MR.maze = {};

  maze.DIRS = { N: { dx: 0, dy: -1 }, E: { dx: 1, dy: 0 }, S: { dx: 0, dy: 1 }, W: { dx: -1, dy: 0 } };
  maze.FACINGS = ['N', 'E', 'S', 'W'];
  maze.LEFT_OF = { N: 'W', W: 'S', S: 'E', E: 'N' };
  maze.RIGHT_OF = { N: 'E', E: 'S', S: 'W', W: 'N' };
  maze.OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

  /** Facing after turning 'left' | 'right' (relative to Pip). */
  maze.turn = function (facing, dir) { return dir === 'left' ? maze.LEFT_OF[facing] : maze.RIGHT_OF[facing]; };

  maze.inBounds = function (map, x, y) { return x >= 0 && y >= 0 && x < map.cols && y < map.rows; };
  maze.tileAt = function (map, x, y) { return maze.inBounds(map, x, y) ? map.tiles[y].charAt(x) : '#'; };
  maze.isWalkable = function (map, x, y) { return maze.tileAt(map, x, y) === '.'; };

  /** Walkable orthogonal neighbours as [{x,y,facing}] (facing = direction of travel to get there). */
  maze.neighbors = function (map, x, y) {
    var out = [];
    for (var i = 0; i < 4; i++) {
      var f = maze.FACINGS[i], d = maze.DIRS[f];
      if (maze.isWalkable(map, x + d.dx, y + d.dy)) out.push({ x: x + d.dx, y: y + d.dy, facing: f });
    }
    return out;
  };
  /** A junction is a walkable tile with 3 or more walkable neighbours. */
  maze.isJunction = function (map, x, y) { return maze.isWalkable(map, x, y) && maze.neighbors(map, x, y).length >= 3; };

  /** Facing needed to step from tile a to the orthogonally adjacent tile b (null if not adjacent). */
  maze.facingBetween = function (a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === -1) return 'N';
    if (dx === 1 && dy === 0) return 'E';
    if (dx === 0 && dy === 1) return 'S';
    if (dx === -1 && dy === 0) return 'W';
    return null;
  };

  /** BFS shortest path over walkable tiles. Returns [{x,y}...] INCLUDING both ends, or null. */
  maze.findPath = function (map, from, to) {
    if (!maze.isWalkable(map, from.x, from.y) || !maze.isWalkable(map, to.x, to.y)) return null;
    var key = function (x, y) { return x + ',' + y; };
    var prev = {}; prev[key(from.x, from.y)] = null;
    var queue = [{ x: from.x, y: from.y }];
    while (queue.length) {
      var cur = queue.shift();
      if (cur.x === to.x && cur.y === to.y) {
        var path = [], k = key(cur.x, cur.y), node = cur;
        while (node) { path.unshift({ x: node.x, y: node.y }); node = prev[k]; if (node) k = key(node.x, node.y); }
        return path;
      }
      var ns = maze.neighbors(map, cur.x, cur.y);
      for (var i = 0; i < ns.length; i++) {
        var nk = key(ns[i].x, ns[i].y);
        if (!(nk in prev)) { prev[nk] = cur; queue.push({ x: ns[i].x, y: ns[i].y }); }
      }
    }
    return null;
  };

  /* ---------- landmarks ---------- */

  /** True if `type` (e.g. 'fountain', 'red_door', generic 'door', 'exit') names this landmark. */
  maze.landmarkMatches = function (lm, type) {
    if (!lm || !type) return false;
    if (lm.type === type || lm.id === type) return true;
    if (type === 'door') return /_door$/.test(lm.type);
    return false;
  };
  function isSolid(lm) {
    var t = MR.data && MR.data.landmarkTypes && MR.data.landmarkTypes[lm.type];
    return t ? t.solid !== false : !/_door$|^bridge$/.test(lm.type);
  }
  maze.landmarkIsSolid = isSolid;

  /** Is a walker standing on (x,y) "at" this landmark?
   *  walk-through landmarks (doors, bridge): on the same tile; solid ones: on an orthogonally adjacent tile. */
  maze.isAtLandmark = function (lm, x, y) {
    if (!isSolid(lm)) return lm.x === x && lm.y === y;
    return Math.abs(lm.x - x) + Math.abs(lm.y - y) === 1;
  };
  /** All landmarks Pip is "at" when standing on (x,y). Includes the pseudo-landmark {type:'exit'} on the exit tile. */
  maze.landmarksAt = function (map, x, y) {
    var out = [], lms = map.landmarks || [];
    for (var i = 0; i < lms.length; i++) if (maze.isAtLandmark(lms[i], x, y)) out.push(lms[i]);
    if (map.exit && map.exit.x === x && map.exit.y === y) out.push({ id: 'exit', type: 'exit', x: x, y: y });
    return out;
  };
  /** What Pip can see looking straight ahead: scan the open tiles in front of him (not his own tile) up to the wall.
   *  Returns [{type, id, dist}] nearest first, one entry per landmark (dist = steps to the first tile "at" it). */
  maze.visibleAhead = function (map, pos, facing) {
    var d = maze.DIRS[facing], out = [], seen = {};
    var x = pos.x + d.dx, y = pos.y + d.dy, dist = 1;
    while (maze.isWalkable(map, x, y)) {
      var here = maze.landmarksAt(map, x, y);
      for (var i = 0; i < here.length; i++) {
        if (!seen[here[i].id]) { seen[here[i].id] = true; out.push({ type: here[i].type, id: here[i].id, dist: dist }); }
      }
      x += d.dx; y += d.dy; dist++;
    }
    return out;
  };
  /** Number of open tiles straight ahead before the wall. */
  maze.clearAhead = function (map, pos, facing) {
    var d = maze.DIRS[facing], n = 0, x = pos.x + d.dx, y = pos.y + d.dy;
    while (maze.isWalkable(map, x, y)) { n++; x += d.dx; y += d.dy; }
    return n;
  };

  /** Fewest instructions (a turn, or one forward run of any length) from start to exit. Infinity if unsolvable. */
  maze.minInstructions = function (map) {
    if (!map.exit) return Infinity;
    var key = function (s) { return s.x + ',' + s.y + ',' + s.f; };
    var start = { x: map.start.x, y: map.start.y, f: map.start.facing };
    var dist = {}; dist[key(start)] = 0;
    var queue = [start];
    while (queue.length) {
      var s = queue.shift(), d0 = dist[key(s)];
      if (s.x === map.exit.x && s.y === map.exit.y) return d0;
      var next = [{ x: s.x, y: s.y, f: maze.LEFT_OF[s.f] }, { x: s.x, y: s.y, f: maze.RIGHT_OF[s.f] }];
      var d = maze.DIRS[s.f], x = s.x + d.dx, y = s.y + d.dy;
      while (maze.isWalkable(map, x, y)) { next.push({ x: x, y: y, f: s.f }); x += d.dx; y += d.dy; }
      for (var i = 0; i < next.length; i++) {
        var k = key(next[i]);
        if (!(k in dist)) { dist[k] = d0 + 1; queue.push(next[i]); }
      }
    }
    return Infinity;
  };

  /** Normalise a hand-written map in place: checks the shape, puts lawn under solid landmarks and
   *  turns hedge that touches no path/water (8-neighbourhood) and is not on the border into lawn ','. */
  maze.prepare = function (map) {
    map.rows = map.tiles.length; map.cols = map.tiles[0].length;
    map.landmarks = map.landmarks || [];
    var g = map.tiles.map(function (r) {
      if (r.length !== map.cols) throw new Error('map ' + map.id + ': ragged row "' + r + '"');
      return r.split('');
    });
    var x, y, i;
    var keep = {};
    for (i = 0; i < map.landmarks.length; i++) {
      var lm = map.landmarks[i];
      if (!lm.id) lm.id = lm.type;
      if (isSolid(lm)) { g[lm.y][lm.x] = ','; keep[lm.x + ',' + lm.y] = true; }
    }
    if (map.item && g[map.item.y][map.item.x] !== '.') { g[map.item.y][map.item.x] = ','; }
    var src = g.map(function (r) { return r.slice(); });
    for (y = 1; y < map.rows - 1; y++) {
      for (x = 1; x < map.cols - 1; x++) {
        if (src[y][x] !== '#') continue;
        var near = false;
        for (var dy = -1; dy <= 1 && !near; dy++) for (var dx = -1; dx <= 1; dx++) {
          var c = src[y + dy][x + dx];
          if (c === '.' || c === '~') { near = true; break; }
        }
        if (!near) g[y][x] = ',';
      }
    }
    map.tiles = g.map(function (r) { return r.join(''); });
    return map;
  };
})(typeof window !== 'undefined' ? window : globalThis);
