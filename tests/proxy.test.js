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
