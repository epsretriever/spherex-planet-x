"""What the survey has ruled out: completeness per searched patch, turned into limits on a
hypothetical distant planet (`spherex-px exclusion`, writes `survey/exclusion.json`).

Inputs, all published data:
- `survey.json`: every searched 0.3 deg patch (processed tiles plus `empty_cells`) and the
  per-tile 50% magnitude (`m50_ab`) where the injection study measured it;
- the newest injection study (`injection/<id>.json`): recovery of SIMULATED objects versus
  magnitude and sky rate, and the sky rate of objects at fixed distances in real SPHEREx geometry;
- `survey/planet_nine.json`: Brown & Batygin's (2021) open Planet Nine region, binned;
- optionally Brown & Batygin's `reference_population.csv` (CaltechDATA 8fjad-x7y61) for
  member-level numbers: distance, size, albedo and sky position of each synthetic Planet Nine.

Completeness of a patch the study did not measure is assumed equal to the study's pooled curve;
a patch it did measure shifts that curve by its own m50 minus the pooled m50. The page says so.

A planet's spectrum is not flat, but the study's SIMULATED objects are (same AB magnitude in
every SPHEREx channel). Two bounds connect them. A planet at least as bright as AB m in every
detector is at least as detectable as a flat source of magnitude m, so the completeness at its
faintest-detector magnitude is a lower bound ("conservative"). The completeness at its
brightest-detector magnitude is an upper bound ("optimistic").
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path

import numpy as np

from . import exclusion_schema as X
from .build import DETECT, LINK, utc_now, write_json
from .science.brightness import (
    NEPTUNE_DIAMETER_KM,
    Planet,
    band_mags,
    spherex_bands,
)
from .science.completeness import Grid, RateModel, log_grid, m50
from .version import build_run_id, pipeline_version

log = logging.getLogger(__name__)

OUT = Path("survey") / "exclusion.json"
PATCH_DEG = 0.3
SKY_DEG2 = 41252.96
EARTH_RADIUS_KM = 6371.0

REACH_DISTANCES_AU = [2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 200, 300, 500, 700, 1000]
SIZE_ALBEDOS = [0.05, 0.3, 0.75]
REFERENCE_PLANETS = [
    # (diameter_km, geometric albedo, T_int K, distance AU)
    (300.0, 0.05, 0.0, 2.0),
    (1000.0, 0.1, 0.0, 3.0),
    (2400.0, 0.6, 0.0, 10.0),
    (12742.0, 0.3, 0.0, 15.0),
    (NEPTUNE_DIAMETER_KM, 0.41, 0.0, 30.0),
    (NEPTUNE_DIAMETER_KM, 0.41, 59.0, 300.0),
    (3.7 * 2 * EARTH_RADIUS_KM, 0.75, 47.0, 700.0),
]

ASSUMPTIONS = [
    "Completeness comes from SIMULATED objects planted in real SPHEREx images of the injection "
    "study's tiles and found (or not) by the unmodified pipeline. Patches the study did not "
    "measure are assumed to behave like the pooled study; measured tiles shift the pooled curve "
    "by their own 50% magnitude.",
    "Sky rate versus distance is the median the study measured for SIMULATED objects on "
    "circular ecliptic orbits seen from SPHEREx's real position; real objects on inclined or "
    "eccentric orbits, or in other parts of the sky, move somewhat differently.",
    "Reflected light: geometric albedo p is the same at every SPHEREx wavelength (grey), phase "
    "function 1 (no darkening), Sun a 5772 K blackbody anchored at J. Methane absorption at "
    "1.7, 2.3 and 3.3 um in a real giant planet would make it fainter there.",
    "Thermal light: a blackbody at T = (T_eq^4 + T_int^4)^(1/4), emissivity 1, Bond albedo "
    "taken equal to p. Real cold giant atmospheres emit far more than a blackbody at 4-5 um "
    "(Fortney et al. 2016), so the thermal term is a lower bound.",
    "Viewing geometry: SPHEREx looks about 90 degrees from the Sun, so the planet is "
    "sqrt(r^2 - 1) AU from SPHEREx.",
    "A planet's spectrum is not flat. 'Conservative' completeness uses its faintest SPHEREx "
    "detector band (a lower bound), 'optimistic' its brightest (an upper bound).",
    "Brighter than the brightest SIMULATED magnitude (AB 15) we use the brightest bin's "
    "completeness only if it is already at least 50%; saturation of very bright objects was not "
    "studied.",
    "Planet Nine positions are for 2018-06-01 (the population file's epoch); the overlap with "
    "searched patches is a statistical estimate.",
]

REFERENCES = [
    "Brown & Batygin 2021, AJ 162, 219: The Orbit of Planet Nine (reference population, "
    "CaltechDATA 8fjad-x7y61)",
    "Fortney et al. 2016, ApJL 824, L25: The Hunt for Planet Nine: Atmosphere, Spectra, "
    "Evolution, and Detectability",
    "Linder & Mordasini 2016, A&A 589, A134: Evolution and magnitudes of candidate Planet Nine",
    "Pearl & Conrath 1991, JGR 96, 18921: Neptune's internal heat (59 K effective temperature)",
    "Bowell et al. 1989, in Asteroids II: the H, G magnitude system; D = 1329 km / sqrt(p) "
    "10^(-H/5) (Harris & Lagerros 2002, in Asteroids III)",
    "Willmer 2018, ApJS 236, 47: solar AB colours (V - J_AB = 0.27)",
    "Prsa et al. 2016, AJ 152, 41 (IAU 2015 Resolution B3): nominal solar radius and 5772 K",
    "Kopp & Lean 2011, GRL 38, L01706: total solar irradiance 1361 W m^-2",
    "SPHEREx spectral channels: IRSA calibration cal-sch-v1-2026-106",
]


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------


def newest_study(out_dir: Path) -> dict:
    index = json.loads((out_dir / "injection" / "index.json").read_text())
    sid = index["studies"][0]["study_id"]
    return json.loads((out_dir / "injection" / f"{sid}.json").read_text())


def grid_from_study(study: dict) -> Grid:
    cells = [_Cell(c) for c in study["grid"] if c["motion"] == "linear"]
    return Grid.from_cells(cells, LINK.min_rate_arcsec_per_hr)


class _Cell:
    def __init__(self, c: dict):
        self.mag_ab = float(c["mag_ab"])
        self.rate_arcsec_per_hr = float(c["rate_arcsec_per_hr"])
        self.fraction = float(c["fraction"])


def rate_model(study: dict) -> RateModel:
    rows = sorted(study["m50_by_distance"], key=lambda r: r["distance_au"])
    return RateModel(
        distances=tuple(float(r["distance_au"]) for r in rows),
        rates=tuple(float(r["median_rate_arcsec_per_hr"]) for r in rows),
    )


def pooled_m50(study: dict) -> float | None:
    """Same definition as each tile's m50: linear tracks at 3-100 arcsec/hr, pooled over rates."""
    sel = [
        c for c in study["grid"] if c["motion"] == "linear" and 3 <= c["rate_arcsec_per_hr"] <= 100
    ]
    mags = sorted({c["mag_ab"] for c in sel})
    fr = []
    for m in mags:
        k = sum(c["n_recovered"] for c in sel if c["mag_ab"] == m)
        n = sum(c["n_injected"] for c in sel if c["mag_ab"] == m)
        fr.append(k / n if n else 0.0)
    return m50(mags, fr)


