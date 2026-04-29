const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { requireSession, requirePlayer, getPlayerById, updatePlayer } = require('../../engine/gameState');
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
  const player = requirePlayer(interaction);
  if (!player) return;

  const session = requireSession(interaction);
  if (!session) return;

  if (session.round !== 1 || session.phase !== 'investigation') {
    return interaction.update({ content: '❌ Mulligan only available round 1 investigation phase.', components: [], flags: 64 });
  }

  const selected = interaction.values;
  const codesToDiscard = selected.map(v => v.split('__')[0]);

  let hand = JSON.parse(player.hand || '[]');
  let discard = JSON.parse(player.discard || '[]');
  for (const code of codesToDiscard) {
    const idx = hand.indexOf(code);
    if (idx !== -1) {
      hand.splice(idx, 1);
      discard.push(code);
    }
  }
  updatePlayer(player.id, { hand: JSON.stringify(hand), discard: JSON.stringify(discard) });

  const freshPlayer = getPlayerById(player.id);
  drawCards(freshPlayer, codesToDiscard.length);

  const finalPlayer = getPlayerById(player.id);
  await refreshHandDisplay(interaction.guild, finalPlayer);

  const msg = buildMulliganEmbed(finalPlayer);
  await interaction.update(msg);
}

async function handleMulliganDone(interaction) {
  const player = requirePlayer(interaction);
  if (!player) return;

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
