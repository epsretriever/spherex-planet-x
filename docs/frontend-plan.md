# Frontend plan

Owner: Armaan (frontend, UI/UX, product design)
Code: `frontend/` (the backend works in `worker/`, `pipeline/` and `shared/`). Setup and scripts: `frontend/README.md`.

Deployment: one Cloudflare Worker, `spherex-planet-x`, serves both the TypeScript API (`/api/*`) and this site. Cloudflare runs `npm ci && npm run build` at the repository root, which builds the frontend's static export into `frontend/out`, then `npx wrangler deploy`.
API contract source of truth: `docs/api-contract.md` and the example JSON in `shared/fixtures/`, both maintained by the backend. Section 4 of this plan summarizes the rules the frontend depends on; if the two ever disagree, `docs/api-contract.md` wins and this plan gets fixed.

## 0. Principles

These decide every trade-off below.

1. **Demo first.** The 3-minute pitch video is judged. The path *landing → blink a real field → open a candidate → read its evidence* must be flawless before anything else gets built.
2. **Public first.** Explorer mode uses no jargon. Detective mode can use real terms, but each one gets a plain-language tooltip.
3. **Every pixel is traceable.** Each image shows, or is one tap away from, its source file, observation date and wavelength. The frontend refuses to render an image that has no `source` block.
4. **Honest about uncertainty.** We never say "discovered," "new planet" or "Planet X found." An unmatched candidate is shown as *Unexplained*, with artifact and catalog-gap explanations listed next to it. Injected objects are always labeled **SIMULATED**. The frontend never upgrades a classification.
5. **Works at phone width.** Design at 360 px first, then scale up. The blink viewer has to work with one thumb.
6. **Never blocked on the backend, never fake.** The app only fetches relative `/api/*` URLs. With `NEXT_PUBLIC_USE_FIXTURES=true` it reads the static JSON the pipeline publishes to `frontend/public/data/` instead. If the API errors, the page shows a clear, friendly error state with a retry button. If nothing is published yet, it shows an empty state. It never shows invented observation data.

## 1. Screens

| Route | Screen | Mode | Priority |
|---|---|---|---|
| `/` | **Landing**: one-line hook, "Explore the sky" and "Be a detective" entry points, short integrity note | — | P0 |
| `/explore` | **Field picker**: curated sky patches as cards with thumbnails, plus an optional Aladin Lite all-sky map with field footprints | Explorer | P0 (cards), P1 (map) |
| `/explore/field/?id={field_id}` | **Blink viewer**: real observations (epochs) of the same patch, with blink, swipe and step controls, a date timeline and "what moved" highlights | Explorer | P0 |
| `/detective` | **Candidate list**: flagged moving sources from the pipeline, sortable and filterable by classification and score | Detective | P0 |
| `/detective/candidate/?id={candidate_id}` | **Evidence report**: stamp blink, per-epoch positions, motion, scores, known-object match, error sources, grounded explanation | Detective | P0 |
| `/detective/candidate/?id=…#spectrum` | **Spectrum panel** (section of the report): flux across SPHEREx's 102 bands | Detective | Stretch |
| `/simulated/?study={study_id}` | **Injection demo**: injected moving objects recovered (or not) by the pipeline, with the recovery-grid chart | Detective | P1 |
| `/analyze` | **Analyze a position** (optional): submit RA/Dec, follow the run's progress, then open the resulting field and candidates | Detective | Stretch |
| `/about` | **Method and credits**: how it works in five steps, data sources, team, scientific-integrity statement | — | P0 (short), P1 (full) |

Dynamic pages use query parameters rather than path segments, so the static export builds without any data present and new fields or candidates work without a rebuild.

Global elements: top bar with mode switch (Explorer / Detective), a "Source" drawer on every image (file, IRSA observation ID, plane ID, date and time, wavelength, data release, IRSA link), and a footer with data credits.

## 2. User flows

### Explorer mode (public, no jargon)

