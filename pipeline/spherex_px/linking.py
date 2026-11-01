"""Link tracklets across survey tiles into objects.

The survey cuts the sky into 0.3 degree tiles and builds each on its own, so one asteroid is
found more than once: survey tiles share exposures, so a track near a tile edge is detected
in both tiles from the same images, and an asteroid moving tens of arcseconds an hour
crosses into the next tile within a day. Linking puts those tracklets back together.

Two tracklets are linked when either

- they share detections (the same exposure time and the same position within
  SHARED_SEP_ARCSEC), which only one body can produce; or
- one tracklet's orbit clones (orbits.py) predict the other: the other's mean position lies
  within MAX_MAHALANOBIS of the clone cloud at its times;

and, in both cases, a single orbit fitted to all their detections fits them within the
astrometric errors (JOINT_RMS_MAX_ARCSEC, JOINT_CHI2_MAX). The joint fit is what rejects
coincidences. Linked groups become one object with every detection, a joint orbit over the
longer arc and a list of the links and how they were made.

This plays the role of HelioLinC in the build plan (linking without a known orbit) with the
information we have: every tracklet already carries an orbit cloud, so testing whether one
predicts another is direct, and the joint fit verifies each link.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass

import numpy as np

from . import schemas as S
from .science import orbit as O

log = logging.getLogger(__name__)

SHARED_SEP_ARCSEC = 2.0
SHARED_DT_SECONDS = 5.0
#: Tracklets further apart in time than this are not compared (prediction becomes useless).
MAX_GAP_DAYS = 10.0
#: Fastest motion considered when pruning pairs by sky distance, degrees per day.
MAX_RATE_DEG_PER_DAY = 2.0
MAX_MAHALANOBIS = 4.0
JOINT_RMS_MAX_ARCSEC = 1.5
JOINT_CHI2_MAX = 4.0  # reduced chi-square of the joint fit, quoted errors (floor included)
#: Orbit links need this many visits in each tracklet. A tracklet seen in one visit (minutes)
#: fixes only a position and a rate, and the validation showed a parallel object 30-120"
#: away then fits as well as the real continuation; such tracklets link only by shared
#: detections.
MIN_VISITS_FOR_ORBIT_LINK = 2
VISIT_GAP_HOURS = 0.5


def n_visits(dets: list[S.Detection]) -> int:
    t = sorted(d.mjd for d in dets)
    return (
        1 + sum(1 for a, b in zip(t, t[1:], strict=False) if (b - a) * 24 > VISIT_GAP_HOURS)
        if t
        else 0
    )


@dataclass
class Link:
    a: str
    b: str
    method: str  # shared_detections | orbit
    joint_rms_arcsec: float | None = None


def _sep_arcsec(ra1, dec1, ra2, dec2):
    return O.ARCSEC**-1 * np.arccos(
        np.clip(
            np.sum(O.unit_vector(ra1, dec1) * O.unit_vector(ra2, dec2), axis=-1),
            -1.0,
            1.0,
        )
    )


def same_detection(d: S.Detection, e: S.Detection) -> bool:
    """The same source in the same exposure. One SPHEREx observation (obs_id) exposes several
    detectors at once, each at its own wavelength, so equal times or obs_ids are not enough:
    the detector's spectral channel (band_index) must match too."""
    return (
        d.obs_id == e.obs_id
        and d.band_index == e.band_index
        and abs(d.mjd - e.mjd) * 86400 < SHARED_DT_SECONDS
        and float(_sep_arcsec(d.ra_deg, d.dec_deg, e.ra_deg, e.dec_deg)) < SHARED_SEP_ARCSEC
    )


def merged_detections(groups: list[list[S.Detection]]) -> list[S.Detection]:
    """All detections of several tracklets, time-ordered, each exposure's detection once."""
    out: list[S.Detection] = []
    for d in sorted((d for g in groups for d in g), key=lambda d: d.mjd):
        if not any(same_detection(d, e) for e in out[-16:]):
            out.append(d)
    return out


def shares_detections(a: list[S.Detection], b: list[S.Detection]) -> bool:
    return any(same_detection(d, e) for d in a for e in b)


def plausible_pair(a: list[S.Detection], b: list[S.Detection]) -> bool:
    """Cheap pruning: close enough in time and on the sky to be the same body."""
    a0, a1, b0, b1 = a[0].mjd, a[-1].mjd, b[0].mjd, b[-1].mjd
    gap = max(0.0, max(a0, b0) - min(a1, b1))
    if gap > MAX_GAP_DAYS:
        return False
    ends = [(a[-1], b[0]), (b[-1], a[0]), (a[0], b[0])]
    sep = min(float(_sep_arcsec(x.ra_deg, x.dec_deg, y.ra_deg, y.dec_deg)) for x, y in ends)
    return sep / 3600 <= MAX_RATE_DEG_PER_DAY * max(gap, abs(b0 - a0)) + 0.5


