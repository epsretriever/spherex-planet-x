-- spherex-planet-x D1 schema, version 1.
-- Applied by `npx wrangler d1 migrations apply DB --remote` and, idempotently, by the Worker on
-- first use (worker/src/db.ts keeps an identical copy; a test enforces it).
-- Visitor identifiers are never stored raw: session_hash and client_hash are SHA-256 digests
-- salted with a server secret.

CREATE TABLE IF NOT EXISTS sky_requests (
  request_id   TEXT PRIMARY KEY,
  ra_deg       REAL NOT NULL CHECK (ra_deg >= 0 AND ra_deg < 360),
  dec_deg      REAL NOT NULL CHECK (dec_deg >= -90 AND dec_deg <= 90),
  note         TEXT CHECK (note IS NULL OR length(note) <= 200),
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'processing', 'done', 'no_coverage', 'rejected')),
  field_id     TEXT,
  message      TEXT,
  client_hash  TEXT NOT NULL,
  created_utc  TEXT NOT NULL,
  updated_utc  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sky_requests_status ON sky_requests (status, created_utc);

CREATE TABLE IF NOT EXISTS vetting_items (
  item_id        TEXT PRIMARY KEY,
  candidate_id   TEXT,
  epoch_id       TEXT NOT NULL,
  stamps_json    TEXT NOT NULL,
  model_score    REAL,
  model_version  TEXT,
  expert_label   TEXT CHECK (expert_label IS NULL OR expert_label IN ('real', 'artifact')),
  active         INTEGER NOT NULL DEFAULT 1,
  created_utc    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vetting_items_active ON vetting_items (active, model_score);

CREATE TABLE IF NOT EXISTS votes (
  vote_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       TEXT NOT NULL REFERENCES vetting_items (item_id),
  label         TEXT NOT NULL CHECK (label IN ('real', 'artifact', 'unsure')),
  session_hash  TEXT NOT NULL,
  created_utc   TEXT NOT NULL,
  UNIQUE (item_id, session_hash)
);
CREATE INDEX IF NOT EXISTS votes_item ON votes (item_id);

CREATE TABLE IF NOT EXISTS model_versions (
  version         TEXT PRIMARY KEY,
  trained_utc     TEXT NOT NULL,
  n_train_real    INTEGER NOT NULL,
  n_train_bogus   INTEGER NOT NULL,
  n_votes_used    INTEGER NOT NULL,
  test_precision  REAL NOT NULL,
  test_recall     REAL NOT NULL,
  test_roc_auc    REAL NOT NULL,
  promoted        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracked_objects (
  object_id       TEXT PRIMARY KEY,
  designation     TEXT,
  classification  TEXT NOT NULL,
  orbit_status    TEXT NOT NULL DEFAULT 'none',
  first_seen_utc  TEXT NOT NULL,
  last_seen_utc   TEXT NOT NULL,
  updated_utc     TEXT NOT NULL
);

-- Fixed-window rate limits: key is e.g. 'votes:<session_hash>' or 'ask:<client_hash>'.
CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL
);

-- Workers AI usage per day, to stay inside the free daily neuron allowance.
CREATE TABLE IF NOT EXISTS ai_usage (
  day          TEXT NOT NULL,
  kind         TEXT NOT NULL,
  calls        INTEGER NOT NULL DEFAULT 0,
  neurons_est  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
