const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requirePlayer } = require('../../engine/gameState');
const { findCardByCode } = require('../../engine/cardLookup');

function buildDashboard(player) {
  const hand = JSON.parse(player.hand || '[]');
  const assets = JSON.parse(player.assets || '[]');
  const deck = JSON.parse(player.deck || '[]');
  const discard = JSON.parse(player.discard || '[]');

  const hpBar = buildBar(player.hp, player.max_hp, '❤️');
  const sanBar = buildBar(player.sanity, player.max_sanity, '🧠');

  const lines = [
    `# 🔍 ${player.investigator_name}`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    `${hpBar}  HP: ${player.hp}/${player.max_hp}`,
    `${sanBar}  SAN: ${player.sanity}/${player.max_sanity}`,
    `💰 Resources: **${player.resources}**`,
    `🔖 Clues: **${player.clues ?? 0}**`,
    `📍 Location: ${player.location_code || '—'}`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    `**Cards in Play (${assets.length})**`,
  ];

  if (assets.length === 0) {
    lines.push('  *Nothing in play*');
  } else {
    for (const a of assets) {
      const chargesStr = a.charges > 0
        ? ` — ${a.charges} charge${a.charges !== 1 ? 's' : ''} remaining`
        : '';
      const exhausted = a.exhausted ? ' *(exhausted)*' : '';
      lines.push(`  🃏 **${a.name}**${chargesStr}${exhausted}`);
    }
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`Hand: ${hand.length} card${hand.length !== 1 ? 's' : ''}  |  Deck: ${deck.length}  |  Discard: ${discard.length}`);

  return lines.join('\n');
}

function buildBar(current, max, emoji) {
  if (!max) return emoji;
  const filled = Math.round((current / max) * 8);
  return emoji + ' ' + '█'.repeat(filled) + '░'.repeat(8 - filled);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Post your investigator dashboard to your hand channel.'),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const safeName = player.investigator_name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-hand';
    const handCh = interaction.guild.channels.cache.find(c => c.name === safeName);

    if (!handCh) {
      return interaction.reply({ content: '❌ Your hand channel was not found.', flags: 64 });
    }

    const content = buildDashboard(player);

    // Try to find and edit an existing pinned dashboard message from the bot
    try {
      const pinned = await handCh.messages.fetchPinned();
      const existing = pinned.find(m => m.author.id === interaction.client.user.id && m.content.startsWith('# 🔍'));
      if (existing) {
        await existing.edit(content);
        return interaction.reply({ content: `✅ Dashboard updated in ${handCh}.`, flags: 64 });
      }
    } catch (_) {}

    // Post and pin a fresh dashboard
    const msg = await handCh.send(content);
    try { await msg.pin(); } catch (_) {}

    await interaction.reply({ content: `✅ Dashboard posted in ${handCh}.`, flags: 64 });
  },
};