def _ecliptic(ra: np.ndarray, dec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    import astropy.units as u
    from astropy.coordinates import BarycentricMeanEcliptic, SkyCoord

    e = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs").transform_to(
        BarycentricMeanEcliptic()
    )
    return e.lon.deg, e.lat.deg


def searched_patches(survey: dict) -> tuple[list[tuple[float, float]], list[dict]]:
    """Distinct searched patches [(ra, dec)] and the showcase tiles among them.

    Survey tiles of different weeks on the same 0.3 deg ecliptic grid point are one patch (the
    rule `survey.json` uses for `area_deg2_searched`); showcase fields count on their own."""
    pts: dict[tuple[int, int], tuple[float, float]] = {}
    showcase = []
    for t in survey["tiles"]:
        if t["status"] not in ("processed", "empty"):
            continue
        if not t["tile_id"].startswith("sv-"):
            showcase.append(t)
            continue
        key = (
            round(t["ecliptic_lon_deg"] / PATCH_DEG) % 1200,
            round(t["ecliptic_lat_deg"] / PATCH_DEG),
        )
        pts.setdefault(key, (t["center"]["ra_deg"], t["center"]["dec_deg"]))
    pos = (survey.get("empty_cells") or {}).get("positions") or []
    if pos:
        arr = np.array(pos, float)
        lon, lat = _ecliptic(arr[:, 0], arr[:, 1])
        for (ra, dec), lo, la in zip(pos, lon, lat, strict=True):
            key = (round(lo / PATCH_DEG) % 1200, round(la / PATCH_DEG))
            pts.setdefault(key, (float(ra), float(dec)))
    patches = list(pts.values()) + [
        (t["center"]["ra_deg"], t["center"]["dec_deg"]) for t in showcase
    ]
    return patches, showcase


