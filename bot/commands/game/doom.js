const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requireHost, getSession, updateSession, getCampaign, getPlayers } = require('../../engine/gameState');
const { updateDoomTrack } = require('../../engine/doomTrack');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('doom')
    .setDescription('Add or remove doom tokens. Host only.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('action')
        .setDescription('add or remove')
        .setRequired(true)
        .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }))
    .addIntegerOption(opt =>
      opt.setName('count')
        .setDescription('Number of doom tokens')
        .setMinValue(1)
        .setRequired(true)),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const host = requireHost(interaction);
    if (!host) return;

    const action = interaction.options.getString('action');
    const count = interaction.options.getInteger('count');
    const delta = action === 'add' ? count : -count;
    const newDoom = Math.max(0, session.doom + delta);

    updateSession(session.id, { doom: newDoom });

    const doomCh = interaction.guild.channels.cache.get(session.doom_channel_id);
    if (doomCh) {
      const campaign = getCampaign();
      const players = getPlayers(campaign.id);
      await updateDoomTrack(doomCh, newDoom, session.doom_threshold, session.round, session.phase, players);
    }

    const atThreshold = newDoom >= session.doom_threshold;
    const warn = atThreshold ? '\n⚠️ **Doom threshold reached! Use `/advance agenda`.**' : '';
    await interaction.reply(`💀 Doom ${action === 'add' ? '+' : '-'}${count} → **${newDoom}/${session.doom_threshold}**${warn}`);
  },
};
