const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getPlayer, getEnemy, updateEnemy } = require('../../engine/gameState');
const { drawToken, displayToken } = require('../../engine/chaosBag');
const { findCardByCode, getCardSkills } = require('../../engine/cardLookup');
const { commitCards } = require('../../engine/deck');
const { refreshHandDisplay } = require('../../engine/handDisplay');
const { getEffectiveStat } = require('../../engine/cardEffectResolver');
const { updateLocationStatus } = require('../../engine/locationManager');
const { getLocation } = require('../../engine/gameState');
const allInvestigators = require('../../data/investigators/investigators.json');

const SPECIAL_TOKENS = new Set(['skull', 'cultist', 'tablet', 'elder_thing', 'auto_fail', 'elder_sign']);
const STATS = ['agility', 'willpower', 'intellect', 'combat'];
const STAT_ICON = { agility: '💨', willpower: '🕯️', intellect: '🔎', combat: '⚔️' };
const STAT_SHORT = { agility: 'AGI', willpower: 'WIL', intellect: 'INT', combat: 'CMB' };

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
    .setName('evade')
    .setDescription('Evade an enemy. Tests Agility vs enemy Evade rating. Success exhausts the enemy.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(opt =>
      opt.setName('enemy_id')
        .setDescription('Enemy ID (from /enemy list)')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('stat')
        .setDescription('Stat to use (default: Agility)')
        .setRequired(false)
        .setAutocomplete(true))
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

    const chosenStat = interaction.options.getString('stat') || 'agility';
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

    const enemyId = interaction.options.getInteger('enemy_id');
    const enemy = getEnemy(enemyId);
    if (!enemy) return interaction.reply({ content: `❌ No enemy with ID ${enemyId}.`, flags: 64 });

    const statName = interaction.options.getString('stat') || 'agility';
    const codes = ['card1', 'card2', 'card3', 'card4'].map(n => interaction.options.getString(n)).filter(Boolean);

    const hand = JSON.parse(player.hand || '[]');
    const notInHand = codes.filter(c => !hand.includes(c));
    if (notInHand.length) return interaction.reply({ content: `❌ Not in your hand: ${notInHand.join(', ')}`, flags: 64 });

    await interaction.deferReply();

    const inv = allInvestigators.find(i => i.code === player.investigator_code);
    const statValue = getEffectiveStat(player, statName, {}, inv);
    const short = STAT_SHORT[statName] || statName.toUpperCase();
    const icon = STAT_ICON[statName] || '💨';

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
            await chaosCh.send({ content: `${icon} **${player.investigator_name}** commits **${result.card.name}** to Evade`, files: [att] });
          }
        }
      }
    }

    const evadeRating = enemy.evade;
    const token = drawToken(session.difficulty);
    const mod = tokenModifier(token);
    const isAutoFail = token === 'auto_fail';
    const isElderSign = token === 'elder_sign';

    const total = isAutoFail ? -Infinity : statValue + commitBonus + mod;
    const success = !isAutoFail && total >= evadeRating;

    const tokenLabel = displayToken(token);
    const specialNote = SPECIAL_TOKENS.has(token) && !isElderSign
      ? ' *(resolve scenario effect manually)*'
      : isElderSign ? ' *(apply your elder sign ability)*' : '';

    const statLabel = statName !== 'agility' ? ` *(using ${statName} via asset ability)*` : '';
    const parts = [`${statValue} (${short})`];
    if (commitBonus > 0) parts.push(`+${commitBonus} (commit)`);
    if (!isAutoFail) parts.push(`${mod >= 0 ? '+' : ''}${mod} (token)`);
    const mathLine = isAutoFail ? 'Auto-fail — evade fails'
      : `${parts.join(' ')} = **${total}** vs Evade **${evadeRating}**`;

    const lines = [
      `## 💨 Evade — ${enemy.name}${statLabel}`,
      `**${player.investigator_name}** | ${short}: ${statValue} | Enemy Evade: ${evadeRating}`,
    ];
    if (commitLines.length) { lines.push('**Committed:**'); lines.push(...commitLines); }
    lines.push(`**Token:** ${tokenLabel}${specialNote}`, `**Result:** ${mathLine}`, '');

    if (success) {
      updateEnemy(enemyId, { is_exhausted: 1 });
      const loc = getLocation(session.id, enemy.location_code);
      if (loc) await updateLocationStatus(interaction.guild, session, loc);
      lines.push(`✅ **Evaded!** **${enemy.name}** is now exhausted and disengaged.`);
    } else {
      lines.push(`❌ **Failed!** You couldn't evade **${enemy.name}**.`);
    }

    if (success && codes.length > 0) {
      const { resolveOnSuccess } = require('../../engine/cardEffectResolver');
      const { drawCards } = require('../../engine/deck');
      const { getPlayerById, updatePlayer } = require('../../engine/gameState');
      const onSuccess = resolveOnSuccess(codes);
      for (const eff of onSuccess) {
        if (eff.type === 'draw_cards') {
          const fresh = getPlayerById(player.id);
          drawCards(fresh, eff.count);
          lines.push(`🎴 **${player.investigator_name}** drew ${eff.count} card(s) from skill.`);
        } else if (eff.type === 'heal_horror') {
          const fresh = getPlayerById(player.id);
          const newSan = Math.min(fresh.max_sanity, fresh.sanity + eff.count);
          updatePlayer(player.id, { sanity: newSan });
          lines.push(`💚 Healed ${eff.count} horror.`);
        } else if (eff.type === 'discover_clues') {
          lines.push(`🔎 +${eff.count} clue from skill (resolve location adjustment manually).`);
        } else if (eff.type === 'bonus_damage_on_attack') {
          lines.push(`⚔️ +${eff.count} bonus damage on this attack (apply via /fight bonus_damage).`);
        }
      }
    }

    const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
    if (chaosCh) {
      await chaosCh.send(`💨 **${player.investigator_name}** evades **${enemy.name}** — token: ${tokenLabel} — ${success ? '✅ Evaded!' : '❌ Failed!'}`);
    }

    await interaction.editReply(lines.join('\n'));
  },
};

