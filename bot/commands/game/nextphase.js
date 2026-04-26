const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const {
  requireSession, requireHost, getSession,
  getCampaign, getPlayers, updateSession, updatePlayer,
} = require('../../engine/gameState');
const { drawCards } = require('../../engine/deck');
const { drawEncounterCard, postEncounterCard } = require('../../engine/encounterEngine');
const { findCardByCode } = require('../../engine/cardLookup');

const PHASE_ORDER = ['investigation', 'enemy', 'upkeep', 'mythos'];

const PHASE_LABEL = {
  investigation: '🔍 Investigation',
  enemy: '👹 Enemy',
  upkeep: '☀️ Upkeep',
  mythos: '☠️ Mythos',
};

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
    const idx = PHASE_ORDER.indexOf(current);
    const next = PHASE_ORDER[(idx + 1) % PHASE_ORDER.length];

    // ── INVESTIGATION → ENEMY ─────────────────────────────────────────────
    if (current === 'investigation') {
      updateSession(session.id, { phase: 'enemy' });
      const msg = [
        `## 👹 Enemy Phase — Round ${session.round}`,
        '',
        '**Steps:**',
        '1. Each **ready, unengaged Hunter enemy** moves toward the nearest investigator.',
        '2. Each **enemy engaged with an investigator** attacks them.',
        '3. Use `/enemy` to track enemy state. When done, use `/nextphase` to continue.',
      ].join('\n');
      if (doomCh) await doomCh.send(msg);
      await updateDoomTrack(doomCh, session, session.doom, players, session.round, 'Enemy');
      return interaction.editReply(`✅ **Enemy Phase** has begun. Resolve enemy attacks and movement, then use \`/nextphase\` when ready.`);
    }

    // ── ENEMY → UPKEEP ───────────────────────────────────────────────────
    if (current === 'enemy') {
      updateSession(session.id, { phase: 'upkeep' });

      const summaryLines = [`## ☀️ Upkeep Phase — Round ${session.round}`, ''];

      for (const player of players) {
        const steps = [];

        // 1. Ready all exhausted assets
        const assets = JSON.parse(player.assets || '[]');
        const hadExhausted = assets.some(a => a.exhausted);
        if (hadExhausted) {
          assets.forEach(a => { a.exhausted = false; });
          updatePlayer(player.id, { assets: JSON.stringify(assets) });
          steps.push('♻️ readied exhausted cards');
        }

        // 2. Gain 1 resource
        updatePlayer(player.id, { resources: player.resources + 1 });
        steps.push(`💰 gained 1 resource (now ${player.resources + 1})`);

        // 3. Draw 1 card and post to hand channel
        const freshPlayer = { ...player, resources: player.resources + 1, assets: JSON.stringify(assets) };
        const drawn = drawCards(freshPlayer, 1);
        if (drawn.length > 0) {
          const safeName = player.investigator_name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-hand';
          const handCh = interaction.guild.channels.cache.find(c => c.name === safeName);
          if (handCh) {
            for (const code of drawn) {
              const result = findCardByCode(code);
              if (result?.imagePath) {
                await handCh.send({ content: `🃏 Upkeep draw: **${result.card.name}**`, files: [new AttachmentBuilder(result.imagePath, { name: 'card.png' })] });
              } else {
                await handCh.send(`🃏 Upkeep draw: \`${code}\``);
              }
            }
          }
          steps.push(`🃏 drew 1 card`);
        } else {
          steps.push('🃏 no cards to draw');
        }

        summaryLines.push(`**${player.investigator_name}**: ${steps.join(', ')}`);
      }

      summaryLines.push('', 'Use `/nextphase` to begin the Mythos phase.');
      if (doomCh) await doomCh.send(summaryLines.join('\n'));
      await updateDoomTrack(doomCh, session, session.doom, players, session.round, 'Upkeep');
      return interaction.editReply(`✅ **Upkeep Phase** complete. All players readied, drew 1 card, gained 1 resource.`);
    }

    // ── UPKEEP → MYTHOS (new round) ───────────────────────────────────────
    if (current === 'upkeep') {
      const newRound = session.round + 1;
      const newDoom = session.doom + 1;
      updateSession(session.id, { phase: 'mythos', round: newRound, doom: newDoom });

      if (doomCh) await doomCh.send(`--- **Mythos Phase — Round ${newRound}** ---`);

      // Draw encounter card per investigator
      if (encounterCh) {
        await encounterCh.send(`--- **Mythos Phase — Round ${newRound}** ---`);
      }

      for (const player of players) {
        const refreshed = getSession();
        const code = drawEncounterCard(refreshed);
        if (!code) {
          if (encounterCh) await encounterCh.send(`⚠️ Encounter deck empty — no card for **${player.investigator_name}**.`);
          continue;
        }
        const card = await postEncounterCard(encounterCh, code);
        if (encounterCh && card) {
          if (card.type_code === 'treachery') {
            await encounterCh.send(`☠️ **${player.investigator_name}** draws a treachery. Resolve it, then use \`/resolved\`.`);
          } else if (card.type_code === 'enemy') {
            await encounterCh.send(`👹 **${player.investigator_name}** draws an enemy. Use \`/enemy spawn\` to place it.`);
          } else {
            await encounterCh.send(`📄 **${player.investigator_name}** draws a card. Resolve per card text.`);
          }
        }
      }

      const currentSession = getSession();
      if (currentSession.doom >= currentSession.doom_threshold) {
        if (doomCh) await doomCh.send(`⚠️ **Doom threshold reached! Use \`/advance agenda\`.**`);
      }

      // Reset to investigation for this round
      updateSession(session.id, { phase: 'investigation' });
      await updateDoomTrack(doomCh, currentSession, newDoom, players, newRound, 'Investigation');

      return interaction.editReply(
        `✅ **Round ${newRound}** begins. Mythos phase complete — doom is now ${newDoom}/${session.doom_threshold}. Check ${encounterCh || '#encounter-deck'} to resolve encounter cards.`
      );
    }

    // ── MYTHOS → INVESTIGATION (manual fallback) ──────────────────────────
    if (current === 'mythos') {
      updateSession(session.id, { phase: 'investigation' });
      if (doomCh) await doomCh.send(`## 🔍 Investigation Phase — Round ${session.round}`);
      await updateDoomTrack(doomCh, session, session.doom, players, session.round, 'Investigation');
      return interaction.editReply(`✅ **Investigation Phase** has begun. Each investigator takes up to 3 actions.`);
    }

    await interaction.editReply(`❌ Unknown phase: \`${current}\`. Check the session state.`);
  },
};

async function updateDoomTrack(channel, session, doom, players, round, phase) {
  if (!channel) return;
  const threshold = session.doom_threshold;
  const filled = threshold > 0 ? Math.min(10, Math.round((doom / threshold) * 10)) : 0;
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const text = [
    '☠️  **DOOM TRACK**',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `Doom:    ${doom} / ${threshold}  [${bar}]`,
    `Round:   ${round}`,
    `Phase:   ${phase}`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    'Investigators:',
    ...players.map(p => `  🔍 ${(p.investigator_name || p.discord_name).padEnd(20)} HP: ${p.hp}/${p.max_hp}  SAN: ${p.sanity}/${p.max_sanity}`),
    '━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');

  try {
    const pins = await channel.messages.fetchPinned();
    const existing = pins.find(m => m.author.bot && m.content.includes('DOOM TRACK'));
    if (existing) { await existing.edit(text); return; }
  } catch (_) {}

  const msg = await channel.send(text);
  try { await msg.pin(); } catch (_) {}
}
