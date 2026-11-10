#!/usr/bin/env node
/* Maze Rescue - tiny zero-dependency relay for whole-class use.
 *
 *   DEEPSEEK_API_KEY=sk-...  node server/proxy.js
 *
 * - Serves the game (static files from the repo root) on http://0.0.0.0:8787/
 * - POST /api/chat  -> forwards the chat request to DeepSeek with the key from the environment.
 *   The key never reaches a browser. The relay forwards only model / messages / response_format /
 *   temperature / max_tokens; it adds nothing about the pupil and writes no request bodies to disk or console.
 * - GET /config.local.js is GENERATED here ({ proxyUrl: '/api/chat' }); a real config.local.js on disk is never served.
 * - Without DEEPSEEK_API_KEY the relay still serves the game, in Demo mode.
 *
 * Environment: DEEPSEEK_API_KEY, PORT (8787), HOST (0.0.0.0), DEEPSEEK_BASE_URL (https://api.deepseek.com),
 *              DEEPSEEK_MODEL (deepseek-flash), UPSTREAM_TIMEOUT_MS (10000)
 */
'use strict';
var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var URL = require('url').URL;

var ROOT = path.resolve(__dirname, '..');
var PORT = parseInt(process.env.PORT || '8787', 10);
var HOST = process.env.HOST || '0.0.0.0';
var KEY = process.env.DEEPSEEK_API_KEY || '';
var BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
var MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
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
  if (rel === '') rel = 'index.html';
  if (rel === 'config.local.js') {
    var cfg = KEY ? { proxyUrl: '/api/chat', model: MODEL } : { offline: true };
    return send(res, 200, 'window.MR_CONFIG = ' + JSON.stringify(cfg) + ';\n', TYPES['.js']);
  }
  var file = path.resolve(ROOT, rel);
  var inside = path.relative(ROOT, file);
  if (inside.startsWith('..') || path.isAbsolute(inside)) return send(res, 403, 'Forbidden', 'text/plain');
  var top = inside.split(path.sep)[0];
  var allowed = PUBLIC_FILES.indexOf(inside) >= 0 || (PUBLIC_DIRS.indexOf(top) >= 0 && inside !== top);
  if (!allowed || inside.split(path.sep).some(function (p) { return p.charAt(0) === '.'; })) return send(res, 404, 'Not found', 'text/plain');
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
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
function relay(req, res) {
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
  if (pathname === '/api/health') return sendJSON(res, 200, { ok: true, ai: !!KEY, model: MODEL });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
  serveStatic(req, res, pathname);
});

if (require.main === module) {
  server.listen(PORT, HOST, function () {
    console.log('Maze Rescue relay on http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + '/');
    console.log(KEY ? 'AI: on (model ' + MODEL + ', key from DEEPSEEK_API_KEY)' : 'AI: OFF - no DEEPSEEK_API_KEY, the game runs in Demo mode');
  });
}
module.exports = { server: server, cleanRequest: cleanRequest };
