import numpy as np
import pytest

from spherex_px.planet_nine import bin_sky, load_population, region

HEADER = """# Planet Nine reference population; epoch of JD=2458270.0 (1 June 2018)
# Orbital elements refer to J2000 heliocentric osculating elements
#Parameters are:
index, mass, a, e, inc, varpi, Omega, M, ra, dec, R, rad, albedo, V, ZTF, DES, PS1
"""


def test_reads_the_published_format_and_keeps_only_undetected_members(tmp_path):
    # Rows copied from the head of reference_population.csv (CaltechDATA 8fjad-x7y61).
    rows = """    0,  4.84,  249.58,  0.074,  12.50,   252.85,    48.03,   72.60,  340.9044,  -21.0693,  245.34,  1.61,  0.270,  19.39, 1, 0, 1
    2, 10.62,  944.92,  0.502,  18.60,   237.12,    95.17,   71.09,   12.2508,  -14.9859, 1022.87,  3.54,  0.732,  22.80, 0, 0, 0
    3,  5.34,  517.69,  0.605,  20.88,   229.64,    94.30,  204.74,   59.7006,    7.9102,  819.32,  1.78,  0.694,  23.39, 0, 0, 0
    4,  5.13,  337.08,  0.083,  17.94,   251.60,    68.47,  134.16,   34.8625,    2.8018,  357.57,  1.71,  0.343,  20.64, 1, 1, 1
"""
    p = tmp_path / "reference_population.csv"
    p.write_text(HEADER + rows)
    pop = load_population(p)
    assert pop["ra"].tolist() == [340.9044, 12.2508, 59.7006, 34.8625]
    doc = region(pop, cell_deg=5.0)
    assert (doc["n_population"], doc["n_remaining"]) == (4, 2)
    assert doc["epoch_utc"] == "2018-06-01T12:00:00Z"
    assert [(c["ra_deg"], c["dec_deg"], c["fraction"]) for c in doc["cells"]] == [
        (12.5, -12.5, 0.5),
        (57.5, 7.5, 0.5),
    ]


def test_bins_wrap_and_sum_to_one():
    rng = np.random.default_rng(1)
    ra = rng.uniform(-10, 370, 5000)
    dec = rng.uniform(-90, 90, 5000)
    cells = bin_sky(ra, dec, None, 10.0)
    assert sum(c["fraction"] for c in cells) == pytest.approx(1.0, abs=1e-4)
    assert all(0 < c["ra_deg"] < 360 and -90 < c["dec_deg"] < 90 for c in cells)
    assert len({(c["ra_deg"], c["dec_deg"]) for c in cells}) == len(cells)
