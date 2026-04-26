const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { requireSession, requirePlayer } = require('../../engine/gameState');
const { findCardByCode } = require('../../engine/cardLookup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hand')
    .setDescription('Show your current hand of cards (sent to your private hand channel).'),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    await interaction.deferReply({ flags: 64 });

    const hand = JSON.parse(player.hand || '[]');
    if (hand.length === 0) {
      return interaction.editReply('Your hand is empty. Use `/draw` to draw cards.');
    }

    // Find the player's private hand channel
    const safeName = player.investigator_name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-hand';
    const handCh = interaction.guild.channels.cache.find(c => c.name === safeName);

    if (!handCh) {
      return interaction.editReply('Your hand channel was not found. Has the game started?');
    }

    await handCh.send(`📋 **${player.investigator_name}'s hand (${hand.length} card${hand.length !== 1 ? 's' : ''}):**`);

    for (const code of hand) {
      const result = findCardByCode(code);
      if (result?.imagePath) {
        const att = new AttachmentBuilder(result.imagePath, { name: 'card.png' });
        await handCh.send({ content: `🃏 **${result.card.name}**`, files: [att] });
      } else {
        await handCh.send(`🃏 \`${code}\``);
      }
    }

    await interaction.editReply(`✅ Your hand (${hand.length} card${hand.length !== 1 ? 's' : ''}) has been posted to ${handCh}.`);
  },
};
