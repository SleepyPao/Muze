/* Guide (spec 4.4): the pupil sees the whole maze, Pip and the exit, and tells Pip the way in English.
 * MR.ai.guide (or the offline rules) turns the words into a few allowed actions; MR.guide.execute (the game, not
 * the AI) checks and runs them. Pip asks when the words are not enough ("Left or right?", "My left or your left?",
 * "I can't see a tree. What can I see?"). A wall stops Pip ("There is a wall.") - never game over. */
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
      ui.topbar.setStage('Guide Pip · way out ' + (ri + 1) + ' of 2');

      var box = el('div', { class: 'mr-scene-box mr-guide__scene' });
      var list = el('ol', { class: 'mr-guide__list' });
      var empty = el('p', { class: 'mr-guide__empty', text: 'Your words will be here.' });
      var restart = ui.button('Start again', function () { restartRun(true); }, 'small');
      restart.id = 'mr-guide-restart';
      var hintBox = el('div', { class: 'mr-hintbox', hidden: true, attrs: { 'aria-live': 'polite' } });
      rootEl.appendChild(el('div', { class: 'mr-guide' }, [
        box,
        el('div', { class: 'mr-guide__side' }, [
          el('div', { class: 'mr-card mr-guide__task' }, [
            el('h3', { class: 'mr-card__title', text: 'Way out ' + (ri + 1) + ' of 2' }),
            el('p', { text: 'Tell Pip how to get to the gate.' }),
            el('p', { class: 'mr-guide__legend' }, [el('span', { class: 'mr-guide__arrow', text: '▲' }), ' shows where Pip is looking.'])
          ]),
          hintBox,
          el('div', { class: 'mr-card mr-guide__history' }, [el('h3', { class: 'mr-card__title', text: 'What I said' }), empty, list]),
          el('div', { class: 'mr-guide__tools' }, [restart])
        ])
      ]));

      scene = MR.render.createScene(box, mz, { facingArrow: true, showExit: true, label: 'The maze with the way out' });
      var sc = scene;
      var run, pending = null, ctx = {}, busy = false;

      function live() { return token === alive && sc === scene; }
      function restartRun(logIt) {
        run = MR.guide.newRun(mz);
        pending = null; ctx = {};
        sc.setPip(run.x, run.y, run.facing);
        sc.clearTrail();
        list.innerHTML = ''; empty.hidden = false;
        if (logIt) {
          MR.log.event('guide', 'restart', { route_id: rid, maze_id: mz.id });
          ui.dialog.say('OK, I am back at the start.', { emotion: 'neutral' });
          ui.dialog.focus();
        }
      }
      restartRun(false);

      function addHistory(text, kind) {
        empty.hidden = true;
        var mark = { ok: '✓', wall: '!', ask: '?', exit: '★', fail: '…' }[kind] || '•';
        list.appendChild(el('li', { class: 'mr-guide__item is-' + kind }, [el('span', { class: 'mr-guide__mark', text: mark }), el('span', { text: text })]));
        list.scrollTop = list.scrollHeight;
      }

      function animate(steps) {
        var p = Promise.resolve();
        steps.forEach(function (st) {
          p = p.then(function () {
            if (!live()) return;
            if (st.type === 'move') return sc.walk(st.path, { msPerTile: 170 });
            if (st.type === 'turn') return sc.turn(st.facing);
            if (st.type === 'bump') return sc.bump();
          });
        });
        return p;
      }

      ui.dialog.show({ input: true, hint: true, emotion: 'neutral', placeholder: 'Tell Pip where to go…' });
      ui.dialog.say(ri === 0 ? T.guideOpen : 'Now the other way out. Help me again!', { emotion: 'neutral' });
      ui.dialog.focus();

      ui.dialog.onHint(function () {
        var level = Math.min(2, (hintBox._level || 0) + 1);
        hintBox._level = level;
        var text = MR.data.guideHints[level];
        MR.log.hint({ stage: 'guide', route_id: rid, hint_level: level, text: text });
        hintBox.innerHTML = '';
        hintBox.appendChild(el('span', { class: 'mr-hintbox__tag', text: 'Hint' }));
        hintBox.appendChild(el('span', { class: 'mr-hintbox__text', text: text }));
        hintBox.hidden = false;
        ui.dialog.focus();
      });

      ui.dialog.onSend(function (payload) {
        if (busy || run.finished) return;
        busy = true;
        hintBox.hidden = true;
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
            MR.log.guideTurn(Object.assign(base, { parsed_actions: actions, clarify_triggered: asked, hit_wall: res.hit_wall, reached_exit: res.reached_exit,
              ai_reply: res.say || 'OK', note: res.note || '' }));
            addHistory(payload.text, res.status === 'exit' ? 'exit' : (res.status === 'wall' ? 'wall' : (asked ? 'ask' : 'ok')));
            ui.dialog.say('…', { speak: false, instant: true, emotion: 'neutral' });
            return animate(res.steps).then(function () {
              if (!live()) return;
              ui.dialog.setBusy(false);
              MR.state.saveRouteProgress(rid, run);
              var after = res.note ? ui.dialog.say(res.note, { emotion: 'happy' }).then(function () { return MR.util.wait(MR.flags.fast ? 0 : 300); }) : Promise.resolve();
              return after.then(function () {
                if (!live()) return;
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
        ui.dialog.say(T.exit, { emotion: 'happy' });
        MR.state.finishRoute(rid, run);
        MR.log.lockStage('guide', rid);
        var more = !MR.state.allRoutesDone();
        return MR.util.wait(MR.flags.fast ? 0 : 1200).then(function () {
          return ui.overlay.show({ title: 'Pip is out!', stars: 1, emotion: 'happy',
            text: more ? 'Great directions! Now help Pip find the other way out.' : 'You found both ways out. Well done!',
            button: more ? 'Next way out' : 'Next' });
        }).then(function () { if (live()) MR.next(); });
      }
    },
    unmount: function () { alive++; if (scene) scene.destroy(); scene = null; }
  });
})(typeof window !== 'undefined' ? window : globalThis);
