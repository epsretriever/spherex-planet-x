// How long does JPL SBIdent take for the queries the Worker makes, one at a time and six in
// parallel (as the Worker does)? Uses the Worker's own URL builder. Run with vite-node:
//   npx vite-node scripts/sbident-timing.ts -- https://spherex-planet-x.bodhishanbhag.workers.dev
import { sbidentSample } from "../worker/src/enrich";
import { sbidentUrl } from "../worker/src/jpl";

const base = (process.argv.at(-1) ?? "").replace(/\/$/, "");
const ua = { "User-Agent": "spherex-planet-x/0.1 (+https://github.com/epsretriever/spherex-planet-x)" };

async function timed(url: string, timeoutMs = 120_000) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: ua, signal: AbortSignal.timeout(timeoutMs) });
    await r.text();
    return { ms: Date.now() - t0, status: r.status };
  } catch (e) {
    return { ms: Date.now() - t0, status: (e as Error).name };
  }
}

const list = (await (await fetch(`${base}/api/candidates`)).json()) as { candidates: { candidate_id: string }[] };
const ids = list.candidates.slice(0, 3).map((c) => c.candidate_id);
for (const id of ids) {
  const c = (await (await fetch(`${base}/api/candidates/${id}`)).json()) as {
    detections: { mjd: number; time_utc: string; ra_deg: number; dec_deg: number; spacecraft_geocentric_km: number[] | null }[];
  };
  const urls = sbidentSample(c.detections).map((d) => sbidentUrl(d.time_utc, d.ra_deg, d.dec_deg, d.spacecraft_geocentric_km));
  const seq = [];
  for (const u of urls) seq.push(await timed(u));
  const par = await Promise.all(urls.map((u) => timed(u)));
  console.log(`${id}: ${urls.length} visits`);
  console.log(`  sequential: ${seq.map((x) => `${x.ms} ms (${x.status})`).join(", ")}`);
  console.log(`  parallel:   ${par.map((x) => `${x.ms} ms (${x.status})`).join(", ")}`);
}
