const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const {
  requireSession, requirePlayer, getPlayer, getPlayerById,
  getSession, getLocations, getEnemiesAt, getEnemy, updatePlayer, updateEnemy,
} = require('../../engine/gameState');
const { findCardByCode, getCardSkills } = require('../../engine/cardLookup');
const { drawCards } = require('../../engine/deck');
const { refreshHandDisplay } = require('../../engine/handDisplay');

const STAT_ICON = { combat: '⚔️', willpower: '🕯️', intellect: '🔎', agility: '💨' };
const STAT_SKILL_ICON = { combat: '⚔️', willpower: '🕯️', intellect: '🔎', agility: '💨', wild: '🌟' };

function buildMainMenu(round) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ah:btn:move').setLabel('Move').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ah:btn:investigate').setLabel('Investigate').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ah:btn:fight').setLabel('Fight').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ah:btn:evade').setLabel('Evade').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ah:btn:engage').setLabel('Engage').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ah:btn:draw').setLabel('Draw').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ah:btn:resource').setLabel('Resource').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ah:btn:play').setLabel('Play Card').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ah:btn:use').setLabel('Use Asset').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ah:btn:exhaust').setLabel('Exhaust').setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ah:btn:test').setLabel('Skill Test').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ah:btn:commit').setLabel('Commit Card').setStyle(ButtonStyle.Secondary),
  );
  return {
    content: `**Action Hub** — Round ${round}\nChoose an action:`,
    components: [row1, row2, row3],
    flags: 64,
  };
}

function buildCommitSelect(hand, stat, customIdForSelect) {
  const options = hand.flatMap(code => {
    const skills = getCardSkills(code) || {};
    const matching = (skills[stat] || 0) + (skills.wild || 0);
    if (matching === 0) return [];
    const result = findCardByCode(code);
    const name = result?.card.name || code;
    const icons = [];
    if (skills[stat]) icons.push(`${STAT_ICON[stat]}×${skills[stat]}`);
    if (skills.wild) icons.push(`🌟×${skills.wild}`);
    return [{ label: `${name} [${icons.join(' ')}]`, value: code }];
  }).slice(0, 25);

  if (options.length === 0) return null;

  return new StringSelectMenuBuilder()
    .setCustomId(customIdForSelect)
    .setPlaceholder('Commit cards (optional)…')
    .setMinValues(0)
    .setMaxValues(Math.min(options.length, 4))
    .addOptions(options);
}

