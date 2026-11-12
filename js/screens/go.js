/* Go (spec 4.3): the maze for one thing. Two junctions, 2-3 paths each; the pupil clicks a path.
 * Only the FIRST choice at each junction counts for the teacher. A wrong path ends in a dead end:
 * "Dead end. Go back and ask Pip again." - Pip walks back to the junction and the pupil may ask Pip again.
 * Random clicking can never reach the thing: only the right branch of junction 2 leads to it.
 * The thing is NOT drawn on the map (the pupil must use Pip's place sentence, not their eyes). At each junction the
 * card marks the part of the sentence that matters there. At the hiding place three things lie together and the
 * pupil picks Pip's with the other two facts on the card ("Which one is it?", MR.data.claimOptions).
 * Side panel: the fact card, the legend (MR.legend: the name of every landmark on the map; tap = it blinks) and a tip. */
(function (root) {
  'use strict';
  var MR = root.MR, ui = MR.ui, el = ui.el;
  var scene = null, alive = 0;

  MR.screens.register('go', {
    mount: function (rootEl, params) {
      var token = ++alive;
      var idx = params.item != null ? params.item : MR.state.get().itemIndex;
      var item = MR.data.getItem(idx);
      if (!item || !MR.state.allFactsUnlocked(item.id)) { MR.next(); return; }    /* Go is locked until all three facts are known */
      var mz = MR.data.goMap(item.id);
      ui.topbar.setStage('Find it · thing ' + (idx + 1) + ' of 4');

      var box = el('div', { class: 'mr-scene-box mr-go__scene' });
      /* the thing's name is only shown when the pupil asked for it; otherwise it is a surprise until Pip picks it up */
      var named = MR.data.nameIsSlot(item);
      var card = MR.askKit.factCard(item, { compact: true, title: named ? 'Pip needs ' + item.name : 'Thing ' + (idx + 1) + ': what Pip told me' });
      var tip = el('p', { class: 'mr-go__tip', text: 'Click a path to show Pip the way.' });
      var side = el('div', { class: 'mr-go__side' }, [card.el, el('div', { class: 'mr-card mr-go__help' }, [tip])]);
      rootEl.appendChild(el('div', { class: 'mr-go' }, [box, side]));
      card.focus('place');

      scene = MR.render.createScene(box, mz, { item: { id: item.id, x: mz.item.x, y: mz.item.y, hidden: true }, showExit: false,
        label: named ? 'Maze for ' + item.name : 'Maze for thing ' + (idx + 1) });
      var sc = scene;
      /* the legend: the name of every landmark on this map (the words in the place sentence); tap = it blinks on the map */
      side.insertBefore(MR.legend.create(mz, sc, { compact: true }), side.lastChild);
      sc.setPip(mz.start.x, mz.start.y, mz.start.facing);
      var walking = false, current = -1, offered = {};

      ui.dialog.show({ input: true, hint: false, emotion: 'happy', placeholder: 'Ask Pip again…' });
      ui.dialog.say('Help me find it! Click a path.', { emotion: 'happy' });
      ui.dialog.onSend(function (payload) { MR.askKit.handle(item, payload, { card: card }); });

      function live() { return token === alive && sc === scene; }

      function offer(j) {
        if (!live()) return;
        current = j;
        var J = mz.junctions[j];
        sc.setHighlights(J.branches.map(function (b) { return { id: 'b' + b.option, tiles: b.path.slice(0, 2), color: '#ffd84a' }; }));
        sc.setMarkers(J.branches.map(function (b) { return { x: b.path[0].x, y: b.path[0].y, dir: MR.maze.facingBetween(J.at, b.path[0]) }; }));
        tip.textContent = j === 0 ? 'Read the yellow words on the card. Then click a path.' : 'One more! Read the yellow words. Then click a path.';
        card.focus('place');
        card.markClue(item.junctions[j].clue);       /* which part of the sentence to read now - not which path */
        if (j > 0 && !offered[j]) ui.dialog.say('Now read your card again. Which path?', { emotion: 'neutral' });
        offered[j] = true;
        walking = false;
      }

      sc.onTileClick(function (x, y) {
        if (walking || current < 0 || !live()) return;
        var J = mz.junctions[current], pick = null;
        J.branches.forEach(function (b) { b.path.forEach(function (t) { if (t.x === x && t.y === y) pick = b; }); });
        if (!pick) return;
        choose(current, pick);
      });

      function choose(j, b) {
        walking = true;
        var J = mz.junctions[j];
        var rec = MR.state.recordJunction(item.id, j, b.option, b.correct);
        MR.log.goChoice({ item_id: item.id, junction_index: j, choice: b.option, choice_label: b.label, correct: b.correct, first: rec.first, first_choice_correct: rec.first_choice_correct });
        sc.setHighlights([]); sc.setMarkers([]);
        if (b.correct) {
          ui.dialog.say(j === 0 ? 'Yes! This way.' : 'I can see something!', { emotion: 'happy' });
          card.markClue(null);
          sc.walk(b.path, { msPerTile: 190 }).then(function () {
            if (!live()) return;
            if (j + 1 < mz.junctions.length) offer(j + 1); else claim();
          });
          return;
        }
        /* wrong: walk into the dead end, surprise, walk back */
        sc.walk(b.path, { msPerTile: 190 }).then(function () {
          if (!live()) return;
          sc.emote('!', 1600);
          MR.audio.sfx('wrong');
          ui.dialog.say(MR.data.text.deadEnd, { emotion: 'surprised' });
          tip.textContent = 'Read the card again, or ask Pip again.';
          var back = b.path.slice(0, -1).reverse().concat([J.at]);
          return MR.util.wait(MR.flags.fast ? 0 : 900).then(function () { return sc.walk(back, { msPerTile: 150, trail: false }); });
        }).then(function () {
          if (!live()) return;
          offer(j);
          ui.dialog.focus();
        });
      }

      /* "Which one is it?": three things at the hiding place; the pupil picks Pip's with the other two card facts */
      function claim() {
        current = -1;
        var options = MR.data.claimOptions(item), tries = 0;
        if (!options.length) { pickup(); return; }
        card.focus(null);
        tip.textContent = 'Three things are here! Read your card. Which one is Pip’s?';
        var row = el('div', { class: 'mr-claim__row' });
        var panel = el('div', { class: 'mr-claim', attrs: { role: 'group', 'aria-label': 'Which one is it?' } }, [el('p', { class: 'mr-claim__title', text: 'Which one is it?' }), row]);
        options.forEach(function (o, i) {
          var c = el('canvas', { class: 'mr-claim__icon mr-claim__icon--' + o.size, width: 16, height: 16 });
          var g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(MR.sprites.item(o.thing, o.colour), 0, 0);
          var b = el('button', { class: 'mr-claim__opt', type: 'button', dataset: { key: o.key, correct: o.correct ? '1' : '0' },
            attrs: { 'aria-label': 'Thing ' + (i + 1) } }, [el('span', { class: 'mr-claim__pic' }, c)].concat(o.tags.map(function (t) { return el('span', { class: 'mr-claim__tag', text: t }); })));
          b.addEventListener('click', function () {
            if (!live() || b.disabled || panel.dataset.done) return;
            var first = tries === 0; tries++;
            MR.log.event('go', 'claim', { item_id: item.id, input_mode: 'click', choice: i, differs: o.differs, correct: o.correct, first: first, first_choice_correct: first ? o.correct : undefined });
            if (o.correct) {
              panel.dataset.done = '1'; b.classList.add('is-right'); MR.audio.sfx('right');
              MR.util.wait(MR.flags.fast ? 0 : 500).then(function () { if (panel.parentNode) panel.parentNode.removeChild(panel); if (live()) pickup(); });
            } else {
              b.disabled = true; b.classList.add('is-wrong'); MR.audio.sfx('wrong');
              ui.dialog.say('No, that is not it. Look at your card.', { emotion: 'confused' });
            }
          });
          row.appendChild(b);
        });
        box.appendChild(panel);
        ui.dialog.say('Which one is it? Tap it.', { emotion: 'neutral' });
      }

      function pickup() {
        sc.emote('heart', 1500);
        sc.pickupItem().then(function () {
          if (!live()) return;
          MR.state.collectItem(item.id);
          MR.log.event('go', 'pickup', { item_id: item.id });
          MR.log.lockStage('ask', item.id);
          MR.log.lockStage('go', item.id);
          ui.dialog.say(MR.data.text.gotItem, { emotion: 'happy' });
          var left = MR.data.items.length - MR.state.get().inventory.length;
          return ui.overlay.show({
            title: 'You found it!', itemId: item.id, stars: 1,
            text: (named ? 'Pip has ' + item.name + ' now. ' : 'It is ' + item.name + '! ') + (left ? left + ' more to find!' : 'That is all four!'),
            button: left ? 'Next thing' : 'Next'
          });
        }).then(function () { if (live()) MR.next(); });
      }

      walking = true;
      MR.util.wait(MR.flags.fast ? 0 : 500).then(function () { return sc.walk(mz.approach, { msPerTile: 190 }); }).then(function () { offer(0); });
    },
    unmount: function () { alive++; if (scene) scene.destroy(); scene = null; }
  });
})(typeof window !== 'undefined' ? window : globalThis);
