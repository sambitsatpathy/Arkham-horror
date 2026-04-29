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
      .setPlaceholder('Select cards to swap out…')
      .setMinValues(0)
      .setMaxValues(selectOptions.length)
      .addOptions(selectOptions);
    components.push(new ActionRowBuilder().addComponents(select));
  }

  const doneBtn = new ButtonBuilder()
    .setCustomId('mull:done')
    .setLabel('Done — shuffle rest into deck')
    .setStyle(ButtonStyle.Success);
  components.push(new ActionRowBuilder().addComponents(doneBtn));

  const handNames = hand.map(code => {
    const r = findCardByCode(code);
    return r?.card.name || code;
  });

  return {
    content: `**Mulligan** — Current hand (${hand.length} cards):\n${handNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n\nSelect cards to swap, or click **Done** to keep this hand.`,
    components,
    flags: 64,
  };
}

async function handleMulliganSwap(interaction) {
  const player = getPlayer(interaction.user.id);
  if (!player) return interaction.update({ content: '❌ You are not registered. Use `/join` first.', components: [], flags: 64 });

  const session = getSession();
  if (!session || session.phase === 'pregame') return interaction.update({ content: '❌ No active game session.', components: [], flags: 64 });

  if (session.round !== 1 || session.phase !== 'investigation') {
    return interaction.update({ content: '❌ Mulligan only available round 1 investigation phase.', components: [], flags: 64 });
  }

  const selected = interaction.values;
  const toDiscard = selected.map(v => {
    const parts = v.split('__');
    return { code: parts[0], idx: parseInt(parts[1], 10) };
  });

  let hand = JSON.parse(player.hand || '[]');
  let discard = JSON.parse(player.discard || '[]');
  // Sort descending by index so splicing doesn't shift later indices
  toDiscard.sort((a, b) => b.idx - a.idx);
  for (const { code, idx } of toDiscard) {
    if (idx >= 0 && idx < hand.length && hand[idx] === code) {
      hand.splice(idx, 1);
      discard.push(code);
    }
  }
  updatePlayer(player.id, { hand: JSON.stringify(hand), discard: JSON.stringify(discard) });

  const freshPlayer = getPlayerById(player.id);
  drawCards(freshPlayer, toDiscard.length);

  const finalPlayer = getPlayerById(player.id);
  await refreshHandDisplay(interaction.guild, finalPlayer);

  const msg = buildMulliganEmbed(finalPlayer);
  await interaction.update(msg);
}

async function handleMulliganDone(interaction) {
  const player = getPlayer(interaction.user.id);
  if (!player) return interaction.update({ content: '❌ You are not registered.', components: [], flags: 64 });

  let deck = JSON.parse(player.deck || '[]');
  let discard = JSON.parse(player.discard || '[]');
  deck = shuffle([...deck, ...discard]);
  updatePlayer(player.id, { deck: JSON.stringify(deck), discard: JSON.stringify([]) });

  await interaction.update({ content: '✅ Mulligan complete. Remaining cards shuffled back into deck.', components: [], flags: 64 });
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
