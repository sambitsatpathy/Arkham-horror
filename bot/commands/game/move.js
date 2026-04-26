const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requirePlayer, getSession, getCampaign, getPlayers, getLocation, updatePlayer } = require('../../engine/gameState');
const { revealLocation, updateLocationStatus } = require('../../engine/locationManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move to a location.')
    .addStringOption(opt =>
      opt.setName('location')
        .setDescription('Location name or code')
        .setRequired(true)),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const query = interaction.options.getString('location').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const campaign = getCampaign();
    const players = getPlayers(campaign.id);

    const { getLocations } = require('../../engine/gameState');
    const locations = getLocations(session.id);

    // Fuzzy match location
    let loc = locations.find(l => l.code === query);
    if (!loc) loc = locations.find(l => l.name.toLowerCase().includes(interaction.options.getString('location').toLowerCase()));
    if (!loc) {
      const names = locations.map(l => `\`${l.name}\``).join(', ');
      return interaction.reply({ content: `Location not found. Available: ${names}`, flags: 64 });
    }

    const wasHidden = loc.status === 'hidden';

    // Update player position
    const oldLoc = player.location_code;
    updatePlayer(player.id, { location_code: loc.code });

    if (wasHidden) {
      await revealLocation(interaction.guild, session, loc, players);
      const channel = interaction.guild.channels.cache.get(loc.channel_id);
      if (channel) await channel.send(`🚶 **${player.investigator_name}** enters **${loc.name}** for the first time.`);
      await interaction.reply(`✅ Moved to **${loc.name}** — location revealed!`);
    } else {
      // Update status pin on old location
      if (oldLoc && oldLoc !== loc.code) {
        const { getLocation } = require('../../engine/gameState');
        const prevLoc = getLocation(session.id, oldLoc);
        if (prevLoc) await updateLocationStatus(interaction.guild, session, prevLoc);
      }
      // Update status pin on new location
      const refreshed = getLocation(session.id, loc.code);
      await updateLocationStatus(interaction.guild, session, refreshed);

      const channel = interaction.guild.channels.cache.get(loc.channel_id);
      if (channel) await channel.send(`🚶 **${player.investigator_name}** enters **${loc.name}**.`);
      await interaction.reply(`✅ Moved to **${loc.name}**.`);
    }
  },
};
