const { AttachmentBuilder } = require('discord.js');
const { getDb } = require('../db/database');
const { getLocation, getEnemiesAt, getPlayers, getCampaign, updateLocation } = require('./gameState');
const { findCard, fetchLocationBackImage } = require('./cardLookup');

function buildStatusEmbed(loc, enemies, investigators) {
  const clueStr = loc.clues > 0 ? `${loc.clues} 🔎` : '0';
  const doomStr = loc.doom > 0 ? `${loc.doom} 💀` : '0';
  const enemyStr = enemies.length > 0 ? enemies.map(e => `${e.name} (${e.hp}/${e.max_hp}hp)`).join(', ') : 'None';

  const invHere = investigators.filter(i => i.location_code === loc.code);
  const invStr = invHere.length > 0 ? invHere.map(i => `@${i.discord_name}`).join(', ') : 'None';

  return [
    `📍 **${loc.name.toUpperCase()}**`,
    '━━━━━━━━━━━━━━━━━',
    `Shroud:        ${loc.shroud}`,
    `Clues:         ${clueStr}`,
    `Doom:          ${doomStr}`,
    '━━━━━━━━━━━━━━━━━',
    `Enemies:       ${enemyStr}`,
    `Investigators: ${invStr}`,
    '━━━━━━━━━━━━━━━━━',
  ].join('\n');
}

async function revealLocation(guild, session, loc, investigators) {
  const channel = guild.channels.cache.get(loc.channel_id);
  if (!channel) return;

  // Rename channel
  const newName = '🔍・' + loc.name.toLowerCase().replace(/\s+/g, '-');
  await channel.setName(newName);

  // Unlock for everyone
  try {
    await channel.permissionOverwrites.delete(guild.roles.everyone);
  } catch (e) {
    if (e.code === 50013) {
      console.warn(`revealLocation: cannot remove @everyone deny on ${channel.name} — bot lacks ManageRoles. Grant Administrator role.`);
    } else throw e;
  }

  // Pin card image
  const result = findCard(loc.name, { typeCode: 'location' });
  let cardMsgId = loc.card_message_id;
  if (result && result.imagePath && !cardMsgId) {
    const attachment = new AttachmentBuilder(result.imagePath, { name: 'location.png' });
    const msg = await channel.send({ files: [attachment] });
    try { await msg.pin(); } catch (_) {}
    cardMsgId = msg.id;
  }

  // Post + pin live status
  const enemies = getEnemiesAt(session.id, loc.code);
  const statusText = buildStatusEmbed(loc, enemies, investigators);
  const statusMsg = await channel.send(statusText);
  try { await statusMsg.pin(); } catch (_) {}

  updateLocation(loc.id, {
    status: 'revealed',
    card_message_id: cardMsgId,
    status_message_id: statusMsg.id,
  });

  return channel;
}

async function updateLocationStatus(guild, session, loc) {
  const channel = guild.channels.cache.get(loc.channel_id);
  if (!channel || !loc.status_message_id) return;

  const campaign = getCampaign();
  const investigators = getPlayers(campaign.id);
  const enemies = getEnemiesAt(session.id, loc.code);
  const statusText = buildStatusEmbed(loc, enemies, investigators);

  try {
    const msg = await channel.messages.fetch(loc.status_message_id);
    await msg.edit(statusText);
  } catch (_) {}

  // Rename if all clues collected
  if (loc.clues === 0 && loc.status === 'revealed') {
    const clearedName = '✅・' + loc.name.toLowerCase().replace(/\s+/g, '-');
    const currentName = channel.name;
    if (!currentName.startsWith('✅')) {
      await channel.setName(clearedName);
      updateLocation(loc.id, { status: 'cleared' });
    }
  }
}

async function pinInitialStatus(guild, session, loc, investigators) {
  const channel = guild.channels.cache.get(loc.channel_id);
  if (!channel) return;

  const result = findCard(loc.name, { typeCode: 'location' });
  let cardMsgId = null;
  if (result && result.imagePath) {
    const attachment = new AttachmentBuilder(result.imagePath, { name: 'location.png' });
    const msg = await channel.send({ files: [attachment] });
    try { await msg.pin(); } catch (_) {}
    cardMsgId = msg.id;
  }

  const enemies = getEnemiesAt(session.id, loc.code);
  const statusText = buildStatusEmbed(loc, enemies, investigators);
  const statusMsg = await channel.send(statusText);
  try { await statusMsg.pin(); } catch (_) {}

  updateLocation(loc.id, {
    status: 'revealed',
    card_message_id: cardMsgId,
    status_message_id: statusMsg.id,
  });
}

async function pinHiddenStatus(guild, loc, cardCode) {
  const channel = guild.channels.cache.get(loc.channel_id);
  if (!channel) return;

  // Try to get the unrevealed (back) face image from ArkhamDB
  const backPath = cardCode ? await fetchLocationBackImage(cardCode) : null;

  if (backPath) {
    const attachment = new AttachmentBuilder(backPath, { name: 'location_back.png' });
    const msg = await channel.send({
      content: `🔒 **UNREVEALED LOCATION** — *This location has not been explored yet.*`,
      files: [attachment],
    });
    try { await msg.pin(); } catch (_) {}
  } else {
    // Fallback: styled text placeholder
    const msg = await channel.send([
      `🔒 **UNREVEALED LOCATION**`,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      `*This location has not been explored yet.*`,
      `*Investigators who venture here will reveal its secrets.*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
    ].join('\n'));
    try { await msg.pin(); } catch (_) {}
  }
}

module.exports = { revealLocation, updateLocationStatus, buildStatusEmbed, pinInitialStatus, pinHiddenStatus };
