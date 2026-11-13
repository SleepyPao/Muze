/* Maze Rescue - boot + debug deeplinks. Browser only. Loaded last.
 *
 * URL parameters (all optional):
 *   ?fast=1                 no typewriter, instant walking (tests, quick demos)
 *   ?offline=1              force Demo mode even if config.local.js has a key
 *   ?debug=<screen>         jump straight to a screen with a seeded pupil, in volatile memory storage
 *                           (start | warmup | ask | go | sessionbreak | guide | review | teacher)
 *     &item=0..3            ask / go: which thing (default 0)
 *     &facts=colour,place   ask: kinds of fact already unlocked, if they are on the thing's card (default none);
 *                           &facts=2 = the first 2 slots of the card, &facts=all = all three
 *     &route=0..3           guide: which route (default 0; 2 = to the library, 3 = back to the station)
 *     &difficulty=simple    guide / any: maze difficulty
 *     &seed=123             any: the game's content (things, maps, warm-up, maze variants); default random
 *     &train=20             any: seconds on the train clock (route r4, back to University Station)
 *     &demo=1               review / teacher: fill the log with example evidence for three pupils
 *   ?memory=1               use volatile memory storage without seeding (tests)
 *   ?levels=1               open the level select (js/levels.js) on the start page
 * On every ?debug= page the top bar has "Levels" (pick any level) and "Skip" (the next level).
 */
