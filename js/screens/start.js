/* Start: one class number (no name), maze level, short story with Pip. Resume if this class number has a saved game. */
(function (root) {
  'use strict';
  var MR = root.MR, ui = MR.ui, el = ui.el;
  var scene = null;

  /* a little garden for the title picture */
  var TITLE_MAP = MR.maze.prepare({
    id: 'title',
    tiles: ['###########', '#.........#', '#.###.###.#', '#.........#', '###########'],
    landmarks: [{ type: 'tree', x: 3, y: 2 }, { type: 'fountain', x: 7, y: 2 }, { type: 'windmill', x: 9, y: 0 }],
    start: { x: 5, y: 3, facing: 'S' }
  });

  function storyThenGo() {
    var lines = MR.data.text.story, i = 0;
    ui.dialog.show({ input: false, hint: false, emotion: 'happy' });
    function show() {
      var last = i === lines.length - 1;
      ui.dialog.say(lines[i], { emotion: i === 1 ? 'surprised' : (last ? 'happy' : 'neutral') });
      ui.dialog.setActions([{ label: last ? 'Let’s start!' : 'Next', primary: true, onClick: function () {
        if (last) { MR.state.markStorySeen(); MR.next(); } else { i++; show(); }
      } }]);
    }
    show();
  }

  MR.screens.register('start', {
    mount: function (root_) {
      ui.topbar.setStage('');
      var input = el('input', { class: 'mr-input mr-start__class', id: 'mr-classno-input', type: 'text', maxLength: 10,
        placeholder: 'e.g. 5A-12', attrs: { 'aria-label': 'Class number', autocomplete: 'off', autocapitalize: 'characters' } });
      var diff = 'standard';
      var bStd = ui.button('Standard', function () { setDiff('standard'); }, 'small');
      var bSim = ui.button('Simple', function () { setDiff('simple'); }, 'small');
      bStd.id = 'mr-diff-standard'; bSim.id = 'mr-diff-simple';
      function setDiff(d) { diff = d; bStd.classList.toggle('is-on', d === 'standard'); bSim.classList.toggle('is-on', d === 'simple'); }
      setDiff('standard');

      var msg = el('p', { class: 'mr-start__msg', attrs: { 'aria-live': 'polite' } });
      var startBtn = ui.button('Start', function () { begin(false); }, 'primary big');
      startBtn.id = 'mr-start-btn';
      var againBtn = ui.button('Start again', function () { begin(true); }, 'big');
      againBtn.id = 'mr-start-again'; againBtn.hidden = true;

      function check() {
        var v = input.value, ok = MR.util.validClassNo(v), saved = ok && MR.state.hasSaved(v);
        startBtn.textContent = saved ? 'Go on' : 'Start';
        againBtn.hidden = !saved;
        msg.textContent = saved ? 'Welcome back! You can go on.' : '';
        return ok;
      }
      input.addEventListener('input', check);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); begin(false); } });

      function begin(fresh) {
        if (!check()) { msg.textContent = 'Please type your class number, like 5A-12.'; input.focus(); input.classList.add('is-wrong'); setTimeout(function () { input.classList.remove('is-wrong'); }, 500); return; }
        var r = MR.state.begin(input.value, diff, { fresh: fresh });
        if (r.resumed && r.session.storySeen) { MR.next(); return; }
        form.hidden = true; foot.hidden = true;
        storyThenGo();
      }

      var picture = el('div', { class: 'mr-start__picture mr-scene-box' });
      var form = el('div', { class: 'mr-card mr-start__form' }, [
        el('label', { class: 'mr-start__label', text: 'Your class number', attrs: { for: 'mr-classno-input' } }),
        input,
        el('div', { class: 'mr-start__diff' }, [el('span', { class: 'mr-start__small', text: 'Maze:' }), bStd, bSim]),
        msg,
        el('div', { class: 'mr-row mr-start__btns' }, [againBtn, startBtn])
      ]);
      var teacher = ui.button('Teacher', function () { MR.go('teacher'); }, 'ghost');
      teacher.id = 'mr-teacher-link';
      var foot = el('div', { class: 'mr-start__foot' }, teacher);
      root_.appendChild(el('div', { class: 'mr-start' }, [
        el('h1', { class: 'mr-h1 mr-start__title', text: 'Maze Rescue' }),
        el('p', { class: 'mr-start__sub', text: 'Help Pip find four things and get out of the maze!' }),
        picture,
        form,
        foot
      ]));

      scene = MR.render.createScene(picture, TITLE_MAP, { maxScale: 4, showExit: false, label: 'Pip in the garden' });
      scene.emote('heart', 2500);
      /* Pip takes a little walk on the title screen */
      var loop = [{ x: 6, y: 3 }, { x: 7, y: 3 }, { x: 8, y: 3 }, { x: 9, y: 3 }, { x: 9, y: 2 }, { x: 9, y: 1 }, { x: 8, y: 1 }, { x: 7, y: 1 }, { x: 6, y: 1 }, { x: 5, y: 1 },
        { x: 4, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }];
      var sc = scene;
      (function walkLoop() {
        if (scene !== sc || MR.flags.fast) return;
        sc.walk(loop, { msPerTile: 320, trail: false }).then(function () { return sc.turn('S'); }).then(function () { setTimeout(walkLoop, 1500); });
      })();

      var cur = MR.state.get();
      if (cur && cur.class_no) { input.value = cur.class_no; check(); }
      if (!MR.flags.debugNoFocus) setTimeout(function () { try { input.focus(); } catch (e) { /* ignore */ } }, 50);
    },
    unmount: function () { if (scene) scene.destroy(); scene = null; }
  });
})(typeof window !== 'undefined' ? window : globalThis);
