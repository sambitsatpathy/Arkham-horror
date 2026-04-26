require('dotenv').config();
const path = require('path');

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,

  // Card image data root (parent of bot/)
  cardDataRoot: path.join(__dirname, '..'),

  maxPlayers: 4,

  tokenDisplay: {
    '+1': '+1', '+2': '+2', '0': '0',
    '-1': '-1', '-2': '-2', '-3': '-3', '-4': '-4',
    '-5': '-5', '-6': '-6', '-7': '-7', '-8': '-8',
    'skull': '💀 Skull',
    'cultist': '🗡️ Cultist',
    'tablet': '📜 Tablet',
    'elder_thing': '👁️ Elder Thing',
    'auto_fail': '❌ Auto-fail',
    'elder_sign': '✨ Elder Sign',
  },

  phaseNames: {
    pregame: 'Pregame',
    upkeep: 'Upkeep',
    investigation: 'Investigation',
    enemy: 'Enemy',
    mythos: 'Mythos',
    awaiting_resolve: 'Awaiting Resolution',
    end: 'End',
  },
};
