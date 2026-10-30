"""Build a field: real SPHEREx cutouts -> detections -> candidates -> static JSON + WebP.

Output layout (served by the Worker through env.ASSETS, see docs/api-contract.md):

    <out>/fields.json                         FieldList
    <out>/fields/<field_id>.json              FieldDetail
    <out>/fields/<field_id>/<epoch_id>.webp   field images (+ thumb.webp)
    <out>/candidates.json                     CandidateList
    <out>/candidates/<candidate_id>.json      CandidateDetail (known_object not checked yet)
    <out>/candidates/<candidate_id>/<epoch_id>.webp   64 px stamps (+ thumb.webp)
"""

from __future__ import annotations

import json
import logging
import math
import tomllib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path

import astropy.units as u
import numpy as np
from astropy.coordinates import BarycentricMeanEcliptic, SkyCoord
from astropy.time import Time

from . import schemas as S
from .data.index import CoverageIndex, dichroic_partner
from .data.l2file import L2File
from .data.s3 import Level2Key, S3Archive
from .data.spectral import band_index, lambda_match_tolerance
from .pairs import EpochInfo, TrackPoint, build_pairs
from .render import choose_stretch, write_thumbnail, write_webp
from .science.detect import DetectParams, detect, measure, prepare
from .science.grid import Grid, angular_sep_arcsec
from .science.link import (
    EpochData,
    LinkParams,
    Track,
    _covered,
    assign_clusters,
    build_sightings,
    find_transients,
    link_tracks,
)
from .science.vetting import TrackMeasurements, flux_ratio, vet
from .settings import BACKEND_ROOT
from .version import build_run_id, pipeline_version

log = logging.getLogger(__name__)

REPO_ROOT = BACKEND_ROOT.parent
DEFAULT_OUT = REPO_ROOT / "frontend" / "public" / "data"
URL_PREFIX = "/data"
STAMP_PX = 64
DETECT = DetectParams(threshold_snr=4.5)
LINK = LinkParams()


DISPLAY_NOTE = (
    "Zodiacal light model (ZODI) and residual background (2-D plus per-row) subtracted; pixels "
    "SPHEREx flags as unusable, and detector-edge rows with raised noise from edge glow, are "
    "filled from their neighbors (or set to the sky level) for display only and only inside the "
    "detector, while measurements use the masked data; pixels outside the detector are "
    "transparent; fixed asinh stretch shared by all images of the field"
)


def display_image(prep) -> np.ndarray:
    """Science image for rendering: flagged pixels inside the detector filled from neighbors.

    The cutout array lies entirely on the detector, so every pixel in it is covered. Flagged
    (NaN) pixels are interpolated from valid neighbors; any still empty (inside large flagged
    regions) are set to the sky level, 0 MJy/sr after background subtraction. Nothing outside
    the detector is ever filled: reprojection leaves those pixels NaN and the renderer makes
    them transparent.
    """
    from astropy.convolution import Gaussian2DKernel, interpolate_replace_nans

    filled = interpolate_replace_nans(prep.sci, Gaussian2DKernel(1.0))
    return np.where(np.isfinite(filled), filled, 0.0).astype(np.float32)


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def mjd_to_iso(mjd: float) -> str:
    return Time(mjd, format="mjd", scale="utc").isot + "Z"


def header_iso(value: str) -> str:
    return value if value.endswith("Z") else value + "Z"


@dataclass
class FieldSpec:
    field_id: str
    name: str
    blurb: str
    ra_deg: float
    dec_deg: float
    size_deg: float = 0.3
    segments: list[str] = field(default_factory=list)  # "qr2/2025W23_1C"
    origin: str = "showcase"


def load_showcase(path: Path | None = None) -> list[FieldSpec]:
    text = (
        path.read_text()
        if path
        else resources.files("spherex_px.config").joinpath("showcase.toml").read_text()
    )
    data = tomllib.loads(text)
    return [FieldSpec(**f) for f in data["field"]]


@dataclass
class Epoch:
    key: Level2Key
    data: EpochData
    epoch_id: str = ""


