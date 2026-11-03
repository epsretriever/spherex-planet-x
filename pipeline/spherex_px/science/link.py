"""Link per-exposure detections into moving-object candidates.

SPHEREx revisits a field in clusters: a few exposures within minutes (the SWIR and MWIR
detectors see the same sky simultaneously), then again hours later. The linker:

1. groups exposures into clusters separated by more than CLUSTER_GAP_HOURS;
2. merges detections inside each cluster into sightings, requiring at least two exposures
   (a cosmic ray or hot pixel does not repeat in a second exposure or detector);
3. drops static sightings: anything seen at the same position in another cluster, or with
   forced-photometry S/N >= 4 at that position, combined over another cluster's exposures;
4. links the remaining sightings across clusters with constant-rate motion;
5. fits each track with a linear model and with linear motion plus SPHEREx's orbital
   parallax (spacecraft positions come from the FITS headers), keeping the parallax model
   only when it improves the fit significantly.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field

import numpy as np
from scipy import stats

from .detect import Detections, Prepared, measure
from .grid import angular_sep_arcsec, tangent_offsets_arcsec

AU_KM = 149_597_870.7
CLUSTER_GAP_HOURS = 0.5


@dataclass(frozen=True)
class LinkParams:
    sighting_radius_arcsec: float = 9.0
    static_radius_arcsec: float = 9.0
    static_forced_snr: float = 4.0  # combined over a cluster's exposures
    static_min_fraction: float = 0.0  # 0: static if seen in any other covering visit
    min_sighting_exposures: int = 2
    min_rate_arcsec_per_hr: float = 0.5
    max_rate_arcsec_per_hr: float = 250.0
    link_tolerance_arcsec: float = 18.0
    min_track_clusters: int = 3
    pair_min_snr: float = 7.0
    max_fit_rms_arcsec: float = 6.0


@dataclass
class EpochData:
    epoch_id: str
    mjd: float
    prep: Prepared
    det: Detections
    sc_km: np.ndarray  # spacecraft geocentric position, km (ICRF axes)
    cluster: int = -1


@dataclass
class Sighting:
    cluster: int
    members: list[tuple[int, int]]  # (epoch index, detection index)
    mjd: float
    ra: float
    dec: float
    snr: float
    id: int = -1


@dataclass
class MotionFit:
    model: str  # "linear" | "parallax" | "none"
    t0_mjd: float
    params: np.ndarray
    cov: np.ndarray | None
    chi2: float
    dof: int
    rms_arcsec: float
    rate_arcsec_per_hr: float | None
    rate_err_arcsec_per_hr: float | None
    pa_deg: float | None
    vxi: float | None  # arcsec/hr, east
    veta: float | None  # arcsec/hr, north
    pvalue: float | None
    distance_au: tuple[float, float, float] | None = None  # best, lo, hi


@dataclass
class Track:
    sightings: list[Sighting]
    members: list[tuple[int, int]] = field(default_factory=list)
    fit: MotionFit | None = None
    kind: str = "track"  # "track" | "pair"


def assign_clusters(epochs: list[EpochData], gap_hours: float = CLUSTER_GAP_HOURS) -> int:
    order = sorted(range(len(epochs)), key=lambda i: epochs[i].mjd)
    cluster = -1
    last = None
    for i in order:
        if last is None or (epochs[i].mjd - last) * 24 > gap_hours:
            cluster += 1
        epochs[i].cluster = cluster
        last = epochs[i].mjd
    return cluster + 1


def build_sightings(epochs: list[EpochData], params: LinkParams) -> list[Sighting]:
    sightings: list[Sighting] = []
    for c in sorted({e.cluster for e in epochs}):
        idx = [i for i, e in enumerate(epochs) if e.cluster == c]
        pts = [(i, j) for i in idx for j in range(len(epochs[i].det))]
        if not pts:
            continue
        ra = np.array([epochs[i].det.ra[j] for i, j in pts])
        dec = np.array([epochs[i].det.dec[j] for i, j in pts])
        snr = np.array([epochs[i].det.snr[j] for i, j in pts])
        # friends-of-friends grouping by brightness order
        unused = np.ones(len(pts), bool)
        for k in np.argsort(-snr):
            if not unused[k]:
                continue
            sep = angular_sep_arcsec(ra[k], dec[k], ra, dec)
            grp = np.where(unused & (sep <= params.sighting_radius_arcsec))[0]
            # keep at most one detection per exposure (the closest)
            best: dict[int, int] = {}
            for g in grp:
                ei = pts[g][0]
                if ei not in best or sep[g] < sep[best[ei]]:
                    best[ei] = g
            grp = np.array(sorted(best.values()))
            unused[grp] = False
            if len(grp) < params.min_sighting_exposures:
                continue
            w = np.clip(snr[grp], 1, None) ** 2
            sightings.append(
                Sighting(
                    cluster=c,
                    members=[pts[g] for g in grp],
                    mjd=float(np.mean([epochs[pts[g][0]].mjd for g in grp])),
                    ra=float(np.average(ra[grp], weights=w)),
                    dec=float(np.average(dec[grp], weights=w)),
                    snr=float(np.sqrt((snr[grp] ** 2).sum())),
                )
            )
    for i, s in enumerate(sightings):
        s.id = i
    return sightings


def _covered(prep: Prepared, ra: float, dec: float, margin: float = 3) -> tuple[bool, float, float]:
    x, y = prep.cutout.wcs.all_world2pix([ra], [dec], 0)
    x, y = float(x[0]), float(y[0])
    ny, nx = prep.sci.shape
    if not (margin <= x < nx - margin and margin <= y < ny - margin):
        return False, x, y
    if prep.bad[int(round(y)), int(round(x))]:
        return False, x, y
    return True, x, y


def find_transients(
    epochs: list[EpochData], sightings: list[Sighting], params: LinkParams
) -> list[Sighting]:
    """Sightings that are not static.

    A sighting is static when something is at its position (a sighting within
    static_radius_arcsec, or combined forced-photometry S/N >= static_forced_snr) in at least
    static_min_fraction of the other visits that cover that position. With fraction 0 a single
    such visit is enough. A fraction rule keeps slow movers: an object moving a few arcsec per
    hour overlaps its own position in a visit 1-2 hours away, but not in the visits a day apart.
    """
    by_cluster: dict[int, list[Sighting]] = {}
    for s in sightings:
        by_cluster.setdefault(s.cluster, []).append(s)
    covering: dict[int, list[EpochData]] = {}
    for e in epochs:
        covering.setdefault(e.cluster, []).append(e)
    clusters = sorted(set(by_cluster) | set(covering))
    if not sightings:
        return []
    ra = np.array([s.ra for s in sightings])
    dec = np.array([s.dec for s in sightings])
    own = np.array([s.cluster for s in sightings])
    # matched[k, c]: another sighting within static_radius in cluster c (vectorized per cluster)
    from scipy.spatial import cKDTree

    def unit(r, d):
        r, d = np.radians(r), np.radians(d)
        return np.column_stack([np.cos(d) * np.cos(r), np.cos(d) * np.sin(r), np.sin(d)])

    xyz = unit(ra, dec)
    # chord length for static_radius (plus a hair so the <= test matches the angular one)
    chord = 2 * math.sin(math.radians(params.static_radius_arcsec / 3600) / 2) * (1 + 1e-9)
    matched: dict[int, np.ndarray] = {}
    for c in clusters:
        others = [k for k in range(len(sightings)) if own[k] == c]
        m = np.zeros(len(sightings), bool)
        if others:
            dist, _ = cKDTree(xyz[others]).query(xyz, k=1, distance_upper_bound=chord)
            m = np.isfinite(dist) & (own != c)
        matched[c] = m
    first_pass = params.static_min_fraction <= 0
    already = np.zeros(len(sightings), bool)
    if first_pass:
        for c in clusters:
            already |= matched[c]
    # Forced photometry, one batched measure() per exposure (it processes the whole cutout,
    # so a call per position would cost the cutout's size each time).
    snr_sum: dict[tuple[int, int], list[float]] = {}
    for e in epochs:
        ks = [k for k in range(len(sightings)) if own[k] != e.cluster and not already[k]]
        if not ks:
            continue
        xs, ys, kept = [], [], []
        for k in ks:
            ok, x, y = _covered(e.prep, float(ra[k]), float(dec[k]))
            if ok:
                xs.append(x)
                ys.append(y)
                kept.append(k)
        if not kept:
            continue
        snrs = measure(e.prep, np.array(xs), np.array(ys)).snr
        for k, v in zip(kept, snrs, strict=True):
            snr_sum.setdefault((k, e.cluster), []).append(float(v))
    out = []
    for k, s in enumerate(sightings):
        if already[k]:
            continue
        n_cov = n_static = 0
        for c in clusters:
            if c == s.cluster:
                continue
            snrs = snr_sum.get((k, c), [])
            m = bool(matched[c][k])
            if not snrs and not m:
                continue  # this visit doesn't cover the position
            n_cov += 1
            if m or (snrs and sum(snrs) / math.sqrt(len(snrs)) >= params.static_forced_snr):
                n_static += 1
                if first_pass:
                    break
        if n_cov == 0:
            continue
        frac = n_static / n_cov
        static = n_static > 0 if first_pass else frac >= params.static_min_fraction
        if not static:
            out.append(s)
    return out


def _parallax_basis(sc_km: np.ndarray, ra0: float, dec0: float) -> np.ndarray:
    """Tangent-plane (east, north) displacement in arcsec for an object at 1 AU.

    An observer displaced by r (geocentric) sees an object at distance D shifted by
    -(r_perp)/D, where r_perp is r projected onto the sky plane.
    """
    a, d = math.radians(ra0), math.radians(dec0)
    e_east = np.array([-math.sin(a), math.cos(a), 0.0])
    e_north = np.array([-math.sin(d) * math.cos(a), -math.sin(d) * math.sin(a), math.cos(d)])
    r_au = np.atleast_2d(sc_km) / AU_KM
    k = 180 / math.pi * 3600
    return np.column_stack([-(r_au @ e_east) * k, -(r_au @ e_north) * k])


def fit_motion(
    t_mjd: np.ndarray,
    ra: np.ndarray,
    dec: np.ndarray,
    sigma_arcsec: np.ndarray,
    sc_km: np.ndarray | None = None,
    allow_parallax: bool = True,
) -> MotionFit:
    ra0, dec0 = float(np.median(ra)), float(np.median(dec))
    xi, eta = tangent_offsets_arcsec(ra, dec, ra0, dec0)
    t0 = float(np.mean(t_mjd))
    th = (np.asarray(t_mjd) - t0) * 24.0
    n = len(th)
    if n < 2 or np.ptp(th) <= 0:
        return MotionFit(
            "none", t0, np.zeros(2), None, 0.0, 0, 0.0, None, None, None, None, None, None
        )
    w = 1.0 / np.asarray(sigma_arcsec) ** 2
    y = np.concatenate([xi, eta])
    W = np.concatenate([w, w])

    def solve(A: np.ndarray):
        Aw = A * W[:, None]
        cov = np.linalg.pinv(A.T @ Aw)
        p = cov @ (Aw.T @ y)
        r = y - A @ p
        return p, cov, float((r**2 * W).sum()), r

    z = np.zeros(n)
    one = np.ones(n)
    A_lin = np.column_stack(
        [
            np.concatenate([one, z]),
            np.concatenate([z, one]),
            np.concatenate([th, z]),
            np.concatenate([z, th]),
        ]
    )
    p, cov, chi2, r = solve(A_lin)
    best = ("linear", p, cov, chi2, r, 4)
    if allow_parallax and sc_km is not None and n >= 4:
        basis = _parallax_basis(sc_km, ra0, dec0)
        A_par = np.column_stack([A_lin, np.concatenate([basis[:, 0], basis[:, 1]])])
        p2, cov2, chi2_2, r2 = solve(A_par)
        dof2 = 2 * n - 5
        # F-test for the extra parameter, and require a physical (positive) inverse distance
        if dof2 > 0 and p2[4] > 0 and chi2_2 < chi2:
            f = (chi2 - chi2_2) / (chi2_2 / dof2) if chi2_2 > 0 else np.inf
            if stats.f.sf(f, 1, dof2) < 0.01 and p2[4] > 3 * math.sqrt(max(cov2[4, 4], 0)):
                best = ("parallax", p2, cov2, chi2_2, r2, 5)
    model, p, cov, chi2, r, k = best
    dof = 2 * n - k
    vxi, veta = float(p[2]), float(p[3])
    rate = math.hypot(vxi, veta)
    if rate > 0:
        g = np.array([vxi / rate, veta / rate])
        rate_err = float(math.sqrt(max(g @ cov[2:4, 2:4] @ g, 0)))
    else:
        rate_err = float(math.sqrt(max(cov[2, 2], 0)))
    pa = math.degrees(math.atan2(vxi, veta)) % 360
    rms = float(np.sqrt(np.mean(r[:n] ** 2 + r[n:] ** 2)))
    pval = float(stats.chi2.sf(chi2, dof)) if dof > 0 else None
    dist = None
    if model == "parallax":
        inv, s = float(p[4]), math.sqrt(max(cov[4, 4], 0))
        lo_inv, hi_inv = inv + 2 * s, max(inv - 2 * s, 1e-6)
        dist = (1 / inv, 1 / lo_inv, 1 / hi_inv)
    return MotionFit(model, t0, p, cov, chi2, dof, rms, rate, rate_err, pa, vxi, veta, pval, dist)


def predict(fit: MotionFit, ra_ref: float, dec_ref: float, t_mjd: float) -> tuple[float, float]:
    from .grid import tangent_to_world

    th = (t_mjd - fit.t0_mjd) * 24
    xi = fit.params[0] + fit.params[2] * th
    eta = fit.params[1] + fit.params[3] * th
    ra, dec = tangent_to_world([xi], [eta], ra_ref, dec_ref)
    return float(ra[0]), float(dec[0])


def link_tracks(
    epochs: list[EpochData], transients: list[Sighting], params: LinkParams
) -> list[Track]:
    """Constant-rate linking across clusters, then greedy exclusive assignment."""
    if not transients:
        return []
    ra0 = float(np.median([s.ra for s in transients]))
    dec0 = float(np.median([s.dec for s in transients]))
    xi, eta = tangent_offsets_arcsec(
        [s.ra for s in transients], [s.dec for s in transients], ra0, dec0
    )
    t = np.array([s.mjd for s in transients])
    cl = np.array([s.cluster for s in transients])
    candidates: list[tuple[int, float, list[int]]] = []
    for a, b in itertools.combinations(range(len(transients)), 2):
        if cl[a] == cl[b]:
            continue
        if t[b] < t[a]:
            a, b = b, a
        dt_h = (t[b] - t[a]) * 24
        vx, vy = (xi[b] - xi[a]) / dt_h, (eta[b] - eta[a]) / dt_h
        rate = math.hypot(vx, vy)
        if not params.min_rate_arcsec_per_hr <= rate <= params.max_rate_arcsec_per_hr:
            continue
        members = {cl[a]: a, cl[b]: b}
        for k in range(len(transients)):
            if cl[k] in members:
                continue
            dth = (t[k] - t[a]) * 24
            px, py = xi[a] + vx * dth, eta[a] + vy * dth
            d = math.hypot(xi[k] - px, eta[k] - py)
            if d <= params.link_tolerance_arcsec:
                prev = members.get(cl[k])
                if prev is None:
                    members[cl[k]] = k
        if len(members) >= 2:
            idx = sorted(members.values(), key=lambda i: t[i])
            candidates.append((len(idx), -sum(transients[i].snr for i in idx), idx))
    candidates.sort(key=lambda c: (-c[0], c[1]))
    used: set[int] = set()
    tracks: list[Track] = []
    for n, _, idx in candidates:
        if any(i in used for i in idx):
            continue
        sights = [transients[i] for i in idx]
        if n >= params.min_track_clusters:
            tr = Track(sights, kind="track")
        else:
            if min(s.snr for s in sights) < params.pair_min_snr:
                continue
            tr = Track(sights, kind="pair")
        tr.members = [m for s in sights for m in s.members]
        tr.fit = fit_track(epochs, tr)
        if tr.kind == "track" and tr.fit.rms_arcsec > params.max_fit_rms_arcsec:
            continue
        used.update(idx)
        tracks.append(tr)
    # A pair is only reported if no other covering cluster contradicts it (predicted position
    # covered but nothing there).
    out = []
    for tr in tracks:
        if tr.kind == "pair" and _pair_contradicted(epochs, tr):
            continue
        out.append(tr)
    return out


def track_arrays(epochs: list[EpochData], members: list[tuple[int, int]]):
    t = np.array([epochs[i].mjd for i, _ in members])
    ra = np.array([epochs[i].det.ra[j] for i, j in members])
    dec = np.array([epochs[i].det.dec[j] for i, j in members])
    sig = np.array([epochs[i].det.pos_err_arcsec[j] for i, j in members])
    sc = np.array([epochs[i].sc_km for i, _ in members])
    return t, ra, dec, sig, sc


def fit_track(epochs: list[EpochData], tr: Track) -> MotionFit:
    t, ra, dec, sig, sc = track_arrays(epochs, tr.members)
    return fit_motion(t, ra, dec, sig, sc, allow_parallax=tr.kind == "track")


def _pair_contradicted(epochs: list[EpochData], tr: Track) -> bool:
    fit = tr.fit
    if fit is None or fit.model == "none":
        return True
    _, ra, dec, _, _ = track_arrays(epochs, tr.members)
    ra_ref, dec_ref = float(np.median(ra)), float(np.median(dec))
    own = {s.cluster for s in tr.sightings}
    for e in epochs:
        if e.cluster in own:
            continue
        pra, pdec = predict(fit, ra_ref, dec_ref, e.mjd)
        ok, x, y = _covered(e.prep, pra, pdec, margin=5)
        if not ok:
            continue
        m = measure(e.prep, np.array([x]), np.array([y]))
        if m.snr[0] < 3:
            return True
    return False
