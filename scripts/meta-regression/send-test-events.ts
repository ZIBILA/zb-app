/**
 * Replay the EXACT Meta CAPI payloads captured from the branch (run-all.sh output)
 * to Meta Events Manager → Test Events. Nothing is counted as a real conversion
 * because every request carries test_event_code.
 *
 *   META_CAPI_ACCESS_TOKEN=... META_TEST_EVENT_CODE=TEST12345 [META_PIXEL_ID=...] \
 *     npx tsx scripts/meta-regression/send-test-events.ts branch.json
 *
 * Event ids/times are refreshed (Test Events rejects stale times) — everything
 * else (user_data hashes, custom_data) is sent exactly as the branch produced it.
 */
import fs from 'fs';

const token = process.env.META_CAPI_ACCESS_TOKEN;
const testCode = process.env.META_TEST_EVENT_CODE;
const pixel = process.env.META_PIXEL_ID || process.env.NEXT_PUBLIC_META_PIXEL_ID || '2049977412558608';
const version = process.env.META_GRAPH_API_VERSION || 'v25.0' // same as lib/metaErrors.ts;
if (!token || !testCode) { console.error('META_CAPI_ACCESS_TOKEN and META_TEST_EVENT_CODE are required'); process.exit(2); }

const captured = JSON.parse(fs.readFileSync(process.argv[2] || 'meta-regression-branch.json', 'utf8'));
async function main() {
  let bad = 0;
  for (const [scenario, phases] of Object.entries<any>(captured)) {
    for (const phase of ['pageView', 'atc', 'purchase']) {
      for (const ev of phases[phase].graph as any[]) {
        const event = { ...ev, event_time: Math.floor(Date.now() / 1000), event_id: `test_${scenario}_${phase}_${Date.now()}` };
        const res = await fetch(`https://graph.facebook.com/${version}/${pixel}/events?access_token=${token}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: [event], test_event_code: testCode }),
        });
        const body: any = await res.json().catch(() => ({}));
        const ok = res.ok && body?.events_received === 1;
        if (!ok) bad++;
        console.log(`${ok ? 'RECEIVED' : 'ERROR   '}  ${scenario.padEnd(13)} ${ev.event_name.padEnd(9)} HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
      }
    }
  }
  console.log(bad ? `\n${bad} event(s) rejected` : `\nAll events received — check Events Manager → Test events (code ${testCode})`);
  process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e?.message || e); process.exit(1); });
