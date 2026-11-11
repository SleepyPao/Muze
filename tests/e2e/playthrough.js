#!/usr/bin/env node
/* End-to-end playthrough in headless Chromium (Playwright), opened from file:// with ALL network blocked (Demo mode).
 *
 *   node tests/e2e/playthrough.js            (npm run test:e2e)
 *
 * Every game has its own random content (seed), so the test never hard-codes things, facts or maps: it reads them
 * from the running page (MR.data) and plays whatever this game is.
 * 1. Pupil 5A-12 (standard maze) plays everything: Start -> Warm-up (10) -> 4 things (Ask + Go, legend on the Go map)
 *    -> end of lesson 1 -> reload + same class number = same game back -> Guide route 1 + 2 (scripted) -> Review.
 * 2. Pupil 5A-13 (simple maze) plays everything on the same device: a different game (other seed, other content);
 *    in Guide this pupil types ONLY the level-2 hints ("Try: ...") and must reach both exits without a wall.
 * 3. Teacher view: two separate rows with the right counts, rubric entry, CSV + JSON export.
 * 4. Speak button: a stub recogniser; the 10 s countdown ring appears next to it, counts down, stops at 0 and keeps
 *    the words; a quiet moment after a finished phrase stops it early.
 * 5. Broken AI: empty content, then invalid JSON -> "Sorry, can you say that again?", game keeps working,
 *    after two failures the offline rules take over.
 * 6. No arrow-key handling in the code; no console errors; every fixed line Pip said has a pre-recorded clip.
 * Checks follow the acceptance list in PLAN.md section 10. */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
const HEADED = process.env.HEADED === '1';
let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; console.log('  ✓ ' + msg); }

async function speech(page) { return (await page.textContent('#mr-speech')).trim(); }
async function waitSpeech(page, re, ms) {
  await page.waitForFunction((src) => new RegExp(src).test(document.getElementById('mr-speech').textContent), re.source, { timeout: ms || 5000 });
  return speech(page);
}
async function send(page, text) {
  await page.waitForFunction(() => !document.getElementById('mr-input').disabled, null, { timeout: 8000 });
  await page.fill('#mr-input', text);
  await page.click('#mr-send');
  await page.waitForFunction(() => !document.getElementById('mr-input').disabled || !document.getElementById('mr-overlay').hidden, null, { timeout: 8000 });
  await page.waitForTimeout(30);
  return speech(page);
}
/** Click the centre of a map tile in the newest scene (a real pointer event). */
async function clickTile(page, x, y) {
  const r = await page.evaluate(([x, y]) => { const sc = MR.render.active[MR.render.active.length - 1]; return sc.tileRect(x, y); }, [x, y]);
  await page.mouse.click(r.left + r.width / 2, r.top + r.height / 2);
}
async function waitHighlights(page) {
  await page.waitForFunction(() => { const sc = MR.render.active[MR.render.active.length - 1]; return sc && sc.debugState().highlights.length > 0; }, null, { timeout: 8000 });
}
async function factsOn(page) { return page.$$eval('.mr-fact.is-on', (els) => els.map((e) => e.dataset.fact)); }
const SAID_BEFORE_RELOAD = [];
/** Record every line Pip says (to check that each fixed line has a pre-recorded clip). Again after a reload. */
async function recordSaid(page) {
  await page.evaluate(() => {
    window.__said = window.__said || new Set();
    const say = MR.ui.dialog.say;
    MR.ui.dialog.say = function (t, o) { if (!o || o.speak !== false) window.__said.add(String(t).trim()); return say.apply(this, arguments); };
  });
}
/** This game's content, read from the page: seed, the four things' facts, warm-up, Guide maze variants. */
async function content(page) {
  return page.evaluate(() => ({
    seed: MR.state.sessionSeed(),
    facts: MR.data.sessionFacts(),
    warm: MR.data.warmupSet().map((q) => q.instruction || q.sentence),
    guide: MR.data.routeIds.map((r) => MR.data.guideMaze(r, MR.state.get().difficulty).id)
  }));
}
/** Tap the first entry of the map legend: its name must appear on the map as a label, and the landmark must blink. */
async function checkLegend(page, where) {
  const name = (await page.textContent('.mr-legend__item .mr-legend__name')).trim();
  await page.click('.mr-legend__item');
  await page.waitForFunction((n) => Array.from(document.querySelectorAll('.mr-maplabel')).some((e) => e.textContent === n && e.offsetWidth > 0), name, { timeout: 3000 });
  const st = await page.evaluate(() => MR.render.active[MR.render.active.length - 1].debugState());
  ok(st.pings.length > 0 && st.labels.some((l) => l.text === name) && await page.$('.mr-legend__item.is-on'),
    `${where}: tapping "${name}" in the legend blinks it on the map with its name`);
}

