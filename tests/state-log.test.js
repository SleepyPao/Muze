'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh } = require('./helper');

test('state: flow Start -> Warm-up -> Ask/Go x4 -> break -> Guide x2 -> Review', () => {
  const MR = fresh(), S = MR.state;
  assert.equal(S.nextScreen().screen, 'start');
  assert.equal(S.begin(' 5a - 12 ', 'standard').resumed, false);
  assert.equal(S.classNo(), '5A-12');
  assert.equal(S.nextScreen().screen, 'warmup');
  S.finishWarmup(8, 10);
  MR.data.items.forEach((it, i) => {
    assert.deepEqual(S.nextScreen(), { screen: 'ask', params: { item: i } });
    assert.equal(S.lesson(), 1);
    // acceptance: no questions -> no Go, and no pick-up
    assert.equal(S.allFactsUnlocked(it.id), false);
    assert.equal(S.collectItem(it.id), false);
    // only the three kinds of fact on this thing's card can be unlocked
    const slots = MR.data.slotsOf(it);
    assert.equal(slots.length, 3);
    for (const f of MR.data.FACTS.filter((x) => !slots.includes(x))) assert.equal(S.unlockFact(it.id, f).isNew, false, f + ' is not on the card');
    assert.equal(S.unlockFact(it.id, 'look').isNew, false, 'the old "look" fact does not exist any more');
    assert.deepEqual(S.givenFacts(it.id), []);
    S.unlockFact(it.id, slots[0]); S.unlockFact(it.id, slots[1]);
    assert.deepEqual(S.givenFacts(it.id), slots.slice(0, 2));
    assert.equal(S.allFactsUnlocked(it.id), false, 'Go stays locked until all 3 slots are lit');
    assert.equal(S.nextScreen().screen, 'ask');
    const u = S.unlockFact(it.id, 'place');
    assert.equal(u.allUnlocked, true);
    assert.deepEqual(S.nextScreen(), { screen: 'go', params: { item: i } });
    assert.equal(S.collectItem(it.id), true);
    assert.equal(S.collectItem(it.id), false, 'only once');
    assert.equal(S.get().stars, i + 1);
  });
  assert.deepEqual(S.get().inventory, MR.data.items.map((it) => it.id));
  assert.equal(new Set(S.get().inventory).size, 4);
  assert.equal(S.nextScreen().screen, 'sessionbreak');
  assert.equal(S.lesson(), 2);
  S.markBreakSeen();
  assert.deepEqual(S.nextScreen(), { screen: 'guide', params: { route: 0 } });
  S.finishRoute('r1', { instructions: 7, trail: [{ x: 1, y: 9 }] });
  assert.deepEqual(S.nextScreen(), { screen: 'guide', params: { route: 1 } });
  S.finishRoute('r2');
  assert.deepEqual(S.nextScreen(), { screen: 'guide', params: { route: 2 } });   /* the real-world route */
  S.finishRoute('r3');
  assert.equal(S.get().stars, 7);
  assert.equal(S.nextScreen().screen, 'review');
});

test('state: hints, assisted flag, first-choice recording', () => {
  const MR = fresh(), S = MR.state;
  S.begin('6B-3');
  const id = MR.data.items[0].id, [a, b] = MR.data.slotsOf(id);
  // hints are about the first locked slot of THIS thing's card
  assert.equal(S.nextHintFact(id), a);
  S.useHint(id, a, 1);
  assert.equal(S.unlockFact(id, a).assisted, false, 'level 1 is not "assisted"');
  assert.equal(S.nextHintFact(id), b);
  S.useHint(id, b, 1); S.useHint(id, b, 2);
  const u = S.unlockFact(id, b);
  assert.equal(u.assisted, true); assert.equal(u.hint_level, 2); assert.equal(u.isNew, true);
  assert.equal(S.unlockFact(id, b).isNew, false);
  assert.equal(S.nextHintFact(id), 'place');
  S.unlockFact(id, 'place');
  assert.equal(S.nextHintFact(id), null);
  const off = MR.data.FACTS.find((f) => !MR.data.slotsOf(id).includes(f));
  assert.equal(S.useHint(id, off, 2), 0, 'no hint for a kind that is not on the card');
  let j = S.recordJunction(id, 0, 1, false);
  assert.deepEqual(j, { first: true, first_choice_correct: false, attempts: 1 });
  j = S.recordJunction(id, 0, 0, true);
  assert.deepEqual(j, { first: false, first_choice_correct: false, attempts: 2 }, 'the first choice stays wrong');
  assert.equal(S.itemState(id).junctions[0].done, true);
});

