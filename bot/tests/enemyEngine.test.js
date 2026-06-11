const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(__dirname, 'tmp_enemy_engine.db');
const TMP_FX = path.join(__dirname, 'tmp_enemy_effects.json');

const FIXTURE = {
  // Ghoul Priest-like: Hunter + Retaliate, per-investigator HP, Victory 2
  T0001: {
    name: 'Test Priest', type: 'enemy', keywords: ['hunter', 'retaliate'],
    prey: 'Highest [combat]', victory: 2, health_per_investigator: true,
    enemy_stats: { fight: 4, evade: 4, health: 5, damage: 2, horror: 2 },
    effects: [], on_success: [], passive: [], triggers: [], revelation_effects: [],
  },
  // Massive + Alert
  T0002: {
    name: 'Test Horror', type: 'enemy', keywords: ['massive', 'alert'],
    prey: null, victory: 0, health_per_investigator: false,
    enemy_stats: { fight: 3, evade: 3, health: 6, damage: 1, horror: 1 },
    effects: [], on_success: [], passive: [], triggers: [], revelation_effects: [],
  },
  // Aloof
  T0003: {
    name: 'Test Lurker', type: 'enemy', keywords: ['aloof'],
    prey: null, victory: 0, health_per_investigator: false,
    enemy_stats: { fight: 2, evade: 2, health: 2, damage: 1, horror: 0 },
    effects: [], on_success: [], passive: [], triggers: [], revelation_effects: [],
  },
};

beforeAll(() => {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  fs.writeFileSync(TMP_FX, JSON.stringify(FIXTURE));
  process.env.ARKHAM_DB_PATH = TMP_DB;
  process.env.CARD_EFFECTS_PATH = TMP_FX;
  require('../engine/cardEffectResolver')._resetForTests();

  const { getDb } = require('../db/database');
  const db = getDb();
  db.prepare("INSERT INTO campaign (id, name) VALUES (1, 'test')").run();
  db.prepare(`INSERT INTO players (id, campaign_id, discord_id, discord_name, investigator_name, hp, max_hp, sanity, max_sanity, location_code)
              VALUES (1, 1, 'u1', 'p1', 'Roland', 9, 9, 5, 5, 'study')`).run();
  db.prepare(`INSERT INTO players (id, campaign_id, discord_id, discord_name, investigator_name, hp, max_hp, sanity, max_sanity, location_code)
              VALUES (2, 1, 'u2', 'p2', 'Wendy', 7, 7, 7, 7, 'study')`).run();
  db.prepare("INSERT INTO game_session (id, campaign_id, scenario_code, difficulty, doom_threshold, phase) VALUES (1, 1, 'test_scenario', 'standard', 3, 'investigation')").run();
});

afterAll(() => {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  if (fs.existsSync(TMP_FX)) fs.unlinkSync(TMP_FX);
  delete process.env.CARD_EFFECTS_PATH;
  require('../engine/cardEffectResolver')._resetForTests();
});

const stubGuild = { channels: { cache: { find: () => null, get: () => null } } };

describe('spawnEnemy from parsed card data', () => {
  test('keywords, prey, victory and per-investigator HP from card_effects', () => {
    const { spawnEnemy } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const id = spawnEnemy(1, 'study', { code: 'T0001', name: 'Test Priest' });
    const e = getDb().prepare('SELECT * FROM enemies WHERE id = ?').get(id);
    expect(e.is_hunter).toBe(1);
    expect(e.is_retaliate).toBe(1);
    expect(e.is_aloof).toBe(0);
    expect(e.prey).toBe('Highest [combat]');
    expect(e.victory).toBe(2);
    expect(e.fight).toBe(4);
    expect(e.damage).toBe(2);
    // 5 HP × 2 active investigators
    expect(e.hp).toBe(10);
    expect(e.max_hp).toBe(10);
    getDb().prepare('DELETE FROM enemies WHERE id = ?').run(id);
  });

  test('hp_override skips per-investigator scaling', () => {
    const { spawnEnemy } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const id = spawnEnemy(1, 'study', { code: 'T0001', name: 'Test Priest' }, { hp_override: 5 });
    const e = getDb().prepare('SELECT * FROM enemies WHERE id = ?').get(id);
    expect(e.hp).toBe(5);
    getDb().prepare('DELETE FROM enemies WHERE id = ?').run(id);
  });

  test('host booleans override parsed keywords', () => {
    const { spawnEnemy } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const id = spawnEnemy(1, 'study', { code: 'T0001', name: 'Test Priest' }, { is_hunter: false, is_aloof: true });
    const e = getDb().prepare('SELECT * FROM enemies WHERE id = ?').get(id);
    expect(e.is_hunter).toBe(0);
    expect(e.is_aloof).toBe(1);
    expect(e.engaged_player_id).toBeNull();
    getDb().prepare('DELETE FROM enemies WHERE id = ?').run(id);
  });

  test('alert and massive flags set from keywords', () => {
    const { spawnEnemy } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const id = spawnEnemy(1, 'study', { code: 'T0002', name: 'Test Horror' });
    const e = getDb().prepare('SELECT * FROM enemies WHERE id = ?').get(id);
    expect(e.is_massive).toBe(1);
    expect(e.is_alerted).toBe(1);
    expect(e.hp).toBe(6);
    getDb().prepare('DELETE FROM enemies WHERE id = ?').run(id);
  });
});

