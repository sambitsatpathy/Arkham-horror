const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requirePlayer, getPlayer, updatePlayer } = require('../../engine/gameState');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('exhaust')
    .setDescription('Exhaust or ready an in-play asset.')
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

    asset.exhausted = !asset.exhausted;
    updatePlayer(player.id, { assets: JSON.stringify(assets) });

    const state = asset.exhausted ? 'exhausted 😴' : 'readied ✅';
    await interaction.reply({ content: `**${asset.name}** is now ${state}.`, flags: 64 });
  },
};

async function executeExhaustAsset(interaction, player, session, assetCode) {
  const { getPlayerById, updatePlayer } = require('../../engine/gameState');

  const freshPlayer = getPlayerById(player.id);
  const assets = JSON.parse(freshPlayer.assets || '[]');
  const asset = assets.find(a => a.code === assetCode);

  if (!asset) {
    const msg = { content: '❌ That asset is not in play.', flags: 64 };
    return interaction.update ? interaction.update(msg) : interaction.reply(msg);
  }

  asset.exhausted = !asset.exhausted;
  updatePlayer(freshPlayer.id, { assets: JSON.stringify(assets) });

  const state = asset.exhausted ? 'exhausted 😴' : 'readied ✅';
  const replyContent = { content: `**${asset.name}** is now ${state}.`, components: [], flags: 64 };
  return interaction.update ? interaction.update(replyContent) : interaction.editReply(replyContent);
}

module.exports.executeExhaustAsset = executeExhaustAsset;
