"""Injection-recovery study: how faint and how slow an object the pipeline actually recovers.

For each run, synthetic moving sources are injected into the real SPHEREx cutouts of one field
(science/inject.py), and the unmodified detection and linking code runs blind. A source counts
as recovered when one linked track (3 or more visits) has detections within RECOVERY_RADIUS_PX
of its true position in at least 3 separate visits. Tracks that match neither an injection nor a
real mover found by the normal build are false positives.

Outputs data/injection/{study_id}.json (InjectionStudy) with recovery fractions and Wilson 95%
intervals per (magnitude, motion) cell, the 50% completeness magnitude per rate and per distance,
per-field results, and the false-positive rate with a Poisson 95% interval.
"""

from __future__ import annotations

import logging
import math
import multiprocessing as mp
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy import stats

from . import schemas as S
from .build import DETECT, LINK, FieldBuilder, FieldSpec, load_showcase, utc_now, write_json
from .science.detect import Prepared, detect
from .science.grid import angular_sep_arcsec
from .science.inject import (
    ab_to_ujy,
    inject,
    linear_track,
    noise_slope,
    observer_au,
    parallax_track,
    track_rate,
)
from .science.link import EpochData, assign_clusters, build_sightings, find_transients, link_tracks
from .version import build_run_id, pipeline_version

log = logging.getLogger(__name__)

RECOVERY_RADIUS_PX = 2.0
MIN_RECOVERED_VISITS = 3
INJECTIONS_PER_RUN = 12
MIN_SEPARATION_ARCSEC = 150.0
EDGE_MARGIN_FRAC = 0.1

MAG_BINS = [15.0, 16.0, 17.0, 17.5, 18.0, 18.5, 19.0, 19.5, 20.0]
LINEAR_RATES = [0.3, 1.0, 3.0, 10.0, 30.0, 100.0]
DISTANCES_AU = [2.0, 5.0, 30.0, 100.0, 300.0, 500.0, 1000.0]


@dataclass
class FieldData:
    spec: FieldSpec
    epochs: list[EpochData]
    slopes: list[float]
    obs: list[np.ndarray]  # SPHEREx barycentric position per epoch, AU
    real_tracks: list[list[tuple[float, float]]]  # (ra, dec) of the movers the normal build found
    grid_center: tuple[float, float]
    size_deg: float


@dataclass
class Trial:
    field_id: str
    run: int
    injection_id: str
    mag_ab: float
    model: str
    rate_arcsec_per_hr: float
    position_angle_deg: float | None
    distance_au: float | None
    n_visits_on_image: int
    recovered: bool
    detected_visits: int
    recovered_rate: float | None = None
    position_error_arcsec: float | None = None


@dataclass
class RunResult:
    trials: list[Trial] = field(default_factory=list)
    false_positive_tracks: int = 0
    seconds: float = 0.0


_FIELDS: dict[str, FieldData] = {}


def load_field(spec: FieldSpec) -> FieldData:
    b = FieldBuilder(spec)
    epochs = b.load(b.exposures())
    data = [e.data for e in epochs]
    assign_clusters(data)
    # The movers the normal pipeline finds in the unmodified images (real asteroids).
    tracks = link_tracks(data, find_transients(data, build_sightings(data, LINK), LINK), LINK)
    real = [
        [(float(data[i].det.ra[j]), float(data[i].det.dec[j])) for i, j in t.members]
        for t in tracks
    ]
    return FieldData(
        spec=spec,
        epochs=data,
        slopes=[noise_slope(e.prep) for e in data],
        obs=[observer_au(e.mjd, e.sc_km) for e in data],
        real_tracks=real,
        grid_center=(spec.ra_deg, spec.dec_deg),
        size_deg=spec.size_deg,
    )


def _copy_prep(p: Prepared) -> Prepared:
    return Prepared(
        cutout=p.cutout,
        sci=p.sci.copy(),
        sigma=p.sigma.copy(),
        bad=p.bad,
        soft=p.soft,
        ujy_per_mjysr=p.ujy_per_mjysr,
        aperture_correction=p.aperture_correction,
        pixel_scale_arcsec=p.pixel_scale_arcsec,
        psf_fwhm_arcsec=p.psf_fwhm_arcsec,
    )


