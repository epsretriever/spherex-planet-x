""" "How big is it?": thermal sizes for published objects, JPL inputs, and validation.

- ``thermal_for(obj, orbit, jpl)`` builds an object's ``thermal`` block (science in
  ``science/thermal.py``); ``spherex-px publish`` calls it for every real object.
- ``fetch_jpl_inputs`` (``spherex-px thermal-inputs``, run in CI by
  ``.github/workflows/thermal.yml`` because JPL is not reachable from every machine) pulls, for
  each object JPL identified, the Small-Body Database's H, G, diameter, albedo and orbit, and
  JPL Horizons' r, delta and phase angle at each detection time. It writes
  ``data/thermal/jpl-inputs.json``, which publish reads.
- ``validation_doc`` compares our sizes with SBDB's (mostly NEOWISE) diameters and is written
  to ``data/validation/thermal.json``.
"""

from __future__ import annotations

import json
import logging
import math
import statistics
import urllib.parse
import zlib
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from pydantic import BaseModel

from . import schemas as S
from . import schemas_thermal as ST
from .science import geometry as G
from .science import thermal as T

log = logging.getLogger(__name__)

INPUTS_PATH = Path("thermal") / "jpl-inputs.json"
VALIDATION_PATH = Path("validation") / "thermal.json"
N_MC = 400
#: Geometric albedo of the darkest asteroids, for judging whether an upper limit says anything.
DARKEST_ALBEDO = 0.02
SBDB_API = "https://ssd-api.jpl.nasa.gov/sbdb.api"

METHOD = (
    "Reflected sunlight is modelled from SPHEREx's 0.7-2.6 um reflectance (flux divided by the "
    "ASTM E490 solar spectrum), extrapolated to 3.3-5 um and subtracted. The excess is fitted "
    "with the Near-Earth Asteroid Thermal Model (NEATM, Harris 1998) with a fixed beaming "
    "parameter (1.0 +- 0.2 beyond the near-Earth region, Masiero et al. 2011; 1.4 +- 0.5 for "
    "near-Earth objects, Mainzer et al. 2011) and emissivity 0.9; size and albedo are tied "
    "through D = 1329 km / sqrt(p_V) x 10^(-H/5). Uncertainties from 400 Monte Carlo draws "
    "over flux errors, orbit (or JPL geometry), H, G, beaming parameter and the extrapolation."
)


# ----------------------------------------------------------------------------- JPL inputs


class JplInput(BaseModel):
    designation: str
    fetched_utc: str
    sbdb: dict | None = None  # h, g, diameter_km, ..., elements {a, e, i, om, w, ma}, epoch_jd
    horizons: dict | None = None  # mjd[], r_au[], delta_au[], alpha_deg[]
    errors: list[str] = []


class JplInputs(BaseModel):
    generated_utc: str
    source: str
    objects: dict[str, JplInput]


def load_inputs(out_dir: Path) -> JplInputs | None:
    p = out_dir / INPUTS_PATH
    if not p.exists():
        return None
    try:
        return JplInputs.model_validate_json(p.read_text())
    except ValueError as err:
        log.warning("ignoring %s: %s", p, err)
        return None


def parse_sbdb(body: dict) -> dict:
    """H, G, diameter, albedo (with sigmas and references) and the orbit from an SBDB answer."""
    phys = {p.get("name"): p for p in body.get("phys_par") or []}

    def num(name, key="value"):
        v = (phys.get(name) or {}).get(key)
        try:
            return float(v) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None

    out = {
        "h": num("H"),
        "g": num("G"),
        "diameter_km": num("diameter"),
        "diameter_sigma_km": num("diameter", "sigma"),
        "albedo": num("albedo"),
        "albedo_sigma": num("albedo", "sigma"),
        "diameter_ref": (phys.get("diameter") or {}).get("ref"),
        "fullname": (body.get("object") or {}).get("fullname"),
    }
    orbit = body.get("orbit") or {}
    els = {e.get("name"): e.get("value") for e in orbit.get("elements") or []}
    try:
        out["elements"] = {k: float(els[k]) for k in ("a", "e", "i", "om", "w", "ma")}
        out["epoch_jd"] = float(orbit["epoch"])
    except (KeyError, TypeError, ValueError):
        out["elements"] = None
        out["epoch_jd"] = None
    return out


