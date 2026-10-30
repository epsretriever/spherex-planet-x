-- spherex-planet-x D1 schema, version 2: JPL known-object results and lookup locks.
-- Moved from Workers KV so list views read every result in one query and refreshes are not
-- limited by KV's 1,000 writes per day. KV records written before this migration are still read
-- (and copied here) until they expire.

CREATE TABLE IF NOT EXISTS enrichment (
  pipeline_version TEXT NOT NULL,
  candidate_id     TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('checked', 'failed')),
  matched          INTEGER NOT NULL DEFAULT 0,
  designation      TEXT,
  attempted_utc    TEXT NOT NULL,
  record           TEXT NOT NULL,
  PRIMARY KEY (pipeline_version, candidate_id)
);

CREATE INDEX IF NOT EXISTS enrichment_designation ON enrichment (pipeline_version, designation);

CREATE TABLE IF NOT EXISTS locks (
  key        TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
