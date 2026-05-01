const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getPlayer, getLocation, updateLocation, updatePlayer } = require('../../engine/gameState');
const { drawToken, displayToken } = require('../../engine/chaosBag');
const { updateLocationStatus } = require('../../engine/locationManager');
const { findCardByCode, getCardSkills } = require('../../engine/cardLookup');
const { commitCards } = require('../../engine/deck');
const { refreshHandDisplay } = require('../../engine/handDisplay');
const { getEffectiveStat } = require('../../engine/cardEffectResolver');
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
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
    const statValue = getEffectiveStat(player, statName, { investigating: true }, inv);
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

    if (success) {
      const { fireTriggers } = require('../../engine/cardEffectResolver');
      const { execEffect } = require('../../engine/effectExecutors');
      const trigs = fireTriggers(player, 'after_successful_investigate');
      for (const trig of trigs) {
        for (const eff of trig.effects) {
          lines.push(`↪ from **${trig.source_name}**: ` + (await execEffect(eff, { player, session, guild: interaction.guild })));
        }
      }
    }

    await interaction.editReply(lines.join('\n'));
  },
};

async function executeInvestigateAction(interaction, player, session, commitCodes = []) {
  const { getLocation, updateLocation, updatePlayer, getPlayerById } = require('../../engine/gameState');
  const { drawToken, displayToken } = require('../../engine/chaosBag');
  const { updateLocationStatus } = require('../../engine/locationManager');
  const { findCardByCode, getCardSkills } = require('../../engine/cardLookup');
  const { commitCards } = require('../../engine/deck');
  const { refreshHandDisplay } = require('../../engine/handDisplay');
  const { AttachmentBuilder } = require('discord.js');
  const allInvestigators = require('../../data/investigators/investigators.json');

  const SPECIAL_TOKENS = new Set(['skull', 'cultist', 'tablet', 'elder_thing', 'auto_fail', 'elder_sign']);
  const STAT_SHORT = { intellect: 'INT', willpower: 'WIL', combat: 'CMB', agility: 'AGI' };
  const STAT_ICON = { intellect: '🔎', willpower: '🕯️', combat: '⚔️', agility: '💨' };

  const statName = 'intellect';
  const codes = commitCodes;

  const loc = getLocation(session.id, player.location_code);
  if (!loc || loc.status === 'hidden') {
    const msg = { content: '❌ Your current location is hidden or invalid.', flags: 64 };
    return interaction.deferred || interaction.replied ? interaction.editReply(msg) : interaction.update(msg);
  }

  const freshPlayer = getPlayerById(player.id);
  const hand = JSON.parse(freshPlayer.hand || '[]');
  const notInHand = codes.filter(c => !hand.includes(c));
  if (notInHand.length) {
    const msg = { content: `❌ Not in your hand: ${notInHand.join(', ')}`, flags: 64 };
    return interaction.deferred || interaction.replied ? interaction.editReply(msg) : interaction.update(msg);
  }

  const inv = allInvestigators.find(i => i.code === freshPlayer.investigator_code);
  const statValue = getEffectiveStat(freshPlayer, statName, { investigating: true }, inv);
  const short = STAT_SHORT[statName];
  const icon = STAT_ICON[statName];

  let commitBonus = 0;
  const commitLines = [];
  for (const code of codes) {
    const skills = getCardSkills(code) || {};
    const contribution = (skills[statName] || 0) + (skills.wild || 0);
    commitBonus += contribution;
    const result = findCardByCode(code);
    const name = result?.card.name || code;
    const icons = [];
    if (skills[statName]) icons.push(`${short}×${skills[statName]}`);
    if (skills.wild) icons.push(`WILD×${skills.wild}`);
    commitLines.push(`  • **${name}** [${icons.join(' ')}] +${contribution}`);
  }

  if (codes.length > 0) {
    commitCards(freshPlayer, codes);
    await refreshHandDisplay(interaction.guild, freshPlayer);
    const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
    if (chaosCh) {
      for (const code of codes) {
        const result = findCardByCode(code);
        if (result?.imagePath) {
          const att = new AttachmentBuilder(result.imagePath, { name: 'card.png' });
          await chaosCh.send({ content: `${icon} **${freshPlayer.investigator_name}** commits **${result.card.name}** to Investigate`, files: [att] });
        }
      }
    }
  }

  const shroud = loc.shroud;
  const token = drawToken(session.difficulty);

  function tokenModifier(t) {
    if (t === 'auto_fail') return -Infinity;
    if (t === 'elder_sign') return 1;
    const n = parseInt(t, 10);
    return isNaN(n) ? 0 : n;
  }

  const mod = tokenModifier(token);
  const isAutoFail = token === 'auto_fail';
  const isElderSign = token === 'elder_sign';
  const total = isAutoFail ? -Infinity : statValue + commitBonus + mod;
  const success = !isAutoFail && total >= shroud;

  const tokenLabel = displayToken(token);
  const specialNote = SPECIAL_TOKENS.has(token) && !isElderSign ? ' *(resolve scenario effect manually)*'
    : isElderSign ? ' *(apply your elder sign ability)*' : '';

  const parts = [`${statValue} (${short})`];
  if (commitBonus > 0) parts.push(`+${commitBonus} (commit)`);
  if (!isAutoFail) parts.push(`${mod >= 0 ? '+' : ''}${mod} (token)`);
  const mathLine = isAutoFail ? 'Auto-fail — investigation fails'
    : `${parts.join(' ')} = **${total}** vs Shroud **${shroud}**`;

  const lines = [
    `## 🔎 Investigate — ${loc.name}`,
    `**${freshPlayer.investigator_name}** | ${short}: ${statValue} | Shroud: ${shroud}`,
  ];
  if (commitLines.length) { lines.push('**Committed:**'); lines.push(...commitLines); }
  lines.push(`**Token:** ${tokenLabel}${specialNote}`, `**Result:** ${mathLine}`, '');

  let cluesGained = 0;
  if (success) {
    cluesGained = 1;
    const newClues = loc.clues - 1;
    updateLocation(loc.id, { clues: Math.max(0, newClues) });
    updatePlayer(freshPlayer.id, { clues: freshPlayer.clues + cluesGained });
    const updatedLoc = { ...loc, clues: Math.max(0, newClues) };
    await updateLocationStatus(interaction.guild, session, updatedLoc);
    lines.push(`✅ **Success!** Collected ${cluesGained} clue. Location clues: ${Math.max(0, newClues)}`);
  } else {
    lines.push('❌ **Fail.** No clue collected.');
  }

  if (success && codes.length > 0) {
    const { resolveOnSuccess } = require('../../engine/cardEffectResolver');
    const { drawCards } = require('../../engine/deck');
    const onSuccess = resolveOnSuccess(codes);
    for (const eff of onSuccess) {
      if (eff.type === 'draw_cards') {
        const fresh = getPlayerById(freshPlayer.id);
        drawCards(fresh, eff.count);
        lines.push(`🎴 **${freshPlayer.investigator_name}** drew ${eff.count} card(s) from skill.`);
      } else if (eff.type === 'heal_horror') {
        const fresh = getPlayerById(freshPlayer.id);
        const newSan = Math.min(fresh.max_sanity, fresh.sanity + eff.count);
        updatePlayer(freshPlayer.id, { sanity: newSan });
        lines.push(`💚 Healed ${eff.count} horror.`);
      } else if (eff.type === 'discover_clues') {
        lines.push(`🔎 +${eff.count} clue from skill (resolve location adjustment manually).`);
      } else if (eff.type === 'bonus_damage_on_attack') {
        lines.push(`⚔️ +${eff.count} bonus damage on this attack (apply via /fight bonus_damage).`);
      }
    }
  }

  if (success) {
    const { fireTriggers } = require('../../engine/cardEffectResolver');
    const { execEffect } = require('../../engine/effectExecutors');
    const trigs = fireTriggers(freshPlayer, 'after_successful_investigate');
    for (const trig of trigs) {
      for (const eff of trig.effects) {
        lines.push(`↪ from **${trig.source_name}**: ` + (await execEffect(eff, { player: freshPlayer, session, guild: interaction.guild })));
      }
    }
  }

  const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
  if (chaosCh) {
    await chaosCh.send(`🔎 **${freshPlayer.investigator_name}** investigates **${loc.name}** — token: ${tokenLabel} — ${success ? '✅ Clue!' : '❌ Fail'}`);
  }

  const replyContent = { content: lines.join('\n'), components: [], flags: 64 };
  if (interaction.deferred || interaction.replied) return interaction.editReply(replyContent);
  return interaction.editReply ? interaction.editReply(replyContent) : interaction.reply(replyContent);
}

module.exports.executeInvestigateAction = executeInvestigateAction;
