const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { requireSession, requirePlayer, getPlayer, getSession, getPlayerById, updatePlayer } = require('../../engine/gameState');
const { findCardByCode } = require('../../engine/cardLookup');
const { drawCards, shuffle } = require('../../engine/deck');
const { refreshHandDisplay } = require('../../engine/handDisplay');

function buildMulliganEmbed(player) {
  const hand = JSON.parse(player.hand || '[]');

  const selectOptions = hand.map((code, idx) => {
    const result = findCardByCode(code);
    const name = result?.card.name || code;
    return { label: name.slice(0, 100), value: `${code}__${idx}`, description: code.slice(0, 100) };
  });

  const components = [];

  if (selectOptions.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('mull:swap')
      .setPlaceholder('Pick cards to swap (selecting finalizes mulligan)…')
      .setMinValues(0)
      .setMaxValues(selectOptions.length)
      .addOptions(selectOptions);
    components.push(new ActionRowBuilder().addComponents(select));
  }

  const keepBtn = new ButtonBuilder()
    .setCustomId('mull:done')
    .setLabel('Keep this hand')
    .setStyle(ButtonStyle.Success);
  components.push(new ActionRowBuilder().addComponents(keepBtn));

  const handNames = hand.map(code => {
    const r = findCardByCode(code);
    return r?.card.name || code;
  });

  return {
    content: `**Mulligan** — Opening hand (${hand.length} cards):\n${handNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n\nPick cards to swap (single submission, replacements drawn + discards shuffled into deck) **or** click **Keep this hand**.`,
    components,
    flags: 64,
  };
}

async function handleMulliganSwap(interaction) {
  await interaction.deferUpdate();

  const player = getPlayer(interaction.user.id);
  if (!player) return interaction.editReply({ content: '❌ You are not registered. Use `/join` first.', components: [] });

  const session = getSession();
  if (!session || session.phase === 'pregame') return interaction.editReply({ content: '❌ No active game session.', components: [] });

  if (session.round !== 1 || session.phase !== 'investigation') {
    return interaction.editReply({ content: '❌ Mulligan only available round 1 investigation phase.', components: [] });
  }

  const selected = interaction.values;
  const toDiscard = selected.map(v => {
    const parts = v.split('__');
    return { code: parts[0], idx: parseInt(parts[1], 10) };
  });

  let hand = JSON.parse(player.hand || '[]');
  const swapped = [];
  toDiscard.sort((a, b) => b.idx - a.idx);
  for (const { code, idx } of toDiscard) {
    if (idx >= 0 && idx < hand.length && hand[idx] === code) {
      hand.splice(idx, 1);
      swapped.push(code);
    }
  }

  // Draw replacements from current deck for the cards being swapped
  let deck = JSON.parse(player.deck || '[]');
  const drawn = deck.splice(0, swapped.length);
  hand.push(...drawn);

  // Shuffle the swapped-out cards back into the deck (mulligan rule)
  deck = shuffle([...deck, ...swapped]);

  updatePlayer(player.id, {
    hand: JSON.stringify(hand),
    deck: JSON.stringify(deck),
  });

  const finalPlayer = getPlayerById(player.id);
  await refreshHandDisplay(interaction.guild, finalPlayer);

  const swappedNames = swapped.map(c => findCardByCode(c)?.card.name || c).join(', ');
  await interaction.editReply({
    content: `✅ Mulligan complete. Swapped **${swapped.length}** card${swapped.length !== 1 ? 's' : ''}${swapped.length ? ` (${swappedNames})` : ''}. Replacements drawn; discarded cards shuffled back into deck.`,
    components: [],
  });
}

async function handleMulliganDone(interaction) {
  await interaction.deferUpdate();

  const player = getPlayer(interaction.user.id);
  if (!player) return interaction.editReply({ content: '❌ You are not registered.', components: [] });

  await interaction.editReply({ content: '✅ Kept opening hand. No cards swapped.', components: [] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mulligan')
    .setDescription('Swap cards from your opening hand. Round 1 only.'),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    if (session.round !== 1 || session.phase !== 'investigation') {
      return interaction.reply({ content: '❌ Mulligan only available during round 1 investigation phase.', flags: 64 });
    }

    const msg = buildMulliganEmbed(player);
    await interaction.reply(msg);
  },

  handleButton: handleMulliganDone,
  handleSelect: handleMulliganSwap,
};
