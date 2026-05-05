const { AttachmentBuilder, ChannelType } = require('discord.js');
const { updateSession, updatePlayer, getCampaign, getPlayers } = require('./gameState');
const { findCardByCode } = require('./cardLookup');
const { revealLocation } = require('./locationManager');
const { getDb } = require('../db/database');

/**
 * Advance the agenda to the next index.
 * Returns 'advanced', 'defeat', or 'no_more' (already at final agenda).
 */
async function advanceAgenda(guild, session, scenario) {
  const nextIndex = session.agenda_index + 1;
  if (nextIndex >= scenario.agendas.length) {
    const doomCh = guild.channels.cache.get(session.doom_channel_id);
    if (doomCh) await doomCh.send('💀 **Final agenda reached — scenario defeat!**');
    return 'defeat';
  }

  const newAgenda = scenario.agendas[nextIndex];
  const newThreshold = newAgenda.doom_threshold;
  updateSession(session.id, { agenda_index: nextIndex, doom: 0, doom_threshold: newThreshold });

  const agendaCh = guild.channels.cache.get(session.agenda_channel_id);
  if (agendaCh) {
    const result = findCardByCode(newAgenda.card_code);
    if (result?.imagePath) {
      const att = new AttachmentBuilder(result.imagePath, { name: 'agenda.png' });
      await agendaCh.send({
        content: `📋 **Agenda ${nextIndex + 1}: ${newAgenda.name}** — Doom: 0/${newThreshold}`,
        files: [att],
      });
    } else {
      await agendaCh.send(`📋 **Agenda ${nextIndex + 1}: ${newAgenda.name}** — Doom: 0/${newThreshold}`);
    }
  }

  const doomCh = guild.channels.cache.get(session.doom_channel_id);
  if (doomCh) {
    await doomCh.send(`⚠️ Agenda advanced: **${newAgenda.name}** — doom reset to 0/${newThreshold}`);
  }

  return 'advanced';
}

/**
 * Advance the act to the next index.
 * Returns 'advanced' or 'no_more'.
 */
async function advanceAct(guild, session, scenario) {
  const nextIndex = session.act_index + 1;
  if (nextIndex >= scenario.acts.length) return 'no_more';

  const currentAct = scenario.acts[session.act_index];
  const cost = currentAct?.clue_cost_per_investigator ?? 0;
  if (cost > 0) {
    const campaign = getCampaign();
    const livePlayers = getPlayers(campaign.id).filter(p => !p.is_eliminated);
    const short = livePlayers.filter(p => (p.clues ?? 0) < cost);
    if (short.length > 0) {
      const list = short.map(p => `${p.investigator_name} (${p.clues}/${cost})`).join(', ');
      return { status: 'insufficient_clues', cost, short: list };
    }
    for (const p of livePlayers) {
      updatePlayer(p.id, { clues: (p.clues ?? 0) - cost });
    }
  }

  updateSession(session.id, { act_index: nextIndex });
  const newAct = scenario.acts[nextIndex];

  const actCh = guild.channels.cache.get(session.act_channel_id);
  if (actCh) {
    const result = findCardByCode(newAct.card_code);
    if (result?.imagePath) {
      const att = new AttachmentBuilder(result.imagePath, { name: 'act.png' });
      await actCh.send({ content: `📖 **Act ${nextIndex + 1}: ${newAct.name}**`, files: [att] });
    } else {
      await actCh.send(`📖 **Act ${nextIndex + 1}: ${newAct.name}**`);
    }
  }

  // Unlock next act category, lock previous
  const prevCatName = `🔍 ACT ${nextIndex} —`;
  const nextCatName = `🔒 ACT ${nextIndex + 1} —`;
  const prevCat = guild.channels.cache.find(c =>
    c.type === ChannelType.GuildCategory && c.name.startsWith(prevCatName));
  if (prevCat) {
    await prevCat.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
  }
  const nextCat = guild.channels.cache.find(c =>
    c.type === ChannelType.GuildCategory && c.name.startsWith(nextCatName));
  if (nextCat) {
    await nextCat.permissionOverwrites.delete(guild.roles.everyone);
    await nextCat.setName(nextCat.name.replace('🔒', '🔍'));
  }

  const doomCh = guild.channels.cache.get(session.doom_channel_id);
  if (doomCh) await doomCh.send(`📖 Act advanced: **${newAct.name}**`);

  // Auto-move all investigators if the act specifies a forced location
  if (newAct.move_investigators_to) {
    const campaign = getCampaign();
    const players = getPlayers(campaign.id).filter(p => !p.is_eliminated);
    const db = getDb();
    const locRow = db.prepare('SELECT * FROM locations WHERE session_id = ? AND code = ?')
      .get(session.id, newAct.move_investigators_to);

    if (locRow && locRow.status === 'hidden') {
      await revealLocation(guild, session, locRow, players);
    }

    for (const p of players) {
      updatePlayer(p.id, { location_code: newAct.move_investigators_to });
    }

    const locName = locRow?.name || newAct.move_investigators_to;
    if (doomCh) await doomCh.send(`📍 All investigators moved to **${locName}** as required by the act.`);
  }

  return 'advanced';
}

module.exports = { advanceAgenda, advanceAct };
