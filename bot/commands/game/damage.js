const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getPlayer, updatePlayer, addCampaignLog, getCampaign } = require('../../engine/gameState');
const { damageAsset } = require('../../engine/deck');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('damage')
    .setDescription('Take physical damage — to yourself or redirect to an in-play asset.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(opt =>
      opt.setName('amount').setDescription('Damage amount').setRequired(true).setMinValue(1))
    .addStringOption(opt =>
      opt.setName('asset')
        .setDescription('Redirect damage to an in-play asset with HP (e.g. Bulletproof Vest, ally)')
        .setRequired(false)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.respond([]);
    const query = interaction.options.getFocused().toLowerCase();
    const assets = JSON.parse(player.assets || '[]');
    return interaction.respond(
      assets
        .filter(a => !query || a.name.toLowerCase().includes(query))
        .map(a => {
          const hpStr = a.max_hp ? ` [${a.hp}/${a.max_hp} HP]` : '';
          return { name: `${a.name}${hpStr}`, value: a.code };
        })
        .slice(0, 25)
    );
  },

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const amount = interaction.options.getInteger('amount');
    const assetCode = interaction.options.getString('asset');

    if (assetCode) {
      const assets = JSON.parse(player.assets || '[]');
      const asset = assets.find(a => a.code === assetCode);
      if (!asset) return interaction.reply({ content: '❌ That asset is not in play.', flags: 64 });
      if (asset.hp == null) {
        return interaction.reply({ content: `❌ **${asset.name}** has no HP tracking. Re-play the card to initialize its HP, or apply damage directly to yourself.`, flags: 64 });
      }
      if (asset.hp <= 0) {
        return interaction.reply({ content: `❌ **${asset.name}** already has 0 HP.`, flags: 64 });
      }

      const newHp = damageAsset(player, assetCode, amount);
      if (newHp === 0) {
        return interaction.reply(`🩸 **${asset.name}** absorbed ${amount} damage and was **destroyed** (discarded).`);
      }
      return interaction.reply(`🩸 **${asset.name}** absorbed ${amount} damage. HP: **${newHp}/${asset.max_hp}**`);
    }

    // Damage investigator directly
    const newHp = Math.max(0, player.hp - amount);
    updatePlayer(player.id, { hp: newHp });

    const dead = newHp === 0;
    if (dead) {
      updatePlayer(player.id, { is_eliminated: 1 });
      const campaign = getCampaign();
      addCampaignLog(campaign.id, session.scenario_code, `${player.investigator_name} was defeated by physical damage.`);
    }

    const msg = dead
      ? `💀 **${player.investigator_name}** took ${amount} damage and has been **eliminated**!`
      : `🩸 **${player.investigator_name}** took ${amount} damage. HP: **${newHp}/${player.max_hp}**`;

    await interaction.reply(msg);
  },
};
