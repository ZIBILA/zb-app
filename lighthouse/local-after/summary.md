# Local production build AFTER this PR (mock DB, fallback catalogue) — 3 runs per page

| Page | runs | Perf | A11y | BP | SEO | LCP | FCP | TBT | CLS | SI | TTI | bytes KB | req |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cart | 82/82/82 | 82 | 96 | 100 | 66 | 5.0 s | 1.2 s | 10 ms | 0.000 | 1.7 s | 5.0 s | 928 | 51 |
| collection | 83/83/83 | 83 | 96 | 100 | 100 | 4.8 s | 1.2 s | 7 ms | 0.000 | 1.7 s | 4.8 s | 906 | 48 |
| home | 90/87/88 | 88 | 96 | 96 | 100 | 3.9 s | 1.5 s | 3 ms | 0.000 | 1.5 s | 5.3 s | 1205 | 53 |
| product | 91/88/88 | 88 | 96 | 100 | 66 | 3.8 s | 1.2 s | 5 ms | 0.000 | 1.6 s | 4.0 s | 923 | 50 |
