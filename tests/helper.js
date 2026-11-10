/* Loads the pure-logic files into Node exactly as the browser does (classic scripts on one global: globalThis.MR). */
'use strict';
const path = require('path');
const FILES = ['core', 'maze', 'data', 'rules', 'guide-engine', 'state', 'log', 'ai', 'speech'];
if (!globalThis.MR || !globalThis.MR.ai) {
  for (const f of FILES) require(path.join(__dirname, '..', 'js', f + '.js'));
  globalThis.MR.storage.useMemory();
}
/** Fresh, empty storage + state + log for a test. */
function fresh() {
  const MR = globalThis.MR;
  MR.storage.useMemory();
  MR.state.init();
  MR.log.init();
  delete globalThis.MR_CONFIG;
  MR.ai._fetch = null;
  MR.ai.reset();
  return MR;
}
module.exports = { MR: globalThis.MR, fresh };
