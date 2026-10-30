"""Blink-pair selection and ranking.

A blink pair is two images of the same field the Explorer flips between. A good default pair
shows the mover jump clearly while staying inside the image, and compares the same wavelength
when possible (SPHEREx's linear variable filters change a star's brightness from image to
image otherwise).

Rules:
- Pairs less than ``MIN_GAP_HOURS`` apart are never offered: SPHEREx takes a short burst of
  exposures (and its dichroic partner detector images the same sky at the same instant), so
  such pairs show essentially no motion.
- For fields with a mover, candidate pairs also include every cross-visit combination of the
  epochs in which the mover was detected, so a pair that shows it is always available.
- At most ``MAX_PAIRS`` are offered, best first; exactly one is marked ``default``.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

MIN_GAP_HOURS = 1.0
#: The mover should jump at least this far between the two images (arcsec)...
MIN_VISIBLE_SHIFT_ARCSEC = 30.0
#: ...but no more than this fraction of the field width, so both positions are on screen.
MAX_SHIFT_FRACTION = 0.6
#: The Explorer lists pairs in a picker, so only the best few are offered.
MAX_PAIRS = 20


@dataclass(frozen=True)
class EpochInfo:
    epoch_id: str
    mjd: float
    detector: int
    wavelength_um: float


@dataclass(frozen=True)
class TrackPoint:
    epoch_id: str
    ra_deg: float
    dec_deg: float


@dataclass
class Pair:
    epoch_id_a: str
    epoch_id_b: str
    time_separation_hours: float
    lambda_matched: bool
    delta_lambda_frac: float
    label_plain: str
    displacement_arcsec: float | None = None
    default: bool = False


def separation_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """Great-circle separation (haversine), arcsec."""
    p1, p2 = math.radians(dec1), math.radians(dec2)
    dp = p2 - p1
    dl = math.radians(ra2 - ra1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(h)))) * 3600.0


def _label(la: float, lb: float, dt: float, matched: bool, shift: float | None) -> str:
    when = f"{dt:.1f} hours apart" if dt < 48 else f"{dt / 24:.1f} days apart"
    moved = f"; the moving object shifts {shift:.0f} arcsec" if shift is not None else ""
    if matched:
        return f"Same wavelength ({la:.2f} and {lb:.2f} um), {when}{moved}"
    return (
        f"Different wavelengths ({la:.2f} and {lb:.2f} um), {when}{moved}: "
        "brightness changes are expected"
    )


def build_pairs(
    epochs: Sequence[EpochInfo],
    tracks: Sequence[Sequence[TrackPoint]],
    field_width_arcsec: float,
    tolerance: Callable[[int, float, int, float], float],
) -> list[Pair]:
    """All offered pairs for a field, best first, with exactly one marked default.

    ``tracks`` holds the detections of each mover in the field (may be empty).
    ``tolerance(det_a, lam_a, det_b, lam_b)`` is the fractional wavelength-match tolerance.
    """
    by_id = {e.epoch_id: e for e in epochs}
    ordered = sorted(epochs, key=lambda e: e.mjd)
    seen: set[tuple[str, str]] = set()
    out: list[Pair] = []
    track_pos = [{p.epoch_id: p for p in t} for t in tracks]

    def add(a: EpochInfo, b: EpochInfo) -> None:
        if a.mjd > b.mjd:
            a, b = b, a
        key = (a.epoch_id, b.epoch_id)
        if a.epoch_id == b.epoch_id or key in seen:
            return
        dt = (b.mjd - a.mjd) * 24.0
        if dt < MIN_GAP_HOURS:
            return
        seen.add(key)
        la, lb = a.wavelength_um, b.wavelength_um
        frac = abs(la - lb) / ((la + lb) / 2)
        matched = frac < tolerance(a.detector, la, b.detector, lb)
        shift = None
        for pos in track_pos:
            pa, pb = pos.get(a.epoch_id), pos.get(b.epoch_id)
            if pa and pb:
                s = separation_arcsec(pa.ra_deg, pa.dec_deg, pb.ra_deg, pb.dec_deg)
                shift = s if shift is None else max(shift, s)
        out.append(
            Pair(
                epoch_id_a=a.epoch_id,
                epoch_id_b=b.epoch_id,
                time_separation_hours=round(dt, 3),
                lambda_matched=matched,
                delta_lambda_frac=round(frac, 5),
                label_plain=_label(la, lb, dt, matched, shift),
                displacement_arcsec=None if shift is None else round(shift, 1),
            )
        )

    # 1. Consecutive epochs (skipping same-burst neighbours via the gap rule).
    for a, b in zip(ordered, ordered[1:], strict=False):
        add(a, b)
    # 2. For each epoch, the closest-wavelength epoch on the same detector at least an hour away.
    for a in ordered:
        others = [
            b
            for b in ordered
            if abs(b.mjd - a.mjd) * 24 >= MIN_GAP_HOURS and b.detector == a.detector
        ]
        if others:
            add(a, min(others, key=lambda b: abs(b.wavelength_um - a.wavelength_um)))
    # 3. Every cross-visit combination of epochs where a mover was detected.
    for pos in track_pos:
        ids = [i for i in pos if i in by_id]
        for i, ia in enumerate(ids):
            for ib in ids[i + 1 :]:
                add(by_id[ia], by_id[ib])

    if not out:
        return out
    max_shift = MAX_SHIFT_FRACTION * field_width_arcsec

    def score(p: Pair) -> tuple:
        if p.displacement_arcsec is not None:
            on_screen = MIN_VISIBLE_SHIFT_ARCSEC <= p.displacement_arcsec <= max_shift
            # Visible-and-on-screen first, then same wavelength, then the bigger (clearer) jump.
            return (
                1,
                on_screen,
                p.lambda_matched,
                p.displacement_arcsec if on_screen else -p.displacement_arcsec,
            )
        # No mover in both images: same wavelength first, then the longest gap.
        return (0, False, p.lambda_matched, p.time_separation_hours)

    out.sort(key=score, reverse=True)
    out = out[:MAX_PAIRS]
    out[0].default = True
    return out
