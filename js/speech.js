/* Maze Rescue - browser speech: recognition (Web Speech API) and Pip's voice (speechSynthesis).
 * Feature-detected; everything is a harmless no-op when the browser has no support. No audio is stored or logged:
 * only the recognised TEXT goes into the input box, where the pupil confirms or edits it before sending.
 * NOTE (spec 7, open question): Chrome's recogniser sends audio to a Google service. See ARCHITECTURE.md. */
(function (root) {
  'use strict';
  var MR = root.MR = root.MR || {};
  var speech = MR.speech = {};
  var active = null;      /* current recognition session */
  var voice = null;
  var speakOn = true;

  function Rec() { return root.SpeechRecognition || root.webkitSpeechRecognition || null; }
  function cfg() { return root.MR_CONFIG || {}; }

  /** Can this browser listen? (false => hide / disable the mic button; typing always works) */
  speech.canListen = function () { return !!Rec() && cfg().speechInput !== false; };
  /** Can this browser speak? */
  speech.canSpeak = function () { return (!!root.MR_VOICE || !!(root.speechSynthesis && root.SpeechSynthesisUtterance)) && cfg().speechOutput !== false; };
  speech.isListening = function () { return !!active; };

  /**
   * Start listening for ONE utterance.
   * @param {{onResult?:function(text:string, isFinal:boolean), onEnd?:function(finalText:string), onError?:function(code:string)}} h
   * @returns {{stop:function()}|null}  null when recognition is not available
   */
  speech.listen = function (h) {
    h = h || {};
    var R = Rec();
    if (!R || cfg().speechInput === false) { if (h.onError) h.onError('unsupported'); return null; }
    speech.stopListening();
    speech.cancelSpeak();
    var rec, finalText = '', ended = false;
    try { rec = new R(); } catch (e) { if (h.onError) h.onError('unsupported'); return null; }
    rec.lang = cfg().speechLang || 'en-US';
    rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onresult = function (ev) {
      var text = '', isFinal = false;
      for (var i = 0; i < ev.results.length; i++) { text += ev.results[i][0].transcript; if (ev.results[i].isFinal) isFinal = true; }
      text = text.replace(/\s+/g, ' ').trim();
      if (isFinal) finalText = text;
      if (h.onResult) h.onResult(text, isFinal);
    };
    rec.onerror = function (ev) { if (h.onError) h.onError((ev && ev.error) || 'error'); };
    rec.onend = function () {
      if (ended) return; ended = true;
      if (active && active.rec === rec) active = null;
      MR.emit('speech:listening', false);
      if (h.onEnd) h.onEnd(finalText);
    };
    try { rec.start(); } catch (e) { if (h.onError) h.onError('start-failed'); return null; }
    active = { rec: rec };
    MR.emit('speech:listening', true);
    return { stop: function () { try { rec.stop(); } catch (e) { /* ignore */ } } };
  };
  speech.stopListening = function () {
    if (active) { try { active.rec.stop(); } catch (e) { /* ignore */ } }
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
