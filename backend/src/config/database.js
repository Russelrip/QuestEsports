const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const { env } = require("./env");
const { TOURNAMENT_CATALOGUE } = require("../constants/tournaments");

const databasePath = path.resolve(process.cwd(), env.DATABASE_PATH);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma("foreign_keys = ON");

const ensureColumn = (tableName, columnName, definition) => {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => column.name === columnName);

  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
};

const initializeDatabase = async () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      email_normalized TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      username_normalized TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      phone TEXT,
      discord_tag TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contact_submissions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS team_registrations (
      id TEXT PRIMARY KEY,
      tournament_id TEXT NOT NULL,
      team_name TEXT NOT NULL,
      captain_name TEXT NOT NULL,
      captain_email TEXT NOT NULL,
      captain_phone TEXT NOT NULL,
      captain_discord TEXT NOT NULL,
      captain_riot_id TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      team_logo_name TEXT,
      rulebook_accepted INTEGER NOT NULL DEFAULT 0,
      falsity_warning_accepted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tournament_id, team_name),
      UNIQUE (tournament_id, captain_email),
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS registration_members (
      id TEXT PRIMARY KEY,
      registration_id TEXT NOT NULL,
      role TEXT NOT NULL,
      member_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      discord TEXT,
      riot_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (registration_id, role, member_order),
      FOREIGN KEY (registration_id) REFERENCES team_registrations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  ensureColumn("users", "role", "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn("users", "last_login_at", "TEXT");

  const upsertTournament = db.prepare(`
    INSERT INTO tournaments (id, slug, title, is_active)
    VALUES (@id, @slug, @title, 1)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      is_active = 1,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const tournament of TOURNAMENT_CATALOGUE) {
    upsertTournament.run({
      id: crypto.randomUUID(),
      slug: tournament.slug,
      title: tournament.title,
    });
  }
};

const closeDatabase = async () => {
  db.close();
};

module.exports = {
  db,
  initializeDatabase,
  closeDatabase,
};
