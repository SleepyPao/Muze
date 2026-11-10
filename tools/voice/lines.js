#!/usr/bin/env node
/* Collect every fixed line Pip says (canned text, facts, warm-up instructions, screen lines) as JSON on stdout.
 * Used by tools/voice/make_voice.py to pre-record Pip's voice offline. Lines written by the AI at run time are
 * not here (they fall back to an on-device system voice, or stay silent). */
'use strict';
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '..', '..', 'tests', 'helper.js'));
const MR = globalThis.MR;
const T = MR.data.text;
const out = new Set();
const add = (s) => { if (typeof s === 'string' && /[a-z]/i.test(s) && s.trim() !== '…') out.add(s.trim()); };

for (const [k, v] of Object.entries(T)) {
  if (typeof v === 'string') add(v);
  else if (Array.isArray(v)) v.forEach(add);
  else if (v && typeof v === 'object') Object.values(v).forEach(add);
}
['left', 'right'].forEach((d) => { add(T.whose(d)); add(T.whoseNote(d)); add(T.guideOneWord(d)); });
/* "I can't see a fountain." happens for known landmarks that are not straight ahead */
MR.data.landmarkIds.concat(['door', 'exit']).forEach((id) => add(T.cantSee(MR.data.landmarkName(id))));
MR.data.items.forEach((it) => MR.data.FACTS.forEach((f) => add(MR.data.factText(it.id, f))));
MR.data.warmup.forEach((q) => { if (q.instruction) add(q.instruction); });

/* literal lines in the screens: every quoted sentence on a line that makes Pip talk */
const dir = path.join(__dirname, '..', '..', 'js', 'screens');
for (const f of fs.readdirSync(dir)) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  src.split('\n').filter((l) => /say\(|OK_LINES =/.test(l)).forEach((l) => {
    for (const m of l.matchAll(/'([^'\n]{4,})'/g)) if (/^[A-Z]/.test(m[1]) && /[ .!?]/.test(m[1])) add(m[1]);
  });
}
process.stdout.write(JSON.stringify([...out].sort(), null, 1) + '\n');
