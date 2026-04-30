const { SlashCommandBuilder } = require('discord.js');
const { requireHost, resetDb } = require('../../engine/gameState');
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
    resetDb();

    // Remove host role
    const hostRole = interaction.guild.roles.cache.find(r => r.name === '🎲 Game Host');
    if (hostRole) await hostRole.delete().catch(() => {});

    const pregame = interaction.guild.channels.cache.find(c => c.name === 'pre-game');
    if (pregame) {
      await pregame.send('🔄 Server has been reset. Use `/join` to start a new campaign.');
    }

    await interaction.editReply('✅ Game reset complete. All channels wiped, database cleared.');
  },
};
