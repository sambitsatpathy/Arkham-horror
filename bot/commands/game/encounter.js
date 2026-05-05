const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getSession } = require('../../engine/gameState');
const { drawEncounterCard, postEncounterCard, applyRevelationIfWeakness } = require('../../engine/encounterEngine');
const { findCardByCode } = require('../../engine/cardLookup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('encounter')
    .setDescription('Draw a single encounter card (mid-game effects).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('draw')
        .setDescription('Draw the top card of the encounter deck and post it.')),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const sub = interaction.options.getSubcommand();
    if (sub === 'draw') {
      await interaction.deferReply({ flags: 64 });
      const fresh = getSession();
      const code = drawEncounterCard(fresh);
      if (!code) return interaction.editReply('📜 Encounter deck is empty.');

      const ch = interaction.guild.channels.cache.get(fresh.encounter_channel_id);
      if (!ch) return interaction.editReply(`📜 Drew \`${code}\` but encounter channel not found.`);

      await postEncounterCard(ch, code);

      const result = findCardByCode(code);
      if (result?.card && applyRevelationIfWeakness) {
        try { await applyRevelationIfWeakness(result.card, player, ch); } catch (_) {}
      }

      const name = result?.card?.name || code;
      return interaction.editReply(`📜 Drew **${name}** — posted in encounter channel.`);
    }
  },
};