def sbdb_api_url(designation: str) -> str:
    from .triage import _jpl_search_string

    q = {"sstr": _jpl_search_string(designation), "phys-par": "1"}
    return f"{SBDB_API}?{urllib.parse.urlencode(q)}"


def horizons_geometry_url(designation: str, mjds: list[float]) -> str:
    from .settings import get_settings
    from .triage import horizons_command

    q = {
        "format": "json",
        "COMMAND": horizons_command(designation),
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": "'500@399'",
        "TLIST": " ".join(f"'{m + 2400000.5:.6f}'" for m in mjds),
        "TLIST_TYPE": "JD",
        "TIME_TYPE": "UT",
        "QUANTITIES": "'19,20,24'",
        "CSV_FORMAT": "YES",
    }
    return f"{get_settings().horizons_url}?{urllib.parse.urlencode(q)}"


def parse_horizons_geometry(body) -> list[tuple[float, float, float, float]]:
    """(jd, r_au, delta_au, alpha_deg) rows, read by the column names Horizons prints."""
    text = body.get("result") if isinstance(body, dict) else body
    if not isinstance(text, str):
        return []
    soe, eoe = text.find("$$SOE"), text.find("$$EOE")
    if soe < 0 or eoe < soe:
        return []
    header = None
    for line in reversed(text[:soe].splitlines()):
        if "delta" in line and "S-T-O" in line:
            header = [c.strip() for c in line.split(",")]
            break
    if header is None:
        return []
    try:
        ir, idl, ia = header.index("r"), header.index("delta"), header.index("S-T-O")
    except ValueError:
        return []
    out = []
    for line in text[soe + 5 : eoe].splitlines():
        cells = [c.strip() for c in line.split(",")]
        if len(cells) <= max(ir, idl, ia):
            continue
        try:
            out.append((float(cells[0]), float(cells[ir]), float(cells[idl]), float(cells[ia])))
        except ValueError:
            continue
    return out


def identified_objects(out_dir: Path, api: str | None) -> dict[str, str]:
    """object_id -> JPL designation: pipeline matches plus the live Worker's matches."""
    out: dict[str, str] = {}
    lst = out_dir / "objects.json"
    if lst.exists():
        for s in json.loads(lst.read_text()).get("objects", []):
            if s.get("known_object_matched") and s.get("known_object_designation"):
                out[s["object_id"]] = s["known_object_designation"]
    if api:
        from .data.http import request

        offset: int | None = 0
        while offset is not None:
            resp = request("GET", f"{api.rstrip('/')}/api/objects?limit=500&offset={offset}")
            if resp.status_code != 200:
                log.warning("live object list: HTTP %s", resp.status_code)
                break
            body = resp.json()
            for s in body.get("objects", []):
                des = s.get("known_object_designation")
                if s.get("known_object_matched") and des:
                    out[s["object_id"]] = des
                    for other in s.get("also_seen_as") or []:
                        out.setdefault(other, des)
            offset = body.get("next_offset")
    return out


