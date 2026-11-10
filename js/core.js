/* Maze Rescue - core: namespace, events, utilities, storage wrapper.
 * Pure (no DOM at load). Loaded first, both in the browser and in Node tests. */
(function (root) {
  'use strict';
  var MR = root.MR = root.MR || {};
  MR.version = '0.1.0';

  /* ---------- events ---------- */
  var handlers = {};
  MR.on = function (evt, fn) {
    (handlers[evt] = handlers[evt] || []).push(fn);
    return function () { MR.off(evt, fn); };
  };
  MR.off = function (evt, fn) {
    var list = handlers[evt]; if (!list) return;
    var i = list.indexOf(fn); if (i >= 0) list.splice(i, 1);
  };
  MR.emit = function (evt, data) {
    var list = (handlers[evt] || []).slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) {
        if (root.console) root.console.error('[MR] handler for "' + evt + '" failed', e);
      }
    }
  };

  /* ---------- utilities ---------- */
  var util = MR.util = {};
  util.clone = function (o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); };
  util.nowISO = function () { return new Date().toISOString(); };
  util.uid = function (prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };
  util.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  util.wait = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
  /** Normalise a class number: trim, upper-case, collapse spaces. "5a - 12" -> "5A-12". */
  util.normClassNo = function (s) {
    return String(s == null ? '' : s).trim().toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
  };
  /** A class number looks like 5A-12, 6B12, 5A 3 ... (letters/digits/dash, 2-10 chars, must contain a digit). */
  util.validClassNo = function (s) {
    s = util.normClassNo(s);
    return /^[A-Z0-9-]{2,10}$/.test(s) && /\d/.test(s);
  };

  /* ---------- storage (localStorage with in-memory fallback) ---------- */
  var mem = {};
  var useMem = false;
  function ls() {
    if (useMem) return null;
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  MR.storage = {
    /** Force volatile in-memory storage (used by ?debug deeplinks and Node tests). */
    useMemory: function () { useMem = true; mem = {}; },
    isMemory: function () { return useMem || !ls(); },
    get: function (key) {
      var raw = null, s = ls();
      try { raw = s ? s.getItem(key) : (key in mem ? mem[key] : null); } catch (e) { raw = key in mem ? mem[key] : null; }
      if (raw == null) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    },
    set: function (key, value) {
      var raw = JSON.stringify(value), s = ls();
      try { if (s) { s.setItem(key, raw); return true; } } catch (e) { /* quota / private mode -> memory */ }
      mem[key] = raw; return false;
    },
    remove: function (key) {
      var s = ls();
      try { if (s) s.removeItem(key); } catch (e) { /* ignore */ }
      delete mem[key];
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
