"""The published Planet Nine search region, binned on the sky for the all-sky map.

Source: Brown & Batygin (2021), "The Orbit of Planet Nine", AJ 162, 219 (arXiv:2108.09868).
Their reference population of synthetic Planet Nine orbits, with sky positions, is published
on CaltechDATA; we use the current version of the record (it adds the ZTF and DES survey
constraints). We download it, bin the sky positions into RA/Dec cells and write
``survey/planet_nine.json``; ``publish`` copies it into ``survey.json`` as ``planet_nine``.

CaltechDATA is an InvenioRDM repository: ``/api/records/<id>`` gives the metadata and
``/api/records/<id>/files`` the files.
"""

from __future__ import annotations

import gzip
import io
import json
import logging
import re
import zipfile
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

RECORD_ID = "8fjad-x7y61"
RECORD_URL = f"https://data.caltech.edu/records/{RECORD_ID}"
API = f"https://data.caltech.edu/api/records/{RECORD_ID}"
CITATION = "Brown & Batygin 2021, AJ 162, 219: Planet Nine reference population (CaltechDATA)"
OUT = Path("survey") / "planet_nine.json"
MAX_FILE_BYTES = 500_000_000


def fetch(dest: Path) -> tuple[dict, list[Path]]:
    """Download the record's metadata and files into dest. Returns (metadata, paths)."""
    from .data.http import request

    dest.mkdir(parents=True, exist_ok=True)
    meta = request("GET", API).json()
    (dest / "record.json").write_text(json.dumps(meta, indent=1))
    files = request("GET", f"{API}/files").json().get("entries", [])
    paths = []
    for f in files:
        key, size = f["key"], int(f.get("size") or 0)
        log.info("file %s (%d bytes)", key, size)
        if size > MAX_FILE_BYTES:
            log.warning("skipping %s: larger than %d bytes", key, MAX_FILE_BYTES)
            continue
        p = dest / key
        if not p.exists() or p.stat().st_size != size:
            p.write_bytes(request("GET", f["links"]["content"]).content)
        paths.append(p)
    return meta, paths


def _text_members(p: Path):
    """(name, text) for a plain, gzip or zip text file."""
    raw = p.read_bytes()
    if raw[:2] == b"\x1f\x8b":
        yield p.name, gzip.decompress(raw).decode("utf-8", "replace")
    elif raw[:4] == b"PK\x03\x04":
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            for n in z.namelist():
                if not n.endswith("/"):
                    yield n, z.read(n).decode("utf-8", "replace")
    else:
        try:
            yield p.name, raw.decode("utf-8")
        except UnicodeDecodeError:
            log.info("%s is binary (%d bytes); first bytes %r", p.name, len(raw), raw[:64])


def describe(meta: dict, paths: list[Path], head: int = 12) -> None:
    """Log what the record contains (metadata and the first lines of each table)."""
    m = meta.get("metadata", {})
    log.info("title: %s", m.get("title"))
    log.info("version: %s; published: %s", m.get("version"), m.get("publication_date"))
    log.info("description: %s", re.sub(r"<[^>]+>", " ", m.get("description") or "")[:3000])
    for p in paths:
        for name, text in _text_members(p):
            lines = text.splitlines()
            log.info("%s: %d lines; first %d:\n%s", name, len(lines), head, "\n".join(lines[:head]))


def bin_sky(
    ra_deg: np.ndarray, dec_deg: np.ndarray, weight: np.ndarray | None, cell_deg: float
) -> list[dict]:
    """RA/Dec cells (bin centres) with the share of the population in each; empty cells omitted."""
    w = np.ones_like(ra_deg) if weight is None else np.asarray(weight, float)
    ra = np.mod(ra_deg, 360.0)
    i = np.minimum((ra // cell_deg).astype(int), int(round(360 / cell_deg)) - 1)
    j = np.minimum(((dec_deg + 90.0) // cell_deg).astype(int), int(round(180 / cell_deg)) - 1)
    total = float(w.sum())
    cells: dict[tuple[int, int], float] = {}
    for a, b, x in zip(i, j, w, strict=True):
        cells[(a, b)] = cells.get((a, b), 0.0) + float(x)
    return [
        {
            "ra_deg": round((a + 0.5) * cell_deg, 4),
            "dec_deg": round((b + 0.5) * cell_deg - 90.0, 4),
            "fraction": round(x / total, 6),
        }
        for (a, b), x in sorted(cells.items())
        if x > 0
    ]


#: The population file's epoch: JD 2458270.0 (stated in its header).
EPOCH_UTC = "2018-06-01T12:00:00Z"
POPULATION_FILE = "reference_population.csv"


def load_population(path: Path) -> dict[str, np.ndarray]:
    """Columns of reference_population.csv (comment lines start with '#')."""
    lines = [ln for ln in path.read_text().splitlines() if ln.strip() and not ln.startswith("#")]
    names = [n.strip() for n in lines[0].split(",")]
    data = np.array([[float(x) for x in ln.split(",")] for ln in lines[1:]])
    return {n: data[:, k] for k, n in enumerate(names)}


def region(pop: dict[str, np.ndarray], cell_deg: float = 5.0) -> dict:
    """Sky cells of the population that the ZTF, DES and Pan-STARRS searches would not have
    detected (the region still open), plus counts for the full population."""
    open_ = (pop["ZTF"] == 0) & (pop["DES"] == 0) & (pop["PS1"] == 0)
    return {
        "citation": CITATION,
        "url": RECORD_URL,
        "epoch_utc": EPOCH_UTC,
        "cell_deg": cell_deg,
        "population": "Synthetic Planet Nine orbits not detectable by the ZTF, DES or Pan-STARRS "
        "searches (Brown & Batygin 2021b; Belyakov et al. 2022; Brown et al. 2023)",
        "n_population": int(len(open_)),
        "n_remaining": int(open_.sum()),
        "cells": bin_sky(pop["ra"][open_], pop["dec"][open_], None, cell_deg),
    }
