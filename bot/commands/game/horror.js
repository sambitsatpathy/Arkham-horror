const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requirePlayer, updatePlayer, addCampaignLog, getCampaign } = require('../../engine/gameState');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('horror')
    .setDescription('Take sanity damage (horror).')
    .addIntegerOption(opt =>
      opt.setName('amount').setDescription('Horror amount').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const amount = interaction.options.getInteger('amount');
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
  },
};
