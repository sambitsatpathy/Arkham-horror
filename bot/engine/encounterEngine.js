const { updateSession, getSession } = require('./gameState');
const { findCardByCode } = require('./cardLookup');
const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function buildEncounterDeck(encounterSets, allCards) {
  const codes = [];
  for (const setCode of encounterSets) {
    const setCards = allCards.filter(c =>
      c.encounter_code === setCode &&
      !['scenario', 'act', 'agenda', 'location', 'investigator'].includes(c.type_code)
    );
    for (const card of setCards) {
      const qty = card.quantity || 1;
      for (let i = 0; i < qty; i++) codes.push(card.code);
    }
  }
  return codes;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawEncounterCard(session) {
  let deck = JSON.parse(session.encounter_deck);
  let discard = JSON.parse(session.encounter_discard);

  if (deck.length === 0) {
    if (discard.length === 0) return null;
    deck = shuffle(discard);
    discard = [];
  }

  const code = deck.shift();
  discard.push(code);

  updateSession(session.id, {
    encounter_deck: JSON.stringify(deck),
    encounter_discard: JSON.stringify(discard),
  });

  return code;
}

async function postEncounterCard(channel, cardCode) {
  const result = findCardByCode(cardCode);
  if (!result) {
    await channel.send(`⚠️ Encounter card \`${cardCode}\` — image not found.`);
    return null;
  }

  const { card, imagePath } = result;
  const typeLabel = card.type_code.charAt(0).toUpperCase() + card.type_code.slice(1);

  if (imagePath) {
    const attachment = new AttachmentBuilder(imagePath, { name: 'encounter.png' });
    await channel.send({ content: `🃏 **${card.name}** *(${typeLabel})*`, files: [attachment] });
  } else {
    await channel.send(`🃏 **${card.name}** *(${typeLabel})* — ⚠️ Image not found`);
  }

  return card;
}

// Draws one encounter card per investigator and posts to encounterCh.
// Re-fetches session before each draw so deck state stays consistent.
async function runMythosEncounters(encounterCh, sessionId, players) {
  for (const player of players) {
    const fresh = getSession();
    const code = drawEncounterCard(fresh);
    if (!code) {
      if (encounterCh) await encounterCh.send(`⚠️ Encounter deck empty — no card for **${player.investigator_name}**.`);
      continue;
    }
    const card = await postEncounterCard(encounterCh, code);
    if (!card) continue;

    if (card.type_code === 'enemy') {
      await autoSpawnDrawnEnemy(encounterCh, fresh, card, player);
    } else if (card.type_code === 'treachery') {
      const res = await applyRevelation(card, player, encounterCh, fresh);
      if (encounterCh && !res.handled) {
        await encounterCh.send(`☠️ **${player.investigator_name}** draws a treachery. Resolve it, then use \`/resolved\`.`);
      }
    } else {
      if (encounterCh) await encounterCh.send(`📄 **${player.investigator_name}** draws a card. Resolve per card text.`);
    }
  }
}

// Spawns a drawn enemy at the drawing player's location (engaged unless Aloof).
async function autoSpawnDrawnEnemy(channel, session, card, player) {
  const { spawnEnemy } = require('./enemyEngine');
  const { getEntry } = require('./cardEffectResolver');
  const { getLocation, getPlayerById } = require('./gameState');
  const { updateLocationStatus } = require('./locationManager');

  const fresh = getPlayerById(player.id);
  if (!fresh.location_code) {
    if (channel) await channel.send(`👹 **${player.investigator_name}** draws **${card.name}** — no location set, use \`/enemy spawn\` to place it.`);
    return null;
  }

  const enemyId = spawnEnemy(session.id, fresh.location_code, { code: card.code, name: card.name }, { engaged_player_id: fresh.id });
  const entry = getEntry(card.code);
  const loc = getLocation(session.id, fresh.location_code);
  if (loc && channel?.guild) {
    try { await updateLocationStatus(channel.guild, session, loc); } catch (_) {}
  }
  if (channel) {
    const notes = [];
    const kw = entry?.keywords || [];
    if (kw.length) notes.push(`Keywords: ${kw.join(', ')}`);
    if (/spawn/i.test(entry?.unparsed_text || '')) notes.push(`⚠️ Card has a spawn instruction — relocate manually if it says otherwise.`);
    await channel.send(
      `👹 **${player.investigator_name}** draws **${card.name}** — spawned at **${loc?.name || fresh.location_code}** (ID ${enemyId}).` +
      (notes.length ? `\n${notes.join('\n')}` : '')
    );
  }
  return enemyId;
}

// Auto-resolves a drawn treachery's Revelation: applies unconditional effects,
// posts a button for test-based revelations, and falls back to manual notes
// for anything the parser left unparsed. Returns { handled }.
async function applyRevelation(card, player, channel, session) {
  const { getEntry } = require('./cardEffectResolver');
  const entry = getEntry(card.code);
  if (!entry) return { handled: false };

  const sess = session || getSession();
  const lines = [];
  let components = [];
  const rev = entry.revelation;

  if (rev && (rev.effects.length || rev.test || rev.unparsed)) {
    const { execEffect } = require('./effectExecutors');
    const ctx = { player, session: sess, guild: channel?.guild, cardCode: card.code };
    for (const eff of rev.effects) {
      lines.push(await execEffect(eff, ctx));
    }
    if (rev.test) {
      const stats = [rev.test.stat, ...(rev.test.stat_alternatives || [])];
      const row = new ActionRowBuilder().addComponents(
        stats.slice(0, 5).map(s =>
          new ButtonBuilder()
            .setCustomId(`trev:${card.code}:${player.id}:${s}`)
            .setLabel(`Test ${s} (${rev.test.difficulty})`)
            .setStyle(ButtonStyle.Primary)
        )
      );
      components = [row];
      lines.push(`🎲 **Test required:** ${stats.join(' or ')} (${rev.test.difficulty}). Press the button to draw a token (or run \`/test\` with commits and resolve manually).`);
    }
    if (rev.unparsed) lines.push(`📖 **Manual:** ${rev.unparsed}`);
  } else if (entry.is_weakness && (entry.revelation_effects || []).length) {
    // Legacy data without the structured revelation field
    const { execEffect } = require('./effectExecutors');
    const ctx = { player, session: sess, guild: channel?.guild, cardCode: card.code };
    for (const eff of entry.revelation_effects) {
      lines.push(await execEffect(eff, ctx));
    }
  }

  if (!lines.length) return { handled: false };
  if (channel) {
    await channel.send({
      content: `**${player.investigator_name}** revelation: **${card.name}**\n` + lines.join('\n'),
      components,
    });
  }
  return { handled: true };
}

// Backwards-compatible alias for older callers.
async function applyRevelationIfWeakness(card, player, channel) {
  return applyRevelation(card, player, channel);
}

// Handles the `trev:<cardCode>:<playerId>:<stat>` button posted by
// applyRevelation: runs the revelation skill test for the drawing player and
// auto-applies the parsed on_fail / on_pass effects (scaling per-point-failed
// effects by the failure margin).
async function handleTreacheryTestButton(interaction) {
  const [, cardCode, playerIdStr, stat] = interaction.customId.split(':');
  const { getPlayerById, getSession: getSess } = require('./gameState');
  const player = getPlayerById(parseInt(playerIdStr, 10));
  const session = getSess();
  if (!player || !session) {
    return interaction.reply({ content: '❌ No active session or player for this test.', flags: 64 });
  }
  if (interaction.user.id !== player.discord_id) {
    return interaction.reply({ content: `❌ Only **${player.investigator_name}** can take this test.`, flags: 64 });
  }

  const { getEntry } = require('./cardEffectResolver');
  const entry = getEntry(cardCode);
  const test = entry?.revelation?.test;
  if (!test) {
    return interaction.reply({ content: '❌ No test data found for this card.', flags: 64 });
  }

  await interaction.deferReply();
  // One test per button — drop the buttons so it can't be re-rolled
  await interaction.message.edit({ components: [] }).catch(() => {});

  const { executeTestAction } = require('../commands/game/test');
  const result = await executeTestAction(interaction, player, session, stat || test.stat, test.difficulty, []);

  const effects = result.success ? test.on_pass : test.on_fail;
  const lines = [];
  const { execEffect } = require('./effectExecutors');
  for (const eff of effects) {
    const e = { ...eff };
    if (e.per_point_failed) {
      e.count = e.count * result.failedBy;
      if (e.count <= 0) {
        lines.push(`➖ Failed by 0 — no effect.`);
        continue;
      }
    }
    lines.push(await execEffect(e, { player, session, guild: interaction.guild, cardCode }));
  }
  if (lines.length) {
    await interaction.followUp({
      content: [`**${entry.name}** — ${result.success ? '✅ passed' : `❌ failed${result.failedBy ? ` by ${result.failedBy}` : ''}`}:`, ...lines].join('\n'),
    });
  } else if (!result.success) {
    await interaction.followUp({ content: `**${entry.name}** — failed. No parsed consequence; resolve per card text.` });
  }
}

module.exports = {
  buildEncounterDeck, drawEncounterCard, postEncounterCard, runMythosEncounters,
  applyRevelation, applyRevelationIfWeakness, autoSpawnDrawnEnemy, handleTreacheryTestButton, shuffle,
};
