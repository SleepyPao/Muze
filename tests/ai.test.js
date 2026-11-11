'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh } = require('./helper');

/** A fake fetch that answers with the queued model outputs (string = message content, null = HTTP 500, 'HANG' = never). */
function fakeFetch(queue, calls) {
  return (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = queue.shift();
    if (next === 'HANG') return new Promise(() => {});
    if (next === 'THROW') return Promise.reject(new Error('network'));
    if (next === null) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
    return Promise.resolve({ ok: true, json: async () => ({ choices: [{ message: { content: next } }] }) });
  };
}
function online(MR, queue, extra) {
  const calls = [];
  globalThis.MR_CONFIG = Object.assign({ apiKey: 'test-key-not-real', timeoutMs: 80 }, extra || {});
  MR.ai._fetch = fakeFetch(queue, calls);
  MR.ai.reset();
  return calls;
}

test('no key -> offline "Demo mode", answers come from the rules', async () => {
  const MR = fresh();
  assert.equal(MR.ai.mode(), 'offline');
  const r = await MR.ai.ask({ item: 'key', given: [], text: 'Where it is?' });
  assert.deepEqual([r.category, r.fact_given, r.failed, r.source], ['place', 'place', false, 'rules']);
  const g = await MR.ai.guide({ text: 'turn' });
  assert.deepEqual([g.actions.length, g.clarify, g.source], [0, 'Left or right?', 'rules']);
});

test('mode: direct with a key, proxy with a proxyUrl, offline when forced', () => {
  const MR = fresh();
  globalThis.MR_CONFIG = { apiKey: 'k' }; assert.equal(MR.ai.mode(), 'direct');
  globalThis.MR_CONFIG = { proxyUrl: '/api/chat' }; assert.equal(MR.ai.mode(), 'proxy');
  globalThis.MR_CONFIG = { apiKey: 'k', offline: true }; assert.equal(MR.ai.mode(), 'offline');
});

test('request: DeepSeek chat shape, json mode, prompts mention json; no class number is sent', async () => {
  const MR = fresh();
  MR.state.begin('5A-12');
  const it = MR.data.items.find((i) => i.slots.includes('colour'));   // a thing whose card asks for the colour
  const calls = online(MR, ['{"category":"colour","reply":"It is huge and purple.","grammar_note":""}']);
  const r = await MR.ai.ask({ item: it.id, given: [], text: 'Can you tell me about its colour?' });
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(c.init.headers.Authorization, 'Bearer test-key-not-real');
  assert.equal(c.body.model, 'deepseek-flash');
  assert.deepEqual(c.body.response_format, { type: 'json_object' });
  assert.ok(c.body.temperature <= 0.3);
  assert.ok(c.body.max_tokens >= 200);
  assert.match(c.body.messages[0].content, /json/);
  assert.match(MR.ai.GUIDE_SYSTEM, /json/);
  assert.ok(!c.init.body.includes('5A-12'), 'class number never leaves the device');
  const user = JSON.parse(c.body.messages[1].content);
  assert.deepEqual(Object.keys(user).sort(), ['already_given', 'card', 'facts', 'pupil_sentence']);
  // the model's own fact text is thrown away: the canonical fact is shown
  assert.equal(r.reply, 'It is ' + it.colour + '.');
  // only the three kinds of fact on this thing's card are sent
  assert.deepEqual(user.card, it.slots);
  assert.deepEqual(Object.keys(user.facts), it.slots);
  for (const f of it.slots) assert.equal(user.facts[f], MR.data.factText(it.id, f));
  assert.deepEqual([r.category, r.fact_given, r.failed, r.source], ['colour', 'colour', false, 'ai']);
  // the prompt names all seven kinds of fact, and the whitelist is closed
  for (const f of MR.data.FACTS) assert.ok(MR.ai.ASK_SYSTEM.includes('"' + f + '"'), f);
  assert.deepEqual(MR.ai.ASK_CATEGORIES.slice().sort(), MR.data.FACTS.concat(['look', 'unclear', 'off_task']).sort());
});

