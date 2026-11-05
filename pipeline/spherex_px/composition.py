"""`spherex-px composition` and `spherex-px composition-validate`: indicative compositions.

For every published object (``data/objects/{object_id}.json``) this reads its spectrum points,
their detections (times, bands, SPHEREx's position) and its orbit clones, runs
``science/composition.py`` and writes ``data/objects/{object_id}/composition.json``
(``ObjectComposition``). ``composition-validate`` compares the classes with published
taxonomies of the objects JPL identified (``data/validation/composition_truth.json``, fetched
from JPL SBDB by ``.github/workflows/composition.yml``) and with simulated spectra, and writes
``data/validation/composition.json`` (``CompositionValidation``).
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from . import schemas as S
from .science import composition as C

COMPOSITION_FILE = "composition.json"
TRUTH_PATH = Path("validation") / "composition_truth.json"
VALIDATION_PATH = Path("validation") / "composition.json"
SIM_SEED = 20261105
#: Each object's coverage is reused this many times per class in the simulated test.
SIM_DRAWS_PER_CLASS = 4

COMPLEX_SHORT = {
    "S": "stony S-type",
    "C": "carbon-rich C-type",
    "X": "X-type",
    "D": "very red D-type",
    "T": "T-type",
    "V": "basaltic V-type",
    "A": "olivine-rich A-type",
    "K": "K-type",
    "L": "L-type",
    "O": "O-type",
    "Q": "fresh stony Q-type",
    "R": "R-type",
}

CONFIDENCE_PLAIN = {
    "high": "High for a color match: the spectrum covers enough bands and wavelength that this type clearly fits better than the others.",
    "medium": "Medium: this type fits best, but other types are not ruled out.",
    "low": "Low: other asteroid types fit these colors almost as well, so treat this as a weak hint.",
}

BASE_CAVEATS = [
    "Indicative, not definitive: a type read from a few SPHEREx colors is a hint. Confirming it needs a dedicated spectrum from a telescope.",
    "SPHEREx starts at 0.75 µm, so it misses the visible colors that separate many subclasses. Only the broad type (S, C, X and so on) is meaningful here.",
    f"The sightings are hours apart and the asteroid rotates, so brightness changes from its shape are mixed into its colors. Every point carries an extra {C.SYSTEMATIC_FLOOR:.0%} error for this.",
    "Spectra look redder at larger phase angles (phase reddening). That effect is not corrected.",
]


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _r(x: float | None, d: int = 4) -> float | None:
    return None if x is None or not np.isfinite(x) else round(float(x), d)


# ---------------------------------------------------------------------------- inputs


def points_for(obj: dict) -> list[C.Point]:
    """Spectrum points joined with their detections (time, band edges, SPHEREx position)."""
    spec = obj.get("spectrum") or {}
    dets = obj.get("detections") or []
    by_epoch: dict[str, list[dict]] = {}
    for d in dets:
        by_epoch.setdefault(d["epoch_id"], []).append(d)
    out = []
    for p in spec.get("points") or []:
        cands = by_epoch.get(p["epoch_id"], [])
        det = next(
            (
                d
                for d in cands
                if d.get("band_index") == p.get("band_index")
                and abs(d.get("flux_ujy", 0) - p["flux_ujy"]) < 1e-6
            ),
            cands[0] if len(cands) == 1 else None,
        )
        if det is None:
            continue  # cannot place the point in time: leave it out rather than guess
        lam = float(p["wavelength_um"])
        rng = det.get("wavelength_um_range") or []
        bw = det.get("bandwidth_um") or lam / 40
        lo, hi = (rng[0], rng[1]) if len(rng) == 2 else (lam - bw / 2, lam + bw / 2)
        sc = det.get("spacecraft_geocentric_km") or [0.0, 0.0, 0.0]
        out.append(
            C.Point(
                band_index=p.get("band_index"),
                wavelength_um=lam,
                wl_lo_um=float(lo),
                wl_hi_um=float(hi),
                epoch_id=p["epoch_id"],
                mjd=float(det["mjd"]),
                flux_ujy=float(p["flux_ujy"]),
                flux_err_ujy=float(p["flux_err_ujy"]),
                sc_km=tuple(float(x) for x in sc),
            )
        )
    return out


def clones_for(out_dir: Path, obj: dict) -> tuple[np.ndarray | None, float | None]:
    """Orbit clones as (N, 6) ecliptic elements and their epoch (MJD TDB), if published."""
    orbit = obj.get("orbit")
    if not orbit:
        return None, None
    path = out_dir / "objects" / obj["object_id"] / "clones.json"
    keys = ("a_au", "e", "i_deg", "node_deg", "peri_deg", "mean_anomaly_deg")
    rows = []
    epoch = orbit.get("epoch_mjd")
    if path.exists():
        doc = json.loads(path.read_text())
        epoch = doc.get("epoch_mjd", epoch)
        rows = [[c[k] for k in keys] for c in doc.get("clones", []) if c.get("e", 1) < 1]
    if not rows:  # fall back to the reported orbit alone (no spread)
        if orbit.get("e", 1) >= 1:
            return None, None
        rows = [[orbit[k] for k in keys]]
    return np.array(rows, float), float(epoch)


# ---------------------------------------------------------------------------- text


def _hydration_block(h: C.Hydration) -> S.CompositionHydration:
    if h.status == "measured":
        depth, err, snr = h.band_depth, h.band_depth_err, h.snr or 0.0
        if depth > 0 and snr >= 3:
            verdict = "band_seen"
            text = (
                f"A dip of {depth:.0%} ± {err:.0%} near {h.band_center_um:.2f} µm (S/N {snr:.1f}), "
                "the kind of absorption hydrated (water-bearing) minerals cause. One coarse "
                "measurement: a hint worth checking, not proof of water."
            )
        else:
            verdict = "no_clear_band"
            text = (
                f"No clear 3-µm band: depth {depth:.0%} ± {err:.0%} near {h.band_center_um:.2f} µm. "
                f"A band shallower than about {max(depth, 0) + 2 * err:.0%} cannot be ruled out."
            )
    else:
        verdict = "not_measured"
        text = {
            "not_covered": "Not measured: SPHEREx did not see this object at 2.7-3.1 µm with enough nearby points to define the continuum.",
            "thermal": "Not measured: at 2.7-3.1 µm this object is warm enough that its own heat could mimic or hide a band.",
            "no_orbit": "Not measured: without an orbit its distance from the Sun, and so its thermal glow at 3 µm, is unknown.",
        }[h.status]
    return S.CompositionHydration(
        status=h.status,
        band_um=list(C.HYDRATION_BAND_UM),
        continuum_um=list(C.HYDRATION_CONTINUUM_UM),
        band_depth=_r(h.band_depth),
        band_depth_err=_r(h.band_depth_err),
        snr=_r(h.snr, 2),
        n_band_points=h.n_band,
        n_continuum_points=h.n_continuum,
        continuum=h.continuum,
        verdict=verdict,
        verdict_plain=text,
    )


def _match(m: C.Match) -> S.TaxonomyMatch:
    return S.TaxonomyMatch(
        class_name=m.name, complex=m.complex, chi2=round(m.chi2, 3), dof=m.dof,
        probability=round(m.probability, 4),
    )  # fmt: skip


def _taxonomy_block(t: C.Taxonomy) -> S.CompositionTaxonomy:
    best = t.matches[0]
    other = next((m for m in t.matches if m.complex != best.complex), None)
    tpl = next(x for x in C.templates() if x.name == best.name)
    sel = tpl.wavelength_um >= 0.7
    return S.CompositionTaxonomy(
        best=_match(best),
        runner_up=_match(other) if other else None,
        top=[_match(m) for m in t.matches[:5]],
        complex_probability={
            k: round(v, 4) for k, v in sorted(t.complex_probability.items(), key=lambda kv: -kv[1])
        },
        best_complex=t.best_complex,
        best_complex_plain=C.COMPLEX_PLAIN[t.best_complex],
        runner_up_complex=t.runner_up_complex,
        confidence=t.confidence,
        confidence_plain=CONFIDENCE_PLAIN[t.confidence],
        n_bands=t.n_bands,
        wavelength_span_um=round(t.span_um, 3),
        reduced_chi2=round(t.reduced_chi2, 3),
        slope_per_um=round(t.slope_per_um, 4),
        slope_err_per_um=round(t.slope_err_per_um, 4),
        slope_range_um=[round(x, 4) for x in t.slope_range_um],
        systematic_floor_frac=C.SYSTEMATIC_FLOOR,
        template=S.CompositionTemplate(
            class_name=best.name,
            wavelength_um=[round(float(x), 3) for x in tpl.wavelength_um[sel]],
            reflectance=[round(float(x) * best.scale, 4) for x in tpl.reflectance[sel]],
            sigma=[round(float(x) * best.scale, 4) for x in tpl.sigma[sel]],
        ),
    )


def compose(
    obj: dict, out_dir: Path, pipeline_version: str, now: str | None = None
) -> S.ObjectComposition:
    """The ObjectComposition for one ObjectDetail (as parsed JSON)."""
    pts = points_for(obj)
    clones, epoch = clones_for(out_dir, obj)
    simulated = obj.get("classification") == "injected"
    caveats = list(BASE_CAVEATS)
    if simulated:
        caveats.insert(
            0,
            "SIMULATED: this object was planted in real images to test the pipeline; its colors are not a real asteroid's.",
        )
    if not pts:
        geom = C.Geometry("same_night_only", np.array([]), np.array([]), np.array([], bool), 0.0,
                          note="No spectrum points could be matched to their sightings.")  # fmt: skip
        res = None
    else:
        res = C.analyse(pts, clones, epoch)
        geom = res.spectrum.geometry
    if geom.method == "same_night_only":
        caveats.append(geom.note)
    tax = res.taxonomy if res else None
    hyd = res.hydration if res else C.Hydration("not_covered")
    spec = res.spectrum if res else None
    if spec and spec.thermal_flagged:
        caveats.append(spec.thermal_note)

    if tax:
        lo, hi = tax.slope_range_um
        result = (
            f"Its colors look most like {C.COMPLEX_PLAIN[tax.best_complex]}. "
            f"Indicative only ({tax.confidence} confidence), from {tax.n_bands} SPHEREx bands "
            f"between {lo:.2f} and {hi:.2f} µm."
        )
        if tax.runner_up_complex:
            result += f" Next closest: {COMPLEX_SHORT[tax.runner_up_complex]}."
        if tax.reduced_chi2 > 3:
            caveats.append(
                f"No asteroid type fits these colors well (reduced chi-square {tax.reduced_chi2:.1f}). "
                "The colors may be affected by the object's rotation, a blended star or a measurement problem."
            )
    else:
        usable = res.taxonomy_points if res else []
        span = (
            (max(p.wavelength_um for p in usable) - min(p.wavelength_um for p in usable))
            if usable
            else 0.0
        )
        result = (
            f"Not enough of its spectrum was measured to compare it with asteroid types: "
            f"{len(usable)} usable bands below 2.5 µm spanning {span:.2f} µm "
            f"(at least {C.MIN_TAXONOMY_POINTS} bands over {C.MIN_TAXONOMY_SPAN_UM} µm are needed)."
        )
    hyd_block = _hydration_block(hyd)
    if hyd_block.verdict == "band_seen":
        result += " There may be a 3-µm dip from hydrated minerals."

    points = [
        S.CompositionPoint(
            band_index=p.band_index,
            wavelength_um=round(p.wavelength_um, 4),
            epoch_id=p.epoch_id,
            mjd=round(p.mjd, 6),
            flux_ujy=p.flux_ujy,
            flux_err_ujy=p.flux_err_ujy,
            geometry_factor=_r(p.geometry_factor, 5),
            reflectance=_r(p.reflectance) if p.excluded_reason is None else None,
            reflectance_err=_r(p.reflectance_err) if p.excluded_reason is None else None,
            thermal_fraction=_r(p.thermal_fraction),
            use=p.use,
            excluded_reason=p.excluded_reason,
        )
        for p in (spec.points if spec else [])
    ]
    factors = [
        abs(p.geometry_factor - 1) for p in (spec.points if spec else []) if p.geometry_factor
    ]
    return S.ObjectComposition(
        pipeline_version=pipeline_version,
        object_id=obj["object_id"],
        generated_utc=now or _now(),
        simulated=simulated,
        status="classified" if tax else "insufficient_data",
        result_plain=result,
        geometry=S.CompositionGeometry(
            method=geom.method,
            reference_mjd=round(geom.ref_mjd + 0.0, 6),
            helio_distance_au=_r(geom.r_au, 3),
            observer_distance_au=_r(geom.delta_au, 3),
            phase_angle_deg=_r(geom.phase_deg, 2),
            max_correction_frac=round(max(factors), 5) if factors else 0.0,
            phase_function=f"IAU H-G, G = {C.G_SLOPE}",
            note_plain=geom.note,
        ),
        normalisation=S.CompositionNormalisation(
            window_um=list(C.NORM_WINDOW_UM),
            method=spec.norm_method if spec else "none",
            n_points=spec.norm_n_points if spec else 0,
        ),
        points=points,
        taxonomy=_taxonomy_block(tax) if tax else None,
        hydration=hyd_block,
        thermal=S.CompositionThermal(
            helio_distance_min_au=_r(geom.r_min_au, 3),
            flagged=bool(spec and spec.thermal_flagged),
            model=(
                f"Standard Thermal Model (eta {C.STM_ETA}, emissivity {C.EMISSIVITY}), dark surface "
                f"(p_V {C.PV_DARK}) at the closest clone distance; points over "
                f"{C.THERMAL_FRACTION_MAX:.0%} thermal are not used"
            ),
            note_plain=spec.thermal_note if spec else "No spectrum.",
        ),
        caveats=caveats,
        references=[S.CompositionReference(label=a, citation=b, url=c) for a, b, c in C.REFERENCES],
    )


def run(out_dir: Path, pipeline_version: str) -> dict[str, int]:
    """Write composition.json for every object. Returns counts by status."""
    counts: dict[str, int] = {}
    now = _now()
    for path in sorted((out_dir / "objects").glob("*.json")):
        obj = json.loads(path.read_text())
        comp = compose(obj, out_dir, pipeline_version, now)
        d = out_dir / "objects" / obj["object_id"]
        d.mkdir(parents=True, exist_ok=True)
        (d / COMPOSITION_FILE).write_text(comp.model_dump_json(indent=2) + "\n")
        key = comp.status if not comp.taxonomy else f"{comp.status}:{comp.taxonomy.confidence}"
        counts[key] = counts.get(key, 0) + 1
    return counts


# ---------------------------------------------------------------------------- validation

_TOL_TO_COMPLEX = {"E": "X", "M": "X", "P": "X", "F": "C", "G": "C", "B": "C"}


def truth_complex(
    spec_b: str | None, spec_t: str | None
) -> tuple[str | None, str | None, str | None]:
    """(class, system, complex) from SBDB taxonomy strings; SMASS preferred (closer to Bus-DeMeo)."""
    for raw, system in ((spec_b, "SMASS"), (spec_t, "Tholen")):
        if not raw:
            continue
        s = re.sub(r"[^A-Za-z]", "", raw)
        if not s:
            continue
        if system == "SMASS":
            # Bus classes: S, Sa, Sk, Sl, Sq, Sr, C, B, Cb, Cg, Cgh, Ch, X, Xc, Xe, Xk, Ld, K, ...
            head = s[0].upper()
            cx = {"S": "S", "C": "C", "B": "C", "X": "X"}.get(head, head)
            if s == "Ld":
                cx = "L"
        else:
            # Tholen: several letters mean ambiguous; the first is the best fit. U = unusual.
            head = s.replace("U", "")[:1].upper()
            if not head:
                continue
            cx = _TOL_TO_COMPLEX.get(head, head)
        if cx not in C.COMPLEX_PLAIN:
            continue
        return raw, system, cx
    return None, None, None


def _agreement(rows: list[S.CompositionValidationRow]) -> S.CompositionAgreement:
    cmp = [r for r in rows if r.complex_agrees is not None]
    if not cmp:
        return S.CompositionAgreement(n=0, complex_agreement=None, broad_agreement=None)
    return S.CompositionAgreement(
        n=len(cmp),
        complex_agreement=round(sum(r.complex_agrees for r in cmp) / len(cmp), 3),
        broad_agreement=round(sum(bool(r.broad_agrees) for r in cmp) / len(cmp), 3),
    )


def simulated_recovery(
    comps: list[S.ObjectComposition], seed: int = SIM_SEED
) -> list[S.SimulatedRecoveryRow]:
    """SIMULATED: each class mean sampled at a real object's used bands with its real errors
    (plus the class's spread and the systematic floor); how often is its complex recovered?"""
    rng = np.random.default_rng(seed)
    tpls = C.templates()
    hits: dict[str, list[bool]] = {"high": [], "medium": [], "low": []}
    for comp in comps:
        if comp.simulated:
            continue
        used = [p for p in comp.points if p.use == "taxonomy" and p.reflectance]
        if len(used) < C.MIN_TAXONOMY_POINTS:
            continue
        w = np.array([p.wavelength_um for p in used])
        frac = np.array([p.reflectance_err / p.reflectance for p in used])
        for t in tpls:
            tm = np.interp(w, t.wavelength_um, t.reflectance)
            ts = np.interp(w, t.wavelength_um, t.sigma)
            for _ in range(SIM_DRAWS_PER_CLASS):
                # One class member: the mean plus a smooth deviation within the class spread.
                member = tm + ts * rng.normal() * np.linspace(-1, 1, len(w))
                e = np.abs(member) * frac
                r = member + rng.normal(size=len(w)) * e
                got = C.classify(w, r, e)
                if got is None:
                    continue
                hits[got.confidence].append(got.best_complex == t.complex)
    rows = []
    for lvl in ("high", "medium", "low"):
        h = hits[lvl]
        rows.append(
            S.SimulatedRecoveryRow(
                confidence=lvl, n=len(h), complex_recovered=round(sum(h) / len(h), 3) if h else None
            )
        )
    allh = [x for v in hits.values() for x in v]
    rows.append(
        S.SimulatedRecoveryRow(
            confidence="all",
            n=len(allh),
            complex_recovered=round(sum(allh) / len(allh), 3) if allh else None,
        )
    )
    return rows


def validate(
    out_dir: Path, pipeline_version: str, truth_path: Path | None = None
) -> S.CompositionValidation:
    comps = []
    for path in sorted((out_dir / "objects").glob(f"*/{COMPOSITION_FILE}")):
        comps.append(S.ObjectComposition.model_validate_json(path.read_text()))
    by_id = {c.object_id: c for c in comps}
    truth_path = truth_path or out_dir / TRUTH_PATH
    truth = json.loads(truth_path.read_text()) if truth_path.exists() else {}
    rows = []
    for t in truth.get("rows", []):
        cls, system, cx = truth_complex(t.get("spec_B"), t.get("spec_T"))
        comp = by_id.get(t["object_id"])
        ours = comp.taxonomy if comp else None
        agrees = broad = None
        if cx and ours:
            agrees = ours.best_complex == cx
            broad = C.BROAD_OF.get(ours.best_complex) == C.BROAD_OF.get(cx)
        rows.append(
            S.CompositionValidationRow(
                object_id=t["object_id"],
                designation=t["designation"],
                spec_B=t.get("spec_B"),
                spec_T=t.get("spec_T"),
                sbdb_url=t["sbdb_url"],
                truth_class=cls,
                truth_system=system,
                truth_complex=cx,
                our_status=comp.status if comp else None,
                our_class=ours.best.class_name if ours else None,
                our_complex=ours.best_complex if ours else None,
                our_confidence=ours.confidence if ours else None,
                complex_agrees=agrees,
                broad_agrees=broad,
            )
        )
    compared = [r for r in rows if r.complex_agrees is not None]
    by_conf = {
        lvl: _agreement([r for r in compared if r.our_confidence == lvl])
        for lvl in ("high", "medium", "low")
    }
    base = (
        round(sum(r.truth_complex == "S" for r in compared) / len(compared), 3)
        if compared
        else None
    )
    return S.CompositionValidation(
        pipeline_version=pipeline_version,
        generated_utc=_now(),
        truth_source=truth.get(
            "source",
            "JPL SBDB spec_B (SMASSII) / spec_T (Tholen) for objects the live Worker reports as JPL-identified",
        ),
        truth_query_utc=truth.get("query_utc"),
        n_objects=len(comps),
        n_classified=sum(c.taxonomy is not None for c in comps),
        n_identified=int(truth.get("n_identified", len(truth.get("rows", [])))),
        n_with_taxonomy=sum(r.truth_complex is not None for r in rows),
        n_compared=len(compared),
        overall=_agreement(compared),
        by_confidence=by_conf,
        baseline_always_s=base,
        rows=rows,
        simulated_recovery=simulated_recovery(comps),
        simulated_seed=SIM_SEED,
        method_plain=(
            "Real check: for every object JPL identified, its published taxonomy class (SMASSII "
            "spec_B preferred, else Tholen spec_T, from JPL's Small-Body Database) is reduced to "
            "its complex and compared with our best complex. Simulated check: every Bus-DeMeo "
            "class mean, varied within its class spread, is sampled at each real object's bands "
            "with that object's real errors, and classified the same way."
        ),
    )


# ---------------------------------------------------------------------------- truth (CI only)

SBDB_API = "https://ssd-api.jpl.nasa.gov/sbdb.api"


def fetch_truth(worker: str, out_path: Path) -> dict:
    """Published taxonomy of every object the live Worker reports as JPL-identified.

    Reads ``{worker}/api/objects?dedupe=false`` for designations, then asks JPL SBDB for each
    one's ``spec_B`` and ``spec_T`` physical parameters. Runs in GitHub Actions
    (``composition.yml``); nothing is written for objects SBDB does not answer for."""
    import time
    import urllib.parse

    import httpx

    from .triage import _jpl_search_string, sbdb_url

    with httpx.Client(
        timeout=60, follow_redirects=True, headers={"accept": "application/json"}
    ) as cl:
        listing = cl.get(f"{worker.rstrip('/')}/api/objects", params={"dedupe": "false"})
        listing.raise_for_status()
        objs = listing.json()["objects"]
        ident = [
            o for o in objs
            if o.get("known_object_matched") and o.get("known_object_designation")
            and o.get("classification") != "injected"
        ]  # fmt: skip
        rows, failed = [], []
        for o in ident:
            sstr = _jpl_search_string(o["known_object_designation"])
            url = f"{SBDB_API}?sstr={urllib.parse.quote(sstr)}&phys-par=1"
            try:
                resp = cl.get(url)
                resp.raise_for_status()
                doc = resp.json()
            except (httpx.HTTPError, ValueError) as err:
                failed.append({"object_id": o["object_id"], "error": str(err)[:200]})
                continue
            phys = {p.get("name"): p.get("value") for p in doc.get("phys_par") or []}
            rows.append(
                {
                    "object_id": o["object_id"],
                    "designation": o["known_object_designation"],
                    "spec_B": phys.get("spec_B") or None,
                    "spec_T": phys.get("spec_T") or None,
                    "sbdb_url": sbdb_url(o["known_object_designation"]),
                }
            )
            time.sleep(0.5)  # be gentle with JPL
    doc = {
        "source": "JPL SBDB API (ssd-api.jpl.nasa.gov/sbdb.api, phys-par: spec_B, spec_T) for objects "
        f"{worker.rstrip('/')}/api/objects reports as JPL-identified",
        "query_utc": _now(),
        "n_objects_listed": len(objs),
        "n_identified": len(ident),
        "failed": failed,
        "rows": rows,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, indent=1) + "\n")
    return doc


