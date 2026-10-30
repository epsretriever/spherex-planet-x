import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, ensureSchema, statements } from "../src/db";
import { sqliteD1 } from "./d1";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

describe("D1 schema", () => {
  it("embeds exactly the SQL in migrations/", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(files.map((f) => f.replace(/\.sql$/, ""))).toEqual(MIGRATIONS.map((m) => m.id));
    for (const m of MIGRATIONS) {
      expect(m.sql).toBe(readFileSync(join(MIGRATIONS_DIR, `${m.id}.sql`), "utf8"));
    }
  });

  it("splits into statements without comments", () => {
    const s = statements(MIGRATIONS[0]!.sql);
    expect(s.every((x) => !x.startsWith("--"))).toBe(true);
    expect(s.filter((x) => x.startsWith("CREATE TABLE")).length).toBe(7);
    expect(statements(MIGRATIONS[1]!.sql).filter((x) => x.startsWith("CREATE TABLE")).length).toBe(2);
  });

  it("creates every table, is idempotent, and enforces constraints", async () => {
    const { d1, db } = await sqliteD1();
    await ensureSchema(d1);
    await ensureSchema(d1); // second call in the same isolate is a no-op
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[])
      .map((r) => r.name)
      .filter((n) => n !== "sqlite_sequence");
    expect(tables).toEqual([
      "ai_usage",
      "enrichment",
      "locks",
      "model_versions",
      "rate_limits",
      "schema_migrations",
      "sky_requests",
      "tracked_objects",
      "vetting_items",
      "votes",
    ]);
    expect((db.prepare("SELECT id FROM schema_migrations").all() as { id: string }[]).map((r) => r.id)).toEqual(["0001_init", "0002_enrichment"]);
    const now = "2026-10-30T00:00:00Z";
    expect(() =>
      db.prepare("INSERT INTO sky_requests (request_id, ra_deg, dec_deg, client_hash, created_utc, updated_utc) VALUES (?,?,?,?,?,?)").run("r1", 400, 0, "h", now, now),
    ).toThrow();
    db.prepare("INSERT INTO vetting_items (item_id, epoch_id, stamps_json, created_utc) VALUES ('i1','e01','{}',?)").run(now);
    db.prepare("INSERT INTO votes (item_id, label, session_hash, created_utc) VALUES ('i1','real','s1',?)").run(now);
    // one vote per session per item
    expect(() => db.prepare("INSERT INTO votes (item_id, label, session_hash, created_utc) VALUES ('i1','artifact','s1',?)").run(now)).toThrow();
    expect(() => db.prepare("INSERT INTO votes (item_id, label, session_hash, created_utc) VALUES ('i1','maybe','s2',?)").run(now)).toThrow();
  });
});
