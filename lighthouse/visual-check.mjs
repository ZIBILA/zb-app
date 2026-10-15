// Pixel comparison of two running builds of the storefront.
// Usage: node lighthouse/visual-check.mjs <baseUrlA> <baseUrlB> [outDir]
// Captures every storefront route at 390 px and 1440 px, light and dark, from both servers,
// and reports the % of differing pixels (pixelmatch, threshold 0.1). Diff images are written
// only for pages above 0.5 %.
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [,, A, B, outArg] = process.argv;
if (!A || !B) { console.error('usage: node lighthouse/visual-check.mjs <urlA> <urlB> [outDir]'); process.exit(1); }
const out = resolve(outArg || 'lighthouse/visual'); mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const routes = (process.env.VC_ROUTES || '/,/collections,/products/heavyweight-graphic-tee-acid-wash,/cart,/faq,/story,/support,/blogs,/reviews,/gallery,/wishlist,/login,/search?q=tee,/app,/collaborations,/this-page-does-not-exist').split(',');
const viewports = [{ name: '390', width: 390, height: 844, mobile: true }, { name: '1440', width: 1440, height: 900, mobile: false }];
const themes = ['dark', 'light'];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
async function shot(base, route, vp, theme) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
  // freeze time-based animation noise
  await page.goto(base + route, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important} video{visibility:hidden!important}' });
  await new Promise(r => setTimeout(r, 1500));
  // lazy content: scroll through then back to top
  await page.evaluate(async () => { const h = document.body.scrollHeight; for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); } window.scrollTo(0, 0); });
  await new Promise(r => setTimeout(r, 1200));
  const buf = await page.screenshot({ fullPage: true, type: 'png' });
  await page.close();
  return PNG.sync.read(buf);
}
const rows = [];
for (const route of routes) for (const vp of viewports) for (const theme of themes) {
  const tag = `${route.replace(/[^a-z0-9]+/gi, '_') || 'home'}-${vp.name}-${theme}`;
  try {
    const [a, b] = await Promise.all([shot(A, route, vp, theme), shot(B, route, vp, theme)]);
    const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
    const crop = (img) => { const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, 0, 0, w, h, 0, 0); return o; };
    const ca = crop(a), cb = crop(b), diff = new PNG({ width: w, height: h });
    const n = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold: 0.1 });
    const pct = (100 * n / (w * h));
    const heightNote = a.height === b.height ? '' : ` (height ${a.height} vs ${b.height})`;
    rows.push(`| ${route} | ${vp.name} | ${theme} | ${pct.toFixed(2)} %${heightNote} |`);
    if (pct > 0.5) { writeFileSync(resolve(out, `${tag}-A.png`), PNG.sync.write(ca)); writeFileSync(resolve(out, `${tag}-B.png`), PNG.sync.write(cb)); writeFileSync(resolve(out, `${tag}-diff.png`), PNG.sync.write(diff)); }
    console.log(tag, pct.toFixed(2) + '%' + heightNote);
  } catch (e) { rows.push(`| ${route} | ${vp.name} | ${theme} | error: ${String(e.message).slice(0, 60)} |`); console.log(tag, 'ERROR', e.message); }
}
await browser.close();
const md = ['| Route | Viewport | Theme | Differing pixels |', '|---|---|---|---|', ...rows].join('\n');
writeFileSync(resolve(out, 'summary.md'), md + '\n');
console.log('\n' + md);
