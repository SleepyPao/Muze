#!/usr/bin/env node
/* Fit check: npm run test:fit [screenshot-dir]
 * Every screen at phone (portrait + landscape), tablet and laptop sizes: no sideways scrolling, nothing off screen,
 * no squashed or too-small buttons, the map fits its box, the dialog bar takes at most half the screen. */
const { chromium } = require('playwright');
const SIZES = [[360, 640], [390, 844], [640, 360], [844, 390], [768, 1024], [1024, 768], [1280, 800]];
const SCREENS = ['start', 'warmup', 'ask&item=0', 'ask&item=1&facts=place', 'go&item=0', 'go&item=2', 'sessionbreak', 'guide&route=0', 'guide&route=1', 'guide&route=2', 'guide&route=3', 'review', 'teacher'];
(async () => {
  const b = await chromium.launch(); let bad = 0;
  for (const [w, h] of SIZES) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1000, isMobile: w < 1000 && h < 1000 });
    await ctx.route(/^https?:/, (r) => r.abort());
    for (const sc of SCREENS) {
      const p = await ctx.newPage();
      const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.goto('file://' + require('path').resolve(__dirname, '..', '..', 'index.html') + '?debug=' + sc + '&fast=1&seed=7');
      await p.waitForTimeout(350);
      const r = await p.evaluate(() => {
        const W = window.innerWidth, out = [];
        if (document.documentElement.scrollWidth > W + 1) out.push('page scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + W);
        const teacher = document.getElementById('mr-app').dataset.screen === 'teacher';
        document.querySelectorAll('#mr-app *').forEach((e) => {
          const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return;
          const q = e.getBoundingClientRect(); if (!q.width || !q.height) return;
          if (teacher && e.closest('.mr-teach__tablewrap, .mr-teach__logwrap')) return;   /* wide tables scroll inside their box */
          if (q.right > W + 1.5 || q.left < -1.5) out.push('off screen: ' + (e.id || e.className).toString().slice(0, 40) + ' ' + Math.round(q.left) + '..' + Math.round(q.right));
          if (e.tagName === 'BUTTON' && (e.scrollWidth > e.clientWidth + 2 || q.width < 40)) out.push('squashed button: ' + (e.id || e.textContent).slice(0, 20) + ' ' + Math.round(q.width));
          if ((e.tagName === 'BUTTON') && !e.disabled && q.height < 39.5 && !teacher) out.push('small button: ' + (e.id || e.textContent).slice(0, 20) + ' ' + Math.round(q.height));
        });
        const cv = document.querySelector('canvas.mr-scene');
        if (cv) { const q = cv.getBoundingClientRect(), box = cv.parentNode.getBoundingClientRect(); if (q.width > box.width + 1 || q.height > box.height + 1) out.push('map bigger than its box ' + Math.round(q.width) + 'x' + Math.round(q.height) + ' in ' + Math.round(box.width) + 'x' + Math.round(box.height)); if (q.width < 200 && !document.querySelector('.mr-start')) out.push('map tiny: ' + Math.round(q.width)); }
        const dlg = document.getElementById('mr-dialog');
        if (!dlg.hidden) { const q = dlg.getBoundingClientRect(); if (q.height > window.innerHeight * 0.5) out.push('dialog bar takes ' + Math.round(q.height) + ' of ' + window.innerHeight); }
        return [...new Set(out)].slice(0, 6);
      });
      if (r.length || errs.length) { bad++; console.log(`${w}x${h} ${sc}:`, r.concat(errs).join(' | ')); }
      if (process.argv[2]) await p.screenshot({ path: process.argv[2] + `/${w}x${h}_${sc.replace(/[&=]/g, '_')}.png` });
      await p.close();
    }
    await ctx.close();
  }
  await b.close();
  console.log(bad ? bad + ' screen/size combinations with problems' : 'OK: ' + SIZES.length * SCREENS.length + ' screen/size combinations fit');
  process.exit(bad ? 1 : 0);
})();
