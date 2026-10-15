// Usage: node lighthouse/run.mjs <before|after> [baseUrl]
// Runs Lighthouse (default mobile preset: simulated slow 4G, Moto G Power class) 3x per page,
// saves HTML+JSON reports and prints a median table (markdown).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const phase = process.argv[2] || 'before';
const base = process.argv[3] || 'http://localhost:3001';
const pages = {
  home: '/',
  collection: process.env.LH_COLLECTION || '/collections/jeans',
  product: process.env.LH_PRODUCT || '/products/heavyweight-graphic-tee-acid-wash',
  cart: '/cart',
};
const only = process.env.LH_ONLY ? process.env.LH_ONLY.split(',') : Object.keys(pages);
const RUNS = Number(process.env.LH_RUNS || 3);
const outDir = resolve('lighthouse', phase);
mkdirSync(outDir, { recursive: true });

const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const rows = [];
for (const name of only) {
  const url = base + pages[name];
  const runs = [];
  for (let i = 1; i <= RUNS; i++) {
    const out = resolve(outDir, `${name}-${i}`);
    execFileSync('npx', ['lighthouse', url, '--output=html', '--output=json', `--output-path=${out}`,
      '--chrome-flags=--headless=new --no-sandbox', '--quiet', '--only-categories=performance,accessibility,best-practices,seo'],
      { stdio: 'inherit' });
    const r = JSON.parse(readFileSync(`${out}.report.json`, 'utf8'));
    const a = r.audits;
    runs.push({
      perf: Math.round(r.categories.performance.score * 100),
      a11y: Math.round(r.categories.accessibility.score * 100),
      bp: Math.round(r.categories['best-practices'].score * 100),
      seo: Math.round(r.categories.seo.score * 100),
      lcp: a['largest-contentful-paint'].numericValue / 1000,
      fcp: a['first-contentful-paint'].numericValue / 1000,
      tbt: a['total-blocking-time'].numericValue,
      cls: a['cumulative-layout-shift'].numericValue,
      inp: a['interaction-to-next-paint']?.numericValue ?? null,
      bytes: a['total-byte-weight'].numericValue / 1024,
      requests: a['network-requests'].details.items.length,
    });
  }
  const m = (k) => median(runs.map((r) => r[k]).filter((v) => v != null));
  rows.push(`| ${name} | ${m('perf')} | ${m('a11y')} | ${m('bp')} | ${m('seo')} | ${m('lcp').toFixed(1)} s | ${m('fcp').toFixed(1)} s | ${Math.round(m('tbt'))} ms | ${m('cls').toFixed(3)} | ${runs[0].inp == null ? 'n/a (lab)' : Math.round(m('inp')) + ' ms'} | ${Math.round(m('bytes'))} KB | ${m('requests')} |`);
}
const table = ['| Page | Perf | A11y | BP | SEO | LCP | FCP | TBT | CLS | INP | Transfer | Requests |', '|---|---|---|---|---|---|---|---|---|---|---|---|', ...rows].join('\n');
writeFileSync(resolve(outDir, 'summary.md'), table + '\n');
console.log('\n' + table);
