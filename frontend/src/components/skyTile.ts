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

