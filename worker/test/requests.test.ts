import { describe, expect, it } from "vitest";
import type { SkyRequest } from "../src/contract";
import { REQUESTS_PER_IP_PER_DAY, TURNSTILE_VERIFY } from "../src/routes/requests";
import { sqliteD1 } from "./d1";
import { json, makeClient } from "./helpers";

const ADMIN = { Authorization: "Bearer s3cret" };
const env = { TURNSTILE_SECRET: "ts", REQUESTS_ADMIN_TOKEN: "s3cret", HASH_SALT: "salt" };
const turnstile = (ok: boolean) => (url: URL) =>
  url.toString() === TURNSTILE_VERIFY ? Response.json({ success: ok }) : new Response("unexpected", { status: 500 });
const post = (body: unknown, ip = "203.0.113.7") => ({
  method: "POST",
  headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
  body: JSON.stringify(body),
});
const ask = { ra_deg: 21.7765, dec_deg: 12.2314, turnstile_token: "tok", note: "near Pisces" };

describe("sky requests", () => {
  it("queues a verified request and reports its place in the queue", async () => {
    const { d1 } = await sqliteD1();
    const c = makeClient({ db: d1, env, upstream: turnstile(true) });
    const first = await c.get("/api/requests", post(ask));
    expect(first.status).toBe(201);
    const a = (await json(first)) as SkyRequest;
    expect(a).toMatchObject({ status: "queued", position_in_queue: 1, ra_deg: 21.7765, field_id: null });
    expect(a.request_id).toMatch(/^req-[0-9a-f]{16}$/);
    c.deps.now = () => new Date("2026-10-29T12:00:05Z");
    const b = (await json(await c.get("/api/requests", post({ ...ask, ra_deg: 30 })))) as SkyRequest;
    expect(b.position_in_queue).toBe(2);
    const got = (await json(await c.get(`/api/requests/${a.request_id}`))) as SkyRequest;
    expect(got.status).toBe("queued");
    // visitor addresses are stored only as salted hashes
    const row = await d1.prepare("SELECT client_hash FROM sky_requests WHERE request_id = ?").bind(a.request_id).first<{ client_hash: string }>();
    expect(row!.client_hash).not.toContain("203.0.113.7");
  });

  it("refuses failed bot checks, bad positions, missing configuration and floods", async () => {
    const { d1 } = await sqliteD1();
    expect((await makeClient({ db: d1, env, upstream: turnstile(false) }).get("/api/requests", post(ask))).status).toBe(403);
    const c = makeClient({ db: d1, env, upstream: turnstile(true) });
    expect((await c.get("/api/requests", post({ ...ask, ra_deg: 360 }))).status).toBe(400);
    expect((await c.get("/api/requests", post({ ...ask, dec_deg: "12" }))).status).toBe(400);
    expect((await c.get("/api/requests", post({ ...ask, turnstile_token: "" }))).status).toBe(400);
    expect((await c.get("/api/requests", post({ ...ask, note: "x".repeat(201) }))).status).toBe(400);
    expect((await makeClient({ db: d1, upstream: turnstile(true) }).get("/api/requests", post(ask))).status).toBe(503);
    expect((await makeClient({ env, upstream: turnstile(true) }).get("/api/requests", post(ask))).status).toBe(503);
    for (let i = 0; i < REQUESTS_PER_IP_PER_DAY; i++) expect((await c.get("/api/requests", post(ask, "198.51.100.1"))).status).toBe(201);
    expect((await c.get("/api/requests", post(ask, "198.51.100.1"))).status).toBe(429);
    expect((await c.get("/api/requests/req-0000000000000000")).status).toBe(404);
  });

  it("lets only the Action read the queue and move a request through its states", async () => {
    const { d1 } = await sqliteD1();
    const c = makeClient({ db: d1, env, upstream: turnstile(true) });
    const a = (await json(await c.get("/api/requests", post(ask)))) as SkyRequest;
    expect((await c.get("/api/requests/queue")).status).toBe(401);
    expect((await c.get("/api/requests/queue", { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    const q = (await json(await c.get("/api/requests/queue", { headers: ADMIN }))) as { requests: SkyRequest[] };
    expect(q.requests.map((r) => r.request_id)).toEqual([a.request_id]);
    const status = (body: unknown) =>
      c.get(`/api/requests/${a.request_id}/status`, { method: "POST", headers: { ...ADMIN, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await status({ status: "done" })).status).toBe(400); // done needs a field
    expect(((await json(await status({ status: "processing" }))) as SkyRequest).position_in_queue).toBeNull();
    const done = (await json(await status({ status: "done", field_id: "rq-a1b2", message: "1 moving object found" }))) as SkyRequest;
    expect(done).toMatchObject({ status: "done", field_id: "rq-a1b2", message: "1 moving object found" });
    expect(((await json(await c.get("/api/requests/queue", { headers: ADMIN }))) as { requests: unknown[] }).requests).toHaveLength(0);
  });
});
