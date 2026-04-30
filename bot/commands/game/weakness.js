const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getPlayer, getPlayerById, removeFromThreatArea, decrementActions, getThreatArea } = require('../../engine/gameState');
const { getEntry } = require('../../engine/cardEffectResolver');
const { findCardByCode } = require('../../engine/cardLookup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weakness')
    .setDescription('Manage weaknesses in your threat area.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName('discard')
      .setDescription('Discard a weakness (costs actions per card text).')
      .addStringOption(o =>
        o.setName('code').setDescription('Card code in your threat area').setRequired(true).setAutocomplete(true))),

  async autocomplete(interaction) {
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.respond([]);
    const codes = getThreatArea(player.id);
    const choices = codes.map(c => {
      const r = findCardByCode(c);
      return { name: r ? `${r.card.name} (${c})` : c, value: c };
    }).slice(0, 25);
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;
    const code = interaction.options.getString('code');
    const entry = getEntry(code);
    if (!entry) {
      return interaction.reply({ content: `❌ No card data for ${code}.`, flags: 64 });
    }
    if (entry.discard_cost == null) {
      return interaction.reply({ content: `❌ ${entry.name} has no discard cost — resolve manually.`, flags: 64 });
    }
    const fresh = getPlayerById(player.id);
    if ((fresh.action_count ?? 0) < entry.discard_cost) {
      return interaction.reply({ content: `❌ Need ${entry.discard_cost} actions, have ${fresh.action_count}.`, flags: 64 });
    }
    const remaining = decrementActions(player.id, entry.discard_cost);
    removeFromThreatArea(player.id, code);
    return interaction.reply(`✅ Discarded **${entry.name}** (cost ${entry.discard_cost} actions, ${remaining} left).`);
  },
};
