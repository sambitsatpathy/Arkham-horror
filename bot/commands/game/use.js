const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { requireSession, requirePlayer, getPlayer } = require('../../engine/gameState');
const { useCharge } = require('../../engine/deck');
const { findCardByCode } = require('../../engine/cardLookup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('use')
    .setDescription('Spend a charge from an in-play asset.')
    .addStringOption(opt =>
      opt.setName('asset')
        .setDescription('Asset to use a charge from')
        .setRequired(true)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.respond([]);

    const assets = JSON.parse(player.assets || '[]');
    const focused = interaction.options.getFocused().toLowerCase();

    const choices = assets
      .filter(a => a.charges > 0 && (!focused || a.name.toLowerCase().includes(focused)))
      .map(a => ({ name: `${a.name} (${a.charges} charge${a.charges !== 1 ? 's' : ''} left)`, value: a.code }))
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
      return interaction.reply({ content: 'That asset is not in play.', flags: 64 });
    }
    if (asset.charges <= 0) {
      return interaction.reply({ content: `**${asset.name}** has no charges remaining.`, flags: 64 });
    }

    const remaining = useCharge(player, assetCode);

    const safeName = player.investigator_name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-hand';
    const handCh = interaction.guild.channels.cache.find(c => c.name === safeName);

    if (remaining === 0) {
      if (handCh) await handCh.send(`⚡ Used last charge on **${asset.name}** — asset discarded.`);
      await interaction.reply({ content: `⚡ Used last charge on **${asset.name}** — it has been discarded.`, flags: 64 });
    } else {
      if (handCh) await handCh.send(`⚡ Used charge on **${asset.name}** — ${remaining} charge${remaining !== 1 ? 's' : ''} remaining.`);
      await interaction.reply({ content: `⚡ Charge spent. **${asset.name}** has ${remaining} charge${remaining !== 1 ? 's' : ''} remaining.`, flags: 64 });
    }
  },
};