class FieldBuilder:
    def __init__(
        self, spec: FieldSpec, out_dir: Path = DEFAULT_OUT, archive: S3Archive | None = None
    ):
        self.spec = spec
        self.out = out_dir
        self.archive = archive or S3Archive()
        self.index = CoverageIndex(archive=self.archive)
        self.grid = Grid(spec.ra_deg, spec.dec_deg, spec.size_deg)
        self.version = pipeline_version(require_clean=True)
        self.run_id = build_run_id()
        self.generated = utc_now()

    # -- data ------------------------------------------------------------------

    def exposures(self) -> list[Level2Key]:
        segs = []
        for s in self.spec.segments:
            release, segment = s.split("/")
            self.index.index_segment(release, segment)
            segs.append(segment)
        cov = self.index.covering(self.spec.ra_deg, self.spec.dec_deg, edge_px=30, segments=segs)
        keys = []
        for e in cov:
            if e.l2dqa and e.l2dqa.strip() != "Pass":
                log.info("skipping %s: L2 DQA %s", e.key.obs_id, e.l2dqa)
                continue
            keys.append(e.key)
            keys.append(dichroic_partner(e.key))
        return keys

    def load(self, keys: list[Level2Key]) -> list[Epoch]:
        size = self.spec.size_deg + 0.05

        def one(key: Level2Key) -> Epoch | None:
            f = L2File(key, self.archive)
            c = f.cutout(self.spec.ra_deg, self.spec.dec_deg, size)
            if c is None:
                return None
            p = prepare(c, DETECT)
            d = detect(p, DETECT)
            h = c.header
            sc = np.array([h["X_SC"], h["Y_SC"], h["Z_SC"]], float)
            return Epoch(
                key, EpochData(f"{key.obs_id}D{key.detector}", float(h["MJD-AVG"]), p, d, sc)
            )

        with ThreadPoolExecutor(6) as ex:
            epochs = [e for e in ex.map(one, keys) if e is not None]
        epochs.sort(key=lambda e: (e.data.mjd, e.key.detector))
        for i, e in enumerate(epochs, 1):
            e.epoch_id = f"e{i:02d}"
            e.data.epoch_id = e.epoch_id
        return epochs

    # -- provenance --------------------------------------------------------------

    def source(self, e: Epoch, note: str | None = None) -> S.Source:
        c = e.data.prep.cutout
        return S.Source(
            file=e.key.file,
            obs_id=e.key.obs_id,
            planeid=None,
            detector=e.key.detector,
            archive_url=self.archive.url(e.key.key),
            cutout_url=None,
            cutout_method="s3_byte_range",
            cutout_region_pix=[c.x0, c.x1, c.y0, c.y1],
            data_release=e.key.data_release,
            processing_note=note,
        )

    # -- build -------------------------------------------------------------------

    def build(self) -> tuple[S.FieldDetail, list[S.CandidateDetail]]:
        spec = self.spec
        keys = self.exposures()
        if not keys:
            raise RuntimeError(
                f"{spec.field_id}: no SPHEREx exposures cover the field in {spec.segments}"
            )
        log.info("%s: %d exposures", spec.field_id, len(keys))
        epochs = self.load(keys)
        data = [e.data for e in epochs]
        assign_clusters(data)
        sightings = build_sightings(data, LINK)
        transients = find_transients(data, sightings, LINK)
        tracks = link_tracks(data, transients, LINK)
        tracks = [t for t in tracks if self._inside(t, data)]
        log.info(
            "%s: %d sightings, %d transients, %d tracks",
            spec.field_id,
            len(sightings),
            len(transients),
            len(tracks),
        )

        field_dir = self.out / "fields" / spec.field_id
        images = [
            self.grid.reproject(display_image(e.data.prep), e.data.prep.cutout.wcs) for e in epochs
        ]
        stretch = choose_stretch(images)
        epoch_models = []
        for e, img in zip(epochs, images, strict=True):
            path = field_dir / f"{e.epoch_id}.webp"
            write_webp(img, stretch, path)
            epoch_models.append(self._epoch_model(e, img, path))
        stack = np.nanmedian(np.stack(images), axis=0)
        write_thumbnail(stack, stretch, field_dir / "thumb.webp")

        candidates = []
        for n, tr in enumerate(sorted(tracks, key=lambda t: t.sightings[0].mjd), 1):
            cid = f"{spec.field_id}-c{n:02d}"
            candidates.append(self._candidate(cid, tr, epochs, stretch))

        movers = [self._mover(c) for c in candidates]
        detail = S.FieldDetail(
            pipeline_version=self.version,
            build_run_id=self.run_id,
            field_id=spec.field_id,
            name=spec.name,
            blurb=spec.blurb,
            summary_plain=self._field_summary(epoch_models, candidates),
            center=S.SkyPosition(ra_deg=spec.ra_deg, dec_deg=spec.dec_deg),
            ecliptic_lat_deg=round(self._ecliptic_lat(), 3),
            size_deg=S.SizeDeg(width=spec.size_deg, height=spec.size_deg),
            thumbnail_url=f"{URL_PREFIX}/fields/{spec.field_id}/thumb.webp",
            data_release=epochs[0].key.data_release,
            origin=spec.origin,
            generated_utc=self.generated,
            wcs=self.grid.contract(),
            stretch=stretch,
            epochs=epoch_models,
            blink_pairs=self._blink_pairs(epoch_models, movers),
            movers=movers,
        )
        return detail, candidates

    def _inside(self, tr: Track, data: list[EpochData]) -> bool:
        ra = np.array([data[i].det.ra[j] for i, j in tr.members])
        dec = np.array([data[i].det.dec[j] for i, j in tr.members])
        x, y = self.grid.world_to_grid(ra, dec)
        inside = (
            (x >= 0.5)
            & (x <= self.grid.width_px + 0.5)
            & (y >= 0.5)
            & (y <= self.grid.height_px + 0.5)
        )
        return inside.mean() >= 0.5

    def _ecliptic_lat(self) -> float:
        c = SkyCoord(self.spec.ra_deg * u.deg, self.spec.dec_deg * u.deg).transform_to(
            BarycentricMeanEcliptic()
        )
        return float(c.lat.deg)

    def _epoch_model(self, e: Epoch, img: np.ndarray, path: Path) -> S.Epoch:
        c = e.data.prep.cutout
        h = c.header
        xc, yc = c.wcs.all_world2pix([self.spec.ra_deg], [self.spec.dec_deg], 0)
        xi = int(np.clip(round(float(xc[0])), 0, c.shape[1] - 1))
        yi = int(np.clip(round(float(yc[0])), 0, c.shape[0] - 1))
        lam_c = float(c.wavelength_um[yi, xi])
        bw_c = float(c.bandwidth_um[yi, xi])
        lam_grid = self.grid.reproject(c.wavelength_um, c.wcs)
        bad_grid = self.grid.reproject(e.data.prep.bad.astype(np.float32), c.wcs)
        covered = np.isfinite(lam_grid)
        src = self.source(e, DISPLAY_NOTE + "; reprojected to the field grid")
        return S.Epoch(
            epoch_id=e.epoch_id,
            obs_id=e.key.obs_id,
            time_utc=header_iso(str(h["DATE-AVG"])),
            mjd=round(float(h["MJD-AVG"]), 7),
            time_start_utc=header_iso(str(h["DATE-BEG"])),
            time_end_utc=header_iso(str(h["DATE-END"])),
            exposure_s=round(float(h.get("XPOSURE", 0.0)), 3),
            detector=e.key.detector,
            bandpass=f"SPHEREx-D{e.key.detector}",
            wavelength_um_center=round(lam_c, 4),
            bandwidth_um=round(bw_c, 4),
            wavelength_um_range=[
                round(float(np.nanmin(lam_grid)), 4),
                round(float(np.nanmax(lam_grid)), 4),
            ],
            band_index=band_index(e.key.detector, lam_c),
            image=S.ImageRef(
                url=f"{URL_PREFIX}/fields/{self.spec.field_id}/{path.name}",
                width_px=self.grid.width_px,
                height_px=self.grid.height_px,
                source=src,
            ),
            flagged_pixel_fraction=round(
                float(np.nanmean(bad_grid[covered] > 0.5)) if covered.any() else 0.0, 4
            ),
            n_detections=int(len(e.data.det)),
            spacecraft_geocentric_km=[round(float(v), 3) for v in e.data.sc_km],
            source=src,
        )

    def _blink_pairs(self, epochs: list[S.Epoch], movers: list[S.Mover]) -> list[S.BlinkPair]:
        return blink_pairs_for(
            epochs, movers, self.grid.width_px, self.grid.height_px, self.grid.cdelt_arcsec
        )

    def _measurements(self, tr: Track, epochs: list[Epoch]) -> TrackMeasurements:
        data = [e.data for e in epochs]
        snr = np.array([data[i].det.snr[j] for i, j in tr.members])
        soft = np.array([data[i].det.n_soft[j] > 0 for i, j in tr.members])
        peak = np.array([data[i].det.peak_frac[j] for i, j in tr.members])
        edge = np.array([data[i].det.edge_dist_px[j] for i, j in tr.members])
        flux = np.array([data[i].det.flux_ujy[j] for i, j in tr.members])
        lam = np.array([data[i].det.wavelength_um[j] for i, j in tr.members])
        first = tr.sightings[0]
        forced = 0.0
        for c in sorted({e.cluster for e in data} - {first.cluster}):
            vals = []
            for e in (e for e in data if e.cluster == c):
                ok, x, y = _covered(e.prep, first.ra, first.dec)
                if ok:
                    vals.append(float(measure(e.prep, np.array([x]), np.array([y])).snr[0]))
            if vals:
                forced = max(forced, sum(vals) / math.sqrt(len(vals)))
        fit = tr.fit
        return TrackMeasurements(
            n_clusters=len(tr.sightings),
            n_detections=len(tr.members),
            min_snr=float(snr.min()),
            rms_arcsec=None if fit is None or fit.model == "none" else fit.rms_arcsec,
            pvalue=None if fit is None else fit.pvalue,
            soft_flag_fraction=float(soft.mean()),
            median_peak_fraction=float(np.median(peak)),
            min_edge_px=float(edge.min()),
            flux_ratio=flux_ratio(flux),
            wavelength_range_um=(float(lam.min()), float(lam.max())),
            max_forced_snr_elsewhere=forced,
            kind=tr.kind,
        )

    def _stamp(
        self, img_src: np.ndarray, wcs, ra: float, dec: float, stretch: S.Stretch, path: Path
    ) -> None:
        g = Grid(ra, dec, STAMP_PX * self.grid.cdelt_arcsec / 3600, self.grid.cdelt_arcsec)
        img = g.reproject(img_src, wcs)
        write_webp(img, stretch, path)

    def _candidate(
        self, cid: str, tr: Track, epochs: list[Epoch], stretch: S.Stretch
    ) -> S.CandidateDetail:
        data = [e.data for e in epochs]
        m = self._measurements(tr, epochs)
        checks, scores, cls, errors = vet(m)
        cand_dir = self.out / "candidates" / cid
        dets: list[S.Detection] = []
        order = sorted(tr.members, key=lambda ij: (data[ij[0]].mjd, epochs[ij[0]].key.detector))
        for i, j in order:
            e, d = epochs[i], data[i].det
            c = data[i].prep.cutout
            xn, yn = c.native_xy(d.x[j], d.y[j])
            xg, yg = self.grid.world_to_grid(d.ra[j], d.dec[j])
            stamp_path = cand_dir / f"{e.epoch_id}.webp"
            self._stamp(
                display_image(data[i].prep),
                c.wcs,
                float(d.ra[j]),
                float(d.dec[j]),
                stretch,
                stamp_path,
            )
            src = self.source(
                e, DISPLAY_NOTE + "; 64 x 64 px stamp at 6.15 arcsec/px centered on the detection"
            )
            h = c.header
            lam, bw = float(d.wavelength_um[j]), float(d.bandwidth_um[j])
            dets.append(
                S.Detection(
                    epoch_id=e.epoch_id,
                    obs_id=e.key.obs_id,
                    time_utc=header_iso(str(h["DATE-AVG"])),
                    mjd=round(float(h["MJD-AVG"]), 7),
                    ra_deg=round(float(d.ra[j]), 7),
                    dec_deg=round(float(d.dec[j]), 7),
                    pos_err_arcsec=round(float(d.pos_err_arcsec[j]), 3),
                    x_pix=round(float(xn), 3),
                    y_pix=round(float(yn), 3),
                    x_grid=round(float(xg[0]), 3),
                    y_grid=round(float(yg[0]), 3),
                    flux_ujy=round(float(d.flux_ujy[j]), 2),
                    flux_err_ujy=round(float(d.flux_err_ujy[j]), 2),
                    snr=round(float(d.snr[j]), 2),
                    wavelength_um_center=round(lam, 4),
                    bandwidth_um=round(bw, 4),
                    wavelength_um_range=[round(lam - bw / 2, 4), round(lam + bw / 2, 4)],
                    band_index=band_index(e.key.detector, lam),
                    flag_bits=int(d.flag_bits[j]),
                    flag_names=_flag_names(int(d.flag_bits[j]), c.flag_bits),
                    flagged_pixels_in_aperture=int(d.n_flagged[j]),
                    psf_fit_reduced_chi2=None,
                    stamp=S.ImageRef(
                        url=f"{URL_PREFIX}/candidates/{cid}/{stamp_path.name}",
                        width_px=STAMP_PX,
                        height_px=STAMP_PX,
                        source=src,
                    ),
                    spacecraft_geocentric_km=[round(float(v), 3) for v in data[i].sc_km],
                    source=src,
                )
            )
        best = max(range(len(dets)), key=lambda k: dets[k].snr)
        bi, bj = order[best]
        self._stamp(
            display_image(data[bi].prep),
            data[bi].prep.cutout.wcs,
            float(data[bi].det.ra[bj]),
            float(data[bi].det.dec[bj]),
            stretch,
            cand_dir / "thumb.webp",
        )
        fit = tr.fit
        t = np.array([dd.mjd for dd in dets])
        motion = S.Motion(
            model=S.MotionModel(fit.model) if fit else S.MotionModel.none,
            n_detections=len(dets),
            time_span_hours=round(float(np.ptp(t) * 24), 3),
            rate_arcsec_per_hr=_r(fit.rate_arcsec_per_hr if fit else None, 3),
            rate_err_arcsec_per_hr=_r(fit.rate_err_arcsec_per_hr if fit else None, 3),
            position_angle_deg=_r(fit.pa_deg if fit else None, 2),
            ra_rate_arcsec_per_hr=_r(fit.vxi if fit else None, 3),
            dec_rate_arcsec_per_hr=_r(fit.veta if fit else None, 3),
            fit_residual_rms_arcsec=_r(fit.rms_arcsec if fit and fit.model != "none" else None, 3),
            fit_chi2=_r(fit.chi2 if fit else None, 3),
            fit_dof=fit.dof if fit else None,
            distance_au_estimate=(
                S.DistanceEstimate(
                    best=round(fit.distance_au[0], 3),
                    lo=round(fit.distance_au[1], 3),
                    hi=round(fit.distance_au[2], 3),
                )
                if fit and fit.distance_au
                else None
            ),
        )
        known = S.KnownObject(
            checked=False,
            not_checked_reason="The offline pipeline does not query JPL; the API checks JPL SBIdent and "
            "Horizons when this report is requested.",
            matched=False,
            catalogs_checked=[],
            search_radius_arcsec=15.0,
            enrichment="static",
        )
        spectrum = S.Spectrum(
            points=[
                S.SpectrumPoint(
                    band_index=dd.band_index,
                    wavelength_um=dd.wavelength_um_center,
                    flux_ujy=dd.flux_ujy,
                    flux_err_ujy=dd.flux_err_ujy,
                    epoch_id=dd.epoch_id,
                )
                for dd in sorted(dets, key=lambda dd: dd.wavelength_um_center)
            ]
        )
        label = {
            S.Classification.unmatched: "Unexplained",
            S.Classification.likely_artifact: "Likely artifact",
            S.Classification.unconfirmed_pair: "Unconfirmed pair",
        }.get(cls, "Unexplained")
        rate = motion.rate_arcsec_per_hr
        summary = (
            f"Moves about {rate:.0f} arcseconds per hour across {len(dets)} images over "
            f"{motion.time_span_hours:.1f} hours. Not yet checked against JPL's catalog of known asteroids and comets."
            if rate is not None
            else f"Seen in {len(dets)} images. Not yet checked against JPL's catalog."
        )
        return S.CandidateDetail(
            pipeline_version=self.version,
            candidate_id=cid,
            field_id=self.spec.field_id,
            classification=cls,
            label_plain=label,
            summary_plain=summary,
            thumbnail_url=f"{URL_PREFIX}/candidates/{cid}/thumb.webp",
            detections=dets,
            motion=motion,
            known_object=known,
            scores=scores,
            vetting=checks,
            error_sources=errors,
            explanation=None,
            spectrum=spectrum,
            injection=None,
            provenance=S.CandidateProvenance(
                run_id=self.run_id,
                generated_utc=self.generated,
                parameters={
                    "detect_threshold_snr": DETECT.threshold_snr,
                    "aperture_radius_px": DETECT.aperture_radius_px,
                    "sighting_radius_arcsec": LINK.sighting_radius_arcsec,
                    "static_forced_snr": LINK.static_forced_snr,
                    "link_tolerance_arcsec": LINK.link_tolerance_arcsec,
                    "min_track_clusters": LINK.min_track_clusters,
                    "max_fit_rms_arcsec": LINK.max_fit_rms_arcsec,
                    "field_size_deg": self.spec.size_deg,
                },
            ),
        )

    def _mover(self, c: S.CandidateDetail) -> S.Mover:
        return S.Mover(
            candidate_id=c.candidate_id,
            classification=c.classification,
            label_plain=c.label_plain,
            quality_level=c.scores.quality_level,
            rate_arcsec_per_hr=c.motion.rate_arcsec_per_hr,
            track=[
                S.TrackPoint(
                    epoch_id=d.epoch_id,
                    time_utc=d.time_utc,
                    mjd=d.mjd,
                    ra_deg=d.ra_deg,
                    dec_deg=d.dec_deg,
                    x_grid=d.x_grid,
                    y_grid=d.y_grid,
                )
                for d in c.detections
            ],
        )

    def _field_summary(self, epochs: list[S.Epoch], cands: list[S.CandidateDetail]) -> str:
        t0, t1 = epochs[0].mjd, epochs[-1].mjd
        span = (t1 - t0) * 24
        when = f"{span:.0f} hours" if span < 48 else f"{span / 24:.1f} days"
        d0 = epochs[0].time_utc[:10]
        n_vis = len({round(e.mjd * 48) for e in epochs})  # half-hour bins ~ visits
        lam = [e.wavelength_um_center for e in epochs]
        movers = sum(1 for c in cands if c.classification != S.Classification.likely_artifact)
        moving = (
            f"The pipeline found {movers} moving object{'s' if movers != 1 else ''}."
            if movers
            else "The pipeline found no moving objects bright enough to track."
        )
        return (
            f"{len(epochs)} SPHEREx images of this patch taken over {when} starting {d0}, at wavelengths from "
            f"{min(lam):.2f} to {max(lam):.2f} um. {moving}"
        ).replace(f" {n_vis} ", f" {n_vis} ")


