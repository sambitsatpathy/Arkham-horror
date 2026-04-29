const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getPlayer } = require('../../engine/gameState');
const { commitCards } = require('../../engine/deck');
const { findCardByCode } = require('../../engine/cardLookup');
const { refreshHandDisplay } = require('../../engine/handDisplay');

function makeCardOption(opt, num) {
  return opt
    .setName(`card${num}`)
    .setDescription(`Card ${num} to commit`)
    .setRequired(num === 1)
    .setAutocomplete(true);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('commit')
    .setDescription('Commit cards from your hand to a skill test (they go to discard after).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt => makeCardOption(opt, 1))
    .addStringOption(opt => makeCardOption(opt, 2))
    .addStringOption(opt => makeCardOption(opt, 3))
    .addStringOption(opt => makeCardOption(opt, 4)),

  async autocomplete(interaction) {
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.respond([]);

    const hand = JSON.parse(player.hand || '[]');
    const focused = interaction.options.getFocused(true);
    const query = focused.value.toLowerCase();

    const chosen = new Set(
      ['card1', 'card2', 'card3', 'card4']
        .filter(n => n !== focused.name)
        .map(n => interaction.options.getString(n))
        .filter(Boolean)
    );

    const choices = hand
      .filter(code => !chosen.has(code))
      .flatMap(code => {
        const result = findCardByCode(code);
        const name = result?.card.name || code;
        if (!query || name.toLowerCase().includes(query)) {
          return [{ name, value: code }];
        }
        return [];
      })
      .slice(0, 25);

    await interaction.respond(choices);
  },

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const codes = ['card1', 'card2', 'card3', 'card4']
      .map(n => interaction.options.getString(n))
      .filter(Boolean);

    const hand = JSON.parse(player.hand || '[]');
    const notInHand = codes.filter(c => !hand.includes(c)).map(c => findCardByCode(c)?.card.name || c);
    if (notInHand.length > 0) {
      return interaction.reply({ content: `These cards are not in your hand: **${notInHand.join(', ')}**`, flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    // Single DB write for all committed cards
    commitCards(player, codes);

    const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
    const target = chaosCh || interaction.channel;

    const names = [];
    for (const code of codes) {
      const result = findCardByCode(code);
      const name = result?.card.name || code;
      names.push(name);

      if (result?.imagePath) {
        const att = new AttachmentBuilder(result.imagePath, { name: 'card.png' });
        await target.send({ content: `🎯 **${player.investigator_name}** commits **${name}**`, files: [att] });
      } else {
        await target.send(`🎯 **${player.investigator_name}** commits **${name}**`);
      }
    }

    await refreshHandDisplay(interaction.guild, player);
    await interaction.editReply(`✅ Committed ${names.map(n => `**${n}**`).join(', ')} to the skill test — moved to discard.`);
  },
};
