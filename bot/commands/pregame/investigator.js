const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { getCampaign, getPlayers, requirePlayer, updatePlayer } = require('../../engine/gameState');
const { findInvestigator } = require('../../engine/cardLookup');
const investigators = require('../../data/investigators/core2.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('investigator')
    .setDescription('Choose your investigator.')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Choose your investigator')
        .setRequired(true)
        .addChoices(
          { name: 'Roland Banks — The Fed (Guardian)', value: 'Roland Banks' },
          { name: 'Daisy Walker — The Librarian (Seeker)', value: 'Daisy Walker' },
          { name: '"Skids" O\'Toole — The Ex-Con (Rogue)', value: 'Skids' },
          { name: 'Agnes Baker — The Waitress (Mystic)', value: 'Agnes Baker' },
          { name: 'Wendy Adams — The Urchin (Survivor)', value: 'Wendy Adams' },
        )),

  async execute(interaction) {
    const player = requirePlayer(interaction);
    if (!player) return;

    if (player.investigator_code) {
      return interaction.reply({ content: `You already chose **${player.investigator_name}**.`, flags: 64 });
    }

    const query = interaction.options.getString('name');
    const result = findInvestigator(query);
    if (!result) {
      return interaction.reply({ content: `Could not find investigator matching "${query}".`, flags: 64 });
    }

    const { card, imagePath } = result;

    // Check not already taken
    const campaign = getCampaign();
    const players = getPlayers(campaign.id);
    const taken = players.find(p => p.investigator_code === card.code && p.id !== player.id);
    if (taken) {
      return interaction.reply({ content: `**${card.name}** is already taken by @${taken.discord_name}.`, flags: 64 });
    }

    // Get stats from local investigators data
    const invData = investigators.find(i => i.code === card.code);
    const health = invData ? invData.health : (card.health || 6);
    const sanity = invData ? invData.sanity : (card.sanity || 6);

    updatePlayer(player.id, {
      investigator_code: card.code,
      investigator_name: card.name,
      hp: health,
      max_hp: health,
      sanity: sanity,
      max_sanity: sanity,
    });

    const pregameChannel = interaction.guild.channels.cache.find(c => c.name === 'pregame');
    const target = pregameChannel || interaction.channel;

    if (imagePath) {
      const attachment = new AttachmentBuilder(imagePath, { name: 'investigator.png' });
      await target.send({
        content: `🔍 **${interaction.user.username}** chose **${card.name}** — *${card.subname || ''}* (HP: ${health} / SAN: ${sanity})`,
        files: [attachment],
      });
    } else {
      await target.send(`🔍 **${interaction.user.username}** chose **${card.name}** — *${card.subname || ''}* (HP: ${health} / SAN: ${sanity})`);
    }

    await interaction.reply({ content: `✅ Investigator locked in: **${card.name}**`, flags: 64 });
  },
};
