/* Review: the pupil looks back at their own questions (read-only) and watches their two routes again,
 * then answers three can-do statements. Saved with the logs. */
(function (root) {
  'use strict';
  var MR = root.MR, ui = MR.ui, el = ui.el;
  var scenes = [];
  var CAN_DO = [
    { id: 'ask_where', text: 'I can ask where something is.' },
    { id: 'directions', text: 'I can give clear directions.' },
    { id: 'repair', text: 'I can fix my sentence when Pip does not understand.' }
  ];
  var SCALE = [{ v: 2, label: 'Yes!', cls: 'yes' }, { v: 1, label: 'A little', cls: 'little' }, { v: 0, label: 'Not yet', cls: 'notyet' }];

  function transcript(classNo) {
    var wrap = el('div', { class: 'mr-review__chats' });
    MR.data.items.forEach(function (it) {
      var turns = MR.log.forStudent(classNo, { stage: 'ask', item_id: it.id, event: 'turn' });
      var icon = el('canvas', { width: 16, height: 16, class: 'mr-review__icon' });
      MR.render.drawItemIcon(icon, it.id);
      var box = el('div', { class: 'mr-review__chat' }, [el('h4', { class: 'mr-review__chathead' }, [icon, ' ' + it.noun])]);
      if (!turns.length) box.appendChild(el('p', { class: 'mr-review__none', text: '—' }));
      turns.forEach(function (t) {
        box.appendChild(el('p', { class: 'mr-bubble mr-bubble--me', text: t.sent_text }));
        box.appendChild(el('p', { class: 'mr-bubble mr-bubble--pip' + (t.fact_given ? ' is-fact' : ''), text: t.ai_reply }));
      });
      wrap.appendChild(box);
    });
    return wrap;
  }

  function routeCard(rid, ri, s, entries) {
    var mz = MR.data.guideMaze(rid, s.difficulty);
    var saved = s.guide.routes[rid];
    var trail = saved && saved.trail && saved.trail.length > 1 ? saved.trail : (MR.guide.replay(entries)[rid] || { trail: [] }).trail;
    var box = el('div', { class: 'mr-scene-box mr-review__scene' });
    var sc = MR.render.createScene(box, mz, { maxScale: 2, facingArrow: true, label: MR.data.ROUTE_TITLES[rid] || ('My way out ' + (ri + 1)) });
    scenes.push(sc);
    sc.setPip(mz.start.x, mz.start.y, mz.start.facing);
    sc.setTrail(trail);
    var said = MR.log.forStudent(s.class_no, { stage: 'guide', route_id: rid, event: 'turn' });
    var words = el('ol', { class: 'mr-review__words' });
    said.forEach(function (t) { words.appendChild(el('li', { text: t.sent_text })); });
    var play = ui.button('Watch again', function () {
      play.disabled = true;
      sc.clearTrail();
      sc.setPip(mz.start.x, mz.start.y, mz.start.facing);
      var path = trail.slice(1);
      sc.walk(path, { msPerTile: 160, trailEnd: true }).then(function () { play.disabled = false; });
    }, 'small');
    play.id = 'mr-review-play-' + rid;
    return el('div', { class: 'mr-card mr-review__route' }, [
      el('h4', { class: 'mr-card__title', text: (MR.data.ROUTE_TITLES[rid] || 'Way out ' + (ri + 1)) + (saved && saved.reached ? ' ★' : '') }),
      box, el('div', { class: 'mr-row' }, [play]), words
    ]);
  }

  MR.screens.register('review', {
    mount: function (rootEl) {
      var s = MR.state.get();
      if (!s) { MR.go('start'); return; }
      ui.topbar.setStage('Look back');
      var entries = MR.log.forStudent(s.class_no);
      var answers = {};
      var form = el('div', { class: 'mr-review__cando' });
      var doneBtn = ui.button('I’m done', submit, 'primary big');
      doneBtn.id = 'mr-review-done';
      doneBtn.disabled = true;
      CAN_DO.forEach(function (c) {
        var row = el('div', { class: 'mr-cando', dataset: { id: c.id } }, [el('p', { class: 'mr-cando__text', text: c.text })]);
        var btns = el('div', { class: 'mr-cando__btns' });
        SCALE.forEach(function (o) {
          var b = ui.button(o.label, function () {
            answers[c.id] = o.v;
            Array.prototype.forEach.call(btns.children, function (x) { x.classList.remove('is-on'); });
            b.classList.add('is-on');
            doneBtn.disabled = Object.keys(answers).length < CAN_DO.length;
          }, 'small');
          b.classList.add('mr-cando__' + o.cls);
          btns.appendChild(b);
        });
        row.appendChild(btns);
        form.appendChild(row);
      });
      if (s.review && s.review.done) {
        CAN_DO.forEach(function (c, i) {
          var v = s.review.self[c.id];
          if (v != null) { answers[c.id] = v; form.children[i].querySelectorAll('button')[SCALE.findIndex(function (o) { return o.v === v; })].classList.add('is-on'); }
        });
        doneBtn.disabled = false;
      }

      var routes = el('div', { class: 'mr-review__routes' });
      rootEl.appendChild(el('div', { class: 'mr-review' }, [
        el('h2', { class: 'mr-h2', text: 'Look back' }),
        el('div', { class: 'mr-review__grid' }, [
          el('section', { class: 'mr-card mr-review__part' }, [el('h3', { class: 'mr-card__title', text: 'My questions to Pip' }), transcript(s.class_no)]),
          el('section', { class: 'mr-review__part' }, [routes]),
          el('section', { class: 'mr-card mr-review__part mr-review__self' }, [el('h3', { class: 'mr-card__title', text: 'How did I do?' }), form, doneBtn])
        ])
      ]));
      MR.data.routeIds.forEach(function (rid, ri) { routes.appendChild(routeCard(rid, ri, s, entries)); });

      ui.dialog.show({ input: false, hint: false });
      ui.dialog.say('You helped me so much! Look back at what you did.', { emotion: 'happy' });

      function submit() {
        MR.state.finishReview(answers);
        MR.log.event('review', 'self_review', { answers: answers });
        MR.log.lockStage('review');
        ui.overlay.show({ title: 'Thank you!', text: 'You did it! Pip is safe now.', stars: MR.state.get().stars, button: 'Finish' })
          .then(function () { MR.state.signOut(); MR.go('start'); });
      }
    },
    unmount: function () { scenes.forEach(function (s) { s.destroy(); }); scenes = []; }
  });
})(typeof window !== 'undefined' ? window : globalThis);
