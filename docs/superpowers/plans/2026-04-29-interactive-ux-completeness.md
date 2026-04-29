# Interactive UX & Game Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/mulligan`, `/engage`, `/action` hub with interactive select menus, phase checklists, hand-size warnings, and hide individual action commands from regular users.

**Architecture:** New commands `/mulligan` and `/engage` fill mechanical gaps. A new `/action` hub presents an ephemeral button menu that guides players through context-aware select menus for every action type. Component interactions (buttons, selects, modals) are routed in `index.js` by customId prefix to dedicated handlers exported from each command file.

**Tech Stack:** Node.js, discord.js v14 (`ActionRowBuilder`, `ButtonBuilder`, `StringSelectMenuBuilder`, `ModalBuilder`), better-sqlite3

---

## File Map

| Action | File |
|--------|------|
| Modify | `bot/db/database.js` — add `is_aloof` migration |
| Create | `bot/commands/game/engage.js` |
| Modify | `bot/commands/game/enemy.js` — add `is_aloof` spawn option |
| Modify | `bot/engine/enemyEngine.js` — skip aloof in activation |
| Create | `bot/commands/game/mulligan.js` |
| Modify | `bot/commands/game/nextphase.js` — phase checklists + hand-size warning |
| Modify | `bot/index.js` — route button/select/modal interactions |
| Create | `bot/commands/game/action.js` |
| Modify | All `bot/commands/game/*.js` action commands — add `default_member_permissions` |
| Modify | `CHEATSHEET.md` |

---

## Task 1: DB Migration — `is_aloof` Column

**Files:**
- Modify: `bot/db/database.js`

- [ ] **Step 1: Add migration after existing `is_hunter` migration**

In `bot/db/database.js`, find this block at the bottom of `init()`:

```javascript
  const enemyCols = db.prepare("PRAGMA table_info(enemies)").all().map(c => c.name);
  if (!enemyCols.includes('is_hunter')) {
    db.exec("ALTER TABLE enemies ADD COLUMN is_hunter INTEGER DEFAULT 0");
  }
```

Add immediately after:

```javascript
  if (!enemyCols.includes('is_aloof')) {
    db.exec("ALTER TABLE enemies ADD COLUMN is_aloof INTEGER DEFAULT 0");
  }
```

- [ ] **Step 2: Restart bot and verify migration ran**

```bash
cd bot && node -e "const {getDb}=require('./db/database'); const cols=getDb().prepare('PRAGMA table_info(enemies)').all().map(c=>c.name); console.log(cols.includes('is_aloof') ? '✅ is_aloof exists' : '❌ missing');"
```

Expected: `✅ is_aloof exists`

- [ ] **Step 3: Commit**

```bash
git add bot/db/database.js
git commit -m "feat: add is_aloof column to enemies table"
```

---

## Task 2: `/engage` Command

**Files:**
- Create: `bot/commands/game/engage.js`
- Modify: `bot/commands/game/enemy.js` — add `is_aloof` option to spawn
- Modify: `bot/engine/enemyEngine.js` — skip aloof enemies in `activateEnemies`

- [ ] **Step 1: Create `bot/commands/game/engage.js`**

```javascript
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getPlayer, getEnemiesAt, getCampaign, getSession, updateEnemy } = require('../../engine/gameState');
const { handChannelName } = require('../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('engage')
    .setDescription('Engage an aloof enemy at your location (costs 1 action).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(opt =>
      opt.setName('enemy_id')
        .setDescription('Enemy ID (from /enemy list)')
        .setRequired(true)),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    const enemyId = interaction.options.getInteger('enemy_id');
    const enemies = getEnemiesAt(session.id, player.location_code);
    const enemy = enemies.find(e => e.id === enemyId);

    if (!enemy) {
      return interaction.reply({ content: `❌ No enemy with ID ${enemyId} at your location.`, flags: 64 });
    }

    if (!enemy.is_aloof) {
      return interaction.reply({ content: `❌ **${enemy.name}** is not aloof — it's already engaged.`, flags: 64 });
    }

    updateEnemy(enemyId, { is_aloof: 0 });

    const campaign = getCampaign();
    const guild = interaction.guild;
    const handCh = guild.channels.cache.find(c =>
      c.name === handChannelName(player.investigator_name)
    );
    if (handCh) {
      await handCh.send(`⚔️ **${player.investigator_name}** engages **${enemy.name}**! (aloof cleared)`);
    }

    return interaction.reply({ content: `✅ You engage **${enemy.name}**. It will now activate normally during the enemy phase.`, flags: 64 });
  },
};
```

- [ ] **Step 2: Add `is_aloof` option to `/enemy spawn` in `bot/commands/game/enemy.js`**

Find the `spawn` subcommand definition in `enemy.js`. After the `hunter` boolean option, add:

```javascript
        .addBooleanOption(o => o.setName('aloof').setDescription('Is this enemy Aloof (must be engaged before activating)?'))
```

Find the `spawnEnemy` call in the `spawn` handler and add `is_aloof`:

```javascript
        enemyId = spawnEnemy(session.id, loc.code, {
          code: c.code,
          name: c.name,
          health: interaction.options.getInteger('hp') || fullCard.health || c.health || 1,
          enemy_fight: interaction.options.getInteger('fight') || fullCard.enemy_fight || c.enemy_fight || 1,
          enemy_evade: interaction.options.getInteger('evade') || fullCard.enemy_evade || c.enemy_evade || 1,
          enemy_damage: interaction.options.getInteger('damage') ?? fullCard.enemy_damage ?? c.enemy_damage ?? 1,
          enemy_horror: interaction.options.getInteger('horror') ?? fullCard.enemy_horror ?? c.enemy_horror ?? 1,
          is_hunter: interaction.options.getBoolean('hunter') ? 1 : 0,
          is_aloof: interaction.options.getBoolean('aloof') ? 1 : 0,
        });
```

Also update the `spawnEnemyManual` call (the `else` branch) to pass `is_aloof`:

```javascript
        enemyId = spawnEnemyManual(
          session.id, loc.code, nameQuery,
          interaction.options.getInteger('hp') || 1,
          interaction.options.getInteger('fight') || 1,
          interaction.options.getInteger('evade') || 1,
          interaction.options.getInteger('damage') ?? 1,
          interaction.options.getInteger('horror') ?? 1,
          interaction.options.getBoolean('hunter') ? 1 : 0,
          interaction.options.getBoolean('aloof') ? 1 : 0,
        );
