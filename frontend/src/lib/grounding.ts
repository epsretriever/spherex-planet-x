/**
 * Resolves explanation.grounded_fields paths such as
 * "known_object.per_epoch[0].separation_arcsec" inside a JSON document.
 */
export function resolvePath(doc: unknown, path: string): { found: boolean; value: unknown } {
  const tokens: (string | number)[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  let consumed = "";
  while ((m = re.exec(path))) {
    tokens.push(m[2] !== undefined ? Number(m[2]) : m[1]!);
    consumed += m[0];
  }
  // Reject anything the tokenizer skipped other than dots, e.g. "a[x]".
  if (!tokens.length || consumed.length !== path.replace(/\./g, "").length) return { found: false, value: undefined };

  let cur: unknown = doc;
  for (const t of tokens) {
    if (typeof t === "number") {
      if (!Array.isArray(cur) || t >= cur.length) return { found: false, value: undefined };
      cur = cur[t];
    } else {
      if (cur === null || typeof cur !== "object" || Array.isArray(cur) || !(t in cur)) {
        return { found: false, value: undefined };
      }
      cur = (cur as Record<string, unknown>)[t];
    }
  }
  return { found: true, value: cur };
}

export interface GroundedValue {
  path: string;
  value: unknown;
}

export function resolveGrounded(doc: unknown, paths: string[]): { values: GroundedValue[]; missing: string[] } {
  const values: GroundedValue[] = [];
  const missing: string[] = [];
  for (const path of paths) {
    const r = resolvePath(doc, path);
    if (r.found) values.push({ path, value: r.value });
    else missing.push(path);
  }
  return { values, missing };
}

export type TextPart = { text: string; ref?: number };

/**
 * Splits explanation text so each number that matches a grounded numeric
 * value (after rounding to the number of decimals written) points at that
 * value's index in `values`.
 */
export function linkNumbers(text: string, values: GroundedValue[]): TextPart[] {
  const parts: TextPart[] = [];
  const re = /[-−]?\d+(?:\.\d+)?/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const num = Number(raw.replace("−", "-"));
    const decimals = raw.split(".")[1]?.length ?? 0;
    const ref = values.findIndex(
      (v) =>
        typeof v.value === "number" &&
        (Number(v.value.toFixed(decimals)) === num || Number(Math.abs(v.value).toFixed(decimals)) === Math.abs(num)),
    );
    if (ref === -1) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: raw, ref });
    last = m.index + raw.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
