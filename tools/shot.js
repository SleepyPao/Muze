#!/usr/bin/env node
/* Screenshot helper (headless Chromium via Playwright, file:// URL, network blocked).
 *
 *   node tools/shot.js "?debug=ask&item=0" out.png [--size 1280x800] [--click "#mr-send"] [--type "#mr-input=Where is it?"]
 *                      [--wait 800] [--eval "MR.ui.dialog.submit('Where is it?')"]
 *
 * Steps run in the order given. Console errors and page errors are printed; the exit code is 1 if there were any. */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) { console.log('usage: node tools/shot.js "<query>" out.png [--size WxH] [--click sel] [--type sel=text] [--eval js] [--wait ms]'); process.exit(2); }
  const query = args[0], out = args[1];
  let size = { width: 1280, height: 800 };
  const steps = [];
  for (let i = 2; i < args.length; i++) {
    const a = args[i], v = args[i + 1];
    if (a === '--size') { const m = /^(\d+)x(\d+)$/.exec(v); size = { width: +m[1], height: +m[2] }; i++; }
    else if (a === '--click' || a === '--type' || a === '--eval' || a === '--wait') { steps.push([a.slice(2), v]); i++; }
  }
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html') + (query.startsWith('?') || query.startsWith('#') ? query : '?' + query);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: size, hasTouch: false });
  await page.route(/^https?:/, (r) => r.abort());
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  /* config.local.js is optional (git-ignored): its "file not found" is not an error. Any OTHER missing file is. */
  const missing = [];
  page.on('requestfailed', (r) => { if (!/^https?:/.test(r.url()) && !/\/config\.local\.js(\?|$)/.test(r.url())) missing.push('missing file: ' + r.url()); });
  await page.goto(url);
  await page.waitForTimeout(500);
  for (const [k, v] of steps) {
    if (k === 'click') await page.click(v);
    else if (k === 'type') { const j = v.indexOf('='); await page.fill(v.slice(0, j), v.slice(j + 1)); }
    else if (k === 'eval') await page.evaluate(v);
    else if (k === 'wait') await page.waitForTimeout(+v);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: out });
  await browser.close();
  const real = errors.filter((e) => !/config\.local\.js|ERR_FILE_NOT_FOUND/.test(e)).concat(missing);
  real.forEach((e) => console.log(e));
  console.log('saved', out);
  process.exit(real.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
