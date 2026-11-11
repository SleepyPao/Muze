'use strict';
/* Speech input (js/speech.js) with a fake recogniser: ONE recogniser per page, sessions never mix,
 * Stop keeps the words, abort drops late results, a busy recogniser is waited for, a stuck one is replaced. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { MR } = require('./helper');

const made = [];
class FakeRec {
  constructor() { this.running = false; this.starts = 0; made.push(this); }
  start() { if (this.running) { const e = new Error('already started'); e.name = 'InvalidStateError'; throw e; } this.running = true; this.starts++; }
  stop() { this.stopCalls = (this.stopCalls || 0) + 1; }
  abort() {                                   /* like the browser: onend comes a moment later */
    this.abortCalls = (this.abortCalls || 0) + 1;
    const run = this.starts;
    if (this.running) queueMicrotask(() => { if (this.running && this.starts === run) this.end(); });
  }
  /* test helpers: what the browser would do */
  say(text, isFinal) { this.onresult({ results: [Object.assign([{ transcript: text }], { isFinal: !!isFinal })] }); }
  end() { this.running = false; this.onend(); }
}
async function setup() {
  globalThis.webkitSpeechRecognition = FakeRec;
  delete globalThis.MR_CONFIG;
  MR.speech.abortListening();
  await new Promise((r) => setTimeout(r, 0));
}
function spy() {
  const s = { results: [], ends: [], errors: [] };
  s.h = { onResult: (t, f) => s.results.push([t, f]), onEnd: (t) => s.ends.push(t), onError: (c) => s.errors.push(c) };
  return s;
}

test('one recogniser is reused for every Speak press; results reach only the current press', async () => {
  await setup();
  const a = spy();
  const ha = MR.speech.listen(a.h);
  assert.ok(ha && MR.speech.isListening());
  const rec = made[made.length - 1];
  rec.say('go str', false); rec.say('go straight', true);
  rec.end();
  assert.deepEqual(a.ends, ['go straight']);
  assert.equal(MR.speech.isListening(), false);
  const b = spy();
  MR.speech.listen(b.h);
  assert.equal(made[made.length - 1], rec, 'no new recogniser for the second press');
  assert.equal(rec.starts, 2);
  rec.say('turn left', true); rec.end();
  assert.deepEqual(b.ends, ['turn left']);
  assert.equal(a.results.length, 2, 'the first press got nothing from the second');
});

test('stop() keeps the words; abort() drops anything that comes later', async () => {
  await setup();
  const a = spy();
  const ha = MR.speech.listen(a.h);
  const rec = made[made.length - 1];
  rec.say('turn right', false);
  ha.stop();
  assert.equal(rec.stopCalls, 1);
  rec.say('turn right', true); rec.end();
  assert.deepEqual(a.ends, ['turn right'], 'Stop: the final words still arrive');

  const b = spy();
  const hb = MR.speech.listen(b.h);
  rec.say('go', false);
  hb.abort();
  assert.equal(MR.speech.isListening(), false);
  rec.say('LATE', true); rec.end();
  assert.deepEqual(b.results, [['go', false]]);
  assert.deepEqual(b.ends, [], 'no onEnd after abort');
});

test('Speak again while the recogniser is still finishing: the new press waits for it, then starts', async () => {
  await setup();
  const a = spy();
  const ha = MR.speech.listen(a.h);
  const rec = made[made.length - 1], aborts = rec.abortCalls || 0, starts = rec.starts;
  ha.stop();                                   /* still running until onend */
  const b = spy();
  const hb = MR.speech.listen(b.h);
  assert.ok(hb);
  assert.equal(rec.abortCalls, aborts + 1, 'the old session is cut');
  rec.say('old words', true);                  /* belongs to nobody now */
  rec.end();                                   /* ... and the new session starts on the same recogniser */
  assert.equal(rec.starts, starts + 1);
  rec.say('new words', true); rec.end();
  assert.deepEqual(b.ends, ['new words']);
  assert.deepEqual(a.ends, [], 'the first press was replaced');
});

test('a stop that never ends is closed after 1.5 s and the next press gets a fresh recogniser', async () => {
  await setup();
  const a = spy();
  const ha = MR.speech.listen(a.h);
  const rec = made[made.length - 1];
  rec.say('hello', true);
  ha.stop();
  await new Promise((r) => setTimeout(r, 1600));
  assert.deepEqual(a.ends, ['hello'], 'closed with what was heard');
  assert.equal(MR.speech.isListening(), false);
  const b = spy();
  MR.speech.listen(b.h);
  assert.notEqual(made[made.length - 1], rec, 'a fresh recogniser');
});

test('errors are passed on; unsupported or switched off -> onError and null', async () => {
  await setup();
  const a = spy();
  MR.speech.listen(a.h);
  const rec = made[made.length - 1];
  rec.onerror({ error: 'not-allowed' }); rec.end();
  assert.deepEqual(a.errors, ['not-allowed']);
  globalThis.MR_CONFIG = { speechInput: false };
  const b = spy();
  assert.equal(MR.speech.listen(b.h), null);
  assert.deepEqual(b.errors, ['unsupported']);
  delete globalThis.MR_CONFIG;
  delete globalThis.webkitSpeechRecognition;
  const c = spy();
  assert.equal(MR.speech.listen(c.h), null);
  assert.deepEqual(c.errors, ['unsupported']);
});
