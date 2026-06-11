const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(__dirname, 'tmp_hunter.db');

// The Gathering map: hallway hub with attic/cellar/parlor spokes
const MAP = {
  study: [],
  hallway: ['attic', 'cellar', 'parlor'],
  attic: ['hallway'],
  cellar: ['hallway'],
  parlor: ['hallway'],
};

beforeAll(() => {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  process.env.ARKHAM_DB_PATH = TMP_DB;

  const { getDb } = require('../db/database');
  const db = getDb();
  db.prepare("INSERT INTO campaign (id, name) VALUES (1, 'test')").run();
  db.prepare(`INSERT INTO players (id, campaign_id, discord_id, discord_name, investigator_name, hp, max_hp, sanity, max_sanity, location_code)
              VALUES (1, 1, 'u1', 'p1', 'Roland', 9, 9, 5, 5, 'parlor')`).run();
  db.prepare("INSERT INTO game_session (id, campaign_id, scenario_code, difficulty, doom_threshold, phase, act_index) VALUES (1, 1, 'the_gathering', 'standard', 3, 'enemy', 0)").run();
  for (const [code, connections] of Object.entries(MAP)) {
    db.prepare(`INSERT INTO locations (session_id, code, name, status, clues, shroud, act_index, connections)
                VALUES (1, ?, ?, 'revealed', 0, 2, 0, ?)`).run(code, code, JSON.stringify(connections));
  }
});

afterAll(() => {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
});

const stubGuild = { channels: { cache: { find: () => null, get: () => null } } };

describe('hunterStep', () => {
  test('moves one step along the shortest path', () => {
    const { hunterStep } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const db = getDb();
    const session = db.prepare('SELECT * FROM game_session WHERE id = 1').get();
    const players = db.prepare('SELECT * FROM players').all();
    // Enemy in the attic, player in the parlor: attic → hallway → parlor
    const step = hunterStep(session, { location_code: 'attic' }, players);
    expect(step.code).toBe('hallway');
  });

  test('steps onto the player location when adjacent', () => {
    const { hunterStep } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const db = getDb();
    const session = db.prepare('SELECT * FROM game_session WHERE id = 1').get();
    const players = db.prepare('SELECT * FROM players').all();
    const step = hunterStep(session, { location_code: 'hallway' }, players);
    expect(step.code).toBe('parlor');
  });

  test('returns null when no path exists (study is one-way)', () => {
    const { hunterStep } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const db = getDb();
    const session = db.prepare('SELECT * FROM game_session WHERE id = 1').get();
    const players = db.prepare('SELECT * FROM players').all();
    expect(hunterStep(session, { location_code: 'study' }, players)).toBeNull();
  });

  test('returns null when the scenario has no connection data', () => {
    const { hunterStep } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const db = getDb();
    db.prepare("UPDATE locations SET connections = '[]' WHERE session_id = 1").run();
    const session = db.prepare('SELECT * FROM game_session WHERE id = 1').get();
    const players = db.prepare('SELECT * FROM players').all();
    expect(hunterStep(session, { location_code: 'attic' }, players)).toBeNull();
    // restore
    for (const [code, connections] of Object.entries(MAP)) {
      db.prepare('UPDATE locations SET connections = ? WHERE session_id = 1 AND code = ?').run(JSON.stringify(connections), code);
    }
  });
});

describe('activateEnemies hunter movement', () => {
  test('hunter moves one step and does not attack until it arrives', async () => {
    const { activateEnemies } = require('../engine/enemyEngine');
    const { getDb } = require('../db/database');
    const db = getDb();
    db.prepare(`INSERT INTO enemies (id, session_id, location_code, card_code, name, hp, max_hp, fight, evade, damage, horror, is_hunter)
                VALUES (1, 1, 'attic', 'X', 'Ghoul', 3, 3, 2, 2, 1, 1, 1)`).run();
    const session = db.prepare('SELECT * FROM game_session WHERE id = 1').get();
    const players = db.prepare('SELECT * FROM players').all();

    let results = await activateEnemies(stubGuild, session, players);
    expect(results.some(r => r.includes('hunts into') && r.includes('hallway'))).toBe(true);
    expect(db.prepare('SELECT location_code FROM enemies WHERE id = 1').get().location_code).toBe('hallway');
    expect(db.prepare('SELECT hp FROM players WHERE id = 1').get().hp).toBe(9); // not attacked yet

    // Next activation: arrives at parlor and attacks
    results = await activateEnemies(stubGuild, session, players);
    expect(db.prepare('SELECT location_code FROM enemies WHERE id = 1').get().location_code).toBe('parlor');
    expect(db.prepare('SELECT hp FROM players WHERE id = 1').get().hp).toBe(8);
    db.prepare('DELETE FROM enemies WHERE id = 1').run();
    db.prepare('UPDATE players SET hp = 9, sanity = 5 WHERE id = 1').run();
  });
});

describe('scenario connection data validation', () => {
  const SCEN_DIR = path.join(__dirname, '..', 'data', 'scenarios', 'night_of_zealot');

  for (const file of ['01_the_gathering.json', '02_the_midnight_masks.json', '03_the_devourer_below.json']) {
    test(`${file}: every connection target exists and is symmetric`, () => {
      const scenario = JSON.parse(fs.readFileSync(path.join(SCEN_DIR, file), 'utf8'));
      const byCode = new Map(scenario.locations.map(l => [l.code, l]));
      for (const loc of scenario.locations) {
        expect(Array.isArray(loc.connections)).toBe(true);
        for (const target of loc.connections) {
          expect(byCode.has(target)).toBe(true);
          expect(byCode.get(target).connections).toContain(loc.code);
        }
      }
    });
  }
});
