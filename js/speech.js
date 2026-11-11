/* Maze Rescue - browser speech: recognition (Web Speech API) and Pip's voice (speechSynthesis).
 * Feature-detected; everything is a harmless no-op when the browser has no support. No audio is stored or logged:
 * only the recognised TEXT goes into the input box, where the pupil confirms or edits it before sending.
 * NOTE (spec 7, open question): Chrome's recogniser sends audio to a Google service. See ARCHITECTURE.md. */
(function (root) {
  'use strict';
  var MR = root.MR = root.MR || {};
  var speech = MR.speech = {};
  var voice = null;
  var speakOn = true;

  function Rec() { return root.SpeechRecognition || root.webkitSpeechRecognition || null; }
  function cfg() { return root.MR_CONFIG || {}; }

  /** Can this browser listen? (false => hide / disable the mic button; typing always works) */
  speech.canListen = function () { return !!Rec() && cfg().speechInput !== false; };
  /** Can this browser speak? */
  speech.canSpeak = function () { return (!!root.MR_VOICE || !!(root.speechSynthesis && root.SpeechSynthesisUtterance)) && cfg().speechOutput !== false; };

  /* ---------------------------------------------------------------- listening
   * ONE recogniser object per page, reused for every Speak press (a new object per press is not needed, and some
   * browsers ask for the microphone again for a new object). Each press is a "session" with its own callbacks;
   * events that arrive for an old session (after Stop / abort) are ignored, so a late result can never land in the
   * box after the pupil pressed Send or left the screen. If the recogniser is still finishing the last session, the
   * new one starts as soon as it has ended (or with a fresh object after 0.8 s). If a stop does not end within
   * 1.5 s, the session is closed anyway and the next press uses a fresh object. */
  var rec = null;        /* the recogniser */
  var running = false;   /* rec.start() was called and onend has not come yet */
  var session = null;    /* the session the recogniser is working for */
  var queued = null;     /* a session waiting for the recogniser to end */
  var seq = 0;
  speech.isListening = function () { return !!(session && !session.ended) || !!queued; };

  function newRec() {
    var R = Rec(), r = new R();
    r.onresult = function (ev) {
      var s = session;
      if (r !== rec || !s || s.closed || s.ended) return;
      var text = '', isFinal = false;
      for (var i = 0; i < ev.results.length; i++) { text += ev.results[i][0].transcript; if (ev.results[i].isFinal) isFinal = true; }
      text = text.replace(/\s+/g, ' ').trim();
      if (isFinal) s.finalText = text;
      if (s.h.onResult) s.h.onResult(text, isFinal);
    };
    r.onerror = function (ev) {
      var s = session;
      if (r !== rec || !s || s.closed || s.ended) return;
      if (s.h.onError) s.h.onError((ev && ev.error) || 'error');
    };
    r.onend = function () {
      if (r !== rec) return;
      running = false;
      var s = session; session = null;
      if (s) finish(s);
      if (queued) { var q = queued; queued = null; clearTimeout(q.waitTimer); begin(q); }
    };
    return r;
  }
  function finish(s) {
    if (s.ended) return;
    s.ended = true;
    clearTimeout(s.stopTimer); clearTimeout(s.waitTimer);
    if (session === s) session = null;
    MR.emit('speech:listening', false);
    if (!s.closed && s.h.onEnd) s.h.onEnd(s.finalText);
  }
  function setup(r) {
    r.lang = cfg().speechLang || 'en-US';
    /* continuous: keep listening through short pauses (children think while they talk); the Speak button's 10 s
     * countdown (MR.ui) or Stop ends it, and so does a quiet moment after a finished phrase */
    r.interimResults = true; r.continuous = true; r.maxAlternatives = 1;
  }
  function begin(s) {
    if (s.closed || s.ended) return;
    try {
      if (!rec) rec = newRec();
      setup(rec);
      try { rec.start(); }
      catch (e) { rec = newRec(); setup(rec); rec.start(); }   /* still busy: use a fresh one once */
    } catch (e2) {
      rec = null; running = false; s.ended = true;
      if (s.h.onError) s.h.onError('start-failed');
      return;
    }
    running = true; session = s;
    MR.emit('speech:listening', true);
  }
  function dropRec() {
    if (rec) { try { rec.abort(); } catch (e) { /* ignore */ } }
    rec = null; running = false;
  }

  /**
   * Start listening for ONE utterance (the recogniser stops by itself after a pause).
   * @param {{onResult?:function(text:string, isFinal:boolean), onEnd?:function(finalText:string), onError?:function(code:string)}} h
   *   onEnd is called once when the session ends (also after stop()); not after abort().
   * @returns {{stop:function(), abort:function()}|null}  null when recognition is not available / could not start
   *   stop(): finish now and keep what was heard (onEnd gets the final text); abort(): cancel, no more callbacks.
   */
  speech.listen = function (h) {
    h = h || {};
    if (!Rec() || cfg().speechInput === false) { if (h.onError) h.onError('unsupported'); return null; }
    speech.cancelSpeak();
    var s = { id: ++seq, h: h, finalText: '', ended: false, closed: false, stopTimer: 0, waitTimer: 0 };
    if (queued) { queued.closed = true; finish(queued); queued = null; }
    if (running) {
      if (session) { session.closed = true; finish(session); }
      try { rec.abort(); } catch (e) { /* ignore */ }
      queued = s;
      s.waitTimer = setTimeout(function () { if (queued === s) { queued = null; dropRec(); begin(s); } }, 800);
    } else {
      begin(s);
      if (s.ended) return null;
    }
    return {
      stop: function () {
        if (s.ended) return;
        if (queued === s) { queued = null; finish(s); return; }
        if (session === s && running) {
          try { rec.stop(); } catch (e) { /* ignore */ }
          s.stopTimer = setTimeout(function () { if (!s.ended) { if (session === s) { session = null; dropRec(); } finish(s); } }, 1500);
        } else finish(s);
      },
      abort: function () {
        if (s.ended) return;
        s.closed = true;
        if (queued === s) queued = null;
        if (session === s && running) { try { rec.abort(); } catch (e) { /* ignore */ } }
        finish(s);
      }
    };
  };
  /** Stop the current session but keep what was heard. */
  speech.stopListening = function () {
    if (session && running) { try { rec.stop(); } catch (e) { /* ignore */ } }
  };
  /** Cancel listening (screen change, Send): no more results or callbacks for the current session. */
  speech.abortListening = function () {
    if (queued) { queued.closed = true; finish(queued); queued = null; }
    if (session) { session.closed = true; var s = session; if (running) { try { rec.abort(); } catch (e) { /* ignore */ } } finish(s); }
  };

  /* ---------------------------------------------------------------- Pip's voice
   * 1. Pre-recorded clips (js/voice-data.js, made OFFLINE with Piper TTS, female voice "kristin"): every fixed line.
   * 2. Lines the AI writes at run time: an ON-DEVICE system voice only (voice.localService === true), female if
   *    the device has one. Network voices (e.g. Chrome's "Google ..." voices) are never used.
   * 3. Nothing suitable: Pip stays silent (the text is always on screen). */
  var FEMALE = /samantha|karen|moira|tessa|victoria|allison|ava|susan|zira|serena|fiona|kate|nicky|joanna|salli|kendra|kimberly|jenny|aria|female|woman|girl/i;
  var MALE = /alex|daniel|fred|tom|oliver|arthur|aaron|gordon|rishi|david|mark|guy|male|man\b/i;
  function pickVoice() {
    if (voice !== null || !speech.canSpeak()) return voice || null;
    var list = (root.speechSynthesis.getVoices() || []).filter(function (v) { return v.localService && /^en/i.test(v.lang || ''); });
    if (!list.length) return null;                /* voices may not be loaded yet: try again next time */
    var want = (cfg().speechLang || 'en-US').toLowerCase();
    var score = function (v) {
      return (FEMALE.test(v.name) ? 4 : 0) - (MALE.test(v.name) ? 4 : 0) + ((v.lang || '').toLowerCase() === want ? 2 : 0) + (/premium|enhanced|natural/i.test(v.name) ? 1 : 0);
    };
    list.sort(function (a, b) { return score(b) - score(a); });
    voice = score(list[0]) > 0 ? list[0] : false;   /* no female local voice -> false = stay silent for these lines */
    return voice || null;
  }
  /** The pre-recorded clip for a line, or null. @returns {[string, number]|null}  [file, seconds] */
  speech.clip = function (text) {
    var t = root.MR_VOICE;
    return t ? (t[String(text || '').trim()] || null) : null;
  };
  /** About how long Pip needs to say this line (seconds). Used to pace the typewriter. */
  speech.duration = function (text) {
    var c = speech.clip(text);
    if (c) return c[1];
    return Math.max(0.8, String(text || '').length / 13);
  };
  var audioEl = null;
  speech.VOLUME = 0.9;
  /** Turn Pip's voice on / off (the top-bar mute button calls this too). */
  speech.setSpeakEnabled = function (on) { speakOn = !!on; if (!on) speech.cancelSpeak(); };
  /**
   * Say a line in Pip's voice. Stops whatever Pip was saying before. Resolves when finished (at once when there is
   * nothing to play), and never later than the clip length + 1 s, so the game can never hang on audio.
   * @param {string} text  @returns {Promise<void>}
   */
  speech.speak = function (text) {
    speech.cancelSpeak();
    return new Promise(function (resolve) {
      if (!speakOn || !text) return resolve();
      var done = false, finish = function () { if (!done) { done = true; if (MR.audio && MR.audio.duck) MR.audio.duck(false); resolve(); } };
      if (MR.audio && MR.audio.duck) MR.audio.duck(true);
      var c = speech.clip(text);
      if (c && root.Audio) {
        try {
          var a = audioEl = new root.Audio(c[0]);
          a.volume = speech.VOLUME;
          a.onended = finish; a.onerror = finish;
          setTimeout(finish, (c[1] + 1) * 1000);
          var p = a.play();
          if (p && p.catch) p.catch(finish);            /* autoplay blocked before the first click: just skip */
        } catch (e) { finish(); }
        return;
      }
      var v = pickVoice();
      if (!v) return finish();
      try {
        var u = new root.SpeechSynthesisUtterance(String(text).replace(/…/g, ' '));
        u.voice = v; u.lang = v.lang;
        u.rate = 0.92; u.pitch = 1.05; u.volume = speech.VOLUME;
        u.onend = finish; u.onerror = finish;
        setTimeout(finish, (speech.duration(text) + 2) * 1000);
        root.speechSynthesis.speak(u);
      } catch (e) { finish(); }
    });
  };
  speech.cancelSpeak = function () {
    if (audioEl) { try { audioEl.pause(); audioEl.onended = null; } catch (e) { /* ignore */ } audioEl = null; }
    try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  };
})(typeof window !== 'undefined' ? window : globalThis);