def fetch_jpl_inputs(
    out_dir: Path,
    api: str | None,
    limit: int = 300,
    max_age_days: float = 30.0,
    now: str | None = None,
) -> tuple[int, int, int]:
    """Refresh data/thermal/jpl-inputs.json. Returns (identified, fetched, failed)."""
    from .data.http import UpstreamError
    from .triage import _get_json

    now = now or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    old = load_inputs(out_dir)
    entries = dict(old.objects) if old else {}
    ids = identified_objects(out_dir, api)
    fetched = failed = 0
    stamp = datetime.fromisoformat(now.replace("Z", "+00:00"))
    for oid, des in sorted(ids.items()):
        prev = entries.get(oid)
        if prev and prev.designation == des and not prev.errors:
            age = stamp - datetime.fromisoformat(prev.fetched_utc.replace("Z", "+00:00"))
            if age.total_seconds() < max_age_days * 86400:
                continue
        if fetched + failed >= limit:
            break
        p = out_dir / "objects" / f"{oid}.json"
        if not p.exists():
            continue
        obj = json.loads(p.read_text())
        mjds = [d["mjd"] for d in obj.get("detections", [])]
        e = JplInput(designation=des, fetched_utc=now)
        try:
            e.sbdb = parse_sbdb(_get_json(sbdb_api_url(des)))
        except UpstreamError as err:
            e.errors.append(f"JPL SBDB: {err}")
        if mjds:
            try:
                rows = parse_horizons_geometry(_get_json(horizons_geometry_url(des, mjds)))
                if len(rows) == len(mjds):
                    e.horizons = {
                        "mjd": mjds,
                        "r_au": [r[1] for r in rows],
                        "delta_au": [r[2] for r in rows],
                        "alpha_deg": [r[3] for r in rows],
                    }
                else:
                    e.errors.append(f"JPL Horizons: {len(rows)} of {len(mjds)} epochs")
            except UpstreamError as err:
                e.errors.append(f"JPL Horizons: {err}")
        # Elements from SBDB are enough for the geometry, so only a missing SBDB is a failure.
        if e.sbdb is None:
            failed += 1
        else:
            fetched += 1
        entries[oid] = e
    entries = {k: v for k, v in entries.items() if k in ids}
    doc = JplInputs(
        generated_utc=now,
        source="JPL Small-Body Database API (ssd-api.jpl.nasa.gov/sbdb.api) and JPL Horizons, "
        "for objects identified by JPL SBIdent (pipeline triage or the Worker's checks)",
        objects=dict(sorted(entries.items())),
    )
    path = out_dir / INPUTS_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(doc.model_dump_json(indent=1) + "\n")
    return len(ids), fetched, failed


# ----------------------------------------------------------------------------- per object


def _r(x, n=3):
    if x is None or not math.isfinite(x):
        return None
    if x == 0:
        return 0.0
    return float(f"{x:.{n}g}")


def albedo_plain(pv: float | None) -> str | None:
    if pv is None:
        return None
    pct = max(1, round(pv * 100))
    if pv < 0.08:
        return (
            f"Dark: reflects about {pct}% of the sunlight that hits it, like charcoal or asphalt."
        )
    if pv < 0.18:
        return f"Medium: reflects about {pct}% of sunlight, like bare dry soil."
    return f"Bright for an asteroid: reflects about {pct}% of sunlight, like desert sand."


def _geometry(o: S.ObjectDetail, orbit, jpl: JplInput | None) -> G.Geometry | None:
    mjd = np.array([d.mjd for d in o.detections])
    sc = np.array([d.spacecraft_geocentric_km for d in o.detections], float)
    if jpl and jpl.horizons and len(jpl.horizons["mjd"]) == len(mjd):
        if np.allclose(jpl.horizons["mjd"], mjd, atol=1e-6):
            h = jpl.horizons
            return G.fixed(h["r_au"], h["delta_au"], h["alpha_deg"], "jpl_horizons")
    if jpl and jpl.sbdb and jpl.sbdb.get("elements") and jpl.sbdb.get("epoch_jd"):
        el = jpl.sbdb["elements"]
        if el["e"] < 1:
            try:
                return G.from_elements(
                    [el["a"], el["e"], el["i"], el["om"], el["w"], el["ma"]],
                    jpl.sbdb["epoch_jd"] - 2400000.5,
                    mjd,
                    sc,
                    "jpl_elements",
                )
            except ValueError:
                pass
    if orbit is not None and orbit.clones_r:
        try:
            return G.from_states(orbit.clones_r, orbit.clones_v, orbit.epoch_tdb, mjd, sc)
        except ValueError:
            return None
    return None


def _points(o: S.ObjectDetail) -> list[T.Point]:
    idx = {d.epoch_id: i for i, d in enumerate(o.detections)}
    if o.spectrum is None:
        return []
    out = []
    for p in o.spectrum.points:
        i = idx.get(p.epoch_id)
        if i is None or p.flux_ujy is None or p.flux_err_ujy is None:
            continue
        out.append(
            T.Point(
                wavelength_um=p.wavelength_um,
                bandwidth_um=o.detections[i].bandwidth_um,
                flux_ujy=p.flux_ujy,
                flux_err_ujy=p.flux_err_ujy,
                band_index=p.band_index,
                epoch=i,
            )
        )
    return out


