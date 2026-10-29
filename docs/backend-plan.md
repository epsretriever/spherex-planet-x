# Backend plan: spherex-planet-x

NASA Space Apps Challenge 2026 · Planet X and SPHEREx · Backend owners: Bodhi (data, image analysis, scientific validation) and the AI/ML + backend + integration teammate.

> **Data access status (verified Oct 29, 2026).** The SPHEREx Level 2 files are on IRSA's public AWS Open Data bucket (`nasa-irsa-spherex`), and the backend reads them there with HTTP byte-range requests (section 3.0). File layout, header keywords, flag bits, the PSF grid and the wavelength lookup table below were checked against real files. IRSA's own services (`irsa.ipac.caltech.edu`) and JPL's (`ssd-api.jpl.nasa.gov`, `ssd.jpl.nasa.gov`) are blocked by the current cloud environment's network policy, so the IRSA TAP/SIA and JPL clients are implemented but have only been tested against recorded responses. Items still marked **[verify]** depend on those services.
>
> The JSON contract with the frontend is in [docs/api-contract.md](api-contract.md). It replaces the draft schema that was in section 5.

## 1. Goals and non-goals

**Goals**
1. Given a sky position, find every SPHEREx observation that covers it and fetch **small cutouts only**.
2. Detect sources in each epoch, find sources that moved, and link them across epochs into candidates.
3. Check each candidate against known small bodies at each observation time.
4. Score candidates with transparent, rule-based metrics: motion consistency, S/N, and artifact likelihood.
5. Serve aligned image cutouts (PNG/WebP) and JSON candidate reports to the frontend (Explorer and Detective modes).
6. Measure what the pipeline can actually recover by injecting synthetic moving objects into real images.

**Non-goals**
- Claiming a Planet X detection. The README's scientific-integrity statement applies to every output.
- Downloading full images (a 2040×2040 multi-extension file is tens of MB) or bulk archive data.
- Training a large classifier. There is essentially no labelled SPHEREx moving-object data (section 6.4).

### Honest science expectations (put this in the demo)
- A hypothetical Planet Nine at a few hundred AU would probably be fainter than SPHEREx's single-exposure point-source depth. Single-exposure 5σ depths are of order AB ≈ 18–19.5 per band **[verify against the Explanatory Supplement]**. The injection-recovery test (section 7) is how we turn this into a measured limit instead of a claim.
- What we *can* realistically show: recovering known main-belt asteroids, known bright TNOs or dwarf planets (a community 2026 project used Makemake as a test target), and a measured completeness curve.

---

## 2. Pipeline architecture

```
             ┌──────────────────────────────────────────────────────────────────┐
  request →  │ 0. Field request  (ra, dec, radius, optional time/band filters)   │
             └───────────────┬──────────────────────────────────────────────────┘
                             ▼
  IRSA TAP ─► 1. Discover   list observations covering the position (spherex.plane/artifact)
                             ▼
  IRSA cutout► 2. Fetch     small MEF cutouts (IMAGE, FLAGS, VARIANCE, ZODI, PSF, WCS-WAVE), disk cache
                             ▼
             3. Calibrate   subtract ZODI, build per-pixel λ map, bad-pixel mask from FLAGS, noise = √VARIANCE
                             ▼
             4. Align       celestial WCS from header → common tangent-plane grid (for display + matching)
                             ▼
             5. Detect      per-epoch background + source detection + PSF/aperture photometry (Photutils)
                             ▼
             6. Static sky  match detections across epochs + to static IR catalogs → "unmatched" set
                             ▼
             7. Link        connect unmatched detections into tracks (linear-rate and parallax models)
                             ▼
  JPL SBIdent► 8. Identify  known-object prediction per epoch → label tracks known / unmatched
  JPL Horizons               ▼
             9. Score       motion consistency, S/N, artifact likelihood → vetting table
                             ▼
            10. Explain     text built only from measured fields in the report (section 5.3)
                             ▼
            11. Serve       FastAPI: PNG/WebP cutouts, blink sequences, JSON candidate reports
```

### Module layout

All code lives in `backend/spherex_px/` (the frontend works in `frontend/`).

