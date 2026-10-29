# Frontend plan

Owner: Armaan (frontend, UI/UX, product design)
Status: pre-kickoff plan. No application code until kickoff on **November 14, 2026, 9:00 AM Pacific**, per Space Apps rules. Before then we only do wireframes, the design system, research and data-access tests (see [Pre-kickoff checklist](#7-pre-kickoff-checklist)).

## 0. Principles

These decide every trade-off below.

1. **Demo first.** The 3-minute pitch video is judged. The path *landing → blink a real field → open a candidate → read its evidence* must be flawless before anything else gets built.
2. **Public first.** Explorer mode uses no jargon. Detective mode can use real terms, but each one gets a plain-language tooltip.
3. **Every pixel is traceable.** Each image shows, or is one tap away from, its source file, observation date and wavelength. No uncredited or unlabeled images.
4. **Honest about uncertainty.** We never say "discovered," "new planet" or "Planet X found." An unmatched candidate is shown as *unexplained*, with artifact and catalog-gap explanations listed next to it. Simulated data is always labeled **SIMULATED**.
5. **Works at phone width.** Design at 360 px first, then scale up. The blink viewer has to work with one thumb.
6. **Never blocked on the backend.** The frontend builds against JSON fixtures that follow the contract in section 4 from hour 2. Switching to the real API is a config change.

## 1. Screens

| Route | Screen | Mode | Priority |
|---|---|---|---|
| `/` | **Landing**: one-line hook, "Explore the sky" and "Be a detective" entry points, short integrity note | — | P0 |
| `/explore` | **Field picker**: curated sky patches as cards with thumbnails, plus an optional Aladin Lite all-sky map with field footprints | Explorer | P0 (cards), P1 (map) |
| `/explore/[fieldId]` | **Blink viewer**: two or more real observations of the same patch, with blink, swipe and step controls, a date timeline and "what moved" highlights | Explorer | P0 |
| `/detective` | **Candidate list**: flagged moving sources from the pipeline, sortable and filterable by match status and quality | Detective | P0 |
| `/detective/[candidateId]` | **Evidence report**: cutout blink, per-observation positions, motion, quality, known-object match, error sources, grounded AI explanation | Detective | P0 |
| `/detective/[candidateId]#spectrum` | **Spectrum panel** (section of the report): flux across SPHEREx's 102 bands | Detective | Stretch |
| `/simulated` | **Injection demo**: a simulated moving object injected into real images and then recovered by the pipeline, with a recovery-vs-brightness chart | Detective | P1 |
| `/about` | **Method and credits**: how it works in five steps, data sources, team, scientific-integrity statement | — | P0 (short), P1 (full) |

Global elements: top bar with mode switch (Explorer / Detective), a "Source" drawer on every image (file name, observation ID, date/time UTC, wavelength range, IRSA link), and a footer with data credits.

## 2. User flows

### Explorer mode (public, no jargon)

```
Landing ─► "Explore the sky"
   └─► Field picker: choose a card ("Near the ecliptic in Taurus", "Galactic plane", "North ecliptic pole deep field")
         └─► Blink viewer
               1. Opens with image A (earliest date) and a one-line prompt: "Watch for dots that jump."
               2. Auto-blink starts at about 1 Hz. Big Play/Pause button, date chip shows the current frame.
               3. User can switch to Swipe (drag a divider between A and B) or Step (prev/next through all dates).
               4. "Show me what moved" toggles circles on flagged movers with arrows from old to new position.
               5. Tapping a circled object opens a bottom sheet: "This dot moved about 40 arcsec in 3 days.
                  It matches a known asteroid: (12345) Example."  ─► "See the full evidence" (Detective report)
               6. "Source" chip on each frame opens the provenance drawer.
```

Explorer copy rules: say "dot," "moved," "known asteroid," "we can't explain this one yet." Keep units plain ("about the width of 7 pixels", "in 3 days"). Arcseconds go in a tooltip.

Science UX caveat to show in Explorer: SPHEREx uses linear variable filters, so a given spot on the sky can be imaged at a **different wavelength** in each visit. A dot that changes brightness between frames may be showing the filter change, not the object. The viewer shows the wavelength of each frame next to its date and gives a one-line "Why do brightnesses change?" explainer. (To confirm with Bodhi which cutouts we pair and how they are normalized.)

### Detective mode

```
Landing ─► "Be a detective"   (or Explorer bottom sheet ─► "See the full evidence")
   └─► Candidate list
         • Each row: thumbnail blink (GIF-like loop), ID, field, # observations, motion rate,
           quality badge, match badge (Known object / Unexplained / Likely artifact / SIMULATED)
         • Filters: match status, minimum quality, field.  Sort: quality, motion, date.
         └─► Evidence report
               1. Header: candidate ID, match badge, one-sentence plain summary
               2. Cutout strip + blink of all observations, motion track overlay
               3. Measurements table: per observation date/time (UTC), RA/Dec, x/y, flux, SNR, wavelength
               4. Motion: rate (arcsec/hr), direction (position angle), fit residuals, plotted track
               5. Signal quality: SNR, detection count, fit quality, flags
               6. Known-object match: yes/no, object name, catalog, separation, predicted vs. measured position
               7. Possible error sources: checklist with each item's status (checked / not ruled out)
               8. AI explanation: labeled "AI-generated from the measurements above"; every number it
                  cites links to the table row it came from
               9. (Stretch) Spectrum across 102 bands
              10. Provenance: every source file, with IRSA link
         └─► Prev/next candidate navigation
```

Injection demo flow: `/simulated` opens with a clear **SIMULATED** banner. The user picks an injected brightness and speed, sees the injected object in the blink viewer (hatched outline, magenta), then sees whether the pipeline recovered it. A small chart shows recovery rate vs. brightness from the backend's injection run. The same component renders in the candidate list when the "Show simulated" filter is on, always with the SIMULATED badge.

## 3. Design system outline

### Color

Dark theme by default (space imagery reads best on dark), with a light theme for `/about` and printouts. Status colors are chosen to be colorblind-safe and are always paired with an icon and a text label, never color alone.

| Token | Dark | Use |
|---|---|---|
| `--bg` | `#0B0E14` | Page background |
| `--surface` | `#141924` | Cards, sheets |
| `--surface-2` | `#1D2433` | Raised elements, table header |
| `--border` | `#2A3346` | Dividers |
| `--text` | `#E8ECF4` | Primary text (contrast ≥ 12:1 on `--bg`) |
| `--text-muted` | `#9AA4B8` | Secondary text (≥ 4.5:1) |
| `--accent` | `#6CB4FF` | Links, primary buttons, focus ring |
| `--status-known` | `#4FA3FF` + check icon | Matched to a known object |
| `--status-unexplained` | `#F2B84B` + question icon | Unmatched: "Unexplained", never "New" |
| `--status-artifact` | `#8A93A6` + warning icon | Likely artifact |
| `--status-simulated` | `#E36BD8` + hatched fill + "SIMULATED" text | Injected test objects |
| `--track` | `#7CF0C8` | Motion arrows and track overlays on images |

Overlay colors must stay visible on both dark sky and bright stars: 2 px stroke with a 1 px dark halo.

### Type

- **UI and body:** Inter (variable), 16 px base, 1.5 line height.
- **Numbers and data:** JetBrains Mono or IBM Plex Mono with tabular figures for coordinates, dates and measurements.
- **Display:** Inter at 600–700 weight for headings. Scale: 12 / 14 / 16 / 20 / 24 / 32 / 40.

### Spacing, shape, motion

- 4 px base grid: 4, 8, 12, 16, 24, 32, 48.
- Radius: 8 px for cards, 999 px for chips.
- Touch targets ≥ 44 px. Phone side gutter 16 px.
- Motion: 150–200 ms ease-out for UI. Blink rate is user-adjustable (0.5–4 Hz) and respects `prefers-reduced-motion` by defaulting to Swipe/Step with no auto-blink.

### Components

| Component | Notes |
|---|---|
| `BlinkViewer` | Core component. Modes: blink, swipe, step. Props: ordered frames, overlays, initial mode. Preloads every frame before starting so blinks never flash blank. Pinch-zoom and pan with all frames kept aligned. |
| `FrameLabel` / `DateChip` | Date (UTC), wavelength, frame index. Always visible on each frame. |
| `SourceDrawer` | Provenance: file name, observation ID, date, wavelength, IRSA link, processing note. |
| `MotionOverlay` | Circles at measured positions, arrow track, optional predicted (known-object) position in dashed outline. |
| `FieldCard` | Thumbnail, plain-language name, number of dates, date range. |
| `CandidateRow` / `CandidateCard` | Table row on desktop, card on phone. |
| `StatusBadge` | Known / Unexplained / Likely artifact / SIMULATED. Icon + label + color. |
| `QualityMeter` | 3-level (Low / Medium / High) with the numeric SNR in a tooltip. |
| `MeasurementTable` | Sticky first column, horizontal scroll inside the table only (never the page) on phone. |
| `MotionPlot` | RA/Dec offsets vs. time with linear fit. |
| `ErrorSourceChecklist` | Each item: name, plain explanation, status (ruled out / not ruled out / unknown). |
| `AIExplanation` | Labeled block, cited numbers link to table rows, "Not available" state if the backend omits it. |
| `SpectrumPlot` (stretch) | Flux vs. wavelength across 102 bands with error bars. |
| `SimulatedBanner` | Full-width banner on any simulated view. |
| `Tooltip` / `Glossary` | Plain-language definitions for SNR, arcsec, ecliptic, etc. |
| `BottomSheet` | Phone detail view for a tapped object in Explorer. |

Wireframes for Landing, Blink viewer (phone and desktop), Candidate list and Evidence report come before kickoff (low fidelity, no code).

## 4. JSON contract (backend → frontend)

All endpoints are read-only `GET` from FastAPI. All times are ISO 8601 UTC. Angles are degrees for RA/Dec, arcseconds for offsets, arcsec/hour for rates. Image URLs can be relative to the API host or absolute (static/CDN). The frontend starts with these exact shapes as fixtures in `fixtures/`.

### `GET /api/fields`

```json
{
  "fields": [
    {
      "id": "taurus-ecliptic-01",
      "name": "Near the ecliptic in Taurus",
      "blurb": "A patch along the path of the planets, where asteroids are common.",
      "center": { "ra_deg": 60.12, "dec_deg": 21.40 },
      "size_deg": { "width": 0.5, "height": 0.5 },
      "thumbnail_url": "/static/fields/taurus-ecliptic-01/thumb.webp",
      "observation_count": 4,
      "date_range": { "start": "2025-05-02T03:14:00Z", "end": "2025-11-08T22:41:00Z" },
      "candidate_count": 3
    }
  ]
}
```

### `GET /api/fields/{field_id}`

```json
{
  "id": "taurus-ecliptic-01",
  "name": "Near the ecliptic in Taurus",
  "center": { "ra_deg": 60.12, "dec_deg": 21.40 },
  "wcs": {
    "crval": [60.12, 21.40], "crpix": [256.5, 256.5],
    "cdelt_arcsec": 6.2, "width_px": 512, "height_px": 512, "rotation_deg": 0.0
  },
  "observations": [
    {
      "id": "obs-001",
      "obs_time": "2025-05-02T03:14:00Z",
      "image_url": "/static/fields/taurus-ecliptic-01/obs-001.webp",
      "image_width_px": 512,
      "image_height_px": 512,
      "wavelength_um": { "center": 1.62, "min": 1.58, "max": 1.66 },
      "band_index": 37,
      "stretch": { "type": "asinh", "min": -2.0, "max": 150.0, "units": "MJy/sr" },
      "aligned": true,
      "source": {
        "file": "level2_2025W18_1A_0123_1D3_spx_l2b-v20-2025-140.fits",
        "obs_id": "2025W18_1A_0123",
        "detector": 3,
        "archive": "IRSA",
        "archive_url": "https://irsa.ipac.caltech.edu/...",
        "product_level": "L2",
        "processing_note": "Reprojected to common grid, asinh stretch"
      }
    }
  ],
  "movers": [
    {
      "candidate_id": "cand-0007",
      "status": "known",
      "label_plain": "Known asteroid",
      "track_px": [
        { "obs_id": "obs-001", "x": 120.4, "y": 300.1 },
        { "obs_id": "obs-002", "x": 131.9, "y": 296.7 }
      ]
    }
  ]
}
```

### `GET /api/candidates?field_id=&status=&min_quality=&include_simulated=false`

```json
{
  "generated_at": "2026-11-15T02:10:00Z",
  "pipeline_version": "0.3.1",
  "candidates": [
    {
      "id": "cand-0007",
      "field_id": "taurus-ecliptic-01",
      "status": "known",
      "simulated": false,
      "observation_count": 4,
      "motion": { "rate_arcsec_per_hr": 31.2, "position_angle_deg": 102.5 },
      "quality": { "level": "high", "mean_snr": 18.4 },
      "known_match": { "matched": true, "name": "(12345) Example" },
      "thumbnail_url": "/static/candidates/cand-0007/thumb.webp",
      "summary_plain": "Moves steadily across 4 images and matches a known asteroid."
    }
  ]
}
```

`status` is one of `"known" | "unexplained" | "likely_artifact" | "simulated"`. The backend owns this classification; the frontend never upgrades a status.

### `GET /api/candidates/{candidate_id}`

```json
{
  "id": "cand-0012",
  "field_id": "taurus-ecliptic-01",
  "status": "unexplained",
  "simulated": false,
  "summary_plain": "A faint dot that moves in a straight line across 3 images. It does not match any known object we checked.",
  "detections": [
    {
      "obs_id": "obs-001",
      "obs_time": "2025-05-02T03:14:00Z",
      "ra_deg": 60.1432, "dec_deg": 21.3871,
      "x_px": 245.1, "y_px": 198.6,
      "pos_err_arcsec": 1.8,
      "flux": { "value": 12.3, "err": 2.1, "units": "uJy" },
      "snr": 5.9,
      "wavelength_um": 1.62,
      "cutout_url": "/static/candidates/cand-0012/obs-001.webp",
      "cutout_size_px": 64,
      "flags": [],
      "source": { "file": "level2_..._spx_l2b.fits", "obs_id": "2025W18_1A_0123", "archive_url": "https://irsa.ipac.caltech.edu/..." }
    }
  ],
  "motion": {
    "model": "linear",
    "rate_arcsec_per_hr": 2.4,
    "rate_err_arcsec_per_hr": 0.3,
    "position_angle_deg": 87.0,
    "fit_rms_arcsec": 1.1,
    "chi2_reduced": 0.9,
    "time_baseline_hr": 70.5
  },
  "quality": {
    "level": "medium",
    "mean_snr": 6.2,
    "detections": 3,
    "score": 0.64,
    "score_definition": "Classifier probability of a real moving source (0-1)"
  },
  "known_match": {
    "matched": false,
    "catalogs_checked": ["JPL SBDB / Horizons", "MPC"],
    "search_radius_arcsec": 60,
    "nearest": { "name": "2019 AB12", "separation_arcsec": 410.0, "predicted_ra_deg": 60.25, "predicted_dec_deg": 21.33 }
  },
  "error_sources": [
    { "id": "cosmic_ray", "label": "Cosmic-ray hit", "explanation": "A particle strike can make a dot appear in one image.", "status": "ruled_out", "evidence": "Detected in 3 separate images." },
    { "id": "detector_artifact", "label": "Detector artifact", "explanation": "Hot pixels or ghosts can mimic a source.", "status": "not_ruled_out", "evidence": "Positions are near a detector edge in obs-003." },
    { "id": "misassociation", "label": "Unrelated dots linked together", "explanation": "Three separate faint dots can line up by chance.", "status": "unknown", "evidence": null },
    { "id": "catalog_gap", "label": "Object missing from catalogs", "explanation": "Some real asteroids are not yet catalogued.", "status": "unknown", "evidence": null }
  ],
  "ai_explanation": {
    "text": "This candidate was detected in 3 images over 70.5 hours, moving at 2.4 ± 0.3 arcsec per hour...",
    "cites": ["motion.time_baseline_hr", "motion.rate_arcsec_per_hr", "quality.mean_snr"],
    "model": "…",
    "generated_at": "2026-11-15T02:12:00Z",
    "grounding_note": "Generated only from the measured values in this report."
  },
  "spectrum": null,
  "injection": null,
  "provenance": { "pipeline_version": "0.3.1", "run_id": "run-2026-11-15-01" }
}
```

Optional blocks:

```json
"spectrum": {
  "units": { "wavelength": "um", "flux": "uJy" },
  "points": [ { "band_index": 0, "wavelength_um": 0.75, "flux": 10.2, "flux_err": 1.4, "obs_id": "obs-001" } ]
}
```

```json
"injection": {
  "injected": { "magnitude_ab": 19.5, "rate_arcsec_per_hr": 3.0, "position_angle_deg": 45.0 },
  "recovered": true,
  "recovered_rate_arcsec_per_hr": 2.9,
  "position_error_arcsec": 1.2
}
```

### `GET /api/injection/summary`

```json
{
  "simulated": true,
  "run_id": "inj-2026-11-15-01",
  "bins": [
    { "magnitude_ab": 18.0, "rate_arcsec_per_hr": 3.0, "injected": 50, "recovered": 49 },
    { "magnitude_ab": 20.0, "rate_arcsec_per_hr": 3.0, "injected": 50, "recovered": 21 }
  ],
  "example_candidate_ids": ["sim-0001", "sim-0002"]
}
```

Contract rules:

- Every image object carries a `source` (or links to an observation that does). The frontend refuses to render an image without one and shows a "Missing source" placeholder, so gaps are caught early.
- `simulated: true` anywhere means the SIMULATED badge and banner are mandatory.
- `ai_explanation` may be `null`; the report still works without it.
- `cites` paths must resolve inside the same JSON. The frontend highlights the cited values and drops (with a console warning) any citation that does not resolve.
- Unknown fields are ignored, so the backend can add fields without breaking the frontend.

## 5. Tech choices (frontend)

- **Next.js (App Router) + TypeScript.** Static export where possible so the demo can be hosted on Vercel/GitHub Pages and survive a backend outage by falling back to bundled fixtures.
- **Styling:** CSS variables for the tokens above plus CSS Modules or Tailwind mapped to the same tokens. Pick one at kickoff; tokens are written first either way.
- **Blink viewer:** plain `<canvas>` or stacked `<img>` with CSS opacity for blink/swipe. This is simpler and more reliable than a full sky viewer for aligned cutouts.
- **Sky map:** Aladin Lite v3 on `/explore` only (P1), showing a survey background (e.g. a HiPS from IRSA or CDS) with our field footprints. Lazy-loaded so it never slows the blink viewer. If it fights us, fall back to the card picker.
- **Charts:** a small library (e.g. Recharts or lightweight SVG) for motion plot, spectrum and injection recovery.
- **Data layer:** one `api.ts` with typed fetchers and a `USE_FIXTURES` switch.

## 6. 48-hour build schedule

Hours are counted from kickoff (H0 = Sat Nov 14, 9:00 AM Pacific). Adjust the final hours to our local event's exact submission deadline.

| Hours | Frontend work | Sync with backend / science |
|---|---|---|
| H0–H2 | Read final challenge text. Scaffold Next.js app, tokens, layout shell, routes. Commit fixtures from section 4. | Agree on JSON contract (30-minute meeting). Pick 2–3 demo fields with Bodhi. |
| H2–H8 | **BlinkViewer** (blink, swipe, step, preload, labels, SourceDrawer) on fixture images. Landing page. | Backend: first real cutouts for one field. |
| H8–H12 | Field picker cards. Wire `/explore/[fieldId]` to real cutouts as soon as they exist. Phone-width pass on the viewer. | Check alignment and stretch of real cutouts; fix with Bodhi. |
| H12–H18 | Candidate list + StatusBadge + QualityMeter. Evidence report skeleton: header, cutout strip, MeasurementTable, motion section. | Backend: first candidates JSON. |
| H18–H24 | Sleep in shifts. Before sleeping: deploy a preview build so teammates can test. | — |
| H24–H30 | Report: known-object match, ErrorSourceChecklist, AIExplanation with citations, provenance. MotionOverlay in Explorer ("Show me what moved") + bottom sheet linking to report. | Backend: AI explanation endpoint, known-object matches. |
| H30–H36 | `/simulated` injection demo + SimulatedBanner. `/about` page with credits and integrity statement. Stretch: SpectrumPlot if data is ready. | Backend: injection summary. |
| H36–H40 | **Feature freeze.** Polish the demo path only: loading states, empty/error states, reduced motion, accessibility (focus, contrast, alt text), phone testing on real devices. | Freeze data for the demo; bundle it as fixtures fallback. |
| H40–H45 | Record the 3-minute video: script → screen capture of the demo path (phone + desktop) → edit. Final copy check for "discovery" language. | Whole team reviews the video. |
| H45–H48 | Buffer. Final deploy, README links, screenshots, submission form. | Submit. |

Cut order if behind schedule: Aladin map → spectrum → injection controls (keep a static injection result) → candidate filters. Never cut: blink viewer, evidence report, provenance, SIMULATED labels.

### Demo script draft (3 minutes)

1. (0:00–0:20) Hook: "The sky changes. SPHEREx photographs it again and again in infrared. What moved?"
2. (0:20–1:10) Explorer: pick a field, blink, tap "Show me what moved", tap a known asteroid.
3. (1:10–2:10) Detective: candidate list, open an unexplained candidate, walk through measurements, error sources and the AI explanation's citations.
4. (2:10–2:40) Injection demo: we hid fake objects in real data and measured how many we recover.
5. (2:40–3:00) Integrity and impact: "We're not claiming Planet X. We're giving everyone the tools to look."

## 7. Pre-kickoff checklist

Allowed before Nov 14 (no application code):

- [ ] Low-fidelity wireframes: Landing, Field picker, Blink viewer (phone + desktop), Candidate list, Evidence report, Injection demo.
- [ ] Design tokens written up (colors, type, spacing) and contrast-checked.
- [ ] Copy deck: plain-language strings for Explorer, glossary entries, integrity statement, badge labels.
- [ ] Data-access tests (with Bodhi): query IRSA for SPHEREx images over a candidate ecliptic field; confirm what metadata (obs time, wavelength per pixel, WCS) is available; check whether an IRSA HiPS exists that Aladin Lite can load.
- [ ] Aladin Lite v3 research: embedding in Next.js (client-only), overlaying footprints and markers, mobile performance.
- [ ] Review this JSON contract with the backend owner and agree on it at kickoff.
- [ ] Draft the demo video script and shot list.

## 8. Open questions

- Which fields have enough revisits on short enough timescales to show motion in a blink? (Bodhi)
- How do we normalize brightness between frames taken at different wavelengths so the blink is not misleading? (Bodhi)
- Cutout size and format: 512 px WebP for fields, 64 px for candidate cutouts? (backend)
- Which LLM and prompt produce the AI explanation, and how is grounding enforced server-side? (AI/ML owner)
- Hosting: Vercel for the frontend, and where does FastAPI run during judging? (team)
