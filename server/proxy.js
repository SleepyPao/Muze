#!/usr/bin/env node
/* Maze Rescue - tiny zero-dependency relay for whole-class use.
 *
 *   DEEPSEEK_API_KEY=sk-...  node server/proxy.js       (or put apiKey in config.local.js: read here, never served)
 *   Double-click start-mac.command / start-windows.bat to run it on this computer only (http://localhost:8787/).
 *   Opening the game from http://localhost (not file://) lets Chrome REMEMBER the microphone permission.
 *
 * - Serves the game (static files from the repo root) on http://0.0.0.0:8787/
 * - POST /api/chat  -> forwards the chat request to DeepSeek with the key from the environment.
 *   The key never reaches a browser. The relay forwards only model / messages / response_format /
 *   temperature / max_tokens; it adds nothing about the pupil and writes no request bodies to disk or console.
 *   Only the game's own page may use it: the request must be JSON (Content-Type: application/json), come from
 *   this server's own origin, and name this computer in its Host header. Another web page cannot spend the key.
 * - GET /config.local.js is GENERATED here ({ proxyUrl: '/api/chat' }); a real config.local.js on disk is never served.
 * - Without DEEPSEEK_API_KEY the relay still serves the game, in Demo mode.
 * - A bad request never stops the server (every file access is guarded).
 *
 * Environment: DEEPSEEK_API_KEY, PORT (8787), HOST (0.0.0.0), DEEPSEEK_BASE_URL (https://api.deepseek.com),
 *              DEEPSEEK_MODEL (deepseek-flash), UPSTREAM_TIMEOUT_MS (10000),
 *              ALLOWED_HOSTS (extra host names pupils may type, comma separated, e.g. "teacher-laptop.school.lan")
 */
'use strict';
var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var os = require('os');
var URL = require('url').URL;

var vm = require('vm');
var ROOT = path.resolve(__dirname, '..');

/** Read config.local.js on the SERVER (it is never sent to a browser). Returns window.MR_CONFIG or {}.
 *  A missing file is normal (Demo mode). A file that cannot be run (a typing mistake) gives {} and ONE warning line,
 *  so the teacher knows why the AI is off. The file runs in an empty sandbox with a 200 ms limit, which also covers
 *  promise loops (microtaskMode), so a broken file can never hang the server.
 *  @param {string} file  @param {function(string)} [warn]  default: console.error */
