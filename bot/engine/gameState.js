const { getDb } = require('../db/database');

function getCampaign() {
  return getDb().prepare('SELECT * FROM campaign ORDER BY id DESC LIMIT 1').get();
}

function getSession() {
  return getDb().prepare('SELECT * FROM game_session ORDER BY id DESC LIMIT 1').get();
}

function getPlayers(campaignId) {
  return getDb().prepare('SELECT * FROM players WHERE campaign_id = ?').all(campaignId);
}

function getPlayer(discordId) {
  const campaign = getCampaign();
  if (!campaign) return null;
  return getDb().prepare('SELECT * FROM players WHERE discord_id = ? AND campaign_id = ?').get(discordId, campaign.id);
}

function getPlayerById(id) {
  return getDb().prepare('SELECT * FROM players WHERE id = ?').get(id);
}

function getLocations(sessionId) {
  return getDb().prepare('SELECT * FROM locations WHERE session_id = ?').all(sessionId);
}

function getLocation(sessionId, code) {
  return getDb().prepare('SELECT * FROM locations WHERE session_id = ? AND code = ?').get(sessionId, code);
}

function getEnemies(sessionId) {
  return getDb().prepare('SELECT * FROM enemies WHERE session_id = ?').all(sessionId);
}

function getEnemiesAt(sessionId, locationCode) {
  return getDb().prepare('SELECT * FROM enemies WHERE session_id = ? AND location_code = ?').all(sessionId, locationCode);
}

function getEnemy(id) {
  return getDb().prepare('SELECT * FROM enemies WHERE id = ?').get(id);
}

function updateSession(id, fields) {
  const keys = Object.keys(fields);
  const set = keys.map(k => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE game_session SET ${set} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
}

function updatePlayer(id, fields) {
  const keys = Object.keys(fields);
  const set = keys.map(k => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE players SET ${set} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
}

function updateLocation(id, fields) {
  const keys = Object.keys(fields);
  const set = keys.map(k => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE locations SET ${set} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
}

function updateEnemy(id, fields) {
  const keys = Object.keys(fields);
  const set = keys.map(k => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE enemies SET ${set} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
}

function addCampaignLog(campaignId, scenarioCode, entry) {
  getDb().prepare('INSERT INTO campaign_log (campaign_id, scenario_code, entry) VALUES (?, ?, ?)').run(campaignId, scenarioCode, entry);
}

function getCampaignLog(campaignId) {
  return getDb().prepare('SELECT * FROM campaign_log WHERE campaign_id = ? ORDER BY created_at ASC').all(campaignId);
}

function requireSession(interaction) {
  const session = getSession();
  if (!session || session.phase === 'pregame') {
    interaction.reply({ content: 'No active game session. Use `/startgame` to begin.', flags: 64 });
    return null;
  }
  return session;
}

function requirePlayer(interaction) {
  const player = getPlayer(interaction.user.id);
  if (!player) {
    interaction.reply({ content: 'You are not registered. Use `/join` first.', flags: 64 });
    return null;
  }
  return player;
}

function requireHost(interaction) {
  const player = getPlayer(interaction.user.id);
  if (!player || !player.is_host) {
    interaction.reply({ content: 'Only the Host can use this command.', flags: 64 });
    return null;
  }
  return player;
}

function getThreatArea(playerId) {
  const row = getDb().prepare('SELECT threat_area FROM players WHERE id = ?').get(playerId);
  return row ? JSON.parse(row.threat_area || '[]') : [];
}

function setThreatArea(playerId, codes) {
  getDb().prepare('UPDATE players SET threat_area = ? WHERE id = ?').run(JSON.stringify(codes), playerId);
}

function addToThreatArea(playerId, code) {
  const codes = getThreatArea(playerId);
  codes.push(code);
  setThreatArea(playerId, codes);
}

function removeFromThreatArea(playerId, code) {
  const codes = getThreatArea(playerId).filter(c => c !== code);
  setThreatArea(playerId, codes);
}

function decrementActions(playerId, n = 1) {
  const row = getDb().prepare('SELECT action_count FROM players WHERE id = ?').get(playerId);
  const next = Math.max(0, (row?.action_count ?? 0) - n);
  getDb().prepare('UPDATE players SET action_count = ? WHERE id = ?').run(next, playerId);
  return next;
}

function resetActions(playerId, count) {
  getDb().prepare('UPDATE players SET action_count = ? WHERE id = ?').run(count, playerId);
}

function resetDb() {
  const db = getDb();
  db.prepare('DELETE FROM enemies').run();
  db.prepare('DELETE FROM locations').run();
  db.prepare('DELETE FROM game_session').run();
  db.prepare('DELETE FROM deck_upgrades').run();
  db.prepare('DELETE FROM campaign_log').run();
  db.prepare('DELETE FROM players').run();
  db.prepare('DELETE FROM campaign').run();
}

module.exports = {
  getCampaign, getSession, getPlayers, getPlayer, getPlayerById,
  getLocations, getLocation, getEnemies, getEnemiesAt, getEnemy,
  updateSession, updatePlayer, updateLocation, updateEnemy,
  addCampaignLog, getCampaignLog,
  requireSession, requirePlayer, requireHost,
  resetDb,
  getThreatArea, setThreatArea, addToThreatArea, removeFromThreatArea,
  decrementActions, resetActions,
};