| Module | Responsibility |
|---|---|
| `schemas.py`, `contract.py` | API contract (Pydantic models), JSON Schema export, fixture validation |
| `data/s3.py` | Public SPHEREx bucket: listing, byte-range reads, on-disk cache |
| `data/l2file.py` | Level 2 file layout from headers; row-strip cutouts of IMAGE, FLAGS, VARIANCE, ZODI; one PSF plane; WCS-WAVE |
| `data/index.py` | Coverage index built from exposure headers (pointing footprints and times) |
| `data/spectral.py` | Per-pixel wavelength from WCS-WAVE; the 102-channel calibration table |
| `data/flags.py` | FLAGS bit definitions (from the file header) |
| `data/irsa.py` | IRSA TAP discovery and cutout-service client (used when IRSA is reachable) |
| `data/jpl.py` | JPL SBIdent and Horizons clients with caching |
| `science/grid.py` | Common tangent-plane grid and reprojection (for display; measurements stay in native pixels + WCS) |
| `science/detect.py` | Background, source detection, photometry, PSF-shape test |
| `science/link.py` | Static-source rejection, tracklet building, motion fitting |
| `science/vetting.py` | Rule-based checks, scores, error sources, classification |
| `science/explain.py` | Grounded explanation + numeric consistency check |
| `science/inject.py` | Injection-recovery harness |
| `build.py`, `render.py` | Build a field (showcase or run) into products; WebP rendering |
| `api/` | FastAPI app, run queue |

**Runtime model:** a field run takes minutes (dozens of cutouts), so `POST /runs` starts a background job and the frontend polls for status. Plain FastAPI `BackgroundTasks` plus a process pool is enough. For the demo, **precompute 3–5 showcase fields** and serve them from cache, so judging never depends on IRSA latency.

---

## 3. Data endpoints

### 3.0 Public SPHEREx bucket on AWS (verified, used now)

IRSA mirrors the SPHEREx Quick Release Level 2 files to the AWS Open Data bucket `nasa-irsa-spherex` (region us-east-1, anonymous HTTPS):

```
https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/qr2/level2/<week>/<l2b-version>/<detector>/level2_<obsid>D<detector>_spx_<l2b-version>.fits
e.g. qr2/level2/2025W23_1C/l2b-v20-2025-251/3/level2_2025W23_1C_0001_1D3_spx_l2b-v20-2025-251.fits
```

- QR2 spans weeks 2025W17 to 2026W29 (129 week segments). QR3 starts at 2026W30. Each week segment holds about 1,600 files per detector.
- Files are **uncompressed**, 71.6 MB multi-extension FITS. Measured layout (byte offsets are stable): PRIMARY, IMAGE (2040×2040 float32, MJy/sr), FLAGS (int32), VARIANCE, ZODI, PSF (101×101×121, 10× oversampled at 0.615″/px, 11×11 zones), WCS-WAVE (bintable: X[9], Y[14], VALUES[2,9,14]).
- **We never download whole files.** A cutout reads only the rows it covers from each image extension (one byte range per extension), plus one PSF plane and the WCS-WAVE table. A 0.3° cutout transfers about 1.4 MB per image extension, roughly 6 MB per exposure in total.
- The IMAGE header has everything we need for discovery and science: `OBSID`, `DETECTOR`, `MJD-BEG/AVG/END`, `DATE-AVG`, `XPOSURE`, the celestial WCS (`RA---TAN-SIP` with SIP distortion), the 0-based pixel WCS `A`, the spectral WCS `W` (`WAVE-TAB` lookup into WCS-WAVE), the spacecraft geocentric position and velocity (`X_SC`, `Y_SC`, `Z_SC`, `VX_SC`…, km and km/s), the pixel solid angle (`OMEGA_MEDIAN`, ≈ 37.9 arcsec² ≈ (6.15″)²), the median PSF FWHM (`PSF_FWHM`, ≈ 5.2″) and DQA outcomes (`L2DQAFLG`).
- Discovery without IRSA TAP: `data/index.py` builds a coverage index from exposure headers (one header read ≈ 23 KB). The survey is Sun-synchronous, so a sky position is only observed when the Sun is about 90° away in ecliptic longitude. That lets us scan only the matching week segments.
- The 102-channel definitions (`qr2/spectral_channels/.../spectral_channels_spx_cal-sch-v1-2026-106.fits.gz`) give each channel's wavelength, range, resolving power R (≈ 37–43 for D1–D4, ≈ 130 for D6) and bandwidth. We use them for `band_index` and the λ-matching tolerance.

