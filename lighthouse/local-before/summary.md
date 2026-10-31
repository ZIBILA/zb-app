# Local production build BEFORE this PR (mock DB, fallback catalogue) — 3 runs per page

| Page | runs | Perf | A11y | BP | SEO | LCP | FCP | TBT | CLS | SI | TTI | bytes KB | req |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cart | 82/82/82 | 82 | 96 | 100 | 66 | 4.9 s | 1.2 s | 2 ms | 0.000 | 1.7 s | 4.9 s | 950 | 51 |
| collection | 80/81/81 | 81 | 96 | 100 | 100 | 4.8 s | 1.2 s | 19 ms | 0.000 | 3.9 s | 4.8 s | 929 | 48 |
| home | 88/87/87 | 87 | 96 | 96 | 100 | 3.9 s | 1.7 s | 0 ms | 0.000 | 1.7 s | 3.9 s | 1200 | 52 |
| product | 88/88/89 | 88 | 96 | 100 | 66 | 3.8 s | 1.2 s | 6 ms | 0.000 | 2.8 s | 4.0 s | 948 | 51 |
