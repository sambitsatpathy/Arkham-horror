const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { requireSession, requirePlayer, getPlayer } = require('../../engine/gameState');
const { useCharge, addCharges } = require('../../engine/deck');
const { findCardByCode } = require('../../engine/cardLookup');
const { handChannelName } = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('use')
    .setDescription('Spend or add charges on an in-play asset.')
    .addStringOption(opt =>
      opt.setName('asset')
        .setDescription('Asset to target')
        .setRequired(true)
        .setAutocomplete(true))
    .addIntegerOption(opt =>
      opt.setName('add')
        .setDescription('Add this many charges instead of spending one (positive integer)')
        .setMinValue(1)
        .setRequired(false)),

  async autocomplete(interaction) {
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.respond([]);

    const assets = JSON.parse(player.assets || '[]');
    const focused = interaction.options.getFocused().toLowerCase();
    const isAdding = interaction.options.getInteger('add') != null;

    const choices = assets
      .filter(a => isAdding ? true : a.charges > 0)
      .filter(a => !focused || a.name.toLowerCase().includes(focused))
      .map(a => ({
        name: `${a.name} (${a.charges ?? 0} charge${(a.charges ?? 0) !== 1 ? 's' : ''})`,
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
    const addCount = interaction.options.getInteger('add');
    const assets = JSON.parse(player.assets || '[]');
    const asset = assets.find(a => a.code === assetCode);

    if (!asset) {
      return interaction.reply({ content: '❌ That asset is not in play.', flags: 64 });
    }

    const handCh = interaction.guild.channels.cache.find(c => c.name === handChannelName(player.investigator_name));

    if (addCount != null) {
      const newCount = addCharges(player, assetCode, addCount);
      const msg = `🔋 Added ${addCount} charge${addCount !== 1 ? 's' : ''} to **${asset.name}** — now has **${newCount}**.`;
      if (handCh) await handCh.send(msg);
      return interaction.reply({ content: msg, flags: 64 });
    }

    if (asset.charges <= 0) {
      return interaction.reply({ content: `❌ **${asset.name}** has no charges remaining.`, flags: 64 });
    }

    const remaining = useCharge(player, assetCode);

    if (remaining === 0) {
      const msg = `⚡ Used last charge on **${asset.name}** — asset discarded.`;
      if (handCh) await handCh.send(msg);
      await interaction.reply({ content: `⚡ Used last charge on **${asset.name}** — it has been discarded.`, flags: 64 });
    } else {
      const msg = `⚡ Used charge on **${asset.name}** — ${remaining} charge${remaining !== 1 ? 's' : ''} remaining.`;
      if (handCh) await handCh.send(msg);
      await interaction.reply({ content: msg, flags: 64 });
    }
  },
};
