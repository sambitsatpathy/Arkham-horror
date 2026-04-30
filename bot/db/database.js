const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.ARKHAM_DB_PATH || path.join(__dirname, 'arkham.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    init();
  }
  return db;
}

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign (
      id              INTEGER PRIMARY KEY,
      name            TEXT NOT NULL,
      scenario_index  INTEGER DEFAULT 0,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS players (
      id                  INTEGER PRIMARY KEY,
      campaign_id         INTEGER NOT NULL,
      discord_id          TEXT NOT NULL,
      discord_name        TEXT NOT NULL,
      investigator_code   TEXT,
      investigator_name   TEXT,
      is_host             INTEGER DEFAULT 0,
      hp                  INTEGER DEFAULT 0,
      max_hp              INTEGER DEFAULT 0,
      sanity              INTEGER DEFAULT 0,
      max_sanity          INTEGER DEFAULT 0,
      resources           INTEGER DEFAULT 5,
      clues               INTEGER DEFAULT 0,
      action_count        INTEGER DEFAULT 3,
      location_code       TEXT DEFAULT '',
      deck                TEXT DEFAULT '[]',
      hand                TEXT DEFAULT '[]',
      discard             TEXT DEFAULT '[]',
      xp_total            INTEGER DEFAULT 0,
      xp_spent            INTEGER DEFAULT 0,
      physical_trauma     INTEGER DEFAULT 0,
      mental_trauma       INTEGER DEFAULT 0,
      is_eliminated       INTEGER DEFAULT 0,
      is_killed           INTEGER DEFAULT 0,
      is_insane           INTEGER DEFAULT 0,
      deck_ready          INTEGER DEFAULT 0,
      arkhamdb_deck_id    TEXT,
      deck_name           TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaign(id),
      UNIQUE (discord_id, campaign_id)
    );

    CREATE TABLE IF NOT EXISTS game_session (
      id                  INTEGER PRIMARY KEY,
      campaign_id         INTEGER NOT NULL,
      scenario_code       TEXT NOT NULL,
      difficulty          TEXT NOT NULL,
      phase               TEXT DEFAULT 'pregame',
      doom                INTEGER DEFAULT 0,
      doom_threshold      INTEGER NOT NULL,
      act_index           INTEGER DEFAULT 0,
      agenda_index        INTEGER DEFAULT 0,
      round               INTEGER DEFAULT 1,
      encounter_deck      TEXT DEFAULT '[]',
      encounter_discard   TEXT DEFAULT '[]',
      pending_encounter   TEXT DEFAULT '[]',
      doom_channel_id     TEXT,
      agenda_channel_id   TEXT,
      act_channel_id      TEXT,
      chaos_channel_id    TEXT,
      encounter_channel_id TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaign(id)
    );

    CREATE TABLE IF NOT EXISTS locations (
      id                INTEGER PRIMARY KEY,
      session_id        INTEGER NOT NULL,
      code              TEXT NOT NULL,
      name              TEXT NOT NULL,
      channel_id        TEXT,
      status            TEXT DEFAULT 'hidden',
      clues             INTEGER DEFAULT 0,
      doom              INTEGER DEFAULT 0,
      act_index         INTEGER DEFAULT 0,
      shroud            INTEGER DEFAULT 0,
      status_message_id TEXT,
      card_message_id   TEXT,
      FOREIGN KEY (session_id) REFERENCES game_session(id)
    );

    CREATE TABLE IF NOT EXISTS enemies (
      id              INTEGER PRIMARY KEY,
      session_id      INTEGER NOT NULL,
      location_code   TEXT NOT NULL,
      card_code       TEXT NOT NULL,
      name            TEXT NOT NULL,
      hp              INTEGER NOT NULL,
      max_hp          INTEGER NOT NULL,
      fight           INTEGER NOT NULL,
      evade           INTEGER NOT NULL,
      damage          INTEGER NOT NULL,
      horror          INTEGER NOT NULL,
      is_alerted      INTEGER DEFAULT 0,
      is_exhausted    INTEGER DEFAULT 0,
      is_hunter       INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES game_session(id)
    );

    CREATE TABLE IF NOT EXISTS campaign_log (
      id              INTEGER PRIMARY KEY,
      campaign_id     INTEGER NOT NULL,
      scenario_code   TEXT,
      entry           TEXT NOT NULL,
      is_crossed_out  INTEGER DEFAULT 0,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaign(id)
    );

    CREATE TABLE IF NOT EXISTS deck_upgrades (
      id              INTEGER PRIMARY KEY,
      campaign_id     INTEGER NOT NULL,
      player_id       INTEGER NOT NULL,
      scenario_index  INTEGER NOT NULL,
      card_added      TEXT NOT NULL,
      card_removed    TEXT,
      xp_spent        INTEGER DEFAULT 0,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaign(id),
      FOREIGN KEY (player_id) REFERENCES players(id)
    );
  `);

  // Migrations
  const playerCols = db.prepare("PRAGMA table_info(players)").all().map(c => c.name);
  if (!playerCols.includes('assets')) {
    db.exec("ALTER TABLE players ADD COLUMN assets TEXT DEFAULT '[]'");
  }
  if (!playerCols.includes('scry_buffer')) {
    db.exec("ALTER TABLE players ADD COLUMN scry_buffer TEXT DEFAULT '[]'");
  }
  if (!playerCols.includes('threat_area')) {
    db.exec("ALTER TABLE players ADD COLUMN threat_area TEXT DEFAULT '[]'");
  }

  const sessionCols = db.prepare("PRAGMA table_info(game_session)").all().map(c => c.name);
  if (!sessionCols.includes('campaign_dir')) {
    db.exec("ALTER TABLE game_session ADD COLUMN campaign_dir TEXT DEFAULT 'night_of_zealot'");
  }

  const enemyCols = db.prepare("PRAGMA table_info(enemies)").all().map(c => c.name);
  if (!enemyCols.includes('is_hunter')) {
    db.exec("ALTER TABLE enemies ADD COLUMN is_hunter INTEGER DEFAULT 0");
  }
  if (!enemyCols.includes('is_aloof')) {
    db.exec("ALTER TABLE enemies ADD COLUMN is_aloof INTEGER DEFAULT 0");
  }
}

module.exports = { getDb };
