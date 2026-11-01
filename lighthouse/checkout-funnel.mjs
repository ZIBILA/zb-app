// Local funnel table (local only). Run behind lighthouse/app-host-proxy.cjs like lighthouse/app-host-check.mjs
// (same steps 1–4 there), with ENABLE_DEMO_LOGIN=true NEXTAUTH_URL=https://zicabella.com on the Next server:
//   node lighthouse/checkout-funnel.mjs
// Local funnel (production build behind the local HTTPS front on :8443, real host names):
// tester mode on → demo login → search → product → add to bag → bookmark → cart → checkout.
// Records, per step, every Meta Pixel delivery (form POST / image GET: event + eid), every
// browser→server relay body (event + id) and the relay answer, then prints the funnel table.
import puppeteer from 'puppeteer-core';
const PROXY_PORT = '8443';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP zicabella.com 127.0.0.1, MAP app.zicabella.com 127.0.0.1, MAP www.zicabella.com 127.0.0.1'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
// Same-origin requests are re-pointed at :8443 (see app-host-check.mjs); the page's CSP 'self' would refuse that port.
await page.setBypassCSP(true);
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  window.__zbAll = []; window.__zbStep = 'start';
  const push = (o) => window.__zbAll.push({ step: window.__zbStep, t: Date.now(), ...o });
  const os = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () { try { const a = this.getAttribute('action') || ''; if (/facebook\.com\/tr/.test(a)) { const fd = new FormData(this); push({ side: 'meta-pixel', ev: fd.get('ev'), id: fd.get('eid') || null, custom: !!fd.get('ce') }); } } catch {} return os.apply(this, arguments); };
  const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', { set(v) { try { if (/facebook\.com\/tr/.test(String(v))) { const u = new URL(String(v)); push({ side: 'meta-pixel', ev: u.searchParams.get('ev'), id: u.searchParams.get('eid') || null }); } } catch {} return d.set.call(this, v); }, get() { return d.get.call(this); }, configurable: true });
  const of = window.fetch;
  window.fetch = function (u, o) { try { const url = typeof u === 'string' ? u : u.url; if (/\/api\/(meta|snap)\/event$/.test(url)) { const b = JSON.parse((o && o.body) || '{}'); const side = /meta/.test(url) ? 'meta-relay' : 'snap-relay'; const p = of.apply(this, arguments); p.then(r => r.clone().text().then(t => push({ side, ev: b.eventName, id: b.eventId, answer: r.status + ' ' + t.slice(0, 50) })).catch(() => push({ side, ev: b.eventName, id: b.eventId, answer: String(r.status) }))).catch(() => {}); return p; } } catch {} return of.apply(this, arguments); };
  const ob = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = function (u, body) { try { if (/tr\d*\.snapchat\.com\/p$/.test(String(u))) { const j = JSON.parse(typeof body === 'string' ? body : ''); for (const e of (j.req || [])) push({ side: 'snap-pixel', ev: e.ev || e.en || e.event, id: e.cdid || e.client_dedup_id || null }); } } catch {} return ob(u, body); };
});
await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url(); let u; try { u = new URL(url); } catch { return req.continue(); }
  if (/^(app\.)?zicabella\.com$/.test(u.hostname) || u.hostname === 'www.zicabella.com') {
    if (u.port === PROXY_PORT) return req.continue();
    return req.continue({ url: 'https://' + u.hostname + ':' + PROXY_PORT + u.pathname + u.search });
  }
  if (/facebook\.com\/tr/.test(url)) return req.respond({ status: 200, body: '' });
  if (/tr\d*\.snapchat\.com\/p$/.test(url)) return req.respond({ status: 200, body: '' });
  req.continue();
});
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const collected = [];
let current = 'start';
const collect = async () => { try { const a = await page.evaluate(() => { const x = window.__zbAll || []; window.__zbAll = []; return x; }); for (const e of a) collected.push({ ...e, step: current }); } catch {} };
const step = async (name) => { await collect(); current = name; await page.evaluate((n) => { window.__zbStep = n; }, name).catch(() => {}); };
const go = async (path) => { await collect(); await page.goto('https://zicabella.com' + path, { waitUntil: 'networkidle2', timeout: 90000 }); await page.evaluate((n) => { window.__zbStep = n; }, current).catch(() => {}); };

