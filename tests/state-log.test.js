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
    S.unlockFact(it.id, 'name'); S.unlockFact(it.id, 'look');
    assert.equal(S.nextScreen().screen, 'ask');
    const u = S.unlockFact(it.id, 'place');
    assert.equal(u.allUnlocked, true);
    assert.deepEqual(S.nextScreen(), { screen: 'go', params: { item: i } });
    assert.equal(S.collectItem(it.id), true);
    assert.equal(S.collectItem(it.id), false, 'only once');
    assert.equal(S.get().stars, i + 1);
  });
  assert.deepEqual(S.get().inventory, ['key', 'map', 'lamp', 'bag']);
  assert.equal(S.nextScreen().screen, 'sessionbreak');
  assert.equal(S.lesson(), 2);
  S.markBreakSeen();
  assert.deepEqual(S.nextScreen(), { screen: 'guide', params: { route: 0 } });
  S.finishRoute('r1', { instructions: 7, trail: [{ x: 1, y: 9 }] });
  assert.deepEqual(S.nextScreen(), { screen: 'guide', params: { route: 1 } });
  S.finishRoute('r2');
  assert.equal(S.get().stars, 6);
  assert.equal(S.nextScreen().screen, 'review');
});

test('state: hints, assisted flag, first-choice recording', () => {
  const MR = fresh(), S = MR.state;
  S.begin('6B-3');
  assert.equal(S.nextHintFact('key'), 'name');
  S.useHint('key', 'name', 1);
  assert.equal(S.unlockFact('key', 'name').assisted, false, 'level 1 is not "assisted"');
  assert.equal(S.nextHintFact('key'), 'look');
  S.useHint('key', 'look', 1); S.useHint('key', 'look', 2);
  const u = S.unlockFact('key', 'look');
  assert.equal(u.assisted, true); assert.equal(u.hint_level, 2); assert.equal(u.isNew, true);
  assert.equal(S.unlockFact('key', 'look').isNew, false);
  let j = S.recordJunction('key', 0, 1, false);
  assert.deepEqual(j, { first: true, first_choice_correct: false, attempts: 1 });
  j = S.recordJunction('key', 0, 0, true);
  assert.deepEqual(j, { first: false, first_choice_correct: false, attempts: 2 }, 'the first choice stays wrong');
  assert.equal(S.itemState('key').junctions[0].done, true);
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
function playOne(MR, classNo) {
  const S = MR.state, L = MR.log, key = MR.data.getItem('key');
  S.begin(classNo);
  L.event('warmup', 'summary', { correct: 7, total: 10 });
  const turn = (text, mode, asr) => {
    const result = Object.assign(MR.rules.answerAsk(key, text), { failed: false, source: 'rules' });
    let assisted = false, hint_level = 0;
    if (result.fact_given) { const u = S.unlockFact('key', result.fact_given); assisted = u.assisted; hint_level = u.hint_level; }
    return L.askTurn({ item_id: 'key', input_mode: mode || 'text', asr_text: asr || '', sent_text: text, result, assisted, hint_level });
  };
  turn('Where');                                             // clarification
  turn('Where it is?', 'speech', 'where it is');             // rewrite ok, grammar note, corrected ASR
  turn('What do you need?');
  S.useHint('key', 'look', 1); L.hint({ stage: 'ask', item_id: 'key', hint_level: 1, hint_fact: 'look' });
  S.useHint('key', 'look', 2); L.hint({ stage: 'ask', item_id: 'key', hint_level: 2, hint_fact: 'look' });
  turn('What does it look like?');                           // assisted
  turn('Where is it?');                                      // repeat: still 3 facts
  L.lockStage('ask', 'key');
  let j = S.recordJunction('key', 0, 1, false); L.goChoice({ item_id: 'key', junction_index: 0, choice: 1, correct: false, first: j.first, first_choice_correct: j.first_choice_correct });
  j = S.recordJunction('key', 0, 0, true); L.goChoice({ item_id: 'key', junction_index: 0, choice: 0, correct: true, first: j.first, first_choice_correct: j.first_choice_correct });
  j = S.recordJunction('key', 1, 0, true); L.goChoice({ item_id: 'key', junction_index: 1, choice: 0, correct: true, first: j.first, first_choice_correct: j.first_choice_correct });
  L.guideTurn({ route_id: 'r1', sent_text: 'turn', parsed_actions: [], clarify_triggered: true, ai_reply: 'Left or right?' });
  L.guideTurn({ route_id: 'r1', sent_text: 'turn left', parsed_actions: [{ type: 'turn', dir: 'left' }], hit_wall: false });
  L.guideTurn({ route_id: 'r1', sent_text: 'go straight', parsed_actions: [{ type: 'forward' }], hit_wall: true, ai_reply: 'There is a wall.' });
  L.guideTurn({ route_id: 'r1', sent_text: 'go to the exit', parsed_actions: [{ type: 'forward', until: 'exit' }], reached_exit: true });
}

test('log: record shape follows spec 5.3 (no player field), turn numbers, no audio', () => {
  const MR = fresh();
  playOne(MR, '5A-12');
  const e = MR.log.forStudent('5A-12', { stage: 'ask', event: 'turn' })[1];
  for (const f of ['class_no', 'stage', 'item_id', 'turn', 'input_mode', 'asr_text', 'sent_text', 'category', 'ai_reply', 'fact_given', 'hint_level', 'clarification', 'timestamp']) {
    assert.ok(f in e, 'field ' + f);
  }
  assert.ok(!('player' in e));
  assert.deepEqual([e.class_no, e.stage, e.item_id, e.turn, e.input_mode, e.asr_text, e.sent_text, e.category, e.fact_given, e.clarification],
    ['5A-12', 'ask', 'key', 2, 'speech', 'where it is', 'Where it is?', 'place', 'place', false]);
  assert.equal(e.ai_reply, 'It is behind the red door, next to the blue fountain.');
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
  playOne(MR, '5A-12');
  const before = MR.log.all().length;
  const res = MR.log.askTurn({ item_id: 'key', sent_text: 'Where is it?', result: MR.rules.answerAsk(MR.data.getItem('key'), 'Where is it?') });
  assert.equal(res, null);
  assert.equal(MR.log.all().length, before);
  assert.equal(MR.log.isLocked('ask', 'key'), true);
  assert.equal(MR.log.isLocked('ask', 'map'), false);
  assert.ok(MR.log.askTurn({ item_id: 'map', sent_text: 'Where is it?', result: MR.rules.answerAsk(MR.data.getItem('map'), 'Where is it?') }));
  MR.state.begin('5A-13');
  assert.equal(MR.log.isLocked('ask', 'key'), false);
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
  assert.equal(r.ask_turns, 5);
  assert.equal(r.go_attempts, 3);
  assert.equal(r.guide_instructions, 4);
  assert.equal(r.wall_hits, 1);
  assert.equal(r.warmup_correct, 7);
  assert.equal(r.corrected_asr, 1);
  assert.equal(r.grammar_notes.length, 2);        // "single word" + "word order"
  assert.deepEqual(MR.log.TOTALS, { facts: 12, junctions: 8, exits: 2 });
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
  assert.deepEqual(cells.slice(-3), ['2', '3', '0']);
});

test('log: export, then import / merge on another device (idempotent)', () => {
  let MR = fresh();
  playOne(MR, '5A-12');
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
  assert.equal(MR.log.isLocked('ask', 'key', '5A-12'), true, 'locks travel with the export');
  assert.equal(MR.log.aggregate().length, 2);
  assert.equal(MR.log.importJSON('not json').ok, false);
  assert.equal(MR.log.importJSON('{"app":"other"}').ok, false);
});