def _place(rng: np.random.Generator, f: FieldData, n: int) -> list[tuple[float, float]]:
    from .science.grid import tangent_to_world

    half = f.size_deg * 3600 / 2 * (1 - 2 * EDGE_MARGIN_FRAC)
    out: list[tuple[float, float]] = []
    tries = 0
    while len(out) < n and tries < 1000:
        tries += 1
        xi, eta = rng.uniform(-half, half, 2)
        ra, dec = tangent_to_world([xi], [eta], *f.grid_center)
        p = (float(ra[0]), float(dec[0]))
        if all(angular_sep_arcsec(p[0], p[1], q[0], q[1]) >= MIN_SEPARATION_ARCSEC for q in out):
            out.append(p)
    return out


def run_once(
    field_id: str, run: int, cells: list[tuple[float, str, float]], seed: int
) -> RunResult:
    """Inject one source per cell entry (mag, model, rate-or-distance), detect, link, score."""
    t0 = time.time()
    f = _FIELDS[field_id]
    rng = np.random.default_rng(seed)
    mjds = [e.mjd for e in f.epochs]
    t_mid = float(np.median(mjds))
    i_mid = int(np.argmin(np.abs(np.array(mjds) - t_mid)))
    starts = _place(rng, f, len(cells))
    preps = [_copy_prep(e.prep) for e in f.epochs]
    truths = []
    for k, ((mag, model, param), (ra0, dec0)) in enumerate(zip(cells, starts, strict=False)):
        if model == "linear":
            pa = float(rng.uniform(0, 360))
            pos = linear_track(ra0, dec0, t_mid, param, pa, mjds)
            rate, dist = param, None
        else:
            pa = None
            pos = parallax_track(
                ra0, dec0, t_mid, param, f.obs[i_mid], list(zip(mjds, f.obs, strict=True))
            )
            rate, dist = track_rate(mjds, pos), param
        flux = ab_to_ujy(mag)
        on = {
            i
            for i, (p, (ra, dec)) in enumerate(zip(preps, pos, strict=True))
            if inject(p, ra, dec, flux, f.slopes[i], rng)
        }
        visits = {f.epochs[i].cluster for i in on}
        truths.append((f"{field_id}-r{run:04d}-i{k:02d}", mag, model, rate, pa, dist, pos, visits))

    data = [
        EpochData(e.epoch_id, e.mjd, p, detect(p, DETECT), e.sc_km, e.cluster)
        for e, p in zip(f.epochs, preps, strict=True)
    ]
    tracks = link_tracks(data, find_transients(data, build_sightings(data, LINK), LINK), LINK)
    tracks = [t for t in tracks if t.kind == "track"]
    radius = RECOVERY_RADIUS_PX * float(np.median([e.prep.pixel_scale_arcsec for e in f.epochs]))

    def visits_matched(track, pos) -> tuple[int, list[float]]:
        hit, seps = set(), []
        for i, j in track.members:
            ra, dec = pos[i]
            s = float(angular_sep_arcsec(data[i].det.ra[j], data[i].det.dec[j], ra, dec))
            if s <= radius:
                hit.add(data[i].cluster)
                seps.append(s)
        return len(hit), seps

    used = set()
    out = RunResult()
    for iid, mag, model, rate, pa, dist, pos, visits in truths:
        best, best_n, best_seps = None, 0, []
        for ti, t in enumerate(tracks):
            n, seps = visits_matched(t, pos)
            if n > best_n:
                best, best_n, best_seps = ti, n, seps
        # detections of the injected source in any exposure (diagnostic)
        detected = set()
        for i, d in enumerate(data):
            if len(d.det) == 0:
                continue
            ra, dec = pos[i]
            if np.min(angular_sep_arcsec(d.det.ra, d.det.dec, ra, dec)) <= radius:
                detected.add(d.cluster)
        recovered = best is not None and best_n >= MIN_RECOVERED_VISITS
        if best is not None and best_n >= 2:
            used.add(best)
        out.trials.append(
            Trial(
                field_id=field_id,
                run=run,
                injection_id=iid,
                mag_ab=mag,
                model=model,
                rate_arcsec_per_hr=round(rate, 4),
                position_angle_deg=pa,
                distance_au=dist,
                n_visits_on_image=len(visits),
                recovered=recovered,
                detected_visits=len(detected),
                recovered_rate=(
                    tracks[best].fit.rate_arcsec_per_hr if recovered and tracks[best].fit else None
                ),
                position_error_arcsec=(float(np.median(best_seps)) if recovered else None),
            )
        )
    # false positives: tracks matching no injection and no real mover
    for ti, t in enumerate(tracks):
        if ti in used:
            continue
        real = False
        for rt in f.real_tracks:
            ras = np.array([p[0] for p in rt])
            decs = np.array([p[1] for p in rt])
            for i, j in t.members:
                if (
                    np.min(angular_sep_arcsec(data[i].det.ra[j], data[i].det.dec[j], ras, decs))
                    <= 30
                ):
                    real = True
                    break
            if real:
                break
        if not real:
            out.false_positive_tracks += 1
    out.seconds = time.time() - t0
    return out


