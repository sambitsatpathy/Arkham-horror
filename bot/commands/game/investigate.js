const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { requireSession, requirePlayer, getPlayer, getLocation, updateLocation, updatePlayer } = require('../../engine/gameState');
const { drawToken, displayToken } = require('../../engine/chaosBag');
const { updateLocationStatus } = require('../../engine/locationManager');
const { findCardByCode, getCardSkills } = require('../../engine/cardLookup');
const { commitCards } = require('../../engine/deck');
const { refreshHandDisplay } = require('../../engine/handDisplay');
const allInvestigators = require('../../data/investigators/investigators.json');

const SPECIAL_TOKENS = new Set(['skull', 'cultist', 'tablet', 'elder_thing', 'auto_fail', 'elder_sign']);
const STATS = ['intellect', 'willpower', 'combat', 'agility'];
const STAT_ICON = { intellect: '🔎', willpower: '🕯️', combat: '⚔️', agility: '💨' };
const STAT_SHORT = { intellect: 'INT', willpower: 'WIL', combat: 'CMB', agility: 'AGI' };

function tokenModifier(token) {
  if (token === 'auto_fail') return -Infinity;
  if (token === 'elder_sign') return 1;
  const n = parseInt(token, 10);
  return isNaN(n) ? 0 : n;
}

