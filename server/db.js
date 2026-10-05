// SQLite-Datenbank (eingebautes node:sqlite) mit einfachen, versionierten Migrationen.

import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  // 1: Nutzer, Sitzungen, Nutzerdaten, Bankverbindungen, Protokoll
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    password_changed_at INTEGER NOT NULL
  );

  -- Es wird nur der SHA-256-Hash des Sitzungstokens gespeichert, nie das Token selbst.
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    user_agent TEXT,
    ip TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE user_data (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
  );

  -- config ist mit AES-256-GCM verschlüsselt (enthält ggf. API-Schlüssel)
  CREATE TABLE connections (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    label TEXT NOT NULL,
    config TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_sync_at INTEGER,
    last_status TEXT,
    last_message TEXT,
    snapshot TEXT
  );
  CREATE INDEX connections_user ON connections(user_id);

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    detail TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX audit_user ON audit_log(user_id, created_at);
  `,
];

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}
