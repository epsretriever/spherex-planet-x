# Fixtures

Recorded backend responses for real SPHEREx fields, one file per endpoint shape:

| File | Endpoint | Model |
|---|---|---|
| `fields.json` | `GET /api/fields` | `FieldList` |
| `field_detail.json` | `GET /api/fields/{field_id}` | `FieldDetail` |
| `candidates.json` | `GET /api/candidates` | `CandidateList` |
| `candidate_detail.json` | `GET /api/candidates/{candidate_id}` | `CandidateDetail` |
| `injection_study.json` | `GET /api/injection/{study_id}` | `InjectionStudy` |

They are written by `spherex-px record-fixtures` from the showcase build the API serves, and images they reference are copied to `static/`. Nothing here is written by hand. Run `spherex-px validate-fixtures` (or the backend tests) after changing the contract.