def _cmd_truth(args) -> int:
    from .build import DEFAULT_OUT

    out = (Path(args.out) if args.out else DEFAULT_OUT) / TRUTH_PATH
    doc = fetch_truth(args.worker, out)
    n_tax = sum(bool(r["spec_B"] or r["spec_T"]) for r in doc["rows"])
    print(
        f"truth: {doc['n_identified']} JPL-identified of {doc['n_objects_listed']}; "
        f"{len(doc['rows'])} answered by SBDB, {n_tax} with a published class, {len(doc['failed'])} failed"
    )
    return 0


# ---------------------------------------------------------------------------- CLI


def _cmd_composition(args) -> int:
    from .build import DEFAULT_OUT
    from .version import pipeline_version

    out = Path(args.out) if args.out else DEFAULT_OUT
    counts = run(out, pipeline_version(require_clean=True))
    print(f"composition: {sum(counts.values())} objects {dict(sorted(counts.items()))}")
    return 0


def _cmd_validate(args) -> int:
    from .build import DEFAULT_OUT
    from .version import pipeline_version

    out = Path(args.out) if args.out else DEFAULT_OUT
    doc = validate(
        out, pipeline_version(require_clean=True), Path(args.truth) if args.truth else None
    )
    path = out / VALIDATION_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(doc.model_dump_json(indent=2) + "\n")
    o = doc.overall
    print(
        f"composition validation: {doc.n_classified}/{doc.n_objects} classified; "
        f"{doc.n_identified} JPL-identified, {doc.n_with_taxonomy} with a published class, "
        f"{doc.n_compared} compared; complex agreement {o.complex_agreement} "
        f"(broad {o.broad_agreement}; always-S baseline {doc.baseline_always_s})"
    )
    for r in doc.simulated_recovery:
        print(f"  simulated {r.confidence:6s} n={r.n:5d} complex recovered {r.complex_recovered}")
    return 0


def add_cli(sub) -> None:
    """Register `composition` and `composition-validate` on the spherex-px parser."""
    c = sub.add_parser("composition", help="indicative composition for every published object")
    c.add_argument("--out")
    c.set_defaults(func=_cmd_composition)
    v = sub.add_parser(
        "composition-validate", help="compare compositions with JPL taxonomies and simulations"
    )
    v.add_argument("--out")
    v.add_argument("--truth", help="composition_truth.json (default: data/validation/)")
    v.set_defaults(func=_cmd_validate)
    t = sub.add_parser(
        "composition-truth", help="fetch JPL SBDB taxonomies of JPL-identified objects (network)"
    )
    t.add_argument("--worker", default="https://spherex-planet-x.bodhishanbhag.workers.dev")
    t.add_argument("--out")
    t.set_defaults(func=_cmd_truth)
