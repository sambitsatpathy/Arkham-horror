const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { requireSession, requirePlayer, getPlayer, getEnemy, getEnemiesAt } = require('../../engine/gameState');
const { drawToken, displayToken } = require('../../engine/chaosBag');
const { damageEnemy, defeatEnemy } = require('../../engine/enemyEngine');
const { updateLocationStatus } = require('../../engine/locationManager');
const { findCardByCode, getCardSkills } = require('../../engine/cardLookup');
const { commitCards } = require('../../engine/deck');
const { getLocation } = require('../../engine/gameState');
const allInvestigators = require('../../data/investigators/investigators.json');

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
    .setDescription(`Card ${num} to commit to this fight`)
    .setRequired(false)
    .setAutocomplete(true);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fight')
    .setDescription('Fight an enemy. Tests Combat vs enemy Fight rating.')
    .addIntegerOption(opt =>
      opt.setName('enemy_id')
        .setDescription('Enemy ID (from /enemy list)')
        .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('damage')
        .setDescription('Damage to deal on success (default: 1)')
        .setMinValue(1))
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
        if (!result) return [];
        const { card } = result;
        const skills = getCardSkills(code);
        const icons = [];
        if (skills.combat) icons.push(`CMB×${skills.combat}`);
        if (skills.wild) icons.push(`WILD×${skills.wild}`);
        if (!skills.combat && !skills.wild) return [];
        const label = `${card.name} [${icons.join(' ')}]`;
        if (!query || label.toLowerCase().includes(query)) {
          return [{ name: label, value: code }];
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

    const enemyId = interaction.options.getInteger('enemy_id');
    const enemy = getEnemy(enemyId);
    if (!enemy) {
      return interaction.reply({ content: `❌ No enemy with ID ${enemyId}.`, flags: 64 });
    }

    const codes = ['card1', 'card2', 'card3', 'card4']
      .map(n => interaction.options.getString(n))
      .filter(Boolean);

    const hand = JSON.parse(player.hand || '[]');
    const notInHand = codes.filter(c => !hand.includes(c));
    if (notInHand.length) {
      return interaction.reply({ content: `❌ Not in your hand: ${notInHand.join(', ')}`, flags: 64 });
    }

    await interaction.deferReply();

    // Calculate commit bonus from combat + wild icons
    let commitBonus = 0;
    const commitLines = [];
    for (const code of codes) {
      const skills = getCardSkills(code);
      const contribution = (skills.combat || 0) + (skills.wild || 0);
      commitBonus += contribution;
      const result = findCardByCode(code);
      const name = result?.card.name || code;
      const icons = [];
      if (skills.combat) icons.push(`CMB×${skills.combat}`);
      if (skills.wild) icons.push(`WILD×${skills.wild}`);
      commitLines.push(`  • **${name}** ${icons.length ? `[${icons.join(' ')}] +${contribution}` : '(no matching icons)'}`);
    }

    if (codes.length > 0) commitCards(player, codes);

    // Post committed card images to chaos channel
    if (codes.length > 0) {
      const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
      if (chaosCh) {
        for (const code of codes) {
          const result = findCardByCode(code);
          if (result?.imagePath) {
            const att = new AttachmentBuilder(result.imagePath, { name: 'card.png' });
            await chaosCh.send({ content: `⚔️ **${player.investigator_name}** commits **${result.card.name}** to Fight`, files: [att] });
          }
        }
      }
    }

    const inv = allInvestigators.find(i => i.code === player.investigator_code);
    const combat = inv?.skills?.combat ?? 0;
    const fightRating = enemy.fight;

    const token = drawToken(session.difficulty);
    const mod = tokenModifier(token);
    const isAutoFail = token === 'auto_fail';
    const isElderSign = token === 'elder_sign';

    const total = isAutoFail ? -Infinity : combat + commitBonus + mod;
    const success = !isAutoFail && total >= fightRating;

    const tokenLabel = displayToken(token);
    const specialNote = SPECIAL_TOKENS.has(token) && !isElderSign
      ? ' *(resolve scenario effect manually)*'
      : isElderSign ? ' *(apply your elder sign ability)*' : '';

    const parts = [`${combat} (CMB)`];
    if (commitBonus > 0) parts.push(`+${commitBonus} (commit)`);
    if (!isAutoFail) parts.push(`${mod >= 0 ? '+' : ''}${mod} (token)`);
    const mathLine = isAutoFail
      ? 'Auto-fail — attack misses'
      : `${parts.join(' ')} = **${total}** vs Fight **${fightRating}**`;

    const lines = [
      `## ⚔️ Fight — ${enemy.name}`,
      `**${player.investigator_name}** | Combat: ${combat} | Enemy Fight: ${fightRating}`,
    ];
    if (commitLines.length) { lines.push('**Committed:**'); lines.push(...commitLines); }
    lines.push(
      `**Token:** ${tokenLabel}${specialNote}`,
      `**Result:** ${mathLine}`,
      '',
    );

    if (success) {
      const dmg = interaction.options.getInteger('damage') ?? 1;
      const newHp = damageEnemy(enemy, dmg);
      if (newHp === 0) {
        defeatEnemy(enemyId);
        const loc = getLocation(session.id, enemy.location_code);
        if (loc) await updateLocationStatus(interaction.guild, session, loc);
        lines.push(`✅ **Hit!** Dealt ${dmg} damage — **${enemy.name}** is defeated! 💀`);
      } else {
        const loc = getLocation(session.id, enemy.location_code);
        if (loc) await updateLocationStatus(interaction.guild, session, loc);
        lines.push(`✅ **Hit!** Dealt ${dmg} damage — ${enemy.name} HP: **${newHp}/${enemy.max_hp}**`);
      }
    } else {
      lines.push(`❌ **Miss!** The attack fails.`);
    }

    // Post to chaos channel as well
    const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
    if (chaosCh) {
      await chaosCh.send(`⚔️ **${player.investigator_name}** fights **${enemy.name}** — token: ${tokenLabel} — ${success ? '✅ Hit!' : '❌ Miss!'}`);
    }

    await interaction.editReply(lines.join('\n'));
  },
};
