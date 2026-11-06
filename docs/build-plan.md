# Build plan v2: discovery engine, AI, and product polish

Live site: https://spherex-planet-x.vercel.app (API: https://spherex-planet-x.bodhishanbhag.workers.dev; deployed Worker builds leave out the sky images, see scripts/asset-count.mjs) · Repo: `main` is the source of truth.

This plan takes the deployed first version to a finished product. It has three parts:

1. **Fixes** for flaws found in an audit of the live site and code (section 1). These come first.
2. **Five headline features** that set the project apart for the *Planet X and SPHEREx* challenge (sections 2–6).
3. **Who builds what, in what order** (section 7), plus quality bars every slice must meet (section 8).

The product pitch this plan builds toward:

> An AI system that finds, links, classifies and follows moving objects in real NASA SPHEREx data, checks every one against JPL live, and shows the public exactly where a Planet X could still be hiding.

## 0. Ground rules (unchanged)

- Real data only. Every image and number traces to a SPHEREx file, a JPL response, or a documented computation. Simulated objects are always classified `injected` and labeled SIMULATED.
- No discovery claims. An unmatched object is "Unexplained", never "new".
- AI never invents observations. Every AI-written sentence is generated from the report's JSON, every number in it is checked against that JSON, and failures fall back to the template text.
- Ownership: **Backend session** owns `worker/`, `pipeline/`, `.github/workflows/`, `wrangler.toml`, root `package.json`, `shared/`, `docs/api-contract.md`. **Frontend session** owns `frontend/` except `frontend/public/data/` (written only by the pipeline).
- Work on a new branch from the latest `main` per slice, open a PR into `main`, keep each PR green on the Cloudflare preview build, and update `docs/api-contract.md` (+ Pydantic models + TS types + fixtures) in the same PR as any contract change.
- Free-tier limits to design around: Workers 50 subrequests and 10 ms CPU per request; KV 1,000 writes/day; Workers AI 10,000 neurons/day; D1 100,000 writes/day. GitHub Actions is unlimited once the repo is public (2,000 min/month while private).

## 1. Fixes from the audit (do these first)

**Status (Oct 29):** B1, B2, B3, B4, B9, F1, F2 and the 404 fix (F6) are done on `main`. Still open: **B5, B6, B7, B8, B10** and **F3, F4, F5**.

### Backend

