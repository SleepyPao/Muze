'use strict';
/* The web version's AI relay (cloud/worker.mjs, a Cloudflare Worker), run in Node with fake DeepSeek answers. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const W = () => import(path.join(__dirname, '..', 'cloud', 'worker.mjs'));
const SITE = 'https://sleepypao.github.io';
const ENV = { DEEPSEEK_API_KEY: 'test-key-not-real' };
const GOOD = { model: 'anything', messages: [{ role: 'system', content: 'You are Pip.' }, { role: 'user', content: '{"text":"Where is it?"}' }],
  temperature: 0.2, max_tokens: 400, class_no: '5A-12', stream: true };

function req(method, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.origin === null ? {} : { Origin: opts.origin || SITE },
    method === 'POST' ? { 'Content-Type': opts.type || 'application/json' } : {}, opts.ip ? { 'CF-Connecting-IP': opts.ip } : {});
  return new Request('https://muze-ai.example.workers.dev' + (opts.path || '/api/chat'),
    { method, headers, body: method === 'POST' ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body || GOOD)) : undefined });
}
function fakeDeepSeek(calls, answer) {
  return async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (answer === 'THROW') throw new Error('network');
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"category":"place"}' } }] }), { status: answer || 200 });
  };
}

test('worker: GET tells the game whether the relay has a key; CORS only for the game\'s own sites', async () => {
  const { handle } = await W();
  let r = await handle(req('GET'), ENV);
  assert.deepEqual(await r.json(), { ok: true, app: 'maze-rescue', ai: true });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), SITE);
  r = await handle(req('GET'), {});
  assert.equal((await r.json()).ai, false, 'no secret set yet');
  r = await handle(req('OPTIONS'), ENV);
  assert.equal(r.status, 204);
  assert.match(r.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
  r = await handle(req('OPTIONS', { origin: 'https://evil.example' }), ENV);
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await handle(req('GET', { path: '/' }), ENV)).status, 404);
});

test('worker: refuses other sites, wrong content type, no key, and requests that are not the game\'s', async () => {
  const { handle } = await W();
  const calls = [], deps = { fetch: fakeDeepSeek(calls) };
  assert.equal((await handle(req('POST', { origin: 'https://evil.example', ip: 'a1' }), ENV, deps)).status, 403);
  assert.equal((await handle(req('POST', { origin: null, ip: 'a1' }), ENV, deps)).status, 403, 'no Origin header: not a page of the game');
  assert.equal((await handle(req('POST', { type: 'text/plain', ip: 'a1' }), ENV, deps)).status, 415);
  assert.equal((await handle(req('POST', { ip: 'a1' }), {}, deps)).status, 503);
  assert.equal((await handle(req('POST', { body: '{bad', ip: 'a1' }), ENV, deps)).status, 400);
  assert.equal((await handle(req('POST', { body: { messages: [] }, ip: 'a1' }), ENV, deps)).status, 400);
  assert.equal((await handle(req('POST', { body: { messages: [{ role: 'assistant', content: 'x' }] }, ip: 'a1' }), ENV, deps)).status, 400);
  assert.equal((await handle(req('POST', { body: { messages: [{ role: 'user', content: 'x'.repeat(9000) }] }, ip: 'a1' }), ENV, deps)).status, 400);
  assert.equal(calls.length, 0, 'none of these reached DeepSeek');
});

test('worker: forwards only what the game sends, with the secret key, JSON mode and thinking off', async () => {
  const { handle } = await W();
  const calls = [];
  const r = await handle(req('POST', { ip: 'b1' }), Object.assign({ DEEPSEEK_MODEL: 'deepseek-flash' }, ENV), { fetch: fakeDeepSeek(calls) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.equal((await r.json()).choices[0].message.content, '{"category":"place"}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key-not-real');
  assert.deepEqual(calls[0].body, { model: 'deepseek-flash', messages: GOOD.messages, response_format: { type: 'json_object' },
    temperature: 0.2, max_tokens: 400, thinking: { type: 'disabled' }, stream: false });
  assert.ok(!('class_no' in calls[0].body), 'nothing about the pupil is passed on');
});

test('worker: DeepSeek errors are passed through, no answer is a 504, and there is a rate limit', async () => {
  const { handle } = await W();
  const calls = [];
  assert.equal((await handle(req('POST', { ip: 'c1' }), ENV, { fetch: fakeDeepSeek(calls, 402) })).status, 402, '402 = no balance: the teacher view says so');
  assert.equal((await handle(req('POST', { ip: 'c1' }), ENV, { fetch: fakeDeepSeek(calls, 'THROW') })).status, 504);
  let last;
  for (let i = 0; i < 31; i++) last = await handle(req('POST', { ip: 'c2' }), ENV, { fetch: fakeDeepSeek(calls), now: () => 1000 });
  assert.equal(last.status, 429, '31st request in one minute from one address');
  const other = await handle(req('POST', { ip: 'c3' }), ENV, { fetch: fakeDeepSeek(calls), now: () => 1000 });
  assert.equal(other.status, 200, 'another address is not affected');
  const limiter = { limit: async () => ({ success: false }) };
  assert.equal((await handle(req('POST', { ip: 'c4' }), Object.assign({ LIMITER: limiter }, ENV), { fetch: fakeDeepSeek(calls) })).status, 429, 'the Cloudflare rate-limit binding is used when present');
});

test('no API key anywhere in the published files (web config, relay, wrangler.toml)', () => {
  const root = path.join(__dirname, '..');
  for (const f of ['config.public.js', 'config.example.js', 'cloud/worker.mjs', 'cloud/wrangler.toml', 'index.html']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/sk-[A-Za-z0-9]{12,}/.test(src), f + ' has something that looks like a key');
    assert.ok(!/apiKey\s*:\s*'[^']+'/.test(src), f + ' sets an apiKey');
  }
});
