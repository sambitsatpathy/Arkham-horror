const { getDb } = require('../db/database');
const { getSession, updateEnemy, updateLocation, getLocation } = require('./gameState');
const { updateLocationStatus } = require('./locationManager');
const { findCardByCode } = require('./cardLookup');

function spawnEnemy(sessionId, locationCode, cardData) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO enemies (session_id, location_code, card_code, name, hp, max_hp, fight, evade, damage, horror)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    locationCode,
    cardData.code,
    cardData.name,
    cardData.health || 1,
    cardData.health || 1,
    cardData.enemy_fight || 1,
    cardData.enemy_evade || 1,
    cardData.enemy_damage || 1,
    cardData.enemy_horror || 1,
  );
  return result.lastInsertRowid;
}

function spawnEnemyManual(sessionId, locationCode, name, hp, fight, evade, damage, horror) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO enemies (session_id, location_code, card_code, name, hp, max_hp, fight, evade, damage, horror)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, locationCode, 'manual', name, hp, hp, fight, evade, damage, horror);
  return result.lastInsertRowid;
}

function damageEnemy(enemy, amount) {
  const newHp = Math.max(0, enemy.hp - amount);
  updateEnemy(enemy.id, { hp: newHp });
  return newHp;
}

function defeatEnemy(enemyId) {
  getDb().prepare('DELETE FROM enemies WHERE id = ?').run(enemyId);
}

module.exports = { spawnEnemy, spawnEnemyManual, damageEnemy, defeatEnemy };
