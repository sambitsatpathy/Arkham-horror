const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requirePlayer, getPlayer, updatePlayer } = require('../../engine/gameState');
const { findCardByCode, loadAllCards } = require('../../engine/cardLookup');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const CARD_SLOTS = ['card1','card2','card3','card4','card5','card6','card7','card8','card9','card10'];

function cardOpt(opt, num, required) {
  return opt.setName(`card${num}`).setDescription(`Card ${num}`).setRequired(required).setAutocomplete(true);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('subdeck')
    .setDescription('Manage the card deck attached to an in-play tome or asset.')
    .addSubcommand(sub =>
      sub.setName('init')
        .setDescription('Set up a subdeck on an asset with specific cards (replaces existing).')
        .addStringOption(opt =>
          opt.setName('asset').setDescription('In-play asset to attach the deck to').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => cardOpt(opt, 1, true))
        .addStringOption(opt => cardOpt(opt, 2, false))
        .addStringOption(opt => cardOpt(opt, 3, false))
        .addStringOption(opt => cardOpt(opt, 4, false))
        .addStringOption(opt => cardOpt(opt, 5, false))
        .addStringOption(opt => cardOpt(opt, 6, false))
        .addStringOption(opt => cardOpt(opt, 7, false))
        .addStringOption(opt => cardOpt(opt, 8, false))
        .addStringOption(opt => cardOpt(opt, 9, false))
        .addStringOption(opt => cardOpt(opt, 10, false))
        .addBooleanOption(opt =>
          opt.setName('shuffle').setDescription('Shuffle the deck (default: true)').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription("Add a card to an asset's existing subdeck.")
        .addStringOption(opt =>
          opt.setName('asset').setDescription('In-play asset').setRequired(true).setAutocomplete(true))
        .addStringOption(opt =>
          opt.setName('card').setDescription('Card to add').setRequired(true).setAutocomplete(true))
        .addBooleanOption(opt =>
          opt.setName('bottom').setDescription('Add to bottom instead of top (default: top)').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription("View the current subdeck of an asset.")
        .addStringOption(opt =>
          opt.setName('asset').setDescription('In-play asset').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub =>
      sub.setName('clear')
        .setDescription('Remove the subdeck from an asset.')
        .addStringOption(opt =>
          opt.setName('asset').setDescription('In-play asset').setRequired(true).setAutocomplete(true))),

  async autocomplete(interaction) {
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.respond([]);

    const focused = interaction.options.getFocused(true);
    const sub = interaction.options.getSubcommand();
    const assets = JSON.parse(player.assets || '[]');

    if (focused.name === 'asset') {
      const query = focused.value.toLowerCase();
      return interaction.respond(
        assets
          .filter(a => !query || a.name.toLowerCase().includes(query))
          .map(a => {
            const deckInfo = Array.isArray(a.subdeck) ? ` [subdeck: ${a.subdeck.length}]` : '';
            return { name: `${a.name}${deckInfo}`, value: a.code };
          })
          .slice(0, 25)
      );
    }

    // Card autocomplete for init (card1-card10) and add (card)
    if (focused.name.startsWith('card')) {
      const query = focused.value.toLowerCase();

      // Exclude cards already chosen in other slots
      const chosen = new Set(
        CARD_SLOTS
          .filter(n => n !== focused.name)
          .map(n => interaction.options.getString(n))
          .filter(Boolean)
      );

      const allCards = loadAllCards();
      return interaction.respond(
        allCards
          .filter(c => !chosen.has(c.code) && (!query || c.name.toLowerCase().includes(query)))
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 25)
          .map(c => ({ name: c.name, value: c.code }))
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
    const assetCode = interaction.options.getString('asset');
    const assets = JSON.parse(player.assets || '[]');
    const asset = assets.find(a => a.code === assetCode);

    if (!asset) {
      return interaction.reply({ content: '❌ That asset is not in play.', flags: 64 });
    }

    // ── INIT ─────────────────────────────────────────────────────────────────
    if (sub === 'init') {
      const cards = CARD_SLOTS.map(n => interaction.options.getString(n)).filter(Boolean);
      const doShuffle = interaction.options.getBoolean('shuffle') ?? true;
      asset.subdeck = doShuffle ? shuffle(cards) : cards;
      updatePlayer(player.id, { assets: JSON.stringify(assets) });

      const names = asset.subdeck.map((c, i) => {
        const name = findCardByCode(c)?.card.name || c;
        return `  ${i + 1}. ${name}`;
      });
      const shuffleNote = doShuffle ? ' (shuffled)' : '';
      return interaction.reply({
        content: [`## 📚 Subdeck set on **${asset.name}**${shuffleNote}`, ...names].join('\n'),
        flags: 64,
      });
    }

    // ── ADD ───────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const cardCode = interaction.options.getString('card');
      const toBottom = interaction.options.getBoolean('bottom') ?? false;
      if (!Array.isArray(asset.subdeck)) asset.subdeck = [];

      if (toBottom) {
        asset.subdeck.push(cardCode);
      } else {
        asset.subdeck.unshift(cardCode);
      }

      updatePlayer(player.id, { assets: JSON.stringify(assets) });
      const name = findCardByCode(cardCode)?.card.name || cardCode;
      const pos = toBottom ? 'bottom' : 'top';
      return interaction.reply({
        content: `📚 Added **${name}** to ${pos} of **${asset.name}**'s subdeck (${asset.subdeck.length} cards total).`,
        flags: 64,
      });
    }

    // ── VIEW ──────────────────────────────────────────────────────────────────
    if (sub === 'view') {
      if (!Array.isArray(asset.subdeck) || asset.subdeck.length === 0) {
        return interaction.reply({ content: `📚 **${asset.name}** has no subdeck.`, flags: 64 });
      }
      const lines = [`## 📚 Subdeck of **${asset.name}** (${asset.subdeck.length} cards)`];
      asset.subdeck.forEach((c, i) => {
        const name = findCardByCode(c)?.card.name || c;
        lines.push(`  ${i + 1}. ${name}`);
      });
      return interaction.reply({ content: lines.join('\n'), flags: 64 });
    }

    // ── CLEAR ─────────────────────────────────────────────────────────────────
    if (sub === 'clear') {
      delete asset.subdeck;
      updatePlayer(player.id, { assets: JSON.stringify(assets) });
      return interaction.reply({ content: `📚 Subdeck removed from **${asset.name}**.`, flags: 64 });
    }
  },
};
