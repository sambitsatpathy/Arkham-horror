const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(__dirname, 'tmp_threat.db');

beforeAll(() => {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  process.env.ARKHAM_DB_PATH = TMP_DB;
});

afterAll(() => {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
});

describe('threat area + action helpers', () => {
  test('threat area starts empty', () => {
    const { getDb } = require('../db/database');
    const db = getDb();
    db.prepare("INSERT INTO campaign (id, name) VALUES (1, 'test')").run();
    db.prepare("INSERT INTO players (id, campaign_id, discord_id, discord_name) VALUES (1, 1, 'u1', 'p1')").run();
    const { getThreatArea, addToThreatArea, removeFromThreatArea } = require('../engine/gameState');
    expect(getThreatArea(1)).toEqual([]);
    addToThreatArea(1, '01098');
    addToThreatArea(1, '01099');
    expect(getThreatArea(1)).toEqual(['01098', '01099']);
    removeFromThreatArea(1, '01098');
    expect(getThreatArea(1)).toEqual(['01099']);
  });

  test('decrementActions floors at 0', () => {
    const { getDb } = require('../db/database');
    const db = getDb();
    db.prepare("UPDATE players SET action_count = 2 WHERE id = 1").run();
    const { decrementActions, resetActions } = require('../engine/gameState');
    expect(decrementActions(1)).toBe(1);
    expect(decrementActions(1, 5)).toBe(0);
    resetActions(1, 4);
    const row = db.prepare('SELECT action_count FROM players WHERE id = 1').get();
    expect(row.action_count).toBe(4);
  });
});
