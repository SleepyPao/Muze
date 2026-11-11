'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MR } = require('./helper');
const { rules, data } = MR;
const key = data.getItem('key');
const cat = t => rules.classifyAsk(t).category;

/** A thing of some game whose card has (or has not) these kinds of fact. */
function thingWith(has, hasNot) {
  for (let seed = 0; seed < 400; seed++) {
    data.useSession(seed);
    const it = data.items.find((i) => (has || []).every((f) => i.slots.includes(f)) && (hasNot || []).every((f) => !i.slots.includes(f)));
    if (it) return it;
  }
  throw new Error('no thing with ' + has + ' / without ' + hasNot);
}
test.afterEach(() => data.useSession(null));

/* every kind of fact: correct questions, questions with a small error (answered, with a teacher note), fragments */
const TABLE = {
  place: { ok: ['Where is it?', 'Where can I find it?', 'Where is the key?', 'Can you tell me where it is?'],
    err: [['Where it is?', /word order/], ['Where the key is?', /word order/], ['Where are it?', /verb form/]],
    frag: ['Where', 'where?', 'Where key?', 'Where the key?', 'the place?'], clarify: 'Do you mean where it is?' },
  name: { ok: ['What do you need?', 'What do you want?', 'What are you looking for?', 'What is it?', 'What thing do you need?'],
    err: [['What you need?', /missing "do"/], ['What it is?', /word order/], ['What are you need?', /verb form/]],
    frag: ['What?', 'need', 'Which thing?'], clarify: 'Do you mean what I need?' },
  colour: { ok: ['What colour is it?', 'What color is it?', 'Can you tell me the colour?', 'Is it red?', 'What colour is the thing?'],
    err: [['What colour it is?', /word order/], ['What colour is?', /missing subject/], ['What is it colour?', /word order/]],
    frag: ['colour', 'What colour?', 'The colour?', 'Color'], clarify: 'Do you mean what colour it is?' },
  size: { ok: ['Is it big or small?', 'Is it big?', 'How big is it?', 'What size is it?', 'Is it small?'],
    err: [['How big it is?', /word order/], ['It is big?', /word order/]],
    frag: ['big', 'size', 'big or small?', 'How big?'], clarify: 'Do you mean how big it is?' },
  whose: { ok: ['Whose is it?', 'Whose thing is it?', 'Who owns it?', 'Is it yours?', 'Who does it belong to?'],
    err: [['Whose it is?', /word order/], ['Whos is it?', /spelling/], ['Who’s is it?', /spelling/], ['Whose the key is?', /word order/]],
    frag: ['Whose', 'whose?', 'Whose key?', 'Whose thing?'], clarify: 'Do you mean whose it is?' },
  why: { ok: ['Why do you need it?', 'Why do you want it?', 'What is it for?', 'What do you need it for?', 'Why is it important?'],
    err: [['Why you need it?', /missing "do"/], ['Why does you need it?', /verb form/], ['Why need it?', /missing subject/]],
    frag: ['Why', 'why?', 'Why it?', 'What for?'], clarify: 'Do you mean why I need it?' },
  when: { ok: ['When did you lose it?', 'When was it lost?', 'What day did you lose it?', 'When did you last see it?'],
    err: [['When you lose it?', /missing "did"/], ['When did you lost it?', /verb form/], ['When you lost it?', /missing "did"/]],
    frag: ['When', 'when?', 'When lost?', 'When it?'], clarify: 'Do you mean when I lost it?' }
};

test('Ask: classifier table - all seven kinds of fact, correct questions', () => {
  assert.deepEqual(Object.keys(TABLE).sort(), data.FACTS.slice().sort());
  for (const f of data.FACTS) for (const t of TABLE[f].ok) {
    const c = rules.classifyAsk(t);
    assert.deepEqual([c.category, c.fragment, c.grammar_note], [f, false, ''], t);
  }
  assert.equal(cat('What does it look like?'), 'look');
  assert.equal(cat('blah blah blah'), 'unclear');
  assert.equal(cat('Is it behind the red door?'), 'unclear', 'a colour word in a place guess is not a colour question');
});

test('Ask: classifier table - small grammar errors are still understood, with a teacher-only note', () => {
  for (const f of data.FACTS) for (const [t, note] of TABLE[f].err) {
    const c = rules.classifyAsk(t);
    assert.equal(c.category, f, t);
    assert.equal(c.fragment, false, t);
    assert.match(c.grammar_note, note, t);
    // the fact is given when that kind is on the card; the note never reaches the pupil's line
    const it = thingWith([f]);
    const r = rules.answerAsk(it, t);
    assert.deepEqual([r.category, r.fact_given, r.clarification, r.off_card], [f, f, false, false], t);
    assert.equal(r.reply, data.factText(it.id, f), t);
  }
  assert.match(rules.classifyAsk('What it look like?').grammar_note, /missing "does"/);
});

