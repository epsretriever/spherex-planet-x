// Temporary probe: prints real SBDB, Horizons and IRSA TAP responses so the /api/find parsers
// are written against the services' actual formats. Run by .github/workflows/find-probe.yml.
const UA = "spherex-planet-x find probe (NASA Space Apps 2026)";
const show = async (label, url, init, n = 2500) => {
  const t = Date.now();
  try {
    const r = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(90000) });
    const body = await r.text();
    console.log(`\n===== ${label} HTTP ${r.status} ${Date.now() - t} ms, ${body.length} bytes, ${body.split("\n").length} lines`);
    console.log(body.slice(0, n));
  } catch (e) {
    console.log(`\n===== ${label} FAILED after ${Date.now() - t} ms: ${e} ${e.cause ?? ""}`);
  }
};
const tap = "https://irsa.ipac.caltech.edu/TAP/sync";
const q = (sql) => ({ method: "POST", body: new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "csv", QUERY: sql }) });
const O = "SELECT obs_id, s_ra, s_dec, t_min, t_max, energy_bandpassname, em_min, em_max, access_url, s_region FROM spherex.obscore WHERE ";
await show("obscore contains center", tap, q(O + "t_min BETWEEN 60825 AND 60835 AND 1 = CONTAINS(POINT('ICRS', s_ra, s_dec), CIRCLE('ICRS', 347.07, -3.80, 3.0))"), 1800);
await show("obscore box", tap, q(O + "t_min BETWEEN 60825 AND 60835 AND s_ra BETWEEN 344 AND 350 AND s_dec BETWEEN -7 AND -1"), 600);
await show("obscore box OR x3", tap, q(O + "(t_min BETWEEN 60825 AND 60835 AND s_ra BETWEEN 344 AND 350 AND s_dec BETWEEN -7 AND -1) OR (t_min BETWEEN 61000 AND 61010 AND s_ra BETWEEN 5 AND 12 AND s_dec BETWEEN 0 AND 6) OR (t_min BETWEEN 61100 AND 61110 AND s_ra BETWEEN 100 AND 106 AND s_dec BETWEEN 20 AND 26)"), 300);
const many = Array.from({ length: 40 }, (_, i) => `(t_min BETWEEN ${60800 + i * 10} AND ${60810 + i * 10} AND s_ra BETWEEN ${(i * 9) % 354} AND ${((i * 9) % 354) + 6} AND s_dec BETWEEN -5 AND 1)`).join(" OR ");
await show("obscore box OR x40", tap, q(O + many), 300);
await show("plane poly select", tap, q("SELECT TOP 2 p.planeid, p.poly, p.pt, p.datarelease FROM spherex.plane p WHERE p.time_bounds_lower BETWEEN 60828 AND 60828.1"), 1500);
await show("artifact uri", tap, q("SELECT TOP 3 a.uri, a.producttype, a.contenttype FROM spherex.artifact a"), 800);
await show("obscore max time", tap, q("SELECT MAX(t_min), MIN(t_min), COUNT(*) FROM spherex.obscore"), 400);
