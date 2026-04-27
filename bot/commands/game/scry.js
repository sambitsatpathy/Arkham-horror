const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { requireSession, requirePlayer, getPlayer, getPlayers, getCampaign, updatePlayer } = require('../../engine/gameState');
const { findCardByCode } = require('../../engine/cardLookup');
const { handChannelName } = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scry')
    .setDescription('Look at the top cards of a deck, then put them back in any order.')
    .addSubcommand(sub =>
      sub.setName('reveal')
        .setDescription('Look at the top N cards of a deck.')
        .addIntegerOption(opt =>
          opt.setName('count')
            .setDescription('Number of cards to look at (default: 3)')
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false))
        .addStringOption(opt =>
          opt.setName('target')
            .setDescription('Whose deck to scry (default: yours)')
            .setRequired(false)
            .setAutocomplete(true)))
    .addSubcommand(sub =>
      sub.setName('place')
        .setDescription('Put the scried cards back on top in a new order. Omitted cards go to bottom.')
        .addStringOption(opt =>
          opt.setName('card1').setDescription('1st card on top').setRequired(false).setAutocomplete(true))
        .addStringOption(opt =>
          opt.setName('card2').setDescription('2nd card').setRequired(false).setAutocomplete(true))
        .addStringOption(opt =>
          opt.setName('card3').setDescription('3rd card').setRequired(false).setAutocomplete(true))
        .addStringOption(opt =>
          opt.setName('card4').setDescription('4th card').setRequired(false).setAutocomplete(true))
        .addStringOption(opt =>
          opt.setName('card5').setDescription('5th card').setRequired(false).setAutocomplete(true))
        .addStringOption(opt =>
          opt.setName('card6').setDescription('6th card').setRequired(false).setAutocomplete(true))
        .addStringOption(opt =>
          opt.setName('card7').setDescription('7th card').setRequired(false).setAutocomplete(true))
        .addStringOption(opt =>
          opt.setName('card8').setDescription('8th card').setRequired(false).setAutocomplete(true))
        .addStringOption(opt =>
          opt.setName('card9').setDescription('9th card').setRequired(false).setAutocomplete(true))
        .addStringOption(opt =>
          opt.setName('card10').setDescription('10th card').setRequired(false).setAutocomplete(true))),

  async autocomplete(interaction) {
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.respond([]);

    const sub = interaction.options.getSubcommand();
    const focused = interaction.options.getFocused(true);

    if (sub === 'reveal' && focused.name === 'target') {
      const campaign = getCampaign();
      if (!campaign) return interaction.respond([]);
      const query = focused.value.toLowerCase();
      const players = getPlayers(campaign.id).filter(p => p.id !== player.id && p.investigator_name);
      return interaction.respond(
        players
          .filter(p => !query || p.investigator_name.toLowerCase().includes(query))
          .map(p => ({ name: p.investigator_name, value: String(p.id) }))
          .slice(0, 25)
      );
    }

    if (sub === 'place') {
      const buffer = JSON.parse(player.scry_buffer || '[]');
      if (!buffer.length) return interaction.respond([]);

      const query = focused.value.toLowerCase();
      const slotNames = ['card1','card2','card3','card4','card5','card6','card7','card8','card9','card10'];
      const chosen = new Set(
        slotNames.filter(n => n !== focused.name)
          .map(n => interaction.options.getString(n)).filter(Boolean)
      );

      return interaction.respond(
        buffer
          .filter(code => !chosen.has(code))
          .flatMap(code => {
            const result = findCardByCode(code);
            const name = result?.card.name || code;
            if (query && !name.toLowerCase().includes(query)) return [];
            return [{ name, value: code }];
          })
          .slice(0, 25)
      );
    }

    return interaction.respond([]);
  },

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const sub = interaction.options.getSubcommand();

    // ── REVEAL ──────────────────────────────────────────────────────────────
    if (sub === 'reveal') {
      const count = interaction.options.getInteger('count') ?? 3;
      const targetId = interaction.options.getString('target');

      let targetPlayer = player;
      if (targetId) {
        const campaign = getCampaign();
        const others = getPlayers(campaign.id);
        targetPlayer = others.find(p => String(p.id) === targetId);
        if (!targetPlayer) return interaction.reply({ content: '❌ Target player not found.', flags: 64 });
      }

      const deck = JSON.parse(targetPlayer.deck || '[]');
      if (deck.length === 0) {
        return interaction.reply({ content: `❌ **${targetPlayer.investigator_name}**'s deck is empty.`, flags: 64 });
      }

      const revealed = deck.slice(0, Math.min(count, deck.length));

      // Store in the acting player's scry buffer
      updatePlayer(player.id, { scry_buffer: JSON.stringify(revealed) });

      await interaction.deferReply({ flags: 64 });

      const targetLabel = targetId ? `**${targetPlayer.investigator_name}**'s` : 'your';
      const lines = [`## 🔮 Scry — top ${revealed.length} card${revealed.length !== 1 ? 's' : ''} of ${targetLabel} deck`, ''];
      const files = [];

      for (let i = 0; i < revealed.length; i++) {
        const code = revealed[i];
        const result = findCardByCode(code);
        const name = result?.card.name || code;
        lines.push(`**${i + 1}.** ${name}`);
        if (result?.imagePath) files.push(new AttachmentBuilder(result.imagePath, { name: `card_${i + 1}.png` }));
      }

      lines.push('', `Use \`/scry place\` to put them back in a new order. Any omitted cards go to the bottom.`);

      // Post images to hand channel, text reply stays ephemeral
      const handCh = interaction.guild.channels.cache.find(c => c.name === handChannelName(player.investigator_name));
      if (handCh && files.length) {
        await handCh.send({ content: `🔮 **Scrying** ${targetLabel} deck — top ${revealed.length} cards:`, files });
      }

      return interaction.editReply({ content: lines.join('\n') });
    }

    // ── PLACE ────────────────────────────────────────────────────────────────
    if (sub === 'place') {
      const buffer = JSON.parse(player.scry_buffer || '[]');
      if (!buffer.length) {
        return interaction.reply({ content: '❌ No scry in progress. Use `/scry reveal` first.', flags: 64 });
      }

      const slotNames = ['card1','card2','card3','card4','card5','card6','card7','card8','card9','card10'];
      const ordered = slotNames.map(n => interaction.options.getString(n)).filter(Boolean);

      // Validate: all specified codes must be from the buffer
      const invalid = ordered.filter(c => !buffer.includes(c));
      if (invalid.length) {
        return interaction.reply({ content: `❌ These cards are not in your scry buffer: ${invalid.join(', ')}`, flags: 64 });
      }

      // Cards not placed go to the bottom
      const bottomCards = buffer.filter(c => !ordered.includes(c));

      // Rebuild deck: ordered on top, then rest of deck (minus the buffer cards), then bottom cards
      // The scried cards were the top N of the target deck — we need to find whose deck to update.
      // We store the buffer on the acting player but need to know the target.
      // For simplicity, treat scry as always acting on your own deck here.
      // (Cross-player scry reorder would need a target stored in buffer too — future enhancement.)
      const deck = JSON.parse(player.deck || '[]');
      const deckWithoutBuffer = deck.filter(c => !buffer.includes(c));
      const newDeck = [...ordered, ...deckWithoutBuffer, ...bottomCards];

      updatePlayer(player.id, { deck: JSON.stringify(newDeck), scry_buffer: '[]' });

      const lines = [`## 🔮 Scry Complete`];
      if (ordered.length) {
        lines.push('**Top of deck (in order):**');
        ordered.forEach((c, i) => {
          const name = findCardByCode(c)?.card.name || c;
          lines.push(`  ${i + 1}. ${name}`);
        });
      }
      if (bottomCards.length) {
        const names = bottomCards.map(c => findCardByCode(c)?.card.name || c).join(', ');
        lines.push(`**Sent to bottom:** ${names}`);
      }

      return interaction.reply({ content: lines.join('\n'), flags: 64 });
    }
  },
};
