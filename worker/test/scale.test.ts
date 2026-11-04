import { describe, expect, it } from "vitest";
import type { CandidateList, KnownObject, ObjectDetail, ObjectList, ObjectSummary } from "../src/contract";
import type { Deps } from "../src/env";
import { designationKey, mergeByDesignation } from "../src/routes/objects";
import { refreshStale } from "../src/scheduled";
import { FAILED_RETRY_SECONDS, isStale, readRecord, readRecords, refreshRecord, writeRecord } from "../src/store";
import { sqliteD1 } from "./d1";
import { candidate, list } from "./factory";
import { MemoryKv, json, makeClient } from "./helpers";

const V = "test";
const NOW = new Date("2026-10-29T12:00:00Z");

const known = (designation: string | null, checked = true): KnownObject => ({
  checked,
  not_checked_reason: checked ? null : "JPL did not answer.",
  matched: designation !== null,
  catalogs_checked: checked ? ["JPL SBIdent"] : [],
  search_radius_arcsec: 15,
  designation,
  predicted_vmag: designation ? 18.2 : null,
  per_epoch: [],
  nearest: null,
  observer: null,
  query_utc: NOW.toISOString(),
  enrichment: "cached",
});

async function deps(over: Partial<Deps> = {}): Promise<Deps> {
  return {
    fetch: (async () => {
      throw new TypeError("network disabled in tests");
    }) as unknown as typeof fetch,
    cache: null,
    kv: null,
    db: (await sqliteD1()).d1,
    budget: { remaining: 40 },
    waitUntil: () => undefined,
    now: () => NOW,
    ...over,
  };
}

describe("D1 store", () => {
  it("writes, reads one, and reads many in one query", async () => {
    const d = await deps();
    for (let i = 0; i < 5; i++) {
      await writeRecord(d, { candidate_id: `c${i}`, pipeline_version: V }, { known_object: known(i % 2 ? `2020 A${i}` : null), matched: i % 2 === 1 });
    }
    const one = await readRecord(d, { candidate_id: "c1", pipeline_version: V });
    expect(one?.enrichment.known_object.designation).toBe("2020 A1");
    expect(await readRecord(d, { candidate_id: "c1", pipeline_version: "other" })).toBeNull();
    let queries = 0;
    const db = d.db!;
    const counting = { ...db, prepare: (sql: string) => (sql.startsWith("SELECT") && queries++, db.prepare(sql)) } as unknown as D1Database;
    const many = await readRecords({ ...d, db: counting }, V, ["c0", "c1", "c3", "nope"]);
    expect([...many.keys()].sort()).toEqual(["c0", "c1", "c3"]);
    expect(queries).toBe(1);
  });

  it("copies records written to KV before D1 into D1", async () => {
    const kv = new MemoryKv();
    const ref = { candidate_id: "old", pipeline_version: V };
    await writeRecord({ ...(await deps()), db: null, kv }, ref, { known_object: known("1981 QB1"), matched: true });
    const d = await deps({ kv });
    expect((await readRecord(d, ref))?.enrichment.matched).toBe(true);
    kv.store.clear();
    expect((await readRecord(d, ref))?.enrichment.known_object.designation).toBe("1981 QB1");
  });

  it("the cron copies KV records into D1 instead of asking JPL again", async () => {
    const kv = new MemoryKv();
    const cand = candidate();
    const ref = { candidate_id: cand.candidate_id, pipeline_version: cand.pipeline_version };
    await writeRecord({ ...(await deps()), db: null, kv }, ref, { known_object: known("1981 QB1"), matched: true });
    const { d1 } = await sqliteD1();
    const c = makeClient({ files: { "/data/candidates.json": list([cand]) }, kv, db: d1 });
    const report = await refreshStale(c.env, c.deps);
    expect(report).toMatchObject({ considered: 1, stale: 0, refreshed: [] });
    expect(c.calls).toHaveLength(0);
    expect((await readRecords({ ...c.deps, kv: null }, V, [cand.candidate_id])).get(cand.candidate_id)?.enrichment.matched).toBe(true);
  });

  it("lets one lookup at a time hold the lock", async () => {
    const d = await deps();
    const cand = candidate();
    const first = await refreshRecord(d, cand); // network disabled: JPL "fails" but the lookup runs
    expect(first).not.toBeNull();
    expect(await refreshRecord(d, cand)).toBeNull(); // locked for 60 s
    const later = await refreshRecord({ ...d, now: () => new Date(NOW.getTime() + 61_000) }, cand);
    expect(later).not.toBeNull();
  });

  it("retries failed lookups only after the retry interval", () => {
    const failed = { v: 1 as const, status: "failed" as const, enrichment: { known_object: known(null, false), matched: false }, attempted_utc: NOW.toISOString() };
    expect(isStale(failed, new Date(NOW.getTime() + 60_000))).toBe(false);
    expect(isStale(failed, new Date(NOW.getTime() + FAILED_RETRY_SECONDS * 1000))).toBe(true);
    expect(isStale(null, NOW)).toBe(true);
  });
});