# ---------------------------------------------------------------------------
# Science
# ---------------------------------------------------------------------------


def planet_completeness(
    grid: Grid, rates: RateModel, planet: Planet, distance_au: float, delta_mag: float = 0.0
) -> dict:
    """Band magnitudes, sky rate and conservative/optimistic completeness for one planet."""
    mags = band_mags(planet, distance_au)
    rate = rates.rate(distance_au)
    out = {"mags": mags, "rate": rate}
    if rate is None:
        out.update(cons=None, opt=None, reason="outside_distance_range")
        return out
    totals = [m.total_ab for m in mags]
    cons, why = grid.fraction(max(totals) - delta_mag, rate)
    opt, why_opt = grid.fraction(min(totals) - delta_mag, rate)
    out.update(cons=cons, opt=opt, reason=why if cons is None else why_opt if opt is None else why)
    return out


def required_flat_mag(grid: Grid, rate: float) -> float | None:
    """Faintest flat-spectrum magnitude still found at least half the time at this rate."""
    col, why = grid.column(rate)
    if col is None or why == "below_linker_minimum" or col[0] < 0.5:
        return None
    if col[-1] >= 0.5:
        return grid.mags[-1]
    return m50(list(grid.mags), col)


def min_diameter_km(
    grid: Grid, rates: RateModel, distance_au: float, albedo: float, t_int_k: float
) -> tuple[float | None, str]:
    """Smallest planet found at least half the time (conservative band rule). Total flux is
    proportional to diameter squared (reflected and thermal alike), so it scales exactly."""
    rate = rates.rate(distance_au)
    if rate is None:
        return None, "outside_distance_range"
    col, why = grid.column(rate)
    if col is None:
        return None, why
    if why == "below_linker_minimum":
        return None, why
    need = required_flat_mag(grid, rate)
    if need is None:
        return None, "measured"
    d0 = 1000.0
    faint = max(m.total_ab for m in band_mags(Planet(d0, albedo, t_int_k), distance_au))
    return d0 * 10 ** ((faint - need) / 5), "measured"


