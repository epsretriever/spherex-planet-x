# Frontend

The public website for Driftnet: a Next.js app exported as static files. Vercel serves it at https://driftnet-sky.vercel.app and proxies `/api/*` to the `spherex-planet-x` Cloudflare Worker (`vercel.json`); the Worker also serves the same export itself.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

`npm run dev` proxies `/api/*` and `/static/*` to `npx wrangler dev` on port 8787. Run the Worker from the repository root in another terminal. Without it, pages show a friendly "can't reach the sky data" state; they never fall back to made-up data.

To run without the Worker, use the JSON the backend commits to `public/data/`:

```bash
NEXT_PUBLIC_USE_FIXTURES=true npm run dev
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development server with the API proxy |
| `npm run build` | Static export to `frontend/out/` (what the Worker serves) |
| `npm start` | Serves `out/` locally on port 4173, the way the Worker does |
| `npm run check` | Lint, typecheck and unit tests |
| `npm run test:e2e` | Playwright tests against `out/` at desktop and phone widths, with synthetic API responses (run `npm run build` first) |
| `npm run test:real` | Playwright on **real data**: starts `wrangler dev` at the repo root and screenshots every page at 360, 768 and 1280 px, checking for a heading, no horizontal overflow and no console errors. Screenshots land in `test-results-real/`. Run `npm run build` at the root first. |
| `npm run lighthouse` | Lighthouse on real data (median of 5 runs) for Home, an Explore field, an evidence report, the sky map and the object list; fails below 90 for performance, accessibility or best practices. HTML reports land in `lighthouse-reports/`. |
| `node scripts/make-share-images.mjs` | Re-renders `public/og.png` and `src/app/apple-icon.png` after a brand change |

## How it fits together

- **Static export only.** `next.config.ts` sets `output: "export"`, `trailingSlash: true` and unoptimized images. There are no API routes, middleware or server rendering at request time.
- **Data is fetched in the browser** from relative URLs: `/api/fields`, `/api/fields/{field_id}`, `/api/candidates`, `/api/candidates/{candidate_id}` and `/api/injection/{study_id}`. Image URLs in responses (`/static/...`) are on the same origin.
- **Dynamic pages use query parameters,** so they build without any data present:
  - `/explore/field/?id={field_id}`: blink viewer
  - `/objects/object/?id={object_id}`: an object's report (`?candidate=` for a simulated sighting with no object)
  - `/objects/?view=leads|patches`, `?class=known_object`: the Objects page tabs; old `/detective/`, `/leads/`, `/explore/` and
    `/detective/{candidate_id}/` URLs forward here (vercel.json redirects, plus `src/components/Moved.tsx` on other hosts)
  - `/objects/compare/?a={object_id}&b={object_id}`: two objects side by side; the pair lives in the address, so any comparison is a link
  - `/simulated/?study={study_id}`: injection-recovery results (optional parameter)
- **Fixture mode** (`NEXT_PUBLIC_USE_FIXTURES=true`) reads `/data/` instead of `/api/`. Lookup order: `fields.json`; `fields/{field_id}.json`, then `field_detail.json`; `candidates.json` (filtered in the browser); `candidates/{candidate_id}.json`, then `candidate_detail.json`; `injection/{study_id}.json`, then `injection_study.json`. Root-relative image URLs resolve under `/data/` too (for example `/static/x.webp` → `/data/static/x.webp`).
- **The contract** is `docs/api-contract.md`, with JSON Schema in `shared/schema/`. `src/lib/contract.ts` mirrors it by hand. Fix that file when the contract changes.

## Deployment settings

- `NEXT_PUBLIC_SITE_URL` (build variable): the deployed origin. Defaults to `https://driftnet-sky.vercel.app`; canonical links, the share image, `robots.txt` and `sitemap.xml` (`src/app/robots.ts`, `src/app/sitemap.ts`) are built from it.
- The 404 page is exported as `out/404.html`. To serve it for unknown URLs, the Worker's `wrangler.toml` needs `not_found_handling = "404-page"`. With `"single-page-application"`, unknown URLs get the landing page with status 200. Every route here has its own `index.html`, so SPA fallback isn't needed.

## Continuous checks

`.github/workflows/frontend-quality.yml` runs the build, `npm run check`, `npm run test:real` and `npm run lighthouse` on every pull request that touches the site or the Worker, and uploads the screenshots and Lighthouse reports as artifacts.

## Object names

Cards and reports are titled by object, not by status (`src/lib/names.ts`):

- A JPL-matched object uses its designation, for example "(2524) Budovicium".
- Anything else is "Moving object A in Aquarius". The constellation comes from the field's center using the IAU boundaries (`src/lib/constellation.ts`, Roman 1987). Letters run across every published candidate in that constellation in order of first sighting, then ID, so a name stays the same on every page.
- Simulated objects are lettered separately ("Simulated object A in …") so they never shift real names.
- The pipeline ID is always shown as secondary text.

## AI features (contract v1.1, build plan section 6)

- **Write-up.** The report's "In plain words" section fetches `GET /api/candidates/{id}/writeup` when the reader scrolls near it. With an answer, it shows the verdict and three paragraphs. Each number links to the value it came from in `grounded_fields`. The section is labeled with the API's `label_plain` and model ID. Template text (`source: "template"`) is labeled as template text, never as AI.
- **Ask about this object.** A chat that posts to `POST /api/ask`. It appears only once the write-up has answered, which shows the AI endpoints are live. The citations are JSON paths, shown as chips that hold the value and link to the report section where it appears (`src/lib/citations.ts`). An answer with `answered_from_data: false` is tagged "The data doesn't tell us". A 429 shows the API's own `detail`. The session id is anonymous and kept in `sessionStorage`.
- **Search by description.** On the Detective page, `POST /api/search` returns a `CandidateFilter`. The page cleans it (`normalizeFilter`), writes it to the URL, and shows each part as a removable chip; the regular controls edit the same values. The `unusual` sort uses the published anomaly ranking; while an object list carries no ranking, its chip says the list is sorted by score.
- With no AI endpoints (a 404 or 501), or in fixture mode, all three step aside. The report keeps the explanation published with it, and search says it is off.
- `e2e/ai.spec.ts` covers all of this with synthetic AI responses (`installMockApi(page, { ai: true })`).