### 3.1 IRSA: discover observations (TAP, used when reachable)

- Endpoint: `https://irsa.ipac.caltech.edu/TAP` (pyvo `TAPService`, sync queries).
- Tables: `spherex.plane` (one row per spectral image: footprint `poly`, `time_bounds_lower/upper`, `energy_bandpassname` such as `SPHEREx-D1`…`SPHEREx-D6`) joined to `spherex.artifact` (file `uri`) on `planeid`. IRSA's own SPHEREx cutout and PSF tutorials use this pattern **[verify column names; check time units: CAOM convention is MJD]**.
- A standard `spherex.obscore` table also exists and is a fallback **[verify]**.

```sql
-- Illustrative ADQL, following IRSA's SPHEREx cutout tutorial
SELECT 'https://irsa.ipac.caltech.edu/' || a.uri
         || '?center=' || 150.1 || ',' || 2.2 || '&size=' || 0.1  AS cutout_url,
       p.energy_bandpassname, p.time_bounds_lower, p.time_bounds_upper, p.planeid
FROM spherex.artifact a
JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', 150.1, 2.2), p.poly)
ORDER BY p.time_bounds_lower
```

Notes:
- IRSA TAP supports only **one geometric constraint per query**, so use one `CONTAINS` against the footprint.
- IRSA's PSF tutorial reports one position returning **413 images**, which tells us the volume to expect. We filter by time window and band before fetching.
- Raise `astropy`'s remote-data timeout. IRSA's tutorials say SPHEREx reads can be slow.

### 3.2 IRSA: SIA v2 (secondary / cross-check)

- Endpoint: `https://irsa.ipac.caltech.edu/SIA` with `COLLECTION=spherex_qr2` (Wide), `spherex_qr2_deep` (Deep), `spherex_qr2_cal` (calibration) **[verify current collection list]**.
- Via astroquery: `Irsa.query_sia(pos=(coord, radius), collection='spherex_qr2')`.
- Caveats from community reports: QR3 images may only be reachable through TAP and not SIA2 (reported Sept 2026), SIA can lag ingestion by about a day, and one team saw HTTP 503s on SIA2 but not on TAP. **TAP is our primary path; SIA is a fallback.**

### 3.3 IRSA: cutouts (the only way we fetch pixels)

- Append `?center=<ra>,<dec>&size=<deg>` to an on-premises spectral-image URL (`/ibe/data/spherex/...`). Units are degrees. The result is a **multi-extension FITS cutout** that keeps the IMAGE, FLAGS, VARIANCE, ZODI, PSF, and WCS-WAVE extensions **[verify that every extension survives the cutout, especially WCS-WAVE and PSF]**.
- Default size is 0.1° (≈ 58 px at about 6.2″/px). For slow, distant movers, an epoch pair ~6 months apart can shift by more than 100 px (section 4.3), so the parallax search uses 0.3–0.5° cutouts or a second center.
- Cache every cutout on disk and never refetch. Cap concurrency at 4 parallel requests and retry with exponential backoff.
- Fallback for bulk tests only: the SPHEREx QR data on the AWS Open Data registry. That's full files, though, so we don't use it in the app.

### 3.4 Static reference catalogs (vetting)

Through IRSA TAP: AllWISE (`allwise_p3as_psd`) and 2MASS (`fp_psc`) cone searches around the field. Both are infrared catalogs that overlap SPHEREx wavelengths. Gaia DR3 is optional, for astrometric sanity checks. Their job is to label a detection "static" when it sits on a catalogued star or galaxy.

### 3.5 JPL Small-Body Identification (SBIdent)