await go('/?zb_test_events=testabc12'); await wait(5000);
const tester = await page.evaluate(() => ({ testing: window.__zbTestEvents, internal: window.__zbInternal }));
console.log('tester mode:', JSON.stringify(tester));

// demo login through NextAuth's credentials callback (OTP provider; demo phone + fixed OTP, local only)
const login = await page.evaluate(async () => {
  const csrf = (await (await fetch('/api/auth/csrf')).json()).csrfToken;
  const body = new URLSearchParams({ csrfToken: csrf, phone: '+919876543210', otp: '123456', name: 'Demo Tester', userAgent: navigator.userAgent, ip: '', clientGeo: '', json: 'true' });
  const r = await fetch('/api/auth/callback/otp', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'follow' });
  let answer = ''; try { answer = (await r.text()).slice(0, 160); } catch {}
  const s = await (await fetch('/api/auth/session')).json();
  return { status: r.status, answer, user: s && s.user ? { id: !!s.user.id, phone: !!(s.user.phone) } : null };
});
console.log('demo login:', JSON.stringify(login));

await step('search'); await go('/search?q=tee'); await wait(7000);
await step('product'); await go('/products/alpha-tee'); await wait(7000);
await step('add-to-bag');
const atc = await page.evaluate(() => { const size = [...document.querySelectorAll('button')].find(b => /^(xs|s|m|l|xl|xxl|\d{2})$/i.test((b.textContent || '').trim())); if (size) size.click(); return !!size; });
await wait(600);
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => /add to bag/i.test(b.textContent || '') && !b.disabled); if (b) b.click(); });
await wait(5000);
await step('wishlist');
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => { const r = b.getBoundingClientRect(); return b.querySelector('svg') && !b.getAttribute('aria-label') && r.width > 0 && r.width <= 40 && r.height <= 40 && r.y > 60 && r.y < 500 && !b.closest('header,nav') && !/add|remove|guide|bag/i.test(b.textContent || ''); }); if (b) b.click(); });
await wait(4000);
await step('cart'); await go('/cart'); await wait(5000);
await step('checkout'); await go('/checkout'); await wait(12000);
const where = await page.evaluate(() => ({ path: location.pathname, loggedIn: /zb_user_logged_in=true/.test(document.cookie) }));
console.log('after /checkout:', JSON.stringify(where), '| size clicked:', atc);

await collect();
const all = collected;
await browser.close();
const steps = ['start', 'search', 'product', 'add-to-bag', 'wishlist', 'cart', 'checkout'];
console.log('\nSTEP | EVENT | META browser(eid) | META server(id) | same id | SNAP browser(dedup) | SNAP server(id) | same id');
for (const s of steps) {
  const rows = all.filter(a => a.step === s);
  const names = [...new Set(rows.map(r => r.ev).filter(Boolean))];
  for (const ev of names) {
    const mp = rows.filter(r => r.side === 'meta-pixel' && r.ev === ev); const mr = rows.filter(r => r.side === 'meta-relay' && r.ev === ev);
    const sp = rows.filter(r => r.side === 'snap-pixel' && r.ev === ev); const sr = rows.filter(r => r.side === 'snap-relay' && r.ev === ev);
    if (!mp.length && !mr.length && !sp.length && !sr.length) continue;
    const same = (a, b) => (a.length && b.length) ? (a.some(x => b.some(y => x.id && x.id === y.id)) ? 'yes' : 'NO') : '-';
    console.log(`${s} | ${ev} | ${mp.length ? mp.map(x => (x.id || 'NO-ID').slice(0, 10)).join(',') : '-'} | ${mr.length ? mr.map(x => (x.id || '').slice(0, 10) + (x.answer ? ' [' + x.answer.slice(0, 20) + ']' : '')).join(',') : '-'} | ${same(mp, mr)} | ${sp.length ? sp.map(x => (x.id || 'NO-ID').slice(0, 14)).join(',') : '-'} | ${sr.length ? sr.map(x => (x.id || '').slice(0, 14) + (x.answer ? ' [' + x.answer.slice(0, 16) + ']' : '')).join(',') : '-'} | ${same(sp, sr)}`);
  }
}