def reach(grid: Grid, rates: RateModel, study: dict) -> tuple[list[X.ReachRow], X.ReachSummary]:
    rows = []
    for d in REACH_DISTANCES_AU:
        rate = rates.rate(d)
        if rate is None:
            continue
        best, why = grid.best(rate)
        testable = "no" if not best else ("yes" if best >= 0.5 else "partial")
        rows.append(
            X.ReachRow(
                distance_au=float(d),
                rate_arcsec_per_hr=round(rate, 4),
                best_fraction=None if best is None else round(best, 3),
                m50_ab=grid.m50(rate),
                testable=testable,
                reason=why,
            )
        )
    fine = log_grid(rates.distances[0], rates.distances[-1], 600)
    best = [(d, grid.best(rates.rate(d))[0] or 0.0) for d in fine]
    d50 = max((d for d, b in best if b >= 0.5), default=None)
    dany = max(
        (
            float(c["distance_au"])
            for c in study["grid"]
            if c["motion"] == "parallax" and c["n_recovered"] > 0
        ),
        default=None,
    )
    dlink = rates.distance_at(grid.min_rate)
    return rows, X.ReachSummary(
        d_max_50_au=None if d50 is None else round(d50, 1),
        d_max_any_au=None if dany is None else round(dany, 1),
        d_linker_limit_au=None if dlink is None else round(dlink, 1),
    )


def consistency(grid: Grid, study: dict) -> list[X.ConsistencyRow]:
    rows = []
    for c in study["grid"]:
        if c["motion"] != "parallax" or not c["n_injected"]:
            continue
        f, _ = grid.fraction(c["mag_ab"], c["rate_arcsec_per_hr"])
        rows.append(
            X.ConsistencyRow(
                distance_au=c["distance_au"],
                mag_ab=c["mag_ab"],
                measured_fraction=c["fraction"],
                n_injected=c["n_injected"],
                model_fraction=None if f is None else round(f, 3),
            )
        )
    return rows


def _cell_area_deg2(dec_center: float, cell_deg: float) -> float:
    d0, d1 = math.radians(dec_center - cell_deg / 2), math.radians(dec_center + cell_deg / 2)
    return math.degrees(math.radians(cell_deg)) * math.degrees(math.sin(d1) - math.sin(d0))


