const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requirePlayer, updatePlayer } = require('../../engine/gameState');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resource')
    .setDescription('Gain 1 resource.'),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const newTotal = player.resources + 1;
    updatePlayer(player.id, { resources: newTotal });
    await interaction.reply({ content: `💰 Gained 1 resource. Total: **${newTotal}**`, flags: 64 });
  },
};
