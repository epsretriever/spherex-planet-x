"""SPHEREx FLAGS bitmap.

Bit positions are read from each file's FLAGS header (MP_<NAME> = <bit>). DEFAULT_BITS is the
table found in QR2 files and is used only if a header has no MP_ keywords.
"""

from __future__ import annotations

from collections.abc import Mapping

import numpy as np
from astropy.io.fits import Header

DEFAULT_BITS: dict[str, int] = {
    "TRANSIENT": 0,
    "OVERFLOW": 1,
    "SUR_ERROR": 2,
    "PHANTOM": 4,
    "REFERENCE": 5,
    "NONFUNC": 6,
    "DICHROIC": 7,
    "MISSING_DATA": 9,
    "HOT": 10,
    "COLD": 11,
    "FULLSAMPLE": 12,
    "PHANMISS": 14,
    "NONLINEAR": 15,
    "PERSIST": 17,
    "OUTLIER": 19,
    "SOURCE": 21,
}

# Pixels with these bits are unusable for detection and photometry.
HARD_BAD = (
    "TRANSIENT",
    "OVERFLOW",
    "SUR_ERROR",
    "REFERENCE",
    "NONFUNC",
    "MISSING_DATA",
    "HOT",
    "COLD",
)
# Usable, but a detection touching them is penalized in artifact_likelihood.
SOFT_BAD = ("PHANTOM", "DICHROIC", "PHANMISS", "NONLINEAR", "PERSIST")
# OUTLIER is set by the pipeline's outlier rejection, which a moving object can trigger.
# SOURCE marks pixels mapped to a catalogued (static) source. Neither is "bad".
INFORMATIONAL = ("FULLSAMPLE", "OUTLIER", "SOURCE")


def bits_from_header(header: Header) -> dict[str, int]:
    bits = {}
    for key in header:
        if key.startswith("MP_"):
            bits[key[3:]] = int(header[key])
    # header spells it MISSING_DATA; keep names exactly as given
    return bits or dict(DEFAULT_BITS)


def mask_for(bits: Mapping[str, int], names: tuple[str, ...]) -> int:
    m = 0
    for n in names:
        if n in bits:
            m |= 1 << bits[n]
    return m


def names_for(value: int, bits: Mapping[str, int]) -> list[str]:
    return [name for name, bit in sorted(bits.items(), key=lambda kv: kv[1]) if value & (1 << bit)]


def hard_bad_mask(flags: np.ndarray, bits: Mapping[str, int]) -> np.ndarray:
    return (flags & mask_for(bits, HARD_BAD)) != 0


def soft_bad_mask(flags: np.ndarray, bits: Mapping[str, int]) -> np.ndarray:
    return (flags & mask_for(bits, SOFT_BAD)) != 0
