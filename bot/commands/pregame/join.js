const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../../db/database');
const { getCampaign, getPlayers, getPlayer } = require('../../engine/gameState');
const { ensureRole } = require('../../engine/serverBuilder');
const { maxPlayers } = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join the game. The first player to join becomes Host.'),

  async execute(interaction) {
    const db = getDb();

    // Ensure a campaign exists
    let campaign = getCampaign();
    if (!campaign) {
      db.prepare("INSERT INTO campaign (name, scenario_index) VALUES (?, 0)").run('The Night of the Zealot');
      campaign = getCampaign();
    }

    const existing = getPlayer(interaction.user.id);
    if (existing) {
      return interaction.reply({ content: 'You have already joined.', flags: 64 });
    }

    const players = getPlayers(campaign.id);
    if (players.length >= maxPlayers) {
      return interaction.reply({ content: `The game is full (max ${maxPlayers} players).`, flags: 64 });
    }

    const isHost = players.length === 0 ? 1 : 0;

    db.prepare(`
      INSERT INTO players (campaign_id, discord_id, discord_name, is_host)
      VALUES (?, ?, ?, ?)
    `).run(campaign.id, interaction.user.id, interaction.user.username, isHost);

    await interaction.deferReply();

    if (isHost) {
      const role = await ensureRole(interaction.guild, '🎲 Game Host', 0xe74c3c);
      await interaction.member.roles.add(role);
    }

    const label = isHost ? ' You are the **Host**.' : '';
    await interaction.editReply(`✅ **${interaction.user.username}** has joined the game.${label} (${players.length + 1}/${maxPlayers} players)`);
  },
};
