# Precovery search validation

Generated 2026-11-05T04:04:52.922Z by `worker/test/find.live.test.ts` (`.github/workflows/find-validation.yml`).

For 20 bodies JPL identified in our catalog (the ones with the most detections, from https://spherex-planet-x.bodhishanbhag.workers.dev/api/objects), the Worker's `/api/find` was run against the live JPL and IRSA services and its frames compared with the SPHEREx frames (exposure + detector) our pipeline detected each body in.

- Frames recovered: **384 of 520** (match rate 73.8%)
- Bodies with every detected frame recovered: 15 of 20
- Searches that answered: 15 of 20; median time 23.7 s

| Query | Pipeline frames | Recovered | /api/find frames | Visits | Complete | Seconds | Error |
|---|---:|---:|---:|---:|---|---:|---|
| 1426 | 30 | 30 | 400 | 69 | true | 26.7 |  |
| 2399 | 38 | 38 | 400 | 69 | true | 29.6 |  |
| 4028 | 29 | 29 | 295 | 49 | true | 25.5 |  |
| 1463 | 24 | 0 | 0 | 0 | null | 0.1 | JPL's Small-Body Database could not answer. It also answers this way for names it doesn't know, so check the spelling or try the number or designation. |
| 2883 | 24 | 24 | 302 | 50 | true | 15.2 |  |
| 4239 | 21 | 21 | 400 | 68 | true | 24.3 |  |
| 1132 | 20 | 20 | 326 | 63 | true | 23.7 |  |
| 2116 | 20 | 20 | 302 | 54 | true | 31.4 |  |
| 440 | 25 | 0 | 0 | 0 | null | 0.1 | JPL's Small-Body Database could not answer. It also answers this way for names it doesn't know, so check the spelling or try the number or designation. |
| 1128 | 25 | 25 | 282 | 48 | true | 16.5 |  |
| 3095 | 26 | 0 | 0 | 0 | null | 0.1 | JPL's Small-Body Database could not answer. It also answers this way for names it doesn't know, so check the spelling or try the number or designation. |
| 1450 | 18 | 18 | 307 | 53 | true | 22.5 |  |
| 495 | 35 | 35 | 276 | 50 | true | 15.3 |  |
| 1667 | 17 | 17 | 322 | 55 | true | 16.4 |  |
| 14436 | 16 | 16 | 245 | 48 | true | 22.1 |  |
| 77 | 32 | 0 | 0 | 0 | null | 0.1 | JPL's Small-Body Database could not answer. It also answers this way for names it doesn't know, so check the spelling or try the number or designation. |
| 760 | 31 | 31 | 374 | 70 | true | 25.7 |  |
| 1639 | 30 | 30 | 267 | 47 | true | 15.2 |  |
| 2524 | 30 | 30 | 400 | 65 | true | 25.8 |  |
| 2505 | 29 | 0 | 0 | 0 | null | 0.1 | JPL's Small-Body Database could not answer. It also answers this way for names it doesn't know, so check the spelling or try the number or designation. |
