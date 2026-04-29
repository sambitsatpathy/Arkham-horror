const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getEnemiesAt, updateEnemy } = require('../../engine/gameState');
const { handChannelName } = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('engage')
    .setDescription('Engage an aloof enemy at your location (costs 1 action).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(opt =>
      opt.setName('enemy_id')
        .setDescription('Enemy ID (from /enemy list)')
        .setRequired(true)),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const enemyId = interaction.options.getInteger('enemy_id');
    const enemies = getEnemiesAt(session.id, player.location_code);
    const enemy = enemies.find(e => e.id === enemyId);

    if (!enemy) {
      return interaction.reply({ content: `❌ No enemy with ID ${enemyId} at your location.`, flags: 64 });
    }

    if (!enemy.is_aloof) {
      return interaction.reply({ content: `❌ **${enemy.name}** is not aloof — it's already engaged.`, flags: 64 });
    }

    updateEnemy(enemyId, { is_aloof: 0 });

    const handCh = interaction.guild.channels.cache.find(c =>
      c.name === handChannelName(player.investigator_name)
    );
    if (handCh) {
      await handCh.send(`⚔️ **${player.investigator_name}** engages **${enemy.name}**! (aloof cleared)`);
    }

    return interaction.reply({ content: `✅ You engage **${enemy.name}**. It will now activate normally during the enemy phase.`, flags: 64 });
  },
};