```
Landing ─► "Explore the sky"
   └─► Field picker: choose a card (name, blurb and thumbnail come from the backend)
         └─► Blink viewer
               1. Opens on the first blink pair. Wavelength-matched pairs are the default when they exist.
                  One-line prompt: "Watch for dots that jump."
               2. Auto-blink starts at about 1 Hz. Big Play/Pause button, date chip shows the current frame.
               3. User can switch to Swipe (drag a divider between A and B) or Step (prev/next through all epochs).
               4. "Show me what moved" toggles circles on movers, with arrows from old to new position.
               5. Tapping a circled object opens a bottom sheet with the backend's label_plain and summary_plain
                  ─► "See the full evidence" (Detective report)
               6. "Source" chip on each frame opens the provenance drawer.
```

Explorer copy rules: say "dot," "moved," "known asteroid," "we can't explain this one yet." Keep units plain ("about the width of 7 pixels", "in 3 days"). Arcseconds go in a tooltip.

Wavelength caveat: SPHEREx uses linear variable filters, so the same spot on the sky is usually imaged at a different wavelength in each visit, and a star's brightness changes with wavelength. The field response lists `blink_pairs` with `lambda_matched`. The viewer defaults to matched pairs, and any unmatched pair carries the label **"Different wavelengths: brightness changes are expected"**. Each frame shows its wavelength next to its date.

### Detective mode

```
Landing ─► "Be a detective"   (or Explorer bottom sheet ─► "See the full evidence")
   └─► Candidate list
         • Each row: stamp thumbnail loop, candidate ID, field, # detections, motion rate,
           QualityMeter (quality_level), classification badge
         • Filters: classification, minimum overall score, field, "Show simulated" (include_injected).
           Sort: overall score, motion rate, date.
         └─► Evidence report
               1. Header: candidate ID, classification badge, summary_plain
               2. Stamp strip + blink of all detections, motion track overlay, dashed predicted
                  positions from known_object.per_epoch when there is a match
               3. Measurements table: per detection time_utc, MJD, RA/Dec, x_pix/y_pix, flux_ujy ± flux_err_ujy,
                  SNR, wavelength
               4. Motion: rate_arcsec_per_hr, position angle, time_span_hours, fit_residual_rms_arcsec, plotted track
               5. Scores: motion consistency, SNR, artifact likelihood, overall (labeled "rule-based score")
               6. Known-object match: checked / matched, designation, catalogs checked, search radius,
                  per-epoch separation, nearest object if unmatched
               7. Possible error sources: ErrorSourceChecklist, plus an expandable technical table of vetting[]
               8. Explanation: labeled by generator ("Template text from the measurements" or
                  "AI-written from the measurements"); each grounded field links to the value it came from
               9. (Stretch) Spectrum across 102 bands
              10. Provenance: every source file, with IRSA links, schema_version and pipeline_version
         └─► Prev/next candidate navigation
```

Classification display:

| `classification` | Badge | Notes |
|---|---|---|
| `known_object` | **Known object** | Shows the designation |
| `unmatched` | **Unexplained** | Never "New" or "Discovery" |
| `likely_artifact` | **Likely artifact** | |
| `unconfirmed_pair` | **Unconfirmed pair** | Only two epochs; copy says it is never a detection on its own |
| `injected` | **SIMULATED** | Plus a SIMULATED banner on any view that shows it |

Injection demo flow: `/simulated` opens with a **SIMULATED** banner. It shows the recovery grid from `GET /api/injection/{study_id}` (magnitude × rate, with Wilson 95% intervals), m50 per rate bin and the false-positive rate, plus example injected candidates in the blink viewer (hatched outline, SIMULATED badge). Injected candidates appear in the candidate list only when "Show simulated" is on.

## 3. Design system outline

### Color

Visual direction: **thermal infrared**. Violet-black surfaces like the sky between sources, an ember accent for actions, and an inferno-style spectral ramp (short to long wavelength) used for the top-bar rule, the hero's 102-channel diagram, wavelength labels, the spectrum plot and the recovery grid. Dark only. Status colors are chosen to be colorblind-safe and are always paired with an icon and a text label, never color alone. The tokens live in `frontend/src/app/globals.css`.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#08060D` | Page background |
| `--surface` / `--surface-2` / `--surface-3` | `#120E1A` / `#1B1526` / `#251D33` | Cards, raised elements, table headers |
| `--border` / `--border-strong` | `#2D2440` / `#43375C` | Dividers |
| `--text` | `#F3EEF9` | Primary text |
| `--text-muted` | `#AA9FBD` | Secondary text (≥ 4.5:1 on surfaces) |
| `--accent` | `#FF8A4C` | Links, primary buttons, focus ring |
| `--ir-0` … `--ir-7` | `#1B0C41` → `#F7D13D` | Spectral ramp |
| `--status-known` | `#5AA9FF` + ✓ | `known_object` |
| `--status-unexplained` | `#FFD166` + ? | `unmatched` |
| `--status-artifact` | `#9A92AB` + ! | `likely_artifact` |
| `--status-pair` | `#C3A6FF` + ↔ | `unconfirmed_pair` |
| `--status-simulated` | `#F06BD8` + hatched fill + "SIMULATED" | `injected` |
| `--track` | `#7CF0C8` | Motion tracks and measured-position rings |
| `--predicted` | `#F3EEF9`, dashed | Predicted known-object positions |

