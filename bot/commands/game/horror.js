const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getPlayer, updatePlayer, addCampaignLog, getCampaign } = require('../../engine/gameState');
const { horrorAsset } = require('../../engine/deck');
const { fireTriggers } = require('../../engine/cardEffectResolver');
const { execEffect } = require('../../engine/effectExecutors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('horror')
    .setDescription('Take sanity damage (horror) — to yourself or redirect to an in-play asset.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(opt =>
      opt.setName('amount').setDescription('Horror amount').setRequired(true).setMinValue(1))
    .addStringOption(opt =>
      opt.setName('asset')
        .setDescription('Redirect horror to an in-play asset with sanity (e.g. ally)')
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
          const sanStr = a.max_sanity ? ` [${a.sanity}/${a.max_sanity} SAN]` : '';
          return { name: `${a.name}${sanStr}`, value: a.code };
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
      if (asset.sanity == null) {
        return interaction.reply({ content: `❌ **${asset.name}** has no sanity tracking. Re-play the card to initialize it, or apply horror directly to yourself.`, flags: 64 });
      }
      if (asset.sanity <= 0) {
        return interaction.reply({ content: `❌ **${asset.name}** already has 0 sanity.`, flags: 64 });
      }

      const newSan = horrorAsset(player, assetCode, amount);
      if (newSan === 0) {
        return interaction.reply(`🌀 **${asset.name}** absorbed ${amount} horror and was **destroyed** (discarded).`);
      }
      return interaction.reply(`🌀 **${asset.name}** absorbed ${amount} horror. SAN: **${newSan}/${asset.max_sanity}**`);
    }

    // Horror to investigator directly
    const newSan = Math.max(0, player.sanity - amount);
    updatePlayer(player.id, { sanity: newSan });

    const insane = newSan === 0;
    if (insane) {
      updatePlayer(player.id, { is_eliminated: 1 });
      const campaign = getCampaign();
      addCampaignLog(campaign.id, session.scenario_code, `${player.investigator_name} went insane.`);
    }

    const msg = insane
      ? `🌀 **${player.investigator_name}** took ${amount} horror and has gone **insane**!`
      : `🧠 **${player.investigator_name}** took ${amount} horror. SAN: **${newSan}/${player.max_sanity}**`;

    await interaction.reply(msg);

    const trigs = fireTriggers(player, 'after_take_horror');
    const triggerLines = [];
    for (const trig of trigs) {
      for (const eff of trig.effects) {
        triggerLines.push(`↪ from **${trig.source_name}**: ` + (await execEffect(eff, { player, session, guild: interaction.guild })));
      }
    }
    if (triggerLines.length > 0) {
      await interaction.followUp({ content: triggerLines.join('\n'), flags: 64 });
    }
  },
};
