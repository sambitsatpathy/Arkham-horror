const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getPlayer } = require('../../engine/gameState');
const { drawToken, displayToken } = require('../../engine/chaosBag');
const { findCardByCode, getCardSkills } = require('../../engine/cardLookup');
const { commitCards } = require('../../engine/deck');
const { refreshHandDisplay } = require('../../engine/handDisplay');
const allInvestigators = require('../../data/investigators/investigators.json');

const STATS = ['willpower', 'intellect', 'combat', 'agility'];
const STAT_ICON = { willpower: '🕯️', intellect: '🔎', combat: '⚔️', agility: '💨' };
const STAT_SHORT = { willpower: 'WIL', intellect: 'INT', combat: 'CMB', agility: 'AGI' };
const SPECIAL_TOKENS = new Set(['skull', 'cultist', 'tablet', 'elder_thing', 'auto_fail', 'elder_sign']);

function tokenModifier(token) {
  if (token === 'auto_fail') return -Infinity;
  if (token === 'elder_sign') return 1;
  const n = parseInt(token, 10);
  return isNaN(n) ? 0 : n;
}

function makeCardOption(opt, num) {
  return opt
    .setName(`card${num}`)
    .setDescription(`Card ${num} to commit`)
    .setRequired(false)
    .setAutocomplete(true);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('test')
    .setDescription('Run a generic skill test (treachery, parley, etc.) against a set difficulty.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('stat')
        .setDescription('Skill to test')
        .setRequired(true)
        .setAutocomplete(true))
    .addIntegerOption(opt =>
      opt.setName('difficulty')
        .setDescription('Target number to meet or beat')
        .setRequired(true)
        .setMinValue(0))
    .addStringOption(opt => makeCardOption(opt, 1))
    .addStringOption(opt => makeCardOption(opt, 2))
    .addStringOption(opt => makeCardOption(opt, 3))
    .addStringOption(opt => makeCardOption(opt, 4)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);

    if (focused.name === 'stat') {
      const player = getPlayer(interaction.user.id);
      const inv = player
        ? allInvestigators.find(i => i.code === player.investigator_code)
        : null;

      const query = focused.value.toLowerCase();
      const choices = STATS
        .filter(s => !query || s.includes(query))
        .map(s => ({
          name: inv
            ? `${STAT_ICON[s]} ${s.charAt(0).toUpperCase() + s.slice(1)} (${inv.skills?.[s] ?? 0})`
            : `${STAT_ICON[s]} ${s.charAt(0).toUpperCase() + s.slice(1)}`,
          value: s,
        }));
      return interaction.respond(choices);
    }

    // Card autocomplete — show cards whose icons match the chosen stat or wild
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.respond([]);

    const chosenStat = interaction.options.getString('stat');
    const hand = JSON.parse(player.hand || '[]');
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
        if (!result) return [];
        const skills = getCardSkills(code);
        const icons = [];
        if (chosenStat && skills[chosenStat]) icons.push(`${STAT_SHORT[chosenStat]}×${skills[chosenStat]}`);
        if (skills.wild) icons.push(`WILD×${skills.wild}`);
        if (!icons.length) return [];
        const label = `${result.card.name} [${icons.join(' ')}]`;
        if (query && !label.toLowerCase().includes(query)) return [];
        return [{ name: label, value: code }];
      })
      .slice(0, 25);

    return interaction.respond(choices);
  },

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const statName = interaction.options.getString('stat');
    if (!STATS.includes(statName)) {
      return interaction.reply({ content: `❌ Unknown stat \`${statName}\`. Choose: ${STATS.join(', ')}`, flags: 64 });
    }

    const difficulty = interaction.options.getInteger('difficulty');
    const codes = ['card1', 'card2', 'card3', 'card4']
      .map(n => interaction.options.getString(n))
      .filter(Boolean);

    const hand = JSON.parse(player.hand || '[]');
    const notInHand = codes.filter(c => !hand.includes(c));
    if (notInHand.length) {
      return interaction.reply({ content: `❌ Not in your hand: ${notInHand.join(', ')}`, flags: 64 });
    }

    await interaction.deferReply();

    const inv = allInvestigators.find(i => i.code === player.investigator_code);
    const statValue = inv?.skills?.[statName] ?? 0;

    // Commit bonus
    let commitBonus = 0;
    const commitLines = [];
    for (const code of codes) {
      const skills = getCardSkills(code);
      const contribution = (skills[statName] || 0) + (skills.wild || 0);
      commitBonus += contribution;
      const result = findCardByCode(code);
      const name = result?.card.name || code;
      const icons = [];
      if (skills[statName]) icons.push(`${STAT_SHORT[statName]}×${skills[statName]}`);
      if (skills.wild) icons.push(`WILD×${skills.wild}`);
      commitLines.push(`  • **${name}** ${icons.length ? `[${icons.join(' ')}] +${contribution}` : '(no matching icons)'}`);
    }

    if (codes.length > 0) { commitCards(player, codes); await refreshHandDisplay(interaction.guild, player); }

    // Post committed card images to chaos channel
    if (codes.length > 0) {
      const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
      if (chaosCh) {
        for (const code of codes) {
          const result = findCardByCode(code);
          if (result?.imagePath) {
            const att = new AttachmentBuilder(result.imagePath, { name: 'card.png' });
            await chaosCh.send({ content: `${STAT_ICON[statName]} **${player.investigator_name}** commits **${result.card.name}** to ${statName} test`, files: [att] });
          }
        }
      }
    }

    const token = drawToken(session.difficulty);
    const mod = tokenModifier(token);
    const isAutoFail = token === 'auto_fail';
    const isElderSign = token === 'elder_sign';

    const total = isAutoFail ? -Infinity : statValue + commitBonus + mod;
    const success = !isAutoFail && total >= difficulty;

    const tokenLabel = displayToken(token);
    const specialNote = SPECIAL_TOKENS.has(token) && !isElderSign
      ? ' *(resolve scenario effect manually)*'
      : isElderSign ? ' *(apply your elder sign ability)*' : '';

    const parts = [`${statValue} (${STAT_SHORT[statName]})`];
    if (commitBonus > 0) parts.push(`+${commitBonus} (commit)`);
    if (!isAutoFail) parts.push(`${mod >= 0 ? '+' : ''}${mod} (token)`);
    const mathLine = isAutoFail
      ? 'Auto-fail — test fails'
      : `${parts.join(' ')} = **${total}** vs difficulty **${difficulty}**`;

    const label = `${STAT_ICON[statName]} ${statName.charAt(0).toUpperCase() + statName.slice(1)} Test`;
    const lines = [
      `## ${label}`,
      `**${player.investigator_name}** | ${STAT_SHORT[statName]}: ${statValue} | Difficulty: ${difficulty}`,
    ];
    if (commitLines.length) { lines.push('**Committed:**'); lines.push(...commitLines); }
    lines.push(
      `**Token:** ${tokenLabel}${specialNote}`,
      `**Result:** ${mathLine}`,
      '',
      isAutoFail ? '❌ **Auto-fail!**' : success ? '✅ **Passed!**' : '❌ **Failed.**',
    );

    const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
    if (chaosCh) {
      await chaosCh.send(`${STAT_ICON[statName]} **${player.investigator_name}** ${statName} test (diff ${difficulty}) — token: ${tokenLabel} — ${success ? '✅ Passed!' : '❌ Failed.'}`);
    }

    await interaction.editReply(lines.join('\n'));
  },
};

