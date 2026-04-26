const { SlashCommandBuilder } = require('discord.js');
const { getCampaign, getCampaignLog } = require('../../engine/gameState');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('campaignlog')
    .setDescription('Show the campaign log.'),

  async execute(interaction) {
    const campaign = getCampaign();
    if (!campaign) return interaction.reply({ content: 'No active campaign.', flags: 64 });

    const entries = getCampaignLog(campaign.id);
    if (entries.length === 0) {
      return interaction.reply({ content: 'The campaign log is empty.', flags: 64 });
    }

    const lines = entries.map(e => {
      const prefix = e.is_crossed_out ? '~~' : '';
      const suffix = e.is_crossed_out ? '~~' : '';
      const scenario = e.scenario_code ? ` *(${e.scenario_code})*` : '';
      return `${prefix}• ${e.entry}${suffix}${scenario}`;
    });

    const content = `📜 **Campaign Log — ${campaign.name}**\n\n${lines.join('\n')}`;

    // Split if over 2000 chars
    if (content.length <= 2000) {
      await interaction.reply({ content, flags: 64 });
    } else {
      const chunks = [];
      let current = `📜 **Campaign Log — ${campaign.name}**\n\n`;
      for (const line of lines) {
        if (current.length + line.length + 1 > 2000) {
          chunks.push(current);
          current = '';
        }
        current += line + '\n';
      }
      if (current) chunks.push(current);
      await interaction.reply({ content: chunks[0], flags: 64 });
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ content: chunks[i], flags: 64 });
      }
    }
  },
};
