/**
 * Plain-language text for the precovery search, written by code from the result's own values.
 * Nothing here may claim a discovery (worker/src/ai/core.ts FORBIDDEN is checked in tests).
 */
import type { FindBrightness, FindObject, FindResult } from "./contract";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function displayName(o: Pick<FindObject, "full_name" | "designation">): string {
  return o.full_name.replace(/^\((.*)\)$/, "$1") || o.designation;
}

export function whyItMatters(o: FindObject | null): string {
  const who = o ? displayName(o) : "an asteroid or comet";
  return (
    `Old images that happen to show a known object are called precovery observations. ` +
    `Each one adds a position at a new date, which lengthens the stretch of time over which ${who} has been observed. ` +
    `A longer observed arc pins down the orbit, so future positions can be predicted more precisely. ` +
    `The frames below are where SPHEREx's images should contain ${who}, according to JPL's current orbit.`
  );
}

export function brightnessNote(b: FindBrightness, nFrames: number): string {
  if (!nFrames) return "No SPHEREx frames covered the predicted position, so there is no brightness to compare.";
  if (b.vmag_min === null) return "JPL Horizons gave no predicted brightness for these dates.";
  const range = b.vmag_max !== null && b.vmag_max - b.vmag_min >= 0.1 ? `${b.vmag_min.toFixed(1)} to ${b.vmag_max.toFixed(1)}` : b.vmag_min.toFixed(1);
  const caveat =
    "Horizons predicts visible-light brightness (V) while SPHEREx sees near-infrared light, so this is a rough comparison.";
  if (b.m50_ab === null) return `Horizons predicts V ${range} during these frames. ${caveat}`;
  const lim = `our pipeline's 50% recovery limit, magnitude ${b.m50_ab.toFixed(1)}${b.m50_study_id ? ` (injection study ${b.m50_study_id})` : ""}`;
  switch (b.verdict) {
    case "brighter_than_limit":
      return `Horizons predicts V ${range}, brighter than ${lim}: it should stand out in these images. ${caveat}`;
    case "near_limit":
      return `Horizons predicts V ${range}, close to ${lim}: it may be faint or invisible in single images. ${caveat}`;
    case "fainter_than_limit":
      return `SPHEREx looked here ${plural(nFrames, "time")}, but Horizons predicts V ${range}, fainter than ${lim}, so we don't expect to see it in these images. ${caveat}`;
    default:
      return `Horizons predicts V ${range}. ${caveat}`;
  }
}

export function summaryPlain(r: FindResult, dataEndUtc: string | null): string {
  const o = r.object;
  if (!o) return r.summary_plain;
  const name = displayName(o);
  const through = dataEndUtc ? ` (IRSA's public SPHEREx images run through ${day(dataEndUtc)})` : "";
  if (!r.n_frames) {
    return `SPHEREx's public images${through} never covered JPL's predicted position of ${name}.`;
  }
  const first = r.frames[0]!.time_utc;
  const last = r.frames[r.frames.length - 1]!.time_utc;
  const measured = r.frames.filter((f) => f.measured).length;
  let s =
    `JPL's predicted position of ${name} falls inside ${plural(r.n_frames, "SPHEREx frame")}${r.truncated ? " (the first ones are listed)" : ""}, ` +
    `in ${plural(r.n_visits, "visit")} from ${day(first)} to ${day(last)}${through}.`;
  if (measured) s += ` Our pipeline measured it in ${measured} of them.`;
  else if (r.catalog.length) s += ` Our catalog has it, but none of its detections are in these frames.`;
  if (r.brightness?.verdict === "fainter_than_limit") s += ` It was predicted fainter than our detection limit.`;
  return s;
}