Overlay colors must stay visible on both dark sky and bright stars: 2 px stroke with a 1 px dark halo.

### Type

- **Display:** Space Grotesk for headings and the brand. Scale: 12 / 14 / 16 / 20 / 24 / 32 / 40, with a fluid hero size.
- **UI and body:** Inter, 16 px base, 1.5 line height.
- **Numbers and data:** JetBrains Mono with tabular figures for coordinates, dates, wavelengths and measurements.
- All three are self-hosted through Fontsource.

### Spacing, shape, motion

- 4 px base grid: 4, 8, 12, 16, 24, 32, 48.
- Radius: 8 px for cards, 999 px for chips.
- Touch targets ≥ 44 px. Phone side gutter 16 px.
- Motion: 150–200 ms ease-out for UI. Blink rate is user-adjustable (0.5–4 Hz) and respects `prefers-reduced-motion` by defaulting to Swipe/Step with no auto-blink.

### Components

| Component | Notes |
|---|---|
| `BlinkViewer` | Core component. Modes: blink, swipe, step. Takes epochs, blink pairs and grid size. Preloads every frame before starting so blinks never flash blank. Field images are small (0.3° cutouts, about 175 px), so they are scaled up with `image-rendering: pixelated`; the frame size comes from `wcs.width_px` / `wcs.height_px`, never from a hard-coded size. Zoom and pan keep all frames aligned. |
| `FrameLabel` / `DateChip` | Date (UTC), wavelength, frame index. Always visible on each frame. |
| `SourceDrawer` | Provenance: file, `obs_id`, `planeid`, `data_release`, IRSA archive link and cutout link. |
| `MotionOverlay` | Circles at measured positions (`x_grid`, `y_grid`), arrow track, dashed predicted positions from `known_object.per_epoch`. |
| `FieldCard` | Backend thumbnail, name, blurb, number of epochs, date range. |
| `CandidateRow` / `CandidateCard` | Table row on desktop, card on phone. |
| `ClassificationBadge` | Known object / Unexplained / Likely artifact / Unconfirmed pair / SIMULATED. Icon + label + color. |
| `QualityMeter` | Shows `quality_level` (Low / Medium / High). Tooltip shows the `scores` breakdown and says the score is rule-based. |
| `MeasurementTable` | Sticky first column, horizontal scroll inside the table only (never the page) on phone. Uses native `x_pix` / `y_pix`. |
| `MotionPlot` | RA/Dec offsets vs. time with the fitted motion. |
| `ErrorSourceChecklist` | Each item: label, plain explanation, status (ruled out / not ruled out / unknown), evidence. |
| `VettingTable` | Expandable technical table of `vetting[]`: check, value, threshold, passed. |
| `Explanation` | Labeled by `generator`. Grounded-field values are highlighted and linked. "Not available" state when the block is missing. |
| `SpectrumPlot` (stretch) | Flux vs. wavelength across 102 bands with error bars. |
| `RecoveryGrid` | Injection recovery heatmap (magnitude × rate) with Wilson 95% intervals, m50 per rate bin, false-positive rate. |
| `SimulatedBanner` | Full-width banner on any view that shows injected objects. |
| `Tooltip` / `Glossary` | Plain-language definitions for SNR, arcsec, ecliptic, MJD, etc. |
| `BottomSheet` | Phone detail view for a tapped object in Explorer. |

## 4. JSON contract (backend → frontend)

