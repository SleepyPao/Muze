'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MR } = require('./helper');
const { rules, data } = MR;
const key = data.getItem('key');
const cat = t => rules.classifyAsk(t).category;

test('Ask: spec section 8 keyword rules', () => {
  assert.equal(cat('Where is it?'), 'place');
  assert.equal(cat('Where can I find it?'), 'place');
  assert.equal(cat('What does it look like?'), 'look');
  assert.equal(cat('What colour is it?'), 'look');
  assert.equal(cat('What color is it?'), 'look');
  assert.equal(cat('Is it big?'), 'look');
  assert.equal(cat('Is it big or small?'), 'look');
  assert.equal(cat('What do you need?'), 'name');
  assert.equal(cat('What do you want?'), 'name');
  assert.equal(cat('What are you looking for?'), 'name');
  assert.equal(cat('What is it?'), 'name');
  assert.equal(cat('blah blah blah'), 'unclear');
});

test('Ask acceptance: "Where it is?" gets the place fact, with a teacher-only grammar note', () => {
  const r = rules.answerAsk(key, 'Where it is?');
  assert.equal(r.category, 'place');
  assert.equal(r.reply, key.place);
  assert.equal(r.fact_given, 'place');
  assert.equal(r.clarification, false);
  assert.match(r.grammar_note, /word order/);
  assert.equal(rules.classifyAsk('Where is it?').grammar_note, '');
  assert.match(rules.classifyAsk('What you need?').grammar_note, /missing "do"/);
  assert.match(rules.classifyAsk('What it look like?').grammar_note, /missing "does"/);
});

test('Ask acceptance: a single word gets a clarifying question and no fact', () => {
  const r = rules.answerAsk(key, 'Where');
  assert.equal(r.category, 'unclear');
  assert.equal(r.reply, 'Do you mean where it is?');
  assert.equal(r.fact_given, null);
  assert.equal(r.clarification, true);
  assert.equal(rules.answerAsk(key, 'where?').reply, 'Do you mean where it is?');
  assert.equal(rules.answerAsk(key, 'colour').reply, 'Do you mean what it looks like?');
  assert.equal(rules.answerAsk(key, 'What?').reply, 'Do you mean what I need?');
  assert.equal(rules.answerAsk(key, 'banana').category, 'unclear');
  assert.equal(rules.answerAsk(key, '').category, 'unclear');
  assert.equal(rules.answerAsk(key, '   ???  ').fact_given, null);
});

test('Ask: fragments without a verb are unclear ("Where key?")', () => {
  for (const t of ['Where key?', 'Where the key?', 'What colour?', 'big or small?', 'the place?']) {
    const r = rules.answerAsk(key, t);
    assert.equal(r.category, 'unclear', t);
    assert.equal(r.fact_given, null, t);
    assert.ok(r.reply.endsWith('?'), t);
    assert.ok(rules.classifyAsk(t).fragment, t);
  }
});

test('Ask: off-task gets a one-sentence redirect and no fact', () => {
  for (const t of ['Do you like football?', 'How are you?', 'What is your name?', 'hello', 'Where do you live?', 'Can you sing a song?']) {
    const r = rules.answerAsk(key, t);
    assert.equal(r.category, 'off_task', t);
    assert.equal(r.fact_given, null);
    assert.equal(r.reply.split(/[.!?]+/).filter(s => s.trim()).length, 1, 'one sentence');
    for (const w of ['key', 'yellow', 'door', 'fountain']) assert.ok(!r.reply.toLowerCase().includes(w));
  }
});

test('Ask: one question gives exactly one fact, always the canonical string', () => {
  for (const it of data.items) {
    assert.equal(rules.answerAsk(it, 'What do you need?').reply, 'I need ' + it.name + '.');
    assert.equal(rules.answerAsk(it, 'What does it look like?').reply, it.look);
    assert.equal(rules.answerAsk(it, 'Where is it?').reply, it.place);
    const look = rules.answerAsk(it, 'What does it look like?').reply;
    assert.ok(!look.includes(it.place) && !look.includes(it.name));
  }
});

/* ---------------------------------------------------------------- Guide parser */
const acts = (t, ctx) => rules.parseGuide(t, ctx).actions;

test('Guide: basic instructions', () => {
  assert.deepEqual(acts('Go straight.'), [{ type: 'forward' }]);
  assert.deepEqual(acts('go straight on'), [{ type: 'forward' }]);
  assert.deepEqual(acts('Walk forward'), [{ type: 'forward' }]);
  assert.deepEqual(acts('Go forward 3 steps'), [{ type: 'forward', steps: 3 }]);
  assert.deepEqual(acts('go forward two steps'), [{ type: 'forward', steps: 2 }]);
  assert.deepEqual(acts('walk 2 steps forward'), [{ type: 'forward', steps: 2 }]);
  assert.deepEqual(acts('go 4'), [{ type: 'forward', steps: 4 }]);
  assert.deepEqual(acts('Turn left'), [{ type: 'turn', dir: 'left' }]);
  assert.deepEqual(acts('turn right please'), [{ type: 'turn', dir: 'right' }]);
  assert.deepEqual(acts('Pip, turn to the right'), [{ type: 'turn', dir: 'right' }]);
  assert.deepEqual(acts('Stop!'), [{ type: 'stop' }]);
  assert.deepEqual(acts('go left'), [{ type: 'turn', dir: 'left' }, { type: 'forward' }]);
});

