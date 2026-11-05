# Precovery search validation

Generated 2026-11-05T04:14:01.672Z by `worker/test/find.live.test.ts` (`.github/workflows/find-validation.yml`).

For 20 bodies JPL identified in our catalog (the ones with the most detections, from https://spherex-planet-x.bodhishanbhag.workers.dev/api/objects), the Worker's `/api/find` was run against the live JPL and IRSA services and its frames compared with the SPHEREx frames (exposure + detector) our pipeline detected each body in.

- Frames recovered: **520 of 520** (match rate 100.0%)
- Bodies with every detected frame recovered: 20 of 20
- Searches that answered: 20 of 20; median time 25.9 s

| Query | Pipeline frames | Recovered | /api/find frames | Visits | Complete | Seconds | Error |
|---|---:|---:|---:|---:|---|---:|---|
| 1426 | 30 | 30 | 463 | 82 | true | 30.8 |  |
| 2399 | 38 | 38 | 408 | 71 | true | 26.7 |  |
| 4028 | 29 | 29 | 295 | 49 | true | 20.1 |  |
| 1463 | 24 | 24 | 307 | 51 | true | 26.2 |  |
| 2883 | 24 | 24 | 302 | 50 | true | 24.1 |  |
| 4239 | 21 | 21 | 470 | 80 | true | 26.1 |  |
| 1132 | 20 | 20 | 326 | 63 | true | 21.6 |  |
| 2116 | 20 | 20 | 302 | 54 | true | 19.7 |  |
| 440 | 25 | 25 | 292 | 53 | true | 26.7 |  |
| 1128 | 25 | 25 | 282 | 48 | true | 20.6 |  |
| 3095 | 26 | 26 | 396 | 71 | true | 26.5 |  |
| 1450 | 18 | 18 | 307 | 53 | true | 31.4 |  |
| 495 | 35 | 35 | 276 | 50 | true | 19.9 |  |
| 1667 | 17 | 17 | 322 | 55 | true | 17.5 |  |
| 14436 | 16 | 16 | 245 | 48 | true | 20.2 |  |
| 77 | 32 | 32 | 276 | 52 | true | 15.6 |  |
| 760 | 31 | 31 | 374 | 70 | true | 25.9 |  |
| 1639 | 30 | 30 | 267 | 47 | true | 25.1 |  |
| 2524 | 30 | 30 | 460 | 75 | true | 26.6 |  |
| 2505 | 29 | 29 | 366 | 63 | true | 25.9 |  |