test('state: persists per class number; lesson 2 resumes at Guide; reset', () => {
  const MR = fresh(), S = MR.state;
  S.seed({ class_no: '5A-12', warmup: true, items: 4, breakSeen: true });
  S.begin('5A-13', 'simple');                       // next pupil on the same device
  assert.equal(S.nextScreen().screen, 'warmup');
  assert.equal(S.get().difficulty, 'simple');
  S.init();                                         // "reload"
  assert.equal(S.classNo(), '5A-13');
  const back = S.begin('5a-12');                    // lesson 2: first pupil returns
  assert.equal(back.resumed, true);
  assert.deepEqual(S.nextScreen(), { screen: 'guide', params: { route: 0 } });
  assert.equal(S.get().stars, 4);
  S.signOut();
  assert.equal(S.get(), null); assert.equal(S.hasSaved('5A-12'), true);
  S.reset('5A-12');
  assert.equal(S.hasSaved('5A-12'), false); assert.equal(S.hasSaved('5A-13'), true);
  assert.equal(S.begin('5A-12').resumed, false);
});

test('class number validation', () => {
  const { MR } = require('./helper');
  for (const ok of ['5A-12', '6b3', '5 A 07', '12']) assert.ok(MR.util.validClassNo(ok), ok);
  for (const bad of ['', 'A', 'Chan Tai Man', 'abc', '5A-12-very-long-id']) assert.ok(!MR.util.validClassNo(bad), bad);
});

/* ------------------------------------------------------------------ log */
const ASK = { name: 'What do you need?', colour: 'What colour is it?', size: 'Is it big or small?', whose: 'Whose is it?',
  why: 'Why do you need it?', when: 'When did you lose it?', place: 'Where is it?' };
function playOne(MR, classNo) {
  const S = MR.state, L = MR.log;
  S.begin(classNo);
  const key = MR.data.items[0], id = key.id;          // this game's first thing
  L.event('warmup', 'summary', { correct: 7, total: 10 });
  const turn = (text, mode, asr) => {
    const result = Object.assign(MR.rules.answerAsk(key, text, S.givenFacts(id)), { failed: false, source: 'rules' });
    let assisted = false, hint_level = 0;
    if (result.fact_given) { const u = S.unlockFact(id, result.fact_given); assisted = u.assisted; hint_level = u.hint_level; }
    return L.askTurn({ item_id: id, input_mode: mode || 'text', asr_text: asr || '', sent_text: text, result, assisted, hint_level });
  };
  const [a, b] = MR.data.slotsOf(key);                       // the two other kinds of fact on this thing's card
  const off = MR.data.FACTS.find((f) => !key.slots.includes(f));
  turn('Where');                                             // clarification
  turn('Where it is?', 'speech', 'where it is');             // rewrite ok, grammar note, corrected ASR
  turn(ASK[a]);
  S.useHint(id, b, 1); L.hint({ stage: 'ask', item_id: id, hint_level: 1, hint_fact: b });
  S.useHint(id, b, 2); L.hint({ stage: 'ask', item_id: id, hint_level: 2, hint_fact: b });
  turn(ASK[b]);                                              // assisted
  turn(ASK[off]);                                            // not on the card: no fact, not a clarification
  turn('Where is it?');                                      // repeat: still 3 facts
  L.lockStage('ask', id);
  let j = S.recordJunction(id, 0, 1, false); L.goChoice({ item_id: id, junction_index: 0, choice: 1, correct: false, first: j.first, first_choice_correct: j.first_choice_correct });
  j = S.recordJunction(id, 0, 0, true); L.goChoice({ item_id: id, junction_index: 0, choice: 0, correct: true, first: j.first, first_choice_correct: j.first_choice_correct });
  j = S.recordJunction(id, 1, 0, true); L.goChoice({ item_id: id, junction_index: 1, choice: 0, correct: true, first: j.first, first_choice_correct: j.first_choice_correct });
  L.guideTurn({ route_id: 'r1', sent_text: 'turn', parsed_actions: [], clarify_triggered: true, ai_reply: 'Left or right?' });
  L.guideTurn({ route_id: 'r1', sent_text: 'turn left', parsed_actions: [{ type: 'turn', dir: 'left' }], hit_wall: false });
  L.guideTurn({ route_id: 'r1', sent_text: 'go straight', parsed_actions: [{ type: 'forward' }], hit_wall: true, ai_reply: 'There is a wall.' });
  L.guideTurn({ route_id: 'r1', sent_text: 'go to the exit', parsed_actions: [{ type: 'forward', until: 'exit' }], reached_exit: true });
  return key;
}

