const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requirePlayer } = require('../../engine/gameState');
const { discardCard } = require('../../engine/deck');
const { findCardByCode } = require('../../engine/cardLookup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('discard')
    .setDescription('Discard a card from your hand.')
    .addStringOption(opt =>
      opt.setName('card')
        .setDescription('Card name or code')
        .setRequired(true)),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const query = interaction.options.getString('card');
    const hand = JSON.parse(player.hand);

    let cardCode = null;
    for (const code of hand) {
      if (code === query) { cardCode = code; break; }
      const result = findCardByCode(code);
      if (result && result.card.name.toLowerCase().includes(query.toLowerCase())) {
        cardCode = code;
        break;
      }
    }

    if (!cardCode) {
      return interaction.reply({ content: `Card "${query}" not found in your hand.`, flags: 64 });
    }

    discardCard(player, cardCode);
    const result = findCardByCode(cardCode);
    const name = result?.card.name || cardCode;

    const safeName = player.investigator_name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-hand';
    const handCh = interaction.guild.channels.cache.find(c => c.name === safeName);
    if (handCh) await handCh.send(`🗑️ Discarded: **${name}**`);

    await interaction.reply({ content: `✅ Discarded **${name}**.`, flags: 64 });
  },
};
