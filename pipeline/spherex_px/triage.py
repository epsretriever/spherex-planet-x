"""Triage: check every new candidate against JPL in the survey pipeline, then spend effort
only where it matters.

Runs in CI after a survey run (``spherex-px triage``), never in the Worker's request path. For
each candidate whose ``known_object`` has not been checked yet it asks JPL SBIdent which
catalogued small bodies were near the detections (one query per SPHEREx visit, with SPHEREx's
own position as the observer) and refines the closest few with Horizons, exactly as the Worker
does (worker/src/enrich.ts, same radii and rules). Then:

- **Known** (one catalogued object explains every detection within 15"): the candidate keeps a
  minimal record: detections, motion, spectrum points, the JPL match, a thumbnail and links to
  JPL's Small-Body Database and Horizons for the orbit and ephemerides. Its per-detection
  stamps and our own orbit products are deleted (a small validation sample keeps its orbit,
  so our orbits stay compared with JPL's). ``record_level: "minimal"``.
- **Unexplained** (JPL answered, nothing matched): keeps the full record (stamps, orbit,
  prediction, clones, spectrum, vetting) so we can judge whether it is real and new.
- **Not checked** (JPL did not answer): stays pending; the next triage or the Worker's cron
  retries it. Nothing is deleted.

Results are written into the candidate files with ``enrichment: "pipeline"``; the Worker treats
a pipeline match as final and only re-checks unexplained and unchecked candidates.
"""

from __future__ import annotations

import logging
import math
import statistics
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from . import schemas as S
from .data.http import UpstreamError, request
from .settings import get_settings

log = logging.getLogger(__name__)

MATCH_RADIUS_ARCSEC = 15.0
PREFILTER_ARCSEC = 120.0
MAX_HORIZONS_OBJECTS = 3
MAX_SBIDENT_QUERIES = 6
VISIT_GAP_HOURS = 1.0
MIN_ANSWERED_VISITS = 2
SBIDENT_HWIDTH_DEG = 0.1
AU_KM = 149_597_870.7
#: Known objects that keep our own orbit fit, so orbits stay validated against JPL's.
ORBIT_VALIDATION_SAMPLE = 60

SBIDENT = "JPL SBIdent"
HORIZONS = "JPL Horizons"
SBIDENT_OBSERVER = (
    "SPHEREx (spacecraft position from the FITS headers, sent to JPL SBIdent as xobs)"
)
HORIZONS_OBSERVER = (
    "SPHEREx (geocentric JPL predictions corrected with the spacecraft position from the FITS "
    "headers)"
)


# ----------------------------------------------------------------------------- JPL clients


def _pad(n: int, w: int = 2) -> str:
    return str(n).zfill(w)


