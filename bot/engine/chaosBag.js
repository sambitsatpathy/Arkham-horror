const { tokenDisplay } = require('../config');
const chaosData = require('../data/chaos_bags.json');

function getPool(difficulty) {
  return [...(chaosData[difficulty] || chaosData.standard)];
}

function drawToken(difficulty) {
  const pool = getPool(difficulty);
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

function displayToken(token) {
  return tokenDisplay[token] || token;
}

function formatPull(playerName, token, scenarioNote = '') {
  const display = displayToken(token);
  const isSpecial = ['skull', 'cultist', 'tablet', 'elder_thing', 'auto_fail', 'elder_sign'].includes(token);
  const note = isSpecial && scenarioNote ? `\n${scenarioNote}` : '';
  return [
    '┌─────────────────────────┐',
    `│ 🎲 **CHAOS TOKEN DRAW**      │`,
    `│ Player: ${playerName.padEnd(16)}│`,
    `│ Result: ${display.padEnd(16)}│`,
    note ? `│ ${note.padEnd(25)}│` : null,
    '└─────────────────────────┘',
  ].filter(Boolean).join('\n');
}

module.exports = { drawToken, displayToken, formatPull, getPool };
