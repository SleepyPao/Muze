/* Maze Rescue - append-only evidence log (spec 5.3), stage locks, export / import / merge,
 * per-pupil aggregation for the teacher view, rubric scores and CSV export.
 * Pure (uses MR.storage, no DOM). Requires core.js, data.js. No audio is ever stored. Single player: there is no
 * `player` field; evidence is keyed by class_no. */
(function (root) {
  'use strict';
  var MR = root.MR = root.MR || {};
  var KEY = 'mr.log.v1';
  var log = MR.log = {};
  var db = null;        /* { device_id, seq, entries:[], locks:{}, rubric:{} } */

  log.TOTALS = { facts: 12, junctions: 8, exits: 2 };   /* 4 things x 3 facts on each card */
  log.LEGACY_FACT = 'look';         /* the old "size and colour" fact of logs written before the seven kinds */
  log.GAP_CAP_MS = 3 * 60 * 1000;   /* idle gaps longer than this are not counted as working time */

  function load() {
    if (db) return db;
    db = MR.storage.get(KEY);
    if (!db || !Array.isArray(db.entries)) db = { device_id: MR.util.uid('d'), seq: 0, entries: [], locks: {}, rubric: {} };
    db.locks = db.locks || {}; db.rubric = db.rubric || {};
    return db;
  }
  function persist() { MR.storage.set(KEY, db); }
  function classNoNow() { return (MR.state && MR.state.classNo && MR.state.classNo()) || ''; }
  function scopeOf(e) { return e.item_id || e.route_id || ''; }
  function lockKey(classNo, stage, scope) { return classNo + '|' + stage + '|' + (scope || ''); }

  /** (Re)load from storage. Call once at boot (tests call it after MR.storage.useMemory()). */
  log.init = function () { db = null; load(); return log; };

  /* ------------------------------------------------------------------ writing */
  /**
   * Append one record. Missing spec fields get neutral defaults; class_no defaults to the current pupil; `turn`
   * auto-increments per class_no + stage + item/route for conversational records; id / timestamp are set here.
   * @returns the stored record, or null when the stage is locked (read-only) or there is no class number.
   */
  log.add = function (entry) {
    load();
    var e = {
      id: '', class_no: entry.class_no || classNoNow(), stage: entry.stage || '', event: entry.event || 'turn',
      item_id: entry.item_id || null, route_id: entry.route_id || null, turn: 0,
      input_mode: entry.input_mode || null, asr_text: entry.asr_text || '', sent_text: entry.sent_text || '',
      category: entry.category || null, ai_reply: entry.ai_reply || '', fact_given: entry.fact_given || null,
      hint_level: entry.hint_level || 0, clarification: !!entry.clarification, timestamp: MR.util.nowISO()
    };
    for (var k in entry) if (!(k in e) && k !== 'audio') e[k] = entry[k];
    if (!e.class_no || !e.stage) return null;
    if (log.isLocked(e.stage, scopeOf(e), e.class_no)) return null;
    if (e.event === 'turn') {
      var n = 0;
      for (var i = 0; i < db.entries.length; i++) {
        var o = db.entries[i];
        if (o.event === 'turn' && o.class_no === e.class_no && o.stage === e.stage && scopeOf(o) === scopeOf(e)) n++;
      }
      e.turn = n + 1;
    }
    db.seq++;
    e.id = db.device_id + '-' + db.seq;
    db.entries.push(e);
    persist();
    MR.emit('log:add', e);
    return MR.util.clone(e);
  };

  function lastTurn(classNo, stage, scope) {
    for (var i = db.entries.length - 1; i >= 0; i--) {
      var o = db.entries[i];
      if (o.event === 'turn' && o.class_no === classNo && o.stage === stage && scopeOf(o) === scope) return o;
    }
    return null;
  }

  /** One Ask turn. `result` is what MR.ai.ask resolved to. Failed turns ("say that again") are logged with category null.
   *  category / fact_given are one of the seven kinds of MR.data.FACTS (name, colour, size, whose, why, when, place);
   *  logs written when every card was name / look / place have 'look' there, and still count (log.aggregate).
   *  o: {item_id, input_mode:'text'|'speech', asr_text, sent_text, result, hint_level, assisted} */
  log.askTurn = function (o) {
    load();
    var r = o.result || {}, classNo = o.class_no || classNoNow();
    var prev = lastTurn(classNo, 'ask', o.item_id);
    return log.add({
      class_no: classNo, stage: 'ask', item_id: o.item_id, input_mode: o.input_mode || 'text',
      asr_text: o.asr_text || '', sent_text: o.sent_text || '',
      category: r.failed ? null : (r.category || null), ai_reply: r.reply || '',
      fact_given: r.failed ? null : (r.fact_given || null),
      off_card: !r.failed && !!r.off_card,      /* a clear question about a kind of fact that is not on this thing's card */
      hint_level: o.hint_level || 0, clarification: !r.failed && !!r.clarification,
      grammar_note: r.grammar_note || '', assisted: !!o.assisted, ai_failed: !!r.failed, source: r.source || '',
      rewrite_success: prev && prev.clarification ? !!(r.fact_given && !r.failed) : null
    });
  };
  /** A hint was shown. o: {stage:'ask'|'guide', item_id?, route_id?, hint_level:1|2, hint_fact?} */
  log.hint = function (o) {
    return log.add({ class_no: o.class_no, stage: o.stage || 'ask', event: 'hint', item_id: o.item_id, route_id: o.route_id,
      hint_level: o.hint_level || 1, hint_fact: o.hint_fact || null, ai_reply: o.text || '' });
  };
  /** One click at a Go junction. o: {item_id, junction_index, choice, correct, first, first_choice_correct} */
  log.goChoice = function (o) {
    return log.add({ class_no: o.class_no, stage: 'go', event: 'junction', item_id: o.item_id, input_mode: 'click',
      junction_index: o.junction_index, choice: o.choice, correct: !!o.correct,
      first: !!o.first, first_choice_correct: !!o.first_choice_correct });
  };
  /** One Guide instruction. `rewrite_success` is filled in here: true/false on the turn right after a clarification, else null.
   *  o: {route_id, maze_id, input_mode, asr_text, sent_text, parsed_actions:[...], clarify_triggered, ai_reply, hit_wall, reached_exit, source, ai_failed}
   *  parsed_actions must be exactly what was given to MR.guide.execute (after merging an answer): MR.guide.replay runs them again. */
  log.guideTurn = function (o) {
    load();
    var classNo = o.class_no || classNoNow();
    var prev = lastTurn(classNo, 'guide', o.route_id);
    var clar = !!o.clarify_triggered;
    return log.add({
      class_no: classNo, stage: 'guide', route_id: o.route_id, input_mode: o.input_mode || 'text',
      asr_text: o.asr_text || '', sent_text: o.sent_text || '', ai_reply: o.ai_reply || '',
      hint_level: o.hint_level || 0, clarification: clar,
      parsed_actions: o.parsed_actions || [], clarify_triggered: clar,
      rewrite_success: prev && prev.clarify_triggered ? (!clar && !o.ai_failed && (o.parsed_actions || []).length > 0) : null,
      hit_wall: !!o.hit_wall, reached_exit: !!o.reached_exit, ai_failed: !!o.ai_failed, source: o.source || '',
      maze_id: o.maze_id || null, note: o.note || '',
      engine: o.engine != null ? o.engine : ((MR.guide && MR.guide.ENGINE) || 0)   /* which rules ran it (MR.guide.replay) */
    });
  };
  /** Any other record, e.g. log.event('warmup','summary',{correct:8,total:10}), log.event('go','pickup',{item_id}),
   *  log.event('review','self_review',{answers:{...}}), log.event('start','session',{seed, difficulty, items}) (MR.state.begin). */
  log.event = function (stage, event, extra) {
    var e = { stage: stage, event: event };
    for (var k in (extra || {})) e[k] = extra[k];
    return log.add(e);
  };

  /* ------------------------------------------------------------------ locks (read-only after a stage ends) */
  /** Lock a finished stage for a pupil, e.g. lockStage('ask','key'), lockStage('guide','r1'), lockStage('warmup'). */
  log.lockStage = function (stage, scope, classNo) {
    load();
    classNo = classNo || classNoNow(); if (!classNo) return false;
    db.locks[lockKey(classNo, stage, scope)] = MR.util.nowISO();
    persist();
    return true;
  };
  log.isLocked = function (stage, scope, classNo) {
    load();
    return !!db.locks[lockKey(classNo || classNoNow(), stage, scope)];
  };

  /* ------------------------------------------------------------------ reading */
  /** All records (copies), oldest first. */
  log.all = function () { return MR.util.clone(load().entries); };
  /** Records of one pupil; optional filter {stage, item_id, route_id, event}. */
  log.forStudent = function (classNo, filter) {
    classNo = MR.util.normClassNo(classNo); filter = filter || {};
    return load().entries.filter(function (e) {
      if (e.class_no !== classNo) return false;
      for (var k in filter) if (e[k] !== filter[k]) return false;
      return true;
    }).map(MR.util.clone);
  };
  /** The game content a pupil played (the newest 'session' record): {seed, difficulty,
   *  items:[{id, colour, name, place, slots:[3 kinds], facts:{kind: sentence}}]} (older logs: {id, colour, name, look, place}),
   *  or null (e.g. a log from before games were random). */
  log.sessionOf = function (classNo) {
    var list = log.forStudent(classNo, { stage: 'start', event: 'session' });
    var e = list[list.length - 1];
    return e ? { seed: e.seed, difficulty: e.difficulty || null, items: e.items || [], timestamp: e.timestamp } : null;
  };
  log.classNos = function () {
    var seen = {}, out = [];
    load().entries.forEach(function (e) { if (!seen[e.class_no]) { seen[e.class_no] = true; out.push(e.class_no); } });
    return out.sort();
  };

  /* ------------------------------------------------------------------ aggregation (teacher view) */
  /**
   * One row per pupil. All counts come from the log only.
   * @returns Array<{class_no, facts_asked (0-12), facts_assisted, junctions_first_correct (0-8), junctions_done,
   *   exits_reached (0-2), clarifications, rewrites_ok, hints_used, ask_turns, off_card (questions about a kind of fact
   *   that was not on the card), go_attempts, guide_instructions,
   *   wall_hits, ai_failures, time_ms, warmup_correct (number|null), warmup_total (number|null), grammar_notes:[{item_id,sent_text,note}],
   *   corrected_asr, first_time, last_time, rubric:{A_question_form, C_precision, C_repair}}>
   */
  log.aggregate = function (entries) {
    load();
    entries = entries || db.entries;
    var by = {}, order = [];
    entries.forEach(function (e) {
      if (!by[e.class_no]) { by[e.class_no] = []; order.push(e.class_no); }
      by[e.class_no].push(e);
    });
    return order.sort().map(function (classNo) {
      var list = by[classNo].slice().sort(function (a, b) { return a.timestamp < b.timestamp ? -1 : (a.timestamp > b.timestamp ? 1 : 0); });
      var facts = {}, assisted = {}, jFirst = {}, jDone = {}, cFirst = {}, exits = {};
      var row = {
        class_no: classNo, facts_asked: 0, facts_assisted: 0, junctions_first_correct: 0, junctions_done: 0, exits_reached: 0,
        claims_first_correct: 0, claim_attempts: 0,   /* "Which one is it?" at the hiding place: right thing on the first tap (0-4) */
        clarifications: 0, rewrites_ok: 0, hints_used: 0, ask_turns: 0, go_attempts: 0, guide_instructions: 0, wall_hits: 0,
        ai_failures: 0, off_card: 0, time_ms: 0, warmup_correct: null, warmup_total: null, grammar_notes: [], corrected_asr: 0,
        first_time: list.length ? list[0].timestamp : null, last_time: list.length ? list[list.length - 1].timestamp : null,
        rubric: log.getRubric(classNo)
      };
      var prevT = null;
      list.forEach(function (e) {
        var t = Date.parse(e.timestamp);
        if (prevT != null && t > prevT) row.time_ms += Math.min(t - prevT, log.GAP_CAP_MS);
        if (!isNaN(t)) prevT = t;
        if (e.ai_failed) row.ai_failures++;
        if (e.event === 'hint') { row.hints_used++; return; }
        if (e.stage === 'warmup' && e.event === 'summary') { row.warmup_correct = e.correct; row.warmup_total = e.total; return; }
        if (e.event === 'turn' && e.input_mode === 'speech' && e.asr_text && e.asr_text !== e.sent_text) row.corrected_asr++;
        if (e.clarification && e.event === 'turn') row.clarifications++;
        if (e.rewrite_success === true) row.rewrites_ok++;
        if (e.stage === 'ask' && e.event === 'turn') {
          row.ask_turns++;
          if (e.off_card) row.off_card++;
          if (e.fact_given && MR.data.getItem(e.item_id) && (MR.data.FACTS.indexOf(e.fact_given) >= 0 || e.fact_given === log.LEGACY_FACT)) {
            var fk = e.item_id + '.' + e.fact_given;
            if (!facts[fk]) { facts[fk] = true; if (e.assisted) assisted[fk] = true; }
          }
          if (e.grammar_note) row.grammar_notes.push({ item_id: e.item_id, sent_text: e.sent_text, note: e.grammar_note });
        } else if (e.stage === 'go' && e.event === 'junction') {
          row.go_attempts++;
          var jk = e.item_id + '.' + e.junction_index;
          if (e.first && !(jk in jFirst)) jFirst[jk] = !!e.first_choice_correct;
          if (e.correct) jDone[jk] = true;
        } else if (e.stage === 'go' && e.event === 'claim') {
          row.claim_attempts++;
          if (e.first && !(e.item_id in cFirst)) cFirst[e.item_id] = !!e.correct;
        } else if (e.stage === 'guide' && e.event === 'turn') {
          row.guide_instructions++;
          if (e.hit_wall) row.wall_hits++;
          if (e.reached_exit) exits[e.route_id] = true;
        }
      });
      row.facts_asked = Object.keys(facts).length;
      row.facts_assisted = Object.keys(assisted).length;
      row.junctions_first_correct = Object.keys(jFirst).filter(function (k) { return jFirst[k]; }).length;
      row.junctions_done = Object.keys(jDone).length;
      row.claims_first_correct = Object.keys(cFirst).filter(function (k) { return cFirst[k]; }).length;
      row.exits_reached = Object.keys(exits).length;
      return row;
    });
  };

  /* ------------------------------------------------------------------ rubric (entered by the teacher) */
  log.RUBRIC_FIELDS = ['A_question_form', 'C_precision', 'C_repair'];
  /** Set one or more rubric scores (0-3, or null to clear). e.g. setRubric('5A-12', {A_question_form: 2}). */
  log.setRubric = function (classNo, scores) {
    load();
    classNo = MR.util.normClassNo(classNo);
    var r = db.rubric[classNo] || { A_question_form: null, C_precision: null, C_repair: null };
    log.RUBRIC_FIELDS.forEach(function (f) {
      if (!(f in scores)) return;
      var v = scores[f];
      if (v === null || v === '' || v === undefined) r[f] = null;
      else { v = Number(v); if (v >= 0 && v <= 3 && Math.floor(v) === v) r[f] = v; }
    });
    r.updated_at = MR.util.nowISO();
    db.rubric[classNo] = r;
    persist();
    return MR.util.clone(r);
  };
  log.getRubric = function (classNo) {
    var r = load().rubric[MR.util.normClassNo(classNo)] || {};
    return { A_question_form: r.A_question_form == null ? null : r.A_question_form,
      C_precision: r.C_precision == null ? null : r.C_precision, C_repair: r.C_repair == null ? null : r.C_repair };
  };

  /* ------------------------------------------------------------------ export / import */
  /** Everything on this device as a JSON string (for the "Export JSON" button). */
  log.exportJSON = function () {
    load();
    return JSON.stringify({ app: 'maze-rescue', format: 1, device_id: db.device_id, exported_at: MR.util.nowISO(),
      entries: db.entries, locks: db.locks, rubric: db.rubric }, null, 2);
  };
  /** Merge an export from another device. Records are matched by id, so importing twice adds nothing.
   *  @returns {{ok:boolean, added:number, skipped:number, error?:string}} */
  log.importJSON = function (json) {
    load();
    var src;
    try { src = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return { ok: false, added: 0, skipped: 0, error: 'not JSON' }; }
    if (!src || src.app !== 'maze-rescue' || !Array.isArray(src.entries)) return { ok: false, added: 0, skipped: 0, error: 'not a Maze Rescue export' };
    var have = {}, added = 0, skipped = 0;
    db.entries.forEach(function (e) { have[e.id] = true; });
    src.entries.forEach(function (e) {
      if (!e || !e.id || !e.class_no || !e.stage || have[e.id]) { skipped++; return; }
      var copy = MR.util.clone(e); delete copy.audio;
      have[e.id] = true; db.entries.push(copy); added++;
    });
    db.entries.sort(function (a, b) { return a.timestamp < b.timestamp ? -1 : (a.timestamp > b.timestamp ? 1 : 0); });
    for (var k in (src.locks || {})) if (!db.locks[k]) db.locks[k] = src.locks[k];
    for (var c in (src.rubric || {})) {
      var mine = db.rubric[c], theirs = src.rubric[c];
      if (!mine || (theirs && theirs.updated_at && (!mine.updated_at || theirs.updated_at > mine.updated_at))) db.rubric[c] = MR.util.clone(theirs);
    }
    persist();
    MR.emit('log:import', { added: added, skipped: skipped });
    return { ok: true, added: added, skipped: skipped };
  };

  /* ------------------------------------------------------------------ CSV */
  log.CSV_COLUMNS = ['class_no', 'facts_asked_of_12', 'facts_assisted', 'junctions_first_correct_of_8', 'exits_reached_of_2',
    'clarifications', 'rewrites_ok', 'hints_used', 'ask_turns', 'go_attempts', 'guide_instructions', 'wall_hits',
    'time_min', 'warmup_correct', 'rubric_A_question_form', 'rubric_C_precision', 'rubric_C_repair', 'things_first_correct_of_4'];
  function cell(v) {
    if (v == null) return '';
    var s = String(v);
    if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = '\'' + s;      /* no spreadsheet formulas */
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  /** Whole class as CSV text (header + one line per pupil). */
  log.toCSV = function () {
    var lines = [log.CSV_COLUMNS.join(',')];
    log.aggregate().forEach(function (r) {
      lines.push([r.class_no, r.facts_asked, r.facts_assisted, r.junctions_first_correct, r.exits_reached,
        r.clarifications, r.rewrites_ok, r.hints_used, r.ask_turns, r.go_attempts, r.guide_instructions, r.wall_hits,
        Math.round(r.time_ms / 6000) / 10, r.warmup_correct, r.rubric.A_question_form, r.rubric.C_precision, r.rubric.C_repair, r.claims_first_correct
      ].map(cell).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  };

  /** Teacher only: delete every record, lock and rubric score on this device. */
  log.clear = function () {
    var old = load();   /* seq keeps counting so record ids are never reused */
    db = { device_id: old.device_id, seq: old.seq, entries: [], locks: {}, rubric: {} };
    persist();
    MR.emit('log:clear');
  };
})(typeof window !== 'undefined' ? window : globalThis);
