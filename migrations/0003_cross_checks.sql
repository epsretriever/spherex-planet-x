-- spherex-planet-x D1 schema, version 3: answers from catalogs other than JPL (IMCCE SkyBoT),
-- one row per candidate and catalog. Written by the Worker's cron (worker/src/scheduled.ts) in a
-- slow rotation and read in one query by list views.

CREATE TABLE IF NOT EXISTS cross_checks (
  candidate_id  TEXT NOT NULL,
  catalog       TEXT NOT NULL,
  outcome       TEXT NOT NULL CHECK (outcome IN ('match', 'none', 'failed')),
  designation   TEXT,
  checked_utc   TEXT NOT NULL,
  record        TEXT NOT NULL,
  PRIMARY KEY (candidate_id, catalog)
);
