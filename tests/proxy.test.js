'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: b }));
    }).on('error', reject);
  });
}
async function start(env) {
  const port = 18000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'proxy.js')], { env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DEEPSEEK_API_KEY: '' }, env), stdio: 'pipe' });
  for (let i = 0; i < 50; i++) { try { await get(port, '/api/health'); return { port, child }; } catch (e) { await new Promise((r) => setTimeout(r, 50)); } }
  child.kill(); throw new Error('relay did not start');
}

test('relay reads the key from config.local.js but never serves it to the browser', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-'));
  const cfg = path.join(dir, 'config.local.js');
  fs.writeFileSync(cfg, "window.MR_CONFIG = { apiKey: 'sk-test-secret-123456', model: 'deepseek-x', speechInput: false };\n");
  const { port, child } = await start({ MR_LOCAL_CONFIG: cfg });
  try {
    const h = JSON.parse((await get(port, '/api/health')).body);
    assert.equal(h.ai, true); assert.equal(h.model, 'deepseek-x');
    const c = await get(port, '/config.local.js');
    assert.match(c.body, /proxyUrl/);
    assert.match(c.body, /"speechInput":false/);
    assert.doesNotMatch(c.body, /sk-test-secret/);
    for (const p of ['/package.json', '/.git/config', '/server/proxy.js', '/../PLAN.md', '/tests/helper.js']) {
      assert.notEqual((await get(port, p)).status, 200, p);
    }
    assert.equal((await get(port, '/')).status, 200);
  } finally { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('relay without any key serves the game in Demo mode', async () => {
  const { port, child } = await start({ MR_LOCAL_CONFIG: path.join(os.tmpdir(), 'does-not-exist.js') });
  try {
    assert.match((await get(port, '/config.local.js')).body, /"offline":true/);
    assert.equal(JSON.parse((await get(port, '/api/health')).body).ai, false);
  } finally { child.kill(); }
});

/* ------------------------------------------------------------------ hardening (review 1) */
function request(port, opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(Object.assign({ host: '127.0.0.1', port }, opts), (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body || undefined);
  });
}
/* a stand-in for DeepSeek: counts the requests that arrive with the key */
function fakeUpstream() {
  return new Promise((resolve) => {
    const seen = [];
    const srv = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => { seen.push({ auth: req.headers.authorization, body: b }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"choices":[{"message":{"content":"{}"}}]}'); });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, url: 'http://127.0.0.1:' + srv.address().port }));
  });
}

test('a path with a NUL byte (/js/core.js%00) gets 400 and the relay keeps running', async () => {
  const { port, child } = await start({ MR_LOCAL_CONFIG: path.join(os.tmpdir(), 'does-not-exist.js') });
  try {
    for (const p of ['/js/core.js%00', '/%00', '/js/%00/core.js', '/assets/voice/x%00.mp3']) assert.equal((await get(port, p)).status, 400, p);
    assert.equal((await get(port, '/js/%E0%A4%A')).status, 400, 'broken percent-encoding');
    assert.equal((await get(port, '/js/')).status, 404, 'a folder');
    assert.equal((await get(port, '/js/nothing-here.js')).status, 404);
    const ok = await get(port, '/js/core.js');
    assert.equal(ok.status, 200, 'still serving after the bad requests');
    assert.match(ok.body, /Maze Rescue - core/);
    assert.equal(child.exitCode, null, 'the process is alive');
    const head = await request(port, { method: 'HEAD', path: '/js/core.js' });
    assert.equal(head.status, 200); assert.equal(head.body, '');
    const h = JSON.parse((await get(port, '/api/health')).body);
    assert.equal(h.ok, true); assert.equal(h.app, 'maze-rescue');
  } finally { child.kill(); }
});

test('/api/chat is only for the game page: JSON only, same origin only, a host name of this computer only', async () => {
  const up = await fakeUpstream();
  const { port, child } = await start({ DEEPSEEK_API_KEY: 'sk-test-secret-123456', DEEPSEEK_BASE_URL: up.url, MR_LOCAL_CONFIG: path.join(os.tmpdir(), 'does-not-exist.js') });
  const body = JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] });
  const post = (headers) => request(port, { method: 'POST', path: '/api/chat', headers }, body);
  const me = 'http://127.0.0.1:' + port;
  try {
    /* what another web page can send without a preflight: refused, and the key is never used */
    assert.equal((await post({ 'Content-Type': 'text/plain', Origin: 'https://evil.example' })).status, 415);
    assert.equal((await post({ 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post({ 'Content-Type': 'application/x-www-form-urlencoded', Origin: me })).status, 415);
    assert.equal((await post({})).status, 415);
    assert.equal((await post({ 'Content-Type': 'application/json', Origin: 'https://evil.example' })).status, 403, 'another origin');
    assert.equal((await post({ 'Content-Type': 'application/json', Origin: 'null' })).status, 403, 'a sandboxed page / a file');
    assert.equal((await post({ 'Content-Type': 'application/json', Origin: me, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await post({ 'Content-Type': 'application/json', Host: 'attacker.example:' + port, Origin: 'http://attacker.example:' + port })).status, 403, 'DNS rebinding: a foreign name for this address');
    assert.equal(up.seen.length, 0, 'none of these reached the model');
    /* the game page itself */
    let r = await post({ 'Content-Type': 'application/json', Origin: me, 'Sec-Fetch-Site': 'same-origin' });
    assert.equal(r.status, 200);
    r = await post({ 'Content-Type': 'application/json; charset=utf-8', Host: 'localhost:' + port, Origin: 'http://localhost:' + port });
    assert.equal(r.status, 200, 'http://localhost works too');
    r = await post({ 'Content-Type': 'application/json' });
    assert.equal(r.status, 200, 'no Origin header (not a browser): allowed');
    assert.equal(up.seen.length, 3);
    assert.equal(up.seen[0].auth, 'Bearer sk-test-secret-123456');
    assert.equal((await request(port, { method: 'OPTIONS', path: '/api/chat', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } })).status, 405, 'a preflight is never approved');
  } finally { child.kill(); up.srv.close(); }
});

test('a broken config.local.js cannot hang the relay and is reported; a missing one is silent', async () => {
  const { publicUrl } = require('../server/proxy.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-'));
  /* each file is read in a fresh Node process, as the relay does at start; the process must END by itself */
  const run = (src) => {
    const f = path.join(dir, 'c' + Math.random() + '.js');
    if (src != null) fs.writeFileSync(f, src);
    const code = 'const w=[];const c=require(' + JSON.stringify(path.join(__dirname, '..', 'server', 'proxy.js')) + ').readLocalConfig(' + JSON.stringify(f) +
      ',(m)=>w.push(m));setTimeout(()=>console.log(JSON.stringify({c,w})),10)';
    const t = Date.now();
    const r = require('child_process').spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 8000 });
    assert.equal(r.status, 0, 'the process ended by itself: ' + r.stderr);
    return Object.assign(JSON.parse(r.stdout), { ms: Date.now() - t });
  };
  try {
    let r = run("window.MR_CONFIG = { apiKey: 'k', speechInput: false };");
    assert.deepEqual(r.c, { apiKey: 'k', speechInput: false }); assert.equal(r.w.length, 0);
    r = run("window.MR_CONFIG = { apiKey: 'k' ;");
    assert.deepEqual(r.c, {}); assert.equal(r.w.length, 1); assert.match(r.w[0], /config\.local\.js has a mistake/);
    r = run('while (true) {}');
    assert.deepEqual(r.c, {}); assert.equal(r.w.length, 1);
    r = run("window.MR_CONFIG = { apiKey: 'k' }; (function f() { Promise.resolve().then(f); })();");
    assert.deepEqual(r.c, {}, 'a promise loop is stopped too, and a timer still runs afterwards'); assert.equal(r.w.length, 1);
    r = run(null);
    assert.deepEqual(r.c, {}); assert.equal(r.w.length, 0, 'no warning for a missing file');
    /* every address shown for this computer is http://localhost (one origin = one microphone permission) */
    assert.equal(publicUrl('127.0.0.1', 8787), 'http://localhost:8787/');
    assert.equal(publicUrl('0.0.0.0', 8787), 'http://localhost:8787/');
    assert.equal(publicUrl('192.168.1.20', 8787), 'http://192.168.1.20:8787/');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  /* started with a broken file: one warning line, Demo mode, and it listens */
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-'));
  const cfg = path.join(dir2, 'config.local.js');
  fs.writeFileSync(cfg, "window.MR_CONFIG = { apiKey: 'sk-oops' \n speechInput: true };\n");
  const { port, child } = await start({ MR_LOCAL_CONFIG: cfg });
  let err = ''; child.stderr.on('data', (c) => { err += c; });
  let out = ''; child.stdout.on('data', (c) => { out += c; });
  try {
    assert.equal(JSON.parse((await get(port, '/api/health')).body).ai, false);
    await new Promise((res) => setTimeout(res, 150));
    assert.match(err + out, /config\.local\.js has a mistake/);
    assert.match(out, new RegExp('http://localhost:' + port + '/'), 'prints the localhost address, not 127.0.0.1');
    assert.doesNotMatch(out, /127\.0\.0\.1/);
  } finally { child.kill(); fs.rmSync(dir2, { recursive: true, force: true }); }
});