test('log: record shape follows spec 5.3 (no player field), turn numbers, no audio', () => {
  const MR = fresh();
  const it = playOne(MR, '5A-12');
  const e = MR.log.forStudent('5A-12', { stage: 'ask', event: 'turn' })[1];
  for (const f of ['class_no', 'stage', 'item_id', 'turn', 'input_mode', 'asr_text', 'sent_text', 'category', 'ai_reply', 'fact_given', 'hint_level', 'clarification', 'timestamp']) {
    assert.ok(f in e, 'field ' + f);
  }
  assert.ok(!('player' in e));
  assert.deepEqual([e.class_no, e.stage, e.item_id, e.turn, e.input_mode, e.asr_text, e.sent_text, e.category, e.fact_given, e.clarification],
    ['5A-12', 'ask', it.id, 2, 'speech', 'where it is', 'Where it is?', 'place', 'place', false]);
  assert.equal(e.ai_reply, it.place);
  assert.match(e.grammar_note, /word order/);
  assert.equal(e.rewrite_success, true);
  assert.ok(!isNaN(Date.parse(e.timestamp)));
  const withAudio = MR.log.add({ stage: 'guide', route_id: 'r2', sent_text: 'x', audio: 'BLOB' });
  assert.ok(!('audio' in withAudio));
  const g = MR.log.forStudent('5A-12', { stage: 'guide', route_id: 'r1' });
  assert.deepEqual(g.map(x => x.turn), [1, 2, 3, 4]);
  assert.deepEqual(g.map(x => x.rewrite_success), [null, true, null, null]);
  assert.deepEqual(g[1].parsed_actions, [{ type: 'turn', dir: 'left' }]);
  for (const f of ['parsed_actions', 'clarify_triggered', 'rewrite_success', 'hit_wall', 'reached_exit']) assert.ok(f in g[0], f);
  const j = MR.log.forStudent('5A-12', { stage: 'go' })[0];
  for (const f of ['junction_index', 'choice', 'first_choice_correct']) assert.ok(f in j, f);
});

test('log: a locked stage is read-only; other stages and pupils are not affected', () => {
  const MR = fresh();
  const it = playOne(MR, '5A-12'), other = MR.data.items[1];
  const before = MR.log.all().length;
  const res = MR.log.askTurn({ item_id: it.id, sent_text: 'Where is it?', result: MR.rules.answerAsk(it, 'Where is it?') });
  assert.equal(res, null);
  assert.equal(MR.log.all().length, before);
  assert.equal(MR.log.isLocked('ask', it.id), true);
  assert.equal(MR.log.isLocked('ask', other.id), false);
  assert.ok(MR.log.askTurn({ item_id: other.id, sent_text: 'Where is it?', result: MR.rules.answerAsk(other, 'Where is it?') }));
  MR.state.begin('5A-13');
  assert.equal(MR.log.isLocked('ask', it.id), false);
  // returned records are copies: changing them does not change the log
  const copy = MR.log.all(); copy[0].class_no = 'HACK';
  assert.notEqual(MR.log.all()[0].class_no, 'HACK');
});

