import json, sys, time
import requests

UA = {"User-Agent": "Driftnet (SPHEREx moving-object survey; github.com/epsretriever/spherex-planet-x)"}

def show(label, fn):
    print(f"\n===== {label}", flush=True)
    t = time.time()
    try:
        r = fn()
        print(f"HTTP {r.status_code} in {time.time()-t:.1f}s; content-type={r.headers.get('content-type')}; "
              f"cors={r.headers.get('access-control-allow-origin')}; len={len(r.text)}")
        print(r.text[:int(sys.argv[1]) if len(sys.argv) > 1 else 1800])
    except Exception as e:
        print(f"ERROR after {time.time()-t:.1f}s: {type(e).__name__}: {e}")

SKY = "https://ssp.imcce.fr/webservices/skybot/api/conesearch.php"
base = {"-mime": "json", "-output": "basic", "-observer": "500", "-filter": "0", "-objFilter": "111", "-from": "Driftnet"}
show("skybot gedania rs=120", lambda: requests.get(SKY, params={**base, "-ep": "2025-08-15T06:13:59.871Z", "-ra": "243.386885", "-dec": "-20.5792041", "-rs": "120"}, headers=UA, timeout=60))
show("skybot gedania rs=600 (several objects?)", lambda: requests.get(SKY, params={**base, "-ep": "2025-08-15T06:13:59.871Z", "-ra": "243.386885", "-dec": "-20.5792041", "-rs": "900"}, headers=UA, timeout=60))
show("skybot empty sky", lambda: requests.get(SKY, params={**base, "-ep": "2025-08-15T06:13:59.871Z", "-ra": "10.0", "-dec": "85.0", "-rs": "30"}, headers=UA, timeout=60))
show("skybot bad request", lambda: requests.get(SKY, params={**base, "-ep": "nonsense", "-ra": "10.0", "-dec": "85.0", "-rs": "30"}, headers=UA, timeout=60))
show("skybot output=all", lambda: requests.get(SKY, params={**base, "-output": "all", "-ep": "2025-08-15T06:13:59.871Z", "-ra": "243.386885", "-dec": "-20.5792041", "-rs": "120"}, headers=UA, timeout=60))

QI = "https://data.minorplanetcenter.net/api/query-identifier"
for ident in ["764 Gedania (A913 SF)", "764", "Gedania", "A913 SF", "2019 AB12", "(2019 AB12)", "67P", "no such thing 99"]:
    show(f"mpc query-identifier GET body {ident!r}", lambda ident=ident: requests.get(QI, data=ident, headers=UA, timeout=60))
show("mpc query-identifier POST override", lambda: requests.post(QI, data="764", headers={**UA, "X-HTTP-Method-Override": "GET"}, timeout=60))
show("mpc get-orb GET json", lambda: requests.get("https://data.minorplanetcenter.net/api/get-orb", json={"desig": "764"}, headers=UA, timeout=60))

form = {"year": "2025", "month": "08", "day": "15.25972", "which": "pos", "ra": "16 13 32.85", "decl": "-20 34 45.1",
        "TextArea": "", "radius": "5", "limit": "24.0", "oc": "500", "sort": "d", "mot": "h", "tmot": "s",
        "pdes": "u", "needed": "f", "ps": "n", "type": "p"}
for host in ["https://minorplanetcenter.net", "https://www.minorplanetcenter.net", "https://cgi.minorplanetcenter.net"]:
    show(f"mpchecker POST {host}", lambda host=host: requests.post(host + "/cgi-bin/mpcheck.cgi", data=form, headers=UA, timeout=90))
show("mpchecker oc lookup: SPHEREx code?", lambda: requests.get("https://data.minorplanetcenter.net/api/obscodes", json={}, headers=UA, timeout=60))
show("mpc search_orbits legacy", lambda: requests.post("https://minorplanetcenter.net/web_service/search_orbits", data={"number": "764", "json": "1"}, auth=("mpc_ws", "mpc!!ws"), headers=UA, timeout=60))
show("lowell astorb query", lambda: requests.get("https://asteroid.lowell.edu/api/asteroids/764", headers=UA, timeout=60))
show("jpl sbident", lambda: requests.get("https://ssd-api.jpl.nasa.gov/sb_ident.api?lat=0&lon=0&alt=0&obs-time=2025-06-03_08:03:01&fov-ra-center=23-06-53.52&fov-dec-center=M05-27-03.6&fov-ra-hwidth=0.01&fov-dec-hwidth=0.01&two-pass=false", headers=UA, timeout=60))
