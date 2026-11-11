# Driftnet

*Find what moves in real NASA SPHEREx infrared images, from asteroids to the search for Planet X.*

NASA Space Apps Challenge 2026 · Challenge: Planet X and SPHEREx

A public web tool that lets anyone explore how the infrared sky changes over time using real data from NASA's SPHEREx mission.

**Try it live: https://driftnet-sky.vercel.app**

Old links (`/explore/`, `/detective/…`, `/leads/`) redirect to their new homes, query strings included.

| Page | What you can do |
|---|---|
| [Objects](https://driftnet-sky.vercel.app/objects/) | Every moving object in one list: search, filters and AI search; tabs for **Unexplained leads** (ranked, with follow-up files), **Known (JPL)** and **Patches of sky** to blink. Each object has one report page with its images, orbit in 3D, spectrum and JPL check; each patch shows its movers' tracks in 3D (sky × time). |
| [Compare](https://driftnet-sky.vercel.app/objects/compare/) | Any two objects side by side, with both orbits in one 3D view. The pair is in the address, so a comparison is a link you can share. |
| [Sky map](https://driftnet-sky.vercel.app/sky/) | Where we have searched, as a flat all-sky map or a 3D globe, with the Planet Nine search region; and every tracked object placed in the solar system in 3D |
| [Limits](https://driftnet-sky.vercel.app/limits/) | How faint and how slow an object the pipeline can find, measured with simulated objects |
| [About](https://driftnet-sky.vercel.app/about/) | Pipeline diagram, data sources and citations, honest limitations, team |
| `/api/objects/{id}/ades.xml` | An object's measured positions in the Minor Planet Center's ADES format: a draft for a person to review. The site never submits anything, and simulated objects have no export. |
| [`/api/health`](https://spherex-planet-x.bodhishanbhag.workers.dev/api/health) | Live status of the NASA IRSA, JPL SBIdent, JPL Horizons and SPHEREx archive connections |

## How it works

```
 NASA SPHEREx images (public S3 archive)
        │  pipeline/  (Python, run offline)
        │  find sources → reject stars → link moving tracks → score → render WebP
        ▼
 frontend/public/data/   real field + candidate JSON and images, committed
        │
        ▼
 Cloudflare Worker  (worker/, TypeScript + Hono)  ──►  live calls to NASA IRSA TAP,
   serves /api/*  and the website (frontend/out)       JPL SBIdent and JPL Horizons
        │                                               (known-asteroid check, cached 24 h)
        ▼
 Website (frontend/, Next.js static export)  ──  served by Vercel at driftnet-sky.vercel.app,
                                                 which proxies /api/* to the Worker
```

Pixel processing is too heavy to run inside a Worker, so it happens ahead of time in `pipeline/`. Everything that depends on today's catalogs, like whether a moving dot is a known asteroid, is checked live by the Worker on each request.

## The idea

SPHEREx maps the whole sky in 102 infrared wavelength bands and revisits each region over time. Objects that move between observations, like asteroids, comets and distant solar system bodies, reveal themselves by shifting position. Our app has two layers:

**Explorer mode:** pick a patch of sky, blink between real SPHEREx observations taken at different times, and see what moved.

**Detective mode:** an image-processing pipeline flags potential moving sources, cross-checks them against known-object catalogs, and shows an evidence report for each candidate: positions, dates, measured motion, signal quality and an AI-generated explanation grounded in the measurements.

We also test the pipeline by injecting simulated moving objects into real images, to measure how faint and how slow an object we can actually recover.

## Scientific integrity

We do not claim to discover Planet X. A candidate that does not match a known object could be an imaging artifact, a measurement error, or an object missing from the catalog. Planet X is our scientific motivation, not a promised result.

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React / Next.js (static export) on Vercel; three.js for the 3D figures, loaded only when one is on screen |
| Backend | Cloudflare Worker (TypeScript, Hono), D1, KV |
| Pipeline | Python, run in GitHub Actions; reads SPHEREx Level 2 images from NASA's public S3 bucket |
| Science | Astropy, Photutils, NumPy, SciPy |
| AI | Workers AI (Llama 3.3 70B) for write-ups, "Ask about this object" and natural-language search, every number checked against the measurements; Isolation Forest anomaly ranking ("Most unusual", scikit-learn) with a plain-language reason |
| Data | SPHEREx images from NASA/IPAC IRSA, JPL small-body data |

## Team

| Name | Role |
|---|---|
| Armaan | Frontend, UI/UX, sky viewer, object reports |
| Bodhi | NASA data research, image analysis, scientific validation, backend and AI |

## Repository layout

| Path | Contents |
|---|---|
| `worker/` | Cloudflare Worker (Hono): `/api/*`, live IRSA and JPL queries |
| `pipeline/` | Python package `spherex_px`: offline SPHEREx data access, detection, linking, scoring; writes `frontend/public/data/` |
| `frontend/` | Next.js website (static export; deployed by Vercel, and served by the Worker too) |
| `frontend/public/data/` | Real showcase data built by the pipeline |
| `scripts/build.mjs` | Root build used by Cloudflare: builds the site, type-checks the Worker |
| `wrangler.toml` | Cloudflare Worker configuration |
| `shared/schema/` | JSON Schema for every API response, exported from the backend models |
| `shared/fixtures/` | Recorded API responses for real SPHEREx fields |
| `docs/api-contract.md` | Backend ↔ frontend JSON contract |
| `docs/backend-plan.md` | Backend architecture and science approach |
| `docs/frontend-plan.md` | Frontend screens, flows and design system |
| `docs/build-plan.md` | Roadmap: discovery engine, ML, AI features and audit fixes |

## Development

Requires Node.js 20 or newer.

```bash
npm ci
npm run build      # frontend static export into frontend/out + Worker type-check
npx wrangler dev   # site + API on http://localhost:8787 (Workers AI is remote: needs `npx wrangler login`)
npm run dev:offline   # the same without Cloudflare credentials; AI features return their template text
npm test           # Worker tests (vitest)
npm test --workspace frontend   # frontend unit tests
```

Deployment: both hosts deploy from `main` and post a preview on every pull request. Cloudflare Workers Builds runs `npm ci && npm run build`, then `npx wrangler deploy`; the Worker is named `spherex-planet-x` (see `wrangler.toml`) and serves `/api/*` plus the static site. Vercel (project `driftnet`, root directory `frontend/`) builds the same static export and serves the public site, proxying `/api/*` to the Worker (`frontend/vercel.json`). The deployed Worker leaves the sky images out to stay under Cloudflare's asset limit, so use the Vercel site for pages.

Checks on every pull request (`.github/workflows/frontend-quality.yml`): the build, lint, type-check and unit tests, Playwright screenshots of every page on real data at 360, 768 and 1280 px, and Lighthouse (performance, accessibility, best practices ≥ 90).

### Pipeline (static data)

The Python pipeline in `pipeline/` reads real SPHEREx Level 2 cutouts from the public `nasa-irsa-spherex` S3 bucket and writes `frontend/public/data/`.

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e "pipeline[dev]"
spherex-px build          # rebuild every showcase field (pipeline/spherex_px/config/showcase.toml)
spherex-px rank-pairs     # re-rank blink pairs for built fields
(cd pipeline && pytest)
```

Commit pipeline code before building: the data is stamped with the commit of the code that made it (`pipeline_version`) plus a `build_run_id`, and builds from uncommitted pipeline code are refused. `node scripts/record-fixtures.mjs [--base URL]` records real API responses into `shared/fixtures/`.

## Data credits

SPHEREx data: NASA / JPL-Caltech / IPAC, via the NASA/IPAC Infrared Science Archive.

## Frontend

The website lives in [`frontend/`](frontend/): a Next.js static export served by the Cloudflare Worker. See [`frontend/README.md`](frontend/README.md) for setup, scripts and how it talks to the API.

## Orbits

Every moving object gets an orbit (`pipeline/spherex_px/science/orbit.py`). A SPHEREx track spans hours to a couple of days, too short for a unique orbit, so the pipeline maps all the orbits that fit. Statistical ranging (Virtanen et al. 2001) samples the object's distance at its first and last detections, and each sample gives an orbit through those two points. Every orbit is then checked against all the detections, using two-body motion, light time and SPHEREx's real position in space. Least squares refines the best one, and 100 orbit clones carry the uncertainty.

Each object page shows:
- the distance from the Sun (median and 5–95% range of the clones), which is the robust result;
- a distance class, named only when most clones agree;
- the 3D uncertainty cloud;
- a 60-day prediction whose note says plainly how far it can be trusted.

The method is tested on simulated asteroids observed at real SPHEREx times and positions (`spherex-px orbit-validation`, served at `/api/validation/orbits`). For orbits JPL already knows, the Worker compares ours with JPL Horizons (`/api/validation/jpl-orbits`).

## What is it made of?

SPHEREx sees each sighting through a different part of its filters, so a moving asteroid builds up a coarse 0.75–5 µm spectrum. `pipeline/spherex_px/science/composition.py` corrects each point for the object's changing distance and phase angle (from its orbit clones), divides by the Sun's spectrum (ASTM E490-00a) and compares the reflectance with the Bus-DeMeo asteroid class means (DeMeo et al. 2009). It also measures the 2.7–3.1 µm hydration band where thermal emission is negligible. Each object page shows the result as indicative only, with its confidence and caveats. `.github/workflows/composition.yml` fetches JPL's published types for identified objects and reports the agreement (`/api/validation/composition`, shown on the Limits page).

## Survey

Beyond the three showcase fields, `.github/workflows/survey.yml` searches SPHEREx week segments tile by tile along the ecliptic. It runs on GitHub's machines (they read the images straight from the public `nasa-irsa-spherex` S3 bucket) in 15 parallel shards, keeps every 0.3° tile where the pipeline found a moving object that passed vetting, and commits the result to `main`. Cloudflare then redeploys, and the Worker's cron checks each new candidate against JPL. It runs weekly, on every pipeline change, and on demand (Actions → Survey → Run workflow, where you can list more segments).

Tiles searched without finding anything are recorded too: `data/survey/footprint.json` keeps every tile ever searched with its latest result (with moving objects, empty, or failed and why), and `data/survey/ledger.json` keeps one row per run. `/api/survey` serves both, so the sky map shows where the survey looked and found nothing, not just its finds.
