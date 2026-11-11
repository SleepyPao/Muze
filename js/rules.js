/* Maze Rescue - offline keyword rules (spec section 8) for the Ask classifier and the Guide parser.
 * Pure. Requires core.js, maze.js, data.js. Used directly in Demo mode and as the floor under the AI. */
(function (root) {
  'use strict';
  var MR = root.MR = root.MR || {};
  var rules = MR.rules = {};

  function norm(text) {
    return String(text == null ? '' : text).toLowerCase()
      .replace(/[‘’]/g, '\'')
      .replace(/\b(where|what|how|it|that|there|who)'s\b/g, '$1 is')
      .replace(/\bwhats\b/g, 'what is').replace(/\bwheres\b/g, 'where is')
      .replace(/\bdon't\b/g, 'do not').replace(/\bcan't\b/g, 'can not')
      .replace(/\bi'm\b/g, 'i am').replace(/\blet's\b/g, 'let us');
  }
  function words(t) { return t.replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean); }
  function has(tokens, list) { for (var i = 0; i < list.length; i++) if (tokens.indexOf(list[i]) >= 0) return true; return false; }

  /* ================================================================== ASK */
  var VERBS = ['is', 'are', 'am', 'was', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'has', 'have',
    'need', 'needs', 'want', 'wants', 'look', 'looks', 'find', 'tell', 'show', 'put', 'see', 'get', 'lost', 'lose', 'looking'];
  var OFF_TASK = /\b(your name|how old|you live|your (house|home|school|mum|dad|family|friend|teacher)|do you like|favou?rite|football|basketball|homework|weather|joke|sing|dance|play|game|games|tv|pizza|food|eat|who are you|how are you|hello|hi|hey|bye|goodbye|good (morning|afternoon)|i love you|robot|stupid|silly|poo)\b/;
  /* words that show the sentence is about the task: every thing Pip may need in any game (the whole pool) */
  var TASK_HINT = new RegExp('\\b(it|need|want|thing|looking for|' + MR.data.POOL.map(function (p) { return p.noun; }).join('|') + ')\\b');

  /**
   * Classify one pupil sentence in the Ask stage.
   * @returns {{category:'name'|'look'|'place'|'unclear'|'off_task', clarify:('name'|'look'|'place'|'generic'|null),
   *            grammar_note:string, fragment:boolean, confident:boolean}}
   *   fragment  = a single word or a verb-less fragment (must be answered with a clarifying question, never a fact)
   *   confident = the rules are sure enough that ai.js lets this result override the model
   */
  rules.classifyAsk = function (text) {
    var t = norm(text), w = words(t), n = w.length;
    function out(category, clarify, note, fragment, confident) {
      return { category: category, clarify: clarify || null, grammar_note: note || '', fragment: !!fragment, confident: !!confident };
    }
    if (n === 0) return out('unclear', 'generic', '', true, true);

    var isWhere = has(w, ['where', 'place']);
    var isLook = has(w, ['look', 'looks', 'colour', 'color', 'colours', 'colors', 'big', 'small', 'size', 'shape']) && !/\blook(ing)? for\b/.test(t);
    var isWhat = has(w, ['what', 'which']);
    var isName = (isWhat && (has(w, ['need', 'needs', 'want', 'wants', 'thing', 'things', 'find', 'lost', 'missing']) || /\blook(ing)? for\b/.test(t))) ||
      /^what is it\b/.test(t) || /^what is (that|this)\b/.test(t) ||
      (has(w, ['you']) && has(w, ['need', 'want']) && !isWhere && !isLook);

    /* one word, e.g. "Where" -> clarifying question, never a fact */
    if (n === 1) {
      if (isWhere) return out('unclear', 'place', 'single word', true, true);
      if (isLook) return out('unclear', 'look', 'single word', true, true);
      if (w[0] === 'what' || w[0] === 'which' || w[0] === 'need' || w[0] === 'want') return out('unclear', 'name', 'single word', true, true);
      if (OFF_TASK.test(t)) return out('off_task', null, '', false, true);
      return out('unclear', 'generic', 'single word', true, true);
    }

    var offTask = OFF_TASK.test(t);
    if (offTask && !(TASK_HINT.test(t) && (isWhere || isLook || isName))) return out('off_task', null, '', false, false);
    if (offTask && /\b(you live|your (house|home|school|name))\b/.test(t)) return out('off_task', null, '', false, false);

    var hasVerb = has(w, VERBS);
    var category = isWhere ? 'place' : (isLook ? 'look' : (isName ? 'name' : null));
    if (!category) return out('unclear', 'generic', '', false, false);

    /* fragment such as "Where key?", "What colour?", "Where the key?" -> clarify, give no fact */
    if (!hasVerb || n < 3) return out('unclear', category, 'fragment: no verb', true, true);

    return out(category, null, grammarNote(t, category), false, true);
  };

  function grammarNote(t, category) {
    if (category === 'place') {
      if (/\bwhere (it|the \w+|my \w+) is\b/.test(t) && !/\b(tell|know|show|say)\b/.test(t)) return 'word order: Where is it?';
      if (/\bwhere is\s*$/.test(t.replace(/[^a-z ]/g, ''))) return 'missing subject: Where is it?';
      if (/\bwhere (are|was) (it|the)\b/.test(t)) return 'verb form: Where is it?';
      if (/\bwhere (i|you|we) (can )?find\b/.test(t)) return 'word order: Where can I find it?';
    }
    if (category === 'look') {
      if (/\bwhat (it|the \w+) looks? like\b/.test(t)) return 'missing "does": What does it look like?';
      if (/\bwhat does it looks\b/.test(t)) return 'verb form: What does it look like?';
      if (/\bhow does it looks? like\b/.test(t)) return 'question word: What does it look like?';
      if (/\bwhat colou?r (it|the \w+) is\b/.test(t)) return 'word order: What colour is it?';
      if (/\bit is (big|small)\b/.test(t)) return 'word order: Is it big?';
    }
    if (category === 'name') {
      if (/\b(what|which thing) you (need|want)\b/.test(t)) return 'missing "do": What do you need?';
      if (/\bwhat (do|does) you needs?\b/.test(t) && /\b(does you|needs)\b/.test(t)) return 'verb form: What do you need?';
      if (/\bwhat it is\b/.test(t)) return 'word order: What is it?';
      if (/\bwhat are you (need|want)\b/.test(t)) return 'verb form: What do you need?';
    }
    return '';
  }
  rules.grammarNote = grammarNote;

  /**
   * Turn a classification into the final Ask result. Facts are ALWAYS the canonical strings from the fact table.
   * @param {object} item     an entry of MR.data.items
   * @param {object} cls      {category, clarify?, grammar_note?}
   * @param {string} [text]   model-written text for unclear / off_task (already validated by the caller)
   * @returns {{category, reply, grammar_note, fact_given:(string|null), clarification:boolean}}
   */
  rules.composeAsk = function (item, cls, text) {
    var T = MR.data.text, c = cls.category, reply, fact = null;
    if (c === 'name' || c === 'look' || c === 'place') { reply = MR.data.factText(item.id, c); fact = c; }
    else if (c === 'off_task') reply = text || T.redirect;
    else { c = 'unclear'; reply = text || T.clarify[cls.clarify || 'generic'] || T.clarify.generic; }
    return { category: c, reply: reply, grammar_note: cls.grammar_note || '', fact_given: fact, clarification: c === 'unclear' };
  };
  /** Offline answer in one call: classifyAsk + composeAsk. */
  rules.answerAsk = function (item, text) { return rules.composeAsk(item, rules.classifyAsk(text)); };

  /* ================================================================== GUIDE */
  var NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  var MAX_STEPS = 20;
  function toNum(s) {
    if (s == null) return null;
    var n = /^\d+$/.test(s) ? parseInt(s, 10) : NUM[s];
    return n >= 1 && n <= MAX_STEPS ? n : null;
  }
  var SEE = '(?:you (?:can )?(?:see|get to|reach|are at|come to|find) )?';
  var RE = {
    stop: /^(?:stop|wait|halt|stay)(?: here| there)?$/,
    /* "turn around", "turn back", "go back", "turn right around" ...: ONE half turn, never a left / right question */
    turnAround: /^(?:(?:turn|go|walk|look)(?: right| all the way)? (?:around|round|back|backwards?)|about turn)$/,
    /* whose left: "your / Pip's / her / his / their left" = Pip's own side; "my left" = the pupil's side */
    turn: /^(turn|go|walk|move|take a|take the)?\s*(?:to )?(?:the )?(?:(your|my|pip's|pips|pip|his|her|their) )?(left|right)(?: (?:side|hand|turn))?$/,
    whoseOnly: /^(?:(your|my|pip's|pips|pip|his|her|their) (left|right)|(yours|mine|your|my|you|me|pip's|pips|pip|his|hers|her|theirs|their))$/,
    bareTurn: /^(?:turn|turning)$/,
    atFirst: new RegExp('^(?:at|when|after|by|near)\\s+' + SEE + '(?:the |a |an )?([a-z ]+?) (turn(?: .*)?|go(?: .*)?|walk(?: .*)?|stop|left|right)$'),
    atLast: new RegExp('^(turn(?: [a-z\' ]+?)?|stop) (?:at|when|after|by|near)\\s+' + SEE + '(?:the |a |an )?([a-z ]+)$'),
    forward: new RegExp(
      '^(go|walk|move|run|come|keep going|keep walking|continue|carry on)?\\s*' +
      '(straight on|straight ahead|straight|forwards|forward|ahead|on|up|along)?\\s*' +
      '(?:for )?(?:(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) (?:more )?(?:steps?|blocks?|squares?|tiles?|times?)|(\\d+))?\\s*' +
      '(straight on|straight ahead|straight|forwards|forward|ahead)?\\s*' +
      '(?:(?:until|till|to|up to|as far as|towards?)\\s+' + SEE + '(?:the |a |an )?([a-z ]+))?$')
  };

  function clar(kind, text, extra) {
    var r = { actions: [], clarify: text, clarifyKind: kind };
    if (extra) for (var k in extra) r[k] = extra[k];
    return r;
  }
  function stripFillers(c) {
    var prev;
    do {
      prev = c;
      c = c.replace(/^(?:please|pip|ok|okay|now|first|next|so|after that|you (?:can|should|must|need to|have to)|can you|could you|i want you to|you|just|hey)\s+/, '')
        .replace(/\s+(?:please|pip|now|again|ok|okay)$/, '').trim();
    } while (c !== prev);
    if (/^(?:please|pip|ok|okay|now|first|next|so|hey|and|then)$/.test(c)) return '';
    return c;
  }
  /** 'my' = the pupil's own side; everything else ("your", "Pip's", "her", "his", "their") = Pip's side ('your'). */
  function whoseOf(w) {
    if (!w) return undefined;
    return (w === 'my' || w === 'mine' || w === 'me') ? 'my' : 'your';
  }
  function landmark(phrase) {
    phrase = phrase.replace(/\b(you see|i see)\b/g, '').replace(/\s+/g, ' ').trim();
    var type = MR.data.landmarkFromWords(phrase);
    return { type: type, phrase: phrase };
  }

  /** Parse one clause. Returns {actions:[...]} or {clarify, clarifyKind, ...}. */
  function parseClause(c, ctx) {
    var m, lm;
    if (RE.stop.test(c)) return { actions: [{ type: 'stop' }] };
    if (RE.bareTurn.test(c)) return clar('dir', MR.data.text.leftOrRight);
    if (RE.turnAround.test(c)) return { actions: [{ type: 'turn', dir: 'around' }] };

    /* answers to "My left or your left?": "your left", "mine", ... */
    if ((m = RE.whoseOnly.exec(c))) {
      var dir = m[2] || ctx.pendingDir;
      if (dir && (m[1] || ctx.expect === 'whose')) {
        return { actions: [{ type: 'turn', dir: dir, whose: whoseOf(m[1] || m[3]) }] };
      }
    }
    if ((m = RE.turn.exec(c))) {
      var verb = m[1], whose = whoseOf(m[2]);
      var turn = { type: 'turn', dir: m[3] };
      if (whose) turn.whose = whose;
      if (verb === 'turn' || (verb && /^take/.test(verb))) return { actions: [turn] };
      if (verb) return { actions: [turn, { type: 'forward' }] };            /* "go left" = turn left, then go straight */
      if (ctx.expect === 'dir' || ctx.expect === 'whose' || whose) {        /* bare "left" answering "Left or right?" */
        if (ctx.expect === 'whose' && !whose) turn.whose = 'your';
        return { actions: [turn] };
      }
      return clar('oneword', MR.data.text.guideOneWord(m[3]));
    }
    if ((m = RE.atFirst.exec(c)) || (m = RE.atLast.exec(c))) {
      var isFirst = RE.atFirst.test(c);
      var phrase = isFirst ? m[1] : m[2], rest = isFirst ? m[2] : m[1];
      lm = landmark(phrase);
      if (!lm.type) return clar('landmark', MR.data.text.cantSee(lm.phrase), { landmark: lm.phrase });
      var sub = parseClause(stripFillers(rest), ctx.expect ? ctx : { expect: 'dir' });
      if (!sub.actions || !sub.actions.length) return sub;
      return { actions: [{ type: 'forward', until: lm.type }].concat(sub.actions) };
    }
    if ((m = RE.forward.exec(c)) && (m[1] || m[2] || m[3] || m[5])) {
      var act = { type: 'forward' };
      if (m[3] || m[4]) {
        var n = toNum(m[3] || m[4]);
        if (!n) return clar('unknown', MR.data.text.guideUnclear);
        act.steps = n;
      }
      if (m[6]) {
        lm = landmark(m[6]);
        if (!lm.type) {
          if (lm.phrase.split(' ').length > 3) return clar('unknown', MR.data.text.guideUnclear);
          return clar('landmark', MR.data.text.cantSee(lm.phrase), { landmark: lm.phrase });
        }
        act.until = lm.type; delete act.steps;
      }
      return { actions: [act] };
    }
    return clar('unknown', MR.data.text.guideUnclear);
  }

  /**
   * Parse a Guide instruction (one or several, chained with then / and / commas / full stops).
   * @param {string} text
   * @param {{expect?:('dir'|'whose'|null), pendingDir?:('left'|'right')}} [ctx]  what Pip just asked, if anything
   * @returns {{actions:Array, clarify:(string|null), clarifyKind:(null|'dir'|'landmark'|'oneword'|'unknown'), landmark?:string}}
   *   actions: [{type:'forward', steps?:n, until?:landmarkType} | {type:'turn', dir:'left'|'right', whose?:'your'|'my'} |
   *             {type:'turn', dir:'around'} | {type:'stop'}]      ("turn around" is ONE action and never has `whose`)
   *   If any clause is not understood, actions is [] and clarify holds ONE question.
   */
  rules.parseGuide = function (text, ctx) {
    ctx = ctx || {};
    var t = norm(text).replace(/[^a-z0-9', .;!?]/g, ' ').replace(/[.;!?]+/g, ',').replace(/\s+/g, ' ').trim();
    t = t.replace(/^[, ]+|[, ]+$/g, '');
    if (!t) return clar('unknown', MR.data.text.guideUnclear);
    /* keep "at the tree, turn left" together */
    t = t.replace(/\b((?:at|when|after|by|near) [a-z ]+?)\s*,\s*(?=(?:then |please |you )*(?:turn|go|walk|stop|left|right)\b)/g, '$1 ');
    var clauses = t.split(/\s*(?:,|\band then\b|\bthen\b|\band\b|\bafter that\b)\s*/).map(stripFillers).filter(Boolean);
    if (!clauses.length) return clar('unknown', MR.data.text.guideUnclear);
    var actions = [];
    for (var i = 0; i < clauses.length; i++) {
      var r = parseClause(clauses[i], i === 0 ? ctx : {});
      if (!r.actions || !r.actions.length) return r;
      actions = actions.concat(r.actions);
    }
    if (actions.length > 12) return clar('unknown', MR.data.text.guideUnclear);
    return { actions: actions, clarify: null, clarifyKind: null };
  };
})(typeof window !== 'undefined' ? window : globalThis);
