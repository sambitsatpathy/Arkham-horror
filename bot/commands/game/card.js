const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { findCard } = require('../../engine/cardLookup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('card')
    .setDescription('Look up any card image.')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Card name to search for')
        .setRequired(true)),

  async execute(interaction) {
    const query = interaction.options.getString('name');
    const result = findCard(query);

    if (!result) {
      return interaction.reply({ content: `No card found matching "${query}".`, flags: 64 });
    }

    const { card, imagePath } = result;
    const typeLabel = card.type_code.charAt(0).toUpperCase() + card.type_code.slice(1);
    const content = `🃏 **${card.name}**${card.subname ? ` — *${card.subname}*` : ''} *(${typeLabel})*`;

    if (imagePath) {
      const attachment = new AttachmentBuilder(imagePath, { name: 'card.png' });
      await interaction.reply({ content, files: [attachment] });
    } else {
      await interaction.reply({ content: content + '\n⚠️ Image not found locally.' });
    }
  },
};