| # | Flaw | Evidence | Fix |
|---|---|---|---|
| B1 | Evidence reports block 20–30 s on first view. | JPL enrichment runs inside the request; results go in the per-datacenter Cache API, so each region pays again. | Move enrichment results to **Workers KV** (global). Add a **Cron Trigger** (every 30 min) that re-enriches every candidate and writes KV. Requests read KV and never call JPL in the request path; if KV is empty, return the static report with `known_object.enrichment: "pending"` immediately. |
| B2 | Failed JPL checks are never stored, so each view retries for 28 s. | `Cache-Control: no-store` and no cache write when `checked: false`. | Cron retries failures; store the last failure in KV with `not_checked_reason` and `attempted_utc`. |
| B3 | Candidate list shows "Unexplained" for a known asteroid until someone opens its report. | The list folds in only already-cached enrichment. | Solved by B1: the list reads KV for every candidate. |
| B4 | Blink viewer defaults to two images taken at the same instant. | First `blink_pairs` entry in every field is a 0.0 h dichroic partner pair (e.g. `e01`/`e02`, 1.20 µm vs 3.93 µm). Field A has no λ-matched pair at all. | In `pipeline/build.py`, never emit pairs less than 1 h apart. Rank pairs by the mover's on-sky displacement (largest first), prefer λ-matched within 2%, and add `default: true` to the best pair. Add `displacement_arcsec` and `gap_hours` to each pair. |
| B5 | `POST /api/runs` always returns 501: a dead feature in the contract. | `worker/src/routes/static-docs.ts`. | Replace with the field-request queue (section 2.6): `POST /api/requests` writes to D1; a GitHub Action processes the queue. |
| B6 | Health probe counts JPL SBIdent's HTTP 400 as "reachable". | `/api/health` shows SBIdent `http_status: 400`. | Probe with a minimal valid SBIdent query (cached 10 min) and require 200. |
| B7 | Only 3 fields and 2 candidates; the Simulated page has no data. | `frontend/public/data/` has no `injection/`. | Section 2 (survey) and section 5 (detection limits). |
| B8 | Static data is stamped with a WIP commit (`0.1.0+git.2e0e433`). | `/api/health` `pipeline_version`. | Pipeline runs in CI stamp the real commit and run ID. |
| B9 | Subrequest budget is implicit. | Earlier crash from >50 subrequests. | Add a `SubrequestBudget` passed through `Deps`; every upstream call spends from it; the cron enrichment splits work across invocations. Unit-test the worst case. |
| B10 | Images show a bright white wedge where the detector has no data. | Report for `aquarius-b-c01`, epochs on Jun 2–3 (e.g. stamps #1–#4, field image at Jun 3 08:03). The display-only "fill flagged pixels from neighbours" step also fills pixels outside the detector footprint, smearing values into an empty area. | Fill only flagged pixels **inside** coverage (`np.isfinite(lam_grid)` / detector footprint); render uncovered pixels as a flat neutral background (or transparent in WebP), and show "outside SPHEREx's view" in the viewer legend. Rebuild the three fields from S3 and keep `rank-pairs` output. |

### Frontend

| # | Flaw | Fix |
|---|---|---|
| F1 | Reports show a blank skeleton for up to 30 s. | With B1 the report is instant; show a live "JPL check: pending / checked 2 h ago / failed" chip and refresh in the background (poll every 10 s while pending). |
| F2 | Default blink pair barely shows motion (B4). | Use the backend's `default` pair; show the gap ("10.6 hours apart") and displacement on the pair picker. |
| F3 | Simulated page is empty. | Becomes the detection-limits page (section 5). |
| F4 | No visual QA on real data at phone width. | Add Playwright screenshot tests at 360, 768 and 1280 px for every page on **real** data (not mocks), plus a Lighthouse CI check: performance, accessibility and best practices ≥ 90 on Home, Explore field and a report. |
| F5 | Text says "Not yet checked against JPL" even after a match on some views. | All copy comes from the API's `summary_plain`/`label_plain`; remove any frontend-side status wording. |
| F6 | Unknown URLs showed the home page. | Done: `not_found_handling = "404-page"`. |
| F7 | Detective cards and report titles all read "Unexplained", which doesn't identify the object. | Title each card and report with the object's identity: JPL designation when matched, otherwise "Object A in Aquarius" (from the field name) with the ID as secondary text. |

## 2. Feature A: discovery engine that finds, links and follows objects

Goal: replace the one-off overnight run with a pipeline that keeps searching new SPHEREx data, links detections into objects, estimates where they are and where they'll be, and follows them over time.

### 2.1 Survey footprint and scheduled runs
- Define a **survey footprint** in `pipeline/survey.yaml`: a strip of 0.3° tiles along the ecliptic (|β| < 5°) where SPHEREx has repeated visits, starting with ~60 tiles near the existing Aquarius fields.
- **GitHub Action `survey.yml`** (cron daily + manual): discover new SPHEREx Level 2 files in the public S3 bucket since the last run (the header index already exists), process tiles with new data in parallel (matrix of 10 jobs), commit results to `frontend/public/data/` on a bot branch, open a PR and auto-merge it when tests pass. Cloudflare then redeploys.
- Keep a run ledger `frontend/public/data/runs/{run_id}.json`: inputs (file list), parameters, git commit, timings, counts. `GET /api/runs/{id}` serves these.

### 2.2 Linking without a known orbit (HelioLinC-style)
- `pipeline/spherex_px/science/heliolinc.py`: for a grid of assumed heliocentric distances and radial velocities, convert every unmatched detection to a heliocentric 3D position using SPHEREx's position (already in the FITS headers), propagate to a common reference time, and cluster with DBSCAN. Clusters with ≥ 3 visits become **tracklets → objects**.
- This replaces the per-field linear linker for cross-visit linking and lets objects cross tile boundaries.
- Validate on known asteroids: report the fraction of JPL-known objects in the footprint that are linked (**linking completeness**) and the fraction of linked objects that are false (**purity**).

### 2.3 Distance from parallax and preliminary orbits
- Fit parallax distance from SPHEREx's 700 km orbit and Earth's motion (the backend already measured 2.4 AU for object B). Report distance with an uncertainty and a class: NEO / main belt / Jupiter trojan / Centaur / trans-Neptunian.
- `orbit.py`: Väisälä/ranging initial orbit + least-squares refinement; output orbital elements with covariance, and **100 sampled orbit clones** for an uncertainty cloud.
- **Validation:** for every candidate JPL identifies, compare our orbit to JPL's (Horizons `ELEMENTS`). Publish the errors on the About page.

### 2.4 Continuous follow-up
- `objects/{object_id}.json`: every detection ever linked, the current orbit, prediction for the next 30 days, and history of orbit updates.
- Each survey run first **predicts** where tracked objects should appear in the new images, does forced photometry there, and appends recoveries (it also catches objects too faint to detect blindly).
- **Precovery:** when an object gets an orbit, search older SPHEREx images along the predicted path.
- **Follow-up card:** predicted RA/Dec + uncertainty ellipse for the next 14 nights, for ground telescopes.
- **ADES export** (`GET /api/objects/{id}/ades.xml`), the Minor Planet Center's format.

### 2.5 API additions
`GET /api/objects`, `GET /api/objects/{id}`, `GET /api/objects/{id}/prediction?days=30`, `GET /api/objects/{id}/ades.xml`, `GET /api/survey` (footprint, coverage, last run). Keep `/api/candidates` as the per-field view of objects.

### 2.6 Request a patch of sky
`POST /api/requests {ra, dec}` (Turnstile-protected, rate-limited) stores a request in D1. The survey Action processes up to 5 requests per run and the site shows status at `/requests/{id}`.

## 3. Feature B: machine learning that replaces human vetting

### 3.1 Real-or-bogus classifier
- Train a small CNN (PyTorch, ~100k parameters) on 32×32 stamps with 3 channels: the detection, a reference image from another visit, and their difference.
- **Labels without humans:** positives = injected synthetic movers (section 5) + JPL-confirmed asteroids; negatives = detections the rule-based vetting rejects (cosmic rays, hot pixels, flagged pixels, ghosts) and static-star residuals.
- Hold out whole tiles for testing. Report precision/recall, ROC-AUC and a calibration curve on the About page, with the exact counts: "trained on N real, M bogus from K tiles".
- Export to ONNX; run in the pipeline. Store `scores.real_bogus` per detection and per object, and use it in ranking alongside the existing rule-based score (keep both visible; the rule-based score stays the explainable baseline).
- **Explain it:** an occlusion/saliency map per stamp, shown in the report ("the model looked here").

### 3.2 Public active learning ("Help train the AI")
- A vetting game page shows the stamps the model is **least sure** about. Visitors vote Real / Artifact / Not sure; votes go to D1 with an anonymous session ID; Turnstile blocks bots.
- Weekly Action retrains with votes (only stamps with ≥ 5 votes and ≥ 80% agreement), compares to the previous model on the frozen test set, and promotes it only if it's better. The page shows "your votes improved accuracy from X% to Y%".
- Agreement with expert labels (the JPL-confirmed set) is tracked so bad votes can't poison training.

### 3.3 Anomaly ranking
- Isolation Forest over object features (rate, direction relative to the ecliptic, parallax distance, colour across bands, light-curve amplitude, real-bogus score). Surfaces "weird" objects first: very slow, retrograde, unusual colours.
- Detective page gains "Most unusual" sort with a one-line reason ("moving 6× slower than typical main-belt asteroids at this position").

### 3.4 NEO likelihood (Digest2-style)
From motion and parallax, estimate probabilities of NEO / main belt / outer solar system. Validate on JPL-identified objects.

## 4. Feature C: what is it made of? (SPHEREx's unique strength)

- **Spectral reconstruction:** each detection is at a different wavelength (the LVF), so an object seen 30 times gives a 30-point 0.75–5 µm spectrum. Correct for distance and phase using the orbit, then fit.
- **Taxonomy classifier:** compare to reference spectra of asteroid classes (Bus–DeMeo S, C, X, D, V…) using a k-NN/gradient-boosting model with uncertainty. Output "likely C-type (carbon-rich), 72%". Include the thermal tail above ~3.5 µm for near objects (which is how B's flux rises in the MWIR).
- **Ice and gas detector:** fit absorption depths at 3.0 µm (water ice), 4.27 µm (CO₂) and 4.67 µm (CO). A detection is reported only with S/N ≥ 3 and plotted on the spectrum. This is the signature of comets and distant icy bodies, which is what a Planet X-like object would show.
- **Validation:** compare our class for JPL-identified asteroids with known taxonomies where they exist (SMASS/Bus–DeMeo tables) and publish agreement.
- **Sonification:** play the spectrum as sound (pitch = wavelength, volume = brightness), so rocky and icy bodies sound different. Accessibility feature.

## 5. Feature D: "Where could Planet X still be hiding?"

The honest headline result.

- **Injection–recovery at scale:** in every survey tile, inject synthetic objects with realistic PSFs (from each image's PSF extension) across a grid of brightness (AB 14–21), rate (0.1–100″/h) and distance (2–1000 AU, using parallax motion), run the unmodified pipeline blind, and record recovery. ≥ 200 trials per cell.
- **Outputs:** 50% completeness magnitude (m₅₀) per tile and per distance bin; false positives per deg²; recovery heatmaps with Wilson intervals. This becomes `injection/{study_id}.json` and populates the Simulated page.
- **All-sky limits map:** a Mollweide sky map coloured by "how faint a planet at 500 AU could be and still be missed here", with surveyed tiles, unsurveyed sky, and the **published Planet Nine search region** overlaid (cite the source in the UI).
- **Planet Nine brightness context:** convert m₅₀ to "a Neptune-sized planet at 500 AU would have been detected / missed here", with the assumptions spelled out (albedo, size, thermal model).
- **Shift-and-stack (stretch):** for deep fields with many visits, stack images along trial orbits of distant objects (GPU in a GitHub Action is not available, so run on CPU over a small set of trial orbits, or skip). Only claim limits it actually measures.

## 6. Feature E: AI built into the experience (Cloudflare Workers AI)

Add a `[ai]` binding (`binding = "AI"`) and use a current instruction-tuned text model from the Workers AI catalog (pick the best available and record the exact model ID in `docs/api-contract.md`). All AI output is cached in KV by input hash so the 10k neurons/day free limit is enough.

1. **AI analyst write-up per object.** Input: the object's JSON only. Output: a 3-paragraph explanation for the public plus a 1-line verdict. Every number must appear in `grounded_fields`; the existing numeric check runs on it; on failure, fall back to the template. Label as "AI-written from the measurements below", with the model name.
2. **Ask about this object.** A chat box on each report. The model gets the object JSON, the glossary and a system prompt that says to answer only from them and to say "the data doesn't tell us" otherwise. Citations to JSON paths are rendered as links to the values. Rate-limited per session; answers cached.
3. **Natural-language search.** "Show me slow unexplained objects near the ecliptic" → the model returns a structured filter (JSON schema-validated: classification, rate range, distance class, field, sort) that the Detective page applies. The applied filter is shown as editable chips so users can see what the AI did.
4. **Guided tour narration.** A 6-step "Judge's tour" (Home → blink → an object → its orbit → the limits map → Help train the AI) with AI-written captions generated from live data at build time and committed, so it never fails during a demo.
5. **Daily sky digest.** The cron run writes a short AI summary of what changed ("3 new objects linked, 2 identified as known asteroids, 1 unexplained") for the home page feed, grounded in the run ledger.

Guardrails: system prompts in `worker/src/ai/prompts.ts` under test; a red-team test file checks that the model refuses to claim discoveries or invent numbers; responses over a length limit are cut; any failure falls back silently to non-AI content.

## 7. Work split and order

Each line is one PR. Do them in order within a column; the two columns run in parallel. The contract for each backend slice is merged before the frontend slice that uses it (fixtures first, so the frontend never waits).

| Order | Backend session | Frontend session |
|---|---|---|
| 1 | **Fixes:** B10 image rebuild, B6, B8 (B1–B4, B9 done) | **Fixes:** F5, F7; F4 Playwright real-data screenshots + Lighthouse CI (F1, F2, F6 done) |
| 2 | Contract v1.1: `objects`, `survey`, AI endpoints, `requests`, `votes` (types, Pydantic, fixtures). D1 schema + migrations. | App-wide polish pass from the screenshot audit; navigation for new sections (Objects, Sky map, Help train the AI) with fixtures. |
| 3 | Injection–recovery at scale on the existing tiles → real `injection/` data (section 5) | **Simulated → Detection limits page**: recovery heatmaps, m₅₀ by distance, plain-language summary |
| 4 | Workers AI: analyst write-up, Ask-about-this-object, natural-language search, all with grounding checks and tests (section 6) | AI panels: write-up with cited numbers, chat with citations, natural-language search bar with editable filter chips |
| 5 | Survey footprint + `survey.yml` Action + run ledger; process ~60 ecliptic tiles | **All-sky map** (Mollweide, d3-geo): surveyed tiles, depth colouring, Planet Nine region overlay, click a tile → field |
| 6 | HelioLinC linking + parallax distance + orbits + validation vs JPL (section 2.2–2.3) | **Object page**: track across visits, 3D orbit view (three.js) with uncertainty cloud and planets, distance class |
| 7 | Real-or-bogus CNN + saliency + scores in data; anomaly ranking; NEO likelihood (section 3.1, 3.3, 3.4) | Report additions: model score with saliency overlay, "Most unusual" sort with reasons, NEO likelihood bar |
| 8 | Spectra: taxonomy + ice/gas bands + validation (section 4) | Spectrum panel upgrade: class with confidence, ice band markers, sonification button |
| 9 | Follow-up: predictions, forced-photometry recovery, precovery, ADES export, requests queue (section 2.4, 2.6) | Follow-up card, "Adopt an object" tracking page, request-a-patch form with status |
| 10 | Active learning: votes API (Turnstile, rate limits), weekly retrain Action with promotion gate (section 3.2) | **Help train the AI** game: stamp pairs, vote, live "your votes improved accuracy" stat |
| 11 | Daily digest + guided-tour captions (section 6.4–6.5) | Home page live feed, Judge's tour mode, final copy review |

If time runs short, cut from the bottom of the table. Never cut: the fixes, real data, grounding checks on AI text, SIMULATED labels, validation against JPL.

## 8. Quality bars for every PR

- Tests: Worker vitest, pipeline pytest, frontend unit + Playwright on real data. New science code ships with a validation script whose numbers are quoted in the PR.
- The Cloudflare preview build is green, and the PR description links the preview URL with what to look at.
- No new console errors; Lighthouse ≥ 90 on touched pages; works at 360 px; respects reduced motion.
- Every new number shown to the public has a source: a file, a JPL response, or a named computation with its parameters.
- `README.md` and `docs/api-contract.md` updated in the same PR when behaviour or the contract changes.

## 9. Cloudflare resources needed

Declared in `wrangler.toml`; Wrangler creates KV and D1 automatically on deploy when no ID is given. If a deploy fails with a permissions error, create them in the dashboard and add the IDs:

| Binding | Type | Used for |
|---|---|---|
| `ENRICHMENT` | KV namespace (created automatically on first deploy; live) | JPL results, AI output cache |
| `DB` | D1 database `spherex-planet-x` | votes, sky requests, tracked-object index |
| `AI` | Workers AI | analyst write-ups, chat, search |
| `[triggers] crons` | Cron Trigger `*/30 * * * *` (live) | background JPL enrichment, digest |
| Turnstile site + secret key | Turnstile widget | vote and request forms (secret via `wrangler secret put TURNSTILE_SECRET`) |
