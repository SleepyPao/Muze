/* Maze Rescue - sound: synthesised with WebAudio (no sound files). Browser only.
 *   MR.audio.sfx(name)   'click' | 'talk' | 'step' | 'turn' | 'pickup' | 'fanfare' | 'right' | 'wrong' | 'bump' | 'unlock' | 'star'
 *   MR.audio.music(on)   light chiptune loop (starts only after a user gesture)
 *   MR.audio.unlock()    call from a user gesture (ui.js does this on the first pointerdown)
 *   MR.audio.isMuted() / setMuted(bool) / toggleMute()   one-click mute, remembered on this device
 * All sounds are original (see docs/CREDITS.md). */
(function (root) {
  'use strict';
  var MR = root.MR;
  var audio = MR.audio = {};
  var ctx = null, master = null, musicGain = null, musicTimer = 0, musicOn = false, musicStep = 0;
  var muted = !!(MR.state && MR.state.prefs && MR.state.prefs().muted);
  var lastStep = 0;

  function ac() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.16; musicGain.connect(master);
    } catch (e) { ctx = null; }
    return ctx;
  }
  function tone(freq, start, dur, type, vol, dest, slideTo) {
    var c = ac(); if (!c) return;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, start);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(dest || master);
    o.start(start); o.stop(start + dur + 0.02);
  }
  function noise(start, dur, vol) {
    var c = ac(); if (!c) return;
    var n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    g.gain.value = vol || 0.15;
    s.buffer = buf; s.connect(f); f.connect(g); g.connect(master); s.start(start);
  }
  var N = { C4: 261.6, D4: 293.7, E4: 329.6, F4: 349.2, G4: 392, A4: 440, B4: 493.9, C5: 523.3, D5: 587.3, E5: 659.3, G5: 784, A5: 880, C6: 1046.5,
    C3: 130.8, F3: 174.6, G3: 196, A3: 220 };

  audio.sfx = function (name) {
    if (muted) return;
    var c = ac(); if (!c || c.state !== 'running') return;
    var t = c.currentTime;
    switch (name) {
      case 'click': tone(880, t, 0.05, 'square', 0.06); break;
      case 'talk': tone(520 + Math.random() * 160, t, 0.04, 'triangle', 0.05); break;
      case 'step':
        if (t - lastStep < 0.09) return; lastStep = t;
        noise(t, 0.05, 0.08); break;
      case 'turn': tone(330, t, 0.06, 'triangle', 0.07, null, 400); break;
      case 'unlock': tone(N.E5, t, 0.08, 'square', 0.08); tone(N.A5, t + 0.08, 0.14, 'square', 0.08); break;
      case 'right': tone(N.C5, t, 0.08, 'square', 0.08); tone(N.E5, t + 0.08, 0.08, 'square', 0.08); tone(N.G5, t + 0.16, 0.16, 'square', 0.08); break;
      case 'wrong': tone(N.E4, t, 0.12, 'triangle', 0.12); tone(N.C4, t + 0.12, 0.2, 'triangle', 0.12); break;
      case 'bump': tone(160, t, 0.15, 'triangle', 0.25, null, 90); noise(t, 0.08, 0.12); break;
      case 'pickup':
        [N.C5, N.E5, N.G5, N.C6].forEach(function (f, i) { tone(f, t + i * 0.07, 0.12, 'square', 0.08); }); break;
      case 'star': tone(N.A5, t, 0.06, 'square', 0.06); tone(N.C6, t + 0.06, 0.12, 'square', 0.06); break;
      case 'fanfare':
        [[N.C5, 0, 0.12], [N.C5, 0.12, 0.12], [N.C5, 0.24, 0.12], [N.G5, 0.36, 0.3], [N.E5, 0.66, 0.12], [N.G5, 0.78, 0.45]].forEach(function (n) {
          tone(n[0], t + n[1], n[2], 'square', 0.08); tone(n[0] / 2, t + n[1], n[2], 'triangle', 0.08);
        });
        break;
      default: break;
    }
  };

  /* a short, cheerful 2-bar loop (melody + bass), original */
  var MELODY = ['E5', 0, 'G5', 'E5', 'D5', 0, 'C5', 'D5', 'E5', 'E5', 'G5', 0, 'A5', 'G5', 'E5', 0,
    'C5', 0, 'D5', 'E5', 'D5', 0, 'C5', 'A4', 'G4', 'A4', 'C5', 0, 'D5', 0, 'C5', 0];
  var BASS = ['C3', 'C3', 'G3', 'G3', 'A3', 'A3', 'F3', 'G3'];
  function scheduleMusic() {
    var c = ac(); if (!c || !musicOn) return;
    var t = c.currentTime + 0.05, beat = 0.18;
    for (var i = 0; i < 8; i++) {
      var s = (musicStep + i) % MELODY.length;
      var m = MELODY[s];
      if (m) tone(N[m], t + i * beat, beat * 0.9, 'square', 0.12, musicGain);
      if (s % 4 === 0) tone(N[BASS[(s / 4) % BASS.length]], t + i * beat, beat * 3.6, 'triangle', 0.22, musicGain);
    }
    musicStep = (musicStep + 8) % MELODY.length;
    musicTimer = root.setTimeout(scheduleMusic, beat * 8 * 1000 - 20);
  }
  audio.music = function (on) {
    musicOn = !!on;
    root.clearTimeout(musicTimer);
    if (musicOn && !muted && ctx && ctx.state === 'running') scheduleMusic();
  };
  audio.musicWanted = true;
  audio.unlock = function () {
    var c = ac(); if (!c) return;
    var go = function () { if (audio.musicWanted && !musicOn) audio.music(true); };
    if (c.state === 'suspended') c.resume().then(go, function () {}); else go();
  };
  /** Music gets quieter while Pip talks, so the words are easy to hear. */
  audio.duck = function (on) {
    if (!musicGain || !ctx) return;
    try { musicGain.gain.setTargetAtTime(on ? 0.04 : 0.16, ctx.currentTime, 0.08); } catch (e) { /* ignore */ }
  };
  audio.isMuted = function () { return muted; };
  audio.setMuted = function (m) {
    muted = !!m;
    if (master) master.gain.value = muted ? 0 : 0.5;
    if (MR.state && MR.state.setPref) MR.state.setPref('muted', muted);
    if (muted) { root.clearTimeout(musicTimer); musicOn = false; } else if (audio.musicWanted) { audio.unlock(); }
    MR.emit('audio:mute', muted);
  };
  audio.toggleMute = function () { audio.setMuted(!muted); };
})(typeof window !== 'undefined' ? window : globalThis);
