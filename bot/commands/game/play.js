const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { requireSession, requirePlayer, getPlayerById, updatePlayer } = require('../../engine/gameState');
const { discardCard, playAsset } = require('../../engine/deck');
const { findCardByCode, getCardCharges } = require('../../engine/cardLookup');
const { handChannelName } = require('../../config');

const TYPE_LABEL = {
  asset: 'Asset',
  event: 'Event',
  skill: 'Skill',
  treachery: 'Treachery',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a card from your hand.')
    .addStringOption(opt =>
      opt.setName('card')
        .setDescription('Card to play')
        .setRequired(true)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.respond([]);

    const hand = JSON.parse(player.hand || '[]');
    const focused = interaction.options.getFocused().toLowerCase();

    const choices = hand.flatMap(code => {
      const result = findCardByCode(code);
      if (!result) return [];
      const { card } = result;
      const type = TYPE_LABEL[card.type_code] || card.type_code;
      const costStr = card.cost != null ? ` | ${card.cost}r` : '';
      const label = `${card.name} [${type}${costStr}]`;
      if (focused && !card.name.toLowerCase().includes(focused)) return [];
      return [{ name: label, value: code }];
    }).slice(0, 25);

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
      return interaction.reply({ content: 'That card is not in your hand.', flags: 64 });
    }

    const result = findCardByCode(cardCode);
    const card = result?.card;
    const name = card?.name || cardCode;
    const typeCode = card?.type_code;
    const cost = card?.cost ?? 0;

    if (cost > 0 && player.resources < cost) {
      return interaction.reply({
        content: `❌ Not enough resources to play **${name}** (costs ${cost}, you have ${player.resources}).`,
        flags: 64,
      });
    }

    const handCh = interaction.guild.channels.cache.find(c => c.name === handChannelName(player.investigator_name));

    if (typeCode === 'skill') {
      return interaction.reply({
        content: `**${name}** is a skill card — use \`/commit\` to commit it to a skill test.`,
        flags: 64,
      });
    }

    if (typeCode === 'asset') {
      const charges = getCardCharges(cardCode);
      playAsset(player, cardCode, name, charges);
      // Single write: merge resource deduction with the asset update
      if (cost > 0) {
        const fresh = getPlayerById(player.id);
        updatePlayer(player.id, { resources: fresh.resources - cost });
      }

      const chargesNote = charges > 0 ? ` with **${charges} charge${charges !== 1 ? 's' : ''}**` : '';
      const costNote = cost > 0 ? ` (spent ${cost} resource${cost !== 1 ? 's' : ''}, ${player.resources - cost} remaining)` : '';
      const msg = `🃏 Played asset: **${name}**${chargesNote} *(now in play)*`;

      if (handCh) {
        if (result?.imagePath) {
          await handCh.send({ content: msg, files: [new AttachmentBuilder(result.imagePath, { name: 'card.png' })] });
        } else {
          await handCh.send(msg);
        }
      }
      return interaction.reply({ content: `✅ **${name}** is now in play${chargesNote}.${costNote}`, flags: 64 });
    }

    // Event / everything else — play and discard, deduct resources in one write
    discardCard(player, cardCode);
    if (cost > 0) {
      const fresh = getPlayerById(player.id);
      updatePlayer(player.id, { resources: fresh.resources - cost });
    }

    const costNote = cost > 0 ? ` (spent ${cost} resource${cost !== 1 ? 's' : ''}, ${player.resources - cost} remaining)` : '';
    const msg = `▶️ Played: **${name}** *(discarded)*`;
    if (handCh) {
      if (result?.imagePath) {
        await handCh.send({ content: msg, files: [new AttachmentBuilder(result.imagePath, { name: 'card.png' })] });
      } else {
        await handCh.send(msg);
      }
    }
    await interaction.reply({ content: `✅ Played **${name}**.${costNote}`, flags: 64 });
  },
};
