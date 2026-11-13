/* Maze Rescue - map legend: "What Pip can see". Browser only. Requires data.js (names), ui.js, render.js.
 *
 *   var card = MR.legend.create(map, scene, opts)   -> HTMLElement (a .mr-card), put it anywhere (Guide side panel, Go ...)
 *     opts: { title:'What Pip can see', compact:false, onPick:function(type) }
 *   MR.legend.types(map, {showExit})                -> ['fountain', 'tree', ..., 'exit'] landmark types on this map
 *   MR.legend.name(type)                            -> 'big tree', 'way out', ... (the words the pupil can use)
 *   MR.legend.show(scene, map, type, {ms})          every landmark of this type blinks on the map and shows its name
 *
 * One entry per landmark type on the map (and the gate): its pixel picture + its name. Tapping an entry makes the
 * landmark blink on the map with a name label. Tapping a landmark on the map shows its name too (create() sets
 * scene.onLandmarkClick). Nothing is logged. */
(function (root) {
  'use strict';
  var MR = root.MR;
  var legend = MR.legend = {};

  /** The one name of a landmark (js/data.js): the same words Pip and the hints use. */
  legend.name = function (type) { return MR.data.landmarkName(type); };
  /** Landmark types on the map, in a fixed order (closed vocabulary order), the gate last. */
  legend.types = function (map, o) {
    o = o || {};
    var have = {};
    (map.landmarks || []).forEach(function (lm) { have[lm.type] = true; });
    var order = (MR.data.landmarkIds || []).concat(Object.keys(have).filter(function (t) { return (MR.data.landmarkIds || []).indexOf(t) < 0; }));
    var out = order.filter(function (t) { return have[t]; });
    if (map.exit && o.showExit !== false && !map.noGate) out.push('exit');
    return out;
  };
  function spotsOf(map, type) {
    if (type === 'exit') return map.exit ? [{ x: map.exit.x, y: map.exit.y }] : [];
    return (map.landmarks || []).filter(function (lm) { return lm.type === type; });
  }
  legend.show = function (scene, map, type, o) {
    o = o || {};
    if (!scene) return;
    var ms = o.ms || 2600;
    spotsOf(map, type).forEach(function (p) {
      scene.ping(p.x, p.y, { ms: ms });
      scene.showLabel(p.x, p.y, legend.name(type), ms + 200);
    });
  };

  legend.create = function (map, scene, opts) {
    opts = opts || {};
    var el = MR.ui.el;
    var showExit = opts.showExit !== false;
    var list = el('div', { class: 'mr-legend__list', attrs: { role: 'list' } });
    var items = {};
    var timer = 0;
    function mark(type) {
      Object.keys(items).forEach(function (t) { items[t].classList.toggle('is-on', t === type); });
      clearTimeout(timer);
      timer = setTimeout(function () { Object.keys(items).forEach(function (t) { items[t].classList.remove('is-on'); }); }, 2600);
    }
    legend.types(map, { showExit: showExit }).forEach(function (type) {
      var icon = el('canvas', { class: 'mr-legend__icon', width: 28, height: 28, attrs: { 'aria-hidden': 'true' } });
      MR.render.drawLandmarkIcon(icon, type);
      var name = legend.name(type);
      var b = el('button', {
        class: 'mr-legend__item', type: 'button', dataset: { type: type },
        attrs: { role: 'listitem', 'aria-label': 'Show the ' + name + ' on the map' },
        on: { click: function () {
          if (MR.audio) MR.audio.sfx('click');
          legend.show(scene, map, type);
          mark(type);
          if (opts.onPick) opts.onPick(type);
        } }
      }, [icon, el('span', { class: 'mr-legend__name', text: name })]);
      items[type] = b;
      list.appendChild(b);
    });
    if (scene && scene.onLandmarkClick) {
      scene.onLandmarkClick(function (lm) {
        scene.ping(lm.x, lm.y, { ms: 1400 });
        scene.showLabel(lm.x, lm.y, legend.name(lm.type), 2400);
        mark(lm.type);
      });
    }
    var card = el('div', { class: 'mr-card mr-legend' + (opts.compact ? ' mr-legend--compact' : '') }, [
      el('h3', { class: 'mr-card__title mr-legend__title' }, [opts.title || 'What Pip can see', el('span', { class: 'mr-legend__tip', text: 'Tap one!' })]),
      list
    ]);
    return card;
  };
})(typeof window !== 'undefined' ? window : globalThis);
