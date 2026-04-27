const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requirePlayer, getLocation, getLocations, updateLocation } = require('../../engine/gameState');
const { updateLocationStatus } = require('../../engine/locationManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clue')
    .setDescription('Add or remove clues on a location.')
    .addStringOption(opt =>
      opt.setName('action')
        .setDescription('add or remove')
        .setRequired(true)
        .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }))
    .addStringOption(opt =>
      opt.setName('location')
        .setDescription('Location name or code')
        .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('count')
        .setDescription('Number of clues')
        .setMinValue(1)
        .setRequired(true)),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const action = interaction.options.getString('action');
    const query = interaction.options.getString('location').toLowerCase();
    const count = interaction.options.getInteger('count');

    const locations = getLocations(session.id);
    let loc = locations.find(l => l.code.includes(query) || l.name.toLowerCase().includes(query));
    if (!loc) return interaction.reply({ content: `Location "${query}" not found.`, flags: 64 });

    const delta = action === 'add' ? count : -count;
    const newClues = Math.max(0, loc.clues + delta);
    updateLocation(loc.id, { clues: newClues });

    const refreshed = getLocation(session.id, loc.code);
    await updateLocationStatus(interaction.guild, session, refreshed);

    await interaction.reply(`✅ ${loc.name}: clues ${action === 'add' ? '+' : '-'}${count} → **${newClues}** 🔎`);
  },
};
