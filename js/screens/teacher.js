/* Teacher view (spec 9): one row per pupil with automatic counts (rubric B), manual rubric A and C scores,
 * the full dialogue record and a route replay per pupil, export / import JSON, class CSV.
 * Hints, time and attempts are shown for information only and are not part of the language score. */
(function (root) {
  'use strict';
  var MR = root.MR, ui = MR.ui, el = ui.el;
  var scenes = [];
  function clearScenes() { scenes.forEach(function (s) { s.destroy(); }); scenes = []; }

  function mins(ms) { return ms ? (Math.round(ms / 6000) / 10) + ' min' : '—'; }
  function sel(classNo, field, value) {
    var s = el('select', { class: 'mr-rubric', attrs: { 'aria-label': field + ' for ' + classNo }, dataset: { field: field } });
    ['', '0', '1', '2', '3'].forEach(function (v) { s.appendChild(el('option', { value: v, text: v === '' ? '–' : v })); });
    s.value = value == null ? '' : String(value);
    s.addEventListener('change', function () {
      var o = {}; o[field] = s.value === '' ? null : Number(s.value);
      MR.log.setRubric(classNo, o);
      ui.toast('Saved');
    });
    s.addEventListener('click', function (e) { e.stopPropagation(); });
    return s;
  }

  /** This pupil's own four things (every game is different): icon in the pupil's colour + the three facts of its card
   *  (the kinds are different from thing to thing: name / colour / size / whose / why / when + always the place). */
  function thingsCard(classNo) {
    var sess = MR.log.sessionOf(classNo);
    var card = el('div', { class: 'mr-card mr-teach__things', attrs: { style: 'margin-bottom:12px' } }, [el('h4', { class: 'mr-card__title',
      text: 'This pupil’s things' + (sess && sess.seed != null ? ' (game ' + sess.seed + ')' : '') })]);
    if (!sess || !sess.items.length) { card.appendChild(el('p', { class: 'mr-teach__muted', text: 'Not recorded (older game).' })); return card; }
    var list = el('ol', { class: 'mr-teach__thinglist', attrs: { style: 'margin:0;padding-left:20px;display:grid;gap:6px' } });
    sess.items.forEach(function (it) {
      /* an <img> (not a canvas): the icon is drawn in the colour this pupil had */
      var icon = el('img', { class: 'mr-teach__thingicon', alt: it.id, width: 32, height: 32,
        attrs: { style: 'image-rendering:pixelated;vertical-align:middle;margin-right:6px' } });
      try { icon.src = MR.sprites.item(it.id, it.colour).toDataURL(); } catch (e) { /* no icon */ }
      /* the three questions this pupil had to ask about the thing: kind of fact + Pip's answer */
      var parts = [el('b', { text: it.id + ' ' })];
      if (it.slots && it.facts) {
        it.slots.forEach(function (f) {
          parts.push(el('span', { class: 'mr-teach__fact', dataset: { fact: f } }, [
            el('i', { text: (MR.data.FACT_LABELS[f] || f) + ': ', attrs: { style: 'font-style:normal;font-weight:800;color:#6b5a4e' } }), it.facts[f] + ' ']));
        });
      } else {      /* a game from before the cards had different questions: name / look / place */
        parts.push(el('span', { text: [it.name, it.look, it.place].filter(Boolean).join(' ') }));
      }
      list.appendChild(el('li', { class: 'mr-teach__thing', dataset: { item: it.id, slots: (it.slots || []).join(',') } }, [icon, el('span', {}, parts)]));
    });
    card.appendChild(list);
    return card;
  }

  function details(classNo) {
    var entries = MR.log.forStudent(classNo);
    var wrap = el('div', { class: 'mr-teach__details' });
    var row = (MR.log.aggregate(entries)[0]) || { grammar_notes: [] };

    /* grammar notes (for the Explain part of the lesson) */
    var notes = el('div', { class: 'mr-card mr-teach__notes' }, [el('h4', { class: 'mr-card__title', text: 'Grammar notes (not shown to the pupil)' })]);
    if (!row.grammar_notes.length) notes.appendChild(el('p', { class: 'mr-teach__muted', text: 'None.' }));
    row.grammar_notes.forEach(function (g) { notes.appendChild(el('p', {}, [el('b', { text: '“' + g.sent_text + '” ' }), el('span', { text: '→ ' + g.note })])); });

    /* full record */
    var tbl = el('table', { class: 'mr-teach__log' });
    tbl.appendChild(el('thead', {}, el('tr', {}, ['Time', 'Stage', 'Thing / route', 'Pupil said', 'Speech heard', 'Pip / result', 'Flags'].map(function (h) { return el('th', { text: h }); }))));
    var tb = el('tbody');
    entries.forEach(function (e) {
      var said = e.sent_text || (e.event === 'junction' ? 'clicked: ' + (e.choice_label || ('path ' + e.choice)) : (e.event === 'hint' ? 'Hint ' + e.hint_level :
        (e.event === 'session' ? 'new game ' + (e.seed != null ? e.seed : '') : e.event)));
      var flags = [];
      if (e.category) flags.push(e.category);
      if (e.fact_given) flags.push('fact: ' + e.fact_given);
      if (e.off_card) flags.push('not on the card (no fact)');
      if (e.assisted) flags.push('assisted');
      if (e.clarification) flags.push('clarify');
      if (e.rewrite_success === true) flags.push('rewrite ok');
      if (e.rewrite_success === false) flags.push('rewrite not ok');
      if (e.event === 'junction') flags.push(e.correct ? 'right path' : 'dead end', e.first ? 'first try' : 'retry');
      if (e.event === 'claim') flags.push(e.correct ? 'right thing' : 'wrong thing (differs in ' + e.differs + ')', e.first ? 'first try' : 'retry');
      if (e.hit_wall) flags.push('wall');
      if (e.reached_exit) flags.push('exit');
      if (e.ai_failed) flags.push('AI failed (not counted)');
      if (e.parsed_actions && e.parsed_actions.length) flags.push(e.parsed_actions.map(actionText).join(', '));
      var asr = e.input_mode === 'speech' ? (e.asr_text || '') + (e.asr_text && e.asr_text !== e.sent_text ? ' (edited)' : '') : '';
      var reply = e.ai_reply || (e.event === 'summary' ? e.correct + ' / ' + e.total + ' right' : (e.event === 'self_review' ? JSON.stringify(e.answers) :
        (e.event === 'session' ? (e.items || []).map(function (it) { return it.id; }).join(', ') + (e.difficulty ? ' · ' + e.difficulty : '') : '')));
      tb.appendChild(el('tr', { class: 'is-' + e.stage }, [
        el('td', { text: (e.timestamp || '').slice(11, 19) }), el('td', { text: e.stage }), el('td', { text: e.item_id || e.route_id || '' }),
        el('td', { text: said }), el('td', { text: asr }), el('td', { text: reply }), el('td', { text: flags.join(' · ') })
      ]));
    });
    tbl.appendChild(tb);

    /* route replay from the log */
    var replays = el('div', { class: 'mr-teach__replays' });
    var rep = MR.guide.replay(entries);
    MR.data.routeIds.forEach(function (rid, ri) {
      var r = rep[rid];
      /* the maze this pupil really had (each game mirrors / re-arranges the mazes); rebuilt from the logged maze id */
      var mz = (r && MR.data.guideMazeById(r.mazeId)) || MR.data.guideMazes[rid].standard;
      var box = el('div', { class: 'mr-scene-box mr-teach__scene' });
      var card = el('div', { class: 'mr-card mr-teach__replay' }, [el('h4', { class: 'mr-card__title', text: 'Route ' + (ri + 1) + (r ? (r.reached ? ' — exit reached' : ' — not finished') : ' — not started') }), box]);
      replays.appendChild(card);
      var sc = MR.render.createScene(box, mz, { maxScale: 2, facingArrow: true, label: 'Route replay' });
      scenes.push(sc);
      sc.setPip(mz.start.x, mz.start.y, mz.start.facing);
      if (r) {
        sc.setTrail(r.trail);
        var play = ui.button('Replay', function () {
          play.disabled = true; sc.clearTrail(); sc.setPip(mz.start.x, mz.start.y, mz.start.facing);
          sc.walk(r.trail.slice(1), { msPerTile: 120, trailEnd: true }).then(function () { play.disabled = false; });
        }, 'small');
        card.appendChild(play);
      }
    });

    wrap.appendChild(el('div', { class: 'mr-teach__top' }, [el('div', { class: 'mr-teach__left' }, [thingsCard(classNo), notes]), replays]));
    wrap.appendChild(el('div', { class: 'mr-teach__logwrap' }, tbl));
    return wrap;
  }

  function table(body) {
    clearScenes();
    body.innerHTML = '';
    var rows = MR.log.aggregate();
    if (!rows.length) { body.appendChild(el('p', { class: 'mr-card', text: 'No pupil data on this device yet. Pupils play first, or use “Import JSON” to add data from other devices.' })); return; }
    var t = el('table', { class: 'mr-teach__table' });
    var head = [
      ['Class no.', ''], ['Facts asked', '/12'], ['Assisted', 'facts'], ['Paths first try', '/8'], ['Right thing first try', '/4'], ['Exits', '/2'],
      ['Pip asked back', 'times'], ['Good rewrites', 'times'], ['A: Question form', '0–3'], ['C: Precision', '0–3'], ['C: Repair', '0–3'],
      ['Hints*', ''], ['Warm-up*', '/10'], ['Time*', ''], ['Tries*', 'paths / words'], ['', '']
    ];
    t.appendChild(el('thead', {}, el('tr', {}, head.map(function (h) { return el('th', {}, [h[0], h[1] ? el('small', { text: ' ' + h[1] }) : null]); }))));
    var tb = el('tbody');
    rows.forEach(function (r) {
      var openBtn = el('button', { class: 'mr-btn mr-btn--small', type: 'button', text: 'Open' });
      var tr = el('tr', { class: 'mr-teach__row', dataset: { classNo: r.class_no } }, [
        el('td', { class: 'mr-teach__cls', text: r.class_no }),
        el('td', { text: String(r.facts_asked) }), el('td', { text: String(r.facts_assisted) }),
        el('td', { text: String(r.junctions_first_correct) }), el('td', { text: String(r.claims_first_correct) }), el('td', { text: String(r.exits_reached) }),
        el('td', { text: String(r.clarifications) }), el('td', { text: String(r.rewrites_ok) }),
        el('td', {}, sel(r.class_no, 'A_question_form', r.rubric.A_question_form)),
        el('td', {}, sel(r.class_no, 'C_precision', r.rubric.C_precision)),
        el('td', {}, sel(r.class_no, 'C_repair', r.rubric.C_repair)),
        el('td', { class: 'mr-teach__info', text: String(r.hints_used) }),
        el('td', { class: 'mr-teach__info', text: r.warmup_correct == null ? '—' : String(r.warmup_correct) }),
        el('td', { class: 'mr-teach__info', text: mins(r.time_ms) }),
        el('td', { class: 'mr-teach__info', text: r.go_attempts + ' / ' + r.guide_instructions }),
        el('td', {}, openBtn)
      ]);
      var detailRow = el('tr', { class: 'mr-teach__detailrow', hidden: true }, el('td', { attrs: { colspan: head.length } }));
      function toggle() {
        var open = detailRow.hidden;
        detailRow.hidden = !open;
        openBtn.textContent = open ? 'Close' : 'Open';
        tr.classList.toggle('is-open', open);
        if (open && !detailRow.firstChild.firstChild) detailRow.firstChild.appendChild(details(r.class_no));
      }
      openBtn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
      tr.addEventListener('click', toggle);
      tb.appendChild(tr); tb.appendChild(detailRow);
    });
    t.appendChild(tb);
    body.appendChild(el('div', { class: 'mr-teach__tablewrap' }, t));
    body.appendChild(el('p', { class: 'mr-teach__foot', text: '* For information only: hints, warm-up, time and tries are not part of the language score. ' +
      'Rubric B = the automatic counts (facts asked, paths first try, right thing first try, exits, Pip asked back, good rewrites). Enter A and C here; they are saved on this device and in the exports.' }));
  }

  function gate(rootEl) {
    var open = ui.button('Open teacher view', function () { MR.go('teacher', { unlocked: true }); }, 'primary big');
    open.id = 'mr-teacher-open';
    var back = ui.button('Back', function () { MR.go('start'); }, 'big');
    rootEl.appendChild(el('div', { class: 'mr-center mr-teach__gate' }, el('div', { class: 'mr-card' }, [
      el('h2', { class: 'mr-h2', text: 'Teacher view' }),
      el('p', { text: 'This page is for teachers. Pupils, please go back.' }),
      el('div', { class: 'mr-row' }, [back, open])
    ])));
  }

  /** One parsed Guide action in words for the teacher: "turn left (Pip's side)", "turn around", "forward to well". */
  function actionText(a) {
    if (a.type === 'turn') {
      if (a.dir === 'around') return 'turn around';
      return 'turn ' + a.dir + (a.whose === 'my' ? ' (pupil’s side)' : (a.whose === 'your' ? ' (Pip’s side)' : ''));
    }
    if (a.type === 'forward') return 'forward' + (a.steps ? ' ' + a.steps : '') + (a.until ? ' to ' + MR.data.landmarkName(a.until) : '');
    return a.type;
  }
  MR.screens.register('teacher', {
    mount: function (rootEl, params) {
      ui.topbar.setStage('Teacher view');
      if (!params.unlocked) { gate(rootEl); return; }
      var body = el('div', { class: 'mr-teach__body' });
      var file = function (name) { return 'maze-rescue-' + name + '-' + new Date().toISOString().slice(0, 10); };
      var bJson = ui.button('Export JSON', function () { ui.download(file('log') + '.json', MR.log.exportJSON(), 'application/json'); }, 'small');
      var bImp = ui.button('Import JSON', function () {
        ui.pickFile('.json,application/json').then(function (txt) {
          if (txt == null) return;
          var r = MR.log.importJSON(txt);
          ui.toast(r.ok ? 'Added ' + r.added + ' records (' + r.skipped + ' already here).' : 'Could not import: ' + r.error, 3500);
          table(body);
        });
      }, 'small');
      var bCsv = ui.button('Export class CSV', function () { ui.download(file('class') + '.csv', '﻿' + MR.log.toCSV(), 'text/csv'); }, 'small');
      var bAi = ui.button('Try AI again', function () { MR.ai.reset(); ui.toast('AI mode: ' + MR.ai.mode()); }, 'small');
      var bClear = ui.button('Delete all data', function () {
        if (!root.confirm('Delete ALL pupil records, scores and saved games on this device? Export first if you need them.')) return;
        MR.log.clear(); MR.state.resetAll(); table(body); ui.toast('All data deleted.');
      }, 'small danger');
      var bBack = ui.button('Back to start', function () { MR.go('start'); }, 'small');
      bJson.id = 'mr-export-json'; bImp.id = 'mr-import-json'; bCsv.id = 'mr-export-csv'; bClear.id = 'mr-clear'; bBack.id = 'mr-teacher-back';
      rootEl.appendChild(el('div', { class: 'mr-teach' }, [
        el('div', { class: 'mr-teach__bar' }, [el('h2', { class: 'mr-h2', text: 'Teacher view' }), el('span', { class: 'mr-teach__mode', text: 'AI: ' + MR.ai.mode() }),
          el('div', { class: 'mr-row mr-teach__btns' }, [bJson, bImp, bCsv, bAi, bClear, bBack])]),
        root.location.protocol === 'file:' ? el('p', { class: 'mr-teach__tip', text: 'Microphone tip: the game is open as a file, so Chrome asks for the microphone every time. ' +
          'Double-click start-mac.command (Mac) or start-windows.bat (Windows) instead: the game opens at http://localhost:8787/ and you can choose “Allow on every visit”.' }) : null,
        body
      ]));
      table(body);
    },
    unmount: clearScenes
  });
})(typeof window !== 'undefined' ? window : globalThis);
