const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requireHost, getSession, updateSession, getCampaign, getPlayers } = require('../../engine/gameState');
const { runMythosEncounters } = require('../../engine/encounterEngine');
const { advanceAgenda } = require('../../engine/advanceEngine');
const { loadScenario } = require('../../engine/scenarioLoader');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mythos')
    .setDescription('Trigger the Mythos phase. Host only.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const host = requireHost(interaction);
    if (!host) return;

    await interaction.deferReply();

    const campaign = getCampaign();
    const players = getPlayers(campaign.id).filter(p => !p.is_eliminated);

    const newDoom = session.doom + 1;
    updateSession(session.id, { doom: newDoom, phase: 'mythos' });

    const doomCh = interaction.guild.channels.cache.get(session.doom_channel_id);
    if (doomCh) await doomCh.send(`☠️ Mythos phase — doom +1 → **${newDoom}/${session.doom_threshold}**`);

    const encounterCh = interaction.guild.channels.cache.get(session.encounter_channel_id);
    if (encounterCh) await encounterCh.send(`--- **Mythos Phase — Round ${session.round}** ---`);

    await runMythosEncounters(encounterCh, session.id, players);

    const currentSession = getSession();
    if (currentSession.doom >= currentSession.doom_threshold) {
      const scenario = loadScenario(currentSession);
      if (scenario) {
        if (doomCh) await doomCh.send('☠️ **Doom threshold reached — agenda advancing automatically...**');
        await advanceAgenda(interaction.guild, currentSession, scenario);
      } else {
        if (doomCh) await doomCh.send('⚠️ **Doom threshold reached! Use `/advance agenda`.**');
      }
    }

    updateSession(session.id, { phase: 'investigation' });

    await interaction.editReply(
      `✅ Mythos phase complete. Doom: ${newDoom}/${session.doom_threshold}. ${players.length} encounter card(s) drawn.\nCheck ${encounterCh || '#encounter-deck'} to resolve.`
    );
  },
};
