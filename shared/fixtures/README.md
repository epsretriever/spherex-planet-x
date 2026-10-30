# Fixtures

Real API responses for real SPHEREx data, one file per response shape. They are recorded by `scripts/record-fixtures.mjs` and never edited by hand.

| File | Endpoint | Model |
|---|---|---|
| `fields.json` | `GET /api/fields` | `FieldList` |
| `field_detail.json` | `GET /api/fields/{field_id}` (the field with the most movers) | `FieldDetail` |
| `candidates.json` | `GET /api/candidates?include_injected=true` | `CandidateList` |
| `candidate_detail.json` | `GET /api/candidates/{candidate_id}` (the candidate with the most detections) | `CandidateDetail` |
| `health.json` | `GET /api/health` | `Health` |
| `objects.json` | `GET /api/objects` | `ObjectList` |
| `object_detail.json` | `GET /api/objects/{object_id}` (the object with the most detections) | `ObjectDetail` |
| `survey.json` | `GET /api/survey` | `Survey` |
| `injection_study.json` | `GET /api/injection/{study_id}`, once a study is published | `InjectionStudy` |

`manifest.json` says where and when each file was recorded. A recording from a local `npx wrangler dev` without JPL access shows `known_object.checked: false` and JPL as unreachable in health. A recording from production (`--base https://spherex-planet-x.bodhishanbhag.workers.dev`, or the weekly `Record API fixtures` Action) has the live JPL results.

Validate with `spherex-px validate-fixtures` after any contract change.