- Endpoint: `GET https://ssd-api.jpl.nasa.gov/sb_ident.api` (docs: `https://ssd-api.jpl.nasa.gov/doc/sb_ident.html`).
- Returns known asteroids and comets inside a field of view for a given time and observer.
- Parameters we expect to use **[verify every name and format against the doc page]**: `obs-time`, `fov-ra-center`, `fov-dec-center`, `fov-ra-hwidth`, `fov-dec-hwidth`, `vmag-lim`, `sb-kind`, `two-pass` / `suppress-first-pass` (accurate second-pass positions), and an observer location as either `mpc-code` or an explicit geocentric observer state `xobs` (six comma-separated values).
- Illustrative call:
  ```
  https://ssd-api.jpl.nasa.gov/sb_ident.api?mpc-code=500&obs-time=2025-09-10_04:12:00
      &fov-ra-center=10-00-24.0&fov-dec-center=02-12-00&fov-ra-hwidth=0.1&fov-dec-hwidth=0.1
      &two-pass=true&suppress-first-pass=true&vmag-lim=22
  ```
- **Observer location matters.** SPHEREx is in a ~700 km Sun-synchronous orbit. Using the geocenter (`mpc-code=500`) instead of the spacecraft gives a parallax error of roughly 6,400–7,100 km / Δ. That's about 10″ (~1.6 px) for an object 1 AU away, more for NEOs, and negligible for TNOs. Plan:
  1. Query SBIdent with the geocenter and a FOV padded by 0.05°.
  2. For each returned object, refine its predicted position with Horizons using SPHEREx as the observer (or pass the spacecraft's geocentric state from Horizons as `xobs`).
  3. Match radius = max(2 px, 3σ of prediction + measurement error).
- Run one query per epoch at mid-exposure time and cache by (field, time).
- Python helper option: the community `sbident` package wraps this API. We can read its source to confirm parameter formats.
- Backup service: IMCCE SkyBoT cone search.

### 3.6 JPL Horizons

- `GET https://ssd.jpl.nasa.gov/api/horizons.api`, or `astroquery.jplhorizons`.
- Uses: (a) the SPHEREx spacecraft ephemeris, to correct observer parallax **[verify that Horizons carries SPHEREx and find its ID; search "SPHEREx" in Horizons]**; (b) precise positions of matched known objects; (c) ground-truth tracks for showcase demo fields (e.g., a known TNO).

### 3.7 Network allowlist for dev environments

`irsa.ipac.caltech.edu`, `ssd-api.jpl.nasa.gov`, `ssd.jpl.nasa.gov`, and optionally `caltech-ipac.github.io` (tutorials) and `vo.imcce.fr` (SkyBoT). The current cloud environment blocks all of them; they need to be added under Allowed domains in the environment's network settings. `nasa-irsa-spherex.s3.us-east-1.amazonaws.com` (section 3.0) is already reachable.

---

## 4. Handling the Linear Variable Filter (LVF) problem

### 4.1 The problem
Each SPHEREx detector sits behind a linear variable filter, so the central wavelength changes continuously across the array. Six detectors (D1–D6) cover 0.75–5.0 µm in 102 channels. When the same sky position is observed at two epochs, it usually lands on a **different detector row**, so **at a different wavelength**. A star's brightness changes with wavelength, so a naive A − B difference leaves residuals at every star and creates fake "changes".

The per-pixel wavelength is in the **WCS-WAVE** extension. It's a lookup table (one row; columns `X`, `Y`, `VALUES`) of control points in pixel space, with bilinear interpolation between the four nearest points. It gives approximate central wavelength and bandwidth per pixel. The **ZODI** extension holds a zodiacal-light model that is *not* subtracted from IMAGE, and zodiacal light also varies with epoch and wavelength.

### 4.2 Strategy, in order of preference

1. **Compare positions, not pixels (primary detector of motion).** Detect sources independently in each epoch and compare *catalogs*. A static star stays at the same RA/Dec whatever wavelength it was seen at. Only its flux changes. A detection that has no counterpart within r (≈ 1.5 px) in other epochs and isn't in AllWISE/2MASS is "unmatched". This step never subtracts images, so the LVF can't create fake changes. Flux comparisons use a wide, SED-aware tolerance, never an exact match.
2. **Wavelength-matched differencing (secondary, for visualization and faint-source checks).** Build a per-pixel λ map for every cutout from WCS-WAVE. Only difference two epochs when, across the cutout, |λ_A − λ_B| / λ < 1/(2R). Resolving power is R ≈ 35–130 depending on band **[verify]**, so the tolerance is roughly 0.4–1.4%. Before differencing:
   - subtract ZODI from both frames;
   - put both on a common grid (reproject B onto A's WCS);
   - fit a single flux scale (plus offset) using matched, unflagged stars, which absorbs residual λ and calibration mismatch;
   - convolve to the broader of the two PSFs (taken from each frame's PSF extension at the cutout position).
   Pairs that fail the λ test are never differenced. The UI still blinks them, labelled "different wavelengths: brightness differences are expected".
3. **Wavelength-binned static template (if time allows).** In well-covered fields, especially the Deep survey near the ecliptic poles, take the median of many epochs per λ bin to build a static-sky template, then subtract the template at the matching λ.
4. **Record λ everywhere.** Each detection stores its own wavelength and bandwidth. The JSON report exposes them so the explanation and the UI can say "seen at 1.42 µm vs 1.47 µm".

### 4.3 Motion regimes and linking (the hard part)

| Object | Typical sky motion | Over one survey visit (hours–days) | Between surveys (~6 months) |
|---|---|---|---|
| Main-belt asteroid | ~30–40″/hr ≈ 5–6 px/hr | moves a lot; easy to link in consecutive exposures | gone, a different object |
| TNO at 40 AU | ~3″/hr ≈ 0.5 px/hr | a few px/day | ~0.7° jump from parallax |
| Hypothetical body at 300–700 AU | ~0.2–0.5″/hr | ≲ 1 px/day, looks static | ~0.2–0.4° (≈ 100–200 px) jump |

Linking models:
- **Short-baseline linear linking (within a visit).** Fit RA/Dec vs time to ≥ 3 detections with a constant rate. Search tracklets across rate bins 0.1–100″/hr. A detection seen in only one exposure is never a candidate on its own.
- **Parallax-constrained linking (across ~6-month epochs).** For a slow, distant object, the shift between two widely separated epochs is dominated by Earth's reflex motion. Its *direction* is known from Earth's heliocentric positions at the two times, and its size scales as ≈ 1/d. For a grid of trial distances d (30–1000 AU), predict where each unmatched epoch-A detection should appear in epoch B. Accept pairs inside a small window, then require the best-fit d to be consistent with any third epoch. This turns an impossible all-pairs search into a 1-D search over distance. With only two epochs, a pair is always labelled "unconfirmed pair". It is never a detection.
- Report the number of detections, time baseline, best model, and fit residuals for every track.

---

## 5. JSON contract

The contract is in **[docs/api-contract.md](api-contract.md)**. The models are in `backend/spherex_px/schemas.py`, JSON Schema in `shared/schema/`, and recorded examples in `shared/fixtures/`. In short:

- Public endpoints read precomputed showcase fields: `GET /api/fields`, `/api/fields/{field_id}`, `/api/candidates`, `/api/candidates/{candidate_id}`, `/api/injection/{study_id}`, `/api/health`. The "analyze any position" feature adds `/api/coverage`, `POST /api/runs` and `GET /api/runs/{run_id}`, and a finished run yields the same field and candidate shapes.
- Classification: `known_object | unmatched | likely_artifact | unconfirmed_pair | injected`, owned by the backend.
- Scores: `motion_consistency`, `snr`, `artifact_likelihood`, `overall`, `quality_level`, `method: rule_based_v1`. This is a ranking score, never a probability.
- Every image, epoch, detection and stamp carries `source` provenance.

### 5.1 Grounded explanations
- The explainer gets **only the candidate JSON**: no images, no web, no free recall.
- The default is a deterministic template (`template_v1`) that fills sentences from fields. An LLM rewrite is optional and must keep every number from the JSON.
- **Numeric check:** extract every number from the text and confirm it matches a value at one of the `grounded_fields` paths (after rounding). Any failure falls back to the template.
- Forbidden: discovery claims, objects or observations not in the report, and distances unless `motion.distance_au_estimate` exists.

## 6. Scoring and vetting

### 6.1 Motion consistency
χ² of the best motion model (linear or parallax) against per-detection positional errors → p-value. Score = p-value clipped to [0, 1], set to 0 if fewer than 3 detections.

### 6.2 Signal-to-noise
Noise comes from VARIANCE plus a background-residual term. Score = min over detections of a logistic in S/N centred at 5. A combined S/N is reported too, but the weakest detection drives the score.

### 6.3 Artifact likelihood (uses SPHEREx FLAGS)
The FLAGS extension is a per-pixel int32 bitmap. Its header defines the bits (verified on QR2 files; `data/flags.py` reads them from each file's header rather than hard-coding them):

| Bit | Name | Meaning (header comment) | Our use |
|---|---|---|---|
| 0 | TRANSIENT | Transient detected during SUR | hard fail |
| 1 | OVERFLOW | Overflow detected during SUR | hard fail |
| 2 | SUR_ERROR | Error in onboard processing | hard fail |
| 4 | PHANTOM | Phantom pixel | soft penalty |
| 5 | REFERENCE | Reference pixel | hard fail |
| 6 | NONFUNC | Permanently unusable | hard fail |
| 7 | DICHROIC | Low efficiency due to dichroic | soft penalty |
| 9 | MISSING_DATA | Onboard data lost | hard fail |
| 10 | HOT | Hot pixel | hard fail |
| 11 | COLD | Anomalously low signal | hard fail |
| 12 | FULLSAMPLE | Full sample history available | ignore |
| 14 | PHANMISS | Phantom correction not applied | soft penalty |
| 15 | NONLINEAR | Nonlinearity correction unreliable | soft penalty |
| 17 | PERSIST | Persistent charge above threshold | soft penalty |
| 19 | OUTLIER | Flagged by Detect Outliers | soft penalty (moving objects can trigger it, so it is not a hard fail) |
| 21 | SOURCE | Pixel mapped to a known source | informational (static-source hint) |

Other inputs:
- distance to the cutout edge and to bright stars (ghosts and diffraction);
- a PSF-shape test against the exposure's own PSF at that position (cosmic rays are too sharp; blends are too broad);
- flux consistency across detections, given each detection's λ (a wild jump suggests an artifact);
- detected in only one exposure → not a candidate.
Known caveat: early releases under-flagged some bad pixels, so we never rely on flags alone.

### 6.4 Overall score and ML policy
- `overall = motion × snr × (1 − artifact)`, with thresholds tuned on injection results. Tuning on synthetic labels is the only "training" we do, and we say so.
- Optional ML, only if rules plateau and time allows: logistic regression or gradient boosting (scikit-learn) on the vetting features. Positives are recovered injections, negatives are unmatched non-injected detections. Report the exact counts (e.g. "trained on N injected positives and M negatives from K fields") and compare against the rule-based baseline on held-out fields. No PyTorch unless there's a concrete reason.

---

## 7. Injection-recovery test design

**Purpose:** a quantitative answer to "how faint and how slow an object can we recover?", plus the false-positive rate.

1. **Fields:** 3 showcase fields plus 2 "empty" control fields (high ecliptic latitude, few asteroids), using the same cutouts as real runs.
2. **Synthetic sources:** for each frame, take the PSF from that cutout's PSF extension (nearest grid PSF to the injection position). Scale it to a target flux using the AB magnitude → µJy → MJy/sr conversion with that frame's pixel solid angle. Add Gaussian noise consistent with the source's own Poisson contribution (approximation; document it). Leave existing noise and flags untouched. An injection that lands on a flagged pixel stays there, because real objects do too.
3. **Trajectories:**
   - *Linear:* rates {0 (static control), 0.3, 1, 3, 10, 30, 100}″/hr at random position angles.
   - *Parallax:* trial distances {30, 100, 300, 700} AU, with positions computed from Earth's position at each epoch time plus a small random proper motion.
   - *Flux grid:* AB {14, 15, 16, 17, 17.5, 18, 18.5, 19, 19.5, 20, 21} with a flat spectrum across λ, plus a reflected-sunlight SED variant.
4. **Density:** ≤ 20 injections per cutout, kept ≥ 5 px from each other and positioned randomly. 10 random realizations per (rate, mag) cell gives ≥ 200 trials per cell across fields.
5. **Blind run:** the pipeline runs unchanged and never sees injection metadata. A separate scorer compares outputs to the truth table.
6. **Recovery criterion:** a candidate track whose detections fall within 2 px of the injected position in ≥ 3 epochs (≥ 2 for the parallax model, labelled "pair"), with fitted rate within 20% (or distance within 30%), counts as recovered. Injections must also stay *unmatched* by SBIdent, which tests that we don't mislabel unknowns as known.
7. **Outputs** (`GET /api/injection/{study_id}`):
   - recovery fraction heatmap vs (magnitude, rate), with Wilson 95% intervals;
   - m₅₀ (50% completeness magnitude) per rate bin and per detector band;
   - false-positive candidates per deg² from the non-injected control runs;
   - score calibration: the distribution of `overall` for recovered injections vs non-injected unmatched detections.
8. **Demo statement:** "For objects moving 1–30″/hr our pipeline recovers 50% at AB ≈ X; for parallax-only movers at ≥ 300 AU it's Y." Fill X and Y from measurements only.

---

## 8. Data-access test plan

Owner: Bodhi, with the backend teammate pairing on T8–T10. Record results in `docs/data-access-findings.md`.

Already verified through the AWS bucket (Oct 29, 2026): the T4 HDU list, T5 WCS-WAVE structure, T6 flag table, and spacecraft position keywords for T9. Tests that need `irsa.ipac.caltech.edu`, `ssd-api.jpl.nasa.gov` or `ssd.jpl.nasa.gov` are still open until those hosts are allowed in the environment's network settings.

| # | Test | Pass criterion / what to record |
|---|---|---|
| T0 | Network: reach `irsa.ipac.caltech.edu`, `ssd-api.jpl.nasa.gov`, `ssd.jpl.nasa.gov` from every team laptop and the hackathon venue Wi-Fi if possible | HTTP 200 on each; note any proxy or firewall |
| T1 | IRSA TAP schema: list tables in schema `spherex`; dump columns of `plane`, `artifact`, `obscore` | exact column names; units of `time_bounds_*` (MJD?) |
| T2 | Coverage query (ADQL in 3.1) at 3 positions: one ecliptic, one high-latitude Deep field, one with a known bright TNO during a SPHEREx epoch | row counts, distinct bandpasses, time span, number of distinct ~6-month epochs |
| T3 | SIA2 query (`spherex_qr2`, `spherex_qr2_deep`) at the same positions | same observations as TAP? Is QR3 visible anywhere? |
| T4 | Download 1 cutout at size 0.05°, 0.1°, 0.3° | bytes, latency, HDU list (IMAGE, FLAGS, VARIANCE, ZODI, PSF, WCS-WAVE present?), valid celestial WCS |
| T5 | Per-pixel wavelength from a **cutout**: compute λ via astropy (alternate WCS, if the header defines one) and via manual bilinear interpolation of WCS-WAVE control points | do the two agree? Did the cutout shift pixel offsets correctly (compare with λ from the full-image header for the same sky pixel, using IRSA's header-only access if available)? |
| T6 | FLAGS: read the bit-name keywords from the header | complete bit → name table, saved in the findings doc |
| T7 | λ-matching feasibility: for the T2 fields, count epoch pairs ≥ 5 months apart with Δλ/λ < 1% over the cutout | number of usable matched pairs per field |
| T8 | SBIdent: one query for a known bright asteroid's field at a SPHEREx observation time, with `mpc-code=500` | object returned; record exact parameter formats (RA/Dec center format, time format), latency, JSON keys |
| T9 | Horizons: does it have SPHEREx? Get its ID and geocentric state at T8's time; re-query SBIdent with `xobs` | ID; position difference geocenter vs spacecraft for the asteroid (expect several arcsec) |
| T10 | Visual sanity: in T8's cutouts, is the known asteroid visible at the predicted position (by eye, DS9 or a quick imshow)? | yes/no + offset in px. Confirms time stamps and WCS line up |
| T11 | Throughput: 20 cutouts sequential, then 4-way parallel | median/95th-percentile latency, error codes (503?), polite concurrency limit |
| T12 | Pick showcase fields: 3–5 positions with (a) a known main-belt asteroid crossing within one visit and (b) a known TNO or dwarf planet seen in ≥ 2 surveys | list of (ra, dec, times, target) in `backend/spherex_px/config/showcase.toml` |

Exit criterion: T1, T2, T4, T5, T8 pass, so we know we can discover, fetch, read wavelength, and identify. The S3 byte-range path (section 3.0) already gives discovery, fetching and wavelength without IRSA's services. Identification (T8, T9) still needs JPL access.

---

## 9. Build order

The original 48-hour schedule is kept as a **build order**, not a deadline. Each slice ships as its own pull request with tests. **B** = Bodhi, **T** = AI/ML + backend teammate, **A** = Armaan (frontend; listed where integration is needed).

| # | Slice | Owner | Deliverable / checkpoint |
|---|---|---|---|
| 1 | API contract: `docs/api-contract.md`, Pydantic models, JSON Schema, fixture validation | T (+A) | frontend builds against the schema |
| 2 | Data access: S3 byte-range cutouts, L2 file reader (ZODI, FLAGS, VARIANCE, λ map, PSF), coverage index; IRSA TAP and JPL clients | B | real cutouts for showcase fields |
| 3 | Science: common grid, per-epoch detection + photometry, static rejection, tracklet linking + motion fit, known-object matching | B (science), T (JPL) | known asteroid recovered in a showcase field ✅ **key milestone** (identification needs JPL access) |
| 4 | Vetting, scores, error sources, grounded explanations | T | evidence report fields filled from measurements |
| 5 | FastAPI app, WebP rendering, showcase builder, recorded fixtures | T (+A) | Explorer and Detective modes on real data |
| 6 | Injection-recovery study | B (science), T (harness) | completeness heatmap, m₅₀, FP rate |
| 7 | Runs ("analyze any position"), λ-matched differencing, parallax-constrained linking | B | TNO showcase field linked across surveys (stretch) |
| 8 | Validation review of every showcase claim against measurements; README results + limitations | B | science sign-off |

Cut list if behind (in order): parallax linking → λ-matched differencing → optional ML → LLM explanations (keep templates). **Never cut:** known-object cross-check, flags-based vetting, injection-recovery numbers, disclaimer.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| IRSA slow or 503 during the demo | aggressive disk cache, precomputed showcase fields, TAP primary + SIA fallback |
| WCS-WAVE not usable in cutouts | fetch the full-image header once per observation (T5 fallback) |
| Few same-λ epoch pairs | rely on catalog-based motion detection (4.2 step 1); differencing is optional |
| SBIdent position offsets from LEO parallax | Horizons spacecraft correction; generous match radius with stated uncertainty |
| Flags incomplete in early data | PSF-shape and multi-epoch requirements on top of flags |
| Over-claiming | disclaimer in every report, grounded explanations, numeric check, injection-calibrated limits |

## 11. References used for this plan

- IRSA SPHEREx archive docs: data products, data access, cutout capabilities (`irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html`)
- IRSA tutorials: SPHEREx intro, cutouts, PSF, source discovery tool (`caltech-ipac.github.io/irsa-tutorials/`)
- IRSA TAP and SIA v2 docs (`irsa.ipac.caltech.edu/docs/program_interface/TAP.html`, `irsa.ipac.caltech.edu/ibe/sia.html`)
- SPHEREx Explanatory Supplement (flag table, depths, resolving power)
- SPHEREx pipeline paper, arXiv:2511.15823; mission paper, arXiv:2511.02985
- JPL SSD APIs: SBIdent (`ssd-api.jpl.nasa.gov/doc/sb_ident.html`), Horizons (`ssd-api.jpl.nasa.gov/doc/horizons.html`)
- SPHEREx QR on the AWS Open Data registry (`registry.opendata.aws/spherex-qr/`)