```

- [ ] **Step 3: Update `spawnEnemyManual` signature in `bot/engine/enemyEngine.js`**

Find:
```javascript
function spawnEnemyManual(sessionId, locationCode, name, hp, fight, evade, damage, horror, isHunter = 0) {
  getDb().prepare(`
    INSERT INTO enemies (session_id, location_code, card_code, name, hp, max_hp, fight, evade, damage, horror, is_hunter)
    VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, locationCode, name, hp, hp, fight, evade, damage, horror, isHunter);
```

Replace with:
```javascript
function spawnEnemyManual(sessionId, locationCode, name, hp, fight, evade, damage, horror, isHunter = 0, isAloof = 0) {
  getDb().prepare(`
    INSERT INTO enemies (session_id, location_code, card_code, name, hp, max_hp, fight, evade, damage, horror, is_hunter, is_aloof)
    VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, locationCode, name, hp, hp, fight, evade, damage, horror, isHunter, isAloof);
```

Also update `spawnEnemy` to pass `is_aloof` from cardData:

Find the `spawnEnemy` function INSERT and add `is_aloof`:
```javascript
function spawnEnemy(sessionId, locationCode, cardData) {
  getDb().prepare(`
    INSERT INTO enemies (session_id, location_code, card_code, name, hp, max_hp, fight, evade, damage, horror, is_hunter, is_aloof)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId, locationCode,
    cardData.code, cardData.name,
    cardData.health || 1, cardData.health || 1,
    cardData.enemy_fight || 1,
    cardData.enemy_evade || 1,
    cardData.enemy_damage || 1,
    cardData.enemy_horror || 1,
    cardData.is_hunter || 0,
    cardData.is_aloof || 0,
  );
```

- [ ] **Step 4: Skip aloof enemies in `activateEnemies` in `bot/engine/enemyEngine.js`**

In `activateEnemies`, find the per-enemy loop. After the existing check for active players, add an aloof check:

```javascript
    // Skip aloof enemies — they don't activate until engaged via /engage
    if (enemy.is_aloof) {
      results.push(`🛡️ **${enemy.name}** [${enemy.id}] is aloof — not activated (use /engage to engage it first)`);
      continue;
    }
```

Add this **before** the hunter/engagement logic.

- [ ] **Step 5: Manual test**

1. Start bot: `pkill -f "node.*index.js"; node index.js >> /tmp/arkham-bot.log 2>&1 &`
2. Run `node deploy-commands.js` first to register `/engage`
3. In Discord: `/enemy spawn name:Ghoul Priest location:<loc> aloof:true`
4. Run `/enemyphase` — should see aloof message, not attack
5. Run `/engage enemy_id:<id>` — should clear aloof
6. Run `/enemyphase` — enemy should now activate

- [ ] **Step 6: Commit**

```bash
git add bot/commands/game/engage.js bot/commands/game/enemy.js bot/engine/enemyEngine.js
git commit -m "feat: add /engage command and is_aloof enemy mechanic"
```

---

## Task 3: `/mulligan` Command with Interactive Select

**Files:**
- Create: `bot/commands/game/mulligan.js`
- Modify: `bot/index.js` — add component interaction routing (partial, completed fully in Task 6)

- [ ] **Step 1: Create `bot/commands/game/mulligan.js`**

```javascript
const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getPlayerById, updatePlayer } = require('../../engine/gameState');
const { findCardByCode } = require('../../engine/cardLookup');
const { drawCards, shuffle } = require('../../engine/deck');
const { refreshHandDisplay } = require('../../engine/handDisplay');

function buildMulliganEmbed(player) {
  const hand = JSON.parse(player.hand || '[]');

  const selectOptions = hand.map((code, idx) => {
    const result = findCardByCode(code);
    const name = result?.card.name || code;
    return { label: name, value: `${code}__${idx}`, description: code };
  });

  const components = [];

  if (selectOptions.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('mull:swap')
      .setPlaceholder('Select cards to swap out…')
      .setMinValues(0)
      .setMaxValues(selectOptions.length)
      .addOptions(selectOptions);
    components.push(new ActionRowBuilder().addComponents(select));
  }

  const doneBtn = new ButtonBuilder()
    .setCustomId('mull:done')
    .setLabel('Done — shuffle rest into deck')
    .setStyle(ButtonStyle.Success);
  components.push(new ActionRowBuilder().addComponents(doneBtn));

  const handNames = hand.map(code => {
    const r = findCardByCode(code);
    return r?.card.name || code;
  });

  return {
    content: `**Mulligan** — Current hand (${hand.length} cards):\n${handNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n\nSelect cards to swap, or click **Done** to keep this hand.`,
    components,
    flags: 64,
  };
}

async function handleMulliganSwap(interaction) {
  const player = requirePlayer(interaction);
  if (!player) return;

  const session = requireSession(interaction);
  if (!session) return;

  if (session.round !== 1 || session.phase !== 'investigation') {
    return interaction.reply({ content: '❌ Mulligan only available round 1 investigation phase.', flags: 64 });
  }

  const selected = interaction.values; // e.g. ['01025__0', '01030__2']
  const codesToDiscard = selected.map(v => v.split('__')[0]);

  // Discard selected cards
  let hand = JSON.parse(player.hand || '[]');
  let discard = JSON.parse(player.discard || '[]');
  for (const code of codesToDiscard) {
    const idx = hand.indexOf(code);
    if (idx !== -1) {
      hand.splice(idx, 1);
      discard.push(code);
    }
  }
  updatePlayer(player.id, { hand: JSON.stringify(hand), discard: JSON.stringify(discard) });

  // Draw same number
  const freshPlayer = getPlayerById(player.id);
  drawCards(freshPlayer, codesToDiscard.length);

  const finalPlayer = getPlayerById(player.id);
  await refreshHandDisplay(interaction.guild, finalPlayer);

  const msg = buildMulliganEmbed(finalPlayer);
  await interaction.update(msg);
}

async function handleMulliganDone(interaction) {
  const player = requirePlayer(interaction);
  if (!player) return;

  // Shuffle discard back into deck
  let deck = JSON.parse(player.deck || '[]');
  let discard = JSON.parse(player.discard || '[]');
  deck = shuffle([...deck, ...discard]);
  updatePlayer(player.id, { deck: JSON.stringify(deck), discard: JSON.stringify([]) });

  await interaction.update({ content: '✅ Mulligan complete. Remaining cards shuffled back into deck.', components: [], flags: 64 });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mulligan')
    .setDescription('Swap cards from your opening hand. Round 1 only.'),
    // NOTE: No admin restriction — players need direct access to this during pregame

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;

    if (session.round !== 1 || session.phase !== 'investigation') {
      return interaction.reply({ content: '❌ Mulligan only available during round 1 investigation phase.', flags: 64 });
    }

    const msg = buildMulliganEmbed(player);
    await interaction.reply(msg);
  },

  handleButton: handleMulliganDone,
  handleSelect: handleMulliganSwap,
};
```

- [ ] **Step 2: Add component routing to `bot/index.js`**

In `index.js`, find the `interactionCreate` handler. After the `isAutocomplete()` block and before `if (!interaction.isChatInputCommand()) return;`, add:

```javascript
  // Component interaction routing
  if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
    const customId = interaction.customId;

    if (customId.startsWith('mull:')) {
      const mulligan = client.commands.get('mulligan');
      if (!mulligan) return;
      try {
        if (interaction.isStringSelectMenu()) return await mulligan.handleSelect(interaction);
        if (interaction.isButton()) return await mulligan.handleButton(interaction);
      } catch (e) {
        console.error('Mulligan interaction error:', e);
        await interaction.reply({ content: `❌ Error: ${e.message}`, flags: 64 }).catch(() => {});
      }
      return;
    }

    if (customId.startsWith('ah:')) {
      const action = client.commands.get('action');
      if (!action) return;
      try {
        if (interaction.isButton()) return await action.handleButton(interaction);
        if (interaction.isStringSelectMenu()) return await action.handleSelect(interaction);
        if (interaction.isModalSubmit()) return await action.handleModal(interaction);
      } catch (e) {
        console.error('Action hub interaction error:', e);
        await interaction.reply({ content: `❌ Error: ${e.message}`, flags: 64 }).catch(() => {});
      }
      return;
    }

    return;
  }
```

- [ ] **Step 3: Manual test**

1. Deploy + restart bot
2. `/startgame` to deal opening hands
3. Run `/mulligan` — should see hand list + select menu + Done button
4. Select 2 cards → should replace them, refresh embed
5. Click Done → should shuffle discard into deck, dismiss

- [ ] **Step 4: Commit**

```bash
git add bot/commands/game/mulligan.js bot/index.js
git commit -m "feat: add /mulligan with interactive select menu and routing in index.js"
```

---

## Task 4: Phase Checklists + Hand Size Warning in `/nextphase`

**Files:**
- Modify: `bot/commands/game/nextphase.js`

- [ ] **Step 1: Replace the Investigation→Enemy transition message**

Find the `INVESTIGATION → ENEMY` block. Replace the `msg` variable with:

```javascript
      const msg = [
        `## 👹 Enemy Phase — Round ${session.round}`,
        '',
        '**Steps:**',
        '1. Run `/enemyphase` to activate enemies (hunters move, engaged enemies attack).',
        '2. Resolve manual effects: **Retaliate**, **Aloof** (use `/engage`), etc.',
        '3. Use `/nextphase` to continue to Upkeep when done.',
      ].join('\n');
```

- [ ] **Step 2: Add hand size warning in the Enemy→Upkeep block**

In the `ENEMY → UPKEEP` block, after the `drawCards` step for each player, add a hand-size check. Find the section where `steps` is populated for each player, after the draw step:

```javascript
        // 3. Draw 1 card — fetch fresh after resource write
        const p3 = getPlayerById(player.id);
        const drawn = drawCards(p3, 1);
        if (drawn.length > 0) {
          await refreshHandDisplay(interaction.guild, p3);
          steps.push('🃏 drew 1 card');
        } else {
          steps.push('🃏 no cards to draw');
        }

        // 4. Hand size check
        const p4 = getPlayerById(player.id);
        const currentHand = JSON.parse(p4.hand || '[]');
        if (currentHand.length > 8) {
          const handCh = interaction.guild.channels.cache.find(c =>
            c.name === handChannelName(p4.investigator_name)
          );
          if (handCh) {
            await handCh.send(`⚠️ **${p4.investigator_name}** has **${currentHand.length}** cards in hand (limit 8). Use \`/discard\` to reduce to 8.`);
          }
          steps.push(`⚠️ hand has ${currentHand.length} cards — discard to 8`);
        }
```

Make sure `handChannelName` is imported — check top of `nextphase.js`, it should already be there. If not, add:
```javascript
const { handChannelName } = require('../../config');
```

- [ ] **Step 3: Update the Upkeep summary line**

Find: `summaryLines.push('', 'Use \`/nextphase\` to begin the Mythos phase.');`

Replace with:
```javascript
      summaryLines.push('', '**Hand size warnings** (if any) sent to hand channels.', '', 'Host: use `/nextphase` to begin the Mythos phase.');
```

- [ ] **Step 4: Update investigation phase messages**

Find the `MYTHOS → INVESTIGATION` fallback block. Update the doom channel message:

```javascript
      if (doomCh) await doomCh.send([
        `## 🔍 Investigation Phase — Round ${session.round}`,
        '',
        'Each investigator gets **3 actions**. Use `/action` to take them.',
        'Host: `/nextphase` when all investigators are done.',
      ].join('\n'));
```

Find the `UPKEEP → MYTHOS` block. After `runMythosEncounters`, find where investigation phase message is posted. Update the `updateDoomTrack` call context — find the final investigation message and add:

```javascript
      if (doomCh) await doomCh.send([
        `## 🔍 Investigation Phase — Round ${newRound}`,
        '',
        'Each investigator gets **3 actions**. Use `/action` to take them.',
        'Host: `/nextphase` when all investigators are done.',
      ].join('\n'));
```

- [ ] **Step 5: Manual test**

1. Restart bot (no deploy needed — no new slash commands)
2. Play through a round: `/nextphase` from investigation → confirm enemy phase checklist posts to `#doom-track`
3. `/nextphase` from enemy → confirm upkeep runs, hand-size warning posts if hand > 8
4. `/nextphase` from upkeep → confirm investigation checklist posts

- [ ] **Step 6: Commit**

```bash
git add bot/commands/game/nextphase.js
git commit -m "feat: phase checklists and hand size warning in upkeep"
```

---

## Task 5: Component Routing in `index.js` (Final)

> This task ensures the routing added in Task 3 is complete and handles all action hub customIds that will be added in Tasks 6–10.

**Files:**
- Modify: `bot/index.js`

- [ ] **Step 1: Verify routing already in place from Task 3**

The `mull:` and `ah:` routing added in Task 3 is sufficient for all subsequent tasks. Confirm the block is present and routes to `action.handleButton`, `action.handleSelect`, and `action.handleModal`. No additional changes needed here.

- [ ] **Step 2: No commit needed** — routing complete from Task 3.

---

## Task 6: `/action` Hub — Core + Move + Draw + Resource

**Files:**
- Create: `bot/commands/game/action.js`

- [ ] **Step 1: Create `bot/commands/game/action.js` with core structure and Move/Draw/Resource**

```javascript
const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');
const {
  requireSession, requirePlayer, getPlayer, getPlayerById,
  getSession, getCampaign, getLocations, getEnemiesAt, getEnemy, updatePlayer,
} = require('../../engine/gameState');
const { findCardByCode, getCardSkills } = require('../../engine/cardLookup');
const { drawCards } = require('../../engine/deck');
const { refreshHandDisplay } = require('../../engine/handDisplay');
const allInvestigators = require('../../data/investigators/investigators.json');

const STAT_ICON = { combat: '⚔️', willpower: '🕯️', intellect: '🔎', agility: '💨' };
const STAT_SKILL_ICON = { combat: '⚔️', willpower: '🕯️', intellect: '🔎', agility: '💨', wild: '🌟' };

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function buildCommitSelect(hand, stat, prefix) {
  const options = hand.flatMap(code => {
    const skills = getCardSkills(code);
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
    .setCustomId(prefix)
    .setPlaceholder('Commit cards (optional)…')
    .setMinValues(0)
    .setMaxValues(Math.min(options.length, 4))
    .addOptions(options);
}

function backButton() {
  return new ButtonBuilder().setCustomId('ah:btn:back').setLabel('← Back').setStyle(ButtonStyle.Secondary);
}

// ── Slash command ─────────────────────────────────────────────────────────────

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

  // ── Button handler ──────────────────────────────────────────────────────────

  async handleButton(interaction) {
    const customId = interaction.customId;
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.reply({ content: '❌ You are not in this game.', flags: 64 });
    const session = getSession();
    if (!session) return interaction.reply({ content: '❌ No active session.', flags: 64 });

    // Back to main menu
    if (customId === 'ah:btn:back') {
      return interaction.update(buildMainMenu(session.round));
    }

    // ── Move ──
    if (customId === 'ah:btn:move') {
      const locations = getLocations(session.id)
        .filter(l => l.act_index <= session.act_index)
        .filter(l => l.code !== player.location_code);

      if (locations.length === 0) {
        return interaction.update({ content: '❌ No locations available to move to.', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
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

      return interaction.update({
        content: `**Move** — Current location: ${player.location_code}\nWhere to?`,
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    // ── Draw ──
    if (customId === 'ah:btn:draw') {
      const freshPlayer = getPlayerById(player.id);
      const drawn = drawCards(freshPlayer, 1);
      await refreshHandDisplay(interaction.guild, freshPlayer);

      if (drawn.length === 0) {
        return interaction.update({ content: '❌ No cards left to draw (deck and discard empty).', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }

      const result = findCardByCode(drawn[0]);
      const name = result?.card.name || drawn[0];
      return interaction.update({
        content: `✅ **Drew:** ${name}. Hand updated in your private channel.`,
        components: [new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    // ── Resource ──
    if (customId === 'ah:btn:resource') {
      const freshPlayer = getPlayerById(player.id);
      updatePlayer(freshPlayer.id, { resources: freshPlayer.resources + 1 });
      return interaction.update({
        content: `✅ **Gained 1 resource** — now at ${freshPlayer.resources + 1} resources.`,
        components: [new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    // ── Fight ── (enemy select)
    if (customId === 'ah:btn:fight') {
      const enemies = getEnemiesAt(session.id, player.location_code).filter(e => !e.is_aloof);
      if (enemies.length === 0) {
        return interaction.update({ content: '❌ No enemies at your location.', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }
      const options = enemies.map(e => ({
        label: `[${e.id}] ${e.name} (HP ${e.hp}/${e.max_hp}, Fight ${e.fight})`,
        value: String(e.id),
      }));
      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:fight:enemy')
        .setPlaceholder('Choose an enemy to fight…')
        .addOptions(options);
      return interaction.update({
        content: '**Fight** — Choose an enemy:',
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    // ── Evade ── (enemy select)
    if (customId === 'ah:btn:evade') {
      const enemies = getEnemiesAt(session.id, player.location_code).filter(e => !e.is_aloof);
      if (enemies.length === 0) {
        return interaction.update({ content: '❌ No enemies at your location.', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }
      const options = enemies.map(e => ({
        label: `[${e.id}] ${e.name} (Evade ${e.evade})`,
        value: String(e.id),
      }));
      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:evade:enemy')
        .setPlaceholder('Choose an enemy to evade…')
        .addOptions(options);
      return interaction.update({
        content: '**Evade** — Choose an enemy:',
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    // ── Engage ──
    if (customId === 'ah:btn:engage') {
      const enemies = getEnemiesAt(session.id, player.location_code).filter(e => e.is_aloof);
      if (enemies.length === 0) {
        return interaction.update({ content: '❌ No aloof enemies at your location.', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }
      const options = enemies.map(e => ({ label: `[${e.id}] ${e.name}`, value: String(e.id) }));
      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:engage')
        .setPlaceholder('Choose an enemy to engage…')
        .addOptions(options);
      return interaction.update({
        content: '**Engage** — Choose an aloof enemy:',
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    // ── Investigate ──
    if (customId === 'ah:btn:investigate') {
      const hand = JSON.parse(player.hand || '[]');
      const commitSelect = buildCommitSelect(hand, 'intellect', 'ah:sel:investigate:commit');
      const skipBtn = new ButtonBuilder().setCustomId('ah:btn:investigate:skip').setLabel('No commit — investigate').setStyle(ButtonStyle.Success);

      const components = [new ActionRowBuilder().addComponents(backButton(), skipBtn)];
      if (commitSelect) components.unshift(new ActionRowBuilder().addComponents(commitSelect));

      return interaction.update({
        content: '**Investigate** — Commit intellect/wild cards (optional):',
        components,
        flags: 64,
      });
    }

    // ── Investigate skip (no commit) ──
    if (customId === 'ah:btn:investigate:skip') {
      return runInvestigateAction(interaction, player, session, []);
    }

    // ── Play ──
    if (customId === 'ah:btn:play') {
      const hand = JSON.parse(player.hand || '[]');
      const options = hand.flatMap(code => {
        const r = findCardByCode(code);
        if (!r) return [];
        const { card } = r;
        if (!['asset', 'event'].includes(card.type_code)) return [];
        const cost = card.cost ?? 0;
        const freshPlayer = getPlayerById(player.id);
        if (freshPlayer.resources < cost) return [];
        const label = `${card.name} [${card.type_code} | ${cost}r]`;
        return [{ label, value: code }];
      }).slice(0, 25);

      if (options.length === 0) {
        return interaction.update({ content: '❌ No playable cards in hand (check resource costs).', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:play')
        .setPlaceholder('Choose a card to play…')
        .addOptions(options);
      return interaction.update({
        content: '**Play Card** — Choose:',
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    // ── Use ──
    if (customId === 'ah:btn:use') {
      const assets = JSON.parse(player.assets || '[]').filter(a => a.charges > 0);
      if (assets.length === 0) {
        return interaction.update({ content: '❌ No charged assets in play.', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }
      const options = assets.map(a => ({ label: `${a.name} (${a.charges} charges)`, value: a.code }));
      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:use')
        .setPlaceholder('Choose an asset to use…')
        .addOptions(options);
      return interaction.update({
        content: '**Use Asset** — Choose:',
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    // ── Exhaust ──
    if (customId === 'ah:btn:exhaust') {
      const assets = JSON.parse(player.assets || '[]');
      if (assets.length === 0) {
        return interaction.update({ content: '❌ No assets in play.', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }
      const options = assets.map(a => ({
        label: `${a.name}${a.exhausted ? ' (exhausted)' : ''}`,
        value: a.code,
      }));
      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:exhaust')
        .setPlaceholder('Choose an asset to toggle…')
        .addOptions(options);
      return interaction.update({
        content: '**Exhaust/Ready** — Choose:',
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    // ── Test ──
    if (customId === 'ah:btn:test') {
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

    // ── Commit (standalone) ──
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
        return interaction.update({ content: '❌ No committable cards in hand.', components: [new ActionRowBuilder().addComponents(backButton())], flags: 64 });
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId('ah:sel:commit:standalone')
        .setPlaceholder('Select cards to commit…')
        .setMinValues(0)
        .setMaxValues(Math.min(options.length, 4))
        .addOptions(options);
      return interaction.update({
        content: '**Commit Cards** — Select cards for the current test:',
        components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }
  },

  // ── Select handler ──────────────────────────────────────────────────────────

  async handleSelect(interaction) {
    const customId = interaction.customId;
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.reply({ content: '❌ Not in game.', flags: 64 });
    const session = getSession();
    if (!session) return interaction.reply({ content: '❌ No active session.', flags: 64 });

    // ── Move ──
    if (customId === 'ah:sel:move') {
      const { executeMoveAction } = require('./move');
      return executeMoveAction(interaction, player, session, interaction.values[0]);
    }

    // ── Fight: enemy selected → show commit ──
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

      return interaction.update({
        content: `**Fight ${enemy.name}** (Fight ${enemy.fight}) — Commit combat/wild cards (optional):`,
        components,
        flags: 64,
      });
    }

    // ── Fight: commit selected → execute ──
    if (customId.startsWith('ah:sel:fight:commit:')) {
      const enemyId = customId.split(':')[4];
      return runFightAction(interaction, player, session, parseInt(enemyId, 10), interaction.values);
    }

    // ── Fight: skip commit button handled in handleButton ──

    // ── Evade: enemy selected → show commit ──
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

      return interaction.update({
        content: `**Evade ${enemy.name}** (Evade ${enemy.evade}) — Commit agility/wild cards (optional):`,
        components,
        flags: 64,
      });
    }

    // ── Evade: commit selected → execute ──
    if (customId.startsWith('ah:sel:evade:commit:')) {
      const enemyId = customId.split(':')[4];
      return runEvadeAction(interaction, player, session, parseInt(enemyId, 10), interaction.values);
    }

    // ── Engage ──
    if (customId === 'ah:sel:engage') {
      const { updateEnemy } = require('../../engine/gameState');
      const enemyId = parseInt(interaction.values[0], 10);
      const enemy = getEnemy(enemyId);
      updateEnemy(enemyId, { is_aloof: 0 });
      return interaction.update({
        content: `✅ **Engaged ${enemy.name}**! It will now activate during the enemy phase.`,
        components: [new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }

    // ── Investigate: commit selected ──
    if (customId === 'ah:sel:investigate:commit') {
      return runInvestigateAction(interaction, player, session, interaction.values);
    }

    // ── Play ──
    if (customId === 'ah:sel:play') {
      const { executePlayCard } = require('./play');
      return executePlayCard(interaction, player, session, interaction.values[0]);
    }

    // ── Use ──
    if (customId === 'ah:sel:use') {
      const { executeUseAsset } = require('./use');
      return executeUseAsset(interaction, player, session, interaction.values[0]);
    }

    // ── Exhaust ──
    if (customId === 'ah:sel:exhaust') {
      const { executeExhaustAsset } = require('./exhaust');
      return executeExhaustAsset(interaction, player, session, interaction.values[0]);
    }

    // ── Commit standalone ──
    if (customId === 'ah:sel:commit:standalone') {
      const { commitCards } = require('../../engine/deck');
      const freshPlayer = getPlayerById(player.id);
      commitCards(freshPlayer, interaction.values);
      await refreshHandDisplay(interaction.guild, freshPlayer);
      const names = interaction.values.map(c => findCardByCode(c)?.card.name || c).join(', ');
      return interaction.update({
        content: `✅ Committed: **${names}**. Cards moved to discard.`,
        components: [new ActionRowBuilder().addComponents(backButton())],
        flags: 64,
      });
    }
  },

  // ── Modal handler ────────────────────────────────────────────────────────────

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

      // Show commit select for this stat
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

// ── Action execution helpers (imported by action.js) ─────────────────────────

async function runInvestigateAction(interaction, player, session, commitCodes) {
  // Delegate to investigate.js execute logic via a thin wrapper
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
```

> **Note:** The `executeMoveAction`, `executeInvestigateAction`, `executeFightAction`, `executeEvadeAction`, `executePlayCard`, `executeUseAsset`, `executeExhaustAsset` functions are extracted from their respective command files in the next tasks. Until then, these calls will fail — that is expected. Implement task-by-task.

Also handle fight/evade skip buttons in `handleButton` — add these cases to the button handler:

```javascript
    // ── Fight: skip commit ──
    if (customId.startsWith('ah:btn:fight:skip:')) {
      const enemyId = parseInt(customId.split(':')[4], 10);
      return runFightAction(interaction, player, session, enemyId, []);
    }

    // ── Evade: skip commit ──
    if (customId.startsWith('ah:btn:evade:skip:')) {
      const enemyId = parseInt(customId.split(':')[4], 10);
      return runEvadeAction(interaction, player, session, enemyId, []);
    }

    // ── Test: skip commit ──
    if (customId.startsWith('ah:btn:test:skip:')) {
      const parts = customId.split(':');
      const stat = parts[4];
      const diff = parseInt(parts[5], 10);
      return runTestAction(interaction, player, session, stat, diff, []);
    }
```

And handle test commit select in `handleSelect`:

```javascript
    // ── Test: commit selected ──
    if (customId.startsWith('ah:sel:test:commit:')) {
      const parts = customId.split(':');
      const stat = parts[4];
      const diff = parseInt(parts[5], 10);
      return runTestAction(interaction, player, session, stat, diff, interaction.values);
    }
```

Add `runTestAction` at the bottom of the file:

```javascript
async function runTestAction(interaction, player, session, stat, difficulty, commitCodes) {
  const { executeTestAction } = require('./test');
  return executeTestAction(interaction, player, session, stat, difficulty, commitCodes);
}
```

- [ ] **Step 2: Manual test**

1. Deploy + restart
2. Run `/action` — should see button menu
3. Click **Draw** → confirms draw
4. Click **Resource** → confirms resource gain
5. Click **Move** → shows location select → pick one → moves

- [ ] **Step 3: Commit**

```bash
git add bot/commands/game/action.js
git commit -m "feat: /action hub with Move, Draw, Resource, and all button routing"
```

---

## Task 7: Extract `executeInvestigateAction` from `investigate.js`

**Files:**
- Modify: `bot/commands/game/investigate.js`

- [ ] **Step 1: Extract execute logic into exported function**

The `investigate.js` `execute` function currently reads options via `interaction.options`. We need to support calling the same logic with pre-resolved `commitCodes` array. Extract the core logic:

At the **end** of `investigate.js`, after the `module.exports`, add:

```javascript
async function executeInvestigateAction(interaction, player, session, commitCodes = []) {
  // Re-use execute logic with injected commit codes instead of interaction.options
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
    return interaction.replied || interaction.deferred ? interaction.editReply(msg) : interaction.update(msg);
  }

  const freshPlayer = getPlayerById(player.id);
  const hand = JSON.parse(freshPlayer.hand || '[]');
  const notInHand = codes.filter(c => !hand.includes(c));
  if (notInHand.length) {
    const msg = { content: `❌ Not in your hand: ${notInHand.join(', ')}`, flags: 64 };
    return interaction.update ? interaction.update(msg) : interaction.reply(msg);
  }

  const inv = allInvestigators.find(i => i.code === freshPlayer.investigator_code);
  const statValue = inv?.skills?.[statName] ?? 0;
  const short = STAT_SHORT[statName];
  const icon = STAT_ICON[statName];

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

  const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
  if (chaosCh) {
    await chaosCh.send(`🔎 **${freshPlayer.investigator_name}** investigates **${loc.name}** — token: ${tokenLabel} — ${success ? '✅ Clue!' : '❌ Fail'}`);
  }

  const replyContent = { content: lines.join('\n'), components: [], flags: 64 };
  if (interaction.update) return interaction.update(replyContent);
  return interaction.editReply ? interaction.editReply(replyContent) : interaction.reply(replyContent);
}

module.exports.executeInvestigateAction = executeInvestigateAction;
```

- [ ] **Step 2: Manual test**

1. Restart bot (no deploy)
2. `/action` → **Investigate** → select commit cards → confirm test runs with correct result
3. `/action` → **Investigate** → click "No commit" → confirm test runs

- [ ] **Step 3: Commit**

```bash
git add bot/commands/game/investigate.js
git commit -m "feat: extract executeInvestigateAction for action hub"
```

---

## Task 8: Extract `executeFightAction` from `fight.js`

**Files:**
- Modify: `bot/commands/game/fight.js`

- [ ] **Step 1: Add exported `executeFightAction` at end of `fight.js`**

```javascript
async function executeFightAction(interaction, player, session, enemyId, commitCodes = []) {
  const { getEnemy, getLocation, updateEnemy, getPlayerById } = require('../../engine/gameState');
  const { drawToken, displayToken } = require('../../engine/chaosBag');
  const { damageEnemy, defeatEnemy } = require('../../engine/enemyEngine');
  const { updateLocationStatus } = require('../../engine/locationManager');
  const { findCardByCode, getCardSkills } = require('../../engine/cardLookup');
  const { commitCards } = require('../../engine/deck');
  const { refreshHandDisplay } = require('../../engine/handDisplay');
  const { AttachmentBuilder } = require('discord.js');
  const allInvestigators = require('../../data/investigators/investigators.json');

  const SPECIAL_TOKENS = new Set(['skull', 'cultist', 'tablet', 'elder_thing', 'auto_fail', 'elder_sign']);
  const STAT_SHORT = { combat: 'CMB', willpower: 'WIL', intellect: 'INT', agility: 'AGI' };
  const STAT_ICON_MAP = { combat: '⚔️', willpower: '🕯️', intellect: '🔎', agility: '💨' };

  const enemy = getEnemy(enemyId);
  if (!enemy) {
    const msg = { content: `❌ No enemy with ID ${enemyId}.`, flags: 64 };
    return interaction.update ? interaction.update(msg) : interaction.reply(msg);
  }

  const statName = 'combat';
  const freshPlayer = getPlayerById(player.id);
  const hand = JSON.parse(freshPlayer.hand || '[]');
  const notInHand = commitCodes.filter(c => !hand.includes(c));
  if (notInHand.length) {
    const msg = { content: `❌ Not in hand: ${notInHand.join(', ')}`, flags: 64 };
    return interaction.update ? interaction.update(msg) : interaction.reply(msg);
  }

  const inv = allInvestigators.find(i => i.code === freshPlayer.investigator_code);
  const statValue = inv?.skills?.[statName] ?? 0;
  const short = STAT_SHORT[statName];
  const icon = STAT_ICON_MAP[statName];

  let commitBonus = 0;
  const commitLines = [];
  for (const code of commitCodes) {
    const skills = getCardSkills(code);
    const contribution = (skills[statName] || 0) + (skills.wild || 0);
    commitBonus += contribution;
    const result = findCardByCode(code);
    const name = result?.card.name || code;
    const icons = [];
    if (skills[statName]) icons.push(`${short}×${skills[statName]}`);
    if (skills.wild) icons.push(`WILD×${skills.wild}`);
    commitLines.push(`  • **${name}** [${icons.join(' ')}] +${contribution}`);
  }

  if (commitCodes.length > 0) {
    commitCards(freshPlayer, commitCodes);
    await refreshHandDisplay(interaction.guild, freshPlayer);
    const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
    if (chaosCh) {
      for (const code of commitCodes) {
        const result = findCardByCode(code);
        if (result?.imagePath) {
          const att = new AttachmentBuilder(result.imagePath, { name: 'card.png' });
          await chaosCh.send({ content: `${icon} **${freshPlayer.investigator_name}** commits **${result.card.name}** to Fight`, files: [att] });
        }
      }
    }
  }

  const fightRating = enemy.fight;
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
  const success = !isAutoFail && total >= fightRating;
  const tokenLabel = displayToken(token);
  const specialNote = SPECIAL_TOKENS.has(token) && !isElderSign ? ' *(resolve scenario effect manually)*'
    : isElderSign ? ' *(apply your elder sign ability)*' : '';

  const parts = [`${statValue} (${short})`];
  if (commitBonus > 0) parts.push(`+${commitBonus} (commit)`);
  if (!isAutoFail) parts.push(`${mod >= 0 ? '+' : ''}${mod} (token)`);
  const mathLine = isAutoFail ? 'Auto-fail — attack misses'
    : `${parts.join(' ')} = **${total}** vs Fight **${fightRating}**`;

  const lines = [
    `## ⚔️ Fight — ${enemy.name}`,
    `**${freshPlayer.investigator_name}** | ${short}: ${statValue} | Enemy Fight: ${fightRating}`,
  ];
  if (commitLines.length) { lines.push('**Committed:**'); lines.push(...commitLines); }
  lines.push(`**Token:** ${tokenLabel}${specialNote}`, `**Result:** ${mathLine}`, '');

  if (success) {
    const dmg = 1;
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
    lines.push('❌ **Miss!** The attack fails.');
  }

  const chaosCh = interaction.guild.channels.cache.get(session.chaos_channel_id);
  if (chaosCh) await chaosCh.send(`⚔️ **${freshPlayer.investigator_name}** fights **${enemy.name}** — token: ${tokenLabel} — ${success ? '✅ Hit!' : '❌ Miss!'}`);

  const replyContent = { content: lines.join('\n'), components: [], flags: 64 };
  return interaction.update ? interaction.update(replyContent) : interaction.editReply(replyContent);
}

module.exports.executeFightAction = executeFightAction;
```

- [ ] **Step 2: Manual test**

1. `/action` → **Fight** → select enemy → select commit cards → confirm fight runs
2. `/action` → **Fight** → select enemy → click "No commit" → confirm fight runs

- [ ] **Step 3: Commit**

```bash
git add bot/commands/game/fight.js
git commit -m "feat: extract executeFightAction for action hub"
```

---

## Task 9: Extract `executeEvadeAction` from `evade.js`

**Files:**
- Modify: `bot/commands/game/evade.js`

- [ ] **Step 1: Read `evade.js` execute logic**

```bash
cat bot/commands/game/evade.js
```

- [ ] **Step 2: Add exported `executeEvadeAction` at end of `evade.js`**

Mirror the same pattern as `executeFightAction` but for evade: stat = `agility`, test against `enemy.evade`, success = enemy becomes exhausted (set `is_exhausted: 1`).

```javascript
async function executeEvadeAction(interaction, player, session, enemyId, commitCodes = []) {
  const { getEnemy, getPlayerById, updateEnemy } = require('../../engine/gameState');
  const { drawToken, displayToken } = require('../../engine/chaosBag');
  const { findCardByCode, getCardSkills } = require('../../engine/cardLookup');
  const { commitCards } = require('../../engine/deck');
  const { refreshHandDisplay } = require('../../engine/handDisplay');
  const { AttachmentBuilder } = require('discord.js');
  const allInvestigators = require('../../data/investigators/investigators.json');

  const SPECIAL_TOKENS = new Set(['skull', 'cultist', 'tablet', 'elder_thing', 'auto_fail', 'elder_sign']);

  const enemy = getEnemy(enemyId);
  if (!enemy) {
    const msg = { content: `❌ No enemy with ID ${enemyId}.`, flags: 64 };
    return interaction.update ? interaction.update(msg) : interaction.reply(msg);
  }

  const statName = 'agility';
  const freshPlayer = getPlayerById(player.id);
  const inv = allInvestigators.find(i => i.code === freshPlayer.investigator_code);
  const statValue = inv?.skills?.[statName] ?? 0;

  let commitBonus = 0;
  const commitLines = [];
  for (const code of commitCodes) {
    const skills = getCardSkills(code);
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
  return interaction.update ? interaction.update(replyContent) : interaction.editReply(replyContent);
}

module.exports.executeEvadeAction = executeEvadeAction;
```

- [ ] **Step 3: Commit**

```bash
git add bot/commands/game/evade.js
git commit -m "feat: extract executeEvadeAction for action hub"
```

---

## Task 10: Extract Execute Functions from `play.js`, `use.js`, `exhaust.js`

**Files:**
- Modify: `bot/commands/game/play.js`
- Modify: `bot/commands/game/use.js`
- Modify: `bot/commands/game/exhaust.js`

- [ ] **Step 1: Add `executePlayCard` to `play.js`**

Read play.js execute block, then add at end of file:

```javascript
async function executePlayCard(interaction, player, session, cardCode) {
  // Re-invoke the core play logic with the resolved cardCode
  // Re-read current player state fresh to get accurate resources
  const { getPlayerById } = require('../../engine/gameState');
  const freshPlayer = getPlayerById(player.id);

  // Simulate options object
  const fakeInteraction = {
    ...interaction,
    options: {
      getString: (name) => name === 'card' ? cardCode : null,
    },
    // Preserve update/reply/editReply from real interaction
  };

  // Call the existing execute with the fake interaction
  // This is cleaner than duplicating all play logic
  return module.exports.execute(fakeInteraction);
}

module.exports.executePlayCard = executePlayCard;
```

> **⚠️ Warning:** The `fakeInteraction` approach for `play.js`, `use.js`, and `exhaust.js` is a shortcut. These `execute` functions call `interaction.deferReply()` and `interaction.editReply()` internally, which will conflict with the action hub's `interaction.update()` flow. If the fake interaction causes errors, extract the core logic directly (read card, check cost, deduct resources, call `playAsset`/`discardCard`/`useCharge`, post card image) into a standalone function, same pattern as `executeFightAction`. Do not call `execute` via a fake object — refactor instead.

- [ ] **Step 2: Add `executeUseAsset` to `use.js`**

```bash
cat bot/commands/game/use.js
```

Add at end:

```javascript
async function executeUseAsset(interaction, player, session, assetCode) {
  const fakeInteraction = {
    ...interaction,
    options: {
      getString: (name) => name === 'asset' ? assetCode : null,
      getInteger: () => null,
    },
  };
  return module.exports.execute(fakeInteraction);
}

module.exports.executeUseAsset = executeUseAsset;
```

- [ ] **Step 3: Add `executeExhaustAsset` to `exhaust.js`**

```bash
cat bot/commands/game/exhaust.js
```

Add at end:

```javascript
async function executeExhaustAsset(interaction, player, session, assetCode) {
  const fakeInteraction = {
    ...interaction,
    options: {
      getString: (name) => name === 'asset' ? assetCode : null,
    },
  };
  return module.exports.execute(fakeInteraction);
}

module.exports.executeExhaustAsset = executeExhaustAsset;
```

- [ ] **Step 4: Add `executeTestAction` to `test.js`**

```bash
cat bot/commands/game/test.js
```

Add at end:

```javascript
async function executeTestAction(interaction, player, session, stat, difficulty, commitCodes = []) {
  const { getPlayerById, updatePlayer } = require('../../engine/gameState');
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
    const skills = getCardSkills(code);
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
```

- [ ] **Step 5: Manual test**

1. Restart bot
2. `/action` → **Play Card** → select card → confirm play
3. `/action` → **Use Asset** → select asset → confirm charge spent
4. `/action` → **Exhaust** → select asset → confirm toggle
5. `/action` → **Skill Test** → modal → fill stat + difficulty → select commit → confirm result

- [ ] **Step 6: Commit**

```bash
git add bot/commands/game/play.js bot/commands/game/use.js bot/commands/game/exhaust.js bot/commands/game/test.js
git commit -m "feat: extract execute functions from play/use/exhaust/test for action hub"
```

---

## Task 11: Extract `executeMoveAction` from `move.js`

**Files:**
- Modify: `bot/commands/game/move.js`

- [ ] **Step 1: Add `executeMoveAction` at end of `move.js`**

```javascript
async function executeMoveAction(interaction, player, session, locationCode) {
  const { getLocation, getLocations, updatePlayer } = require('../../engine/gameState');
  const { revealLocation, updateLocationStatus } = require('../../engine/locationManager');

  const locations = getLocations(session.id);
  const loc = locations.find(l => l.code === locationCode);
  if (!loc) {
    const msg = { content: `❌ Location not found: ${locationCode}`, flags: 64 };
    return interaction.update ? interaction.update(msg) : interaction.reply(msg);
  }

  updatePlayer(player.id, { location_code: loc.code });

  if (loc.status === 'hidden') {
    await revealLocation(interaction.guild, session, loc);
  }

  const locCh = interaction.guild.channels.cache.get(loc.channel_id);
  if (locCh) {
    const { getPlayerById } = require('../../engine/gameState');
    const fresh = getPlayerById(player.id);
    await locCh.send(`🚶 **${fresh.investigator_name}** moves to **${loc.name}**.`);
  }

  const replyContent = { content: `✅ Moved to **${loc.name}**.`, components: [], flags: 64 };
  return interaction.update ? interaction.update(replyContent) : interaction.reply(replyContent);
}

module.exports.executeMoveAction = executeMoveAction;
```

- [ ] **Step 2: Manual test**

1. `/action` → **Move** → select location → confirm move + location reveal if hidden

- [ ] **Step 3: Commit**

```bash
git add bot/commands/game/move.js
git commit -m "feat: extract executeMoveAction for action hub"
```

---

## Task 12: Restrict Existing Game Commands to Administrator

**Files:**
- Modify: All `bot/commands/game/*.js` action commands (all except `action.js`, `card.js`, `stats.js`, `dashboard.js`, `hand.js`)

- [ ] **Step 1: Add `setDefaultMemberPermissions` to each command**

For every command in `bot/commands/game/` that isn't `/action`, `/card`, `/stats`, `/dashboard`, `/hand` (lookup/info commands), add to the `SlashCommandBuilder`:

```javascript
.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
```

And at top of each file, ensure `PermissionFlagsBits` is imported:

```javascript
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
```

Files to update:
- `advance.js`, `clue.js`, `commit.js`, `damage.js`, `discard.js`, `doom.js`, `draw.js`
- `enemy.js`, `enemyphase.js`, `evade.js`, `exhaust.js`, `fight.js`, `heal.js`
- `horror.js`, `investigate.js`, `move.js`, `mythos.js`, `nextphase.js`, `play.js`
- `pull.js`, `resolved.js`, `resource.js`, `reveal.js`, `scry.js`, `subdeck.js`
- `test.js`, `use.js`

Also `commands/pregame/join.js`, `investigator.js`, and `commands/game/mulligan.js` stay public (no restriction) — players need direct access to these.

- [ ] **Step 2: Deploy updated commands**

```bash
cd bot && node deploy-commands.js
```

- [ ] **Step 3: Manual test**

Log in as a non-admin Discord user. Confirm `/fight`, `/move`, etc. do not appear in autocomplete. Confirm `/action` does appear.

- [ ] **Step 4: Commit**

```bash
git add bot/commands/game/
git commit -m "feat: restrict game action commands to Administrator — players use /action"
```

---

## Task 13: Update `CHEATSHEET.md`

**Files:**
- Modify: `CHEATSHEET.md`

- [ ] **Step 1: Update round flow at top**

Replace:
```
3. ENEMY PHASE   → Host runs /nextphase  (enemies move & attack)
```
With:
```
3. ENEMY PHASE   → Host runs /enemyphase (enemies move & attack)
```

- [ ] **Step 2: Add `/action` as primary player command in "Your 3 Actions" section**

Add at top of the "Your 3 Actions Per Round" section:

```markdown
> **Players:** Use `/action` to take all actions via an interactive guided menu.
> The individual commands below are available to the **Host/admin** as an escape hatch.
```

- [ ] **Step 3: Add `/mulligan` to Pregame Setup table**

```markdown
| `/mulligan` | After `/startgame` deals hands, swap unwanted cards. Interactive select. Round 1 only. |
```

- [ ] **Step 4: Add `/engage` to Enemies table**

```markdown
| `/engage enemy_id:<id>` | Engage an **Aloof** enemy at your location (costs 1 action). |
```

Also add to enemy keywords section:
```
- **Aloof:** Does not activate until engaged with `/engage`.
```

Replace old Aloof line:
```
- **Aloof:** Doesn't engage automatically; must be engaged with a Fight or Engage action.
```

- [ ] **Step 5: Update Phase Commands table**

Add row:
```markdown
| `/enemyphase` | **Host.** Activate all enemies: hunters move, engaged enemies attack. |
```

Update `/nextphase` description:
```markdown
| `/nextphase` | Advance phase: Investigation → Enemy → Upkeep → (loop). Run **after** `/enemyphase`. |
```

- [ ] **Step 6: Commit**

```bash
git add CHEATSHEET.md
git commit -m "docs: update cheatsheet for /action, /mulligan, /engage, /enemyphase"
```

---

## Task 14: Deploy, Smoke Test, Push

- [ ] **Step 1: Deploy commands**

```bash
cd bot && node deploy-commands.js
```

Expected: lists all registered commands including `action`, `mulligan`, `engage`.

- [ ] **Step 2: Restart bot**

```bash
pkill -f "node.*index.js" && node index.js >> /tmp/arkham-bot.log 2>&1 &
sleep 2 && tail -5 /tmp/arkham-bot.log
```

Expected: `✅ Logged in as ArkhamHorror#9601`

- [ ] **Step 3: Full scenario smoke test**

Run through one full game round:
1. `/startgame` → hands dealt
2. `/mulligan` → swap cards, Done
3. `/action` → Move → works
4. `/action` → Investigate → with and without commit → token drawn
5. `/action` → Fight (spawn enemy first with `/enemy spawn`) → with commit → hit/miss
6. `/action` → Evade → works
7. `/action` → Engage (spawn aloof enemy) → clears aloof
8. `/nextphase` → enemy phase checklist posts
9. `/enemyphase` → activates enemies
10. `/nextphase` → upkeep runs, hand-size warning if >8
11. `/nextphase` → mythos / new round

- [ ] **Step 4: Verify non-admin can't see action commands**

Log in as regular Discord member → confirm only `/action`, `/join`, `/investigator`, `/card`, `/stats`, `/dashboard`, `/hand`, `/pull` visible.

- [ ] **Step 5: Push to main**

```bash
git push origin main
```

- [ ] **Step 6: Delete local branches (if any)**

```bash
git branch | grep -v main | xargs git branch -d 2>/dev/null || true
```
