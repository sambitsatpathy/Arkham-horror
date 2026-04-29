const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, updatePlayer } = require('../../engine/gameState');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('heal')
    .setDescription('Heal damage or horror.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('What to heal')
        .setRequired(true)
        .addChoices(
          { name: 'damage (HP)', value: 'damage' },
          { name: 'horror (Sanity)', value: 'horror' },
        ))
    .addIntegerOption(opt =>
      opt.setName('amount').setDescription('Amount to heal').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const type = interaction.options.getString('type');
    const amount = interaction.options.getInteger('amount');

    if (type === 'damage') {
      const newHp = Math.min(player.max_hp, player.hp + amount);
      updatePlayer(player.id, { hp: newHp });
      await interaction.reply({ content: `❤️ Healed ${amount} damage. HP: **${newHp}/${player.max_hp}**`, flags: 64 });
    } else {
      const newSan = Math.min(player.max_sanity, player.sanity + amount);
      updatePlayer(player.id, { sanity: newSan });
      await interaction.reply({ content: `💚 Healed ${amount} horror. SAN: **${newSan}/${player.max_sanity}**`, flags: 64 });
    }
  },
};