test('Ask: classifier table - single words and fragments get the clarifying question of their kind, never a fact', () => {
  for (const f of data.FACTS) for (const t of TABLE[f].frag) {
    const c = rules.classifyAsk(t);
    assert.deepEqual([c.category, c.clarify, c.fragment, c.confident], ['unclear', f, true, true], t);
    for (const it of [thingWith([f]), f === 'place' ? thingWith(['place']) : thingWith([], [f])]) {
      const r = rules.answerAsk(it, t);
      assert.deepEqual([r.category, r.fact_given, r.clarification, r.off_card], ['unclear', null, true, false], t);
      assert.equal(r.reply, TABLE[f].clarify, t);
    }
  }
  assert.equal(rules.answerAsk(key, 'look').reply, 'Do you mean what it looks like?');
  assert.equal(rules.answerAsk(key, 'banana').category, 'unclear');
  assert.equal(rules.answerAsk(key, 'banana').reply, data.text.clarify.generic);
  assert.equal(rules.answerAsk(key, '').category, 'unclear');
  assert.equal(rules.answerAsk(key, '   ???  ').fact_given, null);
});

test('Ask acceptance: "Where it is?" gets the place fact, with a teacher-only grammar note', () => {
  const r = rules.answerAsk(key, 'Where it is?');
  assert.equal(r.category, 'place');
  assert.equal(r.reply, key.place);
  assert.equal(r.fact_given, 'place');
  assert.equal(r.clarification, false);
  assert.match(r.grammar_note, /word order/);
  assert.equal(rules.classifyAsk('Where is it?').grammar_note, '');
});

test('Ask acceptance: a single word gets a clarifying question and no fact', () => {
  const r = rules.answerAsk(key, 'Where');
  assert.equal(r.category, 'unclear');
  assert.equal(r.reply, 'Do you mean where it is?');
  assert.equal(r.fact_given, null);
  assert.equal(r.clarification, true);
});

test('Ask: off-task gets a one-sentence redirect and no fact', () => {
  for (const t of ['Do you like football?', 'How are you?', 'What is your name?', 'hello', 'Where do you live?', 'Can you sing a song?', 'When do you play football?', 'Why do you like pizza?']) {
    const r = rules.answerAsk(key, t);
    assert.equal(r.category, 'off_task', t);
    assert.equal(r.fact_given, null);
    assert.equal(r.off_card, false);
    assert.equal(r.reply.split(/[.!?]+/).filter(s => s.trim()).length, 1, 'one sentence');
    for (const w of ['key', 'yellow', 'door', 'fountain']) assert.ok(!r.reply.toLowerCase().includes(w));
  }
});

const QUESTION = { name: 'What do you need?', colour: 'What colour is it?', size: 'Is it big or small?', whose: 'Whose is it?',
  why: 'Why do you need it?', when: 'When did you lose it?', place: 'Where is it?' };

test('Ask: one question gives exactly one fact, always the canonical string, and only a kind that is on the card', () => {
  for (let seed = 0; seed < 60; seed++) {
    data.useSession(seed);
    for (const it of data.items) {
      const all = data.FACTS.map((f) => data.factText(it.id, f));
      for (const f of data.FACTS) {
        const r = rules.answerAsk(it, QUESTION[f]);
        if (it.slots.includes(f)) {
          assert.deepEqual([r.category, r.fact_given, r.off_card, r.clarification], [f, f, false, false]);
          assert.equal(r.reply, data.factText(it.id, f));
          assert.equal(all.filter((t) => r.reply.includes(t)).length, 1, 'one fact only: ' + r.reply);
        } else {
          /* a clear question that is not on the card: no fact, one canned line, not a clarification */
          assert.deepEqual([r.category, r.fact_given, r.off_card, r.clarification], [f, null, true, false], `seed ${seed} ${it.id} ${f}`);
          assert.equal(r.reply, 'I can’t tell you that. Look at your card.');
        }
      }
    }
  }
});

