const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getPlayer } = require('../../engine/gameState');
const { discardCard } = require('../../engine/deck');
const { findCardByCode } = require('../../engine/cardLookup');
const { handChannelName } = require('../../config');
const { refreshHandDisplay } = require('../../engine/handDisplay');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('discard')
    .setDescription('Discard a card from your hand.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('card')
        .setDescription('Card to discard')
        .setRequired(true)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.respond([]);

    const hand = JSON.parse(player.hand || '[]');
    const query = interaction.options.getFocused().toLowerCase();

    const seen = new Set();
    const choices = hand
      .flatMap(code => {
        if (seen.has(code)) return [];
        seen.add(code);
        const result = findCardByCode(code);
        const name = result?.card.name || code;
        if (query && !name.toLowerCase().includes(query)) return [];
        return [{ name, value: code }];
      })
      .slice(0, 25);

    await interaction.respond(choices);
  },

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const cardCode = interaction.options.getString('card');
    const hand = JSON.parse(player.hand || '[]');

    if (!hand.includes(cardCode)) {
      return interaction.reply({ content: `❌ That card is not in your hand.`, flags: 64 });
    }

    discardCard(player, cardCode);
    const result = findCardByCode(cardCode);
    const name = result?.card.name || cardCode;

    await refreshHandDisplay(interaction.guild, player);

    await interaction.reply({ content: `✅ Discarded **${name}**.`, flags: 64 });
  },
};
