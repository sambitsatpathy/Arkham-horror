const { SlashCommandBuilder } = require('discord.js');
const { requirePlayer, getCampaign, getSession, updatePlayer } = require('../../engine/gameState');
const { findCardByCode, findCard } = require('../../engine/cardLookup');
const { getDb } = require('../../db/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('upgrade')
    .setDescription('Manage deck upgrades between scenarios.')
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Show your current deck and available XP.'))
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a card, optionally replacing another.')
        .addStringOption(o => o.setName('add_code').setDescription('Card code to add').setRequired(true))
        .addStringOption(o => o.setName('remove_code').setDescription('Card code to remove (optional)')))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a card from your deck (no XP cost).')
        .addStringOption(o => o.setName('code').setDescription('Card code to remove').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('done')
        .setDescription('Lock in upgrades.')),

  async execute(interaction) {
    const player = requirePlayer(interaction);
    if (!player) return;
    const sub = interaction.options.getSubcommand();
    const db = getDb();

    if (sub === 'list') {
      const deck = JSON.parse(player.deck);
      const availableXp = player.xp_total - player.xp_spent;
      const cardCounts = {};
      for (const code of deck) cardCounts[code] = (cardCounts[code] || 0) + 1;

      const lines = Object.entries(cardCounts).map(([code, qty]) => {
        const r = findCardByCode(code);
        const name = r?.card.name || code;
        const xp = r?.card.xp ?? 0;
        return `• ${name} x${qty} (XP ${xp})`;
      });

      await interaction.reply({
        content: [
          `**${player.investigator_name}'s Deck** — XP available: **${availableXp}**`,
          ...lines,
        ].join('\n'),
        flags: 64,
      });
    }

    else if (sub === 'add') {
      const addCode = interaction.options.getString('add_code');
      const removeCode = interaction.options.getString('remove_code');
      const campaign = getCampaign();
      const session = getSession();

      const addResult = findCardByCode(addCode);
      if (!addResult) return interaction.reply({ content: `Card \`${addCode}\` not found.`, flags: 64 });

      const addXp = addResult.card.xp ?? 0;
      let xpCost = addXp;

      let deck = JSON.parse(player.deck);

      if (removeCode) {
        const removeResult = findCardByCode(removeCode);
        const removeXp = removeResult?.card.xp ?? 0;
        xpCost = Math.max(0, addXp - removeXp);
        const idx = deck.indexOf(removeCode);
        if (idx === -1) return interaction.reply({ content: `Card \`${removeCode}\` not in your deck.`, flags: 64 });
        deck.splice(idx, 1);
      }

      const availableXp = player.xp_total - player.xp_spent;
      if (xpCost > availableXp) {
        return interaction.reply({ content: `Not enough XP. Need ${xpCost}, have ${availableXp}.`, flags: 64 });
      }

      deck.push(addCode);
      updatePlayer(player.id, { deck: JSON.stringify(deck), xp_spent: player.xp_spent + xpCost });

      db.prepare(`
        INSERT INTO deck_upgrades (campaign_id, player_id, scenario_index, card_added, card_removed, xp_spent)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(campaign.id, player.id, campaign.scenario_index, addCode, removeCode || null, xpCost);

      const addName = addResult.card.name;
      const removeName = removeCode ? (findCardByCode(removeCode)?.card.name || removeCode) : null;
      const msg = removeName
        ? `✅ Replaced **${removeName}** with **${addName}** (XP cost: ${xpCost}). Remaining XP: ${availableXp - xpCost}`
        : `✅ Added **${addName}** (XP cost: ${xpCost}). Remaining XP: ${availableXp - xpCost}`;

      await interaction.reply({ content: msg, flags: 64 });
    }

    else if (sub === 'remove') {
      const code = interaction.options.getString('code');
      let deck = JSON.parse(player.deck);
      const idx = deck.indexOf(code);
      if (idx === -1) return interaction.reply({ content: `Card \`${code}\` not in your deck.`, flags: 64 });
      deck.splice(idx, 1);
      updatePlayer(player.id, { deck: JSON.stringify(deck) });
      const name = findCardByCode(code)?.card.name || code;
      await interaction.reply({ content: `✅ Removed **${name}** from deck.`, flags: 64 });
    }

    else if (sub === 'done') {
      await interaction.reply({ content: '✅ Deck upgrades locked in. Ready for the next scenario.', flags: 64 });
    }
  },
};
