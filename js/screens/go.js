/* Go (spec 4.3): the maze for one thing. Two junctions, 2-3 paths each; the pupil clicks a path.
 * Only the FIRST choice at each junction counts for the teacher. A wrong path ends in a dead end:
 * "Dead end. Go back and ask Pip again." - Pip walks back to the junction and the pupil may ask Pip again.
 * Random clicking can never reach the thing: only the right branch of junction 2 leads to it. */
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
      var card = MR.askKit.factCard(item, { compact: true, title: 'Pip needs ' + item.name });
      var tip = el('p', { class: 'mr-go__tip', text: 'Click a path to show Pip the way.' });
      rootEl.appendChild(el('div', { class: 'mr-go' }, [box, el('div', { class: 'mr-go__side' }, [card.el, el('div', { class: 'mr-card mr-go__help' }, [tip])])]));
      card.focus('place');

      scene = MR.render.createScene(box, mz, { item: { id: item.id, x: mz.item.x, y: mz.item.y }, showExit: false, label: 'Maze for ' + item.name });
      var sc = scene;
      sc.setPip(mz.start.x, mz.start.y, mz.start.facing);
      var walking = false, current = -1;

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
        tip.textContent = j === 0 ? 'Click a path to show Pip the way.' : 'One more! Click a path.';
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
          ui.dialog.say(j === 0 ? 'Yes! This way.' : 'I can see it!', { emotion: 'happy' });
          sc.walk(b.path, { msPerTile: 190 }).then(function () {
            if (!live()) return;
            if (j + 1 < mz.junctions.length) offer(j + 1); else pickup();
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
            text: 'Pip has ' + item.name + ' now. ' + (left ? left + ' more to find!' : 'That is all four!'),
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
