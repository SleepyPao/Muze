/* End of lesson 1: all four things found. The game is saved; lesson 2 (Guide) starts from here next time. */
(function (root) {
  'use strict';
  var MR = root.MR, ui = MR.ui, el = ui.el;
  MR.screens.register('sessionbreak', {
    mount: function (rootEl) {
      ui.topbar.setStage('End of lesson 1');
      var s = MR.state.get();
      var pip = el('canvas', { class: 'mr-break__pip', width: 32, height: 32 });
      MR.render.drawPortrait(pip, 'happy');
      var items = el('div', { class: 'mr-break__items' });
      MR.data.items.forEach(function (it) {
        var c = el('canvas', { width: 16, height: 16 });
        MR.render.drawItemIcon(c, it.id);
        items.appendChild(el('div', { class: 'mr-break__item' }, [c, el('span', { text: it.noun })]));
      });
      var goOn = ui.button('Go on to lesson 2', function () { MR.state.markBreakSeen(); MR.next(); }, 'primary big');
      goOn.id = 'mr-break-next';
      var stop = ui.button('Stop for today', function () { MR.state.signOut(); MR.go('start'); }, 'big');
      stop.id = 'mr-break-stop';
      rootEl.appendChild(el('div', { class: 'mr-break' }, [
        el('div', { class: 'mr-card mr-break__card' }, [
          pip,
          el('h2', { class: 'mr-h2', text: 'End of lesson 1' }),
          el('p', { class: 'mr-break__text', text: 'You found all four things! Pip is very happy.' }),
          items,
          el('p', { class: 'mr-break__stars', text: '★ ' + (s ? s.stars : 0) + ' stars' }),
          el('p', { class: 'mr-break__small', text: 'Your game is saved. Next time, type the same class number.' }),
          el('p', { class: 'mr-break__text', text: 'In lesson 2 you help Pip get out of the maze. Then you help Pip in a real place: University Station.' }),
          el('div', { class: 'mr-row mr-break__btns' }, [stop, goOn])
        ])
      ]));
      MR.audio.sfx('fanfare');
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
