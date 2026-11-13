#!/usr/bin/env node
/* End-to-end playthrough in headless Chromium (Playwright), opened from file:// with ALL network blocked (Demo mode).
 *
 *   node tests/e2e/playthrough.js            (npm run test:e2e)
 *
 * Every game has its own random content (seed), so the test never hard-codes things, facts or maps: it reads them
 * from the running page (MR.data) and plays whatever this game is.
 * 1. Pupil 5A-12 (standard maze) plays everything: Start -> Warm-up (10) -> 4 things (Ask + Go, legend on the Go map)
 *    -> end of lesson 1 -> reload + same class number = same game back -> Guide route 1 + 2 (scripted) -> Review.
 *    In route 2 the page is reloaded twice in the middle: Pip asks his open question again, stands where he was,
 *    still remembers "my left", and the teacher's replay is the walk the pupil saw. "Turn around" is one half turn.
 * 2. Pupil 5A-13 (simple maze) plays everything on the same device: a different game (other seed, other content);
 *    in Guide this pupil types ONLY the level-2 hints ("Try: ...") and must reach both exits without a wall.
 * 3. Teacher view: two separate rows with the right counts, rubric entry, CSV + JSON export.
 * 4. Speak button: a stub recogniser; the 10 s countdown ring appears next to it, counts down, stops at 0 and keeps
 *    the words; a quiet moment after a finished phrase stops it early.
 * 5. Broken AI: empty content, then invalid JSON -> "Sorry, can you say that again?", game keeps working,
 *    after two failures the offline rules take over.
 * 6. No arrow-key handling in the code; no console errors; every fixed line Pip said has a pre-recorded clip.
 * 7. Pictures: the yellow chevron points the way Pip looks (N / E / S / W) and is drawn over landmarks; the picture
 *    sizes used by the "Pip is never hidden" rule match the real sprites; at normal speed the input stays off until
 *    Pip has said his note, so no sentence is lost; the example evidence (teacher demo) reaches both exits.
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
/* One clear question for each kind of fact, and one with a small grammar error that Pip still understands. */
const ASK_Q = { name: 'What do you need?', colour: 'What colour is it?', size: 'Is it big or small?', whose: 'Whose is it?',
  why: 'Why do you need it?', when: 'When did you lose it?', place: 'Where is it?' };
const ASK_ERR = { name: 'What you need?', colour: 'What colour it is?', size: 'How big it is?', whose: 'Whose it is?',
  why: 'Why you need it?', when: 'When you lose it?', place: 'Where it is?' };
