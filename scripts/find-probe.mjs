// Temporary probe: prints real SBDB, Horizons and IRSA TAP responses so the /api/find parsers
// are written against the services' actual formats. Run by .github/workflows/find-probe.yml.
const UA = "spherex-planet-x find probe (NASA Space Apps 2026)";
const show = async (label, url, init) => {
  const t = Date.now();
  try {
    const r = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init?.headers ?? {}) } });
    const body = await r.text();
    console.log(`\n===== ${label} HTTP ${r.status} ${Date.now() - t} ms, ${body.length} bytes`);
    console.log(body.slice(0, 3500));
  } catch (e) {
    console.log(`\n===== ${label} FAILED ${e}`);
  }
};
const sbdb = "https://ssd-api.jpl.nasa.gov/sbdb.api";
await show("sbdb vesta", `${sbdb}?sstr=Vesta&phys-par=1`);
await show("sbdb 2024 YR4", `${sbdb}?sstr=${encodeURIComponent("2024 YR4")}&phys-par=1`);
await show("sbdb ambiguous", `${sbdb}?sstr=eros&phys-par=1`);
await show("sbdb comet", `${sbdb}?sstr=${encodeURIComponent("12P")}&phys-par=1`);
await show("sbdb none", `${sbdb}?sstr=notanasteroidxyz&phys-par=1`);
const hz = "https://ssd.jpl.nasa.gov/api/horizons.api";
const hq = (cmd, extra) =>
  `${hz}?` +
  new URLSearchParams({
    format: "json", COMMAND: cmd, OBJ_DATA: "NO", MAKE_EPHEM: "YES", EPHEM_TYPE: "OBSERVER", CENTER: "'500@399'",
    QUANTITIES: "'1,9,20,36'", ANG_FORMAT: "DEG", CSV_FORMAT: "YES", CAL_FORMAT: "JD", EXTRA_PREC: "YES", ...extra,
  });
await show("horizons 433 daily", hq("'433;'", { START_TIME: "'2025-06-01'", STOP_TIME: "'2025-06-04'", STEP_SIZE: "'1 d'" }));
await show("horizons comet", hq("'DES=12P;CAP;NOFRAG;'", { START_TIME: "'2025-06-01'", STOP_TIME: "'2025-06-03'", STEP_SIZE: "'1 d'" }));
await show("horizons tlist", hq("'DES=2024 YR4;'", { TLIST: "'2460828.927414' '2460829.5'", TLIST_TYPE: "JD", TIME_TYPE: "UT" }));
await show("horizons spherex observer", hq("'433;'", { CENTER: "'500@-163'", TLIST: "'2460828.927414'", TLIST_TYPE: "JD" }));
await show("horizons spherex lookup", `${hz}?format=json&COMMAND='SPHEREx'&MAKE_EPHEM='NO'`);
const tap = "https://irsa.ipac.caltech.edu/TAP/sync";
const q = (sql) => ({ method: "POST", body: new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "csv", QUERY: sql }) });
await show("tap columns plane", tap, q("SELECT column_name, datatype FROM TAP_SCHEMA.columns WHERE table_name = 'spherex.plane'"));
await show("tap columns artifact", tap, q("SELECT column_name, datatype FROM TAP_SCHEMA.columns WHERE table_name = 'spherex.artifact'"));
await show("tap tables", tap, q("SELECT table_name FROM TAP_SCHEMA.tables WHERE schema_name = 'spherex'"));
const or = [
  "(p.time_bounds_lower BETWEEN 60828 AND 60830 AND 1 = INTERSECTS(CIRCLE('ICRS', 347.07, -3.80, 0.5), p.poly))",
  "(p.time_bounds_lower BETWEEN 61000 AND 61010 AND 1 = INTERSECTS(CIRCLE('ICRS', 10.0, 5.0, 1.0), p.poly))",
].join(" OR ");
await show(
  "tap or-query",
  tap,
  q(
    "SELECT TOP 40 a.uri, p.planeid, p.energy_bandpassname, p.time_bounds_lower, p.time_bounds_upper, p.energy_bounds_lower, p.energy_bounds_upper, p.poly " +
      `FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid WHERE ${or}`,
  ),
);
await show(
  "tap contains",
  tap,
  q(
    "SELECT TOP 5 p.planeid, p.time_bounds_lower FROM spherex.plane p WHERE p.time_bounds_lower BETWEEN 60828 AND 60830 AND 1 = CONTAINS(POINT('ICRS', 347.07, -3.80), p.poly)",
  ),
);