describe("hundreds of candidates", () => {
  const N = 300;
  const cands = Array.from({ length: N }, (_, i) =>
    candidate({ candidate_id: `sv-tile-${String(i).padStart(3, "0")}-c01`, field_id: `sv-tile-${i % 120}` }),
  );
  const files = { "/data/candidates.json": list(cands) };

  it("enriches every candidate from one store query, and pages", async () => {
    const { d1 } = await sqliteD1();
    const d = await deps({ db: d1 });
    for (let i = 0; i < N; i += 3) {
      await writeRecord(d, { candidate_id: cands[i]!.candidate_id, pipeline_version: V }, { known_object: known(`2000 X${i}`), matched: true });
    }
    let reads = 0;
    const kv = new MemoryKv();
    const kvGet = kv.get.bind(kv);
    kv.get = async (k: string) => (reads++, kvGet(k));
    const c = makeClient({ files, db: d1, kv });
    const all = (await json(await c.get("/api/candidates"))) as CandidateList;
    expect(all.total).toBe(N);
    expect(all.candidates.filter((s) => s.classification === "known_object")).toHaveLength(N / 3);
    const pages: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const p = (await json(await c.get(`/api/candidates?limit=128&offset=${offset}`))) as CandidateList;
      pages.push(...p.candidates.map((s) => s.candidate_id));
      expect(p.total).toBe(N);
      offset = p.next_offset ?? null;
    }
    // Unexplained first, then the known objects, each in list order (equal scores).
    const ids = cands.map((x) => x.candidate_id);
    expect(pages).toEqual([...ids.filter((_, i) => i % 3 !== 0), ...ids.filter((_, i) => i % 3 === 0)]);
    const kn = (await json(await c.get("/api/candidates?classification=known_object&limit=10"))) as CandidateList;
    expect([kn.total, kn.candidates.length, kn.next_offset]).toEqual([N / 3, 10, 10]);
    // With D1, list views never read KV, however many candidates there are.
    expect(reads).toBe(0);
  });

  it("rejects bad paging", async () => {
    const c = makeClient({ files });
    expect((await c.get("/api/candidates?limit=1000")).status).toBe(400);
    expect((await c.get("/api/objects?offset=-3")).status).toBe(400);
  });
});

