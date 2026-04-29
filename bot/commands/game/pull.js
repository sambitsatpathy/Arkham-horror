const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getSession } = require('../../engine/gameState');
const { drawToken, formatPull } = require('../../engine/chaosBag');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pull')
    .setDescription('Draw a chaos token for a skill test.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const token = drawToken(session.difficulty);
    const pullText = formatPull(player.investigator_name || interaction.user.username, token, 'Resolve token effect for this scenario.');

    const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
    if (chaosCh) {
      await chaosCh.send(pullText);
      await interaction.reply({ content: `Token drawn — see ${chaosCh}.`, flags: 64 });
    } else {
      await interaction.reply(pullText);
    }
  },
};
