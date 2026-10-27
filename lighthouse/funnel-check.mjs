// Funnel event check (local only). Usage: node lighthouse/funnel-check.mjs <baseUrl> <productPath>
// Drives product → size → Add to Bag → /cart → /checkout at 390px in headless Chrome and records,
// for Meta and Snap, every browser pixel hit (with its advanced-matching / identity query keys) and
// every browser→server relay body (event name, event_id, which userData / customData keys are set).
// Nothing reaches Facebook or Snapchat: their hosts are answered locally.
import puppeteer from 'puppeteer-core';
const [,, base = 'http://localhost:3001', productPath = '/products/heavyweight-graphic-tee-acid-wash'] = process.argv;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const log = [];
const step = { name: 'start' };
await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url();
  if (/facebook\.com\/tr/.test(url)) {
    const u = new URL(url);
    const ud = [...u.searchParams.keys()].filter(k => k.startsWith('ud[')).map(k => k.slice(3, -1));
    const cd = [...u.searchParams.keys()].filter(k => k.startsWith('cd[')).map(k => k.slice(3, -1));
    const top = [...u.searchParams.keys()].filter(k => !k.startsWith('ud[') && !k.startsWith('cd['));
    log.push({ step: step.name, side: 'meta-pixel', ev: u.searchParams.get('ev'), eid: u.searchParams.get('eid'), ud, cd, top, fbp: !!u.searchParams.get('fbp'), fbc: !!u.searchParams.get('fbc') });
    return req.respond({ status: 200, body: '' });
  }
  if (/tr\.snapchat\.com/.test(url)) {
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch {}
    const evts = Array.isArray(body?.req) ? body.req.map(e => ({ keys: Object.keys(e || {}), ev: e.ev || e.en || e.event || e.n, dedup: e.cdid || e.client_dedup_id, u: e.u ? Object.keys(e.u) : undefined })) : null;
    if (process.env.FUNNEL_RAW_SNAP && body) console.log('SNAP RAW', JSON.stringify(body).slice(0, 900));
    log.push({ step: step.name, side: 'snap-pixel', url: url.replace(/\?.*/, ''), post: body ? { keys: Object.keys(body), evts } : (req.postData() || '').slice(0, 120) });
    return req.respond({ status: 200, body: '' });
  }
  if (/\/api\/(meta|snap)\/event/.test(url) && req.method() === 'POST') {
    let b = null; try { b = JSON.parse(req.postData() || 'null'); } catch {}
    log.push({ step: step.name, side: url.includes('/meta/') ? 'meta-relay' : 'snap-relay', ev: b?.eventName, eid: b?.eventId,
      userData: b?.userData ? Object.keys(b.userData) : null, customData: b?.customData ? Object.keys(b.customData) : null,
      value: b?.customData?.value, currency: b?.customData?.currency, ids: b?.customData?.content_ids,
      top: Object.keys(b || {}).filter(k => !['userData','customData'].includes(k)) });
  }
  req.continue();
});
page.on('response', (res) => {
  const url = res.url();
  if (/\/api\/(meta|snap)\/event/.test(url)) log.push({ step: step.name, side: 'relay-response', route: url.replace(base, ''), status: res.status() });
});
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// FUNNEL_COOKIES='{"zb_external_id":"zb.x","zb_pii_owner":"zb.x",...}' presets cookies (returning-visitor scenarios).
if (process.env.FUNNEL_COOKIES) {
  const host = new URL(base).hostname;
  const preset = JSON.parse(process.env.FUNNEL_COOKIES);
  await page.setCookie(...Object.entries(preset).map(([name, value]) => ({ name, value: String(value), domain: host, path: '/' })));
}
const clickText = async (re) => page.evaluate((src) => {
  const re = new RegExp(src, 'i');
  const btn = [...document.querySelectorAll('button')].find(b => re.test(b.textContent || '') && !b.disabled && b.getBoundingClientRect().height > 0);
  if (!btn) return null; btn.click(); return btn.textContent.trim().slice(0, 40);
}, re.source);

step.name = 'product';
await page.goto(base + productPath, { waitUntil: 'networkidle2', timeout: 90000 });
await page.mouse.move(100, 300); await page.touchscreen.tap(195, 300).catch(() => {});
await wait(6000);
step.name = 'size';
const size = await page.evaluate(() => {
  const grid = [...document.querySelectorAll('button')].filter(b => /^(xs|s|m|l|xl|xxl|2xl|3xl|\d{2})$/i.test((b.textContent || '').trim()) && b.getBoundingClientRect().height > 0 && !b.disabled);
  if (!grid.length) return null; grid[0].click(); return grid[0].textContent.trim();
});
await wait(500);
step.name = 'add-to-bag';
const atc = await clickText(/add to bag/);
await wait(5000);
step.name = 'cart';
await page.goto(base + '/cart', { waitUntil: 'networkidle2', timeout: 90000 }); await wait(4000);
step.name = 'checkout';
await page.goto(base + '/checkout', { waitUntil: 'networkidle2', timeout: 90000 }); await wait(8000);
const cookies = (await page.cookies()).map(c => `${c.name}${c.httpOnly ? '(http)' : ''}`).sort();
console.log('size clicked:', size, '| add to bag clicked:', atc);
console.log('cookies:', cookies.join(' '));
for (const l of log) console.log(JSON.stringify(l));
await browser.close();