function backButton() {
  return new ButtonBuilder().setCustomId('ah:btn:back').setLabel('← Back').setStyle(ButtonStyle.Secondary);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('action')
    .setDescription('Take an action. Opens interactive action menu.'),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;
    await interaction.reply(buildMainMenu(session.round));
  },

  async handleButton(interaction) {
    const customId = interaction.customId;

    // Modal must be shown before any deferral — handle it first
    if (customId === 'ah:btn:test') {
      const player = getPlayer(interaction.user.id);
      if (!player) return interaction.reply({ content: '❌ You are not in this game.', flags: 64 });
      const modal = new ModalBuilder()
        .setCustomId('ah:modal:test')
        .setTitle('Skill Test');
      const statInput = new TextInputBuilder()
        .setCustomId('stat')
        .setLabel('Stat (combat/intellect/agility/willpower)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('intellect');
      const diffInput = new TextInputBuilder()
        .setCustomId('difficulty')
        .setLabel('Difficulty (number)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('3');
      modal.addComponents(
        new ActionRowBuilder().addComponents(statInput),
        new ActionRowBuilder().addComponents(diffInput),
      );
      return interaction.showModal(modal);
    }

    await interaction.deferUpdate();

    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.editReply({ content: '❌ You are not in this game.', components: [] });
    const session = getSession();
    if (!session) return interaction.editReply({ content: '❌ No active session.', components: [] });

    if (customId === 'ah:btn:back') {
      return interaction.editReply(buildMainMenu(session.round));
    }

    if (customId === 'ah:btn:move') {
      const locations = getLocations(session.id)
        .filter(l => l.act_index <= session.act_index)
        .filter(l => l.code !== player.location_code);

      if (locations.length === 0) {
        return interaction.editReply({ content: '❌ No locations available to move to.', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }

      const STATUS_ICON = { hidden: '🌑', revealed: '🔍', cleared: '✅' };
      const options = locations.map(l => {
        const icon = STATUS_ICON[l.status] ?? '❓';
        const clues = l.clues > 0 ? ` (${l.clues} clue${l.clues !== 1 ? 's' : ''})` : '';
        return { label: `${icon} ${l.name}${clues}`, value: l.code };
      }).slice(0, 25);

      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:move')
        .setPlaceholder('Choose a location…')
        .addOptions(options);

      return interaction.editReply({
        content: `**Move** — Current location: ${player.location_code}\nWhere to?`,
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    if (customId === 'ah:btn:draw') {
      const freshPlayer = getPlayerById(player.id);
      const drawn = drawCards(freshPlayer, 1);
      const afterDraw = getPlayerById(player.id);
      await refreshHandDisplay(interaction.guild, afterDraw);

      if (drawn.length === 0) {
        return interaction.editReply({ content: '❌ No cards left to draw (deck and discard empty).', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }

      const result = findCardByCode(drawn[0]);
      const name = result?.card.name || drawn[0];
      return interaction.editReply({
        content: `✅ **Drew:** ${name}. Hand updated in your private channel.`,
        components: [new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    if (customId === 'ah:btn:resource') {
      const freshPlayer = getPlayerById(player.id);
      const newResources = freshPlayer.resources + 1;
      updatePlayer(freshPlayer.id, { resources: newResources });
      return interaction.editReply({
        content: `✅ **Gained 1 resource** — now at ${newResources} resources.`,
        components: [new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    if (customId === 'ah:btn:fight') {
      const enemies = getEnemiesAt(session.id, player.location_code).filter(e => !e.is_aloof);
      if (enemies.length === 0) {
        return interaction.editReply({ content: '❌ No enemies at your location.', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }
      const options = enemies.map(e => ({
        label: `[${e.id}] ${e.name} (HP ${e.hp}/${e.max_hp}, Fight ${e.fight})`,
        value: String(e.id),
      }));
      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:fight:enemy')
        .setPlaceholder('Choose an enemy to fight…')
        .addOptions(options);
      return interaction.editReply({
        content: '**Fight** — Choose an enemy:',
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    if (customId === 'ah:btn:evade') {
      const enemies = getEnemiesAt(session.id, player.location_code).filter(e => !e.is_aloof);
      if (enemies.length === 0) {
        return interaction.editReply({ content: '❌ No enemies at your location.', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }
      const options = enemies.map(e => ({
        label: `[${e.id}] ${e.name} (Evade ${e.evade})`,
        value: String(e.id),
      }));
      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:evade:enemy')
        .setPlaceholder('Choose an enemy to evade…')
        .addOptions(options);
      return interaction.editReply({
        content: '**Evade** — Choose an enemy:',
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    if (customId === 'ah:btn:engage') {
      const enemies = getEnemiesAt(session.id, player.location_code).filter(e => e.is_aloof);
      if (enemies.length === 0) {
        return interaction.editReply({ content: '❌ No aloof enemies at your location.', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }
      const options = enemies.map(e => ({ label: `[${e.id}] ${e.name}`, value: String(e.id) }));
      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:engage')
        .setPlaceholder('Choose an enemy to engage…')
        .addOptions(options);
      return interaction.editReply({
        content: '**Engage** — Choose an aloof enemy:',
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    if (customId === 'ah:btn:investigate') {
      const hand = JSON.parse(player.hand || '[]');
      const commitSelect = buildCommitSelect(hand, 'intellect', 'ah:sel:investigate:commit');
      const skipBtn = new ButtonBuilder().setCustomId('ah:btn:investigate:skip').setLabel('No commit — investigate').setStyle(ButtonStyle.Success);

      const components = [new ActionRowBuilder().addComponents(backButton(), skipBtn)];
      if (commitSelect) components.unshift(new ActionRowBuilder().addComponents(commitSelect));

      return interaction.editReply({
        content: '**Investigate** — Commit intellect/wild cards (optional):',
        components,
        flags: 64,
      });
    }

    if (customId === 'ah:btn:investigate:skip') {
      return runInvestigateAction(interaction, player, session, []);
    }

    if (customId === 'ah:btn:play') {
      const hand = JSON.parse(player.hand || '[]');
      const freshPlayer = getPlayerById(player.id);
      const options = hand.flatMap(code => {
        const r = findCardByCode(code);
        if (!r) return [];
        const { card } = r;
        if (!['asset', 'event'].includes(card.type_code)) return [];
        const cost = card.cost ?? 0;
        if (freshPlayer.resources < cost) return [];
        const label = `${card.name} [${card.type_code} | ${cost}r]`;
        return [{ label, value: code }];
      }).slice(0, 25);

      if (options.length === 0) {
        return interaction.editReply({ content: '❌ No playable cards in hand (check resource costs).', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:play')
        .setPlaceholder('Choose a card to play…')
        .addOptions(options);
      return interaction.editReply({
        content: '**Play Card** — Choose:',
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    if (customId === 'ah:btn:use') {
      const assets = JSON.parse(player.assets || '[]').filter(a => a.charges > 0);
      if (assets.length === 0) {
        return interaction.editReply({ content: '❌ No charged assets in play.', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }
      const options = assets.map(a => ({ label: `${a.name} (${a.charges} charges)`, value: a.code }));
      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:use')
        .setPlaceholder('Choose an asset to use…')
        .addOptions(options);
      return interaction.editReply({
        content: '**Use Asset** — Choose:',
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    if (customId === 'ah:btn:exhaust') {
      const assets = JSON.parse(player.assets || '[]');
      if (assets.length === 0) {
        return interaction.editReply({ content: '❌ No assets in play.', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }
      const options = assets.map(a => ({
        label: `${a.name}${a.exhausted ? ' (exhausted)' : ''}`,
        value: a.code,
      }));
      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:exhaust')
        .setPlaceholder('Choose an asset to toggle…')
        .addOptions(options);
      return interaction.editReply({
        content: '**Exhaust/Ready** — Choose:',
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    if (customId === 'ah:btn:commit') {
      const hand = JSON.parse(player.hand || '[]');
      const options = hand.flatMap(code => {
        const skills = getCardSkills(code);
        const hasAny = Object.values(skills).some(v => v > 0);
        if (!hasAny) return [];
        const r = findCardByCode(code);
        const name = r?.card.name || code;
        const icons = Object.entries(skills)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${STAT_SKILL_ICON[k] || k}×${v}`)
          .join(' ');
        return [{ label: `${name} [${icons}]`, value: code }];
      }).slice(0, 25);

      if (options.length === 0) {
        return interaction.editReply({ content: '❌ No committable cards in hand.', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:commit:standalone')
        .setPlaceholder('Select cards to commit…')
        .setMinValues(0)
        .setMaxValues(Math.min(options.length, 4))
        .addOptions(options);
      return interaction.editReply({
        content: '**Commit Cards** — Select cards for the current test:',
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    if (customId.startsWith('ah:btn:fight:skip:')) {
      const enemyId = parseInt(customId.split(':')[4], 10);
      return runFightAction(interaction, player, session, enemyId, []);
    }

    if (customId.startsWith('ah:btn:evade:skip:')) {
      const enemyId = parseInt(customId.split(':')[4], 10);
      return runEvadeAction(interaction, player, session, enemyId, []);
    }

    if (customId.startsWith('ah:btn:test:skip:')) {
      const parts = customId.split(':');
      const stat = parts[4];
      const diff = parseInt(parts[5], 10);
      return runTestAction(interaction, player, session, stat, diff, []);
    }
  },

  async handleSelect(interaction) {
    await interaction.deferUpdate();

    const customId = interaction.customId;
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.editReply({ content: '❌ Not in game.', components: [] });
    const session = getSession();
    if (!session) return interaction.editReply({ content: '❌ No active session.', components: [] });

    if (customId === 'ah:sel:move') {
      const { executeMoveAction } = require('./move');
      return executeMoveAction(interaction, player, session, interaction.values[0]);
    }

    if (customId === 'ah:sel:fight:enemy') {
      const enemyId = interaction.values[0];
      const enemy = getEnemy(parseInt(enemyId, 10));
      const hand = JSON.parse(player.hand || '[]');
      const commitSelect = buildCommitSelect(hand, 'combat', `ah:sel:fight:commit:${enemyId}`);
      const skipBtn = new ButtonBuilder()
        .setCustomId(`ah:btn:fight:skip:${enemyId}`)
        .setLabel('No commit — fight')
        .setStyle(ButtonStyle.Danger);

      const components = [new ActionRowBuilder().addComponents(backButton(), skipBtn)];
      if (commitSelect) components.unshift(new ActionRowBuilder().addComponents(commitSelect));

      return interaction.editReply({
        content: `**Fight ${enemy.name}** (Fight ${enemy.fight}) — Commit combat/wild cards (optional):`,
        components,
        flags: 64,
      });
    }

    if (customId.startsWith('ah:sel:fight:commit:')) {
      const enemyId = parseInt(customId.split(':')[4], 10);
      return runFightAction(interaction, player, session, enemyId, interaction.values);
    }

    if (customId === 'ah:sel:evade:enemy') {
      const enemyId = interaction.values[0];
      const enemy = getEnemy(parseInt(enemyId, 10));
      const hand = JSON.parse(player.hand || '[]');
      const commitSelect = buildCommitSelect(hand, 'agility', `ah:sel:evade:commit:${enemyId}`);
      const skipBtn = new ButtonBuilder()
        .setCustomId(`ah:btn:evade:skip:${enemyId}`)
        .setLabel('No commit — evade')
        .setStyle(ButtonStyle.Secondary);

      const components = [new ActionRowBuilder().addComponents(backButton(), skipBtn)];
      if (commitSelect) components.unshift(new ActionRowBuilder().addComponents(commitSelect));

      return interaction.editReply({
        content: `**Evade ${enemy.name}** (Evade ${enemy.evade}) — Commit agility/wild cards (optional):`,
        components,
        flags: 64,
      });
    }

    if (customId.startsWith('ah:sel:evade:commit:')) {
      const enemyId = parseInt(customId.split(':')[4], 10);
      return runEvadeAction(interaction, player, session, enemyId, interaction.values);
    }

    if (customId === 'ah:sel:engage') {
      const enemyId = parseInt(interaction.values[0], 10);
      const enemy = getEnemy(enemyId);
      updateEnemy(enemyId, { is_aloof: 0 });
      return interaction.editReply({
        content: `✅ **Engaged ${enemy.name}**! It will now activate during the enemy phase.`,
        components: [new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    if (customId === 'ah:sel:investigate:commit') {
      return runInvestigateAction(interaction, player, session, interaction.values);
    }

    if (customId === 'ah:sel:play') {
      const { executePlayCard } = require('./play');
      return executePlayCard(interaction, player, session, interaction.values[0]);
    }

    if (customId === 'ah:sel:use') {
      const { executeUseAsset } = require('./use');
      return executeUseAsset(interaction, player, session, interaction.values[0]);
    }

    if (customId === 'ah:sel:exhaust') {
      const { executeExhaustAsset } = require('./exhaust');
      return executeExhaustAsset(interaction, player, session, interaction.values[0]);
    }

    if (customId === 'ah:sel:commit:standalone') {
      const { commitCards } = require('../../engine/deck');
      const freshPlayer = getPlayerById(player.id);
      commitCards(freshPlayer, interaction.values);
      await refreshHandDisplay(interaction.guild, freshPlayer);
      const names = interaction.values.map(c => findCardByCode(c)?.card.name || c).join(', ');
      return interaction.editReply({
        content: `✅ Committed: **${names}**. Cards moved to discard.`,
        components: [new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    if (customId.startsWith('ah:sel:test:commit:')) {
      const parts = customId.split(':');
      const stat = parts[4];
      const diff = parseInt(parts[5], 10);
      return runTestAction(interaction, player, session, stat, diff, interaction.values);
    }
  },

  async handleModal(interaction) {
    if (interaction.customId === 'ah:modal:test') {
      const player = getPlayer(interaction.user.id);
      if (!player) return interaction.reply({ content: '❌ Not in game.', flags: 64 });
      const session = getSession();
      if (!session) return interaction.reply({ content: '❌ No active session.', flags: 64 });

      const statRaw = interaction.fields.getTextInputValue('stat').toLowerCase().trim();
      const diffRaw = interaction.fields.getTextInputValue('difficulty');
      const difficulty = parseInt(diffRaw, 10);

      const VALID_STATS = ['combat', 'intellect', 'agility', 'willpower'];
      if (!VALID_STATS.includes(statRaw)) {
        return interaction.reply({ content: `❌ Invalid stat "${statRaw}". Use: ${VALID_STATS.join(', ')}`, flags: 64 });
      }
      if (isNaN(difficulty) || difficulty < 0) {
        return interaction.reply({ content: `❌ Invalid difficulty "${diffRaw}".`, flags: 64 });
      }

      const hand = JSON.parse(player.hand || '[]');
      const commitSelect = buildCommitSelect(hand, statRaw, `ah:sel:test:commit:${statRaw}:${difficulty}`);
      const skipBtn = new ButtonBuilder()
        .setCustomId(`ah:btn:test:skip:${statRaw}:${difficulty}`)
        .setLabel('No commit — run test')
        .setStyle(ButtonStyle.Secondary);

      const components = [new ActionRowBuilder().addComponents(backButton(), skipBtn)];
      if (commitSelect) components.unshift(new ActionRowBuilder().addComponents(commitSelect));

      return interaction.reply({
        content: `**Skill Test** — ${statRaw} vs ${difficulty}\nCommit matching cards (optional):`,
        components,
        flags: 64,
      });
    }
  },
};

async function runInvestigateAction(interaction, player, session, commitCodes) {
  const { executeInvestigateAction } = require('./investigate');
  return executeInvestigateAction(interaction, player, session, commitCodes);
}

async function runFightAction(interaction, player, session, enemyId, commitCodes) {
  const { executeFightAction } = require('./fight');
  return executeFightAction(interaction, player, session, enemyId, commitCodes);
}

async function runEvadeAction(interaction, player, session, enemyId, commitCodes) {
  const { executeEvadeAction } = require('./evade');
  return executeEvadeAction(interaction, player, session, enemyId, commitCodes);
}

async function runTestAction(interaction, player, session, stat, difficulty, commitCodes) {
  const { executeTestAction } = require('./test');
  return executeTestAction(interaction, player, session, stat, difficulty, commitCodes);
}
