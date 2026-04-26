const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../../db/database');
const { requireHost } = require('../../engine/gameState');
const { teardownGameChannels } = require('../../engine/serverBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('newgame')
    .setDescription('Wipe all game channels and reset to pregame state. Host only.'),

  async execute(interaction) {
    const host = requireHost(interaction);
    if (!host) return;

    await interaction.deferReply();
    await teardownGameChannels(interaction.guild);

    // Wipe DB
    const db = getDb();
    db.prepare('DELETE FROM enemies').run();
    db.prepare('DELETE FROM locations').run();
    db.prepare('DELETE FROM game_session').run();
    db.prepare('DELETE FROM deck_upgrades').run();
    db.prepare('DELETE FROM campaign_log').run();
    db.prepare('DELETE FROM players').run();
    db.prepare('DELETE FROM campaign').run();

    // Remove host role
    const hostRole = interaction.guild.roles.cache.find(r => r.name === '🎲 Game Host');
    if (hostRole) await hostRole.delete().catch(() => {});

    const pregame = interaction.guild.channels.cache.find(c => c.name === 'pregame');
    if (pregame) {
      await pregame.send('🔄 Server has been reset. Use `/join` to start a new campaign.');
    }

    await interaction.editReply('✅ Game reset complete. All channels wiped, database cleared.');
  },
};