test('proxy mode posts to proxyUrl without a key', async () => {
  const MR = fresh();
  const calls = online(MR, ['{"category":"name","reply":"x","grammar_note":""}'], { apiKey: '', proxyUrl: '/api/chat' });
  await MR.ai.ask({ item: 'map', text: 'Tell me the thing that you are missing' });
  assert.equal(calls[0].url, '/api/chat');
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test('single words and fragments never reach the model', async () => {
  const MR = fresh();
  const calls = online(MR, []);
  const r = await MR.ai.ask({ item: 'key', text: 'Where' });
  assert.equal(r.reply, 'Do you mean where it is?');
  assert.equal((await MR.ai.ask({ item: 'key', text: 'Where key?' })).category, 'unclear');
  assert.equal(calls.length, 0);
});

test('rules are the floor: "Where it is?" is answered even if the model says unclear', async () => {
  const MR = fresh();
  online(MR, ['{"category":"unclear","reply":"Do you mean where it is?","grammar_note":"word order"}']);
  const r = await MR.ai.ask({ item: 'key', text: 'Where it is?' });
  assert.deepEqual([r.category, r.fact_given, r.source], ['place', 'place', 'ai+rules']);
  assert.equal(r.reply, 'It is behind the red door, next to the blue fountain.');
});

test('model-written clarifications are validated; leaks and out-of-table things are replaced by a canned line', async () => {
  const MR = fresh();
  const V = MR.ai.validateReply;
  assert.ok(V('Do you mean where it is?', 'unclear'));
  assert.ok(V('Sorry, I don’t understand. What do you want to know?', 'unclear'));
  assert.ok(V(MR.data.text.redirect, 'off_task'));
  assert.ok(!V('I am lost in the maze! Please ask me about the thing I need.', 'off_task'), 'a redirect is ONE sentence');
  assert.ok(!V('Do you mean the yellow key?', 'unclear'), 'fact leak');
  assert.ok(!V('Is it near the castle?', 'unclear'), 'out-of-table place');
  assert.ok(!V('Let us talk about dragons.', 'off_task'), 'out-of-table thing');
  assert.ok(!V('I do not understand.', 'unclear'), 'a clarification must be a question');
  assert.ok(!V('One. Two. Three. What?', 'unclear'), 'too many sentences');
  assert.ok(!V('you '.repeat(60) + '?', 'unclear'), 'too long');
  assert.ok(!V('', 'unclear')); assert.ok(!V(null, 'unclear'));
  assert.ok(V('I can’t see a house. What can I see?', 'guide', 'go to the house'));
  assert.ok(!V('I can’t see a house. Try the fountain!', 'guide', 'go to the house'));

  online(MR, ['{"category":"unclear","reply":"Do you mean the yellow key behind the red door?","grammar_note":""}',
    '{"category":"off_task","reply":"Let us talk about my thing first.","grammar_note":""}']);
  let r = await MR.ai.ask({ item: 'key', text: 'Tell me things about stuff' });
  assert.equal(r.category, 'unclear');
  assert.equal(r.reply, MR.data.text.clarify.generic);
  assert.equal(r.fact_given, null);
  r = await MR.ai.ask({ item: 'key', text: 'My dog can swim very fast' });
  assert.equal(r.reply, 'Let us talk about my thing first.', 'a clean model line is kept');
  // words of the new kinds of fact cannot leak either: owners, reasons, times
  for (const t of ['Is it for your grandma?', 'Do you need it to see at night?', 'Did you mean this morning?', 'Do you mean the big one?']) {
    assert.ok(!V(t, 'unclear'), t);
  }
});

test('acceptance: empty / invalid / failed output -> "say that again", second failure in a row -> offline rules', async () => {
  const MR = fresh();
  const modes = [];
  MR.on('ai:mode', m => modes.push(m));
  const calls = online(MR, ['', 'not json at all', '{"category":"place","reply":"x","grammar_note":""}']);
  let r = await MR.ai.ask({ item: 'key', text: 'Can you tell me about the thing?' });
  assert.equal(r.failed, true);
  assert.equal(r.reply, 'Sorry, can you say that again?');
  assert.equal(r.fact_given, null); assert.equal(r.category, null);
  assert.equal(MR.ai.mode(), 'direct');
  r = await MR.ai.ask({ item: 'key', text: 'Where is it?' });
  assert.equal(r.failed, false, 'the pupil is not stuck: the rules answer');
  assert.deepEqual([r.category, r.source], ['place', 'rules']);
  assert.equal(MR.ai.mode(), 'offline');
  assert.ok(modes.includes('offline'));
  await MR.ai.ask({ item: 'key', text: 'Where is it?' });
  assert.equal(calls.length, 2, 'no more model calls after the switch');
});

test('a success between two failures resets the counter; HTTP errors, wrong shapes and network errors are failures', async () => {
  const MR = fresh();
  online(MR, [null, '{"category":"name","reply":"","grammar_note":""}', '{"category":"banana"}', 'THROW']);
  assert.equal((await MR.ai.ask({ item: 'key', text: 'Tell me the thing, please, my friend' })).failed, true);
  assert.equal((await MR.ai.ask({ item: 'key', text: 'Tell me the thing, please, my friend' })).reply, 'I need a key.');
  assert.equal(MR.ai.status().failures, 0);
  assert.equal((await MR.ai.ask({ item: 'key', text: 'Tell me the thing, please, my friend' })).failed, true);
  assert.equal(MR.ai.mode(), 'direct');
  const r = await MR.ai.ask({ item: 'key', text: 'Tell me the thing, please, my friend' });
  assert.equal(r.failed, false); assert.equal(r.source, 'rules');
  assert.equal(MR.ai.mode(), 'offline');
});

test('timeout (6 s in production) counts as "Pip did not hear"', async () => {
  const MR = fresh();
  online(MR, ['HANG'], { timeoutMs: 30 });
  const t0 = Date.now();
  const r = await MR.ai.ask({ item: 'key', text: 'Tell me the thing, please, my friend' });
  assert.equal(r.failed, true);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(MR.ai.config().timeoutMs, 30);
  delete globalThis.MR_CONFIG;
  assert.equal(MR.ai.config().timeoutMs, 6000);
});

test('Guide: rules first; the model is only asked when the rules do not understand; illegal output = not understood', async () => {
  const MR = fresh();
  const calls = online(MR, [
    '{"actions":[{"type":"forward","until":"fountain"},{"type":"turn","dir":"right"}],"clarify":null}',
    '{"actions":[{"type":"teleport","to":"exit"}],"clarify":null}',
    '{"actions":[],"clarify":"The exit is behind the fountain, go there!"}',
    ''
  ]);
  let g = await MR.ai.guide({ text: 'turn left' });
  assert.equal(g.source, 'rules'); assert.equal(calls.length, 0);
  g = await MR.ai.guide({ text: 'turn' });
  assert.equal(g.clarify, 'Left or right?'); assert.equal(calls.length, 0);
  g = await MR.ai.guide({ text: 'please march on till the water thing then spin to the right hand', run: { x: 1, y: 9, facing: 'N' }, visible: ['fountain'] });
  assert.equal(g.source, 'ai');
  assert.deepEqual(g.actions, [{ type: 'forward', until: 'fountain' }, { type: 'turn', dir: 'right' }]);
  assert.match(calls[0].body.messages[0].content, /json/);
  assert.deepEqual(JSON.parse(calls[0].body.messages[1].content).landmarks_in_view, ['fountain']);
  g = await MR.ai.guide({ text: 'beam me to the end quickly' });
  assert.deepEqual([g.actions.length, g.clarify, g.failed], [0, MR.data.text.guideUnclear, false]);
  g = await MR.ai.guide({ text: 'what is the answer of this maze' });
  assert.equal(g.clarify, MR.data.text.guideUnclear, 'a model line that gives the way is replaced');
  g = await MR.ai.guide({ text: 'hop hop hop over there' });
  assert.equal(g.failed, true); assert.equal(g.reply, 'Sorry, can you say that again?');
});

test('Guide: the model is told the question Pip REALLY asked ("My right or your right?"), and may answer with a half turn', async () => {
  const MR = fresh();
  const calls = online(MR, [
    '{"actions":[{"type":"turn","dir":"right","whose":"your"}],"clarify":null}',
    '{"actions":[{"type":"turn","dir":"left","whose":"my"}],"clarify":null}',
    '{"actions":[],"clarify":"Left or right?"}',
    '{"actions":[{"type":"turn","dir":"around","whose":"my"},{"type":"forward"}],"clarify":null}',
    '{"actions":[{"type":"turn","dir":"sideways"}],"clarify":null}'
  ]);
  let g = await MR.ai.guide({ text: 'the one of the little explorer girl', ctx: { expect: 'whose', pendingDir: 'right' } });
  assert.equal(JSON.parse(calls[0].body.messages[1].content).pip_just_asked, 'My right or your right?');
  assert.deepEqual(g.actions, [{ type: 'turn', dir: 'right', whose: 'your' }]);
  g = await MR.ai.guide({ text: 'the one of the child at the computer', ctx: { expect: 'whose', pendingDir: 'left' } });
  assert.equal(JSON.parse(calls[1].body.messages[1].content).pip_just_asked, 'My left or your left?');
  g = await MR.ai.guide({ text: 'that way over there maybe', ctx: { expect: 'dir' } });
  assert.equal(JSON.parse(calls[2].body.messages[1].content).pip_just_asked, 'Left or right?');
  g = await MR.ai.guide({ text: 'no question was asked this time ok' });
  assert.ok(!('pip_just_asked' in JSON.parse(calls[3].body.messages[1].content)));
  assert.deepEqual(g.actions, [{ type: 'turn', dir: 'around' }, { type: 'forward' }], 'a half turn from the model never keeps "whose"');
  g = await MR.ai.guide({ text: 'spin to some side i think' });
  assert.equal(g.clarify, MR.data.text.guideUnclear, 'an unknown turn is not understood');
  /* the prompt allows exactly what the engine allows */
  assert.match(MR.ai.GUIDE_SYSTEM, /"dir": "around"/);
  assert.match(MR.ai.GUIDE_SYSTEM, /her left/);
  /* the rules answer these without the model */
  const before = calls.length;
  g = await MR.ai.guide({ text: 'her right', ctx: { expect: 'whose', pendingDir: 'right' } });
  assert.deepEqual([g.source, g.actions], ['rules', [{ type: 'turn', dir: 'right', whose: 'your' }]]);
  g = await MR.ai.guide({ text: 'turn around' });
  assert.deepEqual([g.source, g.actions], ['rules', [{ type: 'turn', dir: 'around' }]]);
  assert.equal(calls.length, before);
});

test('speech: feature detection is safe without browser APIs', async () => {
  const MR = fresh();
  assert.equal(MR.speech.canListen(), false);
  assert.equal(MR.speech.canSpeak(), false);
  assert.equal(MR.speech.listen({}), null);
  await MR.speech.speak('Hello');
});

test('the model only classifies: a kind that is not on the card gives no fact; "look" becomes colour or size; unknown categories fail', async () => {
  const MR = fresh();
  MR.state.begin('5A-12', 'standard', { seed: 7 });
  const D = MR.data;
  for (const it of D.items) {
    const off = D.FACTS.filter((f) => !it.slots.includes(f));
    online(MR, off.map((f) => JSON.stringify({ category: f, reply: D.factText(it.id, f), grammar_note: '' })));
    for (const f of off) {
      // the model even tries to give the fact itself: it is thrown away
      const r = await MR.ai.ask({ item: it.id, given: [], text: 'Please tell me more about that thing of yours' });
      assert.deepEqual([r.category, r.fact_given, r.off_card, r.clarification, r.failed], [f, null, true, false, false], it.id + ' ' + f);
      assert.equal(r.reply, D.text.offCard);
    }
    online(MR, it.slots.map((f) => JSON.stringify({ category: f, reply: 'It is a huge castle.', grammar_note: '' })));
    for (const f of it.slots) {
      const r = await MR.ai.ask({ item: it.id, given: [], text: 'Please tell me more about that thing of yours' });
      assert.deepEqual([r.category, r.fact_given, r.off_card, r.reply], [f, f, false, D.factText(it.id, f)]);
    }
  }
  // "What does it look like?": the rules know this form; the model's "colour" does not hide a size slot
  const sized = (() => { for (let s = 0; s < 300; s++) { D.useSession(s); const i = D.items.find((x) => x.slots.includes('size') && !x.slots.includes('colour')); if (i) return i; } })();
  online(MR, ['{"category":"colour","reply":"","grammar_note":""}', '{"category":"look","reply":"","grammar_note":""}']);
  let r = await MR.ai.ask({ item: sized, given: [], text: 'What does it look like?' });
  assert.deepEqual([r.category, r.fact_given, r.reply], ['size', 'size', 'It is ' + sized.size + '.']);
  r = await MR.ai.ask({ item: sized, given: [], text: 'Tell me about how the thing looks to you' });
  assert.deepEqual([r.category, r.fact_given], ['size', 'size']);
  // a category outside the whitelist is a failed call, not a fact
  online(MR, ['{"category":"owner","reply":"It is my mum’s.","grammar_note":""}']);
  r = await MR.ai.ask({ item: sized, given: [], text: 'Please tell me more about that thing of yours' });
  assert.deepEqual([r.failed, r.fact_given], [true, null]);
  D.useSession(null);
});