describe('enemyAttack', () => {
  test('applies damage and horror to the target', async () => {
    const { spawnEnemy, enemyAttack } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const db = getDb();
    const id = spawnEnemy(1, 'study', { code: 'T0001', name: 'Test Priest' });
    const enemy = db.prepare('SELECT * FROM enemies WHERE id = ?').get(id);
    const player = db.prepare('SELECT * FROM players WHERE id = 1').get();
    const session = db.prepare('SELECT * FROM game_session WHERE id = 1').get();

    await enemyAttack(stubGuild, session, enemy, player);
    const after = db.prepare('SELECT hp, sanity FROM players WHERE id = 1').get();
    expect(after.hp).toBe(7);   // 9 - 2
    expect(after.sanity).toBe(3); // 5 - 2
    db.prepare('UPDATE players SET hp = 9, sanity = 5 WHERE id = 1').run();
    db.prepare('DELETE FROM enemies WHERE id = ?').run(id);
  });

  test('eliminates the target at 0 hp', async () => {
    const { spawnEnemy, enemyAttack } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const db = getDb();
    db.prepare('UPDATE players SET hp = 2 WHERE id = 1').run();
    const id = spawnEnemy(1, 'study', { code: 'T0001', name: 'Test Priest' });
    const enemy = db.prepare('SELECT * FROM enemies WHERE id = ?').get(id);
    const player = db.prepare('SELECT * FROM players WHERE id = 1').get();
    const session = db.prepare('SELECT * FROM game_session WHERE id = 1').get();

    await enemyAttack(stubGuild, session, enemy, player);
    const after = db.prepare('SELECT hp, is_eliminated FROM players WHERE id = 1').get();
    expect(after.hp).toBe(0);
    expect(after.is_eliminated).toBe(1);
    db.prepare('UPDATE players SET hp = 9, sanity = 5, is_eliminated = 0 WHERE id = 1').run();
    db.prepare('DELETE FROM enemies WHERE id = ?').run(id);
    db.prepare("DELETE FROM campaign_log").run();
  });
});

describe('activateEnemies', () => {
  test('massive enemy attacks every investigator at its location', async () => {
    const { spawnEnemy, activateEnemies } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const db = getDb();
    const id = spawnEnemy(1, 'study', { code: 'T0002', name: 'Test Horror' });
    const session = db.prepare('SELECT * FROM game_session WHERE id = 1').get();
    const players = db.prepare('SELECT * FROM players').all();

    const results = await activateEnemies(stubGuild, session, players);
    expect(results.filter(r => r.includes('Massive')).length).toBe(2);
    const p1 = db.prepare('SELECT hp FROM players WHERE id = 1').get();
    const p2 = db.prepare('SELECT hp FROM players WHERE id = 2').get();
    expect(p1.hp).toBe(8);
    expect(p2.hp).toBe(6);
    db.prepare('UPDATE players SET hp = 9, sanity = 5 WHERE id = 1').run();
    db.prepare('UPDATE players SET hp = 7, sanity = 7 WHERE id = 2').run();
    db.prepare('DELETE FROM enemies WHERE id = ?').run(id);
  });

  test('non-massive enemy attacks only its engaged investigator', async () => {
    const { spawnEnemy, activateEnemies } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const db = getDb();
    const id = spawnEnemy(1, 'study', { code: 'T0001', name: 'Test Priest' }, { engaged_player_id: 2 });
    const session = db.prepare('SELECT * FROM game_session WHERE id = 1').get();
    const players = db.prepare('SELECT * FROM players').all();

    await activateEnemies(stubGuild, session, players);
    const p1 = db.prepare('SELECT hp FROM players WHERE id = 1').get();
    const p2 = db.prepare('SELECT hp FROM players WHERE id = 2').get();
    expect(p1.hp).toBe(9);  // untouched
    expect(p2.hp).toBe(5);  // 7 - 2
    db.prepare('UPDATE players SET hp = 7, sanity = 7 WHERE id = 2').run();
    db.prepare('DELETE FROM enemies WHERE id = ?').run(id);
  });

  test('aloof enemy does not activate', async () => {
    const { spawnEnemy, activateEnemies } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const db = getDb();
    const id = spawnEnemy(1, 'study', { code: 'T0003', name: 'Test Lurker' });
    const session = db.prepare('SELECT * FROM game_session WHERE id = 1').get();
    const players = db.prepare('SELECT * FROM players').all();

    const results = await activateEnemies(stubGuild, session, players);
    expect(results.some(r => r.includes('aloof'))).toBe(true);
    const p1 = db.prepare('SELECT hp FROM players WHERE id = 1').get();
    expect(p1.hp).toBe(9);
    db.prepare('DELETE FROM enemies WHERE id = ?').run(id);
  });
});

describe('defeatEnemy victory logging', () => {
  test('logs Victory X for XP at /endscenario', () => {
    const { spawnEnemy, defeatEnemy } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const db = getDb();
    const id = spawnEnemy(1, 'study', { code: 'T0001', name: 'Test Priest' });
    defeatEnemy(id);
    const log = db.prepare("SELECT entry FROM campaign_log WHERE entry LIKE 'Enemy defeated:%'").all();
    expect(log.length).toBe(1);
    expect(log[0].entry).toContain('(Victory 2)');
    db.prepare('DELETE FROM campaign_log').run();
  });

  test('no victory suffix for 0-victory enemies', () => {
    const { spawnEnemy, defeatEnemy } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const db = getDb();
    const id = spawnEnemy(1, 'study', { code: 'T0003', name: 'Test Lurker' });
    defeatEnemy(id);
    const log = db.prepare("SELECT entry FROM campaign_log WHERE entry LIKE 'Enemy defeated:%'").all();
    expect(log.length).toBe(1);
    expect(log[0].entry).not.toContain('Victory');
    db.prepare('DELETE FROM campaign_log').run();
  });
});
