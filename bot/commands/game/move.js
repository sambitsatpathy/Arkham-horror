const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requirePlayer, getSession, getPlayer, getCampaign, getPlayers, getLocation, getLocations, updatePlayer } = require('../../engine/gameState');
const { revealLocation, updateLocationStatus } = require('../../engine/locationManager');

const STATUS_ICON = {
  hidden:   '🌑',
  revealed: '🔍',
  cleared:  '✅',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move to a location.')
    .addStringOption(opt =>
      opt.setName('location')
        .setDescription('Location to move to')
        .setRequired(true)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const session = getSession();
    if (!session) return interaction.respond([]);

    const player = getPlayer(interaction.user.id);
    const query = interaction.options.getFocused().toLowerCase();
    const locations = getLocations(session.id);

    return interaction.respond(
      locations
        .filter(l => l.act_index <= session.act_index)
        .filter(l => !query || l.name.toLowerCase().includes(query) || l.code.includes(query))
        .map(l => {
          const icon = STATUS_ICON[l.status] ?? '❓';
          const current = player && l.code === player.location_code ? ' ◀ here' : '';
          const clues = l.clues > 0 ? ` (${l.clues} clue${l.clues !== 1 ? 's' : ''})` : '';
          return { name: `${icon} ${l.name}${clues}${current}`, value: l.code };
        })
        .slice(0, 25)
    );
  },

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const query = interaction.options.getString('location');
    const locations = getLocations(session.id);

    // Accept code (from autocomplete) or partial name match
    let loc = locations.find(l => l.code === query);
    if (!loc) loc = locations.find(l => l.name.toLowerCase().includes(query.toLowerCase()));
    if (!loc) {
      const available = locations
        .filter(l => l.act_index <= session.act_index)
        .map(l => `\`${l.name}\``)
        .join(', ');
      return interaction.reply({ content: `❌ Location not found. Available: ${available}`, flags: 64 });
    }

    if (loc.act_index > session.act_index) {
      return interaction.reply({ content: `❌ **${loc.name}** is not accessible yet (unlocks at Act ${loc.act_index + 1}).`, flags: 64 });
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
