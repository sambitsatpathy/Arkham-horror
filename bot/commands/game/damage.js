const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requirePlayer, updatePlayer, addCampaignLog, getCampaign, getSession } = require('../../engine/gameState');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('damage')
    .setDescription('Take physical damage.')
    .addIntegerOption(opt =>
      opt.setName('amount').setDescription('Damage amount').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const amount = interaction.options.getInteger('amount');
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