(function (root) {
  'use strict';
  var MR = root.MR;
  var q = new URLSearchParams(root.location.search);
  MR.flags.fast = q.get('fast') === '1';
  MR.flags.debug = !!q.get('debug');

  if (q.get('offline') === '1') { root.MR_CONFIG = root.MR_CONFIG || {}; root.MR_CONFIG.offline = true; }
  if (MR.flags.debug || q.get('memory') === '1') MR.storage.useMemory();
  if (Number(q.get('train')) > 0) MR.data.TRAIN_SECONDS = { standard: Number(q.get('train')), simple: Number(q.get('train')) };

  MR.log.init();
  MR.state.init();
  MR.ui.init();
  MR.levels.initTopbar();
  MR.ai.probe();                       /* web version: is the AI relay there? (else the offline rules) */

  root.addEventListener('error', function (e) { if (root.console) root.console.error('[MR] error', e.message); });

  /* ------------------------------------------------------------ example evidence (debug / teacher demo) */
  /** Play a few turns through the real APIs so the Review and Teacher screens have something to show. */
  MR.demoEvidence = function (classNo, quality, seed) {
    var good = quality !== 'weak';
    MR.state.seed({ class_no: classNo, warmup: true, difficulty: 'standard', seed: seed != null ? seed : MR.data.seedFromText(classNo) });
    MR.log.event('warmup', 'summary', { correct: good ? 9 : 6, total: 10 });
    /* a good and a weak way to ask for each kind of fact; each thing is asked about the three kinds on ITS card */
    var Q = good
      ? { name: 'What do you need?', colour: 'What colour is it?', size: 'Is it big or small?', whose: 'Whose is it?',
        why: 'Why do you need it?', when: 'When did you lose it?', place: 'Where it is?' }
      : { name: 'what you need', colour: 'What colour it is?', size: 'How big is it?', whose: 'Whose it is?',
        why: 'Why you need it?', when: 'When you lose it?', place: 'Where is it?' };
    MR.data.items.forEach(function (it, i) {
      var slots = MR.data.slotsOf(it);
      var asks = slots.map(function (f) { return Q[f]; });
      if (!good) {
        asks.unshift('Where');                                              /* one word: Pip asks back */
        var off = MR.data.FACTS.filter(function (f) { return slots.indexOf(f) < 0; })[i % 4];
        if (i % 2 === 0) asks.splice(2, 0, Q[off]);                         /* a question that is not on the card: no fact */
      }
      asks.forEach(function (text, k) {
        var r = MR.rules.answerAsk(it, text, MR.state.givenFacts(it.id));
        var hint = !good && k === 1 && i % 2 === 0 ? 2 : 0;
        if (hint) { MR.state.useHint(it.id, 'place', 2); MR.log.hint({ stage: 'ask', item_id: it.id, hint_level: 2, hint_fact: 'place' }); }
        var u = r.fact_given ? MR.state.unlockFact(it.id, r.fact_given) : { assisted: false };
        r.source = 'rules';
        MR.log.askTurn({ item_id: it.id, input_mode: k === 2 ? 'speech' : 'text', asr_text: k === 2 ? text.toLowerCase().replace(/\?/, '') : '', sent_text: text, result: r, hint_level: hint, assisted: u.assisted });
      });
      it.junctions.forEach(function (j, ji) {
        var wrongFirst = !good && (i + ji) % 3 === 0, wrong = (j.correct + 1) % j.options.length;
        if (wrongFirst) {
          var w = MR.state.recordJunction(it.id, ji, wrong, false);
          MR.log.goChoice({ item_id: it.id, junction_index: ji, choice: wrong, choice_label: j.options[wrong], correct: false, first: w.first, first_choice_correct: w.first_choice_correct });
        }
        var c = MR.state.recordJunction(it.id, ji, j.correct, true);
        MR.log.goChoice({ item_id: it.id, junction_index: ji, choice: j.correct, choice_label: j.options[j.correct], correct: true, first: c.first, first_choice_correct: c.first_choice_correct });
      });
      MR.state.collectItem(it.id);
      MR.log.event('go', 'pickup', { item_id: it.id });
    });
    MR.state.markBreakSeen();
    /* Guide: a few muddled lines first (weak pupil), then a shortest way out of THIS game's maze, said as a pupil would
     * ("Go straight until the well.", "Turn left."). Pip's questions are answered like a pupil would answer them. */
    MR.data.routeIds.forEach(function (rid) {
      var mz = MR.data.guideMaze(rid, 'standard'), run = MR.guide.newRun(mz), ctx = {}, pending = null, guard = 0;
      var queue = good ? [] : ['go', 'turn', 'left', 'go straight', 'walk to the house', 'turn around'];
      function sayLine(text) {
        var p = MR.rules.parseGuide(text, ctx), res = null, actions = p.actions, answer = null;
        if (actions.length) {
          /* the same rule as the Guide screen: only an answer ("your left" / "my left") replaces the turn Pip asked about */
          if (pending) { if (actions[0].type === 'turn' && actions[0].whose) actions = MR.guide.mergeAnswer(pending, actions); pending = null; }
          res = MR.guide.execute(mz, run, actions);
          if (res.status === 'clarify' && res.clarify.kind === 'whose') {
            pending = res.pending; ctx = { expect: 'whose', pendingDir: res.clarify.dir };
            answer = (good ? 'your ' : 'my ') + res.clarify.dir;
          } else ctx = {};
        } else if (p.clarifyKind === 'dir') ctx = { expect: 'dir' };
        else if (!pending) ctx = {};
        MR.log.guideTurn({ route_id: rid, maze_id: mz.id, input_mode: 'text', sent_text: text, parsed_actions: actions, clarify_triggered: !actions.length || (res && res.status === 'clarify'),
          ai_reply: res ? (res.say || 'OK!') : p.clarify, hit_wall: !!(res && res.hit_wall), reached_exit: !!(res && res.reached_exit), note: res && res.note ? res.note : '', source: 'rules' });
        return answer;
      }
      function lineFor(a) {
        /* the plan is in Pip's own left / right. A pupil who told Pip "my left" (run.whoseMode 'my') says the screen side
         * while Pip faces the viewer - Pip remembers, so no "your" is needed. */
        if (a.type === 'turn') return 'Turn ' + (run.facing === 'S' && run.whoseMode === 'my' ? (a.dir === 'left' ? 'right' : 'left') : a.dir) + '.';
        var seen = MR.maze.visibleAhead(mz, run, run.facing).filter(function (v) { return v.dist === a.steps; })[0];
        if (seen) return seen.type === 'exit' ? 'Go to the way out.' : 'Go straight until the ' + MR.data.landmarkName(seen.type) + '.';
        return 'Go forward ' + a.steps + (a.steps === 1 ? ' step.' : ' steps.');
      }
      while (queue.length && guard++ < 40) { var ans = sayLine(queue.shift()); if (ans) queue.unshift(ans); }
      while (!run.finished && guard++ < 40) {
        var plan = MR.data.guideSolution(mz, { x: run.x, y: run.y, facing: run.facing });
        if (!plan || !plan.length) break;
        var ans2 = sayLine(lineFor(plan[0]));
        if (ans2) sayLine(ans2);
      }
      if (run.finished) MR.state.finishRoute(rid, run); else MR.state.saveRouteProgress(rid, run);
    });
    MR.log.setRubric(classNo, good ? { A_question_form: 3, C_precision: 2, C_repair: 3 } : { A_question_form: 1 });
    return MR.state.get();
  };

  /* ------------------------------------------------------------ debug deeplinks */
  function debugStart(screen) {
    var item = Math.max(0, Math.min(3, parseInt(q.get('item') || '0', 10) || 0));
    var route = Math.max(0, Math.min(MR.data.routeIds.length - 1, parseInt(q.get('route') || '0', 10) || 0));
    var diff = q.get('difficulty') === 'simple' ? 'simple' : 'standard';
    var seed = q.get('seed') != null && q.get('seed') !== '' && !isNaN(Number(q.get('seed'))) ? Number(q.get('seed')) >>> 0 : null;
    var base = { class_no: q.get('class') || '5A-01', difficulty: diff, warmup: true, seed: seed };
    switch (screen) {
      case 'start': return MR.go('start');
      case 'warmup': MR.state.seed({ class_no: base.class_no, difficulty: diff, seed: seed }); return MR.go('warmup');
      case 'ask': {
        var f = q.get('facts'); base.items = item;
        base.facts = !f ? 'none' : (f === 'all' ? 'all' : (/^\d$/.test(f) ? Number(f) : f.split(',')));
        MR.state.seed(base); return MR.go('ask', { item: item });
      }
      case 'go': base.items = item; base.facts = 'all'; MR.state.seed(base); return MR.go('go', { item: item });
      case 'sessionbreak': base.items = 4; MR.state.seed(base); return MR.go('sessionbreak');
      case 'guide': base.items = 4; base.breakSeen = true; base.routes = route; MR.state.seed(base); return MR.go('guide', { route: route });
      case 'review':
        if (q.get('demo') !== '0') MR.demoEvidence(base.class_no, 'good', seed);
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
    if (q.get('levels') === '1') MR.levels.show();
  }
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
