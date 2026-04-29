const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requireHost, getSession, getCampaign, getPlayers } = require('../../engine/gameState');
const { activateEnemies } = require('../../engine/enemyEngine');
const { updateDoomTrack } = require('../../engine/doomTrack');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('enemyphase')
    .setDescription('Trigger enemy activation. Hunter enemies move and attack. Host only.'),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const host = requireHost(interaction);
    if (!host) return;

    await interaction.deferReply();

    const campaign = getCampaign();
    const players = getPlayers(campaign.id);
    const doomCh = interaction.guild.channels.cache.get(session.doom_channel_id);

    const results = await activateEnemies(interaction.guild, session, players);

    if (results.length === 0) {
      if (doomCh) await doomCh.send(`## 👹 Enemy Phase — Round ${session.round}\n\nNo enemies activated.`);
      return interaction.editReply('✅ Enemy phase complete — no enemies activated.');
    }

    const summary = [
      `## 👹 Enemy Phase — Round ${session.round}`,
      '',
      ...results,
      '',
      'Enemy activation complete. Use `/nextphase` to continue to upkeep.',
    ].join('\n');

    if (doomCh) await doomCh.send(summary);

    const freshSession = getSession();
    const freshPlayers = getPlayers(campaign.id).filter(p => !p.is_eliminated);
    await updateDoomTrack(doomCh, freshSession.doom, freshSession.doom_threshold, freshSession.round, 'Enemy', freshPlayers);

    return interaction.editReply(`✅ Enemy phase complete. ${results.length} enem${results.length !== 1 ? 'ies' : 'y'} activated. Check #doom-track for summary.`);
  },
};
