const { SlashCommandBuilder } = require('discord.js');
const { requireHost } = require('../../engine/gameState');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear all messages in a channel. Host only.')
    .addStringOption(opt =>
      opt.setName('channel')
        .setDescription('Which channel to clear')
        .setRequired(true)
        .addChoices(
          { name: '#pregame', value: 'pregame' },
          { name: '#bot-log', value: 'bot-log' },
        )),

  async execute(interaction) {
    const host = requireHost(interaction);
    if (!host) return;

    const target = interaction.options.getString('channel');
    const ch = interaction.guild.channels.cache.find(c => c.name === target);
    if (!ch) return interaction.reply({ content: `Channel #${target} not found.`, flags: 64 });

    // Acknowledge immediately — must happen before we delete the channel
    // (deleting the channel the interaction came from invalidates the token)
    await interaction.reply({ content: `🧹 Clearing **#${target}**…`, flags: 64 });

    const position = ch.position;
    const clone = await ch.clone({ reason: '/clear command' });
    await clone.setPosition(position);
    await ch.delete();
    await clone.send(`🧹 Channel cleared by **${interaction.user.username}**.`);
  },
};
