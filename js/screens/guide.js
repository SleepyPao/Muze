/* Guide (spec 4.4): the pupil sees the whole maze, Pip and the exit, and tells Pip the way in English.
 * MR.ai.guide (or the offline rules) turns the words into a few allowed actions; MR.guide.execute (the game, not
 * the AI) checks and runs them. Pip asks when the words are not enough ("Left or right?", "My left or your left?",
 * "I can't see a tree. What can I see?"). A wall stops Pip ("There is a wall.") - never game over.
 * Side panel: the task + "Start again", the legend (MR.legend: the name of every landmark; tap = it blinks on the map),
 * the hint box and "What I said". Hints come from where Pip is NOW (js/guide-hint.js): 1st click = what Pip can see,
 * 2nd click = the next good instruction. The level goes back to 1 after Pip moves.
 * After a page reload (or the next lesson) the walk is rebuilt from the log with MR.guide.replay - the same function
 * the teacher's replay uses - so Pip stands where he was, looks the same way, still remembers what "left" means
 * (run.whoseMode) and, if he was waiting for "My left or your left?", asks it again.
 * The last level is a real place (University Station): r3 to the library for the book "Cute Gordon", then r4 back to
 * the station before the train leaves. On r4 a train clock counts down while it is the pupil's turn only (not while
 * Pip talks or walks, the AI thinks, a card is open or the page is hidden). When it reaches 0:00 the train has gone:
 * Pip goes back to the library and the next try has more time (MR.data.trainSeconds). Never game over. */
