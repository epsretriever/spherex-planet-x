"""Whether a candidate is a candidate for reporting to the Minor Planet Center, test by test.

The pipeline evaluates every test it can measure when the data is published (source
"pipeline"), and the JPL tests (source "jpl") from the catalog check written into the data by the
JPL check Action, if any; without one they stay unevaluated and the status is at best
"incomplete". The Worker re-evaluates the JPL tests from the check it serves
(worker/src/reporting.ts, identical rules).

A candidate for reporting is "not in any catalog we checked", never "new" or "discovered": it
may be a known object JPL's search missed, or an error the tests did not catch, and nothing is
reported without the team's review.
"""

from __future__ import annotations

from . import schemas as S

MIN_VISITS = 3
MAX_ARTIFACT_LIKELIHOOD = 0.2
MAX_ORBIT_RMS_ARCSEC = 1.5
# Vetting checks that each rule out one kind of imaging artifact.
ARTIFACT_CHECKS = (
    "flagged_aperture_pixels",
    "psf_like_shape",
    "edge_distance",
    "not_static",
    "flux_consistent_across_lambda",
)
# JPL tests: kept identical to worker/src/reporting.ts (shared/fixtures/reporting_jpl_cases.json).
NEARBY_KNOWN_ARCSEC = 60.0

LABELS = {
    S.ReportingStatus.ready: "Not in any catalog we checked — candidate for reporting",
    S.ReportingStatus.incomplete: "Catalog check incomplete",
    S.ReportingStatus.not_ready: "Not a candidate for reporting",
}


def _vet(c: S.CandidateDetail, name: str) -> S.VettingCheck | None:
    return next((v for v in c.vetting if v.check == name), None)


def pipeline_criteria(
    c: S.CandidateDetail, orbit_status: S.OrbitStatus, orbit_rms_arcsec: float | None
) -> list[S.ReportingCriterion]:
    """The tests measured from SPHEREx data alone."""
    out = [
        S.ReportingCriterion(
            id="unmatched",
            label="Classified as an unmatched moving object",
            passed=c.classification == S.Classification.unmatched,
            value=c.classification.value,
            threshold=S.Classification.unmatched.value,
            source="pipeline",
        )
    ]
    visits = _vet(c, "min_detections")
    out.append(
        S.ReportingCriterion(
            id="visits",
            label=f"Seen in at least {MIN_VISITS} separate visits",
            passed=None if visits is None or visits.value is None else visits.value >= MIN_VISITS,
            value=None if visits is None else visits.value,
            threshold=MIN_VISITS,
            source="pipeline",
        )
    )
    fit = _vet(c, "motion_fit_rms")
    out.append(
        S.ReportingCriterion(
            id="motion_fit",
            label="Detections lie on its fitted motion",
            passed=None if fit is None else fit.passed,
            value=None if fit is None else fit.value,
            threshold=None if fit is None else fit.threshold,
            source="pipeline",
        )
    )
    out.append(
        S.ReportingCriterion(
            id="artifact_likelihood",
            label="Low likelihood of an imaging artifact",
            passed=c.scores.artifact_likelihood <= MAX_ARTIFACT_LIKELIHOOD,
            value=c.scores.artifact_likelihood,
            threshold=MAX_ARTIFACT_LIKELIHOOD,
            source="pipeline",
        )
    )
    checks = [_vet(c, n) for n in ARTIFACT_CHECKS]
    failed = [v.check for v in checks if v is not None and v.passed is False]
    unknown = [
        n for n, v in zip(ARTIFACT_CHECKS, checks, strict=True) if v is None or v.passed is None
    ]
    out.append(
        S.ReportingCriterion(
            id="artifact_checks",
            label="Passes every artifact check (flagged pixels, shape, edge, static source, flux)",
            passed=False if failed else (None if unknown else True),
            value=f"{len(ARTIFACT_CHECKS) - len(failed) - len(unknown)} of {len(ARTIFACT_CHECKS)} passed",
            threshold=f"{len(ARTIFACT_CHECKS)} of {len(ARTIFACT_CHECKS)}",
            source="pipeline",
        )
    )
    out.append(
        S.ReportingCriterion(
            id="orbit_fit",
            label="An orbit around the Sun fits every detection",
            passed=orbit_status != S.OrbitStatus.none
            and orbit_rms_arcsec is not None
            and orbit_rms_arcsec <= MAX_ORBIT_RMS_ARCSEC,
            value=None if orbit_rms_arcsec is None else round(orbit_rms_arcsec, 3),
            threshold=MAX_ORBIT_RMS_ARCSEC,
            source="pipeline",
        )
    )
    return out


def jpl_criteria(k: S.KnownObject) -> list[S.ReportingCriterion]:
    """The three JPL tests for a catalog check (unevaluated while none has run)."""
    checked = k.checked and k.enrichment != "pending"
    q, a = k.visits_queried, k.visits_answered
    every = None if not checked or q is None or a is None else (q > 0 and a == q)
    nearest = k.nearest.separation_arcsec if k.nearest else None
    return [
        S.ReportingCriterion(
            id="jpl_every_visit",
            label="JPL answered for every visit searched",
            passed=every,
            value=f"{a} of {q} visits" if checked and q is not None and a is not None else None,
            threshold="all",
            source="jpl",
        ),
        S.ReportingCriterion(
            id="jpl_no_match",
            label="No known asteroid or comet at its position",
            passed=(not k.matched) if checked else None,
            value=k.matched if checked else None,
            threshold=False,
            source="jpl",
        ),
        S.ReportingCriterion(
            id="jpl_nothing_nearby",
            label=f"No known asteroid or comet within {NEARBY_KNOWN_ARCSEC:.0f}″",
            passed=None
            if not checked
            else (False if k.matched else nearest is None or nearest > NEARBY_KNOWN_ARCSEC),
            value=nearest if checked else None,
            threshold=NEARBY_KNOWN_ARCSEC,
            source="jpl",
        ),
    ]


def status_of(criteria: list[S.ReportingCriterion]) -> S.ReportingStatus:
    if any(x.passed is False for x in criteria):
        return S.ReportingStatus.not_ready
    if any(x.passed is None for x in criteria):
        return S.ReportingStatus.incomplete
    return S.ReportingStatus.ready


def summary_plain(status: S.ReportingStatus, criteria: list[S.ReportingCriterion]) -> str:
    if status == S.ReportingStatus.ready:
        return (
            "Passes every test, and JPL's catalog of known asteroids and comets has nothing at "
            "or near its position at any visit. It is a candidate for the team to review and "
            "report to the Minor Planet Center; it may still be a known object JPL's search "
            "missed."
        )
    if status == S.ReportingStatus.incomplete:
        missing = [x.label.lower() for x in criteria if x.passed is None]
        return "Passes every test measured so far. Not yet evaluated: " + "; ".join(missing) + "."
    failed = [x.label.lower() for x in criteria if x.passed is False]
    return "Fails: " + "; ".join(failed) + "."


def reporting_of(
    c: S.CandidateDetail, orbit_status: S.OrbitStatus, orbit_rms_arcsec: float | None
) -> S.Reporting | None:
    """The reporting block as published; None for injected candidates (never reported)."""
    if c.classification == S.Classification.injected:
        return None
    pipe = pipeline_criteria(c, orbit_status, orbit_rms_arcsec)
    criteria = pipe + jpl_criteria(c.known_object)
    status = status_of(criteria)
    return S.Reporting(
        status=status,
        label_plain=LABELS[status],
        summary_plain=summary_plain(status, criteria),
        measurements_passed=all(x.passed is True for x in pipe),
        criteria=criteria,
    )
