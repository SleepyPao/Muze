/* Warm-up (spec 4.1): 10 quick questions. Type 'path': read / hear an instruction, click the right path.
 * Type 'prep': look at the picture, choose the word. Instant right / wrong; the right answer is shown when wrong.
 * Not scored: only the number right is stored for the teacher. Uses no maze facts. */
(function (root) {
  'use strict';
  var MR = root.MR, ui = MR.ui, el = ui.el;
  var scene = null, alive = 0;

  MR.screens.register('warmup', {
    mount: function (rootEl) {
      var token = ++alive;
      var qs = MR.data.warmupSet(), idx = 0, right = 0;
      ui.topbar.setStage('Warm-up');
      var dots = el('div', { class: 'mr-warm__dots' });
      qs.forEach(function () { dots.appendChild(el('span', { class: 'mr-warm__dot' })); });
      var box = el('div', { class: 'mr-scene-box mr-warm__scene' });
      var card = el('div', { class: 'mr-card mr-warm__card' });
      rootEl.appendChild(el('div', { class: 'mr-warm' }, [
        el('div', { class: 'mr-warm__head' }, [el('h2', { class: 'mr-h2', text: 'Warm-up' }), dots]),
        el('div', { class: 'mr-warm__body' }, [box, card])
      ]));
      ui.dialog.show({ input: false, hint: false, emotion: 'happy' });
      ui.dialog.say('Let’s warm up! Ten quick questions.', { emotion: 'happy' });

      function setDot(i, cls) { dots.children[i].className = 'mr-warm__dot ' + cls; }
      function nextBtn(cb) {
        var b = ui.button(idx === qs.length - 1 ? 'Finish' : 'Next', cb, 'primary big');
        b.id = 'mr-warm-next';
        return b;
      }
      function feedback(ok, text) {
        var f = el('p', { class: 'mr-warm__fb ' + (ok ? 'is-right' : 'is-wrong'), text: text });
        MR.audio.sfx(ok ? 'right' : 'wrong');
        return f;
      }

      function show() {
        if (token !== alive) return;
        if (scene) { scene.destroy(); scene = null; }
        card.innerHTML = ''; box.innerHTML = '';
        var q = qs[idx];
        setDot(idx, 'is-now');
        card.appendChild(el('p', { class: 'mr-warm__count', text: 'Question ' + (idx + 1) + ' of ' + qs.length }));
        scene = MR.render.createScene(box, q.map, { maxScale: 7, showExit: false, facingArrow: q.type === 'path', label: 'Warm-up picture' });
        if (q.type === 'path') showPath(q); else showPrep(q);
      }

      function done(ok, answerText) {
        if (ok) right++;
        setDot(idx, ok ? 'is-right' : 'is-wrong');
        card.appendChild(feedback(ok, ok ? 'Yes! Well done.' : 'Not this one. ' + answerText));
        ui.dialog.setEmotion(ok ? 'happy' : 'surprised');
        card.appendChild(nextBtn(function () { idx++; if (idx < qs.length) show(); else finish(); }));
      }

      function showPath(q) {
        var sc = scene;
        card.appendChild(el('p', { class: 'mr-warm__task', text: 'Read and click the right path.' }));
        var say = el('p', { class: 'mr-warm__instr', text: '“' + q.instruction + '”' });
        var listen = ui.button('Listen', function () { MR.speech.speak(q.instruction); }, 'small');
        listen.classList.add('mr-btn--mic');
        card.appendChild(el('div', { class: 'mr-row' }, [say, MR.speech.canSpeak() ? listen : null]));
        if (q.note) card.appendChild(el('p', { class: 'mr-warm__note', text: q.note }));
        sc.setPip(q.map.start.x, q.map.start.y, q.map.start.facing);
        var answered = false;
        sc.walk(q.approach, { msPerTile: 220, trail: false }).then(function () {
          if (sc !== scene) return;
          var at = q.approach[q.approach.length - 1];
          sc.setHighlights(q.options.map(function (o) { return { id: o.id, tiles: o.tiles, color: '#ffd84a' }; }));
          /* "click here" arrows. Pip's hat and the facing chevron reach into the tile above him, so the arrow of a
           * path that goes straight up sits on the path's second tile, clear of Pip. */
          sc.setMarkers(q.options.map(function (o) {
            var dir = MR.maze.facingBetween(at, o.tiles[0]) || 'N';
            var t = dir === 'N' && o.tiles[1] ? o.tiles[1] : o.tiles[0];
            return { x: t.x, y: t.y, dir: dir };
          }));
          sc.onTileClick(function (x, y) {
            if (answered) return;
            var pick = -1;
            q.options.forEach(function (o, i) { o.tiles.forEach(function (t) { if (t.x === x && t.y === y) pick = i; }); });
            if (pick < 0) return;
            answered = true;
            sc.setMarkers([]);
            var ok = pick === q.correct, good = q.options[q.correct];
            sc.setHighlights([{ tiles: q.options[pick].tiles, color: ok ? '#3fae5a' : '#e0663c', pulse: false }].concat(ok ? [] : [{ tiles: good.tiles, color: '#3fae5a' }]));
            sc.walk(q.options[pick].tiles, { msPerTile: 220 }).then(function () { if (!ok) sc.emote('?', 1500); });
            done(ok, 'The green path is right.');
          });
        });
      }

      function showPrep(q) {
        var sc = scene;
        sc.setPip(q.pip.x, q.pip.y, q.pip.facing);
        card.appendChild(el('p', { class: 'mr-warm__task', text: 'Look at the picture. Choose the word.' }));
        var parts = q.sentence.split('___');
        var gap = el('span', { class: 'mr-warm__gap', text: '?' });
        card.appendChild(el('p', { class: 'mr-warm__sentence' }, [parts[0], gap, parts[1]]));
        var opts = el('div', { class: 'mr-warm__opts' });
        var answered = false;
        q.options.forEach(function (o, i) {
          var b = ui.button(o, function () {
            if (answered) return;
            answered = true;
            var ok = i === q.correct;
            gap.textContent = q.options[q.correct];
            gap.classList.add('is-filled');
            b.classList.add(ok ? 'is-right' : 'is-wrong');
            opts.children[q.correct].classList.add('is-right');
            Array.prototype.forEach.call(opts.children, function (c) { c.disabled = true; });
            if (ok) sc.emote('heart', 1500); else sc.emote('?', 1500);
            done(ok, 'The answer is “' + q.options[q.correct] + '”.');
          }, 'big');
          opts.appendChild(b);
        });
        card.appendChild(opts);
      }

      function finish() {
        if (scene) { scene.destroy(); scene = null; }
        MR.log.event('warmup', 'summary', { correct: right, total: qs.length });
        MR.state.finishWarmup(right, qs.length);
        MR.log.lockStage('warmup');
        card.innerHTML = ''; box.innerHTML = '';
        var pic = el('canvas', { class: 'mr-warm__pip', width: 32, height: 32 });
        MR.render.drawPortrait(pic, 'happy');
        box.appendChild(pic);
        card.appendChild(el('h2', { class: 'mr-h2', text: 'Warm-up done!' }));
        card.appendChild(el('p', { class: 'mr-warm__score', text: 'You got ' + right + ' of ' + qs.length + '.' }));
        card.appendChild(el('p', { text: 'Now Pip needs your help in the maze.' }));
        var go = ui.button('Go to the maze', function () { MR.next(); }, 'primary big');
        go.id = 'mr-warm-done';
        card.appendChild(go);
        ui.dialog.say('Great! Now I need your help.', { emotion: 'happy' });
      }

      show();
    },
    unmount: function () { alive++; if (scene) scene.destroy(); scene = null; }
  });
})(typeof window !== 'undefined' ? window : globalThis);