def _worker(args):
    return run_once(*args)


def wilson(k: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return max(0.0, c - h), min(1.0, c + h)


def poisson_ci(k: int, conf: float = 0.95) -> tuple[float, float]:
    a = 1 - conf
    lo = 0.0 if k == 0 else stats.chi2.ppf(a / 2, 2 * k) / 2
    hi = stats.chi2.ppf(1 - a / 2, 2 * (k + 1)) / 2
    return float(lo), float(hi)


def m50(mags: list[float], fracs: list[float]) -> float | None:
    """Magnitude where recovery crosses 50%, by linear interpolation in magnitude.

    None when the fraction never starts above and ends below 50% within the grid."""
    pts = sorted(zip(mags, fracs, strict=True))
    for (m1, f1), (m2, f2) in zip(pts, pts[1:], strict=False):
        if f1 >= 0.5 > f2:
            return round(m1 + (f1 - 0.5) / (f1 - f2) * (m2 - m1), 2)
    return None


# Planet brightness context (build plan section 5). Reflected sunlight only, so these are
# predictions from stated assumptions, never observations.
PLANET = S.PlanetAssumptions(
    name="Neptune-sized planet",
    diameter_km=49_528.0,
    geometric_albedo=0.41,
    band_um=1.25,
    phase_function="None: at 30 AU or more the phase angle is under 2 degrees",
    thermal_model=(
        "Reflected sunlight only, grey reflectance with solar colours (V_AB - J_AB = 0.27). "
        "Methane absorption in a Neptune-like atmosphere would make it fainter at most SPHEREx "
        "wavelengths, so these predictions are optimistic; internal heat is not included."
    ),
    reference=(
        "Neptune diameter and visible geometric albedo: NASA Neptune Fact Sheet. "
        "H from D = 1329 km / sqrt(p) * 10^(-H/5); solar AB colours: Willmer 2018, ApJS 236, 47."
    ),
)
PLANET_DISTANCES_AU = [30.0, 100.0, 300.0, 500.0, 700.0, 1000.0]
SOLAR_V_MINUS_J_AB = 0.27


def planet_mag_ab(distance_au: float, a: S.PlanetAssumptions = PLANET) -> float:
    """Predicted AB magnitude at opposition (observer 1 AU closer to the planet than the Sun)."""
    h = 5 * math.log10(1329.0 / (math.sqrt(a.geometric_albedo) * a.diameter_km))
    v = h + 5 * math.log10(distance_au * (distance_au - 1.0))
    return v - SOLAR_V_MINUS_J_AB


def fraction_at(mags: list[float], fracs: list[float], mag: float) -> float | None:
    """Recovery fraction interpolated at mag; outside the grid only where the answer is implied
    (brighter than a bin already >= 50%, or fainter than a bin already < 50%), else None."""
    pts = sorted(zip(mags, fracs, strict=True))
    if not pts:
        return None
    if mag < pts[0][0]:
        return pts[0][1] if pts[0][1] >= 0.5 else None
    if mag > pts[-1][0]:
        return pts[-1][1] if pts[-1][1] < 0.5 else None
    return float(np.interp(mag, [p[0] for p in pts], [p[1] for p in pts]))


def planet_context(grid: list[S.RecoveryCell]) -> S.PlanetContext:
    rows = []
    for d in PLANET_DISTANCES_AU:
        cells = [c for c in grid if c.motion == "parallax" and c.distance_au == d]
        pred = planet_mag_ab(d)
        mags, fracs = [c.mag_ab for c in cells], [c.fraction for c in cells]
        f = fraction_at(mags, fracs, pred) if cells else None
        rows.append(
            S.PlanetContextRow(
                distance_au=d,
                predicted_mag_ab=round(pred, 2),
                band_um=PLANET.band_um,
                m50_ab=m50(mags, fracs) if cells else None,
                recovery_fraction_at_predicted=None if f is None else round(f, 3),
                verdict="not_tested" if f is None else ("detected" if f >= 0.5 else "missed"),
            )
        )
    return S.PlanetContext(assumptions=PLANET, rows=rows)


def run_study(
    study_id: str,
    field_ids: list[str] | None = None,
    trials_per_cell: int = 200,
    seed: int = 20261030,
    workers: int = 4,
    out_dir: Path | None = None,
) -> S.InjectionStudy:
    from .build import DEFAULT_OUT

    out_dir = out_dir or DEFAULT_OUT
    specs = [s for s in load_showcase() if field_ids is None or s.field_id in field_ids]
    for spec in specs:
        log.info("loading %s", spec.field_id)
        _FIELDS[spec.field_id] = load_field(spec)
    cells = [(m, "linear", r) for m in MAG_BINS for r in LINEAR_RATES] + [
        (m, "parallax", d) for m in MAG_BINS for d in DISTANCES_AU
    ]
    # Spread every cell evenly over fields and runs.
    rng = np.random.default_rng(seed)
    pool_cells = [c for c in cells for _ in range(trials_per_cell)]
    rng.shuffle(pool_cells)
    jobs = []
    for run, start in enumerate(range(0, len(pool_cells), INJECTIONS_PER_RUN)):
        fid = specs[run % len(specs)].field_id
        jobs.append((fid, run, pool_cells[start : start + INJECTIONS_PER_RUN], seed + run))
    log.info("%d injections in %d runs over %d fields", len(pool_cells), len(jobs), len(specs))
    results: list[RunResult] = []
    t0 = time.time()
    ctx = mp.get_context("fork")
    with ctx.Pool(workers) as pool:
        for k, r in enumerate(pool.imap_unordered(_worker, jobs, chunksize=1), 1):
            results.append(r)
            if k % 20 == 0 or k == len(jobs):
                el = time.time() - t0
                log.info(
                    "%d/%d runs, %.0f s elapsed, ~%.0f s left",
                    k,
                    len(jobs),
                    el,
                    el / k * (len(jobs) - k),
                )
    checks = photometry_check(_FIELDS[specs[-1].field_id])
    return summarize(study_id, specs, results, out_dir, checks)


def photometry_check(
    f: FieldData, mags: tuple[float, ...] = (16.0, 17.0, 18.0), per_mag: int = 200, seed: int = 1
) -> list[S.PhotometryCheck]:
    """Inject single sources at random positions and measure them back (flux closure test)."""
    from .science.detect import measure

    rng = np.random.default_rng(seed)
    out = []
    for mag in mags:
        ratios = []
        while len(ratios) < per_mag:
            i = int(rng.integers(len(f.epochs)))
            e = f.epochs[i]
            p = _copy_prep(e.prep)
            ny, nx = p.sci.shape
            x, y = rng.uniform(20, nx - 20), rng.uniform(20, ny - 20)
            if p.bad[int(y), int(x)]:
                continue
            ra, dec = p.cutout.wcs.all_pix2world([x], [y], 0)
            before = measure(p, np.array([x]), np.array([y])).flux_ujy[0]
            if not inject(p, float(ra[0]), float(dec[0]), ab_to_ujy(mag), f.slopes[i], rng):
                continue
            after = measure(p, np.array([x]), np.array([y])).flux_ujy[0]
            ratios.append((after - before) / ab_to_ujy(mag))
        q25, q50, q75 = np.percentile(ratios, [25, 50, 75])
        out.append(
            S.PhotometryCheck(
                mag_ab=mag,
                n=len(ratios),
                measured_over_injected_median=round(float(q50), 4),
                measured_over_injected_p25=round(float(q25), 4),
                measured_over_injected_p75=round(float(q75), 4),
            )
        )
    return out


def summarize(
    study_id: str,
    specs: list[FieldSpec],
    results: list[RunResult],
    out_dir: Path,
    checks: list[S.PhotometryCheck] | None = None,
) -> S.InjectionStudy:
    trials = [t for r in results for t in r.trials]
    grid = []
    for mag in MAG_BINS:
        for model, params in (("linear", LINEAR_RATES), ("parallax", DISTANCES_AU)):
            for p in params:
                sel = [
                    t
                    for t in trials
                    if t.mag_ab == mag
                    and t.model == model
                    and (t.distance_au == p if model == "parallax" else t.rate_arcsec_per_hr == p)
                ]
                k, n = sum(t.recovered for t in sel), len(sel)
                lo, hi = wilson(k, n)
                rate = (
                    p
                    if model == "linear"
                    else float(np.median([t.rate_arcsec_per_hr for t in sel]))
                    if sel
                    else 0.0
                )
                grid.append(
                    S.RecoveryCell(
                        mag_ab=mag,
                        rate_arcsec_per_hr=round(rate, 3),
                        motion=S.MotionModel(model),
                        distance_au=p if model == "parallax" else None,
                        n_injected=n,
                        n_recovered=k,
                        fraction=round(k / n, 4) if n else 0.0,
                        ci_low=round(lo, 4),
                        ci_high=round(hi, 4),
                    )
                )
    by_rate = []
    for r in LINEAR_RATES:
        cells = [c for c in grid if c.motion == "linear" and c.rate_arcsec_per_hr == r]
        by_rate.append(
            S.M50(
                rate_arcsec_per_hr=r,
                m50_ab=m50([c.mag_ab for c in cells], [c.fraction for c in cells]),
            )
        )
    by_dist = []
    for d in DISTANCES_AU:
        cells = [c for c in grid if c.motion == "parallax" and c.distance_au == d]
        rate = float(np.median([c.rate_arcsec_per_hr for c in cells])) if cells else 0.0
        by_dist.append(
            S.M50ByDistance(
                distance_au=d,
                median_rate_arcsec_per_hr=round(rate, 3),
                m50_ab=m50([c.mag_ab for c in cells], [c.fraction for c in cells]),
                n_injected=sum(c.n_injected for c in cells),
            )
        )
    per_field = []
    for spec in specs:
        ft = [
            t
            for t in trials
            if t.field_id == spec.field_id
            and t.model == "linear"
            and 3 <= t.rate_arcsec_per_hr <= 100
        ]
        mags = sorted({t.mag_ab for t in ft})
        fr = [np.mean([t.recovered for t in ft if t.mag_ab == m]) for m in mags]
        per_field.append(
            S.FieldRecovery(
                field_id=spec.field_id,
                n_injected=sum(t.field_id == spec.field_id for t in trials),
                n_recovered=sum(t.recovered for t in trials if t.field_id == spec.field_id),
                m50_ab=m50(mags, [float(x) for x in fr]),
            )
        )
    n_runs = len(results)
    fp = sum(r.false_positive_tracks for r in results)
    area = sum(s.size_deg**2 for s in specs) / len(specs) * n_runs if specs else 0.0
    lo, hi = poisson_ci(fp)
    rec = [t for t in trials if t.recovered and t.model == "linear" and t.recovered_rate]
    rate_err = (
        float(
            np.median(
                [abs(t.recovered_rate - t.rate_arcsec_per_hr) / t.rate_arcsec_per_hr for t in rec]
            )
        )
        if rec
        else None
    )
    pos_err = (
        float(np.median([t.position_error_arcsec for t in trials if t.recovered]))
        if any(t.recovered for t in trials)
        else None
    )
    study = S.InjectionStudy(
        pipeline_version=pipeline_version(require_clean=True),
        study_id=study_id,
        generated_utc=utc_now(),
        field_ids=[s.field_id for s in specs],
        n_injected=len(trials),
        n_recovered=sum(t.recovered for t in trials),
        mag_bins_ab=MAG_BINS,
        rate_bins_arcsec_per_hr=LINEAR_RATES,
        distance_bins_au=DISTANCES_AU,
        grid=grid,
        m50_by_rate=by_rate,
        m50_by_distance=by_dist,
        per_field=per_field,
        false_positives=S.FalsePositives(
            n_control_runs=n_runs,
            area_deg2=round(area, 3),
            n_candidates=fp,
            rate_per_deg2=round(fp / area, 4) if area else 0.0,
            ci_low_per_deg2=round(lo / area, 4) if area else 0.0,
            ci_high_per_deg2=round(hi / area, 4) if area else 0.0,
        ),
        recovered_rate_error_median=None if rate_err is None else round(rate_err, 4),
        recovered_position_error_arcsec_median=None if pos_err is None else round(pos_err, 3),
        photometry_check=checks or [],
        planet_context=planet_context(grid),
        recovery_criteria=(
            f"Recovered: one linked track (3 or more visits) has detections within {RECOVERY_RADIUS_PX:g} px "
            f"(about {RECOVERY_RADIUS_PX * 6.15:.0f} arcsec) of the injected position in at least "
            f"{MIN_RECOVERED_VISITS} separate visits. False positive: a linked track that matches no injection "
            "and no real mover found in the unmodified images."
        ),
        method_notes=[
            "Synthetic sources are added to the real SPHEREx Level 2 cutouts of each field after zodiacal-light "
            "and background subtraction, using each exposure's own PSF (PSF extension, nearest of 121 zones, 10x "
            "oversampled, integrated over native pixels).",
            "Flux is flat in F_nu (the same AB magnitude at every wavelength SPHEREx samples).",
            "Photon noise from the source is added with the variance-versus-signal slope measured from each "
            "exposure's own IMAGE and VARIANCE extensions.",
            "Linear tracks move at a fixed rate in a random direction. Distance tracks are bodies at a fixed "
            "heliocentric distance on circular prograde orbits in the ecliptic, seen from SPHEREx's real position "
            "(Earth from astropy's built-in ephemeris plus the spacecraft position in each FITS header).",
            f"{INJECTIONS_PER_RUN} sources per run, at least {MIN_SEPARATION_ARCSEC:g} arcsec apart at mid-visit, "
            "placed uniformly over the central 80% of the field; they can cross stars and leave the image.",
            "Detection and linking are the unmodified pipeline (detection threshold "
            f"{DETECT.threshold_snr:g} sigma, at least {LINK.min_track_clusters} visits per track, linking rates "
            f"{LINK.min_rate_arcsec_per_hr:g}-{LINK.max_rate_arcsec_per_hr:g} arcsec/hr).",
            "Intervals are Wilson 95% for fractions and Poisson 95% for the false-positive count.",
        ],
        example_candidate_ids=[],
    )
    write_json(out_dir / "injection" / f"{study_id}.json", study)
    write_json(
        out_dir / "injection" / "index.json",
        S.InjectionStudyIndex(
            pipeline_version=study.pipeline_version,
            build_run_id=build_run_id(),
            studies=[
                S.InjectionStudyRef(
                    study_id=study_id,
                    generated_utc=study.generated_utc,
                    field_ids=study.field_ids,
                    n_injected=study.n_injected,
                )
            ],
        ),
    )
    return study


EXAMPLES = [
    (16.0, "linear", 20.0),
    (16.5, "parallax", 5.0),
    (17.0, "linear", 10.0),
]


def build_examples(
    study_id: str, field_id: str, out_dir: Path | None = None, seed: int = 4242
) -> list[str]:
    """Example SIMULATED candidates: injected movers the unmodified pipeline recovered.

    The sources are injected into the field's real cutouts exactly as in the study, the
    pipeline runs blind, and each recovered track is written as a normal candidate report
    (stamps included), classified `injected` with the injection truth attached.
    """
    from .build import DEFAULT_OUT, Epoch
    from .data.l2file import Cutout  # noqa: F401  (kept for type clarity)

    out_dir = out_dir or DEFAULT_OUT
    spec = next(s for s in load_showcase() if s.field_id == field_id)
    builder = FieldBuilder(spec, out_dir)
    epochs = builder.load(builder.exposures())
    data0 = [e.data for e in epochs]
    assign_clusters(data0)
    field_json = S.FieldDetail.model_validate_json(
        (out_dir / "fields" / f"{field_id}.json").read_text()
    )
    stretch = field_json.stretch
    rng = np.random.default_rng(seed)
    slopes = [noise_slope(d.prep) for d in data0]
    obs = [observer_au(d.mjd, d.sc_km) for d in data0]
    mjds = [d.mjd for d in data0]
    t_mid = float(np.median(mjds))
    i_mid = int(np.argmin(np.abs(np.array(mjds) - t_mid)))
    fd = FieldData(spec, data0, slopes, obs, [], (spec.ra_deg, spec.dec_deg), spec.size_deg)
    starts = _place(rng, fd, len(EXAMPLES))
    preps = [_copy_prep(d.prep) for d in data0]
    truths = []
    for (mag, model, param), (ra0, dec0) in zip(EXAMPLES, starts, strict=False):
        if model == "linear":
            pa = float(rng.uniform(0, 360))
            pos = linear_track(ra0, dec0, t_mid, param, pa, mjds)
            rate, dist = param, None
        else:
            pa = None
            pos = parallax_track(
                ra0, dec0, t_mid, param, obs[i_mid], list(zip(mjds, obs, strict=True))
            )
            rate, dist = track_rate(mjds, pos), param
        for i, (ra, dec) in enumerate(pos):
            inject(preps[i], ra, dec, ab_to_ujy(mag), slopes[i], rng)
        truths.append((mag, model, rate, pa, dist, pos))
    inj_epochs = []
    for e, p in zip(epochs, preps, strict=True):
        d = EpochData(
            e.data.epoch_id, e.data.mjd, p, detect(p, DETECT), e.data.sc_km, e.data.cluster
        )
        inj_epochs.append(Epoch(e.key, d, e.epoch_id))
    data = [e.data for e in inj_epochs]
    tracks = [
        t
        for t in link_tracks(data, find_transients(data, build_sightings(data, LINK), LINK), LINK)
        if t.kind == "track"
    ]
    radius = RECOVERY_RADIUS_PX * 6.15
    written = []
    for n, (mag, model, rate, pa, dist, pos) in enumerate(truths, 1):
        best, best_hits = None, 0
        for t in tracks:
            hits = {
                data[i].cluster
                for i, j in t.members
                if angular_sep_arcsec(data[i].det.ra[j], data[i].det.dec[j], *pos[i]) <= radius
            }
            if len(hits) > best_hits:
                best, best_hits = t, len(hits)
        if best is None or best_hits < MIN_RECOVERED_VISITS:
            log.warning("example %d (%s mag %.1f) was not recovered; skipping", n, model, mag)
            continue
        cid = f"{field_id}-sim{n:02d}"
        cand = builder._candidate(cid, best, inj_epochs, stretch)
        seps = [
            float(angular_sep_arcsec(data[i].det.ra[j], data[i].det.dec[j], *pos[i]))
            for i, j in best.members
        ]
        cand = cand.model_copy(
            update={
                "classification": S.Classification.injected,
                "label_plain": "SIMULATED",
                "summary_plain": "A simulated moving object inserted into real SPHEREx images to test the "
                "pipeline. The pipeline found it without being told where it was.",
                "known_object": cand.known_object.model_copy(
                    update={"not_checked_reason": "Simulated object: never sent to JPL."}
                ),
                "injection": S.InjectionInfo(
                    study_id=study_id,
                    injection_id=cid,
                    injected=S.InjectedTruth(
                        mag_ab=mag,
                        flux_ujy=round(ab_to_ujy(mag), 2),
                        model=S.MotionModel(model),
                        rate_arcsec_per_hr=round(rate, 3),
                        position_angle_deg=None if pa is None else round(pa, 2),
                        distance_au=dist,
                    ),
                    recovered=True,
                    recovered_rate_arcsec_per_hr=cand.motion.rate_arcsec_per_hr,
                    position_error_arcsec=round(float(np.median(seps)), 3),
                ),
            }
        )
        write_json(out_dir / "candidates" / f"{cid}.json", cand)
        written.append(cid)
    return written
