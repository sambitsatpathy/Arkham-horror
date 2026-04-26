const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { requireSession, requirePlayer, getPlayer } = require('../../engine/gameState');
const { commitCard } = require('../../engine/deck');
const { findCardByCode } = require('../../engine/cardLookup');

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

    // Exclude cards already chosen in other slots
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
    const committed = [];
    const notInHand = [];

    for (const code of codes) {
      if (!hand.includes(code)) {
        const r = findCardByCode(code);
        notInHand.push(r?.card.name || code);
      } else {
        committed.push(code);
      }
    }

    if (notInHand.length > 0) {
      return interaction.reply({
        content: `These cards are not in your hand: **${notInHand.join(', ')}**`,
        flags: 64,
      });
    }

    await interaction.deferReply({ flags: 64 });

    // Post to chaos-bag channel so the table can see what's committed
    const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
    const target = chaosCh || interaction.channel;

    const names = [];
    for (const code of committed) {
      // Fetch fresh player state each time since commitCard mutates it
      const fresh = getPlayer(interaction.user.id);
      commitCard(fresh, code);

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

    await interaction.editReply(`✅ Committed ${names.map(n => `**${n}**`).join(', ')} to the skill test — moved to discard.`);
  },
};