function makeCardOption(opt, num) {
  return opt.setName(`card${num}`).setDescription(`Card ${num} to commit`).setRequired(false).setAutocomplete(true);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('investigate')
    .setDescription('Investigate your current location.')
    .addStringOption(opt =>
      opt.setName('stat')
        .setDescription('Stat to use (default: Intellect)')
        .setRequired(false)
        .setAutocomplete(true))
    .addIntegerOption(opt =>
      opt.setName('bonus_clues')
        .setDescription('Extra clues collected on success (from an asset ability)')
        .setMinValue(1)
        .setRequired(false))
    .addStringOption(opt => makeCardOption(opt, 1))
    .addStringOption(opt => makeCardOption(opt, 2))
    .addStringOption(opt => makeCardOption(opt, 3))
    .addStringOption(opt => makeCardOption(opt, 4)),

  async autocomplete(interaction) {
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.respond([]);

    const focused = interaction.options.getFocused(true);

    if (focused.name === 'stat') {
      const inv = allInvestigators.find(i => i.code === player.investigator_code);
      const query = focused.value.toLowerCase();
      return interaction.respond(
        STATS.filter(s => !query || s.includes(query)).map(s => ({
          name: `${STAT_ICON[s]} ${s.charAt(0).toUpperCase() + s.slice(1)}${inv ? ` (${inv.skills?.[s] ?? 0})` : ''}`,
          value: s,
        }))
      );
    }

    const chosenStat = interaction.options.getString('stat') || 'intellect';
    const hand = JSON.parse(player.hand || '[]');
    const query = focused.value.toLowerCase();
    const chosen = new Set(
      ['card1', 'card2', 'card3', 'card4'].filter(n => n !== focused.name)
        .map(n => interaction.options.getString(n)).filter(Boolean)
    );

    const choices = hand.filter(code => !chosen.has(code)).flatMap(code => {
      const result = findCardByCode(code);
      if (!result) return [];
      const skills = getCardSkills(code);
      const icons = [];
      if (skills[chosenStat]) icons.push(`${STAT_SHORT[chosenStat]}×${skills[chosenStat]}`);
      if (skills.wild) icons.push(`WILD×${skills.wild}`);
      if (!icons.length) return [];
      const label = `${result.card.name} [${icons.join(' ')}]`;
      if (query && !label.toLowerCase().includes(query)) return [];
      return [{ name: label, value: code }];
    }).slice(0, 25);

    await interaction.respond(choices);
  },

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    if (!player.location_code) {
      return interaction.reply({ content: '❌ You have no current location set.', flags: 64 });
    }

    const loc = getLocation(session.id, player.location_code);
    if (!loc) {
      return interaction.reply({ content: `❌ Location "${player.location_code}" not found in this session.`, flags: 64 });
    }
    if (loc.status === 'hidden') {
      return interaction.reply({ content: `❌ **${loc.name}** is not yet revealed.`, flags: 64 });
    }
    if (loc.clues <= 0) {
      return interaction.reply({ content: `ℹ️ **${loc.name}** has no clues to collect.`, flags: 64 });
    }

    const statName = interaction.options.getString('stat') || 'intellect';
    const bonusClues = interaction.options.getInteger('bonus_clues') ?? 0;
    const codes = ['card1', 'card2', 'card3', 'card4'].map(n => interaction.options.getString(n)).filter(Boolean);

    const hand = JSON.parse(player.hand || '[]');
    const notInHand = codes.filter(c => !hand.includes(c)).map(c => findCardByCode(c)?.card.name || c);
    if (notInHand.length) {
      return interaction.reply({ content: `❌ Not in your hand: **${notInHand.join(', ')}**`, flags: 64 });
    }

    await interaction.deferReply();

    const inv = allInvestigators.find(i => i.code === player.investigator_code);
    const statValue = inv?.skills?.[statName] ?? 0;
    const short = STAT_SHORT[statName] || statName.toUpperCase();
    const icon = STAT_ICON[statName] || '🔍';

    let commitBonus = 0;
    const commitLines = [];
    for (const code of codes) {
      const skills = getCardSkills(code);
      const contribution = (skills[statName] || 0) + (skills.wild || 0);
      commitBonus += contribution;
      const result = findCardByCode(code);
      const name = result?.card.name || code;
      const icons = [];
      if (skills[statName]) icons.push(`${short}×${skills[statName]}`);
      if (skills.wild) icons.push(`WILD×${skills.wild}`);
      commitLines.push(`  • **${name}** ${icons.length ? `[${icons.join(' ')}] +${contribution}` : '(no matching icons)'}`);
    }

    if (codes.length > 0) { commitCards(player, codes); await refreshHandDisplay(interaction.guild, player); }

    if (codes.length > 0) {
      const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
      if (chaosCh) {
        for (const code of codes) {
          const result = findCardByCode(code);
          if (result?.imagePath) {
            const att = new AttachmentBuilder(result.imagePath, { name: 'card.png' });
            await chaosCh.send({ content: `${icon} **${player.investigator_name}** commits **${result.card.name}** to Investigate`, files: [att] });
          }
        }
      }
    }

    const shroud = loc.shroud ?? 0;
    const token = drawToken(session.difficulty);
    const mod = tokenModifier(token);
    const isAutoFail = token === 'auto_fail';
    const isElderSign = token === 'elder_sign';

    const total = isAutoFail ? -Infinity : statValue + commitBonus + mod;
    const success = !isAutoFail && total >= shroud;

    const tokenLabel = displayToken(token);
    const specialNote = SPECIAL_TOKENS.has(token) && !isElderSign
      ? ' *(resolve scenario effect manually)*'
      : isElderSign ? ' *(apply your elder sign ability)*' : '';

    let clueNote = '';
    if (success) {
      const freshPlayer = getPlayer(interaction.user.id);
      const cluesCollected = Math.min(1 + bonusClues, loc.clues);
      const newLocClues = loc.clues - cluesCollected;
      updateLocation(loc.id, { clues: newLocClues });
      updatePlayer(freshPlayer.id, { clues: freshPlayer.clues + cluesCollected });
      const refreshed = getLocation(session.id, loc.code);
      await updateLocationStatus(interaction.guild, session, refreshed);
      const bonusNote = bonusClues > 0 ? ` *(+${bonusClues} from asset)*` : '';
      clueNote = `🔎 **${cluesCollected} clue${cluesCollected !== 1 ? 's' : ''} collected**${bonusNote}! You now have **${freshPlayer.clues + cluesCollected}**. **${loc.name}** has **${newLocClues}** remaining.`;
    }

    const statLabel = statName !== 'intellect' ? ` *(using ${statName} via asset ability)*` : '';
    const parts = [`${statValue} (${short})`];
    if (commitBonus > 0) parts.push(`+${commitBonus} (commit)`);
    if (!isAutoFail) parts.push(`${mod >= 0 ? '+' : ''}${mod} (token)`);
    const mathLine = isAutoFail ? 'Auto-fail — test fails regardless'
      : `${parts.join(' ')} = **${total}** vs shroud **${shroud}**`;

    const lines = [
      `## 🔍 Investigate — ${loc.name}${statLabel}`,
      `**${player.investigator_name}** | ${short}: ${statValue} | Shroud: ${shroud}`,
    ];
    if (commitLines.length) { lines.push('**Committed:**'); lines.push(...commitLines); }
    lines.push(`**Token:** ${tokenLabel}${specialNote}`, `**Result:** ${mathLine}`, '',
      isAutoFail ? '❌ **Auto-fail!**' : success ? '✅ **Success!**' : '❌ **Failed.**');
    if (clueNote) lines.push(clueNote);

    await interaction.editReply(lines.join('\n'));
  },
};
