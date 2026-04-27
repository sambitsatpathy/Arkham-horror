require('dotenv').config();
const path = require('path');

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,

  // Card image data root (parent of bot/)
  cardDataRoot: path.join(__dirname, '..'),

  maxPlayers: 4,

  campaigns: {
    night_of_zealot: { name: 'The Night of the Zealot', dir: 'night_of_zealot' },
    dunwich_legacy:  { name: 'The Dunwich Legacy',       dir: 'dunwich_legacy'  },
    path_to_carcosa: { name: 'The Path to Carcosa',      dir: 'path_to_carcosa' },
    forgotten_age:   { name: 'The Forgotten Age',        dir: 'forgotten_age'   },
    circle_undone:   { name: 'The Circle Undone',        dir: 'circle_undone'   },
    dream_eaters:    { name: 'The Dream-Eaters',         dir: 'dream_eaters'    },
    innsmouth:       { name: 'The Innsmouth Conspiracy', dir: 'innsmouth'       },
    edge_of_earth:   { name: 'Edge of the Earth',        dir: 'edge_of_earth'   },
    scarlet_keys:    { name: 'The Scarlet Keys',         dir: 'scarlet_keys'    },
    feast_hemlock:   { name: 'Feast of Hemlock Vale',    dir: 'feast_hemlock'   },
    drowned_city:    { name: 'The Drowned City',         dir: 'drowned_city'    },
  },

  // Returns the Discord channel name for an investigator's private hand channel.
  handChannelName(investigatorName) {
    return investigatorName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-hand';
  },

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
