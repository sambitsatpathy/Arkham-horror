const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer } = require('../../engine/gameState');
const { drawCards } = require('../../engine/deck');
const { refreshHandDisplay } = require('../../engine/handDisplay');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('draw')
    .setDescription('Draw cards from your deck.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(opt =>
      opt.setName('count')
        .setDescription('Number of cards to draw (default 1)')
        .setMinValue(1)
        .setMaxValue(10)),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const count = interaction.options.getInteger('count') ?? 1;
    await interaction.deferReply({ flags: 64 });

    const drawn = drawCards(player, count);
    if (drawn.length === 0) {
      return interaction.editReply('Your deck and discard are both empty — no cards to draw.');
    }

    await refreshHandDisplay(interaction.guild, player);

    return interaction.editReply(`✅ Drew **${drawn.length}** card${drawn.length !== 1 ? 's' : ''}.`);
  },
};
