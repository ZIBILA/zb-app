// Pixel firing check (local only). Usage: node lighthouse/pixel-check.mjs <baseUrl> <path> [waitMs]
// Loads one page in headless Chrome, records every request to facebook.com/tr, tr.snapchat.com,
// and every browser→server relay (/api/meta/event, /api/snap/event, /api/openai-ads/event) with
// its JSON body, then prints: events seen (browser), events relayed (server), and whether the
// event_id of each browser event matches a relayed one.
import puppeteer from 'puppeteer-core';
const [,, base = 'http://localhost:3001', path = '/', waitArg = '9000'] = process.argv;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const pixel = [], relay = [];
await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url();
  if (/facebook\.com\/tr/.test(url)) {
    const u = new URL(url); pixel.push({ vendor: 'meta', ev: u.searchParams.get('ev'), eid: u.searchParams.get('eid'), id: u.searchParams.get('id') });
    return req.respond({ status: 200, body: '' }); // never reach Facebook from the test box
  }
  if (/tr\.snapchat\.com|sc-static\.net\/.*v\d/.test(url) && /tr\.snapchat/.test(url)) {
    pixel.push({ vendor: 'snap', url: url.slice(0, 160), post: req.postData()?.slice(0, 300) });
    return req.respond({ status: 200, body: '' });
  }
  if (/\/api\/(meta|snap|openai-ads)\/event/.test(url) && req.method() === 'POST') {
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch {}
    relay.push({ route: url.replace(base, ''), eventName: body?.eventName || body?.event_name || body?.name || body?.type, eventId: body?.eventId || body?.event_id || body?.clientDedupId, keys: body ? Object.keys(body).slice(0, 12) : null });
  }
  req.continue();
});
await page.goto(base + path, { waitUntil: 'networkidle2', timeout: 90000 });
// simulate first interaction so the deferred vendor files load, then wait
await page.mouse.move(100, 300); await page.touchscreen.tap(195, 400).catch(() => {});
await new Promise(r => setTimeout(r, Number(waitArg)));
const fbqLoaded = await page.evaluate(() => ({ fbq: typeof window.fbq, loaded: !!(window.fbq && window.fbq.loaded), snaptr: typeof window.snaptr, dataLayer: Array.isArray(window.dataLayer) ? window.dataLayer.length : null }));
console.log('page:', path, '\nglobals:', JSON.stringify(fbqLoaded));
console.log('\nBrowser pixel requests:'); for (const p of pixel) console.log(' ', JSON.stringify(p));
console.log('\nServer relays:'); for (const r of relay) console.log(' ', JSON.stringify(r));
const metaBrowser = pixel.filter(p => p.vendor === 'meta' && p.ev);
console.log('\nMeta events in browser:', metaBrowser.map(p => p.ev).join(', ') || 'none');
for (const p of metaBrowser) {
  const m = relay.find(r => r.route.startsWith('/api/meta/event') && r.eventId === p.eid);
  console.log(`  ${p.ev}: eid=${p.eid} → ${m ? 'relayed with SAME event_id ✓' : 'no relay with this id'}`);
}
await browser.close();
