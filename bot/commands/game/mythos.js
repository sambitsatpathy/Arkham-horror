const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requireHost, getSession, updateSession, getCampaign, getPlayers } = require('../../engine/gameState');
const { drawEncounterCard, postEncounterCard } = require('../../engine/encounterEngine');
const { findCardByCode } = require('../../engine/cardLookup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mythos')
    .setDescription('Trigger the Mythos phase. Host only.'),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    requireHost(interaction);

    await interaction.deferReply();

    const campaign = getCampaign();
    const players = getPlayers(campaign.id).filter(p => !p.is_eliminated);

    // 1. Add 1 doom
    const newDoom = session.doom + 1;
    updateSession(session.id, { doom: newDoom, phase: 'mythos' });

    const doomCh = interaction.guild.channels.cache.get(session.doom_channel_id);
    if (doomCh) await doomCh.send(`☠️ Mythos phase — doom +1 → **${newDoom}/${session.doom_threshold}**`);

    const encounterCh = interaction.guild.channels.cache.get(session.encounter_channel_id);
    if (encounterCh) {
      await encounterCh.send(`--- **Mythos Phase — Round ${session.round}** ---`);
    }

    // 2. Draw encounter card per investigator
    const drawnCards = [];
    for (const player of players) {
      const refreshedSession = require('../../engine/gameState').getSession();
      const code = drawEncounterCard(refreshedSession);
      if (!code) {
        if (encounterCh) await encounterCh.send(`⚠️ Encounter deck is empty — no card for **${player.investigator_name}**.`);
        continue;
      }
      const card = await postEncounterCard(encounterCh, code);
      if (encounterCh) {
        if (card) {
          if (card.type_code === 'treachery') {
            await encounterCh.send(`☠️ **${player.investigator_name}** draws a treachery. Resolve it, then use \`/resolved\`.`);
          } else if (card.type_code === 'enemy') {
            await encounterCh.send(`👹 **${player.investigator_name}** draws an enemy. Use \`/enemy spawn <name> <location>\` to place it.`);
          } else {
            await encounterCh.send(`📄 **${player.investigator_name}** draws a card. Resolve per card text.`);
          }
        }
      }
      drawnCards.push({ player: player.investigator_name, code });
    }

    // 3. Check doom threshold
    const currentSession = require('../../engine/gameState').getSession();
    if (currentSession.doom >= currentSession.doom_threshold) {
      if (doomCh) await doomCh.send(`⚠️ **Doom threshold reached! Use \`/advance agenda\`.**`);
    }

    updateSession(session.id, { phase: 'investigation' });

    await interaction.editReply(
      `✅ Mythos phase complete. Doom: ${newDoom}/${session.doom_threshold}. ${drawnCards.length} encounter card(s) drawn.\nCheck ${encounterCh || '#encounter-deck'} to resolve.`
    );
  },
};