def _jpl_physical(jpl: JplInput | None) -> ST.JplPhysical | None:
    if not jpl or not jpl.sbdb:
        return None
    from .triage import sbdb_url

    s = jpl.sbdb
    return ST.JplPhysical(
        designation=jpl.designation,
        h=s.get("h"),
        g=s.get("g"),
        diameter_km=s.get("diameter_km"),
        diameter_sigma_km=s.get("diameter_sigma_km"),
        albedo=s.get("albedo"),
        albedo_sigma=s.get("albedo_sigma"),
        diameter_ref=s.get("diameter_ref"),
        sbdb_url=sbdb_url(jpl.designation),
    )


def _not_sizable(reason: str, jpl: JplInput | None, n_th: int = 0) -> ST.ThermalFit:
    return ST.ThermalFit(
        status="not_sizable",
        status_plain=reason,
        method=METHOD,
        diameter_km=None,
        diameter_lo_km=None,
        diameter_hi_km=None,
        diameter_upper_limit_km=None,
        albedo=None,
        albedo_lo=None,
        albedo_hi=None,
        albedo_plain=None,
        h=None,
        h_sigma=None,
        h_source=None,
        g=None,
        eta=None,
        eta_sigma=None,
        eta_mode="fixed",
        t_subsolar_k=None,
        r_au=None,
        delta_au=None,
        alpha_deg=None,
        geometry_source=None,
        n_thermal_points=n_th,
        n_significant_bands=0,
        min_sigma=T.MIN_SIGMA,
        min_bands=T.MIN_BANDS,
        n_mc=0,
        points=[],
        model=None,
        jpl=_jpl_physical(jpl),
        caveats=[],
    )


def _caveats(res: T.ThermalResult, geo: G.Geometry, o: S.ObjectDetail) -> list[str]:
    out = [
        f"Assumes a round asteroid whose heat follows NEATM with beaming parameter "
        f"{res.eta:.1f} +- {res.eta_sigma:.1f}; a different value moves the size by tens of percent.",
        "Reflected sunlight at 3.3-5 um is extrapolated from 0.7-2.6 um (with a 15% allowance); "
        "an unusual surface there would bias the heat.",
        "SPHEREx's channels were measured at different times, so a spinning, elongated "
        "asteroid can look brighter in some than others (a 7% allowance per point).",
    ]
    if res.h_source == "spherex_reflectance":
        out.append(
            "JPL has no brightness (H) for it here, so H is estimated from SPHEREx's own "
            "near-infrared light with a typical asteroid colour."
        )
    if geo.source == "orbit_clones":
        r = geo.r_au.mean(axis=1)
        lo, hi = np.percentile(r, [16, 84])
        out.append(
            f"Its distance comes from SPHEREx's short {o.orbit_status.value} orbit "
            f"({lo:.2f}-{hi:.2f} AU from the Sun); that range is in the error bar."
        )
    return out