function readLocalConfig(file, warn) {
  var src;
  try { src = fs.readFileSync(file, 'utf8'); }
  catch (e) {
    if (e && e.code !== 'ENOENT') (warn || console.error)('config.local.js could not be read: ' + e.message);
    return {};
  }
  try {
    var ctx = vm.createContext({ window: {} }, { microtaskMode: 'afterEvaluate' });
    vm.runInContext(src, ctx, { timeout: 200, filename: 'config.local.js' });
    /* copy plain values out of the sandbox (no getters or sandbox objects leave it) */
    var c = JSON.parse(vm.runInContext('JSON.stringify(window.MR_CONFIG || null)', ctx, { timeout: 200 }) || 'null');
    return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
  } catch (e2) {
    (warn || console.error)('config.local.js has a mistake and was NOT used (' + String(e2 && e2.message).split('\n')[0] + '). The game runs in Demo mode.');
    return {};
  }
}
var LOCAL = readLocalConfig(process.env.MR_LOCAL_CONFIG || path.join(ROOT, 'config.local.js'));
var PORT = parseInt(process.env.PORT || '8787', 10);
var HOST = process.env.HOST || '0.0.0.0';
var KEY = LOCAL.offline ? '' : (process.env.DEEPSEEK_API_KEY || LOCAL.apiKey || '');
var KEY_SOURCE = process.env.DEEPSEEK_API_KEY ? 'DEEPSEEK_API_KEY' : 'config.local.js';
var BASE = (process.env.DEEPSEEK_BASE_URL || LOCAL.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
var MODEL = process.env.DEEPSEEK_MODEL || LOCAL.model || 'deepseek-flash';
/* browser-side settings that may be passed on (never the key) */
var PASS_ON = ['speechInput', 'speechOutput', 'speechLang', 'timeoutMs'];
var UPSTREAM_TIMEOUT = parseInt(process.env.UPSTREAM_TIMEOUT_MS || '10000', 10);
var MAX_BODY = 16 * 1024;
var RATE_PER_MIN = 60;              /* per client address */

var TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
var PUBLIC_DIRS = ['js', 'css', 'assets'];
var PUBLIC_FILES = ['index.html', 'config.example.js'];

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
function sendJSON(res, status, obj) { send(res, status, JSON.stringify(obj)); }

/* ---------- static files (whitelist: index.html, js/, css/, assets/) ---------- */
function serveStatic(req, res, pathname) {
  var rel;
  try { rel = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch (e) { return send(res, 400, 'Bad request', 'text/plain'); }
  if (rel.indexOf('\0') >= 0) return send(res, 400, 'Bad request', 'text/plain');     /* "%00": fs would throw */
  if (rel === '') rel = 'index.html';
  if (rel === 'config.local.js') {
    var cfg = KEY ? { proxyUrl: '/api/chat', model: MODEL } : { offline: true };
    PASS_ON.forEach(function (k) { if (LOCAL[k] != null) cfg[k] = LOCAL[k]; });
    return send(res, 200, 'window.MR_CONFIG = ' + JSON.stringify(cfg) + ';\n', TYPES['.js']);
  }
  var file = path.resolve(ROOT, rel);
  var inside = path.relative(ROOT, file);
  if (inside.startsWith('..') || path.isAbsolute(inside)) return send(res, 403, 'Forbidden', 'text/plain');
  var top = inside.split(path.sep)[0];
  var allowed = PUBLIC_FILES.indexOf(inside) >= 0 || (PUBLIC_DIRS.indexOf(top) >= 0 && inside !== top);
  if (!allowed || inside.split(path.sep).some(function (p) { return p.charAt(0) === '.'; })) return send(res, 404, 'Not found', 'text/plain');
  try {
    fs.stat(file, function (err, st) {
      if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain');
      var stream;
      try { stream = fs.createReadStream(file); } catch (e) { return send(res, 500, 'Server error', 'text/plain'); }
      stream.on('error', function () {                 /* the file went away or cannot be read: end the answer, keep serving */
        if (!res.headersSent) send(res, 404, 'Not found', 'text/plain'); else res.destroy();
      });
      stream.once('open', function () {
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        if (req.method === 'HEAD') { stream.destroy(); return res.end(); }
        stream.pipe(res);
      });
      res.on('close', function () { stream.destroy(); });
    });
  } catch (e) { send(res, 400, 'Bad request', 'text/plain'); }   /* a path Node refuses */
}

/* ---------- rate limit ---------- */
var hits = {};
function limited(addr) {
  var now = Date.now(), list = (hits[addr] || []).filter(function (t) { return now - t < 60000; });
  list.push(now); hits[addr] = list;
  return list.length > RATE_PER_MIN;
}
setInterval(function () { hits = {}; }, 5 * 60000).unref();

/* ---------- chat relay ---------- */
function cleanRequest(body) {
  if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 4) return null;
  var total = 0, messages = [];
  for (var i = 0; i < body.messages.length; i++) {
    var m = body.messages[i];
    if (!m || (m.role !== 'system' && m.role !== 'user') || typeof m.content !== 'string') return null;
    total += m.content.length;
    messages.push({ role: m.role, content: m.content });
  }
  if (total > 8000) return null;
  var temp = Number(body.temperature), max = Number(body.max_tokens);
  return {
    model: MODEL,
    messages: messages,
    response_format: { type: 'json_object' },
    temperature: temp >= 0 && temp <= 1 ? temp : 0.2,
    max_tokens: max >= 1 && max <= 800 ? Math.floor(max) : 400,
    stream: false
  };
}
/* ---------- who may use the relay ----------
 * Only the game page this server serves. A page from another site could otherwise POST to http://localhost:8787/api/chat
 * and spend the key (it cannot read the answer, but the request is paid for). Three checks:
 *   1. Content-Type must be application/json. Another site cannot send that without a CORS preflight, and this server
 *      never answers a preflight.
 *   2. Origin (browsers send it with every POST) / Sec-Fetch-Site must be this server itself.
 *   3. Host must be a name of this computer (stops "DNS rebinding": a foreign name that points at 127.0.0.1). */
function localNames() {
  var names = { 'localhost': true, '127.0.0.1': true, '[::1]': true };
  names[String(os.hostname()).toLowerCase()] = true;
  names[String(os.hostname()).toLowerCase().replace(/\.local$/, '') + '.local'] = true;
  var ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(function (k) { (ifs[k] || []).forEach(function (a) { names[a.family === 'IPv6' || a.family === 6 ? '[' + a.address.toLowerCase() + ']' : a.address] = true; }); });
  if (HOST && HOST !== '0.0.0.0' && HOST !== '::') names[HOST.toLowerCase()] = true;
  String(process.env.ALLOWED_HOSTS || '').split(',').forEach(function (h) { h = h.trim().toLowerCase(); if (h) names[h] = true; });
  return names;
}
function hostName(host) { return String(host || '').toLowerCase().replace(/:\d+$/, ''); }
/** null when the request may use the relay, else {status, error}. */
function relayRefusal(req) {
  var type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return { status: 415, error: 'Content-Type must be application/json' };
  var host = String(req.headers.host || '').toLowerCase();
  if (!host || !localNames()[hostName(host)]) return { status: 403, error: 'unknown host' };
  var origin = req.headers.origin;
  if (origin != null && String(origin).toLowerCase() !== 'http://' + host) return { status: 403, error: 'other origin' };
  var site = req.headers['sec-fetch-site'];
  if (site != null && site !== 'same-origin') return { status: 403, error: 'other origin' };
  return null;
}
function relay(req, res) {
  var no = relayRefusal(req);
  if (no) { req.resume(); return sendJSON(res, no.status, { error: no.error }); }
  if (!KEY) return sendJSON(res, 503, { error: 'relay has no API key' });
  if (limited(req.socket.remoteAddress || '?')) return sendJSON(res, 429, { error: 'too many requests' });
  var chunks = [], size = 0, tooBig = false;
  req.on('data', function (c) {
    size += c.length;
    if (size > MAX_BODY) { tooBig = true; req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', function () {
    if (tooBig) return;
    var parsed;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return sendJSON(res, 400, { error: 'invalid JSON' }); }
    var payload = cleanRequest(parsed);
    if (!payload) return sendJSON(res, 400, { error: 'invalid request' });
    var target = new URL(BASE + '/chat/completions');
    var data = Buffer.from(JSON.stringify(payload));
    var lib = target.protocol === 'http:' ? http : https;
    var done = false;
    var up = lib.request({
      method: 'POST', hostname: target.hostname, port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: target.pathname + target.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Authorization: 'Bearer ' + KEY }
    }, function (upRes) {
      var out = [];
      upRes.on('data', function (c) { out.push(c); });
      upRes.on('end', function () {
        if (done) return; done = true;
        var status = upRes.statusCode || 502;
        if (status >= 400) console.error('[relay] upstream status ' + status);
        send(res, status, Buffer.concat(out));
      });
    });
    up.setTimeout(UPSTREAM_TIMEOUT, function () { up.destroy(new Error('timeout')); });
    up.on('error', function (err) {
      if (done) return; done = true;
      console.error('[relay] upstream error: ' + err.message);
      sendJSON(res, 504, { error: 'upstream unavailable' });
    });
    up.end(data);
  });
  req.on('error', function () { /* client went away */ });
}