test('Ask: "What does it look like?" answers colour or size, whichever is on the card', () => {
  const Q = 'What does it look like?';
  let it = thingWith(['colour'], ['size']);
  assert.deepEqual([rules.answerAsk(it, Q).fact_given, rules.answerAsk(it, Q).reply], ['colour', 'It is ' + it.colour + '.']);
  assert.equal(rules.answerAsk(it, Q, ['colour']).fact_given, 'colour', 'asked again: the same fact again');
  it = thingWith(['size'], ['colour']);
  assert.deepEqual([rules.answerAsk(it, Q).fact_given, rules.answerAsk(it, Q).reply], ['size', 'It is ' + it.size + '.']);
  it = thingWith(['colour', 'size']);
  assert.equal(rules.answerAsk(it, Q, []).fact_given, 'colour', 'both on the card: the first locked one');
  assert.equal(rules.answerAsk(it, Q, ['colour']).fact_given, 'size');
  assert.equal(rules.answerAsk(it, Q, ['size']).fact_given, 'colour');
  assert.equal(rules.answerAsk(it, Q, ['colour', 'size']).fact_given, 'colour');
  it = thingWith([], ['colour', 'size']);
  const r = rules.answerAsk(it, Q);
  assert.deepEqual([r.fact_given, r.off_card, r.clarification, r.reply], [null, true, false, data.text.offCard]);
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
  /* Pip is a girl's voice: "her left", "their left", "Pip's left" all mean Pip's own side */
  for (const w of ['her', 'their', 'his', 'pip’s', "Pip's", 'pips', 'pip']) {
    assert.deepEqual(acts(w + ' left', { expect: 'whose', pendingDir: 'left' }), [{ type: 'turn', dir: 'left', whose: 'your' }], w);
    assert.deepEqual(acts('turn ' + w + ' right'), [{ type: 'turn', dir: 'right', whose: 'your' }], w);
  }
  assert.deepEqual(acts('hers', { expect: 'whose', pendingDir: 'right' }), [{ type: 'turn', dir: 'right', whose: 'your' }]);
  assert.deepEqual(acts('her right'), [{ type: 'turn', dir: 'right', whose: 'your' }], 'also without a question before');
  assert.equal(rules.parseGuide('her').clarifyKind, 'unknown', 'a bare "her" is only an answer');
});

test('Guide: "turn around" / "go back" is ONE action, never two left turns', () => {
  for (const t of ['turn around', 'Turn around.', 'turn round', 'turn back', 'go back', 'Go back, please', 'turn right around', 'Pip, turn around now']) {
    assert.deepEqual(acts(t), [{ type: 'turn', dir: 'around' }], t);
  }
  assert.deepEqual(acts('turn around and go straight'), [{ type: 'turn', dir: 'around' }, { type: 'forward' }]);
  assert.deepEqual(acts('turn around', { expect: 'whose', pendingDir: 'left' }), [{ type: 'turn', dir: 'around' }], 'not an answer to "My left or your left?"');
  assert.deepEqual(acts('go back to the well'), [], 'not understood rather than guessed');
});

test('Guide: one name per landmark - the legend name and the bare noun are both understood', () => {
  for (const id of data.landmarkIds.concat(['exit'])) {
    const name = data.landmarkName(id);
    assert.deepEqual(acts('go straight until the ' + name), [{ type: 'forward', until: id }], name);
    assert.equal(data.landmarkFromWords(name), id);
  }
  assert.equal(data.landmarkName('tree'), 'big tree'); assert.equal(data.landmarkName('fountain'), 'blue fountain'); assert.equal(data.landmarkName('exit'), 'way out');
  for (const [words, id] of [['tree', 'tree'], ['the big tree', 'tree'], ['a tree', 'tree'], ['fountain', 'fountain'], ['the blue fountain', 'fountain'],
    ['exit', 'exit'], ['the way out', 'exit'], ['gate', 'exit']]) {
    assert.deepEqual(acts('walk to ' + words), [{ type: 'forward', until: id }], words);
  }
  /* Pip's own sentences use the same names */
  for (const id of data.landmarkIds) assert.equal(data.landmarkTypes[id].phrase, 'the ' + data.landmarkName(id));
  assert.ok(data.allFactTexts().some((t) => t.includes('the big tree')) && data.allFactTexts().some((t) => t.includes('the blue fountain')));
  assert.ok(data.allWarmupInstructions().includes('Turn left at the big tree.') && data.allWarmupInstructions().includes('Walk to the blue fountain.'));
  assert.equal(data.text.cantSee(data.landmarkName('tree')), 'I can’t see a big tree. What can I see?');
});

test('Guide: nonsense is not understood', () => {
  for (const t of ['', 'banana', 'fly to the moon', 'I like cats', 'go go go banana']) {
    const r = rules.parseGuide(t);
    assert.deepEqual(r.actions, [], t);
    assert.ok(r.clarify && r.clarify.endsWith('?'), t);
  }
});