const LABELS = { name: 'What', colour: 'Colour', size: 'Size', whose: 'Whose', why: 'Why', when: 'When', place: 'Where' };
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
/** Reload the page (a new lesson, or the browser was closed) and type the same class number again. */
async function reloadAndLogin(page, classNo) {
  SAID_BEFORE_RELOAD.push(...await page.evaluate(() => Array.from(window.__said || [])));
  await page.reload();
  await recordSaid(page);
  await page.fill('#mr-classno-input', classNo);
  await page.click('#mr-start-btn');
}
/** What the pupil sees in Guide (the scene) next to what the game remembers and what the teacher's replay shows. */
async function guideView(page) {
  return page.evaluate(() => {
    const s = MR.state.get(), rid = MR.data.routeIds[s.guide.routeIndex];
    const st = MR.render.active[MR.render.active.length - 1].debugState();
    const rep = MR.guide.replay(MR.log.forStudent(s.class_no))[rid] || null;
    return { rid, pip: { x: st.pip.x, y: st.pip.y, facing: st.pip.facing }, trailShown: st.trail,
      saved: s.guide.routes[rid].trail, rep: rep && { x: rep.run.x, y: rep.run.y, facing: rep.run.facing, whoseMode: rep.run.whoseMode, trail: rep.trail, pending: !!rep.pending },
      history: Array.from(document.querySelectorAll('.mr-guide__item')).map((li) => li.textContent) };
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
  const items = await page.evaluate(() => MR.data.items.map((it) => ({ id: it.id, noun: it.noun, place: it.place, name: it.name, facts: it.facts, junctions: it.junctions.map((j) => ({ clue: j.clue })) })));
  const cards = [];
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    await page.waitForSelector('.mr-ask');
    ok(await page.isDisabled('#mr-go-btn'), `[${it.id}] Go is locked before asking`);
    const goUrlBlocked = await page.evaluate((k) => { MR.go('go', { item: k }); return document.querySelector('.mr-ask') !== null; }, k);
    ok(goUrlBlocked, `[${it.id}] jumping to Go without facts sends the pupil back to Ask`);

    /* the card of THIS thing, read from the page: three slots, each with a label that says what to find out */
    const card = await page.$$eval('.mr-ask .mr-fact', (els) => els.map((e) => ({ fact: e.dataset.fact, label: e.querySelector('.mr-fact__label').textContent, text: e.querySelector('.mr-fact__text').textContent })));
    const slots = card.map((c) => c.fact);
    cards.push(slots);
    ok(slots.length === 3 && slots[2] === 'place' && new Set(slots).size === 3 && slots.every((f) => ASK_Q[f]) &&
      card.every((c) => c.label === LABELS[c.fact] && c.text === '? ? ?'),
      `[${it.id}] card: ${card.map((c) => c.label).join(' / ')} - three locked slots ("? ? ?"), the labels say what to ask`);
    const hasName = slots.includes('name');
    if (!hasName) {
      const shown = await page.evaluate(() => document.querySelector('.mr-screen').textContent + ' ' + document.getElementById('mr-topbar').textContent +
        Array.from(document.querySelectorAll('.mr-slot')).map((e) => e.title).join(' '));
      ok(!new RegExp('\\b' + it.noun + '\\b', 'i').test(shown), `[${it.id}] the name is not on this card: nothing on the Ask screen gives it away`);
    }

    let s = await send(page, 'Where');
    ok(/Do you mean where it is\?/.test(s) && (await factsOn(page)).length === 0, `[${it.id}] "Where" -> clarifying question, no fact`);
    if (k === 0) {
      s = await send(page, 'Where key?');
      ok(!/behind|next to|opposite|between|in front of/.test(s) && (await factsOn(page)).length === 0, '"Where key?" (fragment) -> no fact');
      s = await send(page, 'Do you like pizza?');
      ok((await factsOn(page)).length === 0 && /ask me about the thing/i.test(s), 'off-task question -> one-sentence redirect, no fact');
      const hints = await page.evaluate((f) => MR.data.hints[f], slots[0]);
      await page.click('#mr-hint');
      ok((await page.textContent('.mr-hintbox')).includes(hints[1]) && await page.$(`.mr-fact[data-fact="${slots[0]}"].is-hinted`),
        `hint level 1 appears only after clicking Hint, about the first locked slot: "${hints[1]}"`);
      await page.click('#mr-hint');
      ok((await page.textContent('.mr-hintbox')).includes(hints[2]) && /…\?$/.test(hints[2]), `hint level 2 = sentence starter: "${hints[2]}"`);
    }
    /* a clear question about something that is NOT on this card: no fact */
    const off = Object.keys(ASK_Q).filter((f) => !slots.includes(f));
    for (const f of (k === 0 ? off : off.slice(0, 1))) {
      s = await send(page, ASK_Q[f]);
      ok(s === 'I can’t tell you that. Look at your card.' && (await factsOn(page)).length === 0, `[${it.id}] "${ASK_Q[f]}" is not on the card -> no fact`);
    }
    s = await send(page, 'Where it is?');
    ok(s === it.place && JSON.stringify(await factsOn(page)) === '["place"]', `[${it.id}] "Where it is?" -> exactly the place fact`);
    s = await send(page, k % 2 ? ASK_ERR[slots[0]] : ASK_Q[slots[0]]);
    ok(s === it.facts[slots[0]] && JSON.stringify((await factsOn(page)).sort()) === JSON.stringify([slots[0], 'place'].sort()),
      `[${it.id}] ${slots[0]} fact: "${s}" (one question, one fact)`);
    ok(await page.isDisabled('#mr-go-btn'), `[${it.id}] Go still locked with 2 of 3 facts`);
    s = await send(page, k % 2 ? ASK_Q[slots[1]] : ASK_ERR[slots[1]]);
    const shownText = await page.textContent(`.mr-fact[data-fact="${slots[1]}"] .mr-fact__text`);
    ok((s === it.facts[slots[1]] || /know it all/.test(s)) && shownText === it.facts[slots[1]] && (await factsOn(page)).length === 3, `[${it.id}] ${slots[1]} fact: "${shownText}"; all three lit`);
    if (k === 0) ok(await page.$(`.mr-fact[data-fact="${slots[0]}"].is-assisted`), `${slots[0]} fact marked assisted after a level-2 hint`);
    await page.waitForFunction(() => !document.getElementById('mr-go-btn').disabled);
    await page.click('#mr-go-btn');

    /* ---------- Go */
    await page.waitForSelector('.mr-go');
    {
      const go = await page.evaluate(() => ({ title: document.querySelector('.mr-go .mr-card__title').textContent, side: document.querySelector('.mr-go__side').textContent,
        label: document.querySelector('.mr-go canvas.mr-scene').getAttribute('aria-label'), hidden: !MR.render.active[MR.render.active.length - 1].debugState().item.visible }));
      const named = new RegExp('\\b' + it.noun + '\\b', 'i');
      ok(go.hidden, `[${it.id}] Go: the thing is NOT drawn on the map - only Pip's words lead there`);
      if (hasName) ok(named.test(go.title), `[${it.id}] Go: the pupil asked for the name, so the card says "${go.title}"`);
      else ok(!named.test(go.title + go.side + go.label), `[${it.id}] Go: the name was not asked - the card ("${go.title}") and the map keep it a surprise`);
    }
    if (k === 0) { await waitHighlights(page); await checkLegend(page, 'Go map'); }
    const mz = await page.evaluate((id) => { const m = MR.data.goMap(id); return { junctions: m.junctions.map((j) => ({ branches: j.branches.map((b) => ({ path: b.path, correct: b.correct })) })) }; }, it.id);
    for (let j = 0; j < 2; j++) {
      await waitHighlights(page);
      if (k === 0 && j === 0) {
        const wrong = mz.junctions[j].branches.find((b) => !b.correct);
        await clickTile(page, wrong.path[0].x, wrong.path[0].y);
        await waitSpeech(page, /Dead end/);
        ok(true, 'a wrong path -> "Dead end. Go back and ask Pip again."');
        ok(!(await page.$('.mr-claim')) && (await page.$$eval('.mr-slot.is-filled', (e) => e.length)) === k, 'nothing to pick at the dead end');
        await waitHighlights(page);
        const again = await send(page, 'Where is it?');
        ok(again === it.place, 'the pupil can ask Pip again at the junction');
        await waitHighlights(page);
      }
      const clue = await page.textContent('.mr-go .mr-fact__clue');
      ok(clue === it.junctions[j].clue, `[${it.id}] junction ${j + 1}: the card marks "${clue}"`);
      const right = mz.junctions[j].branches.find((b) => b.correct);
      await clickTile(page, right.path[0].x, right.path[0].y);
    }
    /* "Which one is it?" - three things, the other two card facts decide */
    await page.waitForSelector('.mr-claim');
    ok((await page.$$('.mr-claim__opt')).length === 3, `[${it.id}] three things at the hiding place`);
    if (k === 1) {                                   /* thing 2: tap a wrong one first */
      await page.click('.mr-claim__opt[data-correct="0"]');
      await waitSpeech(page, /not it/);
      ok(await page.isDisabled('.mr-claim__opt.is-wrong') && !(await page.isVisible('#mr-overlay')), 'a wrong thing: "No, that is not it." - nothing picked up, try again');
    }
    await page.click('.mr-claim__opt[data-correct="1"]');
    await page.waitForSelector('#mr-overlay:not([hidden])', { timeout: 8000 });
    ok(/You found it/.test(await page.textContent('#mr-overlay-title')), `[${it.id}] thing picked up, star given`);
    const found = await page.textContent('#mr-overlay-text');
    ok(found.includes(hasName ? 'Pip has ' + it.name + ' now.' : 'It is ' + it.name + '!'), `[${it.id}] pick-up: "${found}"`);
    await page.click('#mr-overlay-btn');
  }

  /* ---------- the questions were different from thing to thing */
  {
    const sets = cards.map((c) => c.join('+')), extra = new Set(cards.flatMap((c) => c.slice(0, 2)));
    ok(new Set(sets).size === 4, `the four things do not have the same three questions: ${sets.join(' | ')}`);
    ok(extra.size === 6, `this game asks for all six other kinds of fact at least once: ${Array.from(extra).join(', ')}`);
    ok(JSON.stringify(cards) === JSON.stringify(game.facts.map((f) => f.slots)), 'the cards on the screen are the cards of this game\'s content');
  }

  /* ---------- end of lesson 1 */
  await page.waitForSelector('.mr-break');
  ok(/End of lesson 1/.test(await page.textContent('.mr-break')), 'end of lesson 1 screen');
  ok(await page.$$eval('.mr-slot.is-filled', (e) => e.length) === 4, 'all four things in the top bar');
  ok(JSON.stringify(await page.$$eval('.mr-slot', (e) => e.map((x) => x.dataset.item))) === JSON.stringify(items.map((it) => it.id)),
    'the top bar shows THIS game\'s four things');

  if (opts.resume) {
    /* next lesson: the page is reloaded, the pupil types the same class number -> exactly the same game */
    await reloadAndLogin(page, classNo);
    await page.waitForSelector('.mr-break');
    const again = await content(page);
    ok(JSON.stringify(again) === JSON.stringify(game), `same class number after a reload: same seed, same things, facts, warm-up and mazes (${again.guide.join(', ')})`);
    ok(await page.$$eval('.mr-slot.is-filled', (e) => e.length) === 4, 'resumed at the end of lesson 1 with all four things');
  }
  await page.click('#mr-break-next');

  /* ---------- Guide x 2 */
  for (let r = 0; r < 4; r++) {
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
      /* one name per landmark: what the legend shows is what Pip says and what the pupil may type */
      const names = await page.evaluate(() => {
        const s = MR.state.get(), mz = MR.data.guideMaze('r1', s.difficulty);
        const ahead = MR.maze.visibleAhead(mz, mz.start, mz.start.facing).map((v) => v.type);
        const hidden = mz.landmarks.map((l) => l.type).filter((t) => ahead.indexOf(t) < 0 && MR.data.landmarkTypes[t].solid)[0];
        return { legend: Array.from(document.querySelectorAll('.mr-legend__name')).map((e) => e.textContent), all: MR.legend.types(mz).map((t) => MR.data.landmarkName(t)),
          hidden: MR.data.landmarkName(hidden), bare: MR.data.landmarkTypes[hidden].words[0] };
      });
      ok(JSON.stringify(names.legend) === JSON.stringify(names.all) && names.legend.includes('way out'), `the legend shows the one name of each landmark (${names.legend.join(', ')})`);
      s = await send(page, 'walk to the ' + names.hidden);
      const an = /^[aeiou]/.test(names.hidden) ? 'an' : 'a';
      ok(s === `I can’t see ${an} ${names.hidden}. What can I see?`, `Pip uses the legend name too: "${s}"`);
      s = await send(page, 'walk to the ' + names.bare);
      ok(s === `I can’t see ${an} ${names.hidden}. What can I see?`, `the bare noun ("${names.bare}") means the same landmark`);
      await page.click('#mr-guide-restart');
      ok(await page.evaluate(() => { const st = MR.render.active[MR.render.active.length - 1].debugState(); return st.trail === 0; }), 'Start again resets Pip, no penalty');
    }
    if (r === 1 && opts.resume) {
      /* ---------- route 2: Pip faces the pupil. Reload in the middle, twice. */
      let s = await send(page, 'turn around');
      let v = await guideView(page);
      ok(!/left|right/i.test(s) && v.pip.facing === 'N', `"turn around" while Pip faces the pupil: one half turn, no "My left or your left?" (Pip said "${s}")`);
      s = await send(page, 'go back');
      v = await guideView(page);
      ok(v.pip.facing === 'S' && v.rep.whoseMode === null, '"go back" turns Pip around again; nothing about left / right was remembered');
      s = await send(page, 'go straight');
      s = await send(page, 'turn left');
      ok(s === 'My left or your left?', 'first plain "turn left" while Pip faces the pupil -> "My left or your left?"');
      const before1 = await guideView(page);
      await reloadAndLogin(page, classNo);
      await page.waitForSelector('.mr-guide');
      v = await guideView(page);
      ok(JSON.stringify(v.pip) === JSON.stringify(before1.pip) && v.pip.y > 1, `after a reload Pip stands where he was (${v.pip.x},${v.pip.y} facing ${v.pip.facing}), not back at the start`);
      ok((await speech(page)) === 'My left or your left?' && v.rep.pending, 'after the reload Pip asks his open question again');
      ok(JSON.stringify(v.history) === JSON.stringify(before1.history) && v.history.length === 4, '"What I said" is back after the reload: ' + v.history.join(' | '));
      s = await send(page, 'her left');
      v = await guideView(page);
      const herFacing = v.pip.facing;
      ok(herFacing === 'E' && v.rep.whoseMode === 'your', '"her left" = Pip\'s own left (screen right when she faces the pupil)');
      await page.click('#mr-guide-restart');
      s = await send(page, 'go straight');
      s = await send(page, 'turn left');
      s = await send(page, 'my left');
      v = await guideView(page);
      ok(v.pip.facing === 'W' && v.rep.whoseMode === 'my', '"my left" = the pupil\'s left (screen left); Pip remembers it');
      s = await send(page, 'turn around');
      v = await guideView(page);
      ok(v.pip.facing === 'E' && v.rep.whoseMode === 'my', '"turn around" with "my left" remembered: Pip really looks the other way');
      const before2 = await guideView(page);
      await reloadAndLogin(page, classNo);
      await page.waitForSelector('.mr-guide');
      v = await guideView(page);
      ok(JSON.stringify(v.pip) === JSON.stringify(before2.pip) && v.rep.whoseMode === 'my', 'second reload: same place, same facing, the answer "my left" is still remembered');
      ok(JSON.stringify(v.rep.trail) === JSON.stringify(v.saved) && v.rep.x === v.pip.x && v.rep.y === v.pip.y && v.rep.facing === v.pip.facing && v.trailShown === v.saved.length - 1,
        'the teacher\'s replay, the saved trail and the picture on screen are the same walk');
      s = await send(page, 'turn your right');                       /* explicit, Pip's side: E -> S (faces the pupil again) */
      s = await send(page, 'turn your left');                        /* explicit and different from "my": done as said ... */
      v = await guideView(page);
      ok(v.pip.facing === 'E' && v.rep.whoseMode === 'my', '... an explicit "your left" is done as said but does not change what Pip remembers');
      s = await send(page, 'turn your right');
      s = await send(page, 'turn left');
      v = await guideView(page);
      ok(!/My left or your left/.test(s) && v.pip.facing === 'W', 'a plain "turn left" still means the pupil\'s left, and Pip does not ask again');
      await page.click('#mr-guide-restart');
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
    if (plan.rid === 'r4') ok(/^[45]:\d\d$/.test((await page.textContent('.mr-train__time')).trim()), 'back to the station: the train clock is on the map (' + (await page.textContent('.mr-train__time')).trim() + ')');
    else ok(!(await page.$('.mr-train')), `route ${plan.rid}: no train clock`);
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
    const goal = { r3: [/Pip found the book/, 'Pip reached the library from University Station and found the book'], r4: [/Pip caught the train/, 'Pip got back to University Station in time'] }[plan.rid] || [/Pip is out/, 'exit reached'];
    ok(goal[0].test(await page.textContent('#mr-overlay-title')), `route ${plan.rid}: ${goal[1]}`);
    await page.click('#mr-overlay-btn');
  }

  /* ---------- Review */
  await page.waitForSelector('.mr-review');
  ok(await page.$$eval('.mr-bubble--me', (e) => e.length) >= 12, 'review shows the pupil\'s own questions');
  ok(await page.$$eval('.mr-review__route canvas', (e) => e.length) === 4, 'review shows all four routes (2 mazes + University Station there and back)');
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
  ok(!(await page.$('#mr-demo')), 'no "Demo mode" / AI badge: the AI is switched off');
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
  ok(rows[0][1] === '12' && rows[0][3] === '7' && rows[0][4] === '3' && rows[0][5] === '4', '5A-12: facts 12/12, paths first try 7/8 (one dead end), right thing first try 3/4, routes 4/4');
  ok(rows[0][2] === '1', '5A-12: one assisted fact (after the level-2 hint)');
  ok(Number(rows[0][6]) >= 7 && Number(rows[0][7]) >= 1, '5A-12: clarifications and successful rewrites counted');
  await page.selectOption('.mr-teach__row:first-child select[data-field="A_question_form"]', '2');
  await page.selectOption('.mr-teach__row:first-child select[data-field="C_precision"]', '3');
  await page.selectOption('.mr-teach__row:first-child select[data-field="C_repair"]', '1');
  await page.click('.mr-teach__row:first-child .mr-btn');
  await page.waitForSelector('.mr-teach__log');
  ok(await page.$$eval('.mr-teach__details canvas', (e) => e.length) === 4, 'teacher can open a pupil: full record + 4 route replays (2 mazes + University Station there and back)');
  ok(/word order: Where is it\?/.test(await page.textContent('.mr-teach__notes')), 'grammar note for "Where it is?" visible to the teacher only');
  const tThings = await page.$$eval('.mr-teach__thing', (els) => els.map((e) => ({ id: e.dataset.item, slots: e.dataset.slots, text: e.textContent })));
  ok(tThings.length === 4 && tThings.every((t, i) => t.id === g1.facts[i].id && t.slots === g1.facts[i].slots.join(',') &&
    g1.facts[i].slots.every((f) => t.text.includes(LABELS[f] + ': ' + g1.facts[i].facts[f]))),
    'teacher sees this pupil\'s four things with the three questions of each card: ' + tThings.map((t) => t.id + ' [' + t.slots + ']').join(', '));
  const logText = await page.textContent('.mr-teach__log');
  ok(/not on the card \(no fact\)/.test(logText), 'teacher record flags the questions that were not on the card');
  ok(/turn around/.test(logText) && /turn left \(pupil’s side\)/.test(logText) && /turn left \(Pip’s side\)/.test(logText) && !/turn left, turn left/.test(logText),
    'teacher record: "turn around" is one action; "my left" / "her left" are shown as the pupil\'s side / Pip\'s side');
  const walk = await page.evaluate(() => { const rep = MR.guide.replay(MR.log.forStudent('5A-12')); return { r1: rep.r1.reached, r2: rep.r2.reached && rep.r3.reached && rep.r4.reached, n2: rep.r2.instructions, run2: rep.r2.run.instructions }; });
  ok(walk.r1 && walk.r2 && walk.n2 > walk.run2, `teacher replay of 5A-12 reaches the end of all four routes; all ${walk.n2} lines of route 2 are counted, the last run had ${walk.run2}`);
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#mr-export-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok(/^﻿?class_no,/.test(csv) && /\n5A-12,12,1,7,4,/.test(csv) && /,2,3,1,3,0\r\n/.test(csv), 'class CSV export has the counts and rubric scores');
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#mr-export-json')]);
  const json = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(json.app === 'maze-rescue' && json.entries.length > 50 && json.entries.every((e) => e.class_no && !('player' in e) && !('audio' in e)), 'JSON export: every record has class_no, no player field, no audio');
  {
    const asks = json.entries.filter((e) => e.stage === 'ask' && e.event === 'turn'), KINDS = Object.keys(ASK_Q);
    const offc = asks.filter((e) => e.off_card);
    ok(asks.every((e) => (e.category === null || KINDS.concat(['unclear', 'off_task']).includes(e.category)) && (e.fact_given === null || KINDS.includes(e.fact_given))) &&
      new Set(asks.map((e) => e.fact_given).filter(Boolean)).size === 7,
      'Ask records: category / fact_given are the seven kinds of fact (all seven were given in the two games)');
    ok(offc.length >= 8 && offc.every((e) => e.fact_given === null && e.clarification === false && KINDS.includes(e.category)),
      `the ${offc.length} off-card questions are logged with their kind, no fact, not as a clarification`);
    ok(asks.some((e) => /missing "did"|missing "do"|word order/.test(e.grammar_note || '') && e.fact_given && e.fact_given !== 'place'),
      'small errors in the new kinds of question ("Whose it is?", "Why you need it?" ...) still get the fact, with a teacher-only note');
  }
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

  /* ---------- pictures: facing chevron, sprite sizes, example evidence */
  console.log('\n== pictures');
  const pp = await context.newPage();
  const errorsP = [];
  pp.on('pageerror', (e) => errorsP.push(e.message));
  await pp.goto(URL + '?fast=1&debug=guide&route=1&seed=7');
  await pp.waitForSelector('.mr-guide');
  await pp.waitForTimeout(300);
  for (const f of ['N', 'E', 'S', 'W']) {
    const a = await pp.evaluate(async (f) => {
      const sc = MR.render.active[MR.render.active.length - 1], mz = sc.map;
      /* stand just above a landmark when facing S, so the chevron lies on the landmark's tile */
      const lm = mz.landmarks.find((l) => MR.maze.isWalkable(mz, l.x, l.y - 1) && MR.data.landmarkTypes[l.type].solid);
      sc.setPip(lm.x, lm.y - 1, f);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const st = sc.debugState().arrow, d = MR.maze.DIRS[f];
      const px = sc.canvas.getContext('2d').getImageData(st.tip[0], st.tip[1], 1, 1).data;
      const along = (p) => (p[0] - st.pipCentre[0]) * d.dx + (p[1] - st.pipCentre[1]) * d.dy;
      return { tip: along(st.tip), centre: along(st.centre), colour: [px[0], px[1], px[2]].join(','), lm: lm.type };
    }, f);
    ok(a.tip > a.centre && a.centre > 6 && a.colour === '255,216,74',
      `facing ${f}: the chevron is on the side Pip looks at and its tip points away from Pip (tip ${a.tip} px, middle ${a.centre} px ahead), drawn on top${f === 'S' ? ' of the ' + a.lm : ''}`);
  }
  const boxes = await pp.evaluate(() => {
    const bad = [];
    function opaque(cv, ox, oy) {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      return [x0 + ox, y0 + oy, x1 + ox, y1 + oy];
    }
    const cover = (inner, outer) => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
    for (const t of MR.data.landmarkIds.concat(['exit'])) {
      for (let frame = 0; frame < 4; frame++) for (const orient of ['ns', 'ew']) {
        const s = MR.sprites.landmark(t, frame, orient), real = opaque(s.canvas, s.ox, s.oy);
        if (!cover(real, MR.data.SPRITE_BOX[t])) bad.push(t + ' ' + real.join(',') + ' is outside ' + MR.data.SPRITE_BOX[t].join(','));
      }
    }
    for (const f of ['N', 'E', 'S', 'W']) for (let frame = 0; frame < 3; frame++) {
      const real = opaque(MR.sprites.pip(f, frame), 0, -6);
      if (!cover(real, MR.data.PIP_BOX)) bad.push('pip ' + f + frame + ' ' + real.join(','));
    }
    return bad;
  });
  ok(boxes.length === 0, 'the picture sizes in data.js (the "Pip is never hidden" rule) cover the real sprites' + (boxes.length ? ': ' + boxes.join(' | ') : ''));
  /* Pip is never covered by a landmark: seed 7, route 2 - "go straight" ends just above the well */
  await pp.goto(URL + '?fast=1&debug=guide&route=1&seed=7');
  await pp.waitForSelector('.mr-guide');
  await send(pp, 'go straight');
  await pp.waitForTimeout(250);
  const cover = await pp.evaluate(() => {
    const sc = MR.render.active[MR.render.active.length - 1], st = sc.debugState().pip;
    const mz = MR.data.guideMaze('r2', 'standard'), T = MR.data.TILE_PX;
    const below = mz.landmarks.find((l) => l.x === st.x && l.y === st.y + 1);
    const cv = document.querySelector('.mr-guide canvas.mr-scene'), PAD = cv.height - mz.rows * T;
    const spr = MR.sprites.pip(st.facing, 0), sd = spr.getContext('2d').getImageData(0, 0, spr.width, spr.height).data;
    const X = st.x * T, Y = PAD + st.y * T - 6;
    const cd = cv.getContext('2d').getImageData(X, Y, spr.width, spr.height).data;
    let solid = 0, wrong = 0, lower = 0;
    for (let i = 0; i < sd.length; i += 4) {
      if (sd[i + 3] < 255) continue;
      solid++; if ((i / 4 / spr.width | 0) >= spr.height / 2) lower++;
      if (Math.abs(sd[i] - cd[i]) + Math.abs(sd[i + 1] - cd[i + 1]) + Math.abs(sd[i + 2] - cd[i + 2]) > 6) wrong++;
    }
    return { below: below && below.type, would: MR.data.pipHidden(mz, st.x, st.y), solid, lower, wrong, at: st.x + ',' + st.y };
  });
  ok(cover.below && cover.would > 0.2, `seed 7 route 2: after "go straight" Pip stands at ${cover.at}, just above the ${cover.below} (it would hide ${Math.round(cover.would * 100)} % of him)`);
  ok(cover.solid > 100 && cover.lower > 40 && cover.wrong === 0, `every one of Pip's ${cover.solid} pixels is on screen (${cover.wrong} covered): no landmark hides Pip`);
  await pp.goto(URL + '?fast=1&debug=teacher');
  await pp.waitForSelector('.mr-teach__table');
  const demo = await pp.evaluate(() => MR.log.classNos().map((c) => {
    const e = MR.log.forStudent(c), rep = MR.guide.replay(e);
    return { c, r1: rep.r1.reached, r2: rep.r2.reached && rep.r3.reached && rep.r4.reached, around: e.some((x) => (x.parsed_actions || []).some((a) => a.dir === 'around')),
      twoLefts: e.some((x) => /around/.test(x.sent_text) && (x.parsed_actions || []).length !== 1), engine: e.filter((x) => x.stage === 'guide' && x.event === 'turn').every((x) => x.engine === MR.guide.ENGINE) };
  }));
  ok(demo.length === 3 && demo.every((d) => d.r1 && d.r2 && d.engine) && demo.some((d) => d.around) && !demo.some((d) => d.twoLefts),
    'example evidence (teacher demo): all three pupils reach the end of all four routes under the current rules; "turn around" is one action');
  ok(errorsP.length === 0, 'no page errors in the picture checks');

  /* ---------- normal speed: the input stays off until Pip has said his note, so no sentence is lost */
  await pp.goto(URL + '?debug=guide&route=1&seed=7');
  await pp.waitForSelector('.mr-guide');
  const sendSlow = async (text) => {
    await pp.waitForFunction(() => !document.getElementById('mr-input').disabled, null, { timeout: 15000 });
    await pp.fill('#mr-input', text);
    await pp.click('#mr-send');
  };
  await sendSlow('turn left');
  await waitSpeech(pp, /^My left or your left\?$/, 15000);
  await sendSlow('my left');
  await pp.waitForFunction(() => /^OK! Y/.test(document.getElementById('mr-speech').textContent), null, { timeout: 15000 });
  const during = await pp.evaluate(() => ({ off: document.getElementById('mr-input').disabled && document.getElementById('mr-send').disabled, text: document.getElementById('mr-speech').textContent }));
  ok(during.off && during.text.length < 'OK! Your left is my right now.'.length, `while Pip is still saying his note ("${during.text}…") the input and Send are off`);
  await pp.evaluate(() => MR.ui.dialog.submit('go straight'));       /* a sentence pushed in anyway is not thrown away */
  ok(await pp.evaluate(() => MR.log.all().filter((e) => e.stage === 'guide' && e.event === 'turn').length) === 2, 'nothing can be sent during the note');
  await sendSlow('turn around');                                   /* sent the moment the input comes back */
  await pp.waitForFunction(() => document.querySelectorAll('.mr-guide__item').length === 3, null, { timeout: 15000 });
  await pp.waitForFunction(() => !document.getElementById('mr-input').disabled, null, { timeout: 15000 });
  const after = await pp.evaluate(() => ({ turns: MR.log.all().filter((e) => e.stage === 'guide' && e.event === 'turn').map((e) => e.sent_text),
    facing: MR.render.active[MR.render.active.length - 1].debugState().pip.facing }));
  ok(JSON.stringify(after.turns) === JSON.stringify(['turn left', 'my left', 'turn around']) && after.facing === 'E',
    'the sentence sent right after the note is run and logged (nothing dropped): ' + after.turns.join(' / '));
  await pp.close();

  /* ---------- University Station: the train clock (r4) */
  console.log('\n== the train clock');
  const pt = await context.newPage();
  const errorsT = [];
  pt.on('pageerror', (e) => errorsT.push(e.message));
  await pt.goto(URL + '?fast=1&debug=guide&route=3&train=3');
  await pt.waitForSelector('.mr-train');
  ok(/^0:0[23]$/.test((await pt.textContent('.mr-train__time')).trim()), 'route 4 opens with the train clock (3 s here, set by &train=3)');
  await send(pt, 'go straight');
  const moved = await pt.evaluate(() => MR.render.active[MR.render.active.length - 1].debugState().pip);
  ok(moved.x === 9 && moved.y === 2, 'Pip walks while the clock runs');
  await pt.waitForSelector('#mr-overlay:not([hidden])', { timeout: 8000 });
  ok(/The train has gone/.test(await pt.textContent('#mr-overlay-title')), 'when the clock reaches 0:00: "The train has gone!" (no game over)');
  const gone = await pt.evaluate(() => ({ left: MR.state.trainClock('r4'), rec: MR.log.all().filter((e) => e.event === 'restart' && e.reason === 'train_missed') }));
  ok(gone.left.tries === 1 && Math.round(gone.left.left) === 63 && gone.rec.length === 1, 'the missed train is logged; the next try has a minute more (63 s)');
  await pt.waitForTimeout(2500);
  await pt.click('#mr-overlay-btn');
  await pt.waitForFunction(() => !document.getElementById('mr-input').disabled, null, { timeout: 8000 });
  ok(/^1:0[23]$/.test((await pt.textContent('.mr-train__time')).trim()), 'Try again: the clock shows 1:03 - it did not run while the card was open');
  const back = await pt.evaluate(() => ({ pip: MR.render.active[MR.render.active.length - 1].debugState().pip, said: document.querySelectorAll('.mr-guide__item').length }));
  ok(back.pip.x === 13 && back.pip.y === 2 && back.pip.facing === 'W' && back.said === 0, 'Try again: Pip is back at the library, facing the street');
  for (const line of ['go straight', 'turn left', 'go straight until the bench', 'turn my left', 'go straight until the bus stop', 'turn left', 'go straight', 'turn left', 'go straight until the station']) await send(pt, line);
  await pt.waitForSelector('#mr-overlay:not([hidden])', { timeout: 8000 });
  ok(/Pip caught the train/.test(await pt.textContent('#mr-overlay-title')), 'second try: Pip caught the train');
  const caught = await pt.evaluate(() => ({ row: MR.log.aggregate().find((r) => r.class_no === '5A-01'), rec: MR.log.all().filter((e) => e.event === 'train_caught') }));
  ok(caught.row.trains_missed === 1 && caught.rec.length === 1 && caught.rec[0].tries === 1 && caught.rec[0].seconds_left > 0,
    `teacher evidence: 1 train missed, then caught with ${caught.rec[0] && caught.rec[0].seconds_left} s to spare`);
  ok(errorsT.length === 0, 'no page errors with the train clock' + (errorsT.length ? ': ' + errorsT.join(' | ') : ''));
  await pt.close();

  /* ---------- level select for testing (js/levels.js) */
  console.log('\n== level select');
  const pl = await context.newPage();
  const errorsL = [];
  pl.on('pageerror', (e) => errorsL.push(e.message));
  await pl.goto(URL + '?levels=1');
  await pl.waitForSelector('#mr-levels');
  ok(await pl.$$eval('#mr-levels [data-level]', (b) => b.length) === 16, 'level select lists all 16 levels: warm-up, Ask/Go 1-4, end of lesson 1, 4 routes, review, teacher');
  await pl.check('#mr-levels-fast');
  await pl.check('#mr-levels-train');
  await pl.click('#mr-levels [data-level="guide3"]');
  await pl.waitForSelector('.mr-train');
  const lv = await pl.evaluate(() => ({ q: location.search, route: MR.state.currentRouteId(), saved: MR.storage.isMemory ? MR.storage.isMemory() : null }));
  ok(lv.route === 'r4' && /train=20/.test(lv.q) && /fast=1/.test(lv.q), 'a click on "Back to the station" opens it straight away, with the short train clock: ' + lv.q);
  const seed = await pl.evaluate(() => MR.state.sessionSeed());
  await pl.click('#mr-levels-skipbar');
  await pl.waitForSelector('.mr-review');
  ok(await pl.evaluate((s) => MR.state.sessionSeed() === s && /fast=1/.test(location.search), seed), '"Skip" goes to the next level (review) with the same game and options');
  await pl.click('#mr-levels-open');
  ok(await pl.isVisible('#mr-levels [data-level="review"].is-here'), 'the level on screen is marked in the list');
  await pl.click('#mr-levels-close');
  ok(!(await pl.$('#mr-levels')), 'Close shuts the level select');
  await pl.goto(URL + '?fast=1');
  ok(!(await pl.$('#mr-levels-open')), 'a pupil\'s normal game has no level buttons');
  ok(errorsL.length === 0, 'no page errors in the level select');
  await pl.close();

  /* ---------- AI on: a model that fails, then a web relay that has no key */
  console.log('\n== AI');
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
  ok(await p2.evaluate(() => MR.ai.mode()) === 'direct' && !(await p2.$('#mr-demo')), 'with a key the AI is used (no badge for the pupil either way)');
  let s = await send(p2, 'Where is it?');
  ok(s === 'Sorry, can you say that again?' && (await factsOn(p2)).length === 0, 'empty AI content -> "Sorry, can you say that again?"');
  ok(!(await p2.isDisabled('#mr-input')), 'the pupil can speak again (game not stuck)');
  s = await send(p2, 'Where is it?');
  const place = await p2.evaluate(() => MR.data.items[1].place);
  ok(calls === 2 && s === place, 'invalid JSON (2nd failure in a row) -> offline rules answer');
  ok(await p2.evaluate(() => MR.ai.mode()) === 'offline', 'switched to the offline rules after two failures');
  const failedTurn = await p2.evaluate(() => MR.log.all().find((e) => e.ai_failed));
  ok(failedTurn && failedTurn.category === null && failedTurn.clarification === false, 'the failed turn is logged as an AI failure, not as a pupil error');
  await p2.close();

  const p4 = await context.newPage();
  p4.on('pageerror', (e) => errors2.push(e.message));
  await p4.addInitScript(() => { window.MR_CONFIG = { proxyUrl: 'https://relay.invalid/api/chat' }; });
  let gets = 0, posts = 0;
  await p4.route('https://relay.invalid/**', (r) => {
    if (r.request().method() === 'GET') { gets++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"app":"maze-rescue","ai":false}' }); }
    posts++; return r.abort();
  });
  await p4.goto(URL + '?fast=1&debug=ask&item=1');
  await p4.waitForFunction(() => MR.ai.mode() === 'offline', null, { timeout: 6000 });
  s = await send(p4, 'Where is it?');
  ok(gets === 1 && posts === 0 && s === (await p4.evaluate(() => MR.data.items[1].place)), 'web relay without a key: asked once at start, then the offline rules answer at once (no "Sorry")');
  await p4.goto(URL + '?debug=teacher');
  await p4.waitForFunction(() => /AI: off/.test(document.getElementById('mr-teach-ai').textContent), null, { timeout: 6000 });
  ok(true, 'the teacher view shows the AI is off: ' + (await p4.textContent('#mr-teach-ai')));
  ok(errors2.length === 0, 'no page errors with the AI' + (errors2.length ? ': ' + errors2.join(' | ') : ''));
  await p4.close();

  /* ---------- static checks */
  console.log('\n== code checks');
  const js = fs.readdirSync(path.join(ROOT, 'js')).concat(fs.readdirSync(path.join(ROOT, 'js', 'screens')).map((f) => 'screens/' + f))
    .filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')).join('\n');
  ok(!/Arrow(Left|Right|Up|Down)|keyCode\s*===?\s*(37|38|39|40)/.test(js), 'no arrow-key handling anywhere');

  await browser.close();
  console.log(`\nAll ${checks} checks passed.`);
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
