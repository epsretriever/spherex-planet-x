/**
 * Test-only builders. Values are placeholders for exercising UI logic,
 * not observations; real examples live in shared/fixtures/.
 */
import type { BlinkPair, Epoch, Source } from "@/lib/contract";

export function testSource(tag = "a"): Source {
  return {
    file: `test-${tag}.fits`,
    obs_id: `TEST_${tag}`,
    planeid: null,
    detector: 1,
    archive_url: "https://example.invalid/test",
    cutout_url: null,
    cutout_method: "s3_byte_range",
    data_release: "TEST",
  };
}

export function testEpoch(id: string, mjd: number, overrides: Partial<Epoch> = {}): Epoch {
  const time = new Date((mjd - 40587) * 86400000).toISOString();
  return {
    epoch_id: id,
    obs_id: `TEST_${id}`,
    time_utc: time,
    mjd,
    time_start_utc: time,
    time_end_utc: time,
    exposure_s: 1,
    detector: 1,
    bandpass: "TEST",
    wavelength_um_center: 1.5,
    bandwidth_um: 0.03,
    wavelength_um_range: [1.48, 1.52],
    image: { url: `/static/test/${id}.webp`, width_px: 10, height_px: 10, source: testSource(id) },
    flagged_pixel_fraction: 0,
    n_detections: 0,
    source: testSource(id),
    ...overrides,
  };
}

export function testPair(a: string, b: string, lambda_matched: boolean): BlinkPair {
  return { epoch_id_a: a, epoch_id_b: b, time_separation_hours: 1, lambda_matched, delta_lambda_frac: 0, label_plain: "" };
}
