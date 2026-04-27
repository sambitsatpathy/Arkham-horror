const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requirePlayer, getCampaign, getPlayers, getLocation, getLocations, updatePlayer } = require('../../engine/gameState');
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
    const locations = getLocations(session.id);

    let loc = locations.find(l => l.code === query);
    if (!loc) loc = locations.find(l => l.name.toLowerCase().includes(interaction.options.getString('location').toLowerCase()));
    if (!loc) {
      const names = locations.map(l => `\`${l.name}\``).join(', ');
      return interaction.reply({ content: `Location not found. Available: ${names}`, flags: 64 });
    }

    const wasHidden = loc.status === 'hidden';
    const oldLoc = player.location_code;
    updatePlayer(player.id, { location_code: loc.code });

    if (wasHidden) {
      const campaign = getCampaign();
      const players = getPlayers(campaign.id);
      await revealLocation(interaction.guild, session, loc, players);
      const channel = interaction.guild.channels.cache.get(loc.channel_id);
      if (channel) await channel.send(`🚶 **${player.investigator_name}** enters **${loc.name}** for the first time.`);
      await interaction.reply(`✅ Moved to **${loc.name}** — location revealed!`);
    } else {
      if (oldLoc && oldLoc !== loc.code) {
        const prevLoc = getLocation(session.id, oldLoc);
        if (prevLoc) await updateLocationStatus(interaction.guild, session, prevLoc);
      }
      const refreshed = getLocation(session.id, loc.code);
      await updateLocationStatus(interaction.guild, session, refreshed);

      const channel = interaction.guild.channels.cache.get(loc.channel_id);
      if (channel) await channel.send(`🚶 **${player.investigator_name}** enters **${loc.name}**.`);
      await interaction.reply(`✅ Moved to **${loc.name}**.`);
    }
  },
};
