const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, updatePlayer } = require('../../engine/gameState');
const { trySpendAction, actionGuardMessage } = require('../../engine/actionEconomy');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resource')
    .setDescription('Gain 1 resource.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const spend = trySpendAction(player.id, session);
    if (!spend.ok) {
      return interaction.reply({ content: actionGuardMessage(), flags: 64 });
    }

    const newTotal = player.resources + 1;
    updatePlayer(player.id, { resources: newTotal });
    await interaction.reply({ content: `💰 Gained 1 resource. Total: **${newTotal}**${spend.note ? ` ${spend.note}` : ''}`, flags: 64 });
  },
};