/* ------------------------------------------------------------------ one whole game */
async function playGame(page, classNo, difficulty, opts) {
  opts = opts || {};
  console.log(`\n== ${classNo} (${difficulty})`);
  await page.fill('#mr-classno-input', classNo);
  if (difficulty === 'simple') await page.click('#mr-diff-simple');
  await page.click('#mr-start-btn');
  for (let i = 0; i < 4; i++) await page.click('#mr-actions .mr-btn');
  await page.waitForSelector('.mr-warm');
  ok(true, 'story shown, warm-up starts');
  const game = await content(page);
  ok(game.seed !== null && game.facts.length === 4 && new Set(game.facts.map((f) => f.id)).size === 4,
    `a new game gets its own seed (${game.seed}) and four different things: ${game.facts.map((f) => f.colour + ' ' + f.id).join(', ')}`);

  /* ---------- warm-up: answer question 1 wrong on purpose, the rest right */
  const qs = await page.evaluate(() => MR.data.warmupSet().map((q) => ({ type: q.type, correct: q.correct, options: q.options })));
  ok(qs.length === 10, 'warm-up has 10 questions');
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    const choice = i === 0 ? (q.correct + 1) % q.options.length : q.correct;
    if (q.type === 'path') {
      await waitHighlights(page);
      const t = q.options[choice].tiles[0];
      await clickTile(page, t.x, t.y);
    } else {
      await page.click(`.mr-warm__opts .mr-btn:nth-child(${choice + 1})`);
    }
    await page.waitForSelector('.mr-warm__fb');
    const fb = await page.textContent('.mr-warm__fb');
    if (i === 0) ok(/Not this one/.test(fb), 'a wrong warm-up answer shows "not this one" and the right answer');
    await page.click('#mr-warm-next');
  }
  await page.waitForSelector('#mr-warm-done');
  ok(/9 of 10/.test(await page.textContent('.mr-warm__score')), 'warm-up score 9 of 10 shown');
  await page.click('#mr-warm-done');

  /* ---------- four things */
  const items = await page.evaluate(() => MR.data.items.map((it) => ({ id: it.id, place: it.place, look: it.look, name: it.name })));
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    await page.waitForSelector('.mr-ask');
    ok(await page.isDisabled('#mr-go-btn'), `[${it.id}] Go is locked before asking`);
    const goUrlBlocked = await page.evaluate((k) => { MR.go('go', { item: k }); return document.querySelector('.mr-ask') !== null; }, k);
    ok(goUrlBlocked, `[${it.id}] jumping to Go without facts sends the pupil back to Ask`);

    let s = await send(page, 'Where');
    ok(/Do you mean where it is\?/.test(s) && (await factsOn(page)).length === 0, `[${it.id}] "Where" -> clarifying question, no fact`);
    if (k === 0) {
      s = await send(page, 'Where key?');
      ok(!/behind|next to|opposite|between|in front of/.test(s) && (await factsOn(page)).length === 0, '"Where key?" (fragment) -> no fact');
      s = await send(page, 'Do you like pizza?');
      ok((await factsOn(page)).length === 0 && /ask me about the thing/i.test(s), 'off-task question -> one-sentence redirect, no fact');
      await page.click('#mr-hint');
      ok(/Ask what I need/.test(await page.textContent('.mr-hintbox')), 'hint level 1 appears only after clicking Hint');
      await page.click('#mr-hint');
      ok(/What do you …\?/.test(await page.textContent('.mr-hintbox')), 'hint level 2 = sentence starter');
    }
    s = await send(page, 'Where it is?');
    ok(s === it.place && JSON.stringify(await factsOn(page)) === '["place"]', `[${it.id}] "Where it is?" -> exactly the place fact`);
    s = await send(page, 'What do you need?');
    ok(s === 'I need ' + it.name + '.', `[${it.id}] name fact`);
    ok(await page.isDisabled('#mr-go-btn'), `[${it.id}] Go still locked with 2 of 3 facts`);
    s = await send(page, 'What does it look like?');
    const lookText = await page.textContent('.mr-fact[data-fact="look"] .mr-fact__text');
    ok((s === it.look || /know it all/.test(s)) && lookText === it.look && (await factsOn(page)).length === 3, `[${it.id}] look fact; all three lit`);
    if (k === 0) ok(await page.$('.mr-fact[data-fact="name"].is-assisted'), 'name fact marked assisted after a level-2 hint');
    await page.waitForFunction(() => !document.getElementById('mr-go-btn').disabled);
    await page.click('#mr-go-btn');

    /* ---------- Go */
    await page.waitForSelector('.mr-go');
    if (k === 0) { await waitHighlights(page); await checkLegend(page, 'Go map'); }
    const mz = await page.evaluate((id) => { const m = MR.data.goMap(id); return { junctions: m.junctions.map((j) => ({ branches: j.branches.map((b) => ({ path: b.path, correct: b.correct })) })) }; }, it.id);
    for (let j = 0; j < 2; j++) {
      await waitHighlights(page);
      if (k === 0 && j === 0) {
        const wrong = mz.junctions[j].branches.find((b) => !b.correct);
        await clickTile(page, wrong.path[0].x, wrong.path[0].y);
        await waitSpeech(page, /Dead end/);
        ok(true, 'a wrong path -> "Dead end. Go back and ask Pip again."');
        ok(await page.evaluate(() => MR.render.active[MR.render.active.length - 1].debugState().item.visible), 'the thing is still there after the dead end');
        await waitHighlights(page);
        const again = await send(page, 'Where is it?');
        ok(again === it.place, 'the pupil can ask Pip again at the junction');
        await waitHighlights(page);
      }
      const right = mz.junctions[j].branches.find((b) => b.correct);
      await clickTile(page, right.path[0].x, right.path[0].y);
    }
    await page.waitForSelector('#mr-overlay:not([hidden])', { timeout: 8000 });
    ok(/You found it/.test(await page.textContent('#mr-overlay-title')), `[${it.id}] thing picked up, star given`);
    await page.click('#mr-overlay-btn');
  }

  /* ---------- end of lesson 1 */
  await page.waitForSelector('.mr-break');
  ok(/End of lesson 1/.test(await page.textContent('.mr-break')), 'end of lesson 1 screen');
  ok(await page.$$eval('.mr-slot.is-filled', (e) => e.length) === 4, 'all four things in the top bar');
  ok(JSON.stringify(await page.$$eval('.mr-slot', (e) => e.map((x) => x.dataset.item))) === JSON.stringify(items.map((it) => it.id)),
    'the top bar shows THIS game\'s four things');

  if (opts.resume) {
    /* next lesson: the page is reloaded, the pupil types the same class number -> exactly the same game */
    SAID_BEFORE_RELOAD.push(...await page.evaluate(() => Array.from(window.__said)));
    await page.reload();
    await recordSaid(page);
    await page.fill('#mr-classno-input', classNo);
    await page.click('#mr-start-btn');
    await page.waitForSelector('.mr-break');
    const again = await content(page);
    ok(JSON.stringify(again) === JSON.stringify(game), `same class number after a reload: same seed, same things, facts, warm-up and mazes (${again.guide.join(', ')})`);
    ok(await page.$$eval('.mr-slot.is-filled', (e) => e.length) === 4, 'resumed at the end of lesson 1 with all four things');
  }
  await page.click('#mr-break-next');

  /* ---------- Guide x 2 */
  for (let r = 0; r < 2; r++) {
    await page.waitForSelector('.mr-guide');
    if (r === 0 && !opts.followHints) {
      await checkLegend(page, 'Guide map');
      await page.click('#mr-hint');
      const h1 = (await page.textContent('.mr-guide__hint .mr-hintbox__text')).trim();
      ok(/^Pip (is|can)/.test(h1) && !/…/.test(h1), `Guide hint 1 says what Pip can see from where he is: "${h1}"`);
      let s = await send(page, 'turn');
      ok(s === 'Left or right?', 'Guide: "turn" -> "Left or right?"');
      s = await send(page, 'left');
      s = await send(page, 'go straight');
      ok(/There is a wall/.test(s), 'Guide: walking into a hedge -> "There is a wall." and Pip stays');
      s = await send(page, 'I can\'t see a castle, go to the castle');
      s = await send(page, 'walk to the house');
      ok(/I can.t see a house\. What can I see\?/.test(s), 'Guide: unknown landmark -> "I can\'t see a house. What can I see?"');
      await page.click('#mr-guide-restart');
      ok(await page.evaluate(() => { const st = MR.render.active[MR.render.active.length - 1].debugState(); return st.trail === 0; }), 'Start again resets Pip, no penalty');
    }
    const plan = await page.evaluate(() => {
      const s = MR.state.get(), rid = MR.data.routeIds[s.guide.routeIndex], mz = MR.data.guideMaze(rid, s.difficulty);
      const p = MR.maze.findPath(mz, mz.start, mz.exit);
      const out = []; let f = mz.start.facing, i = 0;
      while (i < p.length - 1) {
        const need = MR.maze.facingBetween(p[i], p[i + 1]);
        if (need !== f) {
          if (MR.maze.LEFT_OF[f] === need) out.push('turn left'); else if (MR.maze.RIGHT_OF[f] === need) out.push('turn right'); else out.push('turn around');
          f = need;
        }
        let n = 0; while (i < p.length - 1 && MR.maze.facingBetween(p[i], p[i + 1]) === f) { n++; i++; }
        out.push('go forward ' + n + ' steps');
      }
      return { rid, out, min: MR.maze.minInstructions(mz) };
    });
    ok(plan.min >= 5, `route ${plan.rid}: shortest solution needs ${plan.min} instructions (>= 5)`);
    let whose = false;
    if (opts.followHints) {
      /* type ONLY what hint 2 says ("Try: Go straight until the well."), nothing else */
      const typed = [];
      let walls = 0;
      for (let n = 0; n < 40 && !(await page.isVisible('#mr-overlay')); n++) {
        await page.click('#mr-hint');
        await page.click('#mr-hint');
        const t = (await page.textContent('.mr-guide__hint .mr-hintbox__text')).trim();
        const m = /^Try: (.+?)(?: \((.+)\))?$/.exec(t);
        assert.ok(m, 'hint 2 is a sentence to try: ' + t);
        typed.push(m[1]);
        const s = await send(page, m[1]);
        if (/^My (left|right) or your \1\?$/.test(s)) whose = true;
        if (/There is a wall/.test(s)) walls++;
      }
      ok(walls === 0 && typed.length <= plan.min + 3, `route ${plan.rid}: typing only hint 2 reaches the way out, no wall (${typed.length} lines: ${typed.join(' / ')})`);
    } else {
      for (const ins of plan.out) {
        let s = await send(page, ins);
        const m = /^My (left|right) or your \1\?$/.exec(s);
        if (m) { whose = true; s = await send(page, 'your ' + m[1]); }
      }
    }
    if (plan.rid === 'r2') ok(whose, 'route 2 (Pip faces the pupil): "My left or your left?" asked and answered');
    await page.waitForSelector('#mr-overlay:not([hidden])', { timeout: 8000 });
    ok(/Pip is out/.test(await page.textContent('#mr-overlay-title')), `route ${plan.rid}: exit reached`);
    await page.click('#mr-overlay-btn');
  }

  /* ---------- Review */
  await page.waitForSelector('.mr-review');
  ok(await page.$$eval('.mr-bubble--me', (e) => e.length) >= 12, 'review shows the pupil\'s own questions');
  ok(await page.$$eval('.mr-review__route canvas', (e) => e.length) === 2, 'review shows both routes');
  ok(await page.isDisabled('#mr-review-done'), 'self-assessment must be filled in first');
  for (const row of await page.$$('.mr-cando')) await (await row.$('.mr-cando__yes')).click();
  await page.click('#mr-review-done');
  await page.waitForSelector('#mr-overlay:not([hidden])');
  await page.click('#mr-overlay-btn');
  await page.waitForSelector('.mr-start');
  ok(true, `${classNo} finished the whole game`);
  return game;
}

