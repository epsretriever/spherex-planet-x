import { describe, expect, it } from "vitest";
import { packTile, skyTile, unpackTile, type SkyTile } from "./skyTile";

const tile: SkyTile = {
  tile_id: "sv-2025w252a-l0003-n008",
  center: { ra_deg: 359.8, dec_deg: 0.85 },
  ecliptic_lon_deg: 0.15,
  ecliptic_lat_deg: 0.9,
  status: "processed",
  field_id: "sv-2025w252a-l0003-n008",
  first_time_utc: "2025-06-21T03:00:00Z",
  last_time_utc: "2025-06-22T03:00:00Z",
  n_epochs: 34,
  n_candidates: 1,
  m50_ab: null,
  detail: null,
};

describe("sky tiles in the page HTML", () => {
  it("survive packing into a row and back unchanged", () => {
    expect(unpackTile(packTile(tile))).toEqual(tile);
    const failed: SkyTile = { ...tile, status: "failed", field_id: null, m50_ab: 19.4, detail: "S3 read error" };
    expect(unpackTile(packTile(failed))).toEqual(failed);
  });

  it("carry exactly the fields the page reads", () => {
    expect(Object.keys(unpackTile(packTile(tile))).sort()).toEqual(Object.keys(skyTile(tile)).sort());
  });
});
