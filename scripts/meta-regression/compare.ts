/**
 * Diff Meta regression captures: main vs branch.
 *   npx tsx scripts/meta-regression/compare.ts main.json branch.json [report.md]
 * Rules:
 *   - India scenarios (guest + logged-in): ZERO differences allowed anywhere
 *     (cookies, fbq calls, browser→CAPI bodies, Graph API payloads).
 *   - International scenarios: differences allowed ONLY in identity match keys
 *     ph / country / st / zp (and their zb_guest_* cookies), and every new value
 *     must equal SHA-256 of the correctly normalized value.
 */
import fs from 'fs';
import crypto from 'crypto';

const [mainPath, branchPath, reportPath] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(mainPath, 'utf8'));
const B = JSON.parse(fs.readFileSync(branchPath, 'utf8'));
const h = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

const ALLOWED_LEAF = new Set(['ph', 'country', 'st', 'zp', 'zb_guest_phone', 'zb_guest_country', 'zb_guest_st', 'zb_guest_zp']);
const LEAF_KIND: Record<string, string> = { ph: 'ph', zb_guest_phone: 'ph', country: 'country', zb_guest_country: 'country', st: 'st', zb_guest_st: 'st', zp: 'zp', zb_guest_zp: 'zp' };
const EXPECTED: Record<string, Record<string, string>> = {
  UK: { ph: h('447700900123'), country: h('gb'), st: h('greaterlondon'), zp: h('sw1a1') },
  US: { ph: h('14155552671'), country: h('us'), st: h('ca'), zp: h('94105') },
  AE: { ph: h('971501234567'), country: h('ae'), st: h('dubai'), zp: h('00000') },
};

type Diff = { path: string; main: unknown; branch: unknown };
function diff(a: any, b: any, path: string, out: Diff[]) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff(a[k], b[k], `${path}.${k}`, out);
    return;
  }
  out.push({ path, main: a, branch: b });
}
const leafKey = (path: string) => {
  const parts = path.split('.');
  const last = parts[parts.length - 1];
  return /^\d+$/.test(last) ? parts[parts.length - 2] : last; // user_data.ph.0 → ph
};

let failed = 0;
const lines: string[] = ['# Meta Pixel + CAPI regression — main (e21989e) vs branch', ''];
const ORDER = ['IN_guest', 'IN_logged_in', 'UK_guest', 'UK_logged_in', 'US_guest', 'US_logged_in', 'AE_guest', 'AE_logged_in'];
for (const scenario of ORDER.filter(k => k in A)) {
  const country = scenario.split('_')[0];
  const diffs: Diff[] = [];
  diff(A[scenario], B[scenario], scenario, diffs);
  const counts = (o: any) => `PageView fbq ${o.pageView.fbq.length} / CAPI ${o.pageView.graph.length}, ATC fbq ${o.atc.fbq.length} / CAPI ${o.atc.graph.length}, Purchase fbq ${o.purchase.fbq.length} / CAPI ${o.purchase.graph.length}`;
  const sameShape = counts(A[scenario]) === counts(B[scenario]);
  let ok = sameShape;
  const bad: Diff[] = [];
  if (country === 'IN') {
    if (diffs.length) { ok = false; bad.push(...diffs); }
  } else {
    for (const d of diffs) {
      const leaf = leafKey(d.path);
      const kind = LEAF_KIND[leaf];
      const expected = kind ? EXPECTED[country]?.[kind] : undefined;
      // fbq init carries Meta's own raw-field names; values there are the cookie hashes too.
      if (!ALLOWED_LEAF.has(leaf) || (expected && d.branch !== expected)) { ok = false; bad.push(d); }
    }
  }
  if (!ok) failed++;
  const changedKinds = Array.from(new Set(diffs.map(d => LEAF_KIND[leafKey(d.path)] || leafKey(d.path)))).sort();
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${scenario.padEnd(14)} events: ${counts(B[scenario])}${sameShape ? '' : '  (MAIN: ' + counts(A[scenario]) + ')'}  | changed fields: ${changedKinds.join(', ') || 'none'} (${diffs.length} leaf diffs)`);
  lines.push(`## ${scenario} — ${ok ? 'PASS' : 'FAIL'}`, '', `Events (branch): ${counts(B[scenario])}${sameShape ? ' — identical to main' : ` — MAIN: ${counts(A[scenario])}`}`, '',
    diffs.length ? `Changed match keys: **${changedKinds.join(', ')}** (${diffs.length} values across cookies, pixel and CAPI)` : 'No differences at all.', '');
  if (diffs.length && country !== 'IN') {
    const sample = diffs.filter(d => d.path.includes('.purchase.graph')).slice(0, 6);
    if (sample.length) {
      lines.push('| Purchase CAPI field | main | branch | expected |', '|---|---|---|---|');
      for (const d of sample) {
        const k = LEAF_KIND[leafKey(d.path)];
        lines.push(`| ${d.path.split('.').slice(-2).join('.')} | \`${String(d.main).slice(0, 12)}…\` | \`${String(d.branch).slice(0, 12)}…\` | ${k ? `sha256(${({ UK: { ph: '447700900123', country: 'gb', st: 'greaterlondon', zp: 'sw1a1' }, US: { ph: '14155552671', country: 'us', st: 'ca', zp: '94105' }, AE: { ph: '971501234567', country: 'ae', st: 'dubai', zp: '00000' } } as any)[country][k]}) ✓` : ''} |`);
      }
      lines.push('');
    }
  }
  if (bad.length) { console.log('      unexpected:', JSON.stringify(bad.slice(0, 5))); lines.push('Unexpected differences:', '```json', JSON.stringify(bad.slice(0, 10), null, 2), '```', ''); }
}
console.log(failed ? `\n${failed} scenario(s) FAILED` : '\nMeta regression: PASS (India identical; international differs only in intended match keys)');
if (reportPath) fs.writeFileSync(reportPath, lines.join('\n'));
process.exit(failed ? 1 : 0);
