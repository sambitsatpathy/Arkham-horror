const { getDb } = require('../db/database');
const { getSession, updateEnemy, updateLocation, getLocation, getEnemies, getPlayerById, getPlayers, updatePlayer, addCampaignLog, getCampaign } = require('./gameState');
const { updateLocationStatus } = require('./locationManager');
const { findCardByCode } = require('./cardLookup');

// Spawns an enemy with keywords/stats from card_effects.json (Hunter, Aloof,
// Retaliate, Alert, Massive, Elusive, Prey, Victory, per-investigator HP).
// cardData fields and opts.is_hunter / opts.is_aloof (boolean or null) act as
// overrides on top of the parsed card data.
function spawnEnemy(sessionId, locationCode, cardData, opts = {}) {
  const db = getDb();
  const { getEntry } = require('./cardEffectResolver');
  const entry = getEntry(cardData.code) || {};
  const stats = entry.enemy_stats || {};
  const kw = entry.keywords || [];
  const has = k => kw.includes(k) ? 1 : 0;

  let health;
  if (opts.hp_override != null) {
    health = opts.hp_override;
  } else {
    health = cardData.health ?? stats.health ?? 1;
    if (entry.health_per_investigator) {
      const campaign = getCampaign();
      const n = campaign ? getPlayers(campaign.id).filter(p => !p.is_eliminated).length : 1;
      health = health * Math.max(1, n);
    }
  }

  const isHunter = opts.is_hunter != null ? (opts.is_hunter ? 1 : 0) : (cardData.is_hunter ?? has('hunter'));
  const isAloof = opts.is_aloof != null ? (opts.is_aloof ? 1 : 0) : (cardData.is_aloof ?? has('aloof'));

  const result = db.prepare(`
    INSERT INTO enemies (session_id, location_code, card_code, name, hp, max_hp, fight, evade, damage, horror,
      is_hunter, is_aloof, is_alerted, is_retaliate, is_massive, is_elusive, prey, victory, engaged_player_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    locationCode,
    cardData.code,
    cardData.name || entry.name || cardData.code,
    health,
    health,
    cardData.enemy_fight ?? stats.fight ?? 1,
    cardData.enemy_evade ?? stats.evade ?? 1,
    cardData.enemy_damage ?? stats.damage ?? 1,
    cardData.enemy_horror ?? stats.horror ?? 1,
    isHunter,
    isAloof,
    has('alert'),
    has('retaliate'),
    has('massive'),
    has('elusive'),
    entry.prey || null,
    entry.victory || 0,
    isAloof ? null : (opts.engaged_player_id ?? null),
  );
  return result.lastInsertRowid;
}

function spawnEnemyManual(sessionId, locationCode, name, hp, fight, evade, damage, horror, isHunter = 0, isAloof = 0) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO enemies (session_id, location_code, card_code, name, hp, max_hp, fight, evade, damage, horror, is_hunter, is_aloof)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, locationCode, 'manual', name, hp, hp, fight, evade, damage, horror, isHunter, isAloof);
  return result.lastInsertRowid;
}

function damageEnemy(enemy, amount) {
  const newHp = Math.max(0, enemy.hp - amount);
  updateEnemy(enemy.id, { hp: newHp });
  return newHp;
}

function defeatEnemy(enemyId) {
  const db = getDb();
  const enemy = db.prepare('SELECT * FROM enemies WHERE id = ?').get(enemyId);
  db.prepare('DELETE FROM enemies WHERE id = ?').run(enemyId);
  // Log here so every defeat path (fight, events, /enemy) counts for XP at /endscenario
  if (enemy) {
    const campaign = getCampaign();
    const session = getSession();
    if (campaign && session) {
      const { getEntry } = require('./cardEffectResolver');
      const victory = enemy.victory || getEntry(enemy.card_code)?.victory || 0;
      const suffix = victory > 0 ? ` (Victory ${victory})` : '';
      addCampaignLog(campaign.id, session.scenario_code, `Enemy defeated: ${enemy.name} [${enemy.card_code}]${suffix}`);
    }
  }
  return enemy;
}

function readyAllEnemies(sessionId) {
  const info = getDb().prepare('UPDATE enemies SET is_exhausted = 0 WHERE session_id = ? AND is_exhausted = 1').run(sessionId);
  return info.changes;
}

// Applies one enemy attack (damage + horror) to a player, posts it to their
// hand channel, and handles elimination. Shared by the enemy phase, Retaliate
// (failed fight) and Alert (failed evade). Returns a short summary line.
async function enemyAttack(guild, session, enemy, targetPlayer, { label = 'attacks' } = {}) {
  const freshTarget = getPlayerById(targetPlayer.id);
  const newHp = Math.max(0, freshTarget.hp - enemy.damage);
  const newSan = Math.max(0, freshTarget.sanity - enemy.horror);
  updatePlayer(freshTarget.id, { hp: newHp, sanity: newSan });

  const safeName = freshTarget.investigator_name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-hand';
  const handCh = guild?.channels.cache.find(c => c.name === safeName);
  const attackMsg = [
    `👹 **${enemy.name}** ${label} **${freshTarget.investigator_name}**!`,
    `🩸 ${enemy.damage} damage (HP: ${freshTarget.hp} → ${newHp}/${freshTarget.max_hp})`,
    `😱 ${enemy.horror} horror (SAN: ${freshTarget.sanity} → ${newSan}/${freshTarget.max_sanity})`,
  ].join('\n');
  if (handCh) await handCh.send(attackMsg);

  if (newHp === 0 || newSan === 0) {
    updatePlayer(freshTarget.id, { is_eliminated: 1 });
    const campaign = getCampaign();
    const cause = newHp === 0 ? 'physical damage' : 'horror';
    addCampaignLog(campaign.id, session.scenario_code, `${freshTarget.investigator_name} was eliminated by ${cause}.`);
    if (handCh) await handCh.send(`💀 **${freshTarget.investigator_name}** has been eliminated!`);
  }

  return `⚔️ **${enemy.name}** [${enemy.id}] ${label} **${freshTarget.investigator_name}** (${enemy.damage} dmg / ${enemy.horror} hor)`;
}

// One BFS step from the enemy's location toward the nearest investigator over
// the scenario's connection graph. Locations from not-yet-unlocked acts are
// not traversed. Returns the next location row, or null when the scenario has
// no connection data (caller falls back to the legacy jump).
function hunterStep(session, enemy, activePlayers) {
  const { getLocations } = require('./gameState');
  const locs = getLocations(session.id).filter(l => l.act_index <= session.act_index);
  const byCode = new Map(locs.map(l => [l.code, l]));
  const conn = code => {
    try { return JSON.parse(byCode.get(code)?.connections || '[]'); } catch (_) { return []; }
  };

  const hasMapData = locs.some(l => conn(l.code).length > 0);
  if (!hasMapData || !byCode.has(enemy.location_code)) return null;

  const targets = new Set(activePlayers.map(p => p.location_code));
  const prev = new Map([[enemy.location_code, null]]);
  const queue = [enemy.location_code];
  let found = null;
  while (queue.length) {
    const cur = queue.shift();
    if (targets.has(cur) && cur !== enemy.location_code) { found = cur; break; }
    for (const nb of conn(cur)) {
      if (!byCode.has(nb) || prev.has(nb)) continue;
      prev.set(nb, cur);
      queue.push(nb);
    }
  }
  if (!found) return null;

  let step = found;
  while (prev.get(step) !== enemy.location_code) step = prev.get(step);
  return byCode.get(step);
}

async function activateEnemies(guild, session, players) {
  const enemies = getEnemies(session.id);
  const activePlayers = players.filter(p => !p.is_eliminated);
  const results = [];

  for (const enemy of enemies) {
    if (enemy.is_exhausted) {
      results.push(`💤 **${enemy.name}** [${enemy.id}] is exhausted — skipped.`);
      continue;
    }

    // Skip aloof enemies — they don't activate until engaged via /engage
    if (enemy.is_aloof) {
      results.push(`🛡️ **${enemy.name}** [${enemy.id}] is aloof — not activated (use /engage to engage it first)`);
      continue;
    }

    const playersHere = activePlayers.filter(p => p.location_code === enemy.location_code);

    if (playersHere.length === 0 && !enemy.is_hunter) {
      continue;
    }

    let hunted = false;
    if (playersHere.length === 0 && enemy.is_hunter) {
      if (activePlayers.length === 0) continue;

      const step = hunterStep(session, enemy, activePlayers);
      if (step) {
        // Move one connection toward the nearest investigator
        const oldLoc = getLocation(session.id, enemy.location_code);
        updateEnemy(enemy.id, { location_code: step.code });
        const newLoc = getLocation(session.id, step.code);
        if (oldLoc) await updateLocationStatus(guild, session, oldLoc);
        if (newLoc) await updateLocationStatus(guild, session, newLoc);

        const newLocCh = newLoc ? guild.channels.cache.get(newLoc.channel_id) : null;
        if (newLocCh) await newLocCh.send(`👹 **${enemy.name}** hunts into **${newLoc.name}**!`);

        const arrived = activePlayers.filter(p => p.location_code === step.code);
        if (arrived.length === 0) {
          results.push(`🏃 **${enemy.name}** [${enemy.id}] hunts into **${step.name}**.`);
          continue;
        }
        playersHere.push(...arrived);
        hunted = true;
      } else {
        // No connection data for this scenario — legacy jump to first player
        const dest = activePlayers[0];
        updateEnemy(enemy.id, { location_code: dest.location_code });

        const oldLoc = getLocation(session.id, enemy.location_code);
        const newLoc = getLocation(session.id, dest.location_code);
        if (oldLoc) await updateLocationStatus(guild, session, oldLoc);
        if (newLoc) await updateLocationStatus(guild, session, newLoc);

        const newLocCh = newLoc ? guild.channels.cache.get(newLoc.channel_id) : null;
        if (newLocCh) {
          await newLocCh.send(`👹 **${enemy.name}** hunts toward **${dest.investigator_name}** in **${newLoc.name}**! *(no map data)*`);
        }

        playersHere.push(dest);
        hunted = true;
      }
    }

    if (playersHere.length === 0) continue;

    // Massive enemies attack every investigator at their location; others
    // attack their engaged investigator (falling back to the first one here).
    let targets;
    if (enemy.is_massive) {
      targets = playersHere;
    } else {
      const engaged = enemy.engaged_player_id
        ? playersHere.find(p => p.id === enemy.engaged_player_id)
        : null;
      targets = [engaged || playersHere[0]];
      updateEnemy(enemy.id, { engaged_player_id: targets[0].id });
    }

    for (const target of targets) {
      const label = hunted ? 'hunted + attacked' : (enemy.is_massive ? 'attacks (Massive)' : 'attacks');
      const line = await enemyAttack(guild, session, enemy, target, { label });
      results.push(hunted ? line.replace('⚔️', '🏃') : line);
    }
  }

  return results;
}

module.exports = { spawnEnemy, spawnEnemyManual, damageEnemy, defeatEnemy, readyAllEnemies, enemyAttack, hunterStep, activateEnemies };
