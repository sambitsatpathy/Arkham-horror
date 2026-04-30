const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { getCampaign, getSession, getPlayers, requirePlayer, updatePlayer } = require('../../engine/gameState');
const { findInvestigator, findCardByCode } = require('../../engine/cardLookup');
const { importDeck, buildStarterDeck } = require('../../engine/deckImport');
const { initDeck } = require('../../engine/deck');
const allInvestigators = require('../../data/investigators/investigators.json');
const starterDecks = require('../../data/investigators/starter_decks.json');

const FACTION_LABEL = {
  guardian: 'Guardian', seeker: 'Seeker', rogue: 'Rogue',
  mystic: 'Mystic', survivor: 'Survivor', neutral: 'Neutral',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('investigator')
    .setDescription('Choose your investigator and load your deck.')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Type a name to search')
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption(opt =>
      opt.setName('deck_url')
        .setDescription('ArkhamDB deck URL or ID (leave blank to use the starter deck)')
        .setRequired(false)),

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

    // Block changes once the game has started
    const session = getSession();
    if (session && session.phase !== 'pregame') {
      return interaction.reply({ content: `The game has already started — investigator cannot be changed.`, flags: 64 });
    }

    const isReselect = !!player.investigator_code;
    const code = interaction.options.getString('name');
    const deckUrl = interaction.options.getString('deck_url');

    const invData = allInvestigators.find(i => i.code === code);
    if (!invData) {
      return interaction.reply({ content: `Unknown investigator. Please select from the dropdown.`, flags: 64 });
    }

    // Check not already taken
    const campaign = getCampaign();
    const players = getPlayers(campaign.id);
    const taken = players.find(p => p.investigator_code === code && p.id !== player.id);
    if (taken) {
      return interaction.reply({ content: `**${invData.name}** is already taken by @${taken.discord_name}.`, flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    // Save investigator
    updatePlayer(player.id, {
      investigator_code: code,
      investigator_name: invData.name,
      hp: invData.health,
      max_hp: invData.health,
      sanity: invData.sanity,
      max_sanity: invData.sanity,
    });

    // Load deck — import if URL provided, otherwise starter deck
    let deckSummary;
    const warnings = [];

    if (deckUrl) {
      try {
        const result = await importDeck(deckUrl, code);
        initDeck(player, result.codes);
        updatePlayer(player.id, {
          deck_ready: 1,
          arkhamdb_deck_id: result.deckId,
          deck_name: result.deckName,
        });
        if (result.unknown.length > 0) {
          warnings.push(`⚠️ ${result.unknown.length} card(s) not found locally: \`${result.unknown.join(', ')}\``);
        }
        deckSummary = `**${result.deckName}** imported — ${result.codes.length} cards`;
      } catch (err) {
        deckSummary = `⚠️ Deck import failed (${err.message}) — starter deck loaded instead`;
        const { deckName, codes } = buildStarterDeck(code, starterDecks);
        initDeck(player, codes);
        updatePlayer(player.id, { deck_ready: 1, deck_name: deckName });
      }
    } else {
      try {
        const { deckName, codes } = buildStarterDeck(code, starterDecks);
        initDeck(player, codes);
        updatePlayer(player.id, { deck_ready: 1, deck_name: deckName });
        deckSummary = `**${deckName}** loaded — ${codes.length} cards`;
      } catch (err) {
        deckSummary = `⚠️ No starter deck available (${err.message})`;
      }
    }

    // Post to #pregame
    const exactResult = findCardByCode(code) || findInvestigator(invData.name);
    const imagePath = exactResult?.imagePath;
    const faction = FACTION_LABEL[invData.faction] || invData.faction;
    const { willpower, intellect, combat, agility } = invData.skills;
    const skillStr = `WIL:${willpower} INT:${intellect} COM:${combat} AGI:${agility}`;
    const action = isReselect ? `changed investigator to` : `chose`;
    const content = `🔍 **${interaction.user.username}** ${action} **${invData.name}** — *${invData.subname}* (${faction})\nHP: ${invData.health} | SAN: ${invData.sanity} | ${skillStr}\n🃏 ${deckSummary}`;

    const pregameCh = interaction.guild.channels.cache.find(c => c.name === 'pre-game');
    const target = pregameCh || interaction.channel;
    if (imagePath) {
      await target.send({ content, files: [new AttachmentBuilder(imagePath, { name: 'investigator.png' })] });
    } else {
      await target.send(content);
    }

    const replyLines = [isReselect ? `✅ Switched to **${invData.name}**. ${deckSummary}.` : `✅ **${invData.name}** locked in. ${deckSummary}.`];
    if (warnings.length) replyLines.push(...warnings);
    await interaction.editReply(replyLines.join('\n'));
  },
};
