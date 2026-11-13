/* Maze Rescue - session state for ONE pupil (single player), persisted per class number.
 * Pure (uses MR.storage, no DOM). Requires core.js, data.js.
 * Several pupils may use one device one after another: each class number has its own saved session.
 * Every new game gets a random `seed` (saved in the session). The seed decides the game's content (things, maps,
 * warm-up, maze variants): whenever the current pupil changes, MR.data.useSession(seed) switches the content, so a
 * resumed game always gets back exactly the same content. A session saved before seeds existed has no seed and
 * plays the classic content (MR.data.useSession(null)). */
(function (root) {
  'use strict';
  var MR = root.MR = root.MR || {};
  var KEY_SESSIONS = 'mr.sessions.v1';   /* { [class_no]: sessionData } */
  var KEY_CURRENT = 'mr.current.v1';     /* class_no of the pupil now playing, or null */
  var KEY_PREFS = 'mr.prefs.v1';         /* device preferences: { muted } */

  var state = MR.state = {};
  var cur = null;                        /* the live session object (see blank()) */

  function blank(classNo, difficulty, seed) {
    var items = {};
    MR.data.items.forEach(function (it) {
      /* one entry per kind of fact on this thing's card (MR.data.slotsOf: 'place' + two others) */
      var facts = {}, assisted = {}, hintLevel = {};
      MR.data.slotsOf(it).forEach(function (f) { facts[f] = false; assisted[f] = false; hintLevel[f] = 0; });
      items[it.id] = {
        facts: facts,
        assisted: assisted,
        hintLevel: hintLevel,
        junctions: it.junctions.map(function () { return { first_choice: null, first_choice_correct: null, attempts: 0, done: false }; }),
        collected: false
      };
    });
    var routes = {};
    MR.data.routeIds.forEach(function (r) { routes[r] = { reached: false, instructions: 0, trail: [] }; });
    return {
      v: 2,
      session_id: MR.util.uid('s'),
      seed: seed == null ? null : seed,           /* decides this game's content (MR.data.useSession) */
      class_no: classNo || '',
      difficulty: difficulty === 'simple' ? 'simple' : 'standard',
      storySeen: false,
      warmup: { done: false, correct: 0, total: 0 },
      itemIndex: 0,                      /* 0..3 = item in progress, 4 = all four collected */
      items: items,
      inventory: [],                     /* item ids in pick-up order */
      stars: 0,
      breakSeen: false,                  /* the "end of lesson 1" screen was shown */
      guide: { routeIndex: 0, routes: routes },   /* routeIndex = the route in progress; routeIds.length = all done */
      review: { done: false, self: {} },
      startedAt: MR.util.nowISO(), updatedAt: MR.util.nowISO()
    };
  }
  function sessions() { return MR.storage.get(KEY_SESSIONS) || {}; }
  /** A game saved when every card was name / look / place: give each thing the kinds its card has now.
   *  A thing already found keeps all its facts; an old 'look' counts for colour and size. */
  function migrate() {
    if (!cur || !cur.items) return;
    /* a game saved before a route was added (e.g. r4, back to the station) gets that route, not finished yet */
    if (cur.guide && cur.guide.routes) {
      MR.data.routeIds.forEach(function (r) { if (!cur.guide.routes[r]) cur.guide.routes[r] = { reached: false, instructions: 0, trail: [] }; });
      while (cur.guide.routeIndex > 0 && !cur.guide.routes[MR.data.routeIds[cur.guide.routeIndex - 1]].reached) cur.guide.routeIndex--;
    }
    MR.data.items.forEach(function (it) {
      var st = cur.items[it.id]; if (!st) return;
      st.facts = st.facts || {}; st.assisted = st.assisted || {}; st.hintLevel = st.hintLevel || {};
      MR.data.slotsOf(it).forEach(function (f) {
        var look = f === 'colour' || f === 'size';
        if (!(f in st.facts)) st.facts[f] = !!st.collected || (look && !!st.facts.look);
        if (!(f in st.assisted)) st.assisted[f] = look && !!st.assisted.look;
        if (!(f in st.hintLevel)) st.hintLevel[f] = 0;
      });
    });
  }
  /** Switch MR.data to the content of the live session (classic content when there is none / no seed). */
  function useContent() { MR.data.useSession(cur && cur.seed != null ? cur.seed : null, cur ? cur.difficulty : null); migrate(); }
  function toSeed(v) {
    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return null;
    return Number(v) >>> 0;
  }
  function changed() { state.save(); MR.emit('state:change', cur); }
  function itemState(itemId) {
    if (!cur) return null;
    var it = MR.data.getItem(itemId);
    return it ? cur.items[it.id] : null;
  }

  /** Load the current pupil's session (if any) from storage. Call once at boot. @returns session or null */
  state.init = function () {
    var classNo = MR.storage.get(KEY_CURRENT);
    cur = classNo ? (sessions()[classNo] || null) : null;
    useContent();
    return cur;
  };
  /** The live session object, or null before Start. Treat as READ-ONLY outside state.js; use the methods below. */
  state.get = function () { return cur; };
  state.classNo = function () { return cur ? cur.class_no : ''; };
  state.hasSaved = function (classNo) { return !!sessions()[MR.util.normClassNo(classNo)]; };

  /** Start or resume the session of this class number.
   *  A new game gets a new random seed (or opts.seed) and logs one 'session' record with the seed and its four things.
   *  @param {{fresh?:boolean, seed?:number}} [opts]  fresh:true discards a saved session for this class number;
   *         seed: use this seed for a NEW game (debug links ?seed=123, tests)
   *  @returns {{resumed:boolean, session:object}} */
  state.begin = function (classNo, difficulty, opts) {
    opts = opts || {};
    classNo = MR.util.normClassNo(classNo);
    var all = sessions(), saved = all[classNo];
    var resumed = !!saved && !opts.fresh;
    if (resumed) {
      cur = saved;
      useContent();
    } else {
      var seed = toSeed(opts.seed);
      if (seed == null) seed = MR.data.newSeed();
      cur = null;
      MR.data.useSession(seed, difficulty);
      cur = blank(classNo, difficulty, seed);
    }
    if (resumed && difficulty && !cur.guide.routes.r1.instructions && !cur.guide.routes.r2.instructions) {
      cur.difficulty = difficulty === 'simple' ? 'simple' : 'standard';
    }
    MR.storage.set(KEY_CURRENT, classNo);
    changed();
    if (!resumed && MR.log && MR.log.event) {
      MR.log.event('start', 'session', { seed: cur.seed, difficulty: cur.difficulty, items: MR.data.sessionFacts() });
    }
    return { resumed: resumed, session: cur };
  };
  /** Seed of the live game (null before Start, or for a game saved before seeds existed). */
  state.sessionSeed = function () { return cur && cur.seed != null ? cur.seed : null; };
  state.save = function () {
    if (!cur) return;
    cur.updatedAt = MR.util.nowISO();
    var all = sessions(); all[cur.class_no] = cur;
    MR.storage.set(KEY_SESSIONS, all);
  };
  /** Leave the current pupil (their session stays saved) so the next pupil can type a class number. */
  state.signOut = function () { cur = null; MR.storage.remove(KEY_CURRENT); useContent(); MR.emit('state:change', null); };
  /** Delete the saved session of one class number (default: the current one). Logs are NOT touched. */
  state.reset = function (classNo) {
    classNo = classNo ? MR.util.normClassNo(classNo) : (cur && cur.class_no);
    var all = sessions(); delete all[classNo]; MR.storage.set(KEY_SESSIONS, all);
    if (cur && cur.class_no === classNo) { cur = null; MR.storage.remove(KEY_CURRENT); useContent(); }
    MR.emit('state:change', cur);
  };
  /** Delete every saved session on this device (teacher action). */
  state.resetAll = function () { MR.storage.remove(KEY_SESSIONS); MR.storage.remove(KEY_CURRENT); cur = null; useContent(); MR.emit('state:change', null); };

  state.setDifficulty = function (d) { if (cur) { cur.difficulty = d === 'simple' ? 'simple' : 'standard'; changed(); } };
  state.markStorySeen = function () { if (cur) { cur.storySeen = true; changed(); } };

  /* ---------- warm-up ---------- */
  state.finishWarmup = function (correct, total) {
    if (!cur) return;
    cur.warmup = { done: true, correct: correct | 0, total: total | 0 };
    changed();
  };

  /* ---------- Ask ---------- */
  /** The item in progress (entry of MR.data.items) or null when all four are collected. */
  state.currentItem = function () { return cur ? (MR.data.items[cur.itemIndex] || null) : null; };
  state.itemState = itemState;
  /** Record that the pupil used hint `level` (1|2) for `fact`. Level 2 marks the fact as assisted when it is unlocked later. */
  state.useHint = function (itemId, fact, level) {
    var s = itemState(itemId); if (!s || MR.data.slotsOf(itemId).indexOf(fact) < 0) return 0;
    s.hintLevel[fact] = s.hintLevel[fact] || 0;
    s.hintLevel[fact] = Math.max(s.hintLevel[fact], level);
    changed();
    return s.hintLevel[fact];
  };
  /** The fact the next hint should be about: the first locked slot of the thing's card (null if none). */
  state.nextHintFact = function (itemId) {
    var s = itemState(itemId); if (!s) return null;
    var slots = MR.data.slotsOf(itemId);
    for (var i = 0; i < slots.length; i++) if (!s.facts[slots[i]]) return slots[i];
    return null;
  };
  /** The kinds of fact already unlocked for a thing, in card order. */
  state.givenFacts = function (itemId) {
    var s = itemState(itemId);
    return s ? MR.data.slotsOf(itemId).filter(function (f) { return !!s.facts[f]; }) : [];
  };
  /** Unlock one fact (only a kind that is on the thing's card can be unlocked). @returns {{isNew:boolean, assisted:boolean, hint_level:number, allUnlocked:boolean}} */
  state.unlockFact = function (itemId, fact) {
    var s = itemState(itemId);
    if (!s || MR.data.slotsOf(itemId).indexOf(fact) < 0) return { isNew: false, assisted: false, hint_level: 0, allUnlocked: false };
    var isNew = !s.facts[fact];
    if (isNew) { s.facts[fact] = true; s.assisted[fact] = s.hintLevel[fact] >= 2; changed(); }
    return { isNew: isNew, assisted: s.assisted[fact], hint_level: s.hintLevel[fact], allUnlocked: state.allFactsUnlocked(itemId) };
  };
  state.allFactsUnlocked = function (itemId) {
    var s = itemState(itemId);
    var slots = MR.data.slotsOf(itemId);
    return !!s && slots.length > 0 && slots.every(function (f) { return !!s.facts[f]; });
  };

  /* ---------- Go ---------- */
  /** Record a click at a junction. Only the FIRST choice sets first_choice / first_choice_correct.
   *  @returns {{first:boolean, first_choice_correct:boolean, attempts:number}} */
  state.recordJunction = function (itemId, jIndex, choice, correct) {
    var s = itemState(itemId), j = s && s.junctions[jIndex];
    if (!j) return { first: false, first_choice_correct: false, attempts: 0 };
    var first = j.attempts === 0;
    j.attempts++;
    if (first) { j.first_choice = choice; j.first_choice_correct = !!correct; }
    if (correct) j.done = true;
    changed();
    return { first: first, first_choice_correct: !!j.first_choice_correct, attempts: j.attempts };
  };
  /** Item picked up: one star, into the inventory, and on to the next item. Refuses unless Go is unlocked. */
  state.collectItem = function (itemId) {
    var s = itemState(itemId), it = MR.data.getItem(itemId);
    if (!s || s.collected || !state.allFactsUnlocked(itemId)) return false;
    s.collected = true;
    cur.inventory.push(it.id);
    cur.stars++;
    while (cur.itemIndex < MR.data.items.length && cur.items[MR.data.items[cur.itemIndex].id].collected) cur.itemIndex++;
    changed();
    return true;
  };
  state.allItemsCollected = function () { return !!cur && cur.itemIndex >= MR.data.items.length; };
  state.markBreakSeen = function () { if (cur) { cur.breakSeen = true; changed(); } };

  /* ---------- Guide ---------- */
  state.currentRouteId = function () { return cur ? (MR.data.routeIds[cur.guide.routeIndex] || null) : null; };
  /** Save progress inside a route (so a reload can redraw the trail). */
  state.saveRouteProgress = function (routeId, run) {
    var r = cur && cur.guide.routes[routeId]; if (!r) return;
    r.instructions = run.instructions; r.trail = run.trail.slice();
    changed();
  };
  /** Exit reached on this route: one star, on to the next route. */
  state.finishRoute = function (routeId, run) {
    var r = cur && cur.guide.routes[routeId]; if (!r || r.reached) return false;
    r.reached = true;
    if (run) { r.instructions = run.instructions; r.trail = run.trail.slice(); }
    cur.stars++;
    while (cur.guide.routeIndex < MR.data.routeIds.length && cur.guide.routes[MR.data.routeIds[cur.guide.routeIndex]].reached) cur.guide.routeIndex++;
    changed();
    return true;
  };
  state.allRoutesDone = function () { return !!cur && cur.guide.routeIndex >= MR.data.routeIds.length; };
  /** The train clock of a timed route (r4): {left: seconds, tries: missed trains} or null before it started. */
  state.trainClock = function (routeId) {
    var r = cur && cur.guide.routes[routeId];
    return r && r.clock ? { left: r.clock.left, tries: r.clock.tries } : null;
  };
  /** Save the train clock. `quiet` = no 'state:change' event (the clock is saved every few seconds). */
  state.setTrainClock = function (routeId, left, tries, quiet) {
    var r = cur && cur.guide.routes[routeId]; if (!r) return;
    r.clock = { left: Math.max(0, Math.round(left * 10) / 10), tries: tries | 0 };
    if (quiet) state.save(); else changed();
  };

  /* ---------- Review ---------- */
  state.finishReview = function (self) { if (cur) { cur.review = { done: true, self: self || {} }; changed(); } };

  /* ---------- flow ---------- */
  /** Where the pupil should be now. The router calls this for MR.next() and for resume.
   *  @returns {{screen:string, params:object}} */
  state.nextScreen = function () {
    if (!cur || !cur.class_no) return { screen: 'start', params: {} };
    if (!cur.warmup.done) return { screen: 'warmup', params: {} };
    if (!state.allItemsCollected()) {
      var it = MR.data.items[cur.itemIndex];
      return { screen: state.allFactsUnlocked(it.id) ? 'go' : 'ask', params: { item: cur.itemIndex } };
    }
    if (!cur.breakSeen) return { screen: 'sessionbreak', params: {} };
    if (!state.allRoutesDone()) return { screen: 'guide', params: { route: cur.guide.routeIndex } };
    return { screen: 'review', params: {} };
  };
  /** 1 while the four items are in progress (lesson 1), 2 afterwards (lesson 2: Guide + Review). */
  state.lesson = function () { return state.allItemsCollected() ? 2 : 1; };

  /* ---------- device preferences ---------- */
  state.prefs = function () { return MR.storage.get(KEY_PREFS) || { muted: false }; };
  state.setPref = function (key, value) { var p = state.prefs(); p[key] = value; MR.storage.set(KEY_PREFS, p); };

  /** Test / debug helper: build a session in a given situation without playing.
   *  opts: {class_no, difficulty, seed (the game's content; default random), warmup:boolean, items:n (collected),
   *         facts:'all'|'none'|n (the first n slots of its card)|['colour',..] for the item in progress,
   *         breakSeen:boolean, routes:n (finished), review:boolean} */
  state.seed = function (opts) {
    opts = opts || {};
    state.begin(opts.class_no || 'TEST-1', opts.difficulty || 'standard', { fresh: true, seed: opts.seed });
    if (opts.warmup) cur.warmup = { done: true, correct: 8, total: 10 };
    cur.storySeen = true;
    var n = Math.min(opts.items || 0, MR.data.items.length), i;
    for (i = 0; i < n; i++) {
      var id = MR.data.items[i].id;
      MR.data.slotsOf(id).forEach(function (f) { cur.items[id].facts[f] = true; });
      cur.items[id].junctions.forEach(function (j) { j.first_choice = 0; j.first_choice_correct = true; j.attempts = 1; j.done = true; });
      cur.items[id].collected = true; cur.inventory.push(id); cur.stars++;
    }
    cur.itemIndex = n;
    if (n < MR.data.items.length && opts.facts) {
      var slots = MR.data.slotsOf(MR.data.items[n]);
      var list = opts.facts === 'all' ? slots : (opts.facts === 'none' ? [] : (typeof opts.facts === 'number' ? slots.slice(0, opts.facts) : opts.facts));
      list.forEach(function (f) { if (slots.indexOf(f) >= 0) cur.items[MR.data.items[n].id].facts[f] = true; });
    }
    if (opts.breakSeen) cur.breakSeen = true;
    var r = Math.min(opts.routes || 0, MR.data.routeIds.length);
    for (i = 0; i < r; i++) { cur.guide.routes[MR.data.routeIds[i]].reached = true; cur.stars++; }
    cur.guide.routeIndex = r;
    if (opts.review) cur.review = { done: true, self: {} };
    changed();
    return cur;
  };
})(typeof window !== 'undefined' ? window : globalThis);
