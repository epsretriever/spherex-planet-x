# Frontend

The public website for spherex-planet-x: a Next.js app, exported as static files and served by the `spherex-planet-x` Cloudflare Worker alongside the TypeScript API.

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
| `npm run test:e2e` | Playwright tests against `out/` at desktop and phone widths (run `npm run build` first) |

## How it fits together

- **Static export only.** `next.config.ts` sets `output: "export"`, `trailingSlash: true` and unoptimized images. There are no API routes, middleware or server rendering at request time.
- **Data is fetched in the browser** from relative URLs: `/api/fields`, `/api/fields/{field_id}`, `/api/candidates`, `/api/candidates/{candidate_id}` and `/api/injection/{study_id}`. Image URLs in responses (`/static/...`) are on the same origin.
- **Dynamic pages use query parameters,** so they build without any data present:
  - `/explore/field/?id={field_id}`: blink viewer
  - `/detective/candidate/?id={candidate_id}`: evidence report
  - `/simulated/?study={study_id}`: injection-recovery results (optional parameter)
- **Fixture mode** (`NEXT_PUBLIC_USE_FIXTURES=true`) reads `/data/` instead of `/api/`. Lookup order: `fields.json`; `fields/{field_id}.json`, then `field_detail.json`; `candidates.json` (filtered in the browser); `candidates/{candidate_id}.json`, then `candidate_detail.json`; `injection/{study_id}.json`, then `injection_study.json`. Root-relative image URLs resolve under `/data/` too (for example `/static/x.webp` → `/data/static/x.webp`).
- **The contract** is `docs/api-contract.md`, with JSON Schema in `shared/schema/`. `src/lib/contract.ts` mirrors it by hand. Fix that file when the contract changes.

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
| `src/app/globals.css` | Design tokens (colors, type, spacing, motion) |
| `e2e/` | Playwright tests. `e2e/support/mockApi.ts` answers `/api/*` inside the test browser with clearly synthetic test data; it is never served by the app. |

## Testing notes

- `vitest` is pinned to 3.2.x. Newer majors trigger an npm bug (`Cannot read properties of null (reading 'edgesOut')`) when installed through the root npm workspace, which would break the Cloudflare build. `npm audit` reports advisories against `vitest` 3.x's test-runner internals (tinypool, @vitest/mocker); they're dev-only and never reach `out/`.
- Playwright is pinned to the version whose Chromium is installed in our dev containers. Elsewhere, run `npx playwright install chromium` once.
