const { SlashCommandBuilder } = require('discord.js');
const { requirePlayer, updatePlayer } = require('../../engine/gameState');
const { importDeck, buildStarterDeck } = require('../../engine/deckImport');
const { initDeck } = require('../../engine/deck');
const starterDecks = require('../../data/investigators/starter_decks.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deck')
    .setDescription('Load your deck.')
    .addSubcommand(sub =>
      sub.setName('default')
        .setDescription('Load the predefined starter deck for your investigator.'))
    .addSubcommand(sub =>
      sub.setName('import')
        .setDescription('Import a custom deck from ArkhamDB.')
        .addStringOption(opt =>
          opt.setName('url')
            .setDescription('ArkhamDB deck URL or deck ID')
            .setRequired(true))),

  async execute(interaction) {
    const player = requirePlayer(interaction);
    if (!player) return;

    if (!player.investigator_code) {
      return interaction.reply({ content: 'Choose an investigator first with `/investigator`.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });
    const sub = interaction.options.getSubcommand();

    if (sub === 'default') {
      try {
        const { deckName, codes } = buildStarterDeck(player.investigator_code, starterDecks);
        initDeck(player, codes);
        updatePlayer(player.id, { deck_ready: 1, deck_name: deckName });
        await interaction.editReply(`✅ **${deckName}** loaded — ${codes.length} cards.`);
      } catch (err) {
        await interaction.editReply(`❌ ${err.message}`);
      }
      return;
    }

    if (sub === 'import') {
      const url = interaction.options.getString('url');
      try {
        const result = await importDeck(url, player.investigator_code);

        if (result.unknown.length > 0) {
          await interaction.followUp({
            content: `⚠️ ${result.unknown.length} card(s) not found in local data: \`${result.unknown.join(', ')}\`\nDeck was still loaded.`,
            flags: 64,
          });
        }

        initDeck(player, result.codes);
        updatePlayer(player.id, {
          deck_ready: 1,
          arkhamdb_deck_id: result.deckId,
          deck_name: result.deckName,
        });

        await interaction.editReply(`✅ **${result.deckName}** imported — ${result.codes.length} cards.`);
      } catch (err) {
        await interaction.editReply(`❌ ${err.message}`);
      }
    }
  },
};
