import type { BlinkPair, Epoch, Source } from "./contract";
import { formatUtcDate, formatUtcTime } from "./format";

/** A set of epochs the viewer cycles through: one blink pair, or every epoch. */
export interface Sequence {
  key: string;
  label: string;
  epochs: Epoch[];
  /** true / false for a backend blink pair; null for the all-dates sequence. */
  lambdaMatched: boolean | null;
  /** The backend's plain-language description of the pair, if any. */
  labelPlain: string | null;
}

/** An image is only rendered when we can say where it came from. */
export function hasSource(source: Source | null | undefined): source is Source {
  return (
    !!source &&
    typeof source.file === "string" &&
    source.file.length > 0 &&
    typeof source.obs_id === "string" &&
    source.obs_id.length > 0
  );
}

/** The epoch's field image can be shown: it has a URL and a source. */
export function canRender(epoch: Epoch): boolean {
  return !!epoch.image?.url && hasSource(epoch.image.source);
}

export function orderEpochs(epochs: Epoch[]): Epoch[] {
  return [...epochs].sort((a, b) => a.mjd - b.mjd);
}

/**
 * Builds the sequences the viewer offers. Wavelength-matched pairs come
 * first so they are the default; pairs that reference unknown epochs are
 * dropped. An "all dates" sequence is always offered when there are at
 * least two epochs.
 */
export function buildSequences(epochs: Epoch[], pairs: BlinkPair[]): Sequence[] {
  const byId = new Map(epochs.map((e) => [e.epoch_id, e]));
  const seen = new Set<string>();
  const out: Sequence[] = [];

  for (const pair of pairs) {
    const a = byId.get(pair.epoch_id_a);
    const b = byId.get(pair.epoch_id_b);
    if (!a || !b || a === b) continue;
    const [first, second] = a.mjd <= b.mjd ? [a, b] : [b, a];
    const key = `pair:${first.epoch_id}:${second.epoch_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: pairLabel(first, second),
      epochs: [first, second],
      lambdaMatched: pair.lambda_matched === true,
      labelPlain: pair.label_plain || null,
    });
  }

  out.sort((x, y) => {
    if (x.lambdaMatched !== y.lambdaMatched) return x.lambdaMatched ? -1 : 1;
    return (x.epochs[0]?.mjd ?? 0) - (y.epochs[0]?.mjd ?? 0);
  });

  const ordered = orderEpochs(epochs);
  if (ordered.length >= 2) {
    out.push({ key: "all", label: `All ${ordered.length} dates`, epochs: ordered, lambdaMatched: null, labelPlain: null });
  } else if (out.length === 0 && ordered.length === 1) {
    out.push({ key: "all", label: "1 date", epochs: ordered, lambdaMatched: null, labelPlain: null });
  }
  return out;
}

/** "Jun 5, 2025 → Jun 8, 2025", or with times when both fall on the same day. */
function pairLabel(a: Epoch, b: Epoch): string {
  const da = formatUtcDate(a.time_utc);
  const db = formatUtcDate(b.time_utc);
  if (da !== db) return `${da} → ${db}`;
  return `${da}, ${formatUtcTime(a.time_utc).replace(" UTC", "")} → ${formatUtcTime(b.time_utc)}`;
}
