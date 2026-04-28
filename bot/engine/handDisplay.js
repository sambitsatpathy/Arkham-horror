const { AttachmentBuilder } = require('discord.js');
const { findCardByCode } = require('./cardLookup');
const { getPlayerById } = require('./gameState');
const { handChannelName } = require('../config');

const MARKER = '🃏 **Current Hand —';

async function refreshHandDisplay(guild, player) {
  const fresh = getPlayerById(player.id);
  if (!fresh) return;

  const hand = JSON.parse(fresh.hand || '[]');
  const handCh = guild.channels.cache.find(c => c.name === handChannelName(fresh.investigator_name));
  if (!handCh) return;

  // Delete the existing pinned hand display
  try {
    const pins = await handCh.messages.fetchPins();
    const existing = pins.find(m => m.author.id === guild.client.user.id && m.content.startsWith(MARKER));
    if (existing) await existing.delete();
  } catch (_) {}

  const header = `${MARKER} **${fresh.investigator_name}** (${hand.length} card${hand.length !== 1 ? 's' : ''})`;

  if (hand.length === 0) {
    const msg = await handCh.send(`${header}\n*Hand is empty.*`);
    try { await msg.pin(); } catch (_) {}
    return;
  }

  const files = [];
  const nameLines = [];
  for (const code of hand) {
    const result = findCardByCode(code);
    nameLines.push(`  • ${result?.card.name || code}`);
    if (result?.imagePath) {
      files.push(new AttachmentBuilder(result.imagePath, { name: `${code}.png` }));
    }
  }

  // Discord allows max 10 attachments per message
  const msg = await handCh.send({ content: `${header}\n${nameLines.join('\n')}`, files: files.slice(0, 10) });
  try { await msg.pin(); } catch (_) {}
}

module.exports = { refreshHandDisplay };
