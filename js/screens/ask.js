/* Ask (spec 4.2): the pupil asks Pip about the thing he needs. Fact card with three slots that light up only when
 * asked. The slots are DIFFERENT from thing to thing (MR.data.slotsOf: 'place' + two of name / colour / size / whose /
 * why / when); the label of each slot tells the pupil what to find out. One question gives at most one fact.
 * Unclear -> a clarifying question, no fact. A question about something that is not on the card -> no fact
 * ("I can't tell you that. Look at your card."). Off task -> one sentence back to the task.
 * No grammar correction is shown (grammar_note goes to the log only).
 * When 'name' is not on the card the thing stays a surprise ("?") until Pip picks it up in Go.
 * Hints only when the pupil clicks Hint: level 1 general, level 2 sentence starter (level 2 marks the fact `assisted`).
 * Go stays locked until all three facts are lit.
 *
 * MR.askKit is shared with the Go screen (asking Pip again after a dead end). */
(function (root) {
  'use strict';
  var MR = root.MR, ui = MR.ui, el = ui.el;
  var LABEL = MR.data.FACT_LABELS;

  var kit = MR.askKit = {};

  /** The fact card. @returns {{el, update(), flash(fact), focus(fact)}} */
  kit.factCard = function (item, opts) {
    opts = opts || {};
    var slots = {}, kinds = MR.data.slotsOf(item);
    var card = el('div', { class: 'mr-card mr-facts' + (opts.compact ? ' mr-facts--compact' : '') }, [
      el('h3', { class: 'mr-card__title', text: opts.title || 'What Pip told me' })
    ]);
    card.dataset.slots = kinds.join(',');
    kinds.forEach(function (f) {
      var icon = el('canvas', { class: 'mr-fact__icon', width: 16, height: 16 });
      var text = el('p', { class: 'mr-fact__text' });
      var slot = el('div', { class: 'mr-fact', dataset: { fact: f } }, [
        el('div', { class: 'mr-fact__label', text: LABEL[f] }), el('div', { class: 'mr-fact__body' }, [icon, text])
      ]);
      slots[f] = { el: slot, text: text, icon: icon };
      card.appendChild(slot);
    });
    function update() {
      var s = MR.state.itemState(item.id);
      kinds.forEach(function (f) {
        var on = !!(s && s.facts[f]), sl = slots[f];
        sl.el.classList.toggle('is-on', on);
        sl.el.classList.toggle('is-assisted', !!(s && s.assisted[f]));
        sl.text.textContent = on ? MR.data.factText(item.id, f) : '? ? ?';
        var g = sl.icon.getContext('2d'); g.clearRect(0, 0, 16, 16);
        if (on && f === 'name') MR.render.drawItemIcon(sl.icon, item.id);
        sl.icon.hidden = !(on && f === 'name');
      });
    }
    update();
    return {
      el: card, update: update,
      /** The card shakes its locked slots: "Look at your card." */
      nudge: function () {
        kinds.forEach(function (k) {
          var e = slots[k].el; if (e.classList.contains('is-on')) return;
          e.classList.remove('is-nudged'); void e.offsetWidth; e.classList.add('is-nudged');
          root.setTimeout(function () { e.classList.remove('is-nudged'); }, 1200);
        });
      },
      flash: function (f) { var s = slots[f]; if (!s) return; s.el.classList.remove('is-new'); void s.el.offsetWidth; s.el.classList.add('is-new'); },
      focus: function (f) { kinds.forEach(function (k) { slots[k].el.classList.toggle('is-hinted', k === f); }); }
    };
  };

  /**
   * Send one pupil sentence to Pip (MR.ai.ask), show + log the answer, unlock a fact.
   * @param {object} item  entry of MR.data.items
   * @param {{text, input_mode, asr_text}} payload  from ui.dialog.onSend
   * @param {{card?, onFact?:function(fact, unlockResult), onAll?:function()}} hooks
   * @returns {Promise<object>} the ai result
   */
  kit.handle = function (item, payload, hooks) {
    hooks = hooks || {};
    var given = MR.state.givenFacts(item.id);
    ui.dialog.setBusy(true);
    ui.dialog.say('…', { speak: false, instant: true });
    return MR.ai.ask({ item: item, given: given, text: payload.text }).then(function (r) {
      ui.dialog.setBusy(false);
      var s = MR.state.itemState(item.id);
      var u = null;
      if (!r.failed && r.fact_given) u = MR.state.unlockFact(item.id, r.fact_given);
      var hintLevel = r.fact_given && s ? s.hintLevel[r.fact_given] : 0;
      MR.log.askTurn({ item_id: item.id, input_mode: payload.input_mode, asr_text: payload.asr_text, sent_text: payload.text,
        result: r, hint_level: hintLevel, assisted: !!(u && u.assisted) });
      var emotion = r.failed ? 'confused' : (r.fact_given ? 'happy' : (r.category === 'unclear' ? 'confused' : 'neutral'));
      if (r.off_card && hooks.card) hooks.card.nudge();        /* "Look at your card." */
      var said = ui.dialog.say(r.reply, { emotion: emotion });
      if (u) {
        if (hooks.card) { hooks.card.update(); if (u.isNew) { hooks.card.flash(r.fact_given); MR.audio.sfx('unlock'); } }
        if (hooks.onFact) hooks.onFact(r.fact_given, u);
        if (u.allUnlocked && u.isNew && hooks.onAll) said.then(hooks.onAll);
      }
      return r;
    });
  };

  /** Hint ladder for the next locked fact. @returns {{fact, level, text}|null} */
  kit.hint = function (item) {
    var fact = MR.state.nextHintFact(item.id);
    if (!fact) return null;
    var s = MR.state.itemState(item.id);
    var level = Math.min(2, (s.hintLevel[fact] || 0) + 1);
    MR.state.useHint(item.id, fact, level);
    var text = MR.data.hints[fact][level];
    MR.log.hint({ stage: 'ask', item_id: item.id, hint_level: level, hint_fact: fact, text: text });
    return { fact: fact, level: level, text: text };
  };

  /* ================================================================ screen */
  MR.screens.register('ask', {
    mount: function (rootEl, params) {
      var idx = params.item != null ? params.item : MR.state.get().itemIndex;
      var item = MR.data.getItem(idx);
      if (!item) { MR.next(); return; }
      ui.topbar.setStage('Ask Pip · thing ' + (idx + 1) + ' of 4');
      var card = kit.factCard(item, { title: 'Thing ' + (idx + 1) + ': what Pip told me' });
      var hintBox = el('div', { class: 'mr-hintbox', attrs: { 'aria-live': 'polite' }, hidden: true });
      var goBtn = ui.button('Let’s go!', function () { if (MR.state.allFactsUnlocked(item.id)) MR.go('go', { item: idx }); }, 'primary big');
      goBtn.id = 'mr-go-btn';
      var lock = el('p', { class: 'mr-ask__lock', text: 'Ask about the 3 things on the card. Then you can go.' });
      function refreshGo() {
        var all = MR.state.allFactsUnlocked(item.id);
        goBtn.disabled = !all; lock.hidden = all;
        goBtn.classList.toggle('is-ready', all);
        ui.dialog.setHintEnabled(!all);
      }

      var big = el('canvas', { class: 'mr-ask__pip', width: 16, height: 20 });
      MR.render.drawPip(big, 'S');
      var mystery = el('canvas', { class: 'mr-ask__thing', width: 16, height: 16 });
      function drawThing() {
        var s = MR.state.itemState(item.id), g = mystery.getContext('2d');
        g.clearRect(0, 0, 16, 16);
        if (s && s.facts.name) MR.render.drawItemIcon(mystery, item.id);
        mystery.parentNode && mystery.parentNode.classList.toggle('is-known', !!(s && s.facts.name));
      }
      var thingBox = el('div', { class: 'mr-ask__thingbox' }, [mystery, el('span', { class: 'mr-ask__q', text: '?' })]);
      rootEl.appendChild(el('div', { class: 'mr-ask' }, [
        el('div', { class: 'mr-ask__left mr-card' }, [
          el('div', { class: 'mr-ask__stage' }, [big, thingBox]),
          el('p', { class: 'mr-ask__tip', text: 'Pip needs something. Look at the card and ask Pip in English.' })
        ]),
        el('div', { class: 'mr-ask__right' }, [card.el, hintBox, el('div', { class: 'mr-ask__go' }, [lock, goBtn])])
      ]));
      drawThing();

      ui.dialog.show({ input: true, hint: true, emotion: 'neutral', placeholder: 'Ask Pip a question…' });
      ui.dialog.say(idx === 0 ? MR.data.text.askOpen : MR.data.text.askNext, { emotion: 'neutral' });
      refreshGo();
      ui.dialog.focus();

      ui.dialog.onSend(function (payload) {
        hintBox.hidden = true; card.focus(null);
        kit.handle(item, payload, {
          card: card,
          onFact: function () { drawThing(); refreshGo(); },
          onAll: function () {
            if (MR.screens.current().name !== 'ask') return;
            MR.util.wait(MR.flags.fast ? 0 : 300).then(function () {
              ui.dialog.say(MR.data.text.askAllFacts, { emotion: 'happy' });
              goBtn.focus({ preventScroll: true });
            });
          }
        }).then(function () { refreshGo(); });
      });
      ui.dialog.onHint(function () {
        var h = kit.hint(item);
        if (!h) return;
        hintBox.innerHTML = '';
        hintBox.appendChild(el('span', { class: 'mr-hintbox__tag', text: 'Hint' }));
        hintBox.appendChild(el('span', { class: 'mr-hintbox__text', text: h.text }));
        hintBox.hidden = false;
        card.focus(h.fact);
        ui.dialog.setEmotion('neutral');
        ui.dialog.focus();
      });
    },
    unmount: function () {}
  });
})(typeof window !== 'undefined' ? window : globalThis);