def _r(x: float | None, d: int) -> float | None:
    return None if x is None or not math.isfinite(x) else round(float(x), d)


def _flag_names(value: int, bits: dict[str, int]) -> list[str]:
    from .data.flags import names_for

    return names_for(value, bits)


# ---------------------------------------------------------------------------- publishing


def summary_of(c: S.CandidateDetail) -> S.CandidateSummary:
    return S.CandidateSummary(
        candidate_id=c.candidate_id,
        field_id=c.field_id,
        classification=c.classification,
        label_plain=c.label_plain,
        summary_plain=c.summary_plain,
        thumbnail_url=c.thumbnail_url,
        detection_count=len(c.detections),
        time_span_hours=c.motion.time_span_hours,
        first_time_utc=c.detections[0].time_utc,
        rate_arcsec_per_hr=c.motion.rate_arcsec_per_hr,
        position_angle_deg=c.motion.position_angle_deg,
        mean_snr=round(float(np.mean([d.snr for d in c.detections])), 2),
        overall_score=c.scores.overall,
        quality_level=c.scores.quality_level,
        known_object_checked=c.known_object.checked,
        known_object_matched=c.known_object.matched,
        known_object_designation=c.known_object.designation,
    )


def field_summary_of(f: S.FieldDetail, cands: list[S.CandidateDetail]) -> S.FieldSummary:
    counts: dict[S.Classification, int] = {}
    for c in cands:
        counts[c.classification] = counts.get(c.classification, 0) + 1
    return S.FieldSummary(
        field_id=f.field_id,
        name=f.name,
        blurb=f.blurb,
        center=f.center,
        ecliptic_lat_deg=f.ecliptic_lat_deg,
        size_deg=f.size_deg,
        thumbnail_url=f.thumbnail_url,
        epoch_count=len(f.epochs),
        date_range=S.DateRange(
            start_utc=f.epochs[0].time_utc,
            end_utc=f.epochs[-1].time_utc,
            start_mjd=f.epochs[0].mjd,
            end_mjd=f.epochs[-1].mjd,
        ),
        candidate_count=len(cands),
        candidate_counts=counts,
        data_release=f.data_release,
        origin=f.origin,
    )


