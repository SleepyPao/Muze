/* Maze Rescue - boot + debug deeplinks. Browser only. Loaded last.
 *
 * URL parameters (all optional):
 *   ?fast=1                 no typewriter, instant walking (tests, quick demos)
 *   ?offline=1              force Demo mode even if config.local.js has a key
 *   ?debug=<screen>         jump straight to a screen with a seeded pupil, in volatile memory storage
 *                           (start | warmup | ask | go | sessionbreak | guide | review | teacher)
 *     &item=0..3            ask / go: which thing (default 0)
 *     &facts=name,look      ask: facts already unlocked (default none)
 *     &route=0|1            guide: which route (default 0)
 *     &difficulty=simple    guide / any: maze difficulty
 *     &demo=1               review / teacher: fill the log with example evidence for three pupils
 *   ?memory=1               use volatile memory storage without seeding (tests)
 */
(function (root) {
  'use strict';
  var MR = root.MR;
  var q = new URLSearchParams(root.location.search);
  MR.flags.fast = q.get('fast') === '1';
  MR.flags.debug = !!q.get('debug');

  if (q.get('offline') === '1') { root.MR_CONFIG = root.MR_CONFIG || {}; root.MR_CONFIG.offline = true; }
  if (MR.flags.debug || q.get('memory') === '1') MR.storage.useMemory();

  MR.log.init();
  MR.state.init();
  MR.ui.init();

  root.addEventListener('error', function (e) { if (root.console) root.console.error('[MR] error', e.message); });

  /* ------------------------------------------------------------ example evidence (debug / teacher demo) */
  /** Play a few turns through the real APIs so the Review and Teacher screens have something to show. */
  MR.demoEvidence = function (classNo, quality) {
    var good = quality !== 'weak';
    MR.state.seed({ class_no: classNo, warmup: true, difficulty: 'standard' });
    MR.log.event('warmup', 'summary', { correct: good ? 9 : 6, total: 10 });
    var asks = good ? ['What do you need?', 'What does it look like?', 'Where it is?'] : ['Where', 'Where is it?', 'what you need', 'What colour is it?'];
    MR.data.items.forEach(function (it, i) {
      asks.forEach(function (text, k) {
        var r = MR.rules.answerAsk(it, text);
        var hint = !good && k === 1 && i % 2 === 0 ? 2 : 0;
        if (hint) { MR.state.useHint(it.id, 'place', 2); MR.log.hint({ stage: 'ask', item_id: it.id, hint_level: 2, hint_fact: 'place' }); }
        var u = r.fact_given ? MR.state.unlockFact(it.id, r.fact_given) : { assisted: false };
        r.source = 'rules';
        MR.log.askTurn({ item_id: it.id, input_mode: k === 2 ? 'speech' : 'text', asr_text: k === 2 ? text.toLowerCase().replace(/\?/, '') : '', sent_text: text, result: r, hint_level: hint, assisted: u.assisted });
      });
      it.junctions.forEach(function (j, ji) {
        var wrongFirst = !good && (i + ji) % 3 === 0;
        if (wrongFirst) {
          var w = MR.state.recordJunction(it.id, ji, 1, false);
          MR.log.goChoice({ item_id: it.id, junction_index: ji, choice: 1, correct: false, first: w.first, first_choice_correct: w.first_choice_correct });
        }
        var c = MR.state.recordJunction(it.id, ji, 0, true);
        MR.log.goChoice({ item_id: it.id, junction_index: ji, choice: 0, correct: true, first: c.first, first_choice_correct: c.first_choice_correct });
      });
      MR.state.collectItem(it.id);
      MR.log.event('go', 'pickup', { item_id: it.id });
    });
    MR.state.markBreakSeen();
    var scripts = {
      r1: good ? ['Go straight until the fountain.', 'Turn right, then walk to the tree and turn left', 'go straight until the windmill. turn right.', 'Go straight to the exit.'] :
        ['go', 'Go straight until the fountain.', 'turn', 'right', 'go straight', 'turn left', 'go straight', 'go straight', 'turn around', 'go straight', 'turn left', 'your left',
          'go straight until the tree', 'turn left', 'go straight', 'go straight', 'turn right', 'go to the exit'],
      r2: good ? ['Go straight.', 'Go straight.', 'Turn right.', 'your right', 'Go straight until the scarecrow.', 'Turn left.', 'Go straight.', 'Go straight.', 'Turn right.', 'Go straight to the exit.'] :
        ['Go straight.', 'Turn left', 'my left', 'go straight', 'turn around', 'go straight', 'go straight', 'turn right', 'your right', 'go straight', 'turn left', 'go straight', 'go straight', 'turn right', 'go straight']
    };
    MR.data.routeIds.forEach(function (rid) {
      var mz = MR.data.guideMaze(rid, 'standard'), run = MR.guide.newRun(mz), ctx = {}, pending = null;
      scripts[rid].forEach(function (text) {
        if (run.finished) return;
        var p = MR.rules.parseGuide(text, ctx), res = null, actions = p.actions;
        if (actions.length) {
          if (pending) { actions = MR.guide.mergeAnswer(pending, actions); pending = null; }
          res = MR.guide.execute(mz, run, actions);
          if (res.status === 'clarify' && res.clarify.kind === 'whose') { pending = res.pending; ctx = { expect: 'whose', pendingDir: res.clarify.dir }; } else ctx = {};
        } else { ctx = p.clarifyKind === 'dir' ? { expect: 'dir' } : {}; }
        MR.log.guideTurn({ route_id: rid, input_mode: 'text', sent_text: text, parsed_actions: actions, clarify_triggered: !actions.length || (res && res.status === 'clarify'),
          ai_reply: res ? (res.say || 'OK!') : p.clarify, hit_wall: !!(res && res.hit_wall), reached_exit: !!(res && res.reached_exit), source: 'rules' });
      });
      if (run.finished) MR.state.finishRoute(rid, run); else MR.state.saveRouteProgress(rid, run);
    });
    MR.log.setRubric(classNo, good ? { A_question_form: 3, C_precision: 2, C_repair: 3 } : { A_question_form: 1 });
    return MR.state.get();
  };

  /* ------------------------------------------------------------ debug deeplinks */
  function debugStart(screen) {
    var item = Math.max(0, Math.min(3, parseInt(q.get('item') || '0', 10) || 0));
    var route = Math.max(0, Math.min(1, parseInt(q.get('route') || '0', 10) || 0));
    var diff = q.get('difficulty') === 'simple' ? 'simple' : 'standard';
    var base = { class_no: q.get('class') || '5A-01', difficulty: diff, warmup: true };
    switch (screen) {
      case 'start': return MR.go('start');
      case 'warmup': MR.state.seed({ class_no: base.class_no, difficulty: diff }); return MR.go('warmup');
      case 'ask': {
        var f = q.get('facts'); base.items = item; base.facts = f ? f.split(',') : 'none';
        MR.state.seed(base); return MR.go('ask', { item: item });
      }
      case 'go': base.items = item; base.facts = 'all'; MR.state.seed(base); return MR.go('go', { item: item });
      case 'sessionbreak': base.items = 4; MR.state.seed(base); return MR.go('sessionbreak');
      case 'guide': base.items = 4; base.breakSeen = true; base.routes = route; MR.state.seed(base); return MR.go('guide', { route: route });
      case 'review':
        if (q.get('demo') !== '0') MR.demoEvidence(base.class_no, 'good');
        else { base.items = 4; base.breakSeen = true; base.routes = 2; MR.state.seed(base); }
        return MR.go('review');
      case 'teacher':
        if (q.get('demo') !== '0') { MR.demoEvidence('5A-01', 'good'); MR.demoEvidence('5A-02', 'weak'); MR.demoEvidence('5B-17', 'good'); MR.state.signOut(); }
        return MR.go('teacher', { unlocked: true });
      default: return MR.go('start');
    }
  }

  function boot() {
    var dbg = q.get('debug');
    if (dbg && MR.screens.has(dbg)) debugStart(dbg);
    else MR.go('start');
  }
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
