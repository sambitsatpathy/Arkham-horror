const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(__dirname, 'tmp_effect_exec.db');

beforeAll(() => {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  process.env.ARKHAM_DB_PATH = TMP_DB;

  const { getDb } = require('../db/database');
  const db = getDb();
  db.prepare("INSERT INTO campaign (id, name) VALUES (1, 'test')").run();
  db.prepare(`INSERT INTO players (id, campaign_id, discord_id, discord_name, investigator_name, hp, max_hp, sanity, max_sanity, resources, location_code, hand)
              VALUES (1, 1, 'u1', 'p1', 'Roland', 9, 9, 5, 5, 5, 'study', '["c1","c2","c3"]')`).run();
  db.prepare(`INSERT INTO players (id, campaign_id, discord_id, discord_name, investigator_name, hp, max_hp, sanity, max_sanity, resources, location_code)
              VALUES (2, 1, 'u2', 'p2', 'Wendy', 7, 7, 7, 7, 5, 'study')`).run();
  db.prepare("INSERT INTO game_session (id, campaign_id, scenario_code, difficulty, doom_threshold, phase, doom) VALUES (1, 1, 'test_scenario', 'standard', 5, 'mythos', 0)").run();
});

afterAll(() => {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
});

function ctx() {
  const { getDb } = require('../db/database');
  const db = getDb();
  return {
    player: db.prepare('SELECT * FROM players WHERE id = 1').get(),
    session: db.prepare('SELECT * FROM game_session WHERE id = 1').get(),
    guild: null,
    cardCode: 'TC001',
  };
}

describe('execEffect new types', () => {
  test('lose_resources floors at 0', async () => {
    const { execEffect } = require('../engine/effectExecutors');
    const { getDb } = require('../db/database');
    await execEffect({ type: 'lose_resources', count: 3 }, ctx());
    expect(getDb().prepare('SELECT resources FROM players WHERE id = 1').get().resources).toBe(2);
    await execEffect({ type: 'lose_resources', count: 10 }, ctx());
    expect(getDb().prepare('SELECT resources FROM players WHERE id = 1').get().resources).toBe(0);
    getDb().prepare('UPDATE players SET resources = 5 WHERE id = 1').run();
  });

  test('discard_all_resources', async () => {
    const { execEffect } = require('../engine/effectExecutors');
    const { getDb } = require('../db/database');
    await execEffect({ type: 'discard_all_resources' }, ctx());
    expect(getDb().prepare('SELECT resources FROM players WHERE id = 1').get().resources).toBe(0);
    getDb().prepare('UPDATE players SET resources = 5 WHERE id = 1').run();
  });

  test('add_to_threat_area uses ctx.cardCode', async () => {
    const { execEffect } = require('../engine/effectExecutors');
    const { getThreatArea } = require('../engine/gameState');
    await execEffect({ type: 'add_to_threat_area' }, ctx());
    expect(getThreatArea(1)).toContain('TC001');
  });

  test('discard_cards random removes from hand into discard', async () => {
    const { execEffect } = require('../engine/effectExecutors');
    const { getDb } = require('../db/database');
    const line = await execEffect({ type: 'discard_cards', count: 2, random: true }, ctx());
    const p = getDb().prepare('SELECT hand, discard FROM players WHERE id = 1').get();
    expect(JSON.parse(p.hand).length).toBe(1);
    expect(JSON.parse(p.discard).length).toBe(2);
    expect(line).toContain('2 random');
  });

  test('chosen discard_cards is manual', async () => {
    const { execEffect } = require('../engine/effectExecutors');
    const line = await execEffect({ type: 'discard_cards', count: 1, random: false }, ctx());
    expect(line).toContain('manual');
  });

  test('add_doom scales per_investigator', async () => {
    const { execEffect } = require('../engine/effectExecutors');
    const { getDb } = require('../db/database');
    await execEffect({ type: 'add_doom', count: 1, per_investigator: true }, ctx());
    // 1 doom × 2 active investigators
    expect(getDb().prepare('SELECT doom FROM game_session WHERE id = 1').get().doom).toBe(2);
    getDb().prepare('UPDATE game_session SET doom = 0 WHERE id = 1').run();
  });

  test('deal_damage to all investigators at location', async () => {
    const { execEffect } = require('../engine/effectExecutors');
    const { getDb } = require('../db/database');
    const line = await execEffect({ type: 'deal_damage', count: 1, target: 'all_investigators_at_location' }, ctx());
    const p1 = getDb().prepare('SELECT hp FROM players WHERE id = 1').get();
    const p2 = getDb().prepare('SELECT hp FROM players WHERE id = 2').get();
    expect(p1.hp).toBe(8);
    expect(p2.hp).toBe(6);
    expect(line).toContain('Roland');
    expect(line).toContain('Wendy');
  });
});
