const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(__dirname, 'tmp_action_economy.db');

beforeAll(() => {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  process.env.ARKHAM_DB_PATH = TMP_DB;

  const { getDb } = require('../db/database');
  const db = getDb();
  db.prepare("INSERT INTO campaign (id, name) VALUES (1, 'test')").run();
  db.prepare("INSERT INTO players (id, campaign_id, discord_id, discord_name, action_count) VALUES (1, 1, 'u1', 'p1', 3)").run();
  db.prepare("INSERT INTO game_session (id, campaign_id, scenario_code, difficulty, doom_threshold, phase) VALUES (1, 1, 'test_scenario', 'standard', 3, 'investigation')").run();
});

afterAll(() => {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
});

function setActions(n) {
  const { getDb } = require('../db/database');
  getDb().prepare('UPDATE players SET action_count = ? WHERE id = 1').run(n);
}

describe('trySpendAction', () => {
  test('spends one action during investigation', () => {
    const { trySpendAction } = require('../engine/actionEconomy');
    setActions(3);
    const r = trySpendAction(1, { phase: 'investigation' });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(2);
    expect(r.note).toContain('2 remaining');
  });

  test('refuses at zero actions', () => {
    const { trySpendAction } = require('../engine/actionEconomy');
    setActions(0);
    const r = trySpendAction(1, { phase: 'investigation' });
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
  });

  test('fast plays are free and never refused', () => {
    const { trySpendAction } = require('../engine/actionEconomy');
    setActions(0);
    const r = trySpendAction(1, { phase: 'investigation' }, { fast: true });
    expect(r.ok).toBe(true);
    expect(r.note).toContain('Fast');
    const { getDb } = require('../db/database');
    expect(getDb().prepare('SELECT action_count FROM players WHERE id = 1').get().action_count).toBe(0);
  });

  test('not enforced outside the investigation phase', () => {
    const { trySpendAction } = require('../engine/actionEconomy');
    setActions(0);
    for (const phase of ['enemy', 'upkeep', 'mythos']) {
      const r = trySpendAction(1, { phase });
      expect(r.ok).toBe(true);
      expect(r.note).toBeNull();
    }
    const { getDb } = require('../db/database');
    expect(getDb().prepare('SELECT action_count FROM players WHERE id = 1').get().action_count).toBe(0);
  });

  test('multi-action cost refused when short', () => {
    const { trySpendAction } = require('../engine/actionEconomy');
    setActions(1);
    expect(trySpendAction(1, { phase: 'investigation' }, { cost: 2 }).ok).toBe(false);
    setActions(2);
    const r = trySpendAction(1, { phase: 'investigation' }, { cost: 2 });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(0);
  });
});

describe('readyAllEnemies', () => {
  test('clears is_exhausted for the session', () => {
    const { getDb } = require('../db/database');
    const db = getDb();
    db.prepare(`INSERT INTO enemies (id, session_id, location_code, card_code, name, hp, max_hp, fight, evade, damage, horror, is_exhausted)
                VALUES (1, 1, 'loc1', '01159', 'Ghoul', 3, 3, 2, 2, 1, 1, 1)`).run();
    db.prepare(`INSERT INTO enemies (id, session_id, location_code, card_code, name, hp, max_hp, fight, evade, damage, horror, is_exhausted)
                VALUES (2, 1, 'loc1', '01160', 'Acolyte', 1, 1, 1, 1, 1, 0, 0)`).run();

    const { readyAllEnemies } = require('../engine/enemyEngine');
    expect(readyAllEnemies(1)).toBe(1);
    const rows = db.prepare('SELECT id, is_exhausted FROM enemies ORDER BY id').all();
    expect(rows.every(r => r.is_exhausted === 0)).toBe(true);
  });
});

describe('defeatEnemy logging', () => {
  test('logs an Enemy defeated entry for XP counting', () => {
    const { getDb } = require('../db/database');
    const db = getDb();
    const { defeatEnemy } = require('../engine/enemyEngine');
    defeatEnemy(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM enemies WHERE id = 1').get().n).toBe(0);
    const log = db.prepare("SELECT entry FROM campaign_log WHERE campaign_id = 1 AND entry LIKE 'Enemy defeated:%'").all();
    expect(log.length).toBe(1);
    expect(log[0].entry).toContain('Ghoul');
    expect(log[0].entry).toContain('01159');
  });
});
