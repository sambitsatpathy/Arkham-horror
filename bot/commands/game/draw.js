const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { requireSession, requirePlayer, getCampaign } = require('../../engine/gameState');
const { drawCards } = require('../../engine/deck');
const { findCardByCode } = require('../../engine/cardLookup');

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

    // Post drawn cards to hand channel
    const { getDb } = require('../../db/database');
    const handChannelId = await findHandChannel(interaction.guild, player.discord_name);

    if (handChannelId) {
      const handCh = interaction.guild.channels.cache.get(handChannelId);
      if (handCh) {
        for (const code of drawn) {
          const result = findCardByCode(code);
          if (result?.imagePath) {
            const att = new AttachmentBuilder(result.imagePath, { name: 'card.png' });
            await handCh.send({ content: `🃏 Drew: **${result.card.name}**`, files: [att] });
          } else {
            await handCh.send(`🃏 Drew: \`${code}\``);
          }
        }
      }
    }

    await interaction.editReply(`✅ Drew ${drawn.length} card(s).`);
  },
};

async function findHandChannel(guild, investigatorName) {
  const safeName = investigatorName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-hand';
  const ch = guild.channels.cache.find(c => c.name === safeName);
  return ch?.id || null;
}
