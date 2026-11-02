import json

from spherex_px import schemas as S
from spherex_px.contract import FIXTURE_DIR
from spherex_px.ranking import MIN_OBJECTS, rank_anomalies

FORBIDDEN = ("discover", "new object", "new planet", "planet x", "unexplained")


def _objects(n: int) -> list[S.ObjectDetail]:
    base = S.ObjectDetail.model_validate_json((FIXTURE_DIR / "object_detail.json").read_text())
    out = []
    for i in range(n):
        m = base.motion.model_copy(
            update={
                "rate_arcsec_per_hr": 30.0 + i,
                "ra_rate_arcsec_per_hr": 30.0 + i,
                "dec_rate_arcsec_per_hr": 3.0,
            }
        )
        out.append(base.model_copy(update={"object_id": f"obj-{i:02d}", "motion": m}))
    # one object moving 20x slower, steeply across the ecliptic
    slow = out[-1].motion.model_copy(
        update={
            "rate_arcsec_per_hr": 1.5,
            "ra_rate_arcsec_per_hr": 0.1,
            "dec_rate_arcsec_per_hr": 1.5,
        }
    )
    out[-1] = out[-1].model_copy(update={"motion": slow})
    return out


def test_the_odd_one_out_ranks_first_with_a_factual_reason():
    objs = _objects(20)
    a = rank_anomalies(objs)
    assert len(a) == 20
    top = min(a.values(), key=lambda x: x.rank)
    assert top is a["obj-19"]
    assert top.rank == 1 and top.n_ranked == 20 and top.score == 1.0
    assert "slower than the median" in top.reason_plain or "ecliptic" in top.reason_plain
    assert sorted(x.rank for x in a.values()) == list(range(1, 21))
    for x in a.values():
        assert not any(w in x.reason_plain.lower() for w in FORBIDDEN)


def test_pairs_artifacts_injected_and_small_samples_are_not_ranked():
    objs = _objects(MIN_OBJECTS + 3)
    for i, cls in enumerate(
        [
            S.Classification.unconfirmed_pair,
            S.Classification.likely_artifact,
            S.Classification.injected,
        ]
    ):
        objs[i] = objs[i].model_copy(update={"classification": cls})
    a = rank_anomalies(objs)
    assert set(a) == {o.object_id for o in objs[3:]}
    assert rank_anomalies(_objects(MIN_OBJECTS - 1)) == {}


def test_ranking_is_deterministic():
    objs = _objects(15)
    assert rank_anomalies(objs) == rank_anomalies(objs)


def test_publish_writes_anomaly_fields(tmp_path):
    from spherex_px.build import publish

    field = json.loads((FIXTURE_DIR / "field_detail.json").read_text())
    cand = json.loads((FIXTURE_DIR / "candidate_detail.json").read_text())
    (tmp_path / "fields").mkdir()
    (tmp_path / "candidates").mkdir()
    (tmp_path / "fields" / f"{field['field_id']}.json").write_text(json.dumps(field))
    (tmp_path / "candidates" / f"{cand['candidate_id']}.json").write_text(json.dumps(cand))
    publish(tmp_path)
    row = json.loads((tmp_path / "objects.json").read_text())["objects"][0]
    # one object: below MIN_OBJECTS, so no ranking rather than a meaningless one
    assert row["anomaly_rank"] is None and row["anomaly_score"] is None
