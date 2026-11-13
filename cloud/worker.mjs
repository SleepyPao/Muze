/* Maze Rescue - AI relay for the PUBLIC web version (GitHub Pages), as a Cloudflare Worker.
 *
 * The web page is public, so the DeepSeek key can never be in it. The key lives here, as an encrypted Worker secret
 * (wrangler secret put DEEPSEEK_API_KEY); the page only knows this Worker's address (config.public.js).
 * Deploy: see cloud/README.md.
 *
 *   GET  /api/chat   -> {ok:true, app:'maze-rescue', ai:<has a key>}   (the game checks this once at start)
 *   POST /api/chat   -> forwards ONE chat request to DeepSeek and returns DeepSeek's answer
 *
 * The same rules as the classroom relay (server/proxy.js):
 *   - only model / messages (max 4, max 8000 characters) / temperature / max_tokens pass; the model, JSON mode and
 *     "thinking: disabled" are set here. Nothing about the pupil is added; nothing is stored or logged.
 *   - only pages from ALLOWED_ORIGINS (default: the GitHub Pages site and the local relay) may call it (CORS);
 *   - at most RATE_PER_MIN requests per minute per address (Cloudflare rate-limit binding LIMITER when present,
 *     else a per-instance counter). Set a monthly limit on the DeepSeek account as well.
 */
const DEFAULT_ORIGINS = 'https://sleepypao.github.io,http://localhost:8787,http://127.0.0.1:8787';
const DEFAULT_MODEL = 'deepseek-flash';
const MAX_BODY = 16 * 1024;
const RATE_PER_MIN = 30;
const UPSTREAM_TIMEOUT_MS = 10000;

/** Keep only what the game sends; null when the request is not a Maze Rescue request. */
export function cleanRequest(body, model) {
  if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 4) return null;
  let total = 0;
  const messages = [];
  for (const m of body.messages) {
    if (!m || (m.role !== 'system' && m.role !== 'user') || typeof m.content !== 'string') return null;
    total += m.content.length;
    messages.push({ role: m.role, content: m.content });
  }
  if (total > 8000) return null;
  const temp = Number(body.temperature), max = Number(body.max_tokens);
  return {
    model: model || DEFAULT_MODEL,
    messages,
    response_format: { type: 'json_object' },
    temperature: temp >= 0 && temp <= 1 ? temp : 0.2,
    max_tokens: max >= 1 && max <= 800 ? Math.floor(max) : 400,
    thinking: { type: 'disabled' },
    stream: false
  };
}

function origins(env) {
  return String((env && env.ALLOWED_ORIGINS) || DEFAULT_ORIGINS).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function cors(origin) {
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
}
function json(status, obj, extra) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, extra || {}) });
}

const hits = new Map();   /* per-instance fallback when there is no LIMITER binding */
async function limited(env, addr, now) {
  if (env && env.LIMITER && typeof env.LIMITER.limit === 'function') {
    try { const r = await env.LIMITER.limit({ key: addr }); return !r.success; } catch (e) { /* fall through */ }
  }
  const list = (hits.get(addr) || []).filter((t) => now - t < 60000);
  list.push(now); hits.set(addr, list);
  if (hits.size > 5000) hits.clear();
  return list.length > RATE_PER_MIN;
}

/** The whole Worker. `deps.fetch` / `deps.now` let the tests replace the network and the clock. */
export async function handle(request, env, deps) {
  env = env || {};
  deps = deps || {};
  const url = new URL(request.url);
  if (url.pathname !== '/api/chat') return json(404, { error: 'not found' });
  const origin = String(request.headers.get('Origin') || '').toLowerCase();
  const allowed = origin && origins(env).includes(origin);
  const head = allowed ? cors(origin) : {};

  if (request.method === 'OPTIONS') return allowed ? new Response(null, { status: 204, headers: head }) : json(403, { error: 'other origin' });
  if (request.method === 'GET') return json(200, { ok: true, app: 'maze-rescue', ai: !!env.DEEPSEEK_API_KEY }, head);
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' }, head);
  if (!allowed) return json(403, { error: 'other origin' });
  const type = String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return json(415, { error: 'Content-Type must be application/json' }, head);
  if (!env.DEEPSEEK_API_KEY) return json(503, { error: 'relay has no API key' }, head);
  const addr = request.headers.get('CF-Connecting-IP') || '?';
  if (await limited(env, addr, deps.now ? deps.now() : Date.now())) return json(429, { error: 'too many requests' }, head);

  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, { error: 'request too large' }, head);
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return json(400, { error: 'invalid JSON' }, head); }
  const payload = cleanRequest(parsed, env.DEEPSEEK_MODEL);
  if (!payload) return json(400, { error: 'invalid request' }, head);

  const base = String(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const f = deps.fetch || fetch;
  try {
    const up = await f(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.DEEPSEEK_API_KEY },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
    const body = await up.text();
    return new Response(body, { status: up.status, headers: Object.assign({ 'Content-Type': 'application/json' }, head) });
  } catch (e) {
    return json(504, { error: 'upstream unavailable' }, head);
  }
}

export default { fetch: (request, env) => handle(request, env) };