def thermal_for(o: S.ObjectDetail, orbit, jpl: JplInput | None, n_mc: int = N_MC) -> ST.ThermalFit:
    points = _points(o)
    n_th = sum(1 for p in points if p.wavelength_um >= T.THERMAL_MIN_UM)
    if n_th < T.MIN_BANDS:
        return _not_sizable(
            f"SPHEREx measured it in {n_th} channel(s) at 3.3-5 um; at least {T.MIN_BANDS} are "
            "needed to look for its heat.",
            jpl,
            n_th,
        )
    geo = _geometry(o, orbit, jpl)
    if geo is None:
        return _not_sizable(
            "No orbit yet, so its distance from the Sun (and so its temperature) is unknown.",
            jpl,
            n_th,
        )
    s = jpl.sbdb if jpl and jpl.sbdb else {}
    if s.get("h") is not None:
        g = s.get("g")
        hp = T.HPrior(
            h=s["h"],
            sigma=T.H_SIGMA_JPL,
            g=g if g is not None else T.G_DEFAULT,
            g_sigma=0.05 if g is not None else T.G_SIGMA,
            source="jpl_sbdb",
        )
    else:
        hp = T.HPrior(h=None)
    cls = o.distance_class.value
    if s.get("elements"):
        el = s["elements"]
        cls = "neo" if el["a"] * (1 - el["e"]) < 1.3 else "main_belt"
    seed = zlib.crc32(o.object_id.encode())
    res = T.fit(points, geo, hp, eta=T.eta_prior(cls), n_mc=n_mc, seed=seed)
    if res.status == "not_sizable":
        return _not_sizable(res.reason, jpl, n_th)
    model_time = o.detections[res.model_epoch].time_utc
    plain = res.reason
    if res.status == "upper_limit" and res.diameter_upper_limit_km and res.h is not None:
        darkest = float(T.d_from_albedo(DARKEST_ALBEDO, res.h))
        if res.diameter_upper_limit_km > darkest:
            plain += (
                f" The limit ({res.diameter_upper_limit_km:.3g} km) is weaker than its brightness "
                f"alone allows (about {darkest:.3g} km even if it were as dark as the darkest "
                "asteroids), so it says little."
            )
        else:
            plain += f" It is at most about {res.diameter_upper_limit_km:.3g} km across."
    return ST.ThermalFit(
        status=res.status,
        status_plain=plain,
        method=METHOD,
        diameter_km=_r(res.diameter_km),
        diameter_lo_km=_r(res.diameter_lo_km),
        diameter_hi_km=_r(res.diameter_hi_km),
        diameter_upper_limit_km=_r(res.diameter_upper_limit_km),
        albedo=_r(res.albedo, 2),
        albedo_lo=_r(res.albedo_lo, 2),
        albedo_hi=_r(res.albedo_hi, 2),
        albedo_plain=albedo_plain(res.albedo),
        h=_r(res.h, 4),
        h_sigma=_r(res.h_sigma, 2),
        h_source=res.h_source,
        g=_r(res.g, 2),
        eta=res.eta,
        eta_sigma=res.eta_sigma,
        eta_mode=res.eta_mode,
        t_subsolar_k=_r(res.t_subsolar_k, 3),
        r_au=_r(res.r_au, 4),
        delta_au=_r(res.delta_au, 4),
        alpha_deg=_r(res.alpha_deg, 3),
        geometry_source=geo.source,
        n_thermal_points=res.n_thermal_points,
        n_significant_bands=res.n_significant_bands,
        min_sigma=T.MIN_SIGMA,
        min_bands=T.MIN_BANDS,
        n_mc=res.n_mc,
        points=[
            ST.ThermalPoint(
                band_index=p.band_index,
                wavelength_um=p.wavelength_um,
                flux_ujy=_r(p.flux_ujy, 4),
                reflected_ujy=_r(p.reflected_ujy, 4),
                excess_ujy=_r(p.excess_ujy, 4),
                excess_err_ujy=_r(p.excess_err_ujy, 3),
                sigma=_r(p.sigma, 3),
            )
            for p in res.excess
        ],
        model=ST.ThermalModelCurve(
            time_utc=model_time,
            wavelength_um=res.model_wavelength_um,
            reflected_ujy=[_r(x, 4) for x in res.model_reflected_ujy],
            thermal_ujy=[_r(x, 4) for x in res.model_thermal_ujy],
        ),
        jpl=_jpl_physical(jpl),
        caveats=_caveats(res, geo, o),
    )


# ----------------------------------------------------------------------------- validation


def _q(xs: list[float], p: float) -> float:
    return float(np.percentile(xs, p))


