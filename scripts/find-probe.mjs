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
const sbdb = "https://ssd-api.jpl.nasa.gov/sbdb.api";
for (const s of ["zzzz", "Notaname", "1999", "apophis", "433 Eros", "C/2023 A3", "2025 MU"]) await show(`sbdb ${s}`, `${sbdb}?sstr=${encodeURIComponent(s)}&phys-par=1`, undefined, 600);
const hz = "https://ssd.jpl.nasa.gov/api/horizons.api";
const hq = (cmd, extra) =>
  `${hz}?` +
  new URLSearchParams({
    format: "json", COMMAND: cmd, OBJ_DATA: "NO", MAKE_EPHEM: "YES", EPHEM_TYPE: "OBSERVER", CENTER: "'500@399'",
    QUANTITIES: "'1,9,20,23,36'", ANG_FORMAT: "DEG", CSV_FORMAT: "YES", CAL_FORMAT: "JD", EXTRA_PREC: "YES", ...extra,
  });
const tail = async (label, url) => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  const j = await r.json();
  const t = j.result ?? j.error ?? "";
  const i = t.indexOf("Date_");
  console.log(`\n===== ${label} HTTP ${r.status}\n${i >= 0 ? t.slice(i, i + 1500) : t.slice(0, 1500)}`);
};
await tail("horizons spherex center", hq("'433;'", { CENTER: "'500@-163182'", TLIST: "'2460828.927414' '2460829.5'", TLIST_TYPE: "JD", TIME_TYPE: "UT" }));
await tail("horizons daily long", hq("'4;'", { START_TIME: "'2025-04-20'", STOP_TIME: "'2026-11-05'", STEP_SIZE: "'1 d'" }));
await tail("horizons NONE", hq("'DES=1999 ZZZ99;'", { START_TIME: "'2025-04-20'", STOP_TIME: "'2025-04-22'", STEP_SIZE: "'1 d'" }));
const tap = "https://irsa.ipac.caltech.edu/TAP/sync";
const q = (sql) => ({ method: "POST", body: new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "csv", QUERY: sql }) });
const P = "SELECT a.uri, p.planeid, p.energy_bandpassname, p.time_bounds_lower, p.time_bounds_upper, p.energy_bounds_lower, p.energy_bounds_upper, p.poly FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid WHERE ";
await show("tap poly small", tap, q(P + "p.time_bounds_lower BETWEEN 60828 AND 60830 AND 1 = INTERSECTS(CIRCLE('ICRS', 347.07, -3.80, 0.2), p.poly)"), 1500);
await show("tap 3deg 10d", tap, q(P + "p.time_bounds_lower BETWEEN 60825 AND 60835 AND 1 = INTERSECTS(CIRCLE('ICRS', 347.07, -3.80, 3.0), p.poly)"), 400);
await show("tap 3deg 10d no join", tap, q("SELECT p.planeid, p.time_bounds_lower, p.poly FROM spherex.plane p WHERE p.time_bounds_lower BETWEEN 60825 AND 60835 AND 1 = INTERSECTS(CIRCLE('ICRS', 347.07, -3.80, 3.0), p.poly)"), 300);
await show("tap 6deg 45d", tap, q(P + "p.time_bounds_lower BETWEEN 60800 AND 60845 AND 1 = INTERSECTS(CIRCLE('ICRS', 347.07, -3.80, 6.0), p.poly)"), 300);
await show("tap or contains", tap, q("SELECT p.planeid FROM spherex.plane p WHERE 1 = CONTAINS(POINT('ICRS', 347.07, -3.80), p.poly) OR 1 = CONTAINS(POINT('ICRS', 10, 5), p.poly)"), 300);
await show("tap or time", tap, q("SELECT TOP 3 p.planeid FROM spherex.plane p WHERE (p.time_bounds_lower > 60828 AND p.time_bounds_lower < 60829) OR (p.time_bounds_lower > 61000 AND p.time_bounds_lower < 61001)"), 300);
await show("tap obscore cols", tap, q("SELECT column_name, datatype FROM TAP_SCHEMA.columns WHERE table_name = 'spherex.obscore'"), 1500);
await show("tap plane cols", tap, q("SELECT column_name, datatype FROM TAP_SCHEMA.columns WHERE table_name = 'spherex.plane'"), 2500);
await show("tap obscore 3deg", tap, q("SELECT obs_id, t_min, s_region, access_url FROM spherex.obscore WHERE t_min BETWEEN 60825 AND 60835 AND 1 = INTERSECTS(CIRCLE('ICRS', 347.07, -3.80, 3.0), s_region)"), 800);
