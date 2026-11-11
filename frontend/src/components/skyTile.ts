import type { SurveyTile } from "@/lib/contract";

/** The tile fields the sky page reads. The build-time HTML carries only these (see skyTiles). */
export type SkyTile = Pick<
  SurveyTile,
  | "tile_id"
  | "center"
  | "ecliptic_lon_deg"
  | "ecliptic_lat_deg"
  | "status"
  | "field_id"
  | "first_time_utc"
  | "last_time_utc"
  | "n_epochs"
  | "n_candidates"
  | "m50_ab"
  | "detail"
>;

export function skyTile(t: SkyTile): SkyTile {
  return {
    tile_id: t.tile_id,
    center: t.center,
    ecliptic_lon_deg: t.ecliptic_lon_deg,
    ecliptic_lat_deg: t.ecliptic_lat_deg,
    status: t.status,
    field_id: t.field_id,
    first_time_utc: t.first_time_utc,
    last_time_utc: t.last_time_utc,
    n_epochs: t.n_epochs,
    n_candidates: t.n_candidates,
    m50_ab: t.m50_ab,
    detail: t.detail,
  };
}


/**
 * A tile as a plain row, in the order of PACKED_KEYS. The sky page inlines hundreds of tiles in
 * its HTML; as rows they take well under half the bytes of objects with their keys repeated, so
 * the page parses and paints sooner.
 */
export type PackedTile = [string, number, number, number, number, SkyTile["status"], string | null, string | null, string | null, number, number, number | null, string | null];

export function packTile(t: SkyTile): PackedTile {
  return [
    t.tile_id,
    t.center.ra_deg,
    t.center.dec_deg,
    t.ecliptic_lon_deg,
    t.ecliptic_lat_deg,
    t.status,
    t.field_id,
    t.first_time_utc,
    t.last_time_utc,
    t.n_epochs,
    t.n_candidates,
    t.m50_ab,
    t.detail ?? null,
  ];
}

export function unpackTile(r: PackedTile): SkyTile {
  return {
    tile_id: r[0],
    center: { ra_deg: r[1], dec_deg: r[2] },
    ecliptic_lon_deg: r[3],
    ecliptic_lat_deg: r[4],
    status: r[5],
    field_id: r[6],
    first_time_utc: r[7],
    last_time_utc: r[8],
    n_epochs: r[9],
    n_candidates: r[10],
    m50_ab: r[11],
    detail: r[12],
  };
}