async function executeTestAction(interaction, player, session, stat, difficulty, commitCodes = []) {
  const { getPlayerById } = require('../../engine/gameState');
  const { drawToken, displayToken } = require('../../engine/chaosBag');
  const { findCardByCode, getCardSkills } = require('../../engine/cardLookup');
  const { commitCards } = require('../../engine/deck');
  const { refreshHandDisplay } = require('../../engine/handDisplay');
  const allInvestigators = require('../../data/investigators/investigators.json');

  const SPECIAL_TOKENS = new Set(['skull', 'cultist', 'tablet', 'elder_thing', 'auto_fail', 'elder_sign']);
  const STAT_SHORT = { combat: 'CMB', willpower: 'WIL', intellect: 'INT', agility: 'AGI' };
  const STAT_ICON_MAP = { combat: '⚔️', willpower: '🕯️', intellect: '🔎', agility: '💨' };

  const freshPlayer = getPlayerById(player.id);
  const inv = allInvestigators.find(i => i.code === freshPlayer.investigator_code);
  const statValue = inv?.skills?.[stat] ?? 0;
  const short = STAT_SHORT[stat] || stat.toUpperCase();
  const icon = STAT_ICON_MAP[stat] || '🎲';

  let commitBonus = 0;
  const commitLines = [];
  for (const code of commitCodes) {
    const skills = getCardSkills(code) || {};
    const contribution = (skills[stat] || 0) + (skills.wild || 0);
    commitBonus += contribution;
    const result = findCardByCode(code);
    const name = result?.card.name || code;
    const icons = [];
    if (skills[stat]) icons.push(`${short}×${skills[stat]}`);
    if (skills.wild) icons.push(`WILD×${skills.wild}`);
    commitLines.push(`  • **${name}** [${icons.join(' ')}] +${contribution}`);
  }

  if (commitCodes.length > 0) {
    commitCards(freshPlayer, commitCodes);
    await refreshHandDisplay(interaction.guild, freshPlayer);
  }

  const token = drawToken(session.difficulty);
  function tokenModifier(t) {
    if (t === 'auto_fail') return -Infinity;
    if (t === 'elder_sign') return 1;
    const n = parseInt(t, 10); return isNaN(n) ? 0 : n;
  }
  const mod = tokenModifier(token);
  const isAutoFail = token === 'auto_fail';
  const isElderSign = token === 'elder_sign';
  const total = isAutoFail ? -Infinity : statValue + commitBonus + mod;
  const success = !isAutoFail && total >= difficulty;
  const tokenLabel = displayToken(token);
  const specialNote = SPECIAL_TOKENS.has(token) && !isElderSign ? ' *(resolve scenario effect manually)*'
    : isElderSign ? ' *(apply your elder sign ability)*' : '';

  const parts = [`${statValue} (${short})`];
  if (commitBonus > 0) parts.push(`+${commitBonus} (commit)`);
  if (!isAutoFail) parts.push(`${mod >= 0 ? '+' : ''}${mod} (token)`);
  const mathLine = isAutoFail ? 'Auto-fail' : `${parts.join(' ')} = **${total}** vs **${difficulty}**`;

  const lines = [
    `## 🎲 Skill Test — ${stat} vs ${difficulty}`,
    `**${freshPlayer.investigator_name}** | ${short}: ${statValue}`,
  ];
  if (commitLines.length) { lines.push('**Committed:**'); lines.push(...commitLines); }
  lines.push(`**Token:** ${tokenLabel}${specialNote}`, `**Result:** ${mathLine}`, '');
  lines.push(success ? '✅ **Success!**' : '❌ **Fail.**');

  const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
  if (chaosCh) await chaosCh.send(`🎲 **${freshPlayer.investigator_name}** tests ${stat} vs ${difficulty} — token: ${tokenLabel} — ${success ? '✅' : '❌'}`);

  const replyContent = { content: lines.join('\n'), components: [], flags: 64 };
  if (interaction.update) return interaction.update(replyContent);
  if (interaction.deferred || interaction.replied) return interaction.editReply(replyContent);
  return interaction.reply(replyContent);
}

module.exports.executeTestAction = executeTestAction;
