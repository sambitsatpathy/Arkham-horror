const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { requireSession, requirePlayer, getPlayer, getPlayers, getCampaign, updatePlayer } = require('../../engine/gameState');
const { findCardByCode } = require('../../engine/cardLookup');
const { handChannelName } = require('../../config');

// scry_buffer stores: { cards: string[], source: 'deck' | assetCode, targetPlayerId: number }

function getBuffer(player) {
  try { return JSON.parse(player.scry_buffer || 'null') || null; } catch { return null; }
}

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
          opt.setName('source')
            .setDescription('Which deck to scry: your deck, another player\'s deck, or a tome in play (default: your deck)')
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

    if (sub === 'reveal' && focused.name === 'source') {
      const query = focused.value.toLowerCase();
      const options = [];

      // Other players' decks
      const campaign = getCampaign();
      if (campaign) {
        const players = getPlayers(campaign.id).filter(p => p.id !== player.id && p.investigator_name);
        for (const p of players) {
          const label = `${p.investigator_name}'s deck`;
          if (!query || label.toLowerCase().includes(query)) {
            options.push({ name: label, value: `player:${p.id}` });
          }
        }
      }

      // In-play assets with a subdeck
      const assets = JSON.parse(player.assets || '[]');
      for (const a of assets) {
        if (Array.isArray(a.subdeck) && a.subdeck.length > 0) {
          const label = `${a.name} (tome deck, ${a.subdeck.length} cards)`;
          if (!query || label.toLowerCase().includes(query)) {
            options.push({ name: label, value: `asset:${a.code}` });
          }
        }
      }

      return interaction.respond(options.slice(0, 25));
    }

    if (sub === 'place') {
      const buf = getBuffer(player);
      if (!buf || !buf.cards.length) return interaction.respond([]);

      const query = focused.value.toLowerCase();
      const slotNames = ['card1','card2','card3','card4','card5','card6','card7','card8','card9','card10'];
      const chosen = new Set(
        slotNames.filter(n => n !== focused.name)
          .map(n => interaction.options.getString(n)).filter(Boolean)
      );

      return interaction.respond(
        buf.cards
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
      const sourceOpt = interaction.options.getString('source'); // 'player:ID', 'asset:CODE', or null

      let deck;
      let sourceLabel;
      let bufSource = 'deck'; // what to write back into scry_buffer.source
      let targetPlayerId = player.id;

      if (!sourceOpt || sourceOpt === 'deck') {
        // Own main deck
        deck = JSON.parse(player.deck || '[]');
        sourceLabel = 'your';
      } else if (sourceOpt.startsWith('player:')) {
        // Another player's deck
        const targetId = parseInt(sourceOpt.slice(7), 10);
        const campaign = getCampaign();
        const others = getPlayers(campaign.id);
        const targetPlayer = others.find(p => p.id === targetId);
        if (!targetPlayer) return interaction.reply({ content: '❌ Target player not found.', flags: 64 });
        deck = JSON.parse(targetPlayer.deck || '[]');
        sourceLabel = `**${targetPlayer.investigator_name}**'s`;
        bufSource = sourceOpt;
        targetPlayerId = targetPlayer.id;
      } else if (sourceOpt.startsWith('asset:')) {
        // Tome/asset subdeck
        const assetCode = sourceOpt.slice(6);
        const assets = JSON.parse(player.assets || '[]');
        const asset = assets.find(a => a.code === assetCode);
        if (!asset || !Array.isArray(asset.subdeck)) {
          return interaction.reply({ content: '❌ That asset has no subdeck.', flags: 64 });
        }
        deck = asset.subdeck;
        sourceLabel = `**${asset.name}**'s`;
        bufSource = sourceOpt;
      } else {
        return interaction.reply({ content: '❌ Unknown source.', flags: 64 });
      }

      if (deck.length === 0) {
        return interaction.reply({ content: `❌ ${sourceLabel} deck is empty.`, flags: 64 });
      }

      const revealed = deck.slice(0, Math.min(count, deck.length));
      const buf = { cards: revealed, source: bufSource, targetPlayerId };
      updatePlayer(player.id, { scry_buffer: JSON.stringify(buf) });

      await interaction.deferReply({ flags: 64 });

      const lines = [`## 🔮 Scry — top ${revealed.length} card${revealed.length !== 1 ? 's' : ''} of ${sourceLabel} deck`, ''];
      const files = [];

      for (let i = 0; i < revealed.length; i++) {
        const code = revealed[i];
        const result = findCardByCode(code);
        const name = result?.card.name || code;
        lines.push(`**${i + 1}.** ${name}`);
        if (result?.imagePath) files.push(new AttachmentBuilder(result.imagePath, { name: `card_${i + 1}.png` }));
      }

      lines.push('', `Use \`/scry place\` to put them back in a new order. Any omitted cards go to the bottom.`);

      const handCh = interaction.guild.channels.cache.find(c => c.name === handChannelName(player.investigator_name));
      if (handCh && files.length) {
        await handCh.send({ content: `🔮 **Scrying** ${sourceLabel} deck — top ${revealed.length} cards:`, files });
      }

      return interaction.editReply({ content: lines.join('\n') });
    }

    // ── PLACE ────────────────────────────────────────────────────────────────
    if (sub === 'place') {
      const buf = getBuffer(player);
      if (!buf || !buf.cards.length) {
        return interaction.reply({ content: '❌ No scry in progress. Use `/scry reveal` first.', flags: 64 });
      }

      const slotNames = ['card1','card2','card3','card4','card5','card6','card7','card8','card9','card10'];
      const ordered = slotNames.map(n => interaction.options.getString(n)).filter(Boolean);

      const invalid = ordered.filter(c => !buf.cards.includes(c));
      if (invalid.length) {
        return interaction.reply({ content: `❌ These cards are not in your scry buffer: ${invalid.join(', ')}`, flags: 64 });
      }

      const bottomCards = buf.cards.filter(c => !ordered.includes(c));

      if (!buf.source || buf.source === 'deck') {
        // Own main deck
        const deck = JSON.parse(player.deck || '[]');
        const deckWithoutBuffer = deck.filter(c => !buf.cards.includes(c));
        const newDeck = [...ordered, ...deckWithoutBuffer, ...bottomCards];
        updatePlayer(player.id, { deck: JSON.stringify(newDeck), scry_buffer: 'null' });

      } else if (buf.source.startsWith('player:')) {
        // Another player's deck
        const targetId = buf.targetPlayerId;
        const campaign = getCampaign();
        const others = getPlayers(campaign.id);
        const targetPlayer = others.find(p => p.id === targetId);
        if (!targetPlayer) return interaction.reply({ content: '❌ Target player no longer found.', flags: 64 });
        const deck = JSON.parse(targetPlayer.deck || '[]');
        const deckWithoutBuffer = deck.filter(c => !buf.cards.includes(c));
        const newDeck = [...ordered, ...deckWithoutBuffer, ...bottomCards];
        updatePlayer(targetPlayer.id, { deck: JSON.stringify(newDeck) });
        updatePlayer(player.id, { scry_buffer: 'null' });

      } else if (buf.source.startsWith('asset:')) {
        // Tome/asset subdeck
        const assetCode = buf.source.slice(6);
        const assets = JSON.parse(player.assets || '[]');
        const asset = assets.find(a => a.code === assetCode);
        if (!asset) return interaction.reply({ content: '❌ Asset no longer in play.', flags: 64 });
        const subdeckWithoutBuffer = (asset.subdeck || []).filter(c => !buf.cards.includes(c));
        asset.subdeck = [...ordered, ...subdeckWithoutBuffer, ...bottomCards];
        updatePlayer(player.id, { assets: JSON.stringify(assets), scry_buffer: 'null' });
      }

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
