const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { requireSession, requirePlayer } = require('../../engine/gameState');
const { drawCards } = require('../../engine/deck');
const { findCardByCode } = require('../../engine/cardLookup');
const { handChannelName } = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('draw')
    .setDescription('Draw cards from your deck.')
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

    const handCh = interaction.guild.channels.cache.find(c => c.name === handChannelName(player.investigator_name));
    const lines = [`🃏 Drew **${drawn.length}** card${drawn.length !== 1 ? 's' : ''}:`];

    for (const code of drawn) {
      const result = findCardByCode(code);
      const name = result?.card.name || code;
      lines.push(`  • ${name}`);

      if (handCh) {
        if (result?.imagePath) {
          const att = new AttachmentBuilder(result.imagePath, { name: 'card.png' });
          await handCh.send({ content: `🃏 **${player.investigator_name}** drew **${name}**`, files: [att] });
        } else {
          await handCh.send(`🃏 **${player.investigator_name}** drew **${name}**`);
        }
      }
    }

    return interaction.editReply(lines.join('\n'));
  },
};
