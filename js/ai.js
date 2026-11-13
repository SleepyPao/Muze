/* Maze Rescue - the ONE place that talks to a language model (spec section 6). Provider-swappable.
 * Pure at load (fetch is only touched when a call is made). Requires core.js, data.js, rules.js, guide-engine.js.
 *
 * Division of labour:
 *   - The model only CLASSIFIES (Ask) or PARSES (Guide). It never decides right / wrong and never writes a fact.
 *   - Facts shown to the pupil are the canonical strings of the fact table (MR.rules.composeAsk).
 *   - Model-written text (clarifying questions, redirects) must pass ai.validateReply or a canned line is used.
 *   - The offline rules are the floor: single words / fragments never reach the model, and a question the rules
 *     understand with confidence is answered even if the model says "unclear".
 *   - Only the pupil's sentence and the fact table are sent. Never the class number or anything personal.
 */
(function (root) {
  'use strict';
  var MR = root.MR = root.MR || {};
  var ai = MR.ai = {};

  var DEFAULTS = {
    apiKey: '',                              /* direct mode only; lives in config.local.js (git-ignored) */
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    proxyUrl: '',                            /* e.g. '/api/chat' when served by server/proxy.js */
    timeoutMs: 6000,
    temperature: 0.2,
    maxTokens: 400,
    offline: false                           /* true = always use the offline rules ("Demo mode") */
  };
  var failures = 0;          /* consecutive failed model calls */
  var forcedOffline = false; /* set after two consecutive failures */
  ai.MAX_FAILURES = 2;
  /** Master switch. false = the game never calls a language model, whatever config.local.js or the relay says:
   *  every answer comes from the offline rules (js/rules.js), and nothing about AI is shown. Set to true to use
   *  DeepSeek again (config.local.js + server/proxy.js, see README). */
  ai.ENABLED = false;
  /** Tests may replace this with a fake fetch(url, init) -> Promise<{ok, json()}>. */
  ai._fetch = null;

  /** Effective configuration: defaults overlaid with window.MR_CONFIG (set by config.local.js or by the proxy). */
  ai.config = function () {
    var c = {}, user = root.MR_CONFIG || {}, k;
    for (k in DEFAULTS) c[k] = DEFAULTS[k];
    for (k in user) if (k in DEFAULTS && user[k] != null) c[k] = user[k];
    return c;
  };
  /** 'offline' (Demo mode: keyword rules) | 'direct' (browser -> DeepSeek with a local key) | 'proxy' (browser -> server/proxy.js). */
  ai.mode = function () {
    var c = ai.config();
    if (!ai.ENABLED || forcedOffline || c.offline) return 'offline';
    if (c.proxyUrl) return 'proxy';
    if (c.apiKey) return 'direct';
    return 'offline';
  };
  ai.isOffline = function () { return ai.mode() === 'offline'; };
  var lastHttp = null;       /* HTTP status of the last model call (null = none yet, 0 = no answer / network) */
  /** DeepSeek error codes (docs): what the teacher should do. */
  ai.HTTP_HELP = { 0: 'no answer (network, CORS or time-out)', 400: 'bad request format', 401: 'wrong or missing API key', 402: 'no balance left on the DeepSeek account',
    422: 'wrong request parameter (check the model name)', 429: 'too many requests at once', 500: 'DeepSeek server error', 503: 'DeepSeek server busy' };
  ai.status = function () {
    return { mode: ai.mode(), failures: failures, forcedOffline: forcedOffline, lastHttp: lastHttp,
      lastHelp: lastHttp == null || lastHttp === 200 ? '' : (ai.HTTP_HELP[lastHttp] || 'HTTP ' + lastHttp) };
  };
  /** Forget failures and try the model again (teacher action / tests). */
  ai.reset = function () { failures = 0; forcedOffline = false; MR.emit('ai:mode', ai.mode()); };

  /* ------------------------------------------------------------------ prompts */
  ai.ASK_SYSTEM = [
    'You are Pip, a friendly little explorer who is lost in a hedge maze. You are talking to a 10 to 12 year old learner of English (level A2).',
    'The pupil asks you questions about ONE thing that you need. Decide what kind of question it is and reply with one json object and nothing else.',
    'You only classify the question. The game itself gives the fact, and only if that kind of fact is on the pupil\'s card ("card").',
    '',
    'Categories:',
    '- "name": the pupil asks what you need, want or are looking for ("What do you need?", "What is it?").',
    '- "colour": the pupil asks about its colour ("What colour is it?", "Is it red?").',
    '- "size": the pupil asks how big it is ("Is it big or small?", "How big is it?").',
    '- "look": the pupil asks what it looks like in general ("What does it look like?").',
    '- "whose": the pupil asks who it belongs to ("Whose is it?", "Is it yours?").',
    '- "why": the pupil asks why you need it or what it is for ("Why do you need it?", "What is it for?").',
    '- "when": the pupil asks when you lost it ("When did you lose it?").',
    '- "place": the pupil asks where the thing is ("Where is it?").',
    '- "unclear": you cannot tell which of these the pupil means (one word only, a fragment with no verb such as "Where key?" or "Whose key?", or a muddled sentence).',
    '- "off_task": the message is not about the maze or the thing you need.',
    '',
    'Rules:',
    '- Choose ONE category, never two. Never add things, places, people or routes.',
    '- "reply" has at most two short sentences and uses simple words.',
    '- If you can understand the question, classify it even when the grammar is wrong (for example "Where it is?" is "place", "Whose it is?" is "whose", "Why you need it?" is "why", "When you lose it?" is "when"). Never correct the pupil\'s grammar.',
    '- "grammar_note" is a short note for the teacher only, for example "word order: Where is it?". Use "" when the question is correct. The pupil never sees it.',
    '- If you cannot understand, ask ONE short clarifying question. Do not guess.',
    '- Never give a model question and never make a sentence for the pupil to copy.',
    '- If the message is off task, bring the pupil back to the task in ONE sentence.',
    '- For a fact category the reply is the given fact sentence, word for word, or "" when you were not given it. For "unclear" and "off_task" the reply must not mention any fact, thing, colour, person, time or place.',
    '',
    'Output example (json):',
    '{"category": "place", "reply": "It is behind the red door, next to the blue fountain.", "grammar_note": "word order: Where is it?"}'
  ].join('\n');

  ai.GUIDE_SYSTEM = [
    'You turn an English instruction from a pupil into a list of actions for Pip, a little explorer in a hedge maze.',
    'The pupil is 10 to 12 years old and learning English (level A2), so the grammar may be wrong. Reply with one json object and nothing else.',
    '',
    'Allowed actions (there are no others):',
    '- {"type": "forward"} : go straight on',
    '- {"type": "forward", "steps": 3} : go forward that many steps (1 to 20)',
    '- {"type": "forward", "until": "fountain"} : go straight until that landmark. Landmarks: fountain, tree, bridge, red door, green door, door, windmill, scarecrow, well, bench, exit.',
    '- {"type": "turn", "dir": "left"} or {"type": "turn", "dir": "right"}. Add "whose": "your" when the pupil means Pip\'s own side ("your left", "Pip\'s left", "her left", "his left", "their left") and "whose": "my" when the pupil means the pupil\'s side ("my left"). With no such word, leave "whose" out.',
    '- {"type": "turn", "dir": "around"} : turn around / turn back / go back (one half turn). Never use two left or two right turns for this, and never add "whose" to it.',
    '- {"type": "stop"}',
    '',
    'Rules:',
    '- Keep the order of the pupil\'s instructions. "At the tree, turn left" means forward until tree, then turn left.',
    '- Do not decide if a move is possible. The game checks walls and the exit.',
    '- If you are not sure what the pupil means, return "actions": [] and put ONE short clarifying question in "clarify".',
    '- "turn" with no direction: clarify "Left or right?". A landmark that is not in the list: clarify "I can\'t see a <that thing>. What can I see?".',
    '- "pip_just_asked" is the question Pip asked last. If it is "My left or your left?" (or right), the pupil\'s answer is one turn in that direction with "whose".',
    '- Never invent actions, landmarks or routes. Never tell the pupil the way out.',
    '',
    'Output example (json):',
    '{"actions": [{"type": "forward", "until": "fountain"}, {"type": "turn", "dir": "right"}], "clarify": null}'
  ].join('\n');

  /* ------------------------------------------------------------------ validator for model-written text */
  var ALLOWED = ('a about again am an and are ask asking back be but can cannot cant card colour color could did do does done dont ' +
    'far find first for forward full get go going have hello help here hi how i im in is it its just know left let lets like ' +
    'look looks lost many maze me mean mine more must my name need no not now of ok one only or out place please question ' +
    'right say see sentence should size so something sorry step steps stop straight sure talk task tell that the then there ' +
    'thing things think this to too try turn understand until us wall want way we what when where which whose why will with word words yes you your yours')
    .split(' ').reduce(function (m, w) { m[w] = true; return m; }, {});
  /* safety net: no word that could give away a fact of ANY game (all 8 things, colours, sizes, owners, reasons, times,
   * places) is ever allowed (MR.data.factWords) */
  (MR.data.factWords || []).forEach(function (w) { delete ALLOWED[w]; });
  ai.isAllowedWord = function (w) { return !!ALLOWED[String(w).toLowerCase()]; };
  ai.MAX_REPLY_CHARS = 120;

  /**
   * May this model-written line be shown to the pupil? Short, at most two sentences, and built ONLY from a small list
   * of safe words (so it cannot name any item, colour, landmark or place - inside or outside the fact table).
   * @param {string} text
   * @param {'unclear'|'off_task'|'guide'} kind   'unclear' must be a question
   * @param {string} [pupilText]  Guide only: words the pupil typed may be echoed ("I can't see a house.")
   */
  ai.validateReply = function (text, kind, pupilText) {
    if (typeof text !== 'string') return false;
    var t = text.trim();
    if (!t || t.length > ai.MAX_REPLY_CHARS) return false;
    var sentences = t.split(/[.!?]+/).filter(function (s) { return s.trim(); });
    if (sentences.length > 2) return false;
    if (kind === 'unclear' && t.indexOf('?') < 0) return false;
    if (kind === 'off_task' && sentences.length > 1) return false;
    var echo = {};
    if (kind === 'guide' && pupilText) {
      String(pupilText).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).forEach(function (w) { if (w) echo[w] = true; });
    }
    var ws = t.toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
    for (var i = 0; i < ws.length; i++) {
      if (!ALLOWED[ws[i]] && !echo[ws[i]]) return false;
    }
    return true;
  };

  /* ------------------------------------------------------------------ transport */
  /** POST the chat request. Resolves to the parsed JSON object the model wrote, or null on ANY problem
   *  (network, HTTP error, timeout, empty content, invalid JSON). Never rejects. */
  function callModel(system, userObj) {
    var c = ai.config(), mode = ai.mode();
    var f = ai._fetch || root.fetch;
    if (mode === 'offline' || typeof f !== 'function') return Promise.resolve(null);
    var url = mode === 'proxy' ? c.proxyUrl : String(c.baseUrl).replace(/\/+$/, '') + '/chat/completions';
    var headers = { 'Content-Type': 'application/json' };
    if (mode === 'direct') headers.Authorization = 'Bearer ' + c.apiKey;
    var body = JSON.stringify({
      model: c.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(userObj) }],
      response_format: { type: 'json_object' },
      temperature: c.temperature,
      max_tokens: c.maxTokens,
      /* DeepSeek docs: deepseek-flash THINKS by default (slow, and temperature is ignored while thinking).
       * Pip only classifies / parses, so thinking is switched off: fast answers inside the 6 s limit. */
      thinking: { type: 'disabled' },
      stream: false
    });
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    var timeout = new Promise(function (res) {
      timer = setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) { /* ignore */ } } res(null); }, c.timeoutMs);
    });
    var request;
    try {
      request = Promise.resolve(f.call(root, url, { method: 'POST', headers: headers, body: body, signal: ctrl ? ctrl.signal : undefined }))
        .then(function (resp) { lastHttp = resp ? (resp.status || 0) : 0; return resp && resp.ok ? resp.json() : null; })
        .then(function (json) {
          var content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
          if (typeof content !== 'string' || !content.trim()) return null;
          var obj = JSON.parse(content);
          return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
        })
        .catch(function () { return null; });
    } catch (e) { request = Promise.resolve(null); }
    return Promise.race([request, timeout]).then(function (v) { clearTimeout(timer); return v; });
  }
  function ok() { failures = 0; }
  /** Count a failure. Returns true if this one switched the game to the offline rules. */
  function fail() {
    failures++;
    if (failures >= ai.MAX_FAILURES && !forcedOffline) { forcedOffline = true; MR.emit('ai:mode', 'offline'); return true; }
    return forcedOffline;
  }
  function failedResult(extra) {
    var r = { failed: true, reply: MR.data.text.sayAgain, source: 'ai' };
    for (var k in extra) r[k] = extra[k];
    return r;
  }

  /* ------------------------------------------------------------------ Ask */
  /** The only categories the model may answer with: the seven kinds of fact, "look" (colour or size) and the two non-facts. */
  ai.ASK_CATEGORIES = MR.data.FACTS.concat(['look', 'unclear', 'off_task']);
  /**
   * @param {{item:object|string, given?:string[], text:string}} req   item = entry of MR.data.items (or its id);
   *        given = facts already unlocked for this item; text = what the pupil sent
   * @returns {Promise<{category:(one of MR.data.FACTS|'unclear'|'off_task'|null), reply:string, grammar_note:string,
   *        fact_given:(one of MR.data.FACTS|null), clarification:boolean, off_card:boolean, failed:boolean,
   *        source:('rules'|'ai'|'ai+rules')}>}
   *   Only the three kinds of fact on the thing's card (MR.data.slotsOf) are ever given; a clear question about
   *   another kind gets "I can't tell you that. Look at your card." (off_card:true, no fact).
   *   The model may also say "look" ("What does it look like?"): composeAsk turns it into colour or size.
   *   failed:true  => show reply ("Sorry, can you say that again?"), do NOT count it against the pupil.
   *   Never rejects.
   */
  ai.ask = function (req) {
    var item = typeof req.item === 'string' ? MR.data.getItem(req.item) : req.item;
    var text = String(req.text == null ? '' : req.text).slice(0, 300);
    var cls = MR.rules.classifyAsk(text);
    function viaRules() {
      var r = MR.rules.composeAsk(item, cls, null, req.given); r.failed = false; r.source = 'rules'; return r;
    }
    if (ai.isOffline() || cls.fragment) return Promise.resolve(viaRules());

    /* the closed fact table of this thing: only the three kinds on its card */
    var card = MR.data.slotsOf(item), facts = {};
    card.forEach(function (f) { facts[f] = MR.data.factText(item.id, f); });
    return callModel(ai.ASK_SYSTEM, { card: card, facts: facts, already_given: req.given || [], pupil_sentence: text }).then(function (obj) {
      var cats = ai.ASK_CATEGORIES;
      if (!obj || cats.indexOf(obj.category) < 0) {
        if (fail()) return viaRules();                       /* second failure in a row: offline rules take over */
        return failedResult({ category: null, grammar_note: '', fact_given: null, clarification: false });
      }
      ok();
      var category = obj.category, source = 'ai';
      var isFact = MR.rules.isFactCategory;
      if (!isFact(category) && isFact(cls.category) && cls.confident) { category = cls.category; source = 'ai+rules'; }
      /* "What does it look like?" is colour or size, whichever is on the card: the rules know this form for sure */
      else if (cls.category === 'look' && cls.confident && (category === 'colour' || category === 'size')) { category = 'look'; source = 'ai+rules'; }
      var note = typeof obj.grammar_note === 'string' ? obj.grammar_note.trim().slice(0, 120) : '';
      var modelText = !isFact(category) && ai.validateReply(obj.reply, category) ? obj.reply.trim() : null;
      var r = MR.rules.composeAsk(item, { category: category, clarify: cls.clarify, grammar_note: note || cls.grammar_note }, modelText, req.given);
      r.failed = false; r.source = source;
      return r;
    });
  };

  /* ------------------------------------------------------------------ Guide */
  /**
   * @param {{text:string, run?:{x:number,y:number,facing:string}, visible?:string[], ctx?:{expect?:('dir'|'whose'), pendingDir?:('left'|'right')}}} req
   * @returns {Promise<{actions:Array, clarify:(string|null), clarifyKind:(null|'dir'|'landmark'|'oneword'|'unknown'),
   *        failed:boolean, reply?:string, source:('rules'|'ai')}>}
   *   actions non-empty => pass them to MR.guide.execute. actions empty => Pip says `clarify` (or `reply` when failed).
   *   The rules parser goes first; the model is only asked when the rules do not understand at all. Never rejects.
   */
  ai.guide = function (req) {
    var text = String(req.text == null ? '' : req.text).slice(0, 300);
    var r = MR.rules.parseGuide(text, req.ctx || {});
    function viaRules() { return { actions: r.actions, clarify: r.clarify, clarifyKind: r.clarifyKind, failed: false, source: 'rules' }; }
    if (r.actions.length || r.clarifyKind !== 'unknown' || ai.isOffline()) return Promise.resolve(viaRules());

    var user = { instruction: text, landmarks_in_view: req.visible || [] };
    if (req.run) user.pip = { x: req.run.x, y: req.run.y, facing: req.run.facing };
    /* the question Pip really asked: "My right or your right?" when the turn in question was a right turn */
    if (req.ctx && req.ctx.expect) {
      user.pip_just_asked = req.ctx.expect === 'whose'
        ? MR.data.text.whose(req.ctx.pendingDir === 'right' ? 'right' : 'left') : MR.data.text.leftOrRight;
    }
    return callModel(ai.GUIDE_SYSTEM, user).then(function (obj) {
      if (!obj) {
        if (fail()) return viaRules();
        return failedResult({ actions: [], clarify: null, clarifyKind: null });
      }
      ok();
      var out = MR.guide.validateOutput(obj);
      if (!out) return { actions: [], clarify: MR.data.text.guideUnclear, clarifyKind: 'unknown', failed: false, source: 'ai' };
      if (out.actions.length) return { actions: out.actions, clarify: null, clarifyKind: null, failed: false, source: 'ai' };
      var q = ai.validateReply(out.clarify, 'guide', text) ? out.clarify : MR.data.text.guideUnclear;
      var kind = /left or right/i.test(q) ? 'dir' : (/can.?t see/i.test(q) ? 'landmark' : 'unknown');
      return { actions: [], clarify: q, clarifyKind: kind, failed: false, source: 'ai' };
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