The full contract lives in `docs/api-contract.md`, with example responses in `shared/fixtures/` (`fields.json`, `field_detail.json`, `candidates.json`, `candidate_detail.json`, `injection_study.json`). The frontend's TypeScript types in `frontend/src/lib/contract.ts` mirror it. This section lists the decisions the frontend relies on. Shapes below use types, not example values, so this plan never carries made-up observation data.

### Endpoints

| Method and path | Returns |
|---|---|
| `GET /api/health` | Service and upstream status |
| `GET /api/fields` | Field list for the picker |
| `GET /api/fields/{field_id}` | One field: field metadata + `epochs` + `movers` + `blink_pairs` |
| `GET /api/candidates?field_id=&classification=&min_score=&include_injected=false` | Candidate list |
| `GET /api/candidates/{candidate_id}` | Full evidence report for one candidate |
| `GET /api/injection/{study_id}` | Injection-recovery study |
| `POST /api/runs` → `GET /api/runs/{run_id}` | Optional job flow for analyzing any position. A finished run returns the same field and candidate shapes as above. |

### Naming and envelope rules

- snake_case, with units in the names: `flux_ujy`, `flux_err_ujy`, `x_pix`, `rate_arcsec_per_hr`, `time_span_hours`, `fit_residual_rms_arcsec`.
- IDs are `field_id`, `epoch_id` and `candidate_id`, never a bare `id`. `obs_id` always means the IRSA observation ID.
- Every response carries `schema_version` and `pipeline_version`. The frontend shows both in the provenance section and warns in the console on an unknown major version.
- Unknown fields are ignored, so the backend can add fields without breaking the frontend.

### Times

Every epoch and detection has both `time_utc` (ISO 8601) and `mjd`. The UI shows `time_utc` to the public and `mjd` in the measurement table.

### Provenance

Every image, epoch, detection and stamp carries:

```ts
source: {
  file: string;
  obs_id: string;         // IRSA observation ID
  planeid: string;
  archive_url: string;
  cutout_url: string;
  data_release: string;
}
```

The frontend refuses to render an image without `source` and shows a "Missing source" placeholder instead, so gaps are caught early.

### Wavelength

Epochs and detections carry `wavelength_um_center`, `bandwidth_um` and `wavelength_um_range: [min, max]`.

### Field detail (`GET /api/fields/{field_id}`)

```ts
{
  schema_version: string;
  pipeline_version: string;
  field_id: string;
  name: string;            // display text comes from the backend
  blurb: string;
  thumbnail_url: string;
  wcs: { width_px: number; height_px: number; /* + WCS keywords */ };
  epochs: Array<{
    epoch_id: string;
    time_utc: string;
    mjd: number;
    image: { url: string; width_px: number; height_px: number; source: Source }; // WebP, common grid, fixed asinh stretch per field
    wavelength_um_center: number;
    bandwidth_um: number;
    wavelength_um_range: [number, number];
    source: Source;
  }>;
  blink_pairs: Array<{
    epoch_id_a: string;
    epoch_id_b: string;
    time_separation_hours: number;
    lambda_matched: boolean;
    delta_lambda_frac: number;
    label_plain: string;
  }>;
  movers: Array<{
    candidate_id: string;
    classification: Classification;
    label_plain: string;
    quality_level: QualityLevel;
    rate_arcsec_per_hr: number | null;
    track: Array<{ epoch_id: string; time_utc: string; mjd: number; ra_deg: number; dec_deg: number; x_grid: number; y_grid: number }>;
  }>;
}
```

Images:

- Field images are **0.3° cutouts, about 175 px**, on a common grid, WebP, with a fixed asinh stretch per field. The viewer scales them up with `image-rendering: pixelated` and reads real dimensions from `wcs.width_px` and `wcs.height_px`.
- Overlays use `x_grid` / `y_grid` (common grid). `x_pix` / `y_pix` are native detector pixels and only appear in the measurement table.
- Detection stamps are `stamp_url`, 64 px.

Blink pairs: the viewer defaults to `lambda_matched: true` pairs when any exist. Unmatched pairs are labeled "Different wavelengths: brightness changes are expected".

### Classification

`classification` is one of `known_object | unmatched | likely_artifact | unconfirmed_pair | injected`. It replaces the earlier `status` and `simulated` fields. Display labels are in section 2. The frontend never upgrades a classification.

### Scores

