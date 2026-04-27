const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requirePlayer } = require('../../engine/gameState');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resolved')
    .setDescription('Confirm that your encounter card has been resolved.'),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const encounterCh = interaction.guild.channels.cache.get(session.encounter_channel_id);
    if (encounterCh) {
      await encounterCh.send(`✅ **${player.investigator_name}** resolved their encounter card.`);
    }

    await interaction.reply({ content: '✅ Encounter card resolved.', flags: 64 });
  },
};