def region_weight(p9: dict, ra: float, dec: float) -> float:
    """Share of the open Planet Nine region inside one 0.3 deg patch (uniform within a cell)."""
    cell = p9["cell_deg"]
    i = int((ra % 360) // cell)
    j = int((dec + 90) // cell)
    key = (round((i + 0.5) * cell, 4), round((j + 0.5) * cell - 90, 4))
    frac = _p9_lookup(p9).get(key, 0.0)
    if not frac:
        return 0.0
    return frac * PATCH_DEG**2 / _cell_area_deg2(key[1], cell)


_P9_CACHE: dict[int, dict] = {}


def _p9_lookup(p9: dict) -> dict:
    k = id(p9)
    if k not in _P9_CACHE:
        _P9_CACHE[k] = {
            (round(c["ra_deg"], 4), round(c["dec_deg"], 4)): c["fraction"] for c in p9["cells"]
        }
    return _P9_CACHE[k]


def _unit(ra: np.ndarray, dec: np.ndarray) -> np.ndarray:
    r, d = np.radians(ra), np.radians(dec)
    return np.column_stack([np.cos(d) * np.cos(r), np.cos(d) * np.sin(r), np.sin(d)])


def in_patches(patches: list[tuple[float, float]], ra: np.ndarray, dec: np.ndarray) -> np.ndarray:
    """Boolean per point: inside any searched patch (RA/Dec-aligned 0.3 deg squares)."""
    from scipy.spatial import cKDTree

    if not patches or len(ra) == 0:
        return np.zeros(len(ra), bool)
    pa = np.array(patches, float)
    tree = cKDTree(_unit(pa[:, 0], pa[:, 1]))
    chord = 2 * math.sin(math.radians(PATCH_DEG / 2 * math.sqrt(2)) / 2)
    hits = tree.query_ball_point(_unit(ra, dec), r=chord * 1.0001)
    half = PATCH_DEG / 2
    out = np.zeros(len(ra), bool)
    for k, idx in enumerate(hits):
        for i in idx:
            dra = ((ra[k] - pa[i, 0] + 180) % 360 - 180) * math.cos(math.radians(pa[i, 1]))
            if abs(dra) <= half and abs(dec[k] - pa[i, 1]) <= half:
                out[k] = True
                break
    return out


def population_stats(
    pop: dict[str, np.ndarray], patches, grid: Grid, rates: RateModel
) -> X.PlanetNinePopulationStats:
    open_ = (pop["ZTF"] == 0) & (pop["DES"] == 0) & (pop["PS1"] == 0)
    ra, dec, r = pop["ra"][open_], pop["dec"][open_], pop["R"][open_]
    diam = 2 * pop["rad"][open_] * EARTH_RADIUS_KM
    alb, v = pop["albedo"][open_], pop["V"][open_]
    inside = in_patches(patches, ra, dec)
    member_rates = np.array([rates.rate(float(x)) or 0.0 for x in r])
    faint = np.array(
        [
            max(m.total_ab for m in band_mags(Planet(float(dk), float(ak)), float(rk)))
            for dk, ak, rk in zip(diam, alb, r, strict=True)
        ]
    )
    expected = 0.0
    for k in np.flatnonzero(inside):
        f, _ = grid.fraction(float(faint[k]), float(member_rates[k]))
        expected += f or 0.0
    n_open = int(open_.sum())
    return X.PlanetNinePopulationStats(
        n_open=n_open,
        n_open_in_searched=int(inside.sum()),
        distance_au_p05=round(float(np.percentile(r, 5)), 1),
        distance_au_p50=round(float(np.percentile(r, 50)), 1),
        distance_au_p95=round(float(np.percentile(r, 95)), 1),
        distance_au_min=round(float(r.min()), 1),
        rate_arcsec_per_hr_max=round(float(member_rates.max()), 4),
        n_faster_than_linker_minimum=int((member_rates >= grid.min_rate).sum()),
        band_mag_ab_p50=round(float(np.median(faint)), 2),
        v_mag_p50=round(float(np.median(v)), 2),
        expected_recovered=round(expected, 4),
        fraction_excluded=round(expected / n_open, 6) if n_open else 0.0,
    )


# ---------------------------------------------------------------------------
# Document
# ---------------------------------------------------------------------------


def _mag(x: float) -> float | None:
    return None if not math.isfinite(x) or x > 99 else round(x, 3)


def build(out_dir: Path, population: dict[str, np.ndarray] | None = None) -> X.Exclusion:
    survey = json.loads((out_dir / "survey.json").read_text())
    study = newest_study(out_dir)
    p9_path = out_dir / "survey" / "planet_nine.json"
    p9 = json.loads(p9_path.read_text()) if p9_path.exists() else survey.get("planet_nine")
    grid = grid_from_study(study)
    rates = rate_model(study)
    pooled = pooled_m50(study)
    patches, _ = searched_patches(survey)
    totals = survey["totals"]

    # Tiles the newest study measured directly (today the study's own tiles; survey tiles
    # join automatically once a study measures them).
    measured = [
        X.MeasuredTile(
            tile_id=t["tile_id"],
            ra_deg=t["center"]["ra_deg"],
            dec_deg=t["center"]["dec_deg"],
            m50_ab=t["m50_ab"],
            delta_mag=round(t["m50_ab"] - pooled, 3),
            planet_nine_weight=round(
                region_weight(p9, t["center"]["ra_deg"], t["center"]["dec_deg"]), 8
            )
            if p9
            else 0.0,
        )
        for t in survey["tiles"]
        if t["status"] == "processed" and t.get("m50_ab") is not None and pooled is not None
    ]

    rows, summary = reach(grid, rates, study)
    sizes = []
    for d in REACH_DISTANCES_AU:
        for a in SIZE_ALBEDOS:
            dmin, why = min_diameter_km(grid, rates, float(d), a, 0.0)
            sizes.append(
                X.SizeLimit(
                    distance_au=float(d),
                    geometric_albedo=a,
                    t_int_k=0.0,
                    min_diameter_km=None if dmin is None else round(dmin, 1),
                    reason=why,
                )
            )

    refs = []
    for dk, ak, tk, rk in REFERENCE_PLANETS:
        res = planet_completeness(grid, rates, Planet(dk, ak, tk), rk)
        refs.append(
            X.ReferencePoint(
                diameter_km=round(dk, 1),
                geometric_albedo=ak,
                t_int_k=tk,
                distance_au=rk,
                band_mags_ab=[round(m.total_ab, 3) for m in res["mags"]],
                thermal_mags_ab=[_mag(m.thermal_ab) for m in res["mags"]],
                rate_arcsec_per_hr=round(res["rate"], 4),
                completeness_conservative=None if res["cons"] is None else round(res["cons"], 4),
                completeness_optimistic=None if res["opt"] is None else round(res["opt"], 4),
            )
        )

    p9_doc = None
    if p9:
        frac_in = sum(region_weight(p9, ra, dec) for ra, dec in patches)
        p9_doc = X.PlanetNineExclusion(
            citation=p9["citation"],
            url=p9["url"],
            n_population=p9["n_population"],
            n_open=p9["n_remaining"],
            region_fraction_in_searched=round(frac_in, 6),
            population=population_stats(population, patches, grid, rates)
            if population is not None
            else None,
        )

    lin = [c for c in study["grid"] if c["motion"] == "linear"]
    doc = X.Exclusion(
        pipeline_version=pipeline_version(require_clean=True),
        build_run_id=build_run_id(),
        generated_utc=utc_now(),
        survey=X.ExclusionSurvey(
            survey_generated_utc=survey["generated_utc"],
            n_patches_searched=len(patches),
            area_deg2_searched=round(len(patches) * PATCH_DEG**2, 2),
            sky_fraction_searched=round(len(patches) * PATCH_DEG**2 / SKY_DEG2, 6),
            n_patches_measured=len(measured),
            n_failed_searches=int(totals.get("n_failed") or 0),
        ),
        linker=X.ExclusionLinker(
            min_rate_arcsec_per_hr=LINK.min_rate_arcsec_per_hr,
            max_rate_arcsec_per_hr=LINK.max_rate_arcsec_per_hr,
            min_visits=LINK.min_track_clusters,
            detect_threshold_snr=DETECT.threshold_snr,
        ),
        completeness=X.Completeness(
            study_id=study["study_id"],
            field_ids=study["field_ids"],
            n_injected=sum(c["n_injected"] for c in lin),
            n_recovered=sum(c["n_recovered"] for c in lin),
            mag_bins_ab=list(grid.mags),
            rate_bins_arcsec_per_hr=list(grid.rates),
            cells=[
                X.CompletenessCell(
                    mag_ab=c["mag_ab"],
                    rate_arcsec_per_hr=c["rate_arcsec_per_hr"],
                    n_injected=c["n_injected"],
                    n_recovered=c["n_recovered"],
                    fraction=c["fraction"],
                )
                for c in lin
            ],
            pooled_m50_ab=pooled,
        ),
        rate_by_distance=[
            X.RateAtDistance(
                distance_au=r["distance_au"],
                median_rate_arcsec_per_hr=r["median_rate_arcsec_per_hr"],
                n_injected=r["n_injected"],
            )
            for r in study["m50_by_distance"]
        ],
        consistency=consistency(grid, study),
        reach=rows,
        reach_summary=summary,
        size_limits=sizes,
        bands=[
            X.BandInfo(
                detector=b.detector,
                wl_min_um=b.wl_min_um,
                wl_max_um=b.wl_max_um,
                wl_eff_um=b.wl_eff_um,
            )
            for b in spherex_bands()
        ],
        measured_tiles=measured,
        planet_nine=p9_doc,
        reference_points=refs,
        assumptions=ASSUMPTIONS,
        references=REFERENCES,
    )
    return doc


def write(out_dir: Path, population: dict[str, np.ndarray] | None = None) -> X.Exclusion:
    doc = build(out_dir, population)
    write_json(out_dir / OUT, doc)
    return doc