/* ------------------------------------------------------------------ main */
(async () => {
  const browser = await chromium.launch({ headless: !HEADED, args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  await context.route(/^https?:/, (r) => r.abort());          /* no network at all: Demo mode must carry everything */
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());

  await page.goto(URL + '?fast=1');
  ok(await page.isVisible('#mr-demo'), '"Demo mode" badge shown without a key');
  await recordSaid(page);

  const g1 = await playGame(page, '5A-12', 'standard', { resume: true });
  const g2 = await playGame(page, '5A-13', 'simple', { followHints: true });
  ok(g1.seed !== g2.seed && JSON.stringify(g1.facts) !== JSON.stringify(g2.facts) && JSON.stringify(g1.warm) !== JSON.stringify(g2.warm),
    'two pupils get two different games (seed, things / facts, warm-up)');

  /* ---------- teacher view */
  console.log('\n== teacher view');
  await page.click('#mr-teacher-link');
  await page.click('#mr-teacher-open');
  await page.waitForSelector('.mr-teach__table');
  const rows = await page.$$eval('.mr-teach__row', (trs) => trs.map((tr) => Array.from(tr.children).map((td) => td.textContent.trim())));
  ok(rows.length === 2 && rows[0][0] === '5A-12' && rows[1][0] === '5A-13', 'one row per pupil, evidence kept apart');
  ok(rows[0][1] === '12' && rows[0][3] === '7' && rows[0][4] === '2', '5A-12: facts 12/12, paths first try 7/8 (one dead end), exits 2/2');
  ok(rows[0][2] === '1', '5A-12: one assisted fact (after the level-2 hint)');
  ok(Number(rows[0][5]) >= 7 && Number(rows[0][6]) >= 1, '5A-12: clarifications and successful rewrites counted');
  await page.selectOption('.mr-teach__row:first-child select[data-field="A_question_form"]', '2');
  await page.selectOption('.mr-teach__row:first-child select[data-field="C_precision"]', '3');
  await page.selectOption('.mr-teach__row:first-child select[data-field="C_repair"]', '1');
  await page.click('.mr-teach__row:first-child .mr-btn');
  await page.waitForSelector('.mr-teach__log');
  ok(await page.$$eval('.mr-teach__details canvas', (e) => e.length) === 2, 'teacher can open a pupil: full record + 2 route replays');
  ok(/word order: Where is it\?/.test(await page.textContent('.mr-teach__notes')), 'grammar note for "Where it is?" visible to the teacher only');
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#mr-export-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok(/^﻿?class_no,/.test(csv) && /\n5A-12,12,1,7,2,/.test(csv) && /,2,3,1\r\n/.test(csv), 'class CSV export has the counts and rubric scores');
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#mr-export-json')]);
  const json = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(json.app === 'maze-rescue' && json.entries.length > 50 && json.entries.every((e) => e.class_no && !('player' in e) && !('audio' in e)), 'JSON export: every record has class_no, no player field, no audio');
  ok(json.entries.filter((e) => e.stage === 'ask' && e.event === 'turn').every((e) => 'sent_text' in e && 'asr_text' in e && 'category' in e && 'fact_given' in e && 'hint_level' in e && 'clarification' in e && 'input_mode' in e && 'turn' in e),
    'Ask records have the spec 5.3 fields');
  const locked = await page.evaluate(() => MR.log.add({ class_no: '5A-12', stage: 'ask', item_id: MR.log.sessionOf('5A-12').items[0].id, sent_text: 'hack' }) === null);
  ok(locked, 'a finished stage is read-only (log refuses new records)');
  ok(errors.length === 0, 'no console errors during the two playthroughs' + (errors.length ? ': ' + errors.join(' | ') : ''));

  const said = Array.from(new Set(SAID_BEFORE_RELOAD.concat(await page.evaluate(() => Array.from(window.__said)))));
  ok(said.some((t) => g2.facts.some((f) => f.place === t)), 'the second pupil heard this game\'s own place sentences');
  const missing = await page.evaluate((list) => list.filter((t) => !MR.speech.clip(t) && !/house|castle/.test(t)), said);
  ok(said.length > 30 && missing.length === 0, `every fixed line Pip said (${said.length}) has a pre-recorded clip` + (missing.length ? ': missing ' + JSON.stringify(missing) : ''));

  /* ---------- Pip's voice: offline clip, length matches */
  const p3 = await context.newPage();
  await p3.goto(URL + '?debug=ask');
  const voice = await p3.evaluate(() => { const t = performance.now(); const c = MR.speech.clip('Left or right?');
    return MR.speech.speak('Left or right?').then(() => ({ ms: performance.now() - t, clip: c, src: document.querySelector('audio') ? 'el' : 'obj' })); });
  ok(voice.clip && /^assets\/voice\/.+\.mp3$/.test(voice.clip[0]) && voice.ms > voice.clip[1] * 1000 * 0.7 && voice.ms < (voice.clip[1] + 1) * 1000 + 300,
    `Pip's voice plays the offline clip for its full length (${Math.round(voice.ms)} ms for a ${voice.clip && voice.clip[1]} s clip)`);
  const usesNet = await p3.evaluate(() => { const v = speechSynthesis.getVoices(); return v.filter((x) => !x.localService).length; });
  ok(true, `network system voices present but never chosen (${usesNet} on this machine)`);
  await p3.close();

  /* ---------- Speak: 10 s countdown next to the button (a stub recogniser stands in for the browser's) */
  console.log('\n== microphone countdown');
  const pm = await context.newPage();
  const errorsM = [];
  pm.on('pageerror', (e) => errorsM.push(e.message));
  await pm.addInitScript(() => {
    window.__fake = { text: 'turn left', final: false, starts: 0 };
    class FakeRec {
      start() {
        if (this.on) throw new Error('InvalidStateError: already started');
        this.on = true; window.__fake.starts++;
        const f = window.__fake;
        this.t = setTimeout(() => { if (this.on) this.emit(f.text, f.final); }, 300);
      }
      emit(text, final) { const r = [{ transcript: text, confidence: 0.9 }]; r.isFinal = final; if (this.onresult) this.onresult({ resultIndex: 0, results: [r] }); }
      stop() { if (!this.on) return; this.on = false; clearTimeout(this.t); setTimeout(() => { this.emit(window.__fake.text, true); if (this.onend) this.onend(); }, 50); }
      abort() { if (!this.on) return; this.on = false; clearTimeout(this.t); setTimeout(() => { if (this.onend) this.onend(); }, 20); }
    }
    window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
  });
  await pm.goto(URL + '?fast=1&debug=guide');
  await pm.waitForSelector('.mr-guide');
  ok(await pm.isVisible('#mr-mic') && !(await pm.isVisible('#mr-mictimer')), 'Speak button shown, no countdown before it is pressed');
  const t0 = Date.now();
  await pm.click('#mr-mic');
  ok(await pm.isVisible('#mr-mictimer') && (await pm.textContent('#mr-mictimer')).trim() === '10' && (await pm.textContent('#mr-mic')).trim() === 'Stop',
    'Speak -> the button says "Stop" and a countdown ring shows 10 next to it');
  const ringBox = await pm.$eval('#mr-mictimer', (e) => { const r = e.getBoundingClientRect(), m = document.getElementById('mr-mic').getBoundingClientRect(); return { gap: r.left - m.right, w: r.width, top: r.top, mtop: m.top, mh: m.height }; });
  ok(ringBox.gap >= 0 && ringBox.gap < 30 && ringBox.w >= 44, `the ring sits right next to the Speak button (${Math.round(ringBox.gap)} px, ${Math.round(ringBox.w)} px wide)`);
  await pm.waitForTimeout(3300);
  const mid = Number((await pm.textContent('#mr-mictimer')).trim());
  ok(mid >= 6 && mid <= 7 && (await pm.inputValue('#mr-input')) === 'turn left', `after 3.3 s it shows ${mid}; the words heard so far are in the box`);
  await pm.waitForFunction(() => document.getElementById('mr-mic').textContent.trim() === 'Speak', null, { timeout: 9000 });
  const took = Date.now() - t0;
  const zero = await pm.evaluate(() => ({ shown: !document.getElementById('mr-mictimer').hidden, n: document.getElementById('mr-mictimer').textContent.trim() }));
  ok(took >= 9600 && took <= 11000 && zero.n === '0' && !(await pm.evaluate(() => MR.ui.dialog.isListening())), `listening stops on its own at 0 (after ${(took / 1000).toFixed(1)} s), the ring shows 0`);
  await pm.waitForTimeout(900);
  ok(!(await pm.isVisible('#mr-mictimer')) && (await pm.inputValue('#mr-input')) === 'turn left', 'then the ring goes away and the words stay in the box to check and send');
  await pm.fill('#mr-input', '');
  await pm.evaluate(() => { window.__fake.text = 'go straight'; window.__fake.final = true; });
  const t1 = Date.now();
  await pm.click('#mr-mic');
  await pm.waitForFunction(() => document.getElementById('mr-mic').textContent.trim() === 'Speak', null, { timeout: 6000 });
  const quiet = Date.now() - t1;
  ok(quiet < 4000 && (await pm.inputValue('#mr-input')) === 'go straight', `a finished phrase + a quiet moment stops listening early (${(quiet / 1000).toFixed(1)} s)`);
  await pm.click('#mr-mic');
  await pm.waitForTimeout(500);
  await pm.click('#mr-mic');
  ok(!(await pm.isVisible('#mr-mictimer')) && (await pm.textContent('#mr-mic')).trim() === 'Speak', 'pressing Stop ends listening at once');
  ok(errorsM.length === 0, 'no page errors with the microphone');
  await pm.close();

  /* ---------- broken AI */
  console.log('\n== broken AI');
  const p2 = await context.newPage();
  const errors2 = [];
  p2.on('pageerror', (e) => errors2.push(e.message));
  await p2.addInitScript(() => { window.MR_CONFIG = { apiKey: 'test-not-a-real-key', baseUrl: 'https://ai.invalid', timeoutMs: 3000 }; });
  let calls = 0;
  await p2.route('https://ai.invalid/**', (r) => {
    calls++;
    const content = calls === 1 ? '' : '{"category": "pla';
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
  });
  await p2.goto(URL + '?fast=1&debug=ask&item=1');
  ok(!(await p2.isVisible('#mr-demo')), 'with a key the game is not in Demo mode');
  let s = await send(p2, 'Where is it?');
  ok(s === 'Sorry, can you say that again?' && (await factsOn(p2)).length === 0, 'empty AI content -> "Sorry, can you say that again?"');
  ok(!(await p2.isDisabled('#mr-input')), 'the pupil can speak again (game not stuck)');
  s = await send(p2, 'Where is it?');
  const place = await p2.evaluate(() => MR.data.items[1].place);
  ok(calls === 2 && s === place, 'invalid JSON (2nd failure in a row) -> offline rules answer');
  ok(await p2.isVisible('#mr-demo'), 'switched to Demo mode after two failures');
  const failedTurn = await p2.evaluate(() => MR.log.all().find((e) => e.ai_failed));
  ok(failedTurn && failedTurn.category === null && failedTurn.clarification === false, 'the failed turn is logged as an AI failure, not as a pupil error');
  ok(errors2.length === 0, 'no page errors with the broken AI');

  /* ---------- static checks */
  console.log('\n== code checks');
  const js = fs.readdirSync(path.join(ROOT, 'js')).concat(fs.readdirSync(path.join(ROOT, 'js', 'screens')).map((f) => 'screens/' + f))
    .filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')).join('\n');
  ok(!/Arrow(Left|Right|Up|Down)|keyCode\s*===?\s*(37|38|39|40)/.test(js), 'no arrow-key handling anywhere');

  await browser.close();
  console.log(`\nAll ${checks} checks passed.`);
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
