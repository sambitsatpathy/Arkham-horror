const { getDb } = require('../db/database');
const { getSession, updateEnemy, updateLocation, getLocation, getEnemies, getPlayerById, updatePlayer, addCampaignLog, getCampaign } = require('./gameState');
const { updateLocationStatus } = require('./locationManager');
const { findCardByCode } = require('./cardLookup');

function spawnEnemy(sessionId, locationCode, cardData) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO enemies (session_id, location_code, card_code, name, hp, max_hp, fight, evade, damage, horror, is_hunter)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    cardData.is_hunter || 0,
  );
  return result.lastInsertRowid;
}

function spawnEnemyManual(sessionId, locationCode, name, hp, fight, evade, damage, horror, isHunter = 0) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO enemies (session_id, location_code, card_code, name, hp, max_hp, fight, evade, damage, horror, is_hunter)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, locationCode, 'manual', name, hp, hp, fight, evade, damage, horror, isHunter);
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

async function activateEnemies(guild, session, players) {
  const db = getDb();

  const enemies = getEnemies(session.id);
  const activePlayers = players.filter(p => !p.is_eliminated);
  const results = [];

  for (const enemy of enemies) {
    if (enemy.is_exhausted) {
      results.push(`💤 **${enemy.name}** [${enemy.id}] is exhausted — skipped.`);
      continue;
    }

    const engagedPlayer = activePlayers.find(p => p.location_code === enemy.location_code);

    if (!engagedPlayer && !enemy.is_hunter) {
      continue;
    }

    let target = engagedPlayer;

    if (!engagedPlayer && enemy.is_hunter) {
      // Simplified: move to first active player's location.
      // True "nearest" requires adjacency graph not yet modelled.
      const dest = activePlayers[0];
      if (!dest) continue;

      updateEnemy(enemy.id, { location_code: dest.location_code });

      const oldLoc = getLocation(session.id, enemy.location_code);
      const newLoc = getLocation(session.id, dest.location_code);
      if (oldLoc) await updateLocationStatus(guild, session, oldLoc);
      if (newLoc) await updateLocationStatus(guild, session, newLoc);

      const newLocCh = newLoc ? guild.channels.cache.get(newLoc.channel_id) : null;
      if (newLocCh) {
        await newLocCh.send(`👹 **${enemy.name}** hunts toward **${dest.investigator_name}** in **${newLoc.name}**!`);
      }

      target = dest;
    }

    if (!target) continue;

    const freshTarget = getPlayerById(target.id);
    const newHp = Math.max(0, freshTarget.hp - enemy.damage);
    const newSan = Math.max(0, freshTarget.sanity - enemy.horror);
    updatePlayer(freshTarget.id, { hp: newHp, sanity: newSan });

    const safeName = freshTarget.investigator_name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-hand';
    const handCh = guild.channels.cache.find(c => c.name === safeName);
    const attackMsg = [
      `👹 **${enemy.name}** attacks **${freshTarget.investigator_name}**!`,
      `🩸 ${enemy.damage} damage (HP: ${freshTarget.hp} → ${newHp}/${freshTarget.max_hp})`,
      `😱 ${enemy.horror} horror (SAN: ${freshTarget.sanity} → ${newSan}/${freshTarget.max_sanity})`,
    ].join('\n');
    if (handCh) await handCh.send(attackMsg);

    if (newHp === 0 || newSan === 0) {
      updatePlayer(freshTarget.id, { is_eliminated: 1 });
      const campaign = getCampaign();
      const cause = newHp === 0 ? 'physical damage' : 'horror';
      addCampaignLog(campaign.id, session.scenario_code, `${freshTarget.investigator_name} was eliminated by ${cause} during enemy phase.`);
      if (handCh) await handCh.send(`💀 **${freshTarget.investigator_name}** has been eliminated!`);
    }

    const resultLine = enemy.is_hunter && !engagedPlayer
      ? `🏃 **${enemy.name}** [${enemy.id}] hunted + attacked **${target.investigator_name}** (${enemy.damage} dmg / ${enemy.horror} hor)`
      : `⚔️ **${enemy.name}** [${enemy.id}] attacked **${target.investigator_name}** (${enemy.damage} dmg / ${enemy.horror} hor)`;
    results.push(resultLine);
  }

  return results;
}

module.exports = { spawnEnemy, spawnEnemyManual, damageEnemy, defeatEnemy, activateEnemies };
