# spherex-planet-x

NASA Space Apps Challenge 2026 · Challenge: Planet X and SPHEREx

A public web tool that lets anyone explore how the infrared sky changes over time using real data from NASA's SPHEREx mission.

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
| Backend | Python, FastAPI |
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
| `backend/` | Python package `spherex_px`: data access, science pipeline, FastAPI service |
| `frontend/` | Next.js app |
| `shared/schema/` | JSON Schema for every API response, exported from the backend models |
| `shared/fixtures/` | Recorded API responses for real SPHEREx fields |
| `docs/api-contract.md` | Backend ↔ frontend JSON contract |
| `docs/backend-plan.md` | Backend architecture and science approach |
| `docs/frontend-plan.md` | Frontend screens, flows and design system |

## Data credits

SPHEREx data: NASA / JPL-Caltech / IPAC, via the NASA/IPAC Infrared Science Archive.
