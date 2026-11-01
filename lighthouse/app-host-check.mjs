// Local proof for "events only from zicabella.com" (lib/tracking/host.ts), local only.
//
//   1. build with dummy pixel ids:  NEXT_PUBLIC_META_PIXEL_ID=100000000000001 NEXT_PUBLIC_SNAP_PIXEL_ID=00000000-0000-4000-8000-000000000001 npm run build
//   2. a self-signed cert:           openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/zb/key.pem -out /tmp/zb/cert.pem -days 2 -subj "/CN=zicabella.com" -addext "subjectAltName=DNS:zicabella.com,DNS:app.zicabella.com"
//   3. the local HTTPS front:        CERT_DIR=/tmp/zb node lighthouse/app-host-proxy.cjs      (https://<host>:8443 → http://127.0.0.1:3001, adds x-forwarded-*)
//   4. the production build:         PORT=3001 node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3001   (with the same env as lighthouse/funnel-check.mjs)
//   5. this script:                  node lighthouse/app-host-check.mjs
//
// Headless Chrome resolves the zicabella hosts to this machine, so the pages run on their real
// origins: an app.zicabella.com product page must 301 to zicabella.com and track there, an
// app.zicabella.com/cart page (kept on the app host) must load no pixel and post no relay, and
// a zicabella.com product page must track as before. Vendor pixel endpoints are answered locally.
import puppeteer from 'puppeteer-core';
// zicabella hosts resolve to this machine; a local HTTPS front on :8443 forwards to the Next server on :3001
// with the real Host (+ x-forwarded-*), exactly as the production proxy does. Requests to the bare hosts are
// re-pointed at :8443, so the page keeps its real origin and every fetch stays same-site.
const PROXY_PORT = process.env.ZB_PROXY_PORT || '8443';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--ignore-certificate-errors', '--host-resolver-rules=MAP zicabella.com 127.0.0.1, MAP app.zicabella.com 127.0.0.1, MAP www.zicabella.com 127.0.0.1'] });

