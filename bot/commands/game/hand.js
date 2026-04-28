const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requirePlayer } = require('../../engine/gameState');
const { refreshHandDisplay } = require('../../engine/handDisplay');
const { handChannelName } = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hand')
    .setDescription('Refresh the pinned hand display in your private channel.'),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    await interaction.deferReply({ flags: 64 });

    const handCh = interaction.guild.channels.cache.find(c => c.name === handChannelName(player.investigator_name));
    if (!handCh) {
      return interaction.editReply('❌ Your hand channel was not found. Has the game started?');
    }

    await refreshHandDisplay(interaction.guild, player);
    return interaction.editReply(`✅ Hand display refreshed in ${handCh}.`);
  },
};