test('Guide: until / to / at the <landmark>', () => {
  assert.deepEqual(acts('Walk until the fountain'), [{ type: 'forward', until: 'fountain' }]);
  assert.deepEqual(acts('go straight until you see the big tree'), [{ type: 'forward', until: 'tree' }]);
  assert.deepEqual(acts('Walk to the red door.'), [{ type: 'forward', until: 'red_door' }]);
  assert.deepEqual(acts('go to the exit'), [{ type: 'forward', until: 'exit' }]);
  assert.deepEqual(acts('At the tree turn left'), [{ type: 'forward', until: 'tree' }, { type: 'turn', dir: 'left' }]);
  assert.deepEqual(acts('At the tree, turn left.'), [{ type: 'forward', until: 'tree' }, { type: 'turn', dir: 'left' }]);
  assert.deepEqual(acts('Turn right at the windmill'), [{ type: 'forward', until: 'windmill' }, { type: 'turn', dir: 'right' }]);
  assert.deepEqual(acts('when you see the well, stop'), [{ type: 'forward', until: 'well' }, { type: 'stop' }]);
});

test('Guide: several instructions chained with then / and / commas', () => {
  assert.deepEqual(acts('Go straight, then turn left and go forward 2 steps. Stop.'),
    [{ type: 'forward' }, { type: 'turn', dir: 'left' }, { type: 'forward', steps: 2 }, { type: 'stop' }]);
  assert.deepEqual(acts('go straight until the fountain then turn right and then go straight'),
    [{ type: 'forward', until: 'fountain' }, { type: 'turn', dir: 'right' }, { type: 'forward' }]);
  assert.deepEqual(acts('Go straight. At the tree, turn left. Go to the windmill.'),
    [{ type: 'forward' }, { type: 'forward', until: 'tree' }, { type: 'turn', dir: 'left' }, { type: 'forward', until: 'windmill' }]);
});

test('Guide acceptance: bare "turn" -> "Left or right?"', () => {
  for (const t of ['turn', 'Turn.', 'Go straight and turn', 'please turn']) {
    const r = rules.parseGuide(t);
    assert.deepEqual(r.actions, [], t);
    assert.equal(r.clarify, 'Left or right?', t);
    assert.equal(r.clarifyKind, 'dir');
  }
  assert.deepEqual(acts('left', { expect: 'dir' }), [{ type: 'turn', dir: 'left' }]);
  assert.deepEqual(acts('Right!', { expect: 'dir' }), [{ type: 'turn', dir: 'right' }]);
  assert.equal(rules.parseGuide('left').clarifyKind, 'oneword');
});

test('Guide: unknown landmark -> "I can\'t see a ... What can I see?" (a question, nothing else)', () => {
  const r = rules.parseGuide('Go straight until the house');
  assert.deepEqual(r.actions, []);
  assert.equal(r.clarify, 'I can’t see a house. What can I see?');
  assert.equal(r.clarifyKind, 'landmark');
  assert.equal(rules.parseGuide('turn left at the elephant').clarify, 'I can’t see an elephant. What can I see?');
  for (const id of data.landmarkIds) assert.ok(!r.clarify.includes(data.landmarkTypes[id].name), 'lists no landmark');
});

test('Guide: "your left" / "my left" answers', () => {
  assert.deepEqual(acts('your left', { expect: 'whose', pendingDir: 'left' }), [{ type: 'turn', dir: 'left', whose: 'your' }]);
  assert.deepEqual(acts('My left.', { expect: 'whose', pendingDir: 'left' }), [{ type: 'turn', dir: 'left', whose: 'my' }]);
  assert.deepEqual(acts('mine', { expect: 'whose', pendingDir: 'right' }), [{ type: 'turn', dir: 'right', whose: 'my' }]);
  assert.deepEqual(acts('yours', { expect: 'whose', pendingDir: 'right' }), [{ type: 'turn', dir: 'right', whose: 'your' }]);
  assert.deepEqual(acts('left', { expect: 'whose', pendingDir: 'left' }), [{ type: 'turn', dir: 'left', whose: 'your' }]);
  assert.deepEqual(acts('turn to your left'), [{ type: 'turn', dir: 'left', whose: 'your' }]);
  assert.deepEqual(acts('turn my right'), [{ type: 'turn', dir: 'right', whose: 'my' }]);
});

test('Guide: nonsense is not understood', () => {
  for (const t of ['', 'banana', 'fly to the moon', 'I like cats', 'go go go banana']) {
    const r = rules.parseGuide(t);
    assert.deepEqual(r.actions, [], t);
    assert.ok(r.clarify && r.clarify.endsWith('?'), t);
  }
});