async function run(label, startUrl, settleMs = 9000) {
  const page = await browser.newPage();
  // The page believes it is on zicabella.com, where the automation guard (navigator.webdriver on the
  // live host) would mute every pixel and relay; present as an ordinary mobile browser instead.
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
  const seen = { fbevents: 0, scevent: 0, fbTr: 0, snapBeacon: 0, relayMeta: [], relaySnap: [], relayOai: 0, docs: [], errors: [] };
  page.on('console', m => { if (m.type() === 'error') seen.errors.push(m.text().slice(0, 160)); });
  seen.bad = [];
  page.on('response', async r => { const st = r.status(); const u = r.url(); if (st >= 400 || /\/api\/(meta|snap)\/event$/.test(u)) { let body = ''; try { if (/\/api\/(meta|snap)\/event$/.test(u)) body = (await r.text()).slice(0, 160); } catch {} const req = r.request(); const h = req.headers(); seen.bad.push(st + ' ' + u.slice(0, 80) + (body ? ' :: ' + body : '') + ' :: origin=' + (h.origin || '-') + ' xfh=' + (h['x-forwarded-host'] || '-') + ' sfs=' + (h['sec-fetch-site'] || '-')); } });
  // The interception below rewrites same-origin requests to 127.0.0.1:3001; Chrome then checks the
  // page's CSP ('self') against the rewritten URL and would block stylesheets and the relay fetches,
  // which is a harness artefact, not site behaviour — so CSP is bypassed for this page only.
  await page.setBypassCSP(true);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    let u; try { u = new URL(url); } catch { return req.continue(); }
    if (/^(app\.)?zicabella\.com$/.test(u.hostname) || u.hostname === 'www.zicabella.com') {
      if (req.isNavigationRequest() && req.resourceType() === 'document') seen.docs.push(req.method() + ' ' + url);
      if (/\/api\/meta\/event$/.test(u.pathname) && req.method() === 'POST') { try { seen.relayMeta.push(JSON.parse(req.postData()).eventName); } catch { seen.relayMeta.push('?'); } }
      if (/\/api\/snap\/event$/.test(u.pathname) && req.method() === 'POST') { try { seen.relaySnap.push(JSON.parse(req.postData()).eventName); } catch { seen.relaySnap.push('?'); } }
      if (/\/api\/openai-ads\/event$/.test(u.pathname) && req.method() === 'POST') seen.relayOai++;
      if (u.port === PROXY_PORT) return req.continue();
      return req.continue({ url: 'https://' + u.hostname + ':' + PROXY_PORT + u.pathname + u.search });
    }
    if (/connect\.facebook\.net\/.*fbevents\.js/.test(url)) seen.fbevents++;
    if (/sc-static\.net\/scevent\.min\.js/.test(url)) seen.scevent++;
    if (/facebook\.com\/tr/.test(url)) { seen.fbTr++; return req.respond({ status: 200, body: '' }); }
    if (/tr\d*\.snapchat\.com\/p$/.test(url)) { seen.snapBeacon++; return req.respond({ status: 200, body: '' }); }
    if (/tr\.snapchat\.com|facebook\.com\/signals/.test(url)) return req.continue();
    req.continue();
  });
  const resp = await page.goto(startUrl, { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise(r => setTimeout(r, settleMs));
  const state = await page.evaluate(() => ({
    href: location.href,
    eventHostFlag: window.__zbEventHost,
    fbq: typeof window.fbq, fbqLoaded: !!(window.fbq && window.fbq.loaded), snaptr: typeof window.snaptr,
    metaPixelId: window.__zbMetaPixelId, snapPixelId: window.__zbSnapPixelId,
    loadMeta: !!window.__zbLoadMetaPixel, loadSnap: !!window.__zbLoadSnapPixel,
    eventCount: (window.fbq && window.fbq.getState && window.fbq.getState().pixels && window.fbq.getState().pixels[0]) ? window.fbq.getState().pixels[0].eventCount : null,
  }));
  console.log(`\n===== ${label}`);
  console.log('final status', resp && resp.status(), '| documents:', JSON.stringify(seen.docs));
  console.log('page:', JSON.stringify({ ...state, href: undefined }));
  console.log('href:', state.href, '| fbq eventCount:', state.eventCount);
  console.log('vendor: fbevents.js', seen.fbevents, '| scevent.js', seen.scevent, '| facebook.com/tr', seen.fbTr, '| snap beacons', seen.snapBeacon);
  console.log('relays: meta', JSON.stringify(seen.relayMeta), '| snap', JSON.stringify(seen.relaySnap), '| openai', seen.relayOai);
  console.log('console errors:', JSON.stringify(seen.errors.slice(0, 6)));
  console.log('responses >=400 and relay answers:', JSON.stringify(seen.bad.slice(0, 12)));
  await page.close();
  return { state, seen };
}

const a = await run('A. app.zicabella.com product page → must 301 to zicabella.com, then track there', 'https://app.zicabella.com/products/alpha-tee?utm_source=test');
const b = await run('B. app.zicabella.com/cart (kept on the app host) → no pixel, no relay', 'https://app.zicabella.com/cart');
const c = await run('C. zicabella.com product page → pixels + relays as before', 'https://zicabella.com/products/alpha-tee');

const checks = [
  ['A: landed on zicabella.com', /^https:\/\/zicabella\.com\/products\/alpha-tee/.test(a.state.href)],
  ['A: first document request was the app host, second the apex (301 followed)', a.seen.docs.length === 2 && /app\.zicabella\.com/.test(a.seen.docs[0]) && /https:\/\/zicabella\.com\//.test(a.seen.docs[1])],
  ['A: query string preserved', /utm_source=test/.test(a.state.href)],
  ['A: Meta + Snap relays fired on zicabella.com', a.seen.relayMeta.includes('PageView') && a.seen.relaySnap.includes('PAGE_VIEW')],
  ['B: stayed on app.zicabella.com', /^https:\/\/app\.zicabella\.com\/cart/.test(b.state.href)],
  ['B: event-host flag false', b.state.eventHostFlag === false],
  ['B: no pixel script loaded (fbevents.js / scevent.js)', b.seen.fbevents === 0 && b.seen.scevent === 0 && !b.state.loadMeta && !b.state.loadSnap],
  ['B: no fbq / snaptr globals', b.state.fbq === 'undefined' && b.state.snaptr === 'undefined'],
  ['B: no Meta / Snap relay posts', b.seen.relayMeta.length === 0 && b.seen.relaySnap.length === 0],
  ['B: no facebook.com/tr, no Snap beacons', b.seen.fbTr === 0 && b.seen.snapBeacon === 0],
  ['C: event-host flag true, both pixel scripts loaded', c.state.eventHostFlag === true && c.seen.fbevents >= 1 && c.seen.scevent >= 1],
  ['C: Meta PageView + ViewContent relayed, Snap PAGE_VIEW + VIEW_CONTENT relayed', c.seen.relayMeta.includes('PageView') && c.seen.relayMeta.includes('ViewContent') && c.seen.relaySnap.includes('PAGE_VIEW') && c.seen.relaySnap.includes('VIEW_CONTENT')],
  ['C: browser pixel counted events', (c.state.eventCount || 0) >= 2],
];
let failed = 0;
console.log('\n===== RESULT');
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failed ? 1 : 0);
