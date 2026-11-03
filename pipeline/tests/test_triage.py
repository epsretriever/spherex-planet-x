"""spherex-px triage: the Worker's JPL known-object check, run in the pipeline."""

import json
import urllib.parse
from pathlib import Path

import pytest

from spherex_px import schemas as S
from spherex_px import triage as T

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "fixtures"


class Resp:
    def __init__(self, body, status=200):
        self.body, self.status_code = body, status

    def json(self):
        return self.body


def fake_jpl(
    cand: S.CandidateDetail, name="433 Eros (A898 PA)", offset_deg=0.0, sbident_status=200
):
    """SBIdent lists `name` at each queried position; Horizons predicts every detection
    `offset_deg` away in Dec (with the spacecraft at the geocenter, so no parallax)."""
    calls = []

    def request(method, url, **_):
        calls.append(url)
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        if "sb_ident" in url:
            if sbident_status != 200:
                return Resp({}, sbident_status)
            d = next(
                d for d in cand.detections if T.time_to_sbident(d.time_utc) == q["obs-time"][0]
            )
            return Resp(
                {
                    "fields_first": [
                        "Object name",
                        "Astrometric RA (hh:mm:ss)",
                        "Astrometric Dec (dd mm'ss\")",
                        "Visual magnitude (V)",
                    ],
                    "data_first_pass": [[name, d.ra_deg, d.dec_deg + offset_deg, "17.1"]],
                }
            )
        lines = [
            f"{d.mjd + 2400000.5:.6f}, , , {d.ra_deg:.8f}, {d.dec_deg + offset_deg:.8f}, 2.0, 1.0"
            for d in cand.detections
        ]
        return Resp({"result": "header\n$$SOE\n" + "\n".join(lines) + "\n$$EOE\n"})

    return request, calls


@pytest.fixture
def cand():
    c = S.CandidateDetail.model_validate_json((FIXTURES / "candidate_detail.json").read_text())
    for d in c.detections:
        d.spacecraft_geocentric_km = [0.0, 0.0, 0.0]
    return c


def test_sexagesimal_and_designations():
    assert T.ra_to_sbident(346.53) == "23-06-07.20"
    assert T.dec_to_sbident(-6.384) == "M06-23-02.4"
    assert T.horizons_command("433 Eros (A898 PA)") == "'433;'"
    assert T.horizons_command("(2019 AB12)") == "'DES=2019 AB12;'"
    assert T.sbdb_url("433 Eros (A898 PA)").endswith("sstr=433")
    assert T.horizons_app_url("(2019 AB12)").endswith("sstr=2019%20AB12")


def test_match_gives_known_object_with_jpl_links(cand, monkeypatch):
    req, calls = fake_jpl(cand)
    monkeypatch.setattr(T, "request", req)
    k = T.check_candidate(cand, "2026-11-03T00:00:00Z")
    assert k.checked and k.matched and k.designation == "433 Eros (A898 PA)"
    assert k.enrichment == "pipeline" and k.catalogs_checked == ["JPL SBIdent", "JPL Horizons"]
    assert k.jpl_links is not None and "sbdb_lookup" in k.jpl_links.sbdb_url
    assert all(p.separation_arcsec < 1 for p in k.per_epoch)
    assert any("horizons" in u for u in calls)


def test_far_object_is_unexplained(cand, monkeypatch):
    req, _ = fake_jpl(cand, offset_deg=40 / 3600)
    monkeypatch.setattr(T, "request", req)
    k = T.check_candidate(cand, "2026-11-03T00:00:00Z")
    assert k.checked and not k.matched and k.nearest is not None
    assert k.nearest.separation_arcsec == pytest.approx(40, abs=1)


def test_jpl_down_leaves_it_unchecked(cand, monkeypatch):
    req, _ = fake_jpl(cand, sbident_status=503)
    monkeypatch.setattr(T, "request", req)
    k = T.check_candidate(cand, "2026-11-03T00:00:00Z")
    assert not k.checked and "did not answer" in k.not_checked_reason


def test_triage_makes_known_objects_minimal_and_keeps_unexplained(cand, tmp_path, monkeypatch):
    from spherex_px.build import write_json

    out = tmp_path
    known = cand.model_copy(deep=True)
    other = cand.model_copy(deep=True)
    other.candidate_id = other.candidate_id + "x"
    for c in (known, other):
        write_json(out / "candidates" / f"{c.candidate_id}.json", c)
        for d in c.detections:
            p = out / "candidates" / c.candidate_id / Path(d.stamp.url).name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b"webp")
    match, _ = fake_jpl(known)
    miss, _ = fake_jpl(other, offset_deg=0.1)

    def route(method, url, **kw):
        # Same detections in both: tell them apart by the order triage asks (sorted ids).
        return (miss if route.n >= route.split else match)(method, url, **kw)

    calls_per = len(T.sbident_sample(known.detections)) + 1
    route.n, route.split = 0, calls_per

    def counted(method, url, **kw):
        r = route(method, url, **kw)
        route.n += 1
        return r

    monkeypatch.setattr(T, "request", counted)
    rep = T.triage(out, workers=1)
    assert (rep.checked, rep.matched, rep.unexplained) == (2, 1, 1)
    k = S.CandidateDetail.model_validate_json(
        (out / "candidates" / f"{known.candidate_id}.json").read_text()
    )
    u = S.CandidateDetail.model_validate_json(
        (out / "candidates" / f"{other.candidate_id}.json").read_text()
    )
    assert k.record_level == "minimal" and k.classification == S.Classification.known_object
    assert all(d.stamp is None for d in k.detections)
    assert not any((out / "candidates" / known.candidate_id).glob("e*.webp"))
    assert u.record_level == "full" and all(d.stamp is not None for d in u.detections)
    assert any((out / "candidates" / other.candidate_id).glob("*.webp"))
    # A second triage leaves checked candidates alone.
    rep2 = T.triage(out, workers=1)
    assert rep2.checked == 0 and rep2.skipped == 2
    json.loads((out / "candidates" / f"{known.candidate_id}.json").read_text())
