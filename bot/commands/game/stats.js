const { SlashCommandBuilder } = require('discord.js');
const { requireSession, getCampaign, getPlayers } = require('../../engine/gameState');
const { getEffectiveStat, getEffectiveActions, getEffectiveHandSize } = require('../../engine/cardEffectResolver');
const allInvestigators = require('../../data/investigators/investigators.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show investigator stats.')
    .addStringOption(opt =>
      opt.setName('investigator')
        .setDescription('Investigator name (default: yourself)')),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;

    const campaign = getCampaign();
    const players = getPlayers(campaign.id);

    const query = interaction.options.getString('investigator');
    let targets;

    if (query) {
      targets = players.filter(p => p.investigator_name?.toLowerCase().includes(query.toLowerCase()));
      if (targets.length === 0) {
        return interaction.reply({ content: `No investigator matching "${query}".`, flags: 64 });
      }
    } else {
      const me = players.find(p => p.discord_id === interaction.user.id);
      targets = me ? [me] : players;
    }

    const fmt = (base, eff) => eff !== base ? `${eff}*(${base}${eff > base ? '+' : ''}${eff - base})*` : `${base}`;

    const lines = targets.map(p => {
      const invData = allInvestigators.find(i => i.code === p.investigator_code);
      const skills = invData?.skills || {};
      const hand = JSON.parse(p.hand || '[]').length;
      const deck = JSON.parse(p.deck || '[]').length;
      const disc = JSON.parse(p.discard || '[]').length;

      let statLine = '';
      if (skills.willpower !== undefined) {
        const wEff = getEffectiveStat(p, 'willpower', {}, invData);
        const iEff = getEffectiveStat(p, 'intellect', {}, invData);
        const cEff = getEffectiveStat(p, 'combat', {}, invData);
        const aEff = getEffectiveStat(p, 'agility', {}, invData);
        statLine = `WIL:${fmt(skills.willpower, wEff)} INT:${fmt(skills.intellect, iEff)} COM:${fmt(skills.combat, cEff)} AGI:${fmt(skills.agility, aEff)}`;
      }
      const actionsMax = getEffectiveActions(p);
      const handMax = getEffectiveHandSize(p);

      return [
        `**${p.investigator_name || p.discord_name}**`,
        `HP: ${p.hp}/${p.max_hp} | SAN: ${p.sanity}/${p.max_sanity} | Resources: ${p.resources} | Clues: ${p.clues}`,
        `Hand: ${hand}/${handMax} | Deck: ${deck} | Discard: ${disc} | Actions/turn: ${actionsMax}`,
        statLine,
        `Location: ${p.location_code || '—'}`,
      ].filter(Boolean).join('\n');
    });

    await interaction.reply({ content: lines.join('\n\n'), flags: 64 });
  },
};