test('log: per-pupil aggregation for the teacher view', () => {
  const MR = fresh();
  playOne(MR, '5A-12');
  playOne(MR, '5A-07');
  const rows = MR.log.aggregate();
  assert.deepEqual(rows.map(r => r.class_no), ['5A-07', '5A-12']);
  const r = rows[1];
  assert.equal(r.facts_asked, 3);                 // of 12
  assert.equal(r.facts_assisted, 1);
  assert.equal(r.junctions_first_correct, 1);     // of 8: junction 0 first choice was wrong
  assert.equal(r.junctions_done, 2);
  assert.equal(r.exits_reached, 1);               // of 2
  assert.equal(r.clarifications, 2);              // "Where" + "turn"
  assert.equal(r.rewrites_ok, 2);
  assert.equal(r.hints_used, 2);
  assert.equal(r.ask_turns, 6);
  assert.equal(r.off_card, 1);                    // one question about a kind of fact that was not on the card
  const offTurn = MR.log.forStudent('5A-12', { stage: 'ask', event: 'turn' })[4];
  assert.deepEqual([offTurn.fact_given, offTurn.off_card, offTurn.clarification, offTurn.ai_reply], [null, true, false, MR.data.text.offCard]);
  assert.ok(MR.data.FACTS.includes(offTurn.category) && !MR.log.sessionOf('5A-12').items[0].slots.includes(offTurn.category), 'logged with the kind that was asked');
  assert.equal(r.go_attempts, 3);
  assert.equal(r.guide_instructions, 4);
  assert.equal(r.wall_hits, 1);
  assert.equal(r.warmup_correct, 7);
  assert.equal(r.corrected_asr, 1);
  assert.equal(r.grammar_notes.length, 2);        // "single word" + "word order"
  assert.deepEqual(MR.log.TOTALS, { facts: 12, junctions: 8, exits: 3 });
});

test('log: rubric A and C (0-3), CSV export', () => {
  const MR = fresh();
  playOne(MR, '5A-12');
  MR.log.setRubric('5A-12', { A_question_form: 2, C_precision: 3 });
  MR.log.setRubric('5A-12', { C_repair: 7 });        // out of range: ignored
  assert.deepEqual(MR.log.getRubric('5a-12'), { A_question_form: 2, C_precision: 3, C_repair: null });
  MR.log.setRubric('5A-12', { C_repair: 0 });
  const csv = MR.log.toCSV().trim().split('\r\n');
  assert.equal(csv.length, 2);
  assert.equal(csv[0], MR.log.CSV_COLUMNS.join(','));
  const cells = csv[1].split(',');
  assert.equal(cells.length, MR.log.CSV_COLUMNS.length);
  assert.equal(cells[0], '5A-12');
  assert.deepEqual(cells.slice(1, 5), ['3', '1', '1', '1']);
  assert.deepEqual(cells.slice(-4), ['2', '3', '0', '0']);   /* rubric A, C, C + right thing first try */
});

test('log: export, then import / merge on another device (idempotent)', () => {
  let MR = fresh();
  const it = playOne(MR, '5A-12');
  MR.log.setRubric('5A-12', { A_question_form: 3 });
  const exported = MR.log.exportJSON();
  const n = MR.log.all().length;
  assert.ok(!/audio|player/.test(exported));
  MR = fresh();                                   // "another device"
  playOne(MR, '6B-01');
  const own = MR.log.all().length;
  let res = MR.log.importJSON(exported);
  assert.deepEqual(res, { ok: true, added: n, skipped: 0 });
  assert.equal(MR.log.all().length, own + n);
  res = MR.log.importJSON(exported);
  assert.deepEqual(res, { ok: true, added: 0, skipped: n });
  assert.deepEqual(MR.log.classNos(), ['5A-12', '6B-01']);
  assert.equal(MR.log.getRubric('5A-12').A_question_form, 3);
  assert.equal(MR.log.isLocked('ask', it.id, '5A-12'), true, 'locks travel with the export');
  assert.equal(MR.log.aggregate().length, 2);
  assert.equal(MR.log.importJSON('not json').ok, false);
  assert.equal(MR.log.importJSON('{"app":"other"}').ok, false);
});

