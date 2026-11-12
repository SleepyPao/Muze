/* Maze Rescue - app shell: screen router, top bar, wooden dialog bar, "well done" overlay, toast, small DOM helpers.
 * Browser only. Requires the pure-logic files, render.js and audio.js. The markup lives in index.html. */
(function (root) {
  'use strict';
  var MR = root.MR;
  var doc = root.document;
  var ui = MR.ui = {};
  /** Runtime flags, set by main.js from the URL: fast (no typewriter / instant walking), debug (deeplink in use). */
  MR.flags = MR.flags || { fast: false, debug: false };

  function $(id) { return doc.getElementById(id); }

  /* ------------------------------------------------------------------ helpers */
  /** Create an element. props: {class, text, html, on:{event:fn}, attrs:{...}, dataset:{...}, ...direct properties}. */
  ui.el = function (tag, props, children) {
    var node = doc.createElement(tag), k;
    props = props || {};
    for (k in props) {
      var v = props[k];
      if (v == null) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'on') { for (var ev in v) node.addEventListener(ev, v[ev]); }
      else if (k === 'attrs') { for (var a in v) if (v[a] != null) node.setAttribute(a, v[a]); }
      else if (k === 'dataset') { for (var d in v) node.dataset[d] = v[d]; }
      else node[k] = v;
    }
    (Array.isArray(children) ? children : (children == null ? [] : [children])).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
    });
    return node;
  };
  /** A standard button. kind: 'primary' | 'ghost' | 'hint' | 'big' (space separated). */
  ui.button = function (label, onClick, kind) {
    var cls = 'mr-btn' + (kind ? kind.split(' ').map(function (k) { return ' mr-btn--' + k; }).join('') : '');
    return ui.el('button', { class: cls, type: 'button', text: label, on: { click: function (e) { MR.audio.sfx('click'); onClick(e); } } });
  };
  ui.toast = function (text, ms) {
    var t = $('mr-toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(ui.toast._timer);
    ui.toast._timer = setTimeout(function () { t.hidden = true; }, ms || 2500);
  };
  /** Save text as a file (Export JSON / CSV). */
  ui.download = function (filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = ui.el('a', { href: url, download: filename, style: 'display:none' });
    doc.body.appendChild(a); a.click();
    setTimeout(function () { doc.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  };
  /** Let the user choose a file; resolves to its text (or null if cancelled / unreadable). */
  ui.pickFile = function (accept) {
    return new Promise(function (resolve) {
      var input = ui.el('input', { type: 'file', accept: accept || '.json,application/json', style: 'display:none' });
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        if (!f) return resolve(null);
        var r = new FileReader();
        r.onload = function () { resolve(String(r.result)); };
        r.onerror = function () { resolve(null); };
        r.readAsText(f);
      });
      doc.body.appendChild(input); input.click();
      setTimeout(function () { if (input.parentNode) input.parentNode.removeChild(input); }, 60000);
    });
  };

  /* ------------------------------------------------------------------ router */
  var registry = {};
  var current = null;   /* {name, def, params} */
  MR.screens = {
    /** def: { mount(el, params), unmount?() }. mount receives the empty <main> element. */
    register: function (name, def) { registry[name] = def; },
    has: function (name) { return !!registry[name]; },
    names: function () { return Object.keys(registry); },
    current: function () { return current ? { name: current.name, params: current.params } : null; }
  };
  /** Show a screen. Unmounts the current one, resets the dialog bar and the overlay, then mounts `name`. */
  MR.go = function (name, params) {
    var def = registry[name];
    if (!def) { if (root.console) root.console.error('[MR] unknown screen "' + name + '"'); return; }
    params = params || {};
    if (current && current.def.unmount) {
      try { current.def.unmount(); } catch (e) { if (root.console) root.console.error('[MR] unmount failed', e); }
    }
    MR.speech.abortListening(); MR.speech.cancelSpeak();
    ui.dialog.reset();
    ui.overlay.hide();
    var el = $('mr-screen');
    el.innerHTML = '';
    el.className = 'mr-screen mr-screen--' + name;
    el.dataset.screen = name;
    $('mr-app').dataset.screen = name;
    ui.topbar.setStage('');
    current = { name: name, def: def, params: params };
    def.mount(el, params);
    ui.topbar.refresh();
    MR.emit('screen:change', { name: name, params: params });
  };
  /** Go to wherever the pupil should be now (MR.state.nextScreen()). Use this at the end of every stage. */
  MR.next = function () {
    var n = MR.state.nextScreen();
    MR.go(n.screen, n.params);
  };

  /* ------------------------------------------------------------------ top bar */
  ui.topbar = {
    /** Short label next to the logo, e.g. "Ask - thing 1 of 4". */
    setStage: function (text) { $('mr-stage').textContent = text || ''; },
    setVisible: function (on) { $('mr-topbar').hidden = !on; },
    /** Redraw inventory, stars, class number, Demo badge and mute button from the state. Called on every change. */
    refresh: function () {
      var s = MR.state.get();
      var inv = $('mr-inventory');
      /* this game's things (each game has its own four, in its own colours): rebuild the slots when they change */
      var sig = MR.data.items.map(function (it) { return it.id + ':' + (it.colour || ''); }).join(',');
      if (inv.dataset.sig !== sig) {
        inv.dataset.sig = sig;
        inv.innerHTML = '';
        MR.data.items.forEach(function (it) {
          var c = ui.el('canvas', { class: 'mr-slot__icon', width: 16, height: 16 });
          inv.appendChild(ui.el('span', { class: 'mr-slot', dataset: { item: it.id }, title: '?' }, c));
        });
      }
      Array.prototype.forEach.call(inv.children, function (slot) {
        var id = slot.dataset.item, has = !!s && s.inventory.indexOf(id) >= 0;
        if (slot._has !== has) {
          slot._has = has;
          slot.classList.toggle('is-filled', has);
          slot.title = has ? MR.data.getItem(id).name : '?';
          var c = slot.firstChild, ctx = c.getContext('2d');
          ctx.clearRect(0, 0, c.width, c.height);
          if (has) MR.render.drawItemIcon(c, id);
        }
      });
      $('mr-stars-n').textContent = s ? s.stars : 0;
      var chip = $('mr-classno');
      chip.hidden = !s; chip.textContent = s ? s.class_no : '';
      $('mr-demo').hidden = !MR.ai.isOffline();
      var muted = MR.audio.isMuted();
      $('mr-mute').setAttribute('aria-pressed', muted ? 'true' : 'false');
      $('mr-mute').classList.toggle('is-muted', muted);
      $('mr-mute-icon').textContent = muted ? '×' : '♪';
    },
    /** Screen position of an inventory slot (for the item-flies-to-the-bar effect). */
    slotRect: function (itemId) {
      var slot = $('mr-inventory').querySelector('[data-item="' + itemId + '"]');
      return slot ? slot.getBoundingClientRect() : null;
    }
  };

  /* ------------------------------------------------------------------ dialog bar */
  var dlg = { onSend: null, onHint: null, asr: '', usedMic: false, busy: false, inputOn: true, sayToken: 0, emotion: 'neutral',
    mic: null,      /* while listening: {token, handle, start, timer} */
    micSeq: 0 };    /* results from an older Speak press (token !== micSeq) are ignored */
  /** Seconds the pupil can speak after pressing Speak. A countdown ring shows them; at 0 listening stops. */
  ui.MIC_SECONDS = 10;
  /** Listening also stops this long after the last finished phrase, so a pupil who is done need not wait for 0. */
  ui.MIC_QUIET_MS = 2000;

  function setSpeechText(t) { $('mr-speech').textContent = t; }
  function updateControls() {
    var off = dlg.busy || !dlg.inputOn;
    $('mr-input').disabled = off; $('mr-send').disabled = off; $('mr-mic').disabled = off;
    $('mr-dialog').classList.toggle('is-busy', dlg.busy);
    if (off && dlg.mic) cancelMic();
  }

  /* ---------- microphone: Speak -> Stop + 10 s countdown ring next to the button */
  function micTimerEl() {
    var t = $('mr-mictimer');
    if (!t) {
      t = ui.el('span', { id: 'mr-mictimer', class: 'mr-mictimer', hidden: true, attrs: { role: 'timer', 'aria-label': 'Seconds left to speak' } },
        [ui.el('span', { class: 'mr-mictimer__n', text: String(ui.MIC_SECONDS) })]);
      var mic = $('mr-mic');
      mic.parentNode.insertBefore(t, mic.nextSibling);
    }
    return t;
  }
  function micUI(on) {
    var b = $('mr-mic');
    b.classList.toggle('is-listening', on);
    b.textContent = on ? 'Stop' : 'Speak';
    b.setAttribute('aria-label', on ? 'Stop speaking' : 'Speak');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    micTimerEl().hidden = !on;
    $('mr-dialog').classList.toggle('is-listening', on);
  }
  function drawTimer(msLeft) {
    var t = micTimerEl(), total = ui.MIC_SECONDS * 1000;
    var secs = Math.max(0, Math.ceil(msLeft / 1000));
    t.firstChild.textContent = String(secs);
    t.style.setProperty('--left', String(Math.max(0, Math.min(1, msLeft / total))));
    t.classList.toggle('is-low', secs <= 3);
  }
  /** Listening UI off (the session may still deliver its final text: the token stays valid). */
  function endMicUI() {
    if (dlg.mic) { clearInterval(dlg.mic.timer); dlg.mic = null; }
    micUI(false);
  }
  /** Stop and keep what was heard (Stop button, countdown at 0, quiet after a phrase). At 0 the ring shows "0" for a moment. */
  function stopMic(atZero) {
    var m = dlg.mic;
    if (!m) return;
    drawTimer(0);
    endMicUI();
    if (atZero) {
      var t = micTimerEl();
      t.hidden = false;
      setTimeout(function () { if (!dlg.mic) t.hidden = true; }, 700);
    }
    if (m.handle) m.handle.stop();
  }
  /** Cancel: Send, screen change, input turned off. Nothing heard later reaches the box. */
  function cancelMic() {
    var m = dlg.mic;
    dlg.micSeq++;
    endMicUI();
    if (m && m.handle) { if (m.handle.abort) m.handle.abort(); else m.handle.stop(); }
  }
  function startMic() {
    var input = $('mr-input');
    var token = ++dlg.micSeq;
    var mine = function () { return token === dlg.micSeq; };
    var m = dlg.mic = { token: token, handle: null, start: Date.now(), timer: 0, lastFinal: 0 };
    micUI(true);
    drawTimer(ui.MIC_SECONDS * 1000);
    m.timer = setInterval(function () {
      if (dlg.mic !== m) return clearInterval(m.timer);
      var now = Date.now(), left = ui.MIC_SECONDS * 1000 - (now - m.start);
      if (left <= 0) stopMic(true);
      else if (m.lastFinal && now - m.lastFinal >= ui.MIC_QUIET_MS) stopMic();
      else drawTimer(left);
    }, 100);
    var handle = MR.speech.listen({
      onResult: function (text, isFinal) {
        if (!mine()) return;
        input.value = text;
        if (isFinal) { dlg.asr = text; dlg.usedMic = true; m.lastFinal = Date.now(); } else m.lastFinal = 0;   /* still talking */
      },
      onEnd: function (finalText) {
        if (!mine()) return;
        if (dlg.mic === m) endMicUI();   /* the recogniser stopped by itself (a pause) */
        if (finalText) { dlg.asr = finalText; dlg.usedMic = true; input.value = finalText; }
        ui.dialog.focus();               /* the pupil checks / edits the text, then presses Send */
      },
      onError: function (code) {
        if (!mine()) return;
        if (dlg.mic === m) endMicUI();
        if (code === 'not-allowed' || code === 'service-not-allowed') ui.toast('The microphone is off. You can type.');
        else if (code !== 'no-speech' && code !== 'aborted') ui.toast('I can’t hear you. You can type.');
      }
    });
    if (dlg.mic === m) {
      if (handle) m.handle = handle; else endMicUI();
    }
  }

  ui.dialog = {
    /** Show the bar. opts: {input:true, hint:true, placeholder, emotion:'neutral', text:''}. input:false = Pip only talks. */
    show: function (opts) {
      opts = opts || {};
      $('mr-dialog').hidden = false;
      $('mr-form').hidden = opts.input === false;
      $('mr-hint').hidden = opts.hint === false;
      $('mr-mic').hidden = !MR.speech.canListen();
      if (opts.placeholder) $('mr-input').placeholder = opts.placeholder;
      ui.dialog.setEmotion(opts.emotion || dlg.emotion || 'neutral');
      if (opts.text != null) setSpeechText(opts.text);
      updateControls();
    },
    hide: function () { $('mr-dialog').hidden = true; cancelMic(); },
    /** Hide and forget everything (handlers, text, buttons). The router calls this on every screen change. */
    reset: function () {
      dlg.sayToken++; cancelMic();
      dlg.onSend = null; dlg.onHint = null; dlg.asr = ''; dlg.usedMic = false; dlg.busy = false; dlg.inputOn = true; dlg.emotion = 'neutral';
      $('mr-dialog').hidden = true; $('mr-form').hidden = false; $('mr-hint').hidden = false; $('mr-hint').disabled = false;
      $('mr-input').value = ''; $('mr-input').placeholder = 'Type in English…';
      setSpeechText('');
      ui.dialog.setActions(null);
      updateControls();
    },
    /**
     * Pip says a line: typewriter text + portrait emotion + (unless muted) read aloud.
     * opts: {emotion:'neutral'|'happy'|'confused'|'thinking'|'surprised', speak:true, instant:false}
     * @returns {Promise<void>} resolves when the text is shown and the voice has finished (a newer say() cuts an older one).
     */
    say: function (text, opts) {
      opts = opts || {};
      text = String(text == null ? '' : text);
      var token = ++dlg.sayToken;
      if (opts.emotion) ui.dialog.setEmotion(opts.emotion);
      var voiced = opts.speak !== false && !MR.audio.isMuted() && !MR.flags.fast;
      var voiceDone = voiced ? MR.speech.speak(text) : Promise.resolve();
      if (opts.speak !== false && !voiced) MR.speech.cancelSpeak();
      /* the text types out over ~85 % of the time Pip needs to say it, so words and voice stay together */
      var typed = new Promise(function (resolve) {
        if (opts.instant || MR.flags.fast || !text) { setSpeechText(text); return resolve(); }
        var total = voiced ? Math.min(6000, MR.speech.duration(text) * 850) : text.length * 14;
        var step = Math.max(16, Math.min(60, total / Math.max(1, text.length)));
        var start = Date.now(), i = 0;
        (function tick() {
          if (token !== dlg.sayToken) return resolve();
          var n = Math.min(text.length, Math.max(i + 1, Math.round((Date.now() - start) / step)));
          if (Math.floor(n / 6) > Math.floor(i / 6) && !voiced) MR.audio.sfx('talk');
          i = n;
          setSpeechText(text.slice(0, i));
          if (i >= text.length) return resolve();
          setTimeout(tick, step);
        })();
      });
      /* resolves when the line is fully shown AND Pip has finished saying it (or a newer line replaced it) */
      return Promise.all([typed, voiceDone]).then(function () {});
    },
    /** True while a say() is still the newest line. */
    sayToken: function () { return dlg.sayToken; },
    /** Change Pip's portrait: 'neutral' | 'happy' | 'confused' | 'thinking' | 'surprised'. */
    setEmotion: function (emotion) {
      dlg.emotion = emotion;
      $('mr-dialog').dataset.emotion = emotion;
      MR.render.drawPortrait($('mr-portrait'), emotion);
    },
    /** fn({text, input_mode:'text'|'speech', asr_text}) is called when the pupil sends a non-empty sentence. */
    onSend: function (fn) { dlg.onSend = fn; },
    /** fn() is called when the pupil clicks Hint. */
    onHint: function (fn) { dlg.onHint = fn; },
    /** Waiting for the AI: input off, portrait "thinking". setBusy(false) turns the input back on (emotion is yours to set). */
    setBusy: function (on) {
      dlg.busy = !!on;
      if (on) ui.dialog.setEmotion('thinking');
      updateControls();
      if (!on) ui.dialog.focus();
    },
    setInputEnabled: function (on) { dlg.inputOn = !!on; updateControls(); },
    setHintEnabled: function (on) { $('mr-hint').disabled = !on; },
    setHintVisible: function (on) { $('mr-hint').hidden = !on; },
    setPlaceholder: function (s) { $('mr-input').placeholder = s; },
    focus: function () { var i = $('mr-input'); if (!i.disabled && !$('mr-form').hidden && !MR.flags.debugNoFocus) { try { i.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } },
    clear: function () { $('mr-input').value = ''; dlg.asr = ''; dlg.usedMic = false; },
    getValue: function () { return $('mr-input').value; },
    setValue: function (s) { $('mr-input').value = s; },
    /** True while the mic is listening (the countdown is running). */
    isListening: function () { return !!dlg.mic; },
    /** Stop listening and keep the words in the box (same as pressing Stop). */
    stopListening: function () { stopMic(); },
    /** Seconds left on the mic countdown, or null when not listening (tests / debug). */
    micSecondsLeft: function () { return dlg.mic ? Math.max(0, Math.ceil((ui.MIC_SECONDS * 1000 - (Date.now() - dlg.mic.start)) / 1000)) : null; },
    /** Replace the input row by buttons, e.g. setActions([{label:'Let’s go!', primary:true, onClick:fn}]). null = input row back. */
    setActions: function (list) {
      var box = $('mr-actions');
      box.innerHTML = '';
      if (!list || !list.length) { box.hidden = true; return; }
      list.forEach(function (a) { box.appendChild(ui.button(a.label, a.onClick, a.primary ? 'primary big' : 'big')); });
      box.hidden = false;
      $('mr-form').hidden = true;
    },
    /** Programmatic send (used by tests / debug): same path as typing + Send. */
    submit: function (text) { if (text != null) $('mr-input').value = text; send(); }
  };

  function send() {
    if (dlg.busy || !dlg.inputOn) return;
    var input = $('mr-input'), text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) { ui.dialog.focus(); return; }
    cancelMic();
    var payload = { text: text, input_mode: dlg.usedMic && dlg.asr ? 'speech' : 'text', asr_text: dlg.usedMic ? dlg.asr : '' };
    ui.dialog.clear();
    MR.audio.sfx('click');
    if (dlg.onSend) dlg.onSend(payload);
  }
  function toggleMic() {
    if (dlg.mic) { stopMic(); return; }
    startMic();
  }

  /* ------------------------------------------------------------------ overlay */
  var overlayResolve = null;
  ui.overlay = {
    /**
     * "Well done / next" card between items and routes.
     * opts: {title, text, button:'Next', emotion:'happy', itemId (shows its icon), stars (number of stars to draw), sfx:'fanfare'}
     * @returns {Promise<void>} resolves when the pupil clicks the button.
     */
    show: function (opts) {
      opts = opts || {};
      ui.overlay.hide();
      $('mr-overlay-title').textContent = opts.title || 'Well done!';
      $('mr-overlay-text').textContent = opts.text || '';
      $('mr-overlay-btn').textContent = opts.button || 'Next';
      MR.render.drawPortrait($('mr-overlay-pip'), opts.emotion || 'happy');
      var icon = $('mr-overlay-icon');
      icon.hidden = !opts.itemId;
      if (opts.itemId) { icon.getContext('2d').clearRect(0, 0, icon.width, icon.height); MR.render.drawItemIcon(icon, opts.itemId); }
      var stars = $('mr-overlay-stars'); stars.innerHTML = '';
      for (var i = 0; i < (opts.stars || 0); i++) stars.appendChild(ui.el('span', { class: 'mr-overlay__star', text: '★', style: 'animation-delay:' + (i * 120) + 'ms' }));
      $('mr-overlay').hidden = false;
      if (opts.sfx !== false) MR.audio.sfx(opts.sfx || 'fanfare');
      return new Promise(function (resolve) { overlayResolve = resolve; });
    },
    hide: function () { $('mr-overlay').hidden = true; overlayResolve = null; },
    isOpen: function () { return !$('mr-overlay').hidden; }
  };

  /* ------------------------------------------------------------------ wiring */
  ui.init = function () {
    $('mr-form').addEventListener('submit', function (e) { e.preventDefault(); send(); });
    $('mr-input').addEventListener('input', function () { if (!$('mr-input').value) { dlg.asr = ''; dlg.usedMic = false; } });
    $('mr-mic').addEventListener('click', toggleMic);
    micTimerEl();
    $('mr-hint').addEventListener('click', function () { MR.audio.sfx('click'); if (dlg.onHint && !dlg.busy) dlg.onHint(); });
    $('mr-overlay-btn').addEventListener('click', function () {
      var r = overlayResolve; MR.audio.sfx('click'); ui.overlay.hide(); if (r) r();
    });
    $('mr-mute').addEventListener('click', function () { MR.audio.toggleMute(); });
    /* phones: when the on-screen keyboard opens, the app shrinks to the part of the screen that is still visible,
     * so the input and Pip's words stay in view (iOS does not resize the page by itself) */
    var vv = root.visualViewport;
    var fitViewport = function () {
      var h = vv ? vv.height : root.innerHeight;
      doc.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
      if (vv && vv.offsetTop) root.scrollTo(0, 0);
      MR.emit('viewport:resize');
    };
    if (vv) { vv.addEventListener('resize', fitViewport); vv.addEventListener('scroll', fitViewport); }
    root.addEventListener('orientationchange', function () { setTimeout(fitViewport, 250); });
    root.addEventListener('resize', fitViewport);
    fitViewport();
    /* browsers only allow sound after a user gesture */
    var unlock = function () { MR.audio.unlock(); doc.removeEventListener('pointerdown', unlock, true); };
    doc.addEventListener('pointerdown', unlock, true);
    MR.on('state:change', ui.topbar.refresh);
    MR.on('data:session', ui.topbar.refresh);     /* another game = other things: the slots are rebuilt (see refresh) */
    MR.on('ai:mode', ui.topbar.refresh);
    MR.on('audio:mute', function (muted) { MR.speech.setSpeakEnabled(!muted); ui.topbar.refresh(); });
    MR.speech.setSpeakEnabled(!MR.audio.isMuted());
    ui.dialog.reset();
    ui.topbar.refresh();
  };
})(typeof window !== 'undefined' ? window : globalThis);