(function (root) {
  'use strict';
  var MR = root.MR, ui = MR.ui, el = ui.el;
  var scene = null, alive = 0;
  var OK_LINES = ['OK! What now?', 'Done! Where next?', 'OK! Tell me more.'];

  MR.screens.register('guide', {
    mount: function (rootEl, params) {
      var token = ++alive;
      var s = MR.state.get();
      var ri = params.route != null ? params.route : s.guide.routeIndex;
      var rid = MR.data.routeIds[ri];
      if (!rid) { MR.next(); return; }
      var mz = MR.data.guideMaze(rid, s.difficulty);
      var T = MR.data.text;
      var city = !!mz.noGate;          /* the real place: University Station and the library */
      var timed = !!mz.timed;          /* r4: back to the station before the train leaves */
      var nMaze = MR.data.routeIds.filter(function (id) { return !MR.data.guideMazes[id].standard.noGate; }).length;
      var title = city ? MR.data.ROUTE_TITLES[rid] : 'Way out ' + (ri + 1) + ' of ' + nMaze;
      ui.topbar.setStage('Guide Pip · ' + (city ? 'University Station' : 'way out ' + (ri + 1) + ' of ' + nMaze));
      var taskText = !city ? 'Tell Pip how to get to the gate.' : (timed
        ? 'Pip has the book. The train leaves soon! Tell Pip how to get back to University Station.'
        : 'Pip has an exam today and needs the book “' + MR.data.BOOK_TITLE + '”. Tell Pip how to get to the library.');

      var box = el('div', { class: 'mr-scene-box mr-guide__scene' });
      var list = el('ol', { class: 'mr-guide__list' });
      var empty = el('p', { class: 'mr-guide__empty', text: 'Your words will be here.' });
      var restart = ui.button('Start again', function () { restartRun(true); }, 'small');
      restart.id = 'mr-guide-restart';
      var hintBox = el('div', { class: 'mr-hintbox mr-guide__hint', hidden: true, attrs: { 'aria-live': 'polite' } });
      var side = el('div', { class: 'mr-guide__side' }, [
        el('div', { class: 'mr-card mr-guide__task' }, [
          el('div', { class: 'mr-guide__taskhead' }, [el('h3', { class: 'mr-card__title', text: title }), restart]),
          el('p', { text: taskText }),
          el('p', { class: 'mr-guide__legend' }, [el('span', { class: 'mr-guide__arrow', text: '▲' }), ' shows where Pip is looking.'])
        ]),
        hintBox,
        el('div', { class: 'mr-card mr-guide__history' }, [el('h3', { class: 'mr-card__title', text: 'What I said' }), empty, list])
      ]);
      rootEl.appendChild(el('div', { class: 'mr-guide' }, [box, side]));

      scene = MR.render.createScene(box, mz, { facingArrow: true, showExit: true, label: city ? 'A street map: University Station and the library' : 'The maze with the way out' });
      var sc = scene;
      /* the train clock (r4): on the map, so it is in sight on a phone too */
      var clock = null;
      if (timed) {
        var savedClock = MR.state.trainClock(rid);
        clock = { tries: savedClock ? savedClock.tries : 0, running: false, last: 0, saved: 0, timer: null,
          time: el('span', { class: 'mr-train__time' }),
          box: el('div', { class: 'mr-train', attrs: { role: 'timer', 'aria-label': 'Time until the train leaves' } }) };
        clock.left = savedClock ? savedClock.left : MR.data.trainSeconds(s.difficulty, 0);
        clock.box.appendChild(el('span', { class: 'mr-train__label', text: 'Train leaves in' }));
        clock.box.appendChild(clock.time);
        box.appendChild(clock.box);
      }
      side.insertBefore(MR.legend.create(mz, sc, { compact: true }), hintBox);
      var run, pending = null, ctx = {}, busy = false, hintLevel = 0, sentAny = false;

      function live() { return token === alive && sc === scene; }
      function showClock() {
        var sec = Math.ceil(clock.left), m = Math.floor(sec / 60), ss = sec % 60;
        clock.time.textContent = m + ':' + (ss < 10 ? '0' : '') + ss;
        clock.box.classList.toggle('is-low', sec <= 30);
      }
      /* counts only while the pupil can talk to Pip */
      function tick() {
        if (!live()) { clearInterval(clock.timer); return; }
        var now = Date.now(), dt = (now - clock.last) / 1000;
        clock.last = now;
        var counting = clock.running && !busy && !run.finished && !root.document.hidden && !ui.overlay.isOpen();
        if (!counting) return;
        clock.left = Math.max(0, clock.left - dt);
        showClock();
        if (Math.abs(clock.saved - clock.left) >= 3) { clock.saved = clock.left; MR.state.setTrainClock(rid, clock.left, clock.tries, true); }
        if (clock.left <= 0) trainGone();
      }
      function startClock() {
        if (!clock || !live()) return;
        clock.running = true; clock.last = Date.now(); clock.saved = clock.left;
        if (!clock.timer) clock.timer = setInterval(tick, 250);
      }
      function trainGone() {
        busy = true; clock.running = false;
        clock.tries++;
        clock.left = MR.data.trainSeconds(s.difficulty, clock.tries);
        MR.state.setTrainClock(rid, clock.left, clock.tries);
        MR.log.event('guide', 'restart', { route_id: rid, maze_id: mz.id, reason: 'train_missed', tries: clock.tries });
        ui.dialog.setBusy(true);
        MR.audio.sfx('wrong');
        var mins = Math.round(clock.left / 60);
        ui.dialog.say(T.trainGone, { emotion: 'surprised' })
          .then(function () {
            if (!live()) return null;
            return ui.overlay.show({ title: 'The train has gone!', emotion: 'surprised', sfx: false, itemId: 'book',
              text: 'Don’t worry. The next train comes soon. Pip goes back to the library. Try again: this time you have ' + mins + ' minutes.',
              button: 'Try again' });
          })
          .then(function () {
            if (!live()) return null;
            restartRun(false);
            showClock();
            ui.dialog.setBusy(false);
            busy = false;
            return ui.dialog.say(T.trainAgain, { emotion: 'neutral' });
          })
          .then(function () { if (live()) { startClock(); ui.dialog.focus(); } });
      }
      function restartRun(logIt) {
        run = MR.guide.newRun(mz);
        pending = null; ctx = {};
        hintLevel = 0; sc.hideLabels();
        if (!hintBox.hidden) { hintBox.hidden = true; sc.resize(); }
        sc.setPip(run.x, run.y, run.facing);
        sc.clearTrail();
        list.innerHTML = ''; empty.hidden = false;
        if (logIt) {
          MR.log.event('guide', 'restart', { route_id: rid, maze_id: mz.id });
          ui.dialog.say('OK, I am back at the start.', { emotion: 'neutral' });
          ui.dialog.focus();
        }
      }
      function addHistory(text, kind) {
        empty.hidden = true;
        var mark = { ok: '✓', wall: '!', ask: '?', exit: '★', fail: '…' }[kind] || '•';
        list.appendChild(el('li', { class: 'mr-guide__item is-' + kind }, [el('span', { class: 'mr-guide__mark', text: mark }), el('span', { text: text })]));
        list.scrollTop = list.scrollHeight;
      }
      /** Go on where the pupil stopped: the run is rebuilt from this pupil's log records (what the teacher's replay shows).
       *  @returns {boolean} false when there is nothing to go on from (a new route, or right after "Start again") */
      function resumeRun() {
        var rep = MR.guide.replay(MR.log.forStudent(MR.state.classNo(), { stage: 'guide', route_id: rid }))[rid];
        if (!rep || rep.mazeId !== mz.id || !rep.said.length) return false;
        run = rep.run;
        pending = rep.pending;
        ctx = pending ? { expect: 'whose', pendingDir: rep.pendingDir } : {};
        sc.setPip(run.x, run.y, run.facing);
        sc.clearTrail();
        sc.addTrail(run.trail.slice(0, -1).map(function (t, i) { return { x: t.x, y: t.y, facing: MR.maze.facingBetween(t, run.trail[i + 1]) || 'N' }; }));
        rep.said.forEach(function (h) { addHistory(h.text, h.kind); });
        if (!run.finished) MR.state.saveRouteProgress(rid, run);
        return true;
      }
      restartRun(false);
      var resumed = resumeRun();

      function animate(steps) {
        var p = Promise.resolve();
        steps.forEach(function (st) {
          p = p.then(function () {
            if (!live()) return;
            if (st.type === 'move') return sc.walk(st.path, { msPerTile: 170 });
            if (st.type === 'turn' && st.dir === 'around') {            /* a half turn: show it in two quarter turns */
              return sc.turn(MR.maze.RIGHT_OF[MR.maze.OPPOSITE[st.facing]]).then(function () { return live() ? sc.turn(st.facing) : null; });
            }
            if (st.type === 'turn') return sc.turn(st.facing);
            if (st.type === 'bump') return sc.bump();
          });
        });
        return p;
      }

      ui.dialog.show({ input: true, hint: true, emotion: 'neutral', placeholder: 'Tell Pip where to go…' });
      if (clock) showClock();
      if (resumed && run.finished) {
        /* the page was closed while Pip walked his last steps: he is out, show it */
        busy = true;
        finish();
      } else if (resumed && pending) {
        sc.emote('?', 1600);
        ui.dialog.say(T.whose(ctx.pendingDir), { emotion: 'confused' });       /* Pip was waiting for this answer */
        startClock();
      } else {
        ui.dialog.say(timed ? T.trainOpen : (city ? T.cityOpen : (ri === 0 ? T.guideOpen : 'Now the other way out. Help me again!')), { emotion: timed ? 'surprised' : 'neutral' })
          .then(function () {
            /* the book's name comes second (two short lines fit a phone held sideways); not when the pupil already spoke */
            if (city && !timed && live() && !busy && !sentAny) return ui.dialog.say(T.cityBook, { emotion: 'neutral' });
          })
          .then(startClock);
      }
      ui.dialog.focus();

      /* Hints are worked out from where Pip is now, so they are always true. Click 1: what Pip can see.
       * Click 2 (and more): the next good instruction. Back to click 1 after Pip moves. */
      ui.dialog.onHint(function () {
        if (busy || run.finished) return;
        hintLevel = Math.min(2, hintLevel + 1);
        var h = hintLevel === 1 ? MR.guide.lookHint(mz, run) : MR.guide.nextStep(mz, run, { pending: pending });
        MR.log.hint({ stage: 'guide', route_id: rid, hint_level: hintLevel, text: h.text });
        hintBox.innerHTML = '';
        hintBox.appendChild(el('span', { class: 'mr-hintbox__tag', text: 'Hint ' + hintLevel }));
        hintBox.appendChild(el('span', { class: 'mr-hintbox__text', text: h.text }));
        hintBox.hidden = false;
        sc.resize();                 /* the side panel grew: in the one-column layout the map box is smaller now */
        /* show on the map what the hint talks about */
        var spots = hintLevel === 1 ? h.visible : (h.landmark ? [h.landmark] : []);
        spots.forEach(function (v) { sc.ping(v.x, v.y, { ms: 2600 }); sc.showLabel(v.x, v.y, v.name, 2800); });
        if (hintLevel === 1) h.at.forEach(function (v) { sc.showLabel(v.x, v.y, v.name, 2800); });   /* next to Pip: name only, no frame over Pip */
        ui.dialog.focus();
      });

      ui.dialog.onSend(function (payload) {
        if (busy || run.finished) { ui.dialog.setValue(payload.text); return; }   /* never lose a sentence: it stays in the box */
        busy = true; sentAny = true;
        if (!hintBox.hidden) { hintBox.hidden = true; sc.resize(); }
        ui.dialog.setBusy(true);
        ui.dialog.say('…', { speak: false, instant: true });
        MR.ai.guide({ text: payload.text, run: { x: run.x, y: run.y, facing: run.facing }, visible: MR.guide.visibleNames(mz, run), ctx: ctx })
          .then(function (p) {
            if (!live()) return;
            var base = { route_id: rid, maze_id: mz.id, input_mode: payload.input_mode, asr_text: payload.asr_text, sent_text: payload.text, source: p.source };
            if (p.failed) {
              ui.dialog.setBusy(false);
              MR.log.guideTurn(Object.assign(base, { parsed_actions: [], clarify_triggered: false, ai_failed: true, ai_reply: p.reply }));
              addHistory(payload.text, 'fail');
              ui.dialog.say(p.reply || T.sayAgain, { emotion: 'confused' });
              busy = false; return;
            }
            if (!p.actions.length) {
              ui.dialog.setBusy(false);
              MR.log.guideTurn(Object.assign(base, { parsed_actions: [], clarify_triggered: true, ai_reply: p.clarify }));
              addHistory(payload.text, 'ask');
              if (p.clarifyKind === 'dir') ctx = { expect: 'dir' };
              else if (!pending) ctx = {};
              sc.emote('?', 1600);
              ui.dialog.say(p.clarify, { emotion: 'confused' });
              busy = false; return;
            }
            var actions = p.actions;
            if (pending) {
              /* answer to "My left or your left?": it replaces the turn Pip asked about; the rest of the plan follows */
              if (actions[0].type === 'turn' && actions[0].whose) actions = MR.guide.mergeAnswer(pending, actions);
              pending = null;
            }
            var res = MR.guide.execute(mz, run, actions);
            var asked = res.status === 'clarify' || res.status === 'invalid';
            if (res.steps.some(function (st) { return st.type === 'move' || st.type === 'turn'; })) hintLevel = 0;   /* Pip moved: hints start again at 1 */
            MR.log.guideTurn(Object.assign(base, { parsed_actions: actions, clarify_triggered: asked, hit_wall: res.hit_wall, reached_exit: res.reached_exit,
              ai_reply: res.say || 'OK', note: res.note || '' }));
            addHistory(payload.text, res.status === 'exit' ? 'exit' : (res.status === 'wall' ? 'wall' : (asked ? 'ask' : 'ok')));
            ui.dialog.say('…', { speak: false, instant: true, emotion: 'neutral' });
            return animate(res.steps).then(function () {
              if (!live()) return;
              MR.state.saveRouteProgress(rid, run);
              /* the input stays off until Pip has said his note ("OK! Your left is my right now."): a sentence sent
               * in between would be thrown away */
              var after = res.note ? ui.dialog.say(res.note, { emotion: 'happy' }).then(function () { return MR.util.wait(MR.flags.fast ? 0 : 300); }) : Promise.resolve();
              return after.then(function () {
                if (!live()) return;
                ui.dialog.setBusy(false);
                ctx = {};
                if (res.status === 'wall') { ui.dialog.say(T.wall, { emotion: 'surprised' }); }
                else if (res.status === 'clarify') {
                  if (res.clarify.kind === 'whose') { pending = res.pending; ctx = { expect: 'whose', pendingDir: res.clarify.dir }; }
                  sc.emote('?', 1600);
                  ui.dialog.say(res.say, { emotion: 'confused' });
                } else if (res.status === 'invalid') { ui.dialog.say(res.say || T.guideUnclear, { emotion: 'confused' }); }
                else if (res.status === 'exit') { return finish(); }
                else { ui.dialog.say(OK_LINES[run.instructions % OK_LINES.length], { emotion: 'happy' }); }
                busy = false;
                ui.dialog.focus();
              });
            });
          });
      });

      function finish() {
        sc.burst(run.x, run.y, 22);
        sc.emote('heart', 2000);
        MR.audio.sfx('pickup');
        ui.dialog.setInputEnabled(false);
        ui.dialog.say(timed ? T.trainGoal : (city ? T.cityGoal : T.exit), { emotion: 'happy' });
        if (clock) {
          clock.running = false;
          MR.log.event('guide', 'train_caught', { route_id: rid, maze_id: mz.id, seconds_left: Math.round(clock.left), tries: clock.tries });
          MR.state.setTrainClock(rid, clock.left, clock.tries);
        }
        MR.state.finishRoute(rid, run);
        MR.log.lockStage('guide', rid);
        var more = !MR.state.allRoutesDone();
        return MR.util.wait(MR.flags.fast ? 0 : 1200).then(function () {
          var nextCity = more && MR.data.guideMazes[MR.data.routeIds[MR.state.get().guide.routeIndex]].standard.noGate;
          if (timed) {
            return ui.overlay.show({ title: 'Pip caught the train!', stars: 1, emotion: 'happy',
              text: 'Pip is on the train with “' + MR.data.BOOK_TITLE + '”. Good luck with the exam, Pip! You gave clear directions in a real place.',
              button: 'Next' });
          }
          if (city) {
            return ui.overlay.show({ title: 'Pip found the book!', stars: 1, emotion: 'happy', itemId: 'book',
              text: '“' + MR.data.BOOK_TITLE + '” is in Pip’s bag. But the train leaves soon! Help Pip get back to University Station in time.',
              button: more ? 'Hurry back!' : 'Next' });
          }
          return ui.overlay.show({ title: 'Pip is out!', stars: 1, emotion: 'happy',
            text: nextCity ? 'Pip is out of the maze! Now help Pip in a real place: University Station.' :
              (more ? 'Great directions! Now help Pip find the other way out.' : 'You found both ways out. Well done!'),
            button: more ? (nextCity ? 'Go to the station' : 'Next way out') : 'Next' });
        }).then(function () { if (live()) MR.next(); });
      }
    },
    unmount: function () { alive++; if (scene) scene.destroy(); scene = null; }     /* the clock's timer stops on its next tick (live() is false) */
  });
})(typeof window !== 'undefined' ? window : globalThis);