test('old evidence still counts: "look" facts of logs written when every card was name / look / place', () => {
  const MR = fresh();
  const old = { app: 'maze-rescue', format: 1, device_id: 'old', entries: [] };
  let n = 0;
  const add = (item, fact, extra) => old.entries.push(Object.assign({ id: 'old-' + (++n), class_no: '4C-01', stage: 'ask', event: 'turn', item_id: item,
    sent_text: 'x', category: fact, fact_given: fact, ai_reply: 'y', timestamp: new Date(Date.UTC(2026, 0, 1, 9, 0, n)).toISOString() }, extra || {}));
  for (const item of ['key', 'map', 'lamp', 'bag']) { add(item, 'name'); add(item, 'look', { assisted: item === 'map' }); add(item, 'place'); add(item, 'look'); }
  assert.equal(MR.log.importJSON(JSON.stringify(old)).added, 16);
  const row = MR.log.aggregate().find((r) => r.class_no === '4C-01');
  assert.equal(row.facts_asked, 12, '4 things x (name, look, place)');
  assert.equal(row.facts_assisted, 1);
  assert.equal(MR.log.TOTALS.facts, 12);
  assert.match(MR.log.toCSV().split('\r\n')[0], /^class_no,facts_asked_of_12,facts_assisted,/);
  // new kinds are counted the same way, one per thing and kind; unknown kinds are not
  MR.state.begin('5A-12', 'standard', { seed: 11 });
  const it = MR.data.items[0];
  for (const f of it.slots.concat([it.slots[0], 'weight'])) {
    MR.log.askTurn({ item_id: it.id, sent_text: 'q', result: { category: f, fact_given: f, reply: 'r' } });
  }
  assert.equal(MR.log.aggregate().find((r) => r.class_no === '5A-12').facts_asked, 3);
});

test('a game saved when every card was name / look / place keeps working with the new cards', () => {
  const MR = fresh(), S = MR.state;
  S.begin('5A-12', 'standard', { seed: 21 });
  const ids = MR.data.items.map((i) => i.id);
  // rewrite the saved game the way the old version stored it: first thing found, second thing half asked
  const all = MR.storage.get('mr.sessions.v1'), s = all['5A-12'];
  ids.forEach((id, i) => {
    s.items[id].facts = { name: i < 2, look: i < 2, place: i < 1 };
    s.items[id].assisted = { name: false, look: i === 1, place: false };
    s.items[id].hintLevel = { name: 0, look: 0, place: 0 };
    s.items[id].collected = i < 1;
  });
  s.itemIndex = 1; s.inventory = [ids[0]]; s.stars = 1; s.warmup.done = true;
  MR.storage.set('mr.sessions.v1', all);
  S.init();                                              // reload
  assert.equal(S.allFactsUnlocked(ids[0]), true, 'a thing already found stays complete');
  const second = MR.data.slotsOf(ids[1]);
  for (const f of second) {
    const want = f === 'name' || f === 'colour' || f === 'size';       // old "name" and "look" (= colour and size) were asked
    assert.equal(!!S.itemState(ids[1]).facts[f], want, ids[1] + ' ' + f);
  }
  assert.equal(S.nextScreen().screen, 'ask');
  for (const f of second) S.unlockFact(ids[1], f);
  assert.equal(S.allFactsUnlocked(ids[1]), true);
  assert.equal(S.collectItem(ids[1]), true);
  assert.equal(S.allFactsUnlocked(ids[2]), false);
});

test('log: "Which one is it?" - only the first tap per thing counts', () => {
  const MR = fresh();
  MR.state.begin('5A-30', 'standard', { seed: 5 });
  const ids = MR.data.items.map((i) => i.id);
  MR.log.event('go', 'claim', { item_id: ids[0], choice: 1, correct: true, first: true });
  MR.log.event('go', 'claim', { item_id: ids[1], choice: 0, correct: false, first: true });
  MR.log.event('go', 'claim', { item_id: ids[1], choice: 2, correct: true, first: false });
  const row = MR.log.aggregate()[0];
  assert.equal(row.claims_first_correct, 1);
  assert.equal(row.claim_attempts, 3);
});
