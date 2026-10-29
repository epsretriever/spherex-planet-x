from spherex_px.pairs import MAX_PAIRS, MIN_GAP_HOURS, EpochInfo, TrackPoint, build_pairs


def tol(_da, _la, _db, _lb):
    return 0.01


H = 1 / 24


def epochs(*specs):
    return [EpochInfo(f"e{i:02d}", 60000 + t * H, det, lam) for i, (t, det, lam) in enumerate(specs, 1)]


def test_never_offers_pairs_from_the_same_burst():
    # e01/e02 are dichroic partners at the same instant; e03 is minutes later.
    eps = epochs((0, 1, 1.0), (0, 4, 3.9), (0.05, 1, 1.03), (12, 1, 1.0))
    pairs = build_pairs(eps, [], 1000, tol)
    assert pairs
    assert all(p.time_separation_hours >= MIN_GAP_HOURS for p in pairs)


def test_default_shows_the_mover_jump_on_screen():
    eps = epochs((0, 1, 1.0), (12, 1, 1.5), (36, 1, 1.0))
    # 40 arcsec/h along RA at dec 0: 480" after 12 h, 1440" after 36 h (off a 1000" field).
    track = [TrackPoint(e.epoch_id, 10 + (e.mjd - 60000) * 24 * 40 / 3600, 0.0) for e in eps]
    pairs = build_pairs(eps, [track], 1000, tol)
    best = pairs[0]
    assert best.default and sum(p.default for p in pairs) == 1
    assert (best.epoch_id_a, best.epoch_id_b) == ("e01", "e02")
    assert 470 < best.displacement_arcsec < 490
    assert "shifts" in best.label_plain


def test_field_without_movers_prefers_same_wavelength_then_longest_gap():
    eps = epochs((0, 1, 1.0), (5, 1, 2.0), (30, 1, 1.002), (40, 1, 3.0))
    pairs = build_pairs(eps, [], 1000, tol)
    assert pairs[0].lambda_matched
    assert (pairs[0].epoch_id_a, pairs[0].epoch_id_b) == ("e01", "e03")
    assert pairs[0].displacement_arcsec is None


def test_caps_the_number_of_pairs():
    eps = epochs(*[(i * 2, 1, 1.0 + i * 0.01) for i in range(40)])
    track = [TrackPoint(e.epoch_id, 10 + (e.mjd - 60000) * 24 * 5 / 3600, 0.0) for e in eps]
    assert len(build_pairs(eps, [track], 5000, tol)) == MAX_PAIRS


def test_no_pairs_when_all_images_are_one_burst():
    eps = epochs((0, 1, 1.0), (0.01, 2, 1.5))
    assert build_pairs(eps, [], 1000, tol) == []
