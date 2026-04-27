const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requireHost, getCampaign, getPlayers, getLocations } = require('../../engine/gameState');
const { revealLocation } = require('../../engine/locationManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reveal')
    .setDescription('Force-reveal a location. Host only.')
    .addStringOption(opt =>
      opt.setName('location')
        .setDescription('Location name or code')
        .setRequired(true)),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const host = requireHost(interaction);
    if (!host) return;

    const query = interaction.options.getString('location').toLowerCase();
    const locations = getLocations(session.id);
    const loc = locations.find(l => l.code.includes(query) || l.name.toLowerCase().includes(query));
    if (!loc) return interaction.reply({ content: `Location "${query}" not found.`, flags: 64 });

    if (loc.status !== 'hidden') {
      return interaction.reply({ content: `**${loc.name}** is already revealed.`, flags: 64 });
    }

    const campaign = getCampaign();
    const players = getPlayers(campaign.id);
    await revealLocation(interaction.guild, session, loc, players);

    await interaction.reply(`✅ **${loc.name}** has been revealed.`);
  },
};