var server = http.createServer(function (req, res) {
  var pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (e) { return send(res, 400, 'Bad request', 'text/plain'); }
  if (pathname === '/api/chat') {
    if (req.method !== 'POST') return sendJSON(res, 405, { error: 'POST only' });
    return relay(req, res);
  }
  if (pathname === '/api/health') return sendJSON(res, 200, { ok: true, app: 'maze-rescue', ai: !!KEY, model: MODEL });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
  serveStatic(req, res, pathname);
});

server.on('clientError', function (err, socket) { try { socket.destroy(); } catch (e) { /* ignore */ } });

/** The address to show and to open. Always "localhost" for this computer: Chrome keeps the microphone permission
 *  per address, and http://localhost:8787 and http://127.0.0.1:8787 count as two different sites. */
function publicUrl(host, port) {
  var local = !host || host === '0.0.0.0' || host === '::' || host === '127.0.0.1' || host === '::1' || host === 'localhost';
  return 'http://' + (local ? 'localhost' : host) + ':' + port + '/';
}

if (require.main === module) {
  server.on('error', function (err) {
    if (err && err.code === 'EADDRINUSE') {
      console.error('Port ' + PORT + ' is busy - is Maze Rescue already open? Close the other window (or the other program on port ' + PORT + ') and start again.');
    } else {
      console.error('Maze Rescue could not start: ' + (err && err.message));
    }
    process.exit(1);
  });
  server.listen(PORT, HOST, function () {
    console.log('Maze Rescue relay on ' + publicUrl(HOST, PORT));
    console.log(KEY ? 'AI: on (model ' + MODEL + ', key from ' + KEY_SOURCE + ', kept on this computer)' : 'AI: OFF - no key, the game runs in Demo mode');
  });
}
module.exports = { server: server, cleanRequest: cleanRequest, readLocalConfig: readLocalConfig, relayRefusal: relayRefusal, publicUrl: publicUrl };