def write_json(path: Path, model) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = (
        model.model_dump_json(indent=2)
        if hasattr(model, "model_dump_json")
        else json.dumps(model, indent=2)
    )
    path.write_text(text + "\n")


def publish(out_dir: Path = DEFAULT_OUT) -> tuple[int, int]:
    """Rebuild fields.json and candidates.json from the per-field and per-candidate files."""
    fields, cands = [], []
    for p in sorted((out_dir / "fields").glob("*.json")):
        fields.append(S.FieldDetail.model_validate_json(p.read_text()))
    for p in sorted((out_dir / "candidates").glob("*.json")):
        cands.append(S.CandidateDetail.model_validate_json(p.read_text()))
    by_field: dict[str, list[S.CandidateDetail]] = {}
    for c in cands:
        by_field.setdefault(c.field_id, []).append(c)
    # Lists carry the version and run of the data they list, not of whoever ran publish:
    # the Worker keys stored JPL results by pipeline_version, so a list and its detail files
    # must agree.
    versions = {f.pipeline_version for f in fields} | {c.pipeline_version for c in cands}
    if len(versions) > 1:
        raise ValueError(
            f"published data mixes pipeline versions {sorted(versions)}; rebuild every field "
            "with one pipeline commit"
        )
    version = versions.pop() if versions else pipeline_version(require_clean=True)
    runs = {f.build_run_id for f in fields if f.build_run_id}
    run_id = sorted(runs)[-1] if runs else build_run_id()
    now = utc_now()
    order = {"showcase": 0, "run": 1}
    fields.sort(key=lambda f: (order.get(f.origin, 2), f.field_id))
    write_json(
        out_dir / "fields.json",
        S.FieldList(
            pipeline_version=version,
            build_run_id=run_id,
            generated_utc=now,
            fields=[field_summary_of(f, by_field.get(f.field_id, [])) for f in fields],
        ),
    )
    summaries = [
        summary_of(c) for c in sorted(cands, key=lambda c: (-c.scores.overall, c.candidate_id))
    ]
    write_json(
        out_dir / "candidates.json",
        S.CandidateList(
            pipeline_version=version,
            build_run_id=run_id,
            generated_utc=now,
            total=len(summaries),
            candidates=summaries,
        ),
    )
    from .objects import write_objects_and_survey

    write_objects_and_survey(out_dir, fields, cands, version, run_id, now)
    return len(fields), len(cands)


