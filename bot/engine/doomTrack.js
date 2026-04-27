const SENTINEL = 'DOOM TRACK';

function buildDoomTrackText(doom, doomThreshold, round, phase, players) {
  const filled = doomThreshold > 0 ? Math.min(10, Math.round((doom / doomThreshold) * 10)) : 0;
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return [
    `☠️  **${SENTINEL}**`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    `Doom:    ${doom} / ${doomThreshold}  [${bar}]`,
    `Round:   ${round}`,
    `Phase:   ${phase}`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    'Investigators:',
    ...players.map(p =>
      `  🔍 ${(p.investigator_name || p.discord_name).padEnd(20)} HP: ${p.hp}/${p.max_hp}  SAN: ${p.sanity}/${p.max_sanity}`
    ),
    '━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');
}

async function updateDoomTrack(channel, doom, doomThreshold, round, phase, players) {
  if (!channel) return;
  const text = buildDoomTrackText(doom, doomThreshold, round, phase, players);

  try {
    const pins = await channel.messages.fetchPinned();
    const existing = pins.find(m => m.author.bot && m.content.includes(SENTINEL));
    if (existing) { await existing.edit(text); return; }
  } catch (_) {}

  const msg = await channel.send(text);
  try { await msg.pin(); } catch (_) {}
}

module.exports = { buildDoomTrackText, updateDoomTrack };
