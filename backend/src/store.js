const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
function openStore(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL,
      steam_id TEXT UNIQUE, steam_name TEXT, steam_avatar TEXT
    );
    CREATE TABLE IF NOT EXISTS access_tokens (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      family TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      family TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS email_tokens (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS steam_tickets (
      id TEXT PRIMARY KEY, browser_hash TEXT UNIQUE NOT NULL, poll_hash TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, family TEXT NOT NULL,
      expires INTEGER NOT NULL, started INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending', error TEXT
    );
    CREATE TABLE IF NOT EXISTS steam_nonces (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS access_user ON access_tokens(user_id);
    CREATE INDEX IF NOT EXISTS refresh_user ON refresh_tokens(user_id);
  `);
  if (file !== ':memory:') fs.chmodSync(file, 0o600);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {
    db, transaction,
    get: (sql, ...args) => db.prepare(sql).get(...args),
    all: (sql, ...args) => db.prepare(sql).all(...args),
    run: (sql, ...args) => db.prepare(sql).run(...args),
    cleanup(now) {
      db.prepare('DELETE FROM access_tokens WHERE expires < ?').run(now);
      db.prepare('DELETE FROM refresh_tokens WHERE expires < ?').run(now);
      db.prepare('DELETE FROM email_tokens WHERE expires < ?').run(now);
      db.prepare('DELETE FROM steam_tickets WHERE expires < ?').run(now);
      db.prepare('DELETE FROM steam_nonces WHERE expires < ?').run(now);
    },
    close: () => db.close()
  };
}
module.exports = { openStore };
