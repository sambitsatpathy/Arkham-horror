const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { getCampaign, getPlayers, requirePlayer, updatePlayer } = require('../../engine/gameState');
const { findInvestigator, findCardByCode } = require('../../engine/cardLookup');
const allInvestigators = require('../../data/investigators/investigators.json');

const FACTION_LABEL = {
  guardian: 'Guardian', seeker: 'Seeker', rogue: 'Rogue',
  mystic: 'Mystic', survivor: 'Survivor', neutral: 'Neutral',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('investigator')
    .setDescription('Choose your investigator.')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Type a name to search')
        .setRequired(true)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();

    const choices = allInvestigators
      .filter(i => !focused || i.name.toLowerCase().includes(focused) || i.subname?.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(i => {
        const faction = FACTION_LABEL[i.faction] || i.faction;
        return {
          name: `${i.name} — ${i.subname} (${faction}) HP:${i.health} SAN:${i.sanity}`,
          value: i.code,
        };
      });

    await interaction.respond(choices);
  },

  async execute(interaction) {
    const player = requirePlayer(interaction);
    if (!player) return;

    if (player.investigator_code) {
      return interaction.reply({ content: `You already chose **${player.investigator_name}**.`, flags: 64 });
    }

    // Value is now the card code directly from autocomplete
    const code = interaction.options.getString('name');
    const invData = allInvestigators.find(i => i.code === code);
    if (!invData) {
      return interaction.reply({ content: `Unknown investigator code. Please select from the dropdown.`, flags: 64 });
    }

    const result = findInvestigator(invData.name);
    const exactResult = findCardByCode(code) || result;

    const card = exactResult?.card || result?.card;
    const imagePath = exactResult?.imagePath || result?.imagePath;

    if (!card) {
      return interaction.reply({ content: `Could not find card data for **${invData.name}**.`, flags: 64 });
    }

    // Check not already taken
    const campaign = getCampaign();
    const players = getPlayers(campaign.id);
    const taken = players.find(p => p.investigator_code === code && p.id !== player.id);
    if (taken) {
      return interaction.reply({ content: `**${invData.name}** is already taken by @${taken.discord_name}.`, flags: 64 });
    }

    updatePlayer(player.id, {
      investigator_code: code,
      investigator_name: invData.name,
      hp: invData.health,
      max_hp: invData.health,
      sanity: invData.sanity,
      max_sanity: invData.sanity,
    });

    const pregameChannel = interaction.guild.channels.cache.find(c => c.name === 'pregame');
    const target = pregameChannel || interaction.channel;
    const faction = FACTION_LABEL[invData.faction] || invData.faction;
    const skills = invData.skills;
    const skillStr = `WIL:${skills.willpower} INT:${skills.intellect} COM:${skills.combat} AGI:${skills.agility}`;

    const content = `🔍 **${interaction.user.username}** chose **${invData.name}** — *${invData.subname}* (${faction})\nHP: ${invData.health} | SAN: ${invData.sanity} | ${skillStr}`;

    if (imagePath) {
      await target.send({ content, files: [new AttachmentBuilder(imagePath, { name: 'investigator.png' })] });
    } else {
      await target.send(content);
    }

    await interaction.reply({ content: `✅ Investigator locked in: **${invData.name}**`, flags: 64 });
  },
};
