# API contract (v1.1)

The contract between the backend and the frontend (`frontend/`). The backend owns it.

The deployed product is one Cloudflare Worker, `spherex-planet-x`, that serves both the website and the API:

```
                      ┌────────────── Cloudflare Worker "spherex-planet-x" ──────────────┐
 browser ── /api/* ──►│ worker/src (Hono): reads static JSON via env.ASSETS, adds live JPL │──► IRSA TAP, JPL SBIdent, JPL Horizons
         ── other ──► │ static assets: frontend/out (Next.js export, includes /data/*)    │
                      └───────────────────────────────────────────────────────────────────┘
 offline: pipeline/ (Python) ── reads SPHEREx L2 cutouts from s3://nasa-irsa-spherex ──► writes frontend/public/data/ (committed)
```

- **Pixels are processed offline** by `pipeline/` (Workers have CPU limits). It writes static JSON and WebP images to `frontend/public/data/`, which the Next.js static export copies into `frontend/out/data/`.
- **The Worker** serves `/api/*` from that static data through `env.ASSETS` and adds live data. `/api/coverage` queries IRSA TAP, and every candidate's `known_object` block is filled at request time from JPL SBIdent and Horizons for each epoch. The frontend calls relative `/api/*` URLs only.
- **Source of truth for shapes:** the Pydantic models in [`pipeline/spherex_px/schemas.py`](../pipeline/spherex_px/schemas.py). The Worker's TypeScript types in [`worker/src/contract.ts`](../worker/src/contract.ts) mirror them, and Worker tests validate responses against the exported JSON Schema.
- **JSON Schema:** [`shared/schema/`](../shared/schema/), exported from the models with `spherex-px export-schema`. A test fails if the exports are stale. The frontend can generate TypeScript types from these files.
- **Example responses:** [`shared/fixtures/`](../shared/fixtures/). Every fixture is a real backend response recorded from real SPHEREx data (see [Fixtures](#fixtures)), and a test validates each one against the models.

Changes to the contract go into all three in the same commit. Breaking changes bump the major `schema_version`. Additive changes bump the minor: v1.1 added objects, the survey, AI, sky requests and vetting votes. Responses carry `schema_version: "1.1"`, and static files built before v1.1 still say `"1.0"`. Clients accept any `1.x`.

## Conventions

| Rule | Detail |
|---|---|
| Naming | snake_case, units in the field name: `flux_ujy`, `flux_err_ujy`, `x_pix`, `rate_arcsec_per_hr`, `time_span_hours`, `fit_residual_rms_arcsec`. |
| IDs | `field_id`, `epoch_id`, `candidate_id`. `obs_id` **always** means the SPHEREx/IRSA observation ID (the `OBSID` FITS keyword, e.g. `2025W23_1C_0001_1`). |
| Envelope | Every top-level response carries `schema_version: "1.0"` and `pipeline_version`: the package version plus the git commit of the pipeline code that built the data, e.g. `0.1.0+git.abc1234` (in GitHub Actions the commit is `GITHUB_SHA`; local builds from uncommitted pipeline code are refused). `FieldList`, `FieldDetail`, `CandidateList` and `Health` also carry `build_run_id`: `gh-<run>-<attempt>` for a GitHub Actions run or `local-<UTC time>-<commit>`. |
| Times | Every epoch and every detection has both `time_utc` (ISO 8601, UTC, exposure midpoint) and `mjd` (UTC). |
| Angles | RA/Dec in degrees (ICRS). Offsets and errors in arcseconds. Rates in arcsec/hour. Position angle in degrees east of north. |
| Fluxes | µJy (`_ujy`). Image pixels are MJy/sr. |
| Wavelength | `wavelength_um_center`, `bandwidth_um`, `wavelength_um_range: [min, max]` on epochs and detections. `band_index` (0–101) is the SPHEREx channel from the mission's spectral-channel calibration table. |
| Unknown fields | The backend rejects unknown fields on input. The frontend should ignore unknown fields on output, so additive changes don't break it. |
| Nulls | A field documented as nullable is always present, set to `null` when unknown. Fields are never silently dropped. |

## Endpoints

The public app reads **precomputed showcase fields**. The "analyze any position" feature (`/api/coverage`, `/api/runs`) is an extra. A finished run produces the same field and candidate shapes, with `origin: "run"`.

| Method & path | Response model | Data |
|---|---|---|
| `GET /api/health` | `Health` | Probe of each upstream (IRSA TAP, JPL SBIdent, JPL Horizons, SPHEREx S3) with a minimal **valid** request; probe results are reused for 10 minutes. Static data counts. The response itself is never cached. |
| `GET /api/fields?origin=&limit=&offset=` | `FieldList` | Static `data/fields.json`. Each field's `candidate_counts` reflects the static (pipeline) classification. `origin=showcase` or `origin=run` (survey tiles) filters. Paged (see [Paging](#paging)). |
| `GET /api/fields/{field_id}` | `FieldDetail` | Static `data/fields/{field_id}.json`, with each mover's `classification` and `label_plain` taken from its candidate's stored JPL result (no upstream calls). |
| `GET /api/candidates?field_id=&classification=&min_score=&include_injected=false&limit=&offset=` | `CandidateList` | Static `data/candidates.json`, with each summary's `classification`, `label_plain`, `summary_plain` and known-object fields taken from stored enrichment results. A candidate with no stored result yet keeps `known_object_checked: false`. `classification` may repeat. `min_score` filters on `overall_score`. Injected candidates are excluded unless `include_injected=true` or `classification=injected` is requested. Paged after filtering. |
| `GET /api/candidates/{candidate_id}` | `CandidateDetail` | Static `data/candidates/{candidate_id}.json`, with the stored JPL result, or `enrichment: "pending"` while the first lookup runs (see [Known-object enrichment](#known-object-enrichment)). |
| `GET /api/injection/{study_id}` | `InjectionStudy` | Static `data/injection/{study_id}.json`. |
| `GET /api/coverage?ra_deg=&dec_deg=&radius_deg=` | `Coverage` | **Live** IRSA TAP (`https://irsa.ipac.caltech.edu/TAP/sync`). |
| `POST /api/runs` | `ErrorResponse` (501) | Pixel processing can't run inside a Worker. Runs are produced offline with `spherex-px run --ra ... --dec ...` and published with the static data. The endpoint returns 501 with instructions instead of pretending to queue work. |
| `GET /api/runs/{run_id}` | `RunStatus` | Static `data/runs/{run_id}.json` for runs built offline. `field_id` points at the resulting field. |
| `GET /api/objects?dedupe=true&limit=&offset=` | `ObjectList` | Static `data/objects.json`, with stored JPL results folded in as for candidates. Objects matched to the same JPL designation (the same asteroid in neighbouring tiles or other weeks) are merged: the one with the most detections stays, the others are listed in its `also_seen_as`, and their `field_ids`, `candidate_ids`, `n_detections`, `n_visits` and time span are added to it. Unmatched objects are never merged. `dedupe=false` returns every object as built. Paged after merging. |
| `GET /api/objects/{object_id}` | `ObjectDetail` | Static `data/objects/{object_id}.json`, with the stored JPL result of its first linked candidate, or `enrichment: "pending"` while the first lookup runs. `also_seen_as` lists the other objects with the same JPL designation. |
| `GET /api/objects/{object_id}/prediction?days=30` | `ObjectPrediction` | Static `data/objects/{object_id}/prediction.json`, trimmed to `days` (1–60). `404` while the object has no orbit. |
| `GET /api/objects/{object_id}/ades.xml` | ADES XML | Minor Planet Center ADES export (build-plan row 9). `404` until then. |
| `GET /api/validation/jpl-orbits` | summary | Our orbits versus JPL's for every identified object (see Objects). |
| `GET /api/validation/orbits` | `OrbitValidation` | Static `data/validation/orbits.json` (see [Objects](#objects-objectsummary-objectdetail-objectprediction)). |
| `GET /api/survey` | `Survey` | Static `data/survey.json`: survey tiles, their status and totals. The Worker adds `totals.n_known_objects`: distinct JPL designations among matched objects, so an asteroid seen in several tiles counts once. |
| `GET /api/{candidates,objects}/{id}/writeup` | `AiWriteup` | Row 4 (Workers AI). |
| `POST /api/ask` | `AskRequest` → `AiAnswer` | Row 4. |
| `POST /api/search` | `SearchRequest` → `AiSearch` | Row 4. |
| `GET /api/digest` | `Digest` | Row 11. |
| `POST /api/requests`, `GET /api/requests/{request_id}` | `SkyRequestCreate` → `SkyRequest` | Row 9 (D1 `sky_requests`). |
| `GET /api/vetting/next`, `POST /api/votes`, `GET /api/vetting/stats` | `VettingItem`, `VoteCreate` → `VoteResult`, `VettingStats` | Row 10 (D1 `vetting_items`, `votes`, `model_versions`). |
| `GET /data/...` | images, JSON | Static files: WebP field images, thumbnails, 64 px stamps. URLs in responses are root-relative (`/data/...`). |

**Upstream calls** (Worker): 15 s timeout, descriptive `User-Agent`, successful responses cached with the Cache API (`caches.default`) for 24 hours.

**Errors** are JSON `ErrorResponse {detail, upstream, upstream_status}`. `404` means an unknown id. `400` means invalid parameters. `502` means an upstream answered with an error (`upstream_status` is its HTTP status). `504` means an upstream timed out (`upstream_status: "timeout"`). `501` is returned for `POST /api/runs`.

### Known-object enrichment

The pipeline writes every candidate with `known_object.checked = false`, `enrichment: "static"` and `catalogs_checked: []`, because the offline builder has no JPL access. It never writes a match it did not check.

**When it runs.** JPL lookups take 10–30 seconds, so a visitor never waits for one. Results are stored globally in D1 (binding `DB`, table `enrichment`, `worker/src/store.ts`), so a list of any length reads them in one query. Results stored in Workers KV (binding `ENRICHMENT`) before D1 held them are still read and copied into D1 by the cron and by detail views:

- `GET /api/candidates/{candidate_id}` returns the stored result with `enrichment: "cached"`. If there is none yet, it answers immediately with `checked: false`, `enrichment: "pending"` and `Cache-Control: no-store`, and starts the lookup in the background. Clients fetch the report again every few seconds until `enrichment` is no longer `pending`.
- `GET /api/candidates` folds in stored results and starts one background lookup for a candidate that has none.
- A Cron Trigger every 10 minutes (`worker/src/scheduled.ts`) refreshes, within one invocation's subrequest budget, results that are missing, failed, or older than 24 hours.
- A failed lookup is retried after 30 minutes. A lock (D1 table `locks`) stops two lookups for the same candidate running at once.

**What a lookup does** (`worker/src/enrich.ts`):

1. Queries **JPL SBIdent** once per SPHEREx visit (exposures less than an hour apart see the same objects; at most 6 visits), with a 20 s timeout and SPHEREx's own position as the observer (`xobs`, from `spacecraft_geocentric_km`; SBIdent does not accept the geocenter), the exposure midpoint as `obs-time`, the fast first pass, and a field of view centered on the detection with a half-width of 0.1°. At least 2 visits must answer.
2. For objects SBIdent returns near the detection, queries **JPL Horizons** (one request with every detection time) for RA, Dec and distance, then corrects each position to SPHEREx's own vantage point using `spacecraft_geocentric_km` (SPHEREx orbits about 700 km up, which shifts nearby objects by several arcseconds).
3. Calls a candidate `known_object` only if one object lies within `search_radius_arcsec` of the detection at **every** epoch. Otherwise the candidate stays as the pipeline classified it, with `nearest` set to the closest object returned.
4. Sets `checked`, `catalogs_checked` (only the services that actually answered), `observer`, `query_utc` and `enrichment`, and regenerates `label_plain`, `summary_plain`, the `known_object` and `catalog_gap` error sources, and `explanation` from the updated values.
5. If JPL is unreachable, the candidate is returned with `checked: false` and a `not_checked_reason`. The response is still `200`, because the rest of the report is valid.

Every invocation spends from a budget of 40 upstream calls (the free plan allows 50 subrequests per invocation); calls beyond it fail with `upstream_status: "budget"`.

Injected candidates are never sent to JPL and are never relabelled.


### Paging

`GET /api/fields`, `/api/candidates` and `/api/objects` take `limit` (1–500) and `offset` (default 0); without `limit` they return everything, as the static files do. Responses add `total` (items matching the filters, before paging), `offset`, `limit` and `next_offset` (the offset of the next page, or `null` on the last page). Invalid values return `400`. Order is the static file's order, so pages are stable for one data version.

## Field (`FieldSummary`, `FieldDetail`)

- `name` and `blurb` come from the curated showcase config (`pipeline/spherex_px/config/showcase.toml`). `summary_plain` is generated by the backend from measured values only.
- `wcs` is the **one common grid** for the field: `{projection: "TAN", crval: [ra, dec], crpix: [x, y], cdelt_arcsec, width_px, height_px, rotation_deg}`. Field images are 0.3° cutouts (about 175 px at 6.15″/px) reprojected onto this grid. The frontend upscales them and must not assume a fixed size such as 512 px.
- Image orientation: `crpix` is 1-based in the FITS convention. Rendered images have north up and east left when `rotation_deg = 0`. Image row 0 is the top (`y_grid = height_px`). Convert an overlay point with `col = x_grid - 0.5` and `row = height_px - y_grid + 0.5`, in image-pixel units.
- **Images and no-data pixels:** every WebP is grayscale. Pixels outside the SPHEREx detector are **fully transparent** (alpha 0), with the field's sky level (0 MJy/sr) as their gray value, so a viewer that ignores alpha shows flat neutral sky. The frontend should draw its own background behind images and label transparent areas "outside SPHEREx's view". Images entirely on the detector are written without alpha. Inside the detector, pixels SPHEREx flags as unusable and detector-edge rows with raised noise from edge glow (QR2 detector 2's top ~35 rows) are filled from neighbors, or set to the sky level, for display only. Measurements never use them.
- `stretch`: a fixed asinh stretch per field (`min`, `max`, `softening`, `units: "MJy/sr"`, `zodi_subtracted: true`), shared by all epochs so blinking doesn't flicker.
- `epochs[]`: one per SPHEREx exposure and detector covering the field. Each has `obs_id`, `time_utc`, `mjd`, start and end times, `exposure_s`, `detector`, `bandpass` (`SPHEREx-D1`…`D6`), wavelength fields, `band_index`, `image {url, width_px, height_px, format, source}`, `flagged_pixel_fraction`, `n_detections`, `spacecraft_geocentric_km` (from the header, ICRF/J2000 equatorial axes), and `source`.
- `blink_pairs[]`: `{epoch_id_a, epoch_id_b, time_separation_hours, lambda_matched, delta_lambda_frac, label_plain}`. `lambda_matched` is true when the central wavelengths differ by less than half a spectral resolution element (Δλ/λ < 1/(2R), with R from the calibration table). The viewer labels unmatched pairs as different-wavelength pairs, where brightness changes are expected. Pairs are sent best first and include `displacement_arcsec` (how far a mover seen in both images shifts between them, or null) and `default` (exactly one pair is true: the pair the Explorer opens with, where a mover jumps clearly while staying in the image). Pairs less than 1 hour apart are never sent, because SPHEREx's same-burst and dichroic-partner exposures show no motion. At most 20 pairs are sent per field.
- `movers[]`: one per candidate in the field: `{candidate_id, classification, label_plain, quality_level, rate_arcsec_per_hr, track: [{epoch_id, time_utc, mjd, ra_deg, dec_deg, x_grid, y_grid}]}`.

## Candidate (`CandidateSummary`, `CandidateDetail`)

### Classification (backend-owned; the frontend never upgrades it)

| Value | Meaning | Frontend label |
|---|---|---|
| `known_object` | Track positions match a JPL prediction for a catalogued small body at every epoch, within `search_radius_arcsec`. | Known object |
| `unmatched` | Passes vetting, but no known object matched, **or** the known-object check could not run (`known_object.checked = false`, with `not_checked_reason`). | Unexplained |
| `likely_artifact` | Fails a hard vetting check (bad pixel flags in the aperture, PSF shape, edge). | Likely artifact |
| `unconfirmed_pair` | Only two detections (for example one pair across ~6 months). No motion fit is possible. | Unconfirmed pair |
| `injected` | A synthetic source we inserted into real pixels for the injection-recovery test. It is always `injected` and is never relabelled. | SIMULATED |

There is no separate `simulated` boolean. `classification == "injected"` is the only marker, and those candidates carry the `injection` block.

### Blocks

- `detections[]`: `epoch_id`, `obs_id`, `time_utc`, `mjd`, `ra_deg`, `dec_deg`, `pos_err_arcsec`, native `x_pix`/`y_pix` (0-based detector pixels), common-grid `x_grid`/`y_grid` (for overlays), `flux_ujy`, `flux_err_ujy`, `snr`, wavelength fields, `band_index`, `flag_bits`, `flag_names`, `flagged_pixels_in_aperture`, `psf_fit_reduced_chi2`, `stamp {url, width_px: 64, height_px: 64, format, source}`, `spacecraft_geocentric_km`, `source`.
- `motion`: `model` (`linear | parallax | none`), `n_detections`, `time_span_hours`, `rate_arcsec_per_hr`, `rate_err_arcsec_per_hr`, `position_angle_deg`, `ra_rate_arcsec_per_hr`, `dec_rate_arcsec_per_hr`, `fit_residual_rms_arcsec`, `fit_chi2`, `fit_dof`, `distance_au_estimate {best, lo, hi} | null`.
- Plain-language text after a failed lookup: when a stored lookup could not reach JPL, `summary_plain` says the catalog couldn't be reached and the check is retried automatically. Never-checked and pending candidates keep their own wording.
- `known_object`: `checked`, `not_checked_reason`, `matched`, `catalogs_checked`, `search_radius_arcsec`, `designation`, `predicted_vmag`, `per_epoch[] {epoch_id, predicted_ra_deg, predicted_dec_deg, separation_arcsec}`, `nearest {designation, separation_arcsec} | null` (when unmatched), `observer`, `query_utc`, `enrichment` (`static | live | cached | pending`).
  - `catalogs_checked` lists **only services we actually queried**: `"JPL SBIdent"` and/or `"JPL Horizons"`. The model rejects anything else, so MPC can never appear unless we start calling it and update the contract.
- `scores`: `motion_consistency`, `snr`, `artifact_likelihood`, `overall` (all in [0, 1]), `quality_level` (`low | medium | high`), `method: "rule_based_v1"`, `definition`. **The score is a rule-based ranking, not a probability.** Nothing in the UI or text may describe it as a classifier probability. Thresholds: `high` if `overall ≥ 0.6`, `medium` if `≥ 0.3`, else `low`.
- `vetting[]`: raw checks `{check, description, value, threshold, passed}`. `passed` is `null` when a check couldn't be evaluated.
- `error_sources[]`: the frontend checklist, derived from `vetting` as `{id, label, explanation, status, evidence, from_checks}`. `status` is `ruled_out | not_ruled_out | unknown`. The ids are fixed:

  | id | label | derived from |
  |---|---|---|
  | `cosmic_ray` | Cosmic-ray hit or one-off glitch | `min_detections`, `flagged_aperture_pixels` |
  | `detector_artifact` | Bad pixels, ghosts or detector defects | `flagged_aperture_pixels`, `psf_like_shape`, `edge_distance` |
  | `misassociation` | Unrelated dots linked together | `motion_fit_pvalue`, `min_detections` |
  | `static_source` | A star or galaxy that didn't move | `not_static` |
  | `wavelength_change` | Brightness change caused by the filter, not the object | `flux_consistent_across_lambda` |
  | `known_object` | A catalogued asteroid or comet | `known_object_match` |
  | `catalog_gap` | Real object missing from the catalogs we checked | `known_object_match` (always `unknown` for unmatched candidates) |

- `explanation`: `{text, generator, grounded_fields, numeric_check, generated_utc} | null`. The text is generated **only** from values in this candidate JSON. `grounded_fields` are JSON paths into the same document and may use array indexes, e.g. `known_object.per_epoch[0].separation_arcsec`. `numeric_check` is `passed` when every number in `text` matches a grounded value after rounding. A failed check falls back to the template generator (`template_v1`).
- `spectrum`: `{units: {wavelength: "um", flux: "uJy"}, points: [{band_index, wavelength_um, flux_ujy, flux_err_ujy, epoch_id}]} | null`.
- `injection`: present only when `classification == "injected"`: `{study_id, injection_id, injected {mag_ab, flux_ujy, model, rate_arcsec_per_hr, position_angle_deg, distance_au}, recovered, recovered_rate_arcsec_per_hr, position_error_arcsec}`.
- `provenance`: `{run_id, generated_utc, parameters}`.
- `disclaimer`: a fixed integrity statement.

## Provenance (`source`)

Every epoch, detection, field image and stamp carries `source`:

```
{file, obs_id, planeid, detector, archive_url, cutout_url, cutout_method, cutout_region_pix, data_release, processing_note}
```

- `file`: Level 2 file name, e.g. `level2_2025W23_1C_0001_1D3_spx_l2b-v20-2025-251.fits`.
- `archive_url`: the full file in the public SPHEREx archive. That's `https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/qr2/level2/...` for data read from IRSA's AWS Open Data copy.
- `cutout_method`: `s3_byte_range` (we read only the cutout's rows from the public bucket, never the whole file) or `irsa_cutout` (IRSA's cutout service; `cutout_url` is set).
- `planeid`: the IRSA CAOM plane ID when the observation was found through IRSA TAP; otherwise `null`.
- The frontend refuses to render an image without `source`.

## Injection study (`InjectionStudy`)

`{study_id, generated_utc, simulated: true, field_ids, n_injected, n_recovered, mag_bins_ab, rate_bins_arcsec_per_hr, grid: [{mag_ab, rate_arcsec_per_hr, n_injected, n_recovered, fraction, ci_low, ci_high}], m50_by_rate: [{rate_arcsec_per_hr, m50_ab | null}], false_positives {n_control_runs, area_deg2, n_candidates, rate_per_deg2, ci_low_per_deg2, ci_high_per_deg2}, recovery_criteria, method_notes, example_candidate_ids}`. Intervals are Wilson 95% intervals for fractions and Poisson 95% intervals for rates.

## Objects (`ObjectSummary`, `ObjectDetail`, `ObjectPrediction`)

An object is one solar-system body: every detection linked to it, across visits and, once cross-field linking runs (build-plan row 6), across fields. Until then each candidate is one object, with `object_id = "obj-<candidate_id>"`.

- `ObjectSummary`: `object_id`, `classification`, `label_plain`, `summary_plain`, `thumbnail_url`, `field_ids`, `candidate_ids`, `n_detections`, `n_visits` (clusters of exposures more than 30 minutes apart), `first_time_utc`, `last_time_utc`, `arc_hours`, `rate_arcsec_per_hr`, `distance_class`, `distance_au_estimate`, `orbit_status`, `overall_score`, `quality_level`, `known_object_checked`, `known_object_matched`, `known_object_designation`.
- `ObjectDetail`: the same identity fields, plus `detections[]` (each a `Detection` with `field_id` and `candidate_id`), `motion`, `distance_class`, `orbit_status`, `orbit`, `known_object`, `scores`, `explanation`, `spectrum`, `history[] {utc, run_id, change}`, `provenance` and `disclaimer`.
- `distance_class`: `neo` (< 1.3 AU) · `main_belt` (1.8–4.2) · `jupiter_trojan` (4.8–5.6) · `centaur` (6–30) · `tno` (> 30) · `unknown`, from the distance from the Sun. With an orbit it is the class that at least 68% of the orbit clones fall in, and `unknown` when they spread over several classes (common for distant objects seen over a day or two: `validation/orbits.json` measures how often and how reliable a named class is); without an orbit, the parallax distance's best estimate. Gaps between ranges, and objects without a distance, are `unknown`.
- `orbit_status`: `none | preliminary | refined`. `orbit` is `OrbitalElements {epoch_mjd (TDB), a_au, e, i_deg, node_deg, peri_deg, mean_anomaly_deg (heliocentric J2000 ecliptic), q_au, method: ranging | least_squares, rms_arcsec, n_detections, arc_hours, covariance (6x6, [a, e, i, node, peri, M]) | null, n_clones, clones_url, jpl_comparison | null, helio_distance_au {best, lo, hi}, n_ranging_orbits, reported_orbit, check_30d}`, or null. `check_30d` is our predicted geocentric position 30 days after the last detection (a `PredictionPoint`: clones' centre and 1-σ ellipse).
  - `jpl_comparison {designation, delta_a_au, delta_e, delta_i_deg (ours − JPL's), position_error_arcsec_30d, jpl_a_au, jpl_e, jpl_i_deg, inside_3sigma_30d, jpl_helio_distance_au, our_helio_distance_au, distance_in_interval}`: added by the Worker when JPL identifies the object. With the JPL lookup it asks Horizons for JPL's osculating elements at our epoch (heliocentric, J2000 ecliptic) and JPL's geocentric position at `check_30d`, and stores the differences with the JPL result (two more Horizons calls per identified object, made by the background lookup or the cron, never while a visitor waits).
  - How it is fitted (`pipeline/spherex_px/science/orbit.py`): statistical ranging (Virtanen et al. 2001) samples the distances at the first and last detections, solves the orbit through those two positions (Lambert), and keeps every bound orbit whose fit to all detections (two-body motion, light time, SPHEREx's real position) is within Δχ² = 11.8 of the best. Least squares then refines the best one. If the arc pins the orbit (σ(a)/a < 0.1) the status is `refined` and clones come from the covariance. Otherwise it is `preliminary`, the reported elements are the most circular orbit that fits (`reported_orbit` says so in words), and the clones are drawn from the ranging distribution, weighted by likelihood under a prior uniform in distance (a log-uniform prior pulled distant objects too close in the simulated-asteroid test). Covariance is then the clones' sample covariance.
  - SPHEREx tracks span one to a few days, so most orbits are `preliminary`: `helio_distance_au` (median and 5–95% of the clones) is the robust result, the elements much less so. How well this works is measured on simulated asteroids in `validation/orbits.json` (below).
  - `clones_url` → `OrbitClones {object_id, epoch_mjd, frame: "heliocentric J2000 ecliptic", clones[] {a_au, e, i_deg, node_deg, peri_deg, mean_anomaly_deg}}` (100 clones), for the uncertainty cloud.
- `ObjectPrediction {object_id, generated_utc, orbit_epoch_mjd, observer: "geocenter", days, points[] {time_utc, mjd, ra_deg, dec_deg, sigma_major_arcsec, sigma_minor_arcsec, sigma_pa_deg, vmag_estimate}, note_plain}`: daily positions from the day the data was published, for 60 days. Each point is the centre and 1-σ ellipse of the clones' positions (not the reported orbit's, which for short arcs can sit at the edge of the cloud). `vmag_estimate` is null (no brightness model yet). `note_plain` says how far the orbit can be trusted: arcs of a day or two from months ago leave the position uncertain by degrees, and the note says that it needs new observations to be found again.
- `GET /api/validation/orbits` → `OrbitValidation {generated_utc, simulated: true, method, geometry_from[], per_population, seed, rows[] {population: neo | main_belt | jupiter_trojan | centaur | tno | all, n, distance_in_5_95_interval, distance_rel_error_median, distance_class_named, distance_class_correct (among named), a_rel_error_median, e_abs_error_median, i_abs_error_deg_median, prediction_30d_error_arcsec_median, prediction_30d_inside_2sigma, prediction_30d_inside_3sigma, refined_fraction}}`: the orbit method run on simulated asteroids with known orbits, observed at real SPHEREx times and positions (`spherex-px orbit-validation`). The comparison with JPL's orbits of real identified objects is `orbit.jpl_comparison`, summarized by `GET /api/validation/jpl-orbits` → `{n_identified, n_compared, distance_in_interval, delta_a_au_abs_median, delta_e_abs_median, delta_i_deg_abs_median, position_error_arcsec_30d_median, inside_3sigma_30d, rows[] (each a jpl_comparison with object_id)}` (fractions and medians over the compared objects; null when there are none).

## Survey (`Survey`)

`{generated_utc, name, description, tile_size_deg, data_releases, tiles[], totals, last_run, runs[]}`.

- `tiles[]`: `{tile_id, center, ecliptic_lon_deg, ecliptic_lat_deg, size_deg, status, n_epochs, n_visits, first_time_utc, last_time_utc, last_processed_utc, field_id, n_candidates, m50_ab, m50_study_id, detail}`. `status`:
  - `processed`: searched, and the search found a moving object; `field_id` is its field page.
  - `empty`: searched, no moving object passed vetting, so there is no field page (`field_id: null`). This is how the sky map shows where we looked and found nothing.
  - `failed`: the last search of this tile failed; `detail` says why (for example an S3 read error). It is retried by the next run that plans it.
  - `pending` / `no_data`: covered but not searched yet / no repeated SPHEREx visits.
- `m50_ab` is the 50% completeness magnitude (linear tracks at 3–100″/hr) for that tile from the newest published injection study (`m50_study_id`), null where no study has measured it.
- `totals {n_tiles, n_processed, area_deg2_processed, n_epochs, n_candidates, n_objects, n_searched, n_empty, n_failed, area_deg2_searched}`; `n_searched` and `area_deg2_searched` count processed plus empty tiles. The Worker adds `n_known_objects` (see endpoints).
- `last_run` and `runs[]` (newest first, up to 20) come from the run ledger: `{run_id, started_utc, finished_utc, pipeline_version, n_new_files (exposures in tiles searched for the first time), n_tiles_processed (tiles searched), n_new_objects (objects not published before), segments, n_tiles_with_movers, n_tiles_empty, n_tiles_failed, n_candidates, workflow_url}`.
- Storage: after each run of the `Survey` Action (`.github/workflows/survey.yml`), `spherex-px survey-ledger` updates `data/survey/footprint.json` (every tile ever searched, with its latest result) and appends to `data/survey/ledger.json`; `spherex-px publish` folds both into `survey.json`.

## AI (`AiWriteup`, `AiAnswer`, `AiSearch`, `Digest`)

Generated by Workers AI from the subject's JSON only (build-plan section 6), and cached in KV for 30 days by a SHA-256 hash of the model, prompt version and exact input. Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (the `AI_MODEL` var in `wrangler.toml`; every AI response names the model it used). Code: `worker/src/ai/`.

Every output is checked before it is shown. It must parse as JSON in the expected shape, every cited JSON path must resolve in the subject's report, every number in the text must match a cited value (rounding allowed), and it may not claim a discovery or call anything Planet X. Anything that fails is replaced by deterministic text and never cached. Daily call caps (write-ups 400, questions 600, searches 600, digests 10) keep usage inside the free 10,000 neurons/day; past a cap, or without the AI binding, the same fallbacks apply.

- `AiWriteup {subject_kind: candidate | object, subject_id, verdict, paragraphs[3], grounded_fields, numeric_check, source: ai | template, model, label_plain, cached, generated_utc}`. AI text has `source: "ai"` and `label_plain: "AI-written from the measurements below"`. The template fallback has `source: "template"`, `model: null` and `label_plain: "Written from the measurements below"`. While the JPL check is still `pending`, the template is returned (`Cache-Control: no-store`) so the write-up never runs ahead of the catalog check; refetch when the report's `known_object.enrichment` is no longer `pending`.
- `AskRequest {subject_kind, subject_id, question (1–500 chars), session_id (8–64 chars of A–Z a–z 0–9 - _)}` → `AiAnswer {question, answer, citations (JSON paths in the subject's report), answered_from_data, numeric_check, model, cached, generated_utc}`. `answered_from_data: false` means the data doesn't answer the question: either a definition from the glossary (no numbers allowed), or `answer: "The data in this report doesn't tell us that."`. That same text with `numeric_check: "failed"` and `model: null` means the model's answer was rejected. Limits: 20 questions per session and 60 per IP address per hour (`429` with `Retry-After`); `409` while the JPL check is pending. Session ids and IP addresses are stored only as salted SHA-256 hashes.
- `SearchRequest {query (1–300 chars)}` → `AiSearch {query, filter: CandidateFilter, explanation_plain, valid, model, cached}`. `CandidateFilter {classification[], rate_min_arcsec_per_hr, rate_max_arcsec_per_hr, distance_class[], field_id[], min_score, include_injected, sort: score | rate | newest | unusual}`. `field_id` values are always ids from `fields.json`; asking for `injected` turns `include_injected` on. `explanation_plain` is written by code from the validated filter, never by the model. The frontend shows the applied filter as editable chips. `valid: false` means the model's output failed validation (or the AI was unavailable) and the filter is empty. Limit: 60 searches per IP address per hour.
- `Digest {date, text, grounded_fields (JSON paths in the run ledger), numeric_check, run_id, model, generated_utc}`.

## Sky requests and vetting votes (D1)

- `SkyRequestCreate {ra_deg, dec_deg, turnstile_token, note?}` → `SkyRequest {request_id, status: queued | processing | done | no_coverage | rejected, ra_deg, dec_deg, created_utc, updated_utc, position_in_queue, field_id, message}`.
- `VettingItem {item_id, candidate_id, epoch_id, stamps {detection, reference, difference} (ImageRef each), model_score, model_version}`. `VoteCreate {item_id, label: real | artifact | unsure, session_id, turnstile_token}` → `VoteResult {accepted, item_id, counts {real, artifact, unsure}, message}`. `VettingStats {n_votes, n_sessions, n_items_labeled (>= 5 votes and >= 80% agreement), agreement_with_experts, models[] {version, trained_utc, n_train_real, n_train_bogus, n_votes_used, test_precision, test_recall, test_roc_auc, promoted}}`.
- Storage: D1 database `spherex-planet-x` (binding `DB`), schema in `migrations/`. Tables: `sky_requests`, `vetting_items`, `votes` (one vote per session per item), `model_versions`, `tracked_objects`, `rate_limits`, `ai_usage`, `enrichment` (JPL results, one row per data version and candidate), `locks`, plus `schema_migrations`. Visitor identifiers are stored only as salted SHA-256 hashes. The Worker applies the migrations itself on first use (`worker/src/db.ts`, kept identical to `migrations/` by a test).

## Health, coverage and runs

- `Health {status: ok | degraded, checked_utc, build_run_id, fields_loaded, candidates_loaded, upstream: [{name, url, reachable, http_status, latency_ms, detail, probed_utc, cached}]}`. `reachable` is true only when the upstream answered a minimal valid request with HTTP 200 and the expected body: a VOSI availability document for IRSA TAP, JSON with `signature` for JPL SBIdent (a one-arcminute field-of-view query) and Horizons, and a bucket listing for S3. An HTTP 400 or an error page is not reachable. `probed_utc` and `cached` say when the result was measured and whether it was reused (up to 10 minutes). `status` is `ok` when every upstream is reachable and static data is loaded.
- `Coverage {center, radius_deg, searched, n_epochs, truncated, epochs: [{obs_id, planeid, detector, bandpass, time_utc, mjd, time_end_utc, wavelength_um_range, archive_url, cutout_url}]}`. Values come straight from IRSA's `spherex.plane` and `spherex.artifact` tables. Fields IRSA doesn't return are `null`.
- `RunStatus {run_id, status, progress, message, request, field_id, created_utc, updated_utc}`.

## Static data layout (`frontend/public/data/`, written by `spherex-px build`)

| Path | Model |
|---|---|
| `data/fields.json` | `FieldList` |
| `data/fields/{field_id}.json` | `FieldDetail` |
| `data/fields/{field_id}/{epoch_id}.webp`, `thumb.webp` | field images |
| `data/candidates.json` | `CandidateList` (all candidates, including injected) |
| `data/candidates/{candidate_id}.json` | `CandidateDetail` (static, before enrichment) |
| `data/candidates/{candidate_id}/{epoch_id}.webp`, `thumb.webp` | 64 px stamps |
| `data/injection/{study_id}.json` | `InjectionStudy` |
| `data/runs/{run_id}.json` | `RunStatus` |
| `data/objects.json` | `ObjectList` |
| `data/objects/{object_id}.json` | `ObjectDetail` |
| `data/objects/{object_id}/prediction.json` | `ObjectPrediction` (once the object has an orbit) |
| `data/survey.json` | `Survey` |

`fields.json`, `candidates.json`, `objects.json` and `survey.json` always carry the `pipeline_version` and `build_run_id` of the files they list. The Worker keys stored JPL results by `pipeline_version`, so publishing refuses to mix versions.

## Fixtures

`shared/fixtures/` holds `fields.json`, `field_detail.json`, `candidates.json`, `candidate_detail.json`, `health.json` and, once a study is published, `injection_study.json`. They are **real API responses** for real SPHEREx data, saved byte for byte (pretty-printed) by `scripts/record-fixtures.mjs`. Nothing in them is hand-written or invented. `manifest.json` records the source URL, time and HTTP status of each file.

- `node scripts/record-fixtures.mjs` records from a local `npx wrangler dev` (or `npm run dev:offline`). A local Worker without JPL access records `known_object.checked: false` with the reason, and health shows JPL and IRSA as unreachable.
- `node scripts/record-fixtures.mjs --base https://spherex-planet-x.bodhishanbhag.workers.dev` records production, including live JPL results. The `Record API fixtures` GitHub Action (`.github/workflows/fixtures.yml`, weekly and on demand) does this and opens a pull request.
- `spherex-px validate-fixtures` (and the pipeline tests) validate every fixture against the contract models.

Synthetic sources appear only in injected candidates, classified `injected`. Image URLs in fixtures point at `/data/...`, which the frontend serves from `frontend/public/data/`.
