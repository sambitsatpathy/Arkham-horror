const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requireHost, getSession, updateSession, getCampaign, getPlayers } = require('../../engine/gameState');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('doom')
    .setDescription('Add or remove doom tokens. Host only.')
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
    requireHost(interaction);

    const action = interaction.options.getString('action');
    const count = interaction.options.getInteger('count');
    const delta = action === 'add' ? count : -count;
    const newDoom = Math.max(0, session.doom + delta);

    updateSession(session.id, { doom: newDoom });

    const doomCh = interaction.guild.channels.cache.get(session.doom_channel_id);
    if (doomCh) {
      const campaign = getCampaign();
      const players = getPlayers(campaign.id);
      await updateDoomPin(doomCh, session, newDoom, players);
    }

    const atThreshold = newDoom >= session.doom_threshold;
    const warn = atThreshold ? '\n⚠️ **Doom threshold reached! Use `/advance agenda`.**' : '';
    await interaction.reply(`💀 Doom ${action === 'add' ? '+' : '-'}${count} → **${newDoom}/${session.doom_threshold}**${warn}`);
  },
};

async function updateDoomPin(channel, session, doom, players) {
  const filled = session.doom_threshold > 0 ? Math.min(10, Math.round((doom / session.doom_threshold) * 10)) : 0;
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const text = [
    '☠️  **DOOM TRACK**',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `Doom:    ${doom} / ${session.doom_threshold}  [${bar}]`,
    `Round:   ${session.round}`,
    `Phase:   ${session.phase}`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    'Investigators:',
    ...players.map(p => `  🔍 ${(p.investigator_name || p.discord_name).padEnd(20)} HP: ${p.hp}/${p.max_hp}  SAN: ${p.sanity}/${p.max_sanity}`),
    '━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');

  // Edit the pinned message if it exists, otherwise post new
  try {
    const pins = await channel.messages.fetchPinned();
    const existing = pins.find(m => m.author.bot && m.content.includes('DOOM TRACK'));
    if (existing) {
      await existing.edit(text);
      return;
    }
  } catch (_) {}

  const msg = await channel.send(text);
  await msg.pin();
}