test('a busy port: one clear line and exit code 1, no stack trace', async () => {
  const blocker = http.createServer((req, res) => res.end('other program'));
  await new Promise((res) => blocker.listen(0, '127.0.0.1', res));
  const port = blocker.address().port;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'proxy.js')], { env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DEEPSEEK_API_KEY: '' }), stdio: 'pipe' });
  let err = ''; child.stderr.on('data', (c) => { err += c; });
  const code = await new Promise((res) => child.on('exit', res));
  blocker.close();
  assert.equal(code, 1);
  assert.match(err, new RegExp('Port ' + port + ' is busy - is Maze Rescue already open\\?'));
  assert.doesNotMatch(err, /at Server\.|EADDRINUSE|node:net/);
});

test('Python fallback (no Node.js): serves only the game, never config.local.js with a key, .git or anything else', async (t) => {
  const { spawnSync } = require('child_process');
  const py = ['python3', 'python'].find((c) => { try { return spawnSync(c, ['-c', 'import http.server, sys; sys.exit(0 if sys.version_info[0] == 3 else 1)']).status === 0; } catch (e) { return false; } });
  if (!py) { t.skip('no Python 3 on this computer'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-'));
  const cfg = path.join(dir, 'config.local.js');
  fs.writeFileSync(cfg, "/* my key */\nwindow.MR_CONFIG = {\n  apiKey: 'sk-test-secret-123456', // do not share\n  speechInput: false,\n  speechLang: 'en-GB'\n};\n");
  const port = 20000 + Math.floor(Math.random() * 2000);
  const child = spawn(py, [path.join(__dirname, '..', 'server', 'fallback.py'), String(port)], { env: Object.assign({}, process.env, { MR_LOCAL_CONFIG: cfg }), stdio: 'pipe' });
  let out = ''; child.stdout.on('data', (c) => { out += c; });
  try {
    let up = false;
    for (let i = 0; i < 80 && !up; i++) { try { await get(port, '/api/health'); up = true; } catch (e) { await new Promise((r) => setTimeout(r, 50)); } }
    assert.ok(up, 'fallback server started');
    const h = await get(port, '/api/health');
    assert.match(h.body, /"ok":true/); assert.match(h.body, /"app":"maze-rescue"/); assert.match(h.body, /"ai":false/);
    const c = await get(port, '/config.local.js');
    assert.equal(c.status, 200);
    assert.doesNotMatch(c.body, /sk-test-secret|apiKey/, 'the key never reaches the browser');
    assert.match(c.body, /"offline": ?true/); assert.match(c.body, /"speechInput": ?false/); assert.match(c.body, /"speechLang": ?"en-GB"/);
    for (const p of ['/.git/config', '/.git/HEAD', '/.gitignore', '/server/proxy.js', '/server/fallback.py', '/PLAN.md', '/README.md', '/tests/helper.js', '/package.json',
      '/js/../PLAN.md', '/js/%2e%2e/PLAN.md', '/js/..%2fPLAN.md', '/js/core.js%00', '/js/', '/assets/', '/node_modules/playwright/package.json', '/start-mac.command']) {
      const r = await request(port, { method: 'GET', path: p });
      assert.equal(r.status, 404, p);
      assert.doesNotMatch(r.body, /Directory listing|sk-test/, p);
    }
    assert.equal((await get(port, '/')).status, 200);
    assert.match((await get(port, '/js/core.js')).body, /Maze Rescue - core/);
    assert.equal((await get(port, '/css/base.css')).status, 200);
    assert.equal((await request(port, { method: 'POST', path: '/api/chat', headers: { 'Content-Type': 'application/json' } }, '{}')).status, 404);
    await new Promise((r) => setTimeout(r, 100));
    assert.match(out, /http:\/\/localhost:/);
    assert.match(out, /key is NOT sent to the browser/, 'the launcher window explains why the AI is off');
    assert.doesNotMatch(out, /sk-test-secret/);
  } finally { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('launchers: health check with -f, --max-time and "ok":true; no bare "python -m http.server"; the .bat keeps CRLF and waits before opening', () => {
  const mac = fs.readFileSync(path.join(__dirname, '..', 'start-mac.command'), 'utf8');
  const bat = fs.readFileSync(path.join(__dirname, '..', 'start-windows.bat'), 'utf8');
  assert.match(mac, /curl -sf --max-time 2 [^\n]*\/api\/health/);
  assert.match(mac, /grep '"ok":true'/);
  assert.match(mac, /server\/fallback\.py/);
  assert.match(bat, /server\\fallback\.py/);
  for (const [name, src] of [['mac', mac], ['bat', bat]]) assert.doesNotMatch(src, /-m http\.server/, name + ': the whole folder is never served');
  assert.ok(!/[^\r]\n/.test(bat) && /\r\n/.test(bat), 'CRLF line ends only');
  assert.ok(bat.indexOf('ping -n 3') > 0 && bat.indexOf('ping -n 3') < bat.indexOf('node server\\proxy.js'), 'the browser opens after a wait, set up before node starts');
  assert.match(bat, /curl -sf --max-time 2 [^\r\n]*\/api\/health/);
  assert.doesNotMatch(bat, /where python/, 'the Microsoft Store stub is not taken for Python');
  assert.ok((fs.statSync(path.join(__dirname, '..', 'start-mac.command')).mode & 0o111) !== 0, 'start-mac.command is executable');
});