```ts
scores: {
  motion_consistency: number;
  snr: number;
  artifact_likelihood: number;
  overall: number;
  method: "rule_based_v1";
}
quality_level: "low" | "medium" | "high";   // drives QualityMeter
```

The score is rule-based. The UI never calls it a probability or a classifier output.

### Candidate detail (`GET /api/candidates/{candidate_id}`)

```ts
{
  schema_version: string;
  pipeline_version: string;
  candidate_id: string;
  field_id: string;
  classification: Classification;
  summary_plain: string;
  label_plain: string;
  detections: Array<{
    epoch_id: string;
    time_utc: string;
    mjd: number;
    ra_deg: number; dec_deg: number; pos_err_arcsec: number;
    x_pix: number; y_pix: number;        // native detector pixels
    x_grid: number; y_grid: number;      // common grid, for overlays
    flux_ujy: number; flux_err_ujy: number; snr: number;
    wavelength_um_center: number; bandwidth_um: number; wavelength_um_range: [number, number];
    stamp_url: string;                   // 64 px
    source: Source;
  }>;
  motion: {
    rate_arcsec_per_hr: number;
    position_angle_deg: number;
    time_span_hours: number;
    fit_residual_rms_arcsec: number;
    /* + model, n_detections, fit statistics */
  };
  scores: Scores;
  quality_level: QualityLevel;
  known_object: {
    checked: boolean;
    matched: boolean;
    designation: string | null;
    predicted_vmag: number | null;
    per_epoch: Array<{ epoch_id: string; predicted_ra_deg: number; predicted_dec_deg: number; separation_arcsec: number }>;
    observer: string;
    source: string;
    catalogs_checked: string[];          // JPL SBIdent and Horizons only
    search_radius_arcsec: number;
    nearest: { designation: string; separation_arcsec: number } | null;
  };
  error_sources: Array<{
    id: string; label: string; explanation: string;
    status: "ruled_out" | "not_ruled_out" | "unknown";
    evidence: string | null;
  }>;
  vetting: Array<{ check: string; value: number | boolean | string; threshold: number | boolean | string; passed: boolean }>;
  explanation: {
    text: string;
    generator: string;                   // template text vs AI-written text
    grounded_fields: string[];           // paths into this JSON, may include [n]
    numeric_check: string;
    generated_utc: string;
  } | null;
  spectrum: {
    units: { wavelength: string; flux: string };
    points: Array<{ band_index: number; wavelength_um: number; flux_ujy: number; flux_err_ujy: number; epoch_id: string }>;
  } | null;
}
```

Rules the UI depends on:

- **Known objects:** the dashed predicted-position overlay uses `known_object.per_epoch`. `catalogs_checked` lists JPL SBIdent and Horizons only.
- **Error sources:** `error_sources[]` feeds `ErrorSourceChecklist`. `vetting[]` is shown raw in the expandable `VettingTable`.
- **Explanation:** labeled by `generator`: template generators show "Template text from the measurements", anything else shows "AI-written from the measurements". `grounded_fields` paths are resolved inside the same JSON, including array indexes such as `known_object.per_epoch[0].separation_arcsec`. A path that does not resolve is dropped with a console warning, and the rest of the explanation still shows.
- **Optional blocks:** `explanation` and `spectrum` may be `null`. The report still works without them.

### Injection study (`GET /api/injection/{study_id}`)

The recovery grid is magnitude × rate. Each cell has injected and recovered counts, the recovery fraction and its Wilson 95% interval. The study also has m50 per rate bin and a false-positive rate. `RecoveryGrid` renders that shape. Everything on `/simulated` is labeled SIMULATED.

## 5. Tech choices (frontend)

