const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { requireSession, requireHost, getSession, getPlayer, getPlayerById, getCampaign, getPlayers, updateSession, updatePlayer } = require('../../engine/gameState');
const { drawCards } = require('../../engine/deck');
const { runMythosEncounters } = require('../../engine/encounterEngine');
const { findCardByCode } = require('../../engine/cardLookup');
const { updateDoomTrack } = require('../../engine/doomTrack');
const { handChannelName } = require('../../config');
const { refreshHandDisplay } = require('../../engine/handDisplay');
const { advanceAgenda } = require('../../engine/advanceEngine');
const { loadScenario } = require('../../engine/scenarioLoader');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nextphase')
    .setDescription('Advance to the next phase of the round. Host only.'),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const host = requireHost(interaction);
    if (!host) return;

    await interaction.deferReply();

    const campaign = getCampaign();
    const players = getPlayers(campaign.id).filter(p => !p.is_eliminated);
    const doomCh = interaction.guild.channels.cache.get(session.doom_channel_id);
    const encounterCh = interaction.guild.channels.cache.get(session.encounter_channel_id);

    const current = session.phase;

    // ── INVESTIGATION → ENEMY ────────────────────────────────────────────
    if (current === 'investigation') {
      updateSession(session.id, { phase: 'enemy' });
      const msg = [
        `## 👹 Enemy Phase — Round ${session.round}`,
        '',
        '**Steps:**',
        '1. Run `/enemyphase` to activate enemies (hunters move, engaged enemies attack).',
        '2. Resolve manual effects: **Retaliate**, **Aloof** (use `/engage`), etc.',
        '3. Use `/nextphase` to continue to Upkeep when done.',
      ].join('\n');
      if (doomCh) await doomCh.send(msg);
      await updateDoomTrack(doomCh, session.doom, session.doom_threshold, session.round, 'Enemy', players);
      return interaction.editReply('✅ **Enemy Phase** has begun. Resolve enemy attacks and movement, then use `/nextphase` when ready.');
    }

    // ── ENEMY → UPKEEP ───────────────────────────────────────────────────
    if (current === 'enemy') {
      updateSession(session.id, { phase: 'upkeep' });
      const summaryLines = [`## ☀️ Upkeep Phase — Round ${session.round}`, ''];

      for (const player of players) {
        const steps = [];

        // 1. Ready exhausted assets — fetch fresh, write assets, then re-fetch for next step
        const p1 = getPlayerById(player.id);
        const assets = JSON.parse(p1.assets || '[]');
        if (assets.some(a => a.exhausted)) {
          assets.forEach(a => { a.exhausted = false; });
          updatePlayer(p1.id, { assets: JSON.stringify(assets) });
          steps.push('♻️ readied exhausted cards');
        }

        // 2. Gain 1 resource — fetch fresh after asset write
        const p2 = getPlayerById(player.id);
        updatePlayer(p2.id, { resources: p2.resources + 1 });
        steps.push(`💰 gained 1 resource (now ${p2.resources + 1})`);

        // 3. Draw 1 card — fetch fresh after resource write
        const p3 = getPlayerById(player.id);
        const drawn = drawCards(p3, 1);
        if (drawn.length > 0) {
          await refreshHandDisplay(interaction.guild, p3);
          steps.push('🃏 drew 1 card');
        } else {
          steps.push('🃏 no cards to draw');
        }

        // 4. Hand size check
        const p4 = getPlayerById(player.id);
        const currentHand = JSON.parse(p4.hand || '[]');
        if (currentHand.length > 8) {
          const handCh = interaction.guild.channels.cache.find(c =>
            c.name === handChannelName(p4.investigator_name)
          );
          if (handCh) {
            await handCh.send(`⚠️ **${p4.investigator_name}** has **${currentHand.length}** cards in hand (limit 8). Use \`/discard\` to reduce to 8.`);
          }
          steps.push(`⚠️ hand has ${currentHand.length} cards — discard to 8`);
        }

        summaryLines.push(`**${player.investigator_name}**: ${steps.join(', ')}`);
      }

      summaryLines.push('', '**Hand size warnings** (if any) sent to hand channels.', '', 'Host: use `/nextphase` to begin the Mythos phase.');
      if (doomCh) await doomCh.send(summaryLines.join('\n'));
      await updateDoomTrack(doomCh, session.doom, session.doom_threshold, session.round, 'Upkeep', players);
      return interaction.editReply('✅ **Upkeep Phase** complete. All players readied, drew 1 card, gained 1 resource.');
    }

    // ── UPKEEP → MYTHOS (new round) ───────────────────────────────────────
    if (current === 'upkeep') {
      const newRound = session.round + 1;
      const newDoom = session.doom + 1;
      updateSession(session.id, { phase: 'mythos', round: newRound, doom: newDoom });

      if (doomCh) await doomCh.send(`--- **Mythos Phase — Round ${newRound}** ---`);
      if (encounterCh) await encounterCh.send(`--- **Mythos Phase — Round ${newRound}** ---`);

      await runMythosEncounters(encounterCh, session.id, players);

      const afterSession = getSession();
      if (afterSession.doom >= afterSession.doom_threshold) {
        const scenario = loadScenario(afterSession);
        if (scenario) {
          if (doomCh) await doomCh.send('☠️ **Doom threshold reached — agenda advancing automatically...**');
          await advanceAgenda(interaction.guild, afterSession, scenario);
        } else {
          if (doomCh) await doomCh.send('⚠️ **Doom threshold reached! Use `/advance agenda`.**');
        }
      }

      updateSession(session.id, { phase: 'investigation' });
      if (doomCh) await doomCh.send([
        `## 🔍 Investigation Phase — Round ${newRound}`,
        '',
        'Each investigator gets **3 actions**. Use `/action` to take them.',
        'Host: `/nextphase` when all investigators are done.',
      ].join('\n'));
      const finalSession = getSession();
      await updateDoomTrack(doomCh, finalSession.doom, finalSession.doom_threshold, newRound, 'Investigation', players);

      return interaction.editReply(
        `✅ **Round ${newRound}** begins. Doom is now ${finalSession.doom}/${finalSession.doom_threshold}. Check ${encounterCh || '#encounter-deck'} to resolve encounter cards.`
      );
    }

    // ── MYTHOS → INVESTIGATION (manual fallback) ─────────────────────────
    if (current === 'mythos') {
      updateSession(session.id, { phase: 'investigation' });
      if (doomCh) await doomCh.send([
        `## 🔍 Investigation Phase — Round ${session.round}`,
        '',
        'Each investigator gets **3 actions**. Use `/action` to take them.',
        'Host: `/nextphase` when all investigators are done.',
      ].join('\n'));
      await updateDoomTrack(doomCh, session.doom, session.doom_threshold, session.round, 'Investigation', players);
      return interaction.editReply('✅ **Investigation Phase** has begun. Each investigator takes up to 3 actions.');
    }

    await interaction.editReply(`❌ Unknown phase: \`${current}\`. Check the session state.`);
  },
};