def ra_to_sbident(ra_deg: float) -> str:
    s = (ra_deg % 360) / 15 * 3600
    s = round(s * 100) / 100
    if s >= 86400:
        s -= 86400
    h = int(s // 3600)
    m = int((s - h * 3600) // 60)
    sec = s - h * 3600 - m * 60
    return f"{_pad(h)}-{_pad(m)}-{sec:05.2f}"


def dec_to_sbident(dec_deg: float) -> str:
    sign = "M" if dec_deg < 0 else ""
    s = round(abs(dec_deg) * 3600 * 10) / 10
    d = int(s // 3600)
    s -= d * 3600
    m = int(s // 60)
    sec = s - m * 60
    return f"{sign}{_pad(d)}-{_pad(m)}-{sec:04.1f}"


def time_to_sbident(iso: str) -> str:
    t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if t.tzinfo is None:
        t = t.replace(tzinfo=UTC)
    t = t.astimezone(UTC)
    return t.strftime("%Y-%m-%d_%H:%M:%S")


def sbident_url(time_utc: str, ra: float, dec: float, xobs: list[float] | None) -> str:
    usable = xobs and len(xobs) == 3 and all(math.isfinite(v) for v in xobs) and any(xobs)
    observer = (
        {"xobs": ",".join(f"{v:.3f}" for v in xobs)}
        if usable
        else {"lat": "0", "lon": "0", "alt": "0"}
    )
    q = {
        **observer,
        "obs-time": time_to_sbident(time_utc),
        "fov-ra-center": ra_to_sbident(ra),
        "fov-dec-center": dec_to_sbident(dec),
        "fov-ra-hwidth": str(SBIDENT_HWIDTH_DEG),
        "fov-dec-hwidth": str(SBIDENT_HWIDTH_DEG),
        "two-pass": "false",
    }
    return f"{get_settings().sbident_url}?{urllib.parse.urlencode(q)}"


def _parse_ra(v) -> float | None:
    if isinstance(v, int | float):
        return float(v)
    if not isinstance(v, str):
        return None
    import re

    parts = [p for p in re.split(r"[\s:hms]+", v.strip()) if p]
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        return None
    if len(nums) == 1:
        return nums[0]
    if len(nums) < 2:
        return None
    h, m, s = nums[0], nums[1], nums[2] if len(nums) > 2 else 0.0
    return (h + m / 60 + s / 3600) * 15


def _parse_dec(v) -> float | None:
    if isinstance(v, int | float):
        return float(v)
    if not isinstance(v, str):
        return None
    import re

    t = v.strip()
    sign = 1.0
    if t[:1] in ("-", "M"):
        sign, t = -1.0, t[1:]
    elif t[:1] == "+":
        t = t[1:]
    parts = [p for p in re.split(r"[\s:°'\"dms-]+", t) if p]
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        return None
    if len(nums) == 1:
        return sign * nums[0]
    if len(nums) < 2:
        return None
    d, m, s = nums[0], nums[1], nums[2] if len(nums) > 2 else 0.0
    return sign * (d + m / 60 + s / 3600)


@dataclass
class SbObject:
    name: str
    ra_deg: float
    dec_deg: float
    vmag: float | None


def parse_sbident(body) -> list[SbObject]:
    import re

    if not isinstance(body, dict):
        return []
    fields = body.get("fields_second") or body.get("fields_first")
    rows = body.get("data_second_pass") or body.get("data_first_pass")
    if not isinstance(fields, list) or not isinstance(rows, list):
        return []
    names = [str(f).lower() for f in fields]

    def col(rx: str) -> int:
        for i, n in enumerate(names):
            if re.search(rx, n):
                return i
        return -1

    i_name = col(r"object")
    i_ra = col(r"^(astrometric\s+)?ra\b(?!.*(rate|dist|err))")
    i_dec = col(r"^(astrometric\s+)?dec\b(?!.*(rate|dist|err))")
    i_v = col(r"magnitude|vmag|\bv\b")
    if min(i_name, i_ra, i_dec) < 0:
        return []
    out = []
    for r in rows:
        if not isinstance(r, list):
            continue
        ra, dec = _parse_ra(r[i_ra]), _parse_dec(r[i_dec])
        if ra is None or dec is None:
            continue
        try:
            v = float(str(r[i_v])) if i_v >= 0 else math.nan
        except ValueError:
            v = math.nan
        out.append(SbObject(str(r[i_name]).strip(), ra, dec, v if math.isfinite(v) else None))
    return out


def horizons_command(name: str) -> str:
    import re

    n = name.strip()
    if re.fullmatch(r"\([^()]*\)", n):
        n = n[1:-1].strip()
    prov = re.match(r"^\d{4} [A-Z]{1,2}\d*\b", n)
    if prov:
        return f"'DES={prov.group(0)};'"
    num = re.match(r"^(\d+)(\s|$)", n) or re.match(r"^\((\d+)\)", n)
    if num:
        return f"'{num.group(1)};'"
    des = re.sub(r"\s+\([^)]*\)\s*$", "", n).strip() or n
    return f"'DES={des};'"


def horizons_url(name: str, mjds: list[float]) -> str:
    q = {
        "format": "json",
        "COMMAND": horizons_command(name),
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": "'500@399'",
        "TLIST": " ".join(f"'{m + 2400000.5:.6f}'" for m in mjds),
        "TLIST_TYPE": "JD",
        "TIME_TYPE": "UT",
        "QUANTITIES": "'1,20'",
        "ANG_FORMAT": "DEG",
        "CSV_FORMAT": "YES",
        "EXTRA_PREC": "YES",
    }
    return f"{get_settings().horizons_url}?{urllib.parse.urlencode(q)}"


def parse_horizons(body) -> list[tuple[float, float, float, float]]:
    """(jd, ra, dec, delta_au) rows between $$SOE and $$EOE."""
    import re

    text = body.get("result") if isinstance(body, dict) else body
    if not isinstance(text, str):
        return []
    soe, eoe = text.find("$$SOE"), text.find("$$EOE")
    if soe < 0 or eoe < soe:
        return []
    out = []
    for line in text[soe + 5 : eoe].split("\n"):
        cells = [c.strip() for c in line.split(",")]
        if len(cells) < 4:
            continue
        try:
            jd = float(cells[0])
        except ValueError:
            continue
        nums = [float(c) for c in cells[1:] if c and re.match(r"^[-+]?\d", c)]
        if len(nums) < 3:
            continue
        out.append((jd, nums[0], nums[1], nums[2]))
    return out


def topocentric(ra: float, dec: float, delta_au: float, sc_km) -> tuple[float, float]:
    r, d = math.radians(ra), math.radians(dec)
    dist = delta_au * AU_KM
    x = dist * math.cos(d) * math.cos(r) - (sc_km[0] if sc_km else 0)
    y = dist * math.cos(d) * math.sin(r) - (sc_km[1] if sc_km else 0)
    z = dist * math.sin(d) - (sc_km[2] if sc_km else 0)
    n = math.sqrt(x * x + y * y + z * z)
    return math.degrees(math.atan2(y, x)) % 360, math.degrees(math.asin(z / n))


def sep_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    a1, d1, a2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    s = math.sin((d2 - d1) / 2) ** 2 + math.cos(d1) * math.cos(d2) * math.sin((a2 - a1) / 2) ** 2
    return math.degrees(2 * math.asin(math.sqrt(min(1.0, max(0.0, s))))) * 3600


def _get_json(url: str):
    resp = request("GET", url)
    if resp.status_code != 200:
        raise UpstreamError(f"HTTP {resp.status_code}")
    try:
        return resp.json()
    except ValueError as err:
        raise UpstreamError(f"not JSON: {err}") from err


def sbdb_url(designation: str) -> str:
    return "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=" + urllib.parse.quote(
        _jpl_search_string(designation)
    )


def horizons_app_url(designation: str) -> str:
    return "https://ssd.jpl.nasa.gov/horizons/app.html#/?sstr=" + urllib.parse.quote(
        _jpl_search_string(designation)
    )


def _jpl_search_string(designation: str) -> str:
    """'433 Eros (A898 PA)' -> '433'; '(2019 AB12)' -> '2019 AB12'."""
    import re

    n = designation.strip()
    if re.fullmatch(r"\([^()]*\)", n):
        n = n[1:-1].strip()
    num = re.match(r"^(\d+)(\s|$)", n)
    if num:
        return num.group(1)
    return re.sub(r"\s+\([^)]*\)\s*$", "", n).strip() or n


# ----------------------------------------------------------------------------- matching


def sbident_sample(dets: list[S.Detection], max_n: int = MAX_SBIDENT_QUERIES) -> list[S.Detection]:
    s = sorted(dets, key=lambda d: d.mjd)
    visits: list[list[S.Detection]] = []
    for d in s:
        if visits and (d.mjd - visits[-1][-1].mjd) * 24 < VISIT_GAP_HOURS:
            visits[-1].append(d)
        else:
            visits.append([d])
    reps = [v[len(v) // 2] for v in visits]
    if len(reps) <= max_n:
        return reps
    return [reps[round(i * (len(reps) - 1) / (max_n - 1))] for i in range(max_n)]


def _not_checked(reason: str, now: str) -> S.KnownObject:
    return S.KnownObject(
        checked=False,
        not_checked_reason=reason,
        matched=False,
        catalogs_checked=[],
        search_radius_arcsec=MATCH_RADIUS_ARCSEC,
        query_utc=now,
        enrichment="pipeline",
    )


def check_candidate(c: S.CandidateDetail, now: str) -> S.KnownObject:
    """The Worker's known-object check (worker/src/enrich.ts), run in the pipeline."""
    dets = c.detections
    if not dets:
        return _not_checked("No detections to check.", now)
    sample = sbident_sample(dets)
    answered: list[tuple[S.Detection, list[SbObject]]] = []
    failures: list[str] = []
    for d in sample:
        try:
            body = _get_json(
                sbident_url(d.time_utc, d.ra_deg, d.dec_deg, d.spacecraft_geocentric_km)
            )
            answered.append((d, parse_sbident(body)))
        except UpstreamError as err:
            failures.append(str(err))
    if len(answered) < min(MIN_ANSWERED_VISITS, len(sample)):
        return _not_checked(
            f"JPL SBIdent did not answer for {len(failures)} of {len(sample)} visits "
            f"({failures[0] if failures else 'no answer'}).",
            now,
        )
    stats: dict[str, dict] = {}
    for d, objs in answered:
        for o in objs:
            st = stats.setdefault(o.name, {"count": 0, "seps": [], "vmag": o.vmag})
            st["count"] += 1
            st["seps"].append(sep_arcsec(d.ra_deg, d.dec_deg, o.ra_deg, o.dec_deg))
    ranked = sorted(
        (
            {"name": k, "count": v["count"], "med": statistics.median(v["seps"]), "vmag": v["vmag"]}
            for k, v in stats.items()
        ),
        key=lambda r: (-r["count"], r["med"]),
    )
    base = dict(
        checked=True,
        not_checked_reason=None,
        search_radius_arcsec=MATCH_RADIUS_ARCSEC,
        query_utc=now,
        enrichment="pipeline",
    )
    if not ranked:
        return S.KnownObject(
            **base, matched=False, catalogs_checked=[SBIDENT], observer=SBIDENT_OBSERVER
        )
    shortlist = [r for r in ranked if r["med"] <= PREFILTER_ARCSEC][:MAX_HORIZONS_OBJECTS]
    horizons_ok = bool(shortlist)
    refined = []
    for obj in shortlist:
        try:
            pts = parse_horizons(_get_json(horizons_url(obj["name"], [d.mjd for d in dets])))
        except UpstreamError:
            horizons_ok = False
            continue
        if len(pts) != len(dets):
            horizons_ok = False
            continue
        per = []
        for d, (_jd, ra, dec, delta) in zip(dets, pts, strict=True):
            tra, tdec = topocentric(ra, dec, delta, d.spacecraft_geocentric_km)
            per.append(
                S.KnownObjectEpoch(
                    epoch_id=d.epoch_id,
                    predicted_ra_deg=round(tra, 6),
                    predicted_dec_deg=round(tdec, 6),
                    separation_arcsec=round(sep_arcsec(d.ra_deg, d.dec_deg, tra, tdec), 2),
                )
            )
        seps = [p.separation_arcsec for p in per]
        refined.append(
            {
                "name": obj["name"],
                "vmag": obj["vmag"],
                "per": per,
                "max": max(seps),
                "med": statistics.median(seps),
            }
        )
    catalogs = [SBIDENT] + ([HORIZONS] if refined else [])
    refined.sort(key=lambda r: r["max"])
    best = refined[0] if refined else None
    if best and best["max"] <= MATCH_RADIUS_ARCSEC:
        return S.KnownObject(
            **base,
            matched=True,
            catalogs_checked=catalogs,
            designation=best["name"],
            predicted_vmag=best["vmag"],
            per_epoch=best["per"],
            observer=HORIZONS_OBSERVER,
            jpl_links=S.JplLinks(
                sbdb_url=sbdb_url(best["name"]), horizons_url=horizons_app_url(best["name"])
            ),
        )
    if not horizons_ok and len(shortlist) > len(refined):
        return _not_checked(
            f"JPL Horizons did not answer for {shortlist[0]['name']}, the closest known object "
            f"(about {round(shortlist[0]['med'])}″ away in JPL's quick search).",
            now,
        )
    nearest = (
        S.NearestKnown(designation=best["name"], separation_arcsec=round(best["med"], 1))
        if best
        else S.NearestKnown(
            designation=ranked[0]["name"], separation_arcsec=round(ranked[0]["med"], 1)
        )
    )
    return S.KnownObject(
        **base,
        matched=False,
        catalogs_checked=catalogs,
        nearest=nearest,
        observer=HORIZONS_OBSERVER
        if refined
        else SBIDENT_OBSERVER
        if horizons_ok
        else f"{SBIDENT_OBSERVER}; JPL Horizons refinement unavailable",
    )


# ----------------------------------------------------------------------------- records


def _labels(c: S.CandidateDetail) -> None:
    k = c.known_object
    rate = c.motion.rate_arcsec_per_hr
    moving = (
        f"Moves about {rate:.0f} arcseconds per hour across {len(c.detections)} images over "
        f"{c.motion.time_span_hours:.1f} hours."
        if rate is not None
        else f"Seen in {len(c.detections)} images."
    )
    if k.matched:
        c.classification = S.Classification.known_object
        c.label_plain = f"Known: {k.designation}"
        c.summary_plain = (
            f"{moving} JPL identifies it as the catalogued object {k.designation}; its orbit and "
            "ephemerides are in JPL's Small-Body Database and Horizons."
        )
    elif k.checked:
        c.summary_plain = (
            f"{moving} No catalogued asteroid or comet in JPL's databases explains it"
            + (
                f" (the nearest, {k.nearest.designation}, was {k.nearest.separation_arcsec:.0f}″ away)."
                if k.nearest
                else "."
            )
        )


def make_minimal(out_dir: Path, c: S.CandidateDetail, keep_orbit: bool) -> int:
    """Drop a known object's per-detection stamps and (unless kept for validation) our orbit.
    Returns the number of files removed."""
    from .orbits import orbit_path

    removed = 0
    cand_dir = out_dir / "candidates" / c.candidate_id
    for d in c.detections:
        if d.stamp is not None:
            p = cand_dir / Path(d.stamp.url).name
            if p.exists():
                p.unlink()
                removed += 1
            d.stamp = None
    if not keep_orbit:
        p = orbit_path(out_dir, c.candidate_id)
        if p.exists():
            p.unlink()
            removed += 1
    c.record_level = "minimal"
    return removed


@dataclass
class TriageReport:
    checked: int = 0
    matched: int = 0
    unexplained: int = 0
    not_checked: int = 0
    skipped: int = 0
    files_removed: int = 0


def triage(
    out_dir: Path, *, limit: int | None = None, workers: int = 6, recheck_unmatched: bool = False
) -> TriageReport:
    """Check unchecked candidates against JPL and apply the known/unexplained policy."""
    from .build import write_json
    from .orbits import orbit_path

    now = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    paths = sorted((out_dir / "candidates").glob("*.json"))
    cands = [S.CandidateDetail.model_validate_json(p.read_text()) for p in paths]
    rep = TriageReport()
    todo = []
    for c in cands:
        k = c.known_object
        if c.classification == S.Classification.injected:
            continue
        if k.checked and (k.matched or not recheck_unmatched):
            rep.skipped += 1
            continue
        todo.append(c)
    if limit is not None:
        todo = todo[:limit]
    # Known objects that already keep our orbit (validation sample).
    kept_orbits = sum(
        1 for c in cands if c.known_object.matched and orbit_path(out_dir, c.candidate_id).exists()
    )

    def run(c: S.CandidateDetail):
        try:
            return c, check_candidate(c, now)
        except Exception as err:  # one bad candidate must not stop triage
            log.exception("%s: JPL check failed", c.candidate_id)
            return c, _not_checked(f"JPL check failed: {type(err).__name__}", now)

    with ThreadPoolExecutor(workers) as ex:
        results = list(ex.map(run, todo))
    for c, k in results:
        c.known_object = k
        if not k.checked:
            rep.not_checked += 1
            write_json(out_dir / "candidates" / f"{c.candidate_id}.json", c)
            continue
        rep.checked += 1
        _labels(c)
        if k.matched:
            rep.matched += 1
            keep = (
                kept_orbits < ORBIT_VALIDATION_SAMPLE
                and orbit_path(out_dir, c.candidate_id).exists()
            )
            kept_orbits += int(keep)
            rep.files_removed += make_minimal(out_dir, c, keep_orbit=keep)
        else:
            rep.unexplained += 1
        write_json(out_dir / "candidates" / f"{c.candidate_id}.json", c)
    # Keep field pages consistent with their candidates' new classes.
    _refresh_fields(out_dir, {c.candidate_id: c for c, _ in results})
    return rep


def _refresh_fields(out_dir: Path, changed: dict[str, S.CandidateDetail]) -> None:
    from .build import write_json

    by_field: dict[str, list[S.CandidateDetail]] = {}
    for c in changed.values():
        by_field.setdefault(c.field_id, []).append(c)
    for fid, cs in by_field.items():
        p = out_dir / "fields" / f"{fid}.json"
        if not p.exists():
            continue
        f = S.FieldDetail.model_validate_json(p.read_text())
        idx = {c.candidate_id: c for c in cs}
        for m in f.movers:
            c = idx.get(m.candidate_id)
            if c is not None:
                m.classification = c.classification
                m.label_plain = c.label_plain
        write_json(p, f)


def summary_line(rep: TriageReport) -> str:
    return (
        f"JPL triage: {rep.checked} checked ({rep.matched} known, {rep.unexplained} unexplained), "
        f"{rep.not_checked} not checked (JPL did not answer), {rep.skipped} already done; "
        f"{rep.files_removed} files of known objects dropped."
    )