- **Next.js (App Router) + TypeScript** in `frontend/`, built as a **static export**: `output: "export"`, `trailingSlash: true`, unoptimized images. No API routes, middleware or request-time server code. Data is fetched in the browser.
- **Local development:** `npm run dev` proxies `/api/*` and `/static/*` to `npx wrangler dev` on port 8787.
- **Styling:** CSS variables for the tokens above plus CSS Modules.
- **Fonts:** Inter and JetBrains Mono, self-hosted through Fontsource so builds don't depend on a font CDN.
- **Blink viewer:** stacked `<img>` elements on a fixed-size stage, with opacity for blink and a clip for swipe. This is simpler and more reliable than a full sky viewer for small aligned cutouts.
- **Sky map:** Aladin Lite v3 on `/explore` only (P1), showing a survey background with our field footprints. Lazy-loaded so it never slows the blink viewer. If it fights us, the card picker is enough.
- **Charts:** lightweight SVG for the motion plot, spectrum and recovery grid.
- **Data layer:** `frontend/src/lib/api.ts` with typed fetchers. By default it calls relative `/api/*` URLs. With `NEXT_PUBLIC_USE_FIXTURES=true` it reads `/data/fields.json`, `/data/fields/{id}.json`, `/data/candidates.json`, `/data/candidates/{id}.json` and `/data/injection/{id}.json`, the same files the Worker serves the API from. It falls back to the single-file names used in `shared/fixtures/`.
- **Tests:** Vitest + Testing Library for components and data logic. Playwright runs against the static export at 1280 px and 360 px, including a layout test that fails if anything is wider than the viewport. Until real data is published, Playwright answers `/api/*` inside the test browser with clearly labeled synthetic responses that the app never serves.

## 6. Build order

The schedule from planning, kept as a build order. Each step ends in a working, reviewed slice with its own pull request.

| Step | Frontend work | Depends on |
|---|---|---|
| 1 | App shell: tokens, layout, top bar, footer, landing page, about page, data layer with `USE_FIXTURES` | — |
| 2 | **BlinkViewer** (blink, swipe, step, preload, labels, SourceDrawer, blink pairs) and the Explorer field picker and field pages | `fields.json`, `field_detail.json` |
| 3 | Phone-width and accessibility pass on the viewer | Real cutouts |
| 4 | Candidate list + ClassificationBadge + QualityMeter. Evidence report skeleton: header, stamp strip, MeasurementTable, motion section | `candidates.json`, `candidate_detail.json` |
| 5 | Report: known-object match and predicted positions, ErrorSourceChecklist, VettingTable, Explanation with grounded fields, provenance. MotionOverlay in Explorer + bottom sheet linking to the report | — |
| 6 | `/simulated` with RecoveryGrid + SimulatedBanner. Full `/about`. Stretch: SpectrumPlot | `injection_study.json` |
| 7 | **Polish the demo path:** loading, empty and error states, reduced motion, focus and contrast, alt text, phone testing on real devices | — |
| 8 | Optional: `/analyze` run flow, Aladin Lite field map | `POST /api/runs` |
| 9 | 3-minute video: script → screen capture of the demo path (phone + desktop) → edit. Final copy check for "discovery" language | — |

Status: steps 1–7 are built (frontend PRs #4, #5 and #7, merged in that order). Step 8 (`/analyze` and the Aladin Lite map) is still open, and step 9 needs real data.

Cut order if time runs short: Aladin map → `/analyze` → spectrum → injection controls (keep a static recovery grid) → candidate filters. Never cut: blink viewer, evidence report, provenance, SIMULATED labels.

### Demo script draft (3 minutes)

1. (0:00–0:20) Hook: "The sky changes. SPHEREx photographs it again and again in infrared. What moved?"
2. (0:20–1:10) Explorer: pick a field, blink, tap "Show me what moved", tap a known asteroid.
3. (1:10–2:10) Detective: candidate list, open an unexplained candidate, walk through measurements, error sources and the explanation's grounded values.
4. (2:10–2:40) Injection demo: we hid simulated objects in real data and measured how many we recover.
5. (2:40–3:00) Integrity and impact: "We're not claiming Planet X. We're giving everyone the tools to look."

## 7. Supporting work

- [ ] Low-fidelity wireframes: Landing, Field picker, Blink viewer (phone + desktop), Candidate list, Evidence report, Injection demo.
- [ ] Design tokens contrast-checked.
- [ ] Copy deck: plain-language strings for Explorer, glossary entries, integrity statement, badge labels.
- [ ] Aladin Lite v3 research: embedding in Next.js (client-only), overlaying footprints and markers, mobile performance.
- [ ] Run the demo path against the first real data in `frontend/public/data/`, and re-check `frontend/src/lib/contract.ts` against `docs/api-contract.md`.
- [ ] Draft the demo video script and shot list.

## 8. Open questions

- Which fields have enough revisits on short enough timescales to show motion in a blink? (Bodhi)
- Hosting: where does the frontend run, and where does FastAPI run for the demo? (team)