async function executeEvadeAction(interaction, player, session, enemyId, commitCodes = []) {
  const { getEnemy, getPlayerById, updateEnemy } = require('../../engine/gameState');
  const { drawToken, displayToken } = require('../../engine/chaosBag');
  const { findCardByCode, getCardSkills } = require('../../engine/cardLookup');
  const { commitCards } = require('../../engine/deck');
  const { refreshHandDisplay } = require('../../engine/handDisplay');
  const allInvestigators = require('../../data/investigators/investigators.json');

  const SPECIAL_TOKENS = new Set(['skull', 'cultist', 'tablet', 'elder_thing', 'auto_fail', 'elder_sign']);

  const enemy = getEnemy(enemyId);
  if (!enemy) {
    const msg = { content: `❌ No enemy with ID ${enemyId}.`, flags: 64 };
    return interaction.deferred || interaction.replied ? interaction.editReply(msg) : interaction.update(msg);
  }

  const statName = 'agility';
  const freshPlayer = getPlayerById(player.id);
  const inv = allInvestigators.find(i => i.code === freshPlayer.investigator_code);
  const statValue = getEffectiveStat(freshPlayer, statName, {}, inv);

  let commitBonus = 0;
  const commitLines = [];
  for (const code of commitCodes) {
    const skills = getCardSkills(code) || {};
    const contribution = (skills[statName] || 0) + (skills.wild || 0);
    commitBonus += contribution;
    const result = findCardByCode(code);
    const name = result?.card.name || code;
    const icons = [];
    if (skills[statName]) icons.push(`AGI×${skills[statName]}`);
    if (skills.wild) icons.push(`WILD×${skills.wild}`);
    commitLines.push(`  • **${name}** [${icons.join(' ')}] +${contribution}`);
  }

  if (commitCodes.length > 0) {
    commitCards(freshPlayer, commitCodes);
    await refreshHandDisplay(interaction.guild, freshPlayer);
  }

  const evadeRating = enemy.evade;
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
  const success = !isAutoFail && total >= evadeRating;
  const tokenLabel = displayToken(token);
  const specialNote = SPECIAL_TOKENS.has(token) && !isElderSign ? ' *(resolve scenario effect manually)*'
    : isElderSign ? ' *(apply your elder sign ability)*' : '';

  const parts = [`${statValue} (AGI)`];
  if (commitBonus > 0) parts.push(`+${commitBonus} (commit)`);
  if (!isAutoFail) parts.push(`${mod >= 0 ? '+' : ''}${mod} (token)`);
  const mathLine = isAutoFail ? 'Auto-fail — evade fails'
    : `${parts.join(' ')} = **${total}** vs Evade **${evadeRating}**`;

  const lines = [
    `## 💨 Evade — ${enemy.name}`,
    `**${freshPlayer.investigator_name}** | AGI: ${statValue} | Enemy Evade: ${evadeRating}`,
  ];
  if (commitLines.length) { lines.push('**Committed:**'); lines.push(...commitLines); }
  lines.push(`**Token:** ${tokenLabel}${specialNote}`, `**Result:** ${mathLine}`, '');

  if (success) {
    updateEnemy(enemyId, { is_exhausted: 1 });
    lines.push(`✅ **Success!** **${enemy.name}** is exhausted and disengaged.`);
  } else {
    lines.push('❌ **Fail.** Enemy stays engaged.');
  }

  const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
  if (chaosCh) await chaosCh.send(`💨 **${freshPlayer.investigator_name}** evades **${enemy.name}** — token: ${tokenLabel} — ${success ? '✅ Evaded!' : '❌ Fail'}`);

  const replyContent = { content: lines.join('\n'), components: [], flags: 64 };
  return interaction.deferred || interaction.replied ? interaction.editReply(replyContent) : interaction.update(replyContent);
}

module.exports.executeEvadeAction = executeEvadeAction;
