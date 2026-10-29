# SPHEREx Planet X Explorer

NASA Space Apps Challenge 2026 · Challenge: Planet X and SPHEREx

A public web tool that lets anyone explore how the infrared sky changes over time using real data from NASA's SPHEREx mission.

**Try it live: https://spherex-planet-x.bodhishanbhag.workers.dev**

| Page | What you can do |
|---|---|
| [Explore](https://spherex-planet-x.bodhishanbhag.workers.dev/explore/) | Pick a patch of sky and blink, swipe or step between real SPHEREx images to see what moved |
| [Detective](https://spherex-planet-x.bodhishanbhag.workers.dev/detective/) | Browse flagged moving objects and open an evidence report for each one |
| [Simulated](https://spherex-planet-x.bodhishanbhag.workers.dev/simulated/) | See how well the pipeline recovers fake objects hidden in real images |
| [About](https://spherex-planet-x.bodhishanbhag.workers.dev/about/) | How it works, data sources and a glossary |
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
 Website (frontend/, Next.js static export)
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
| Frontend | React / Next.js |
| Backend | Cloudflare Worker (TypeScript, Hono) |
| Pipeline | Python offline builder |
| Science | Astropy, Photutils, NumPy, SciPy |
| AI / ML | scikit-learn or PyTorch |
| Data | SPHEREx images from NASA/IPAC IRSA, JPL small-body data |

## Team

| Name | Role |
|---|---|
| Armaan | Frontend, UI/UX, sky viewer, candidate dashboard |
| Bodhi | NASA data research, image analysis, scientific validation |
| TBD | AI/ML, candidate ranking, backend, integration |

## Repository layout

| Path | Contents |
|---|---|
| `worker/` | Cloudflare Worker (Hono): `/api/*`, live IRSA and JPL queries |
| `pipeline/` | Python package `spherex_px`: offline SPHEREx data access, detection, linking, scoring; writes `frontend/public/data/` |
| `frontend/` | Next.js website (static export served by the Worker) |
| `frontend/public/data/` | Real showcase data built by the pipeline |
| `scripts/build.mjs` | Root build used by Cloudflare: builds the site, type-checks the Worker |
| `wrangler.toml` | Cloudflare Worker configuration |
| `shared/schema/` | JSON Schema for every API response, exported from the backend models |
| `shared/fixtures/` | Recorded API responses for real SPHEREx fields |
| `docs/api-contract.md` | Backend ↔ frontend JSON contract |
| `docs/backend-plan.md` | Backend architecture and science approach |
| `docs/frontend-plan.md` | Frontend screens, flows and design system |

## Development

Requires Node.js 20 or newer.

```bash
npm ci
npm run build      # frontend static export into frontend/out + Worker type-check
npx wrangler dev   # site + API on http://localhost:8787
npm test           # Worker tests (vitest)
npm test --workspace frontend   # frontend unit tests
```

Deployment: Cloudflare Workers Builds runs `npm ci && npm run build`, then `npx wrangler deploy`, on every push to `main`, and posts a preview link on every pull request. The Worker is named `spherex-planet-x` (see `wrangler.toml`). It serves `/api/*` and falls back to the static site for every other path.

## Data credits

SPHEREx data: NASA / JPL-Caltech / IPAC, via the NASA/IPAC Infrared Science Archive.

## Frontend

The website lives in [`frontend/`](frontend/): a Next.js static export served by the Cloudflare Worker. See [`frontend/README.md`](frontend/README.md) for setup, scripts and how it talks to the API.