## Objects and orbits (build plan row 6)

- `/objects/` lists every linked object, and `/objects/{object_id}/` is prerendered for each one. Unknown IDs fall back to `/objects/object/?id=`, as for fields and candidates.
- Visits are sightings grouped with gaps over 30 minutes, the same rule as the contract's `n_visits`. The distance class and its ranges come from the contract (`src/lib/objects.ts`).
- The orbit view (`src/components/orbit/`) uses three.js. It is loaded with `import()` only when an object has a drawable orbit and the panel scrolls into view, so no other page pays for it. When WebGL is unavailable, or the reader asks for it, a flat SVG view replaces it.
- The uncertainty cloud uses `orbit.clones_url` when it serves a list of elements. Otherwise it samples `orbit.n_clones` clones (at most 200) from `orbit.covariance` with a fixed seed. Clones that aren't ellipses are dropped.
- Planets come from Standish's J2000 mean elements, with only the mean longitude advanced: good for a diagram, not for astrometry. The orbit math is tested in `src/lib/orbit.test.ts`.

## 3D figures

Every 3D figure shares one small stage (`src/components/three/stage.ts`): drag-to-turn controls, HTML labels, and drawing only while the view changes and the figure is on screen. three.js is never in a page's first load: `Figure3D` imports the scene when the figure scrolls into view (or, for the globe, when the reader picks it), and shows a flat SVG of the same data when WebGL can't start or the reader asks for it. With reduced motion requested nothing turns on its own.

| Figure | Where | Data | Flat fallback |
|---|---|---|---|
| Orbit with uncertainty cloud (`orbit/OrbitScene.tsx`) | each object's report; two orbits together on the compare page | the object's published orbit and clones | top-down SVG |
| Sky globe (`three/SkyGlobe.tsx`) | Sky map, "3D globe" view | the survey tiles, empty patches and Planet Nine region the flat map draws | the flat map itself |
| Solar-system view (`three/SolarSystemScene.tsx`) | Sky map | `/objects/system.json`, written at build time from every published orbit (`src/lib/system.ts`); simulated objects are left out | top-down SVG with a link per object |
| Sky × time tracks (`three/FieldTracksScene.tsx`) | each patch of sky, under the blink viewer | the field's measured mover tracks (`src/lib/fieldTracks.ts`); simulated movers are labelled SIMULATED | SVG of the paths on the sky |

## Performance notes

- Pages that read `?id=` start their API requests from an inline script in the static HTML (`PrefetchData`), so data downloads while the JavaScript does.
- CSS is inlined (`experimental.inlineCss`) and fonts are preloaded via `next/font/local` (`src/fonts/`).
- Heavy subtrees mount in a React transition (`Deferred`) or when scrolled near (`WhenVisible`), keeping the main thread free on first load.
- Site-chrome links don't prefetch, so they don't compete with the page's own data on slow connections.

## Rules the UI enforces

- Every image needs a `source` block. An image without one is replaced by a "Missing source" placeholder and its Source button is disabled.
- `classification` is displayed exactly as sent and never upgraded: `unmatched` shows as **Unexplained**, `unconfirmed_pair` as **Unconfirmed pair**, `injected` as **SIMULATED** (always with a hatched badge, and hidden unless the viewer opts in).
- Wavelength-matched blink pairs are the default. Unmatched pairs say "Different wavelengths: brightness changes are expected".
- The rule-based score is never described as a probability.
- With reduced motion requested, the viewer starts in Swipe and never auto-blinks; other animations are switched off.

## Code map

| Path | Contents |
|---|---|
| `src/app/` | Routes (App Router). Pages that read query params render a client view inside `<Suspense>`. |
| `src/components/BlinkViewer.tsx` | Blink / swipe / step viewer, zoom and pan, what-moved overlay, mover sheet, provenance drawer |
| `src/lib/api.ts` | Fetchers, fixture mode, error mapping |
| `src/lib/contract.ts` | API types |
| `src/lib/blink.ts`, `grid.ts`, `grounding.ts` | Blink pairing, grid ↔ image ↔ sky conversion, explanation grounding |
| `src/components/three/` | Shared 3D stage, the lazy `Figure3D` wrapper and the globe, solar-system and track scenes |
| `src/lib/compare.ts`, `src/app/objects/compare/` | The side-by-side comparison of two objects |
| `src/app/globals.css` | Design tokens (colors, type, spacing, motion) |
| `e2e/` | Playwright tests. `e2e/support/mockApi.ts` answers `/api/*` inside the test browser with clearly synthetic test data; it is never served by the app. |

## Testing notes

- `vitest` is pinned to 3.2.x. Newer majors trigger an npm bug (`Cannot read properties of null (reading 'edgesOut')`) when installed through the root npm workspace, which would break the Cloudflare build. `npm audit` reports advisories against `vitest` 3.x's test-runner internals (tinypool, @vitest/mocker); they're dev-only and never reach `out/`.
- Playwright is pinned to the version whose Chromium is installed in our dev containers. Elsewhere, run `npx playwright install chromium` once.
