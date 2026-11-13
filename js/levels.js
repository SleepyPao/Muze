/* Level select for testing (teachers, developers). Browser only; loaded after the screens, before main.js.
 *
 * Every level is a debug deeplink (js/main.js): the page reloads with ?debug=<screen>, so the pupil is seeded right
 * before that level, in VOLATILE memory storage. Nothing a pupil saved on this device is touched.
 *   - Teacher view: "Levels (testing)" button.
 *   - Any ?debug= page: "Levels" and "Skip ▶" buttons in the top bar ("Skip" = the level after this one).
 *   - ?levels=1 opens the picker on the start page.
 * The same game (seed), difficulty, fast mode and short train clock are kept from level to level.
 */
(function (root) {
  'use strict';
  var MR = root.MR, ui = MR.ui, el = ui.el;
  var levels = MR.levels = {};

  /** All levels in play order. q = the debug deeplink of the level. */
  levels.LIST = (function () {
    var out = [{ key: 'warmup', label: 'Warm-up', group: 'Lesson 1', q: { debug: 'warmup' } }];
    for (var i = 0; i < 4; i++) {
      out.push({ key: 'ask' + i, label: 'Ask ' + (i + 1), group: 'Lesson 1', q: { debug: 'ask', item: i } });
      out.push({ key: 'go' + i, label: 'Go ' + (i + 1), group: 'Lesson 1', q: { debug: 'go', item: i } });
    }
    out.push({ key: 'sessionbreak', label: 'End of lesson 1', group: 'Lesson 1', q: { debug: 'sessionbreak' } });
    MR.data.routeIds.forEach(function (rid, ri) {
      var city = MR.data.guideMazes[rid].standard.noGate;
      out.push({ key: 'guide' + ri, label: city ? MR.data.ROUTE_TITLES[rid] : 'Maze ' + (ri + 1), group: city ? 'Lesson 2: University Station' : 'Lesson 2: mazes',
        q: { debug: 'guide', route: ri } });
    });
    out.push({ key: 'review', label: 'Look back (review)', group: 'End', q: { debug: 'review' } });
    out.push({ key: 'teacher', label: 'Teacher view (example data)', group: 'End', q: { debug: 'teacher' } });
    return out;
  })();

  /** The level on screen now (null on the start page). */
  levels.currentKey = function () {
    var c = MR.screens.current(); if (!c) return null;
    var p = c.params || {};
    if (c.name === 'ask' || c.name === 'go') return c.name + (p.item != null ? p.item : (MR.state.get() ? MR.state.get().itemIndex : 0));
    if (c.name === 'guide') return 'guide' + (p.route != null ? p.route : (MR.state.get() ? MR.state.get().guide.routeIndex : 0));
    return c.name;
  };
  /** The level after the one on screen ("Skip"). The start page skips to the warm-up. */
  levels.next = function () {
    var k = levels.currentKey();
    if (!k || k === 'start') return levels.LIST[0];
    for (var i = 0; i < levels.LIST.length - 1; i++) if (levels.LIST[i].key === k) return levels.LIST[i + 1];
    return null;
  };

  /** Options for the next level: from the picker, else from this page (URL + the game on screen). */
  function currentOpts() {
    var q = new URLSearchParams(root.location.search), s = MR.state.get();
    var seed = MR.state.sessionSeed();
    if (seed == null && q.get('seed')) seed = q.get('seed');
    return {
      seed: seed,
      difficulty: s ? s.difficulty : (q.get('difficulty') === 'simple' ? 'simple' : 'standard'),
      fast: MR.flags.fast,
      train: q.get('train') || ''
    };
  }
  /** The URL of a level. opts: {seed, difficulty, fast, train} */
  levels.url = function (level, opts) {
    opts = opts || currentOpts();
    var p = new URLSearchParams();
    Object.keys(level.q).forEach(function (k) { p.set(k, String(level.q[k])); });
    if (opts.seed != null && opts.seed !== '' && level.key !== 'teacher') p.set('seed', String(opts.seed));
    if (opts.difficulty === 'simple') p.set('difficulty', 'simple');
    if (opts.fast) p.set('fast', '1');
    if (opts.train) p.set('train', String(opts.train));
    var q = new URLSearchParams(root.location.search);
    if (q.get('offline') === '1') p.set('offline', '1');
    return root.location.pathname + '?' + p.toString();
  };
  levels.open = function (level, opts) { root.location.href = levels.url(level, opts); };
  levels.skip = function () { var n = levels.next(); if (n) levels.open(n); };

  /* ------------------------------------------------------------------ the picker */
  var box = null;
  levels.close = function () { if (box && box.parentNode) box.parentNode.removeChild(box); box = null; };
  levels.show = function () {
    levels.close();
    var o = currentOpts();
    var diff = el('select', { class: 'mr-levels__select', id: 'mr-levels-diff' }, [
      el('option', { attrs: { value: 'standard' }, text: 'Standard' }), el('option', { attrs: { value: 'simple' }, text: 'Simple' })]);
    diff.value = o.difficulty;
    var fast = el('input', { attrs: { type: 'checkbox', id: 'mr-levels-fast' } }); fast.checked = !!o.fast;
    var same = el('input', { attrs: { type: 'checkbox', id: 'mr-levels-same' } }); same.checked = o.seed != null;
    var short = el('input', { attrs: { type: 'checkbox', id: 'mr-levels-train' } }); short.checked = !!o.train;
    function chosen() {
      return { seed: same.checked && o.seed != null ? o.seed : null, difficulty: diff.value, fast: fast.checked, train: short.checked ? (o.train || 20) : '' };
    }
    var here = levels.currentKey(), nxt = levels.next(), groups = {}, order = [];
    levels.LIST.forEach(function (lv) {
      if (!groups[lv.group]) { groups[lv.group] = []; order.push(lv.group); }
      var b = ui.button(lv.label, function () { levels.open(lv, chosen()); }, 'small');
      b.dataset.level = lv.key;
      if (lv.key === here) b.classList.add('is-here');
      groups[lv.group].push(b);
    });
    var skip = nxt ? ui.button('Skip to: ' + nxt.label + ' ▶', function () { levels.open(nxt, chosen()); }, 'primary') : null;
    if (skip) skip.id = 'mr-levels-skip';
    var close = ui.button('Close', levels.close, 'small');
    close.id = 'mr-levels-close';
    var label = function (input, text) { return el('label', { class: 'mr-levels__opt' }, [input, ' ' + text]); };
    box = el('div', { class: 'mr-levels', id: 'mr-levels', attrs: { role: 'dialog', 'aria-label': 'Level select' } }, [
      el('div', { class: 'mr-card mr-levels__card' }, [
        el('div', { class: 'mr-levels__head' }, [el('h3', { class: 'mr-card__title', text: 'Level select (testing)' }), close]),
        el('p', { class: 'mr-levels__note', text: 'Jumps straight to a level. Test games are not saved and do not touch pupils’ saved games.' }),
        skip,
        el('div', { class: 'mr-levels__opts' }, [
          el('label', { class: 'mr-levels__opt' }, ['Maze ', diff]),
          label(fast, 'Fast (no typing effect, no voice)'),
          o.seed != null ? label(same, 'Same game (seed ' + o.seed + ')') : null,
          label(short, 'Short train clock (20 s)')
        ]),
        el('div', { class: 'mr-levels__groups' }, order.map(function (g) {
          return el('div', { class: 'mr-levels__group' }, [el('h4', { class: 'mr-levels__gtitle', text: g }), el('div', { class: 'mr-levels__btns' }, groups[g])]);
        }))
      ])
    ]);
    box.addEventListener('click', function (e) { if (e.target === box) levels.close(); });
    root.document.body.appendChild(box);
    (skip || close).focus();
  };
  root.document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && box) levels.close(); });

  /* ------------------------------------------------------------------ top bar buttons (debug pages only) */
  levels.initTopbar = function () {
    if (!MR.flags.debug) return;
    var right = root.document.querySelector('.mr-topbar__right');
    var bLv = ui.button('Levels', levels.show, 'small'); bLv.id = 'mr-levels-open'; bLv.classList.add('mr-devbtn');
    var bSk = ui.button('Skip ▶', levels.skip, 'small'); bSk.id = 'mr-levels-skipbar'; bSk.classList.add('mr-devbtn', 'mr-devbtn--skip');
    bSk.title = 'Go to the next level';
    right.insertBefore(bSk, right.firstChild);
    right.insertBefore(bLv, bSk);
    function refresh() { var n = levels.next(); bSk.hidden = !n; if (n) bSk.title = 'Skip to: ' + n.label; }
    MR.on('screen:change', refresh);
    refresh();
  };
})(typeof window !== 'undefined' ? window : globalThis);
