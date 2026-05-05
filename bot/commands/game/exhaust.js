const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getPlayer, updatePlayer } = require('../../engine/gameState');
const { findCardByCode } = require('../../engine/cardLookup');
const fs = require('fs');
const path = require('path');
const { cardDataRoot } = require('../../config');

let _fullCardsCache = null;
function getFullCard(code) {
  if (!_fullCardsCache) {
    _fullCardsCache = new Map();
    const dirs = fs.readdirSync(cardDataRoot, { withFileTypes: true }).filter(e => e.isDirectory());
    for (const d of dirs) {
      const p = path.join(cardDataRoot, d.name, 'cards.json');
      if (!fs.existsSync(p)) continue;
      try { for (const c of JSON.parse(fs.readFileSync(p, 'utf8'))) _fullCardsCache.set(c.code, c); } catch (_) {}
    }
  }
  return _fullCardsCache.get(code);
}

function extractAbilityLines(cardText) {
  if (!cardText) return [];
  const stripped = cardText.replace(/<[^>]+>/g, '');
  const lines = stripped.split('\n');
  return lines.filter(l => /\[(?:fast|action|reaction)\][^\n]*Exhaust/i.test(l) || /^\s*Exhaust [A-Z]/i.test(l));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('exhaust')
    .setDescription('Exhaust or ready an in-play asset.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('asset')
        .setDescription('Asset to exhaust or ready')
        .setRequired(true)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.respond([]);

    const assets = JSON.parse(player.assets || '[]');
    const focused = interaction.options.getFocused().toLowerCase();

    const choices = assets
      .filter(a => !focused || a.name.toLowerCase().includes(focused))
      .map(a => ({
        name: `${a.name} (${a.exhausted ? 'exhausted' : 'ready'})`,
        value: a.code,
      }))
      .slice(0, 25);

    await interaction.respond(choices);
  },

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const assetCode = interaction.options.getString('asset');
    const assets = JSON.parse(player.assets || '[]');
    const asset = assets.find(a => a.code === assetCode);

    if (!asset) {
      return interaction.reply({ content: '❌ That asset is not in play.', flags: 64 });
    }

    const wasReady = !asset.exhausted;
    asset.exhausted = !asset.exhausted;
    updatePlayer(player.id, { assets: JSON.stringify(assets) });

    const state = asset.exhausted ? 'exhausted 😴' : 'readied ✅';
    const lines = [`**${asset.name}** is now ${state}.`];
    if (wasReady) {
      const card = getFullCard(assetCode);
      const abilities = extractAbilityLines(card?.text);
      if (abilities.length) {
        lines.push('', '**Ability triggered — resolve manually:**');
        abilities.forEach(a => lines.push(`• ${a.trim()}`));
      }
    }
    await interaction.reply({ content: lines.join('\n'), flags: 64 });
  },
};

async function executeExhaustAsset(interaction, player, session, assetCode) {
  const { getPlayerById, updatePlayer } = require('../../engine/gameState');

  const freshPlayer = getPlayerById(player.id);
  const assets = JSON.parse(freshPlayer.assets || '[]');
  const asset = assets.find(a => a.code === assetCode);

  if (!asset) {
    const msg = { content: '❌ That asset is not in play.', flags: 64 };
    return interaction.deferred || interaction.replied ? interaction.editReply(msg) : interaction.reply(msg);
  }

  const wasReady = !asset.exhausted;
  asset.exhausted = !asset.exhausted;
  updatePlayer(freshPlayer.id, { assets: JSON.stringify(assets) });

  const state = asset.exhausted ? 'exhausted 😴' : 'readied ✅';
  const lines = [`**${asset.name}** is now ${state}.`];
  if (wasReady) {
    const card = getFullCard(assetCode);
    const abilities = extractAbilityLines(card?.text);
    if (abilities.length) {
      lines.push('', '**Ability triggered — resolve manually:**');
      abilities.forEach(a => lines.push(`• ${a.trim()}`));
    }
  }
  const replyContent = { content: lines.join('\n'), components: [], flags: 64 };
  return interaction.deferred || interaction.replied ? interaction.editReply(replyContent) : interaction.reply(replyContent);
}

module.exports.executeExhaustAsset = executeExhaustAsset;
