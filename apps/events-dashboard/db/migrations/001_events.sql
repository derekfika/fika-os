CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, event_reference TEXT NOT NULL UNIQUE, event_date TEXT NOT NULL DEFAULT '', lifecycle TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL, record_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_date_idx ON events(event_date);
CREATE INDEX IF NOT EXISTS events_lifecycle_idx ON events(lifecycle);
CREATE TABLE IF NOT EXISTS save_requests (request_id TEXT PRIMARY KEY, event_id TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(event_id) REFERENCES events(event_id));