def validation_doc(
    objects: list[S.ObjectDetail], inputs: JplInputs | None, version: str, now: str
) -> ST.ThermalValidation:
    jpl = inputs.objects if inputs else {}
    identified = {o.object_id for o in objects if o.known_object.matched} | set(jpl)
    rows = []
    for o in objects:
        e = jpl.get(o.object_id)
        t = o.thermal
        if not e or not e.sbdb or not e.sbdb.get("diameter_km") or t is None:
            continue
        dj = e.sbdb["diameter_km"]
        rows.append(
            ST.ThermalValidationRow(
                object_id=o.object_id,
                designation=e.designation,
                status=t.status,
                diameter_km=t.diameter_km,
                diameter_lo_km=t.diameter_lo_km,
                diameter_hi_km=t.diameter_hi_km,
                diameter_upper_limit_km=t.diameter_upper_limit_km,
                jpl_diameter_km=dj,
                jpl_diameter_sigma_km=e.sbdb.get("diameter_sigma_km"),
                jpl_diameter_ref=e.sbdb.get("diameter_ref"),
                ratio=_r(t.diameter_km / dj, 3) if t.status == "sized" and t.diameter_km else None,
                albedo=t.albedo,
                jpl_albedo=e.sbdb.get("albedo"),
                h_source=t.h_source,
                geometry_source=t.geometry_source,
            )
        )
    sized = [r for r in rows if r.ratio is not None]
    ratios = [r.ratio for r in sized]
    logs = [math.log(x) for x in ratios]
    scatter = None
    if len(logs) >= 2:
        med = statistics.median(logs)
        scatter = _r(
            100 * (math.exp(1.4826 * statistics.median(abs(x - med) for x in logs)) - 1), 3
        )
    inside = [
        r.diameter_lo_km <= r.jpl_diameter_km <= r.diameter_hi_km
        for r in sized
        if r.diameter_lo_km is not None and r.diameter_hi_km is not None
    ]
    alb = [r.albedo / r.jpl_albedo for r in sized if r.albedo and r.jpl_albedo]
    ul = [r for r in rows if r.status == "upper_limit" and r.diameter_upper_limit_km]
    counts = {
        s: sum(1 for o in objects if o.thermal and o.thermal.status == s)
        for s in ("sized", "upper_limit", "not_sizable")
    }
    n = len(sized)
    note = (
        f"Compared over {n} object(s): sized by SPHEREx heat and with a diameter in JPL's "
        f"Small-Body Database, out of {len(identified)} object(s) JPL identified."
        if n
        else f"No comparison yet: none of the {len(identified)} object(s) JPL identified has both "
        "a SPHEREx thermal size and a diameter in JPL's Small-Body Database."
    )
    return ST.ThermalValidation(
        pipeline_version=version,
        generated_utc=now,
        method=METHOD,
        n_objects=len(objects),
        n_sized=counts["sized"],
        n_upper_limit=counts["upper_limit"],
        n_not_sizable=counts["not_sizable"],
        n_identified=len(identified),
        n_jpl_inputs=sum(1 for e in jpl.values() if e.sbdb),
        n_with_jpl_diameter=len(rows),
        n_compared=n,
        median_ratio=_r(statistics.median(ratios), 3) if ratios else None,
        ratio_p16=_r(_q(ratios, 16), 3) if ratios else None,
        ratio_p84=_r(_q(ratios, 84), 3) if ratios else None,
        scatter_pct=scatter,
        within_1sigma=_r(sum(inside) / len(inside), 3) if inside else None,
        albedo_median_ratio=_r(statistics.median(alb), 3) if alb else None,
        n_upper_limit_compared=len(ul),
        upper_limit_consistent=(
            _r(sum(1 for r in ul if r.jpl_diameter_km <= r.diameter_upper_limit_km) / len(ul), 3)
            if ul
            else None
        ),
        rows=sorted(rows, key=lambda r: r.object_id),
        note=note,
    )


def attach_thermal(out_dir: Path, o: S.ObjectDetail, orbit, inputs: JplInputs | None) -> None:
    """Set ``o.thermal`` (never fails the publish: a fit error leaves the object unsized)."""
    jpl = inputs.objects.get(o.object_id) if inputs else None
    try:
        o.thermal = thermal_for(o, orbit, jpl)
    except Exception as err:  # noqa: BLE001 - a size is optional; the object must still publish
        log.warning("%s: thermal fit failed: %s", o.object_id, err)
        o.thermal = _not_sizable("The size fit failed for this object.", jpl)


def write_validation(
    out_dir: Path, objects: list[S.ObjectDetail], inputs: JplInputs | None, version: str, now: str
) -> ST.ThermalValidation:
    from .build import write_json

    doc = validation_doc(objects, inputs, version, now)
    write_json(out_dir / VALIDATION_PATH, doc)
    return doc