describe("the same asteroid in several tiles", () => {
  const s = (id: string, designation: string | null, n: number, first: string, last: string, field = `f-${id}`): ObjectSummary => ({
    object_id: id,
    classification: designation ? "known_object" : "unmatched",
    label_plain: designation ? `Known: ${designation}` : "Unexplained",
    summary_plain: "x.",
    thumbnail_url: "/t.webp",
    field_ids: [field],
    candidate_ids: [id.replace("obj-", "")],
    n_detections: n,
    n_visits: 3,
    first_time_utc: first,
    last_time_utc: last,
    arc_hours: (Date.parse(last) - Date.parse(first)) / 3_600_000,
    rate_arcsec_per_hr: 30,
    distance_class: "unknown",
    distance_au_estimate: null,
    orbit_status: "none",
    overall_score: 0.8,
    quality_level: "high",
    known_object_checked: true,
    known_object_matched: designation !== null,
    known_object_designation: designation,
  });

  it("merges objects by designation, keeping the one with the most detections", () => {
    const a = s("obj-a", "2524 Budovicium (1981 QB1)", 13, "2025-06-01T00:00:00Z", "2025-06-02T00:00:00Z");
    const b = s("obj-b", "2524  budovicium (1981 qb1)", 30, "2025-06-03T00:00:00Z", "2025-06-04T00:00:00Z");
    const c = s("obj-c", null, 9, "2025-06-01T00:00:00Z", "2025-06-01T12:00:00Z");
    const d = s("obj-d", null, 9, "2025-06-01T00:00:00Z", "2025-06-01T12:00:00Z");
    const out = mergeByDesignation([a, b, c, d]);
    expect(out.map((o) => o.object_id)).toEqual(["obj-b", "obj-c", "obj-d"]); // unmatched never merge
    const m = out[0]!;
    expect(m.also_seen_as).toEqual(["obj-a"]);
    expect(m.field_ids).toEqual(["f-obj-b", "f-obj-a"]);
    expect(m.n_detections).toBe(43);
    expect([m.first_time_utc, m.last_time_utc, m.arc_hours]).toEqual(["2025-06-01T00:00:00Z", "2025-06-04T00:00:00Z", 72]);
    expect(m.summary_plain).toContain("Also seen in 1 other tile: 43 detections in all.");
    expect(designationKey(" 2524  Budovicium ")).toBe("2524 budovicium");
  });

  it("serves merged objects, also_seen_as on the detail, and distinct counts in the survey", async () => {
    const cA = candidate({ candidate_id: "tile1-c01", field_id: "tile1" });
    const cB = candidate({ candidate_id: "tile2-c01", field_id: "tile2" });
    const objs = [s("obj-tile1-c01", null, 13, "2025-06-01T00:00:00Z", "2025-06-02T00:00:00Z", "tile1"), s("obj-tile2-c01", null, 30, "2025-06-03T00:00:00Z", "2025-06-04T00:00:00Z", "tile2")].map((o) => ({
      ...o,
      classification: "unmatched" as const,
      known_object_checked: false,
      known_object_matched: false,
      known_object_designation: null,
    }));
    const objList = { schema_version: "1.1", pipeline_version: V, generated_utc: "2026-10-30T00:00:00Z", total: 2, objects: objs } as ObjectList;
    const detail = (o: ObjectSummary, c: typeof cA): ObjectDetail =>
      ({ ...c, schema_version: "1.1", object_id: o.object_id, field_ids: o.field_ids, candidate_ids: o.candidate_ids, distance_class: "unknown", orbit_status: "none", orbit: null, history: [], detections: [] }) as unknown as ObjectDetail;
    const files = {
      "/data/objects.json": objList,
      "/data/objects/obj-tile1-c01.json": detail(objs[0]!, cA),
      "/data/survey.json": { schema_version: "1.1", pipeline_version: V, tiles: [], totals: { n_tiles: 2, n_objects: 2 } },
      "/data/candidates.json": list([cA, cB]),
    };
    const { d1 } = await sqliteD1();
    const d = await deps({ db: d1 });
    for (const c of [cA, cB]) {
      await writeRecord(d, { candidate_id: c.candidate_id, pipeline_version: V }, { known_object: known("2524 Budovicium (1981 QB1)"), matched: true });
    }
    const c = makeClient({ files, db: d1 });
    const merged = (await json(await c.get("/api/objects"))) as ObjectList;
    expect(merged.total).toBe(1);
    expect(merged.objects[0]).toMatchObject({ object_id: "obj-tile2-c01", also_seen_as: ["obj-tile1-c01"], n_detections: 43 });
    const raw = (await json(await c.get("/api/objects?dedupe=false"))) as ObjectList;
    expect(raw.total).toBe(2);
    const det = (await json(await c.get("/api/objects/obj-tile1-c01"))) as ObjectDetail;
    expect(det.also_seen_as).toEqual(["obj-tile2-c01"]);
    const sv = (await json(await c.get("/api/survey"))) as { totals: { n_objects: number; n_known_objects: number } };
    expect(sv.totals).toMatchObject({ n_objects: 2, n_known_objects: 1 });
  });
});

