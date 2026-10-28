// Pixel debug (local only): node lighthouse/pixel-debug.mjs <path>  — prints fbq state, every facebook.com/tr hit's
// parameter names, Snap pixel event bodies, vendor file loads and console errors. FUNNEL_COOKIES presets cookies.
import puppeteer from 'puppeteer-core';
const base = 'http://localhost:3001', path = process.argv[2] || '/products/heavyweight-graphic-tee-acid-wash';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
if (process.env.FUNNEL_COOKIES) { const preset = JSON.parse(process.env.FUNNEL_COOKIES); await page.setCookie(...Object.entries(preset).map(([name, value]) => ({ name, value: String(value), domain: 'localhost', path: '/' }))); }
const errs = []; page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url();
  if (/facebook\.com\/tr/.test(url)) { const u = new URL(url); console.log('FB /tr', req.method(), req.resourceType(), 'ev=' + u.searchParams.get('ev'), 'len=' + url.length, 'coo=' + u.searchParams.get('coo'), 'fbp=' + (u.searchParams.get('fbp') || '-'), 'fbc=' + (u.searchParams.get('fbc') || '-'), 'params:', [...u.searchParams.keys()].join(','), req.method() === 'POST' ? 'post=' + (req.postData() || '').slice(0, 200) : ''); return req.respond({ status: 200, body: '' }); }
  if (/facebook\.com/.test(url)) console.log('FB other', req.method(), req.resourceType(), url.slice(0, 120));
  if (/\/api\/(meta|snap)\/event/.test(url) && req.method() === 'POST') { let b = null; try { b = JSON.parse(req.postData() || 'null'); } catch {} console.log('relay POST', url.replace(base, ''), b?.eventName, b?.customData ? 'customData:' + Object.keys(b.customData).join(',') : ''); }
  if (/connect\.facebook\.net/.test(url)) console.log('fbevents.js requested');
  if (/tr\.snapchat\.com\/p$/.test(url)) { try { const b = JSON.parse(req.postData()); console.log('SNAP req:', JSON.stringify(b.req).slice(0, 700)); } catch {} return req.respond({ status: 200, body: '' }); }
  if (/tr\.snapchat\.com|sc-static\.net/.test(url) && !/scevent\.min\.js/.test(url)) return req.respond({ status: 200, body: '' });
  req.continue();
});
page.on('response', r => { if (/connect\.facebook\.net|scevent\.min\.js/.test(r.url())) console.log('vendor file', r.url().slice(0, 60), r.status()); });
await page.goto(base + path, { waitUntil: 'networkidle2', timeout: 90000 });
await page.mouse.move(100, 300); await page.touchscreen.tap(195, 300).catch(() => {});
await new Promise(r => setTimeout(r, 9000));
console.log('fbq state:', await page.evaluate(() => ({ fbq: typeof window.fbq, loaded: !!(window.fbq && window.fbq.loaded), callMethod: !!(window.fbq && window.fbq.callMethod), queue: window.fbq && window.fbq.queue ? window.fbq.queue.length : null, am: window.__zbMetaAM, snaptr: typeof window.snaptr, snapInit: window.__snapPixelInitialized })));
console.log('console errors:', JSON.stringify(errs));
await browser.close();