def predicts(fit: O.OrbitFit, b: list[S.Detection]) -> float:
    """Mahalanobis distance of tracklet b's mean position from the clone cloud of `fit` at b's
    times, seen from b's observers. Small means the orbit could have produced b."""
    ob = O.Observations.from_detections(b)
    ra, dec, _ = O.predict_radec(
        fit.clones_r, fit.clones_v, np.full(len(fit.clones_r), fit.epoch_tdb), ob.mjd_tdb, ob.obs
    )
    cosd = math.cos(math.radians(float(np.mean(ob.dec_deg))))
    # offsets of each clone's mean track from b's mean track, arcsec
    dx = (((ra - ob.ra_deg + 180) % 360 - 180) * cosd).mean(axis=1) * 3600
    dy = (dec - ob.dec_deg).mean(axis=1) * 3600
    pts = np.stack([dx, dy], axis=1)
    mu = pts.mean(axis=0)
    cov = np.cov(pts.T) + np.eye(2) * float(np.mean(ob.sigma_arcsec)) ** 2
    d = mu @ np.linalg.solve(cov, mu)
    return float(math.sqrt(max(d, 0.0)))


def joint_fit(dets: list[S.Detection], seed: int = 0) -> O.OrbitFit | None:
    o = O.Observations.from_detections(dets)
    try:
        return O.fit_orbit(o, rng=np.random.default_rng(seed), n_samples=20_000)
    except (ValueError, np.linalg.LinAlgError, FloatingPointError):
        return None


def joint_ok(fit: O.OrbitFit | None) -> bool:
    if fit is None:
        return False
    dof = max(2 * fit.n_obs - 6, 1)
    return fit.rms_arcsec <= JOINT_RMS_MAX_ARCSEC and fit.chi2 / dof <= JOINT_CHI2_MAX


