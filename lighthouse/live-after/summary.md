# Live AFTER — zicabella.com, 2026-10-29 (PR #40 + PR #42 restore deployed), Lighthouse 13.5 mobile preset, 3 runs per page

## Run at 17:28 UTC (all four pages)

| Page | runs | Perf | A11y | BP | SEO | LCP | FCP | TBT | CLS | SI | TTI | bytes KB | req |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cart | 44/64/77 | 64 | 96 | 77 | 58 | 7.0 s | 1.2 s | 487 ms | 0.000 | 2.1 s | 10.9 s | 1297 | 64 |
| collection | 75/65/75 | 75 | 93 | 77 | 100 | 10.2 s | 1.6 s | 76 ms | 0.000 | 2.9 s | 12.4 s | 2125 | 136 |
| home | 78/79/82 | 79 | 92 | 77 | 100 | 4.2 s | 1.7 s | 23 ms | 0.000 | 5.8 s | 12.6 s | 6299 | 127 |
| product | 73/63/71 | 71 | 91 | 77 | 100 | 10.6 s | 2.5 s | 51 ms | 0.000 | 3.5 s | 10.6 s | 1312 | 77 |

## Quiet re-run at 17:40 UTC (cart and home only; the first run's cart results contained 500–800 ms hydration long tasks caused by CPU contention on the audit machine)

| Page | runs | Perf | A11y | BP | SEO | LCP | FCP | TBT | CLS | SI | TTI | bytes KB | req |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cart | 74/74/73 | 74 | 96 | 77 | 58 | 7.9 s | 1.2 s | 69 ms | 0.000 | 3.6 s | 10.7 s | 1297 | 64 |
| home | 62/82/80 | 80 | 92 | 77 | 100 | 4.2 s | 1.7 s | 25 ms | 0.000 | 5.8 s | 12.6 s | 6304 | 127 |