def build_field(
    spec: FieldSpec, out_dir: Path = DEFAULT_OUT
) -> tuple[S.FieldDetail, list[S.CandidateDetail]]:
    # clear old outputs for this field
    import shutil

    shutil.rmtree(out_dir / "fields" / spec.field_id, ignore_errors=True)
    for p in (out_dir / "candidates").glob(f"{spec.field_id}-c*"):
        if p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink()
    detail, cands = FieldBuilder(spec, out_dir).build()
    write_json(out_dir / "fields" / f"{spec.field_id}.json", detail)
    for c in cands:
        write_json(out_dir / "candidates" / f"{c.candidate_id}.json", c)
    # Fit orbits here, where the survey spreads the work over many machines; publish reuses them.
    from .orbits import orbit_for

    for c in cands:
        try:
            orbit_for(out_dir, c)
        except Exception:  # an orbit failure must not lose the field
            log.exception("%s: orbit fit failed", c.candidate_id)
    return detail, cands


def _unused(*_):  # keep linters quiet about helpers used only in some builds
    return angular_sep_arcsec


def blink_pairs_for(
    epochs: list[S.Epoch],
    movers: list[S.Mover],
    width_px: int,
    height_px: int,
    cdelt_arcsec: float,
) -> list[S.BlinkPair]:
    """Ranked blink pairs for a field (see pairs.py). Only mover positions inside the image count."""

    def inside(p: S.TrackPoint) -> bool:
        return 0.5 <= p.x_grid <= width_px + 0.5 and 0.5 <= p.y_grid <= height_px + 0.5

    pairs = build_pairs(
        [EpochInfo(e.epoch_id, e.mjd, e.detector, e.wavelength_um_center) for e in epochs],
        [
            [TrackPoint(p.epoch_id, p.ra_deg, p.dec_deg) for p in m.track if inside(p)]
            for m in movers
        ],
        field_width_arcsec=min(width_px, height_px) * cdelt_arcsec,
        tolerance=lambda_match_tolerance,
    )
    return [S.BlinkPair(**vars(p)) for p in pairs]
