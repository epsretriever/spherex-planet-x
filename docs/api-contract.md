# API contract (v1.0)

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

Changes to the contract go into all three in the same commit. Breaking changes bump `schema_version`.

## Conventions

| Rule | Detail |
|---|---|
| Naming | snake_case, units in the field name: `flux_ujy`, `flux_err_ujy`, `x_pix`, `rate_arcsec_per_hr`, `time_span_hours`, `fit_residual_rms_arcsec`. |
| IDs | `field_id`, `epoch_id`, `candidate_id`. `obs_id` **always** means the SPHEREx/IRSA observation ID (the `OBSID` FITS keyword, e.g. `2025W23_1C_0001_1`). |
| Envelope | Every top-level response carries `schema_version: "1.0"` and `pipeline_version` (package version + git commit, e.g. `0.1.0+git.abc1234`). |
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
| `GET /api/health` | `Health` | Live probe of each upstream (IRSA TAP, JPL SBIdent, JPL Horizons, SPHEREx S3) + static data counts. Never cached. |
| `GET /api/fields` | `FieldList` | Static `data/fields.json`. Each field's `candidate_counts` reflects the static (pipeline) classification. |
| `GET /api/fields/{field_id}` | `FieldDetail` | Static `data/fields/{field_id}.json`. `movers[].classification` reflects the static classification. |
| `GET /api/candidates?field_id=&classification=&min_score=&include_injected=false` | `CandidateList` | Static `data/candidates.json`, with each summary's known-object fields taken from enrichment results already in the cache. A candidate whose enrichment is not cached yet keeps `known_object_checked: false`. `classification` may repeat. `min_score` filters on `overall_score`. Injected candidates are excluded unless `include_injected=true` or `classification=injected` is requested. |
| `GET /api/candidates/{candidate_id}` | `CandidateDetail` | Static `data/candidates/{candidate_id}.json`, **enriched live** (see [Known-object enrichment](#known-object-enrichment)). |
| `GET /api/injection/{study_id}` | `InjectionStudy` | Static `data/injection/{study_id}.json`. |
| `GET /api/coverage?ra_deg=&dec_deg=&radius_deg=` | `Coverage` | **Live** IRSA TAP (`https://irsa.ipac.caltech.edu/TAP/sync`). |
| `POST /api/runs` | `ErrorResponse` (501) | Pixel processing can't run inside a Worker. Runs are produced offline with `spherex-px run --ra ... --dec ...` and published with the static data. The endpoint returns 501 with instructions instead of pretending to queue work. |
| `GET /api/runs/{run_id}` | `RunStatus` | Static `data/runs/{run_id}.json` for runs built offline. `field_id` points at the resulting field. |
| `GET /data/...` | images, JSON | Static files: WebP field images, thumbnails, 64 px stamps. URLs in responses are root-relative (`/data/...`). |

**Upstream calls** (Worker): 15 s timeout, descriptive `User-Agent`, successful responses cached with the Cache API (`caches.default`) for 24 hours.

**Errors** are JSON `ErrorResponse {detail, upstream, upstream_status}`. `404` means an unknown id. `400` means invalid parameters. `502` means an upstream answered with an error (`upstream_status` is its HTTP status). `504` means an upstream timed out (`upstream_status: "timeout"`). `501` is returned for `POST /api/runs`.

### Known-object enrichment

The pipeline writes every candidate with `known_object.checked = false`, `enrichment: "static"` and `catalogs_checked: []`, because the offline builder has no JPL access. It never writes a match it did not check. On `GET /api/candidates/{candidate_id}` the Worker:

1. Queries **JPL SBIdent** once per detection epoch, with the geocenter as observer (`mpc-code=500`), the exposure midpoint as `obs-time`, and a field of view centered on the detection with a half-width of 0.05° (180″). That's wide enough to include objects whose geocentric position is offset by SPHEREx's parallax.
2. For objects SBIdent returns, queries **JPL Horizons** (geocentric observer, one request with all epoch times) for RA, Dec and distance, then corrects each position to SPHEREx's own vantage point using `spacecraft_geocentric_km` (SPHEREx orbits about 700 km up, which shifts nearby objects by several arcseconds).
3. Calls a candidate `known_object` only if one object lies within `search_radius_arcsec` of the detection at **every** epoch. Otherwise the candidate stays as the pipeline classified it, with `nearest` set to the closest object returned.
4. Sets `checked`, `catalogs_checked` (only the services that actually answered), `observer`, `query_utc`, `enrichment` (`live` or `cached`), and regenerates `label_plain`, `summary_plain`, the `known_object` and `catalog_gap` error sources, and `explanation` from the updated values.
5. If JPL is unreachable, the candidate is returned with `checked: false` and a `not_checked_reason`. The response is still `200`, because the rest of the report is valid.

Injected candidates are never sent to JPL and are never relabelled.

## Field (`FieldSummary`, `FieldDetail`)

- `name` and `blurb` come from the curated showcase config (`pipeline/spherex_px/config/showcase.toml`). `summary_plain` is generated by the backend from measured values only.
- `wcs` is the **one common grid** for the field: `{projection: "TAN", crval: [ra, dec], crpix: [x, y], cdelt_arcsec, width_px, height_px, rotation_deg}`. Field images are 0.3° cutouts (about 175 px at 6.15″/px) reprojected onto this grid. The frontend upscales them and must not assume a fixed size such as 512 px.
- Image orientation: `crpix` is 1-based in the FITS convention. Rendered images have north up and east left when `rotation_deg = 0`. Image row 0 is the top (`y_grid = height_px`). Convert an overlay point with `col = x_grid - 0.5` and `row = height_px - y_grid + 0.5`, in image-pixel units.
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
- `known_object`: `checked`, `not_checked_reason`, `matched`, `catalogs_checked`, `search_radius_arcsec`, `designation`, `predicted_vmag`, `per_epoch[] {epoch_id, predicted_ra_deg, predicted_dec_deg, separation_arcsec}`, `nearest {designation, separation_arcsec} | null` (when unmatched), `observer`, `query_utc`, `enrichment` (`static | live | cached`).
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

## Health, coverage and runs

- `Health {status: ok | degraded, checked_utc, fields_loaded, candidates_loaded, upstream: [{name, url, reachable, http_status, latency_ms, detail}]}`.
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

## Fixtures

`shared/fixtures/` holds `fields.json`, `field_detail.json`, `candidates.json`, `candidate_detail.json` and `injection_study.json`. They are **recorded responses for real SPHEREx data**, copied by `spherex-px record-fixtures` from the static data the Worker serves. Nothing in them is hand-written or invented. Synthetic sources appear only in injected candidates, classified `injected`. Image URLs in fixtures point at `/data/...`, which the frontend serves from `frontend/public/data/`.