def link(
    cands: list[S.CandidateDetail], fits: dict[str, O.OrbitFit]
) -> tuple[list[list[str]], list[Link]]:
    """Group candidate ids that are the same body. Every group of two or more passed a joint
    orbit fit over all its detections; candidates without a link are groups of one."""
    ids = [c.candidate_id for c in cands]
    by_id = {c.candidate_id: c for c in cands}
    parent = {i: i for i in ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    links: list[Link] = []
    for i, a in enumerate(cands):
        for b in cands[i + 1 :]:
            da, db = a.detections, b.detections
            if find(a.candidate_id) == find(b.candidate_id) or not plausible_pair(da, db):
                continue
            method = None
            if shares_detections(da, db):
                method = "shared_detections"
            elif min(n_visits(da), n_visits(db)) >= MIN_VISITS_FOR_ORBIT_LINK:
                fa, fb = fits.get(a.candidate_id), fits.get(b.candidate_id)
                close = [predicts(f, other) for f, other in ((fa, db), (fb, da)) if f is not None]
                if close and min(close) <= MAX_MAHALANOBIS:
                    method = "orbit"
            if method is None:
                continue
            fit = joint_fit(merged_detections([da, db]))
            if not joint_ok(fit):
                log.info(
                    "%s + %s: %s candidate rejected by the joint fit",
                    a.candidate_id,
                    b.candidate_id,
                    method,
                )
                continue
            links.append(Link(a.candidate_id, b.candidate_id, method, round(fit.rms_arcsec, 3)))
            parent[find(b.candidate_id)] = find(a.candidate_id)
    groups: dict[str, list[str]] = {}
    for i in ids:
        groups.setdefault(find(i), []).append(i)
    out = []
    for members in groups.values():
        if len(members) > 2:
            # Pairwise links can chain; the whole group must still be one orbit.
            fit = joint_fit(merged_detections([by_id[m].detections for m in members]))
            if not joint_ok(fit):
                log.warning("group %s fails a joint fit; left unlinked", members)
                out.extend([m] for m in members)
                links = [lk for lk in links if lk.a not in members]
                continue
        out.append(members)
    return out, links


# ------------------------------------------------------------------------- validation

DECOY_OFFSETS_ARCSEC = (30.0, 120.0, 600.0, 3600.0)


def _split(dets: list[S.Detection]) -> tuple[list[S.Detection], list[S.Detection]] | None:
    """Split a track between visits into two tracklets of at least 3 detections, choosing the
    split that leaves the most visits on the smaller side (so both can carry an orbit)."""
    dets = sorted(dets, key=lambda d: d.mjd)
    cuts = [
        k for k in range(2, len(dets) - 3) if (dets[k + 1].mjd - dets[k].mjd) * 24 > VISIT_GAP_HOURS
    ]
    if not cuts:
        return None
    k = max(
        cuts,
        key=lambda k: (
            min(n_visits(dets[: k + 1]), n_visits(dets[k + 1 :])),
            dets[k + 1].mjd - dets[k].mjd,
        ),
    )
    return dets[: k + 1], dets[k + 1 :]


def _shifted(dets: list[S.Detection], offset_arcsec: float, pa_deg: float) -> list[S.Detection]:
    out = []
    for d in dets:
        dx = (
            offset_arcsec
            * math.sin(math.radians(pa_deg))
            / 3600
            / math.cos(math.radians(d.dec_deg))
        )
        dy = offset_arcsec * math.cos(math.radians(pa_deg)) / 3600
        out.append(
            d.model_copy(update={"ra_deg": (d.ra_deg + dx) % 360, "dec_deg": d.dec_deg + dy})
        )
    return out


def _would_link(fit_a: O.OrbitFit | None, a: list[S.Detection], b: list[S.Detection]) -> bool:
    if fit_a is None or not plausible_pair(a, b):
        return False
    if min(n_visits(a), n_visits(b)) < MIN_VISITS_FOR_ORBIT_LINK:
        return False
    if predicts(fit_a, b) > MAX_MAHALANOBIS:
        return False
    return joint_ok(joint_fit(merged_detections([a, b])))


def validate_linking(cands: list[S.CandidateDetail], seed: int = 20261031) -> dict:
    """Split real tracks and test whether the halves are rejoined (completeness), and whether
    copies of the second half shifted to look like a different object are wrongly joined
    (purity), with the same predict-then-joint-fit test the linker uses."""
    rng = np.random.default_rng(seed)
    rows = []
    for c in cands:
        if c.classification == S.Classification.injected or len(c.detections) < 8:
            continue
        halves = _split(c.detections)
        if halves is None:
            continue
        a, b = halves
        fa = O.fit_orbit(
            O.Observations.from_detections(a), rng=np.random.default_rng(seed), n_samples=20_000
        )
        row = {
            "candidate_id": c.candidate_id,
            "eligible": min(n_visits(a), n_visits(b)) >= MIN_VISITS_FOR_ORBIT_LINK,
            "n_a": len(a),
            "n_b": len(b),
            "gap_hours": round((b[0].mjd - a[-1].mjd) * 24, 2),
            "rejoined": _would_link(fa, a, b),
            "decoys_linked": {},
        }
        for off in DECOY_OFFSETS_ARCSEC:
            row["decoys_linked"][str(int(off))] = _would_link(
                fa, a, _shifted(b, off, float(rng.uniform(0, 360)))
            )
        log.info(
            "%s: rejoined %s, decoys %s", c.candidate_id, row["rejoined"], row["decoys_linked"]
        )
        rows.append(row)
    n = len(rows)
    elig = [r for r in rows if r["eligible"]]
    return {
        "n_tracks": n,
        "n_eligible": len(elig),
        "completeness": round(sum(r["rejoined"] for r in rows) / n, 3) if n else None,
        "completeness_eligible": round(sum(r["rejoined"] for r in elig) / len(elig), 3)
        if elig
        else None,
        "false_link_rate_by_offset_arcsec": {
            str(int(off)): round(sum(r["decoys_linked"][str(int(off))] for r in rows) / n, 3)
            if n
            else None
            for off in DECOY_OFFSETS_ARCSEC
        },
        "rows": rows,
    }


def run_validation(out_dir, seed: int = 20261031) -> S.LinkingValidation:
    """validate_linking on every published candidate; writes validation/linking.json."""
    from .build import utc_now, write_json
    from .version import pipeline_version

    cands = [
        S.CandidateDetail.model_validate_json(p.read_text())
        for p in sorted((out_dir / "candidates").glob("*.json"))
    ]
    r = validate_linking(cands, seed=seed)
    doc = S.LinkingValidation(
        pipeline_version=pipeline_version(require_clean=True),
        generated_utc=utc_now(),
        method=(
            "Every published track with 8 or more detections is split between visits into two "
            "tracklets; the linker's own test (orbit clones of the first predict the second, then "
            "one orbit fits both) must rejoin them. Copies of the second tracklet shifted by "
            "30-3600 arcsec in a random direction, i.e. a different object moving in parallel, "
            "must not be joined. Orbit links need at least 2 visits in each tracklet."
        ),
        **r,
    )
    write_json(out_dir / "validation" / "linking.json", doc)
    return doc
