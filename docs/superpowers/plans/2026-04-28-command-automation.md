# Command Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rules-correct enemy activation phase and automatic agenda advancement when doom threshold is reached at end of mythos.

**Architecture:** Extract shared agenda-advance logic into `engine/advanceEngine.js` so both the `/advance` command and the auto-trigger in `nextphase.js` call the same function. Add `activateEnemies()` to `enemyEngine.js` and wire it to a new `/enemyphase` command. Add `is_hunter` column to the `enemies` table via migration.

**Tech Stack:** discord.js v14, better-sqlite3 (synchronous), Node.js. No test framework — all testing is manual via the running bot.

**Already implemented (no work needed):**
- Auto-upkeep (enemy → upkeep in `nextphase.js` already processes resource/draw/ready for all players)
- Auto-defeat at 0 HP (`enemy.js` damage subcommand already calls `defeatEnemy` when HP reaches 0)

---

## File Map

| File | Change |
|------|--------|
| `bot/db/database.js` | Add `is_hunter` migration to enemies table |
| `bot/engine/advanceEngine.js` | **NEW** — `advanceAgenda(guild, session, scenario)` extracted from `advance.js` |
| `bot/engine/enemyEngine.js` | Add `activateEnemies(guild, session, players)` |
| `bot/commands/game/advance.js` | Replace inline agenda logic with call to `advanceEngine.advanceAgenda()` |
| `bot/commands/game/enemy.js` | Add `is_hunter` boolean option to `spawn` subcommand |
| `bot/commands/game/enemyphase.js` | **NEW** — `/enemyphase` command |
| `bot/commands/game/nextphase.js` | Replace doom warning with auto-advance call after mythos encounters resolve |
| `bot/deploy-commands.js` | Re-run after adding `/enemyphase` |

---

## Task 1: Add `is_hunter` DB Migration

**Files:**
- Modify: `bot/db/database.js:139-152`

- [ ] **Step 1: Add migration**

In `bot/db/database.js`, inside the `init()` function, after the existing `sessionCols` migration block (after line 151), add:

```js
  const enemyCols = db.prepare("PRAGMA table_info(enemies)").all().map(c => c.name);
  if (!enemyCols.includes('is_hunter')) {
    db.exec("ALTER TABLE enemies ADD COLUMN is_hunter INTEGER DEFAULT 0");
  }
```

- [ ] **Step 2: Verify migration runs**

```bash
cd bot
node -e "require('./db/database').getDb(); console.log('OK')"
```

Expected output: `OK` (no errors)

- [ ] **Step 3: Confirm column exists**

```bash
node -e "
const db = require('./db/database').getDb();
const cols = db.prepare('PRAGMA table_info(enemies)').all().map(c => c.name);
console.log(cols.includes('is_hunter') ? 'is_hunter: OK' : 'MISSING');
"
```

Expected: `is_hunter: OK`

- [ ] **Step 4: Commit**

```bash
git add bot/db/database.js
git commit -m "feat: add is_hunter column to enemies table"
```

---

## Task 2: Extract Agenda Advance Logic into Engine

**Files:**
- Create: `bot/engine/advanceEngine.js`
- Modify: `bot/commands/game/advance.js`

The agenda advance logic in `advance.js` is currently tied to the interaction object. This task extracts it to a function that takes `guild` + `session` + `scenario` so `nextphase.js` can call it without an interaction.

- [ ] **Step 1: Create `bot/engine/advanceEngine.js`**

```js
const { AttachmentBuilder, ChannelType } = require('discord.js');
const { updateSession, updatePlayer, getCampaign, getPlayers, getLocation } = require('./gameState');
const { findCardByCode } = require('./cardLookup');
const { revealLocation } = require('./locationManager');
const { getDb } = require('../db/database');

/**
 * Advance the agenda to the next index.
 * Returns 'advanced', 'defeat', or 'no_more' (already at final agenda).
 */
async function advanceAgenda(guild, session, scenario) {
  const nextIndex = session.agenda_index + 1;
  if (nextIndex >= scenario.agendas.length) {
    const doomCh = guild.channels.cache.get(session.doom_channel_id);
    if (doomCh) await doomCh.send('💀 **Final agenda reached — scenario defeat!**');
    return 'defeat';
  }

  const newAgenda = scenario.agendas[nextIndex];
  const newThreshold = newAgenda.doom_threshold;
  updateSession(session.id, { agenda_index: nextIndex, doom: 0, doom_threshold: newThreshold });

  const agendaCh = guild.channels.cache.get(session.agenda_channel_id);
  if (agendaCh) {
    const result = findCardByCode(newAgenda.card_code);
    if (result?.imagePath) {
      const att = new AttachmentBuilder(result.imagePath, { name: 'agenda.png' });
      await agendaCh.send({
        content: `📋 **Agenda ${nextIndex + 1}: ${newAgenda.name}** — Doom: 0/${newThreshold}`,
        files: [att],
      });
    } else {
      await agendaCh.send(`📋 **Agenda ${nextIndex + 1}: ${newAgenda.name}** — Doom: 0/${newThreshold}`);
    }
  }

  const doomCh = guild.channels.cache.get(session.doom_channel_id);
  if (doomCh) {
    await doomCh.send(`⚠️ Agenda advanced: **${newAgenda.name}** — doom reset to 0/${newThreshold}`);
  }

  return 'advanced';
}

/**
 * Advance the act to the next index.
 * Returns 'advanced' or 'no_more'.
 */
async function advanceAct(guild, session, scenario) {
  const nextIndex = session.act_index + 1;
  if (nextIndex >= scenario.acts.length) return 'no_more';

  updateSession(session.id, { act_index: nextIndex });
  const newAct = scenario.acts[nextIndex];

  const actCh = guild.channels.cache.get(session.act_channel_id);
  if (actCh) {
    const result = findCardByCode(newAct.card_code);
    if (result?.imagePath) {
      const att = new AttachmentBuilder(result.imagePath, { name: 'act.png' });
      await actCh.send({ content: `📖 **Act ${nextIndex + 1}: ${newAct.name}**`, files: [att] });
    } else {
      await actCh.send(`📖 **Act ${nextIndex + 1}: ${newAct.name}**`);
    }
  }

  // Unlock next act category, lock previous
  const prevCatName = `🔍 ACT ${nextIndex} —`;
  const nextCatName = `🔒 ACT ${nextIndex + 1} —`;
  const prevCat = guild.channels.cache.find(c =>
    c.type === ChannelType.GuildCategory && c.name.startsWith(prevCatName));
  if (prevCat) {
    await prevCat.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
  }
  const nextCat = guild.channels.cache.find(c =>
    c.type === ChannelType.GuildCategory && c.name.startsWith(nextCatName));
  if (nextCat) {
    await nextCat.permissionOverwrites.delete(guild.roles.everyone);
    await nextCat.setName(nextCat.name.replace('🔒', '🔍'));
  }

  const doomCh = guild.channels.cache.get(session.doom_channel_id);
  if (doomCh) await doomCh.send(`📖 Act advanced: **${newAct.name}**`);

  // Auto-move all investigators if the act specifies a forced location
  if (newAct.move_investigators_to) {
    const campaign = getCampaign();
    const players = getPlayers(campaign.id).filter(p => !p.is_eliminated);
    const db = getDb();
    const locRow = db.prepare('SELECT * FROM locations WHERE session_id = ? AND code = ?')
      .get(session.id, newAct.move_investigators_to);

    if (locRow && locRow.status === 'hidden') {
      await revealLocation(guild, session, locRow, players);
    }

    for (const p of players) {
      updatePlayer(p.id, { location_code: newAct.move_investigators_to });
    }

    const locName = locRow?.name || newAct.move_investigators_to;
    if (doomCh) await doomCh.send(`📍 All investigators moved to **${locName}** as required by the act.`);
  }

  return 'advanced';
}

module.exports = { advanceAgenda, advanceAct };
```

- [ ] **Step 2: Update `bot/commands/game/advance.js` to use the engine**

Replace the entire file content:

```js
const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requireHost } = require('../../engine/gameState');
const { advanceAgenda, advanceAct } = require('../../engine/advanceEngine');
const { loadScenario } = require('../../engine/scenarioLoader');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('advance')
    .setDescription('Advance the act or agenda. Host only.')
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('What to advance')
        .setRequired(true)
        .addChoices({ name: 'act', value: 'act' }, { name: 'agenda', value: 'agenda' })),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const host = requireHost(interaction);
    if (!host) return;

    await interaction.deferReply();

    const scenario = loadScenario(session);
    if (!scenario) {
      return interaction.editReply('❌ Scenario data not found. Check that the scenario file exists.');
    }

    const type = interaction.options.getString('type');

    if (type === 'act') {
      const result = await advanceAct(interaction.guild, session, scenario);
      if (result === 'no_more') return interaction.editReply('No more acts to advance.');
      const nextAct = scenario.acts[session.act_index + 1];
      return interaction.editReply(`✅ Act advanced to **${nextAct.name}**.`);
    }

    if (type === 'agenda') {
      const result = await advanceAgenda(interaction.guild, session, scenario);
      if (result === 'defeat') return interaction.editReply('💀 Final agenda reached — scenario defeat!');
      const nextAgenda = scenario.agendas[session.agenda_index + 1];
      return interaction.editReply(`✅ Agenda advanced to **${nextAgenda.name}**. Doom reset to 0/${nextAgenda.doom_threshold}.`);
    }
  },
};
```

- [ ] **Step 3: Manual test — verify `/advance agenda` still works**

Start the bot and run `/advance agenda` during a game. Verify:
- New agenda card image posts to #agenda
- Doom resets to 0 in #doom-track
- Advance announcement posts to #doom-track

- [ ] **Step 4: Manual test — verify `/advance act` still works**

Run `/advance act`. Verify:
- New act card posts to #act
- Previous act category hides, next unlocks
- `move_investigators_to` auto-moves players if set in scenario JSON

- [ ] **Step 5: Commit**

```bash
git add bot/engine/advanceEngine.js bot/commands/game/advance.js
git commit -m "refactor: extract agenda/act advance logic to advanceEngine"
```

---

## Task 3: Auto-Advance Agenda at End of Mythos

**Files:**
- Modify: `bot/commands/game/nextphase.js:88-108`

The upkeep → mythos transition in `nextphase.js` currently posts a warning when doom hits threshold. Replace the warning with a call to `advanceAgenda`.

- [ ] **Step 1: Update imports in `nextphase.js`**

Add `advanceAgenda` to the imports at the top of `bot/commands/game/nextphase.js`:

```js
const { advanceAgenda } = require('../../engine/advanceEngine');
const { loadScenario } = require('../../engine/scenarioLoader');
```

(Both lines go with the existing `require` block at the top of the file.)

- [ ] **Step 2: Replace the doom threshold warning with auto-advance**

Find this block in `nextphase.js` (around line 98-101):

```js
      const afterSession = getSession();
      if (afterSession.doom >= afterSession.doom_threshold) {
        if (doomCh) await doomCh.send('⚠️ **Doom threshold reached! Use `/advance agenda`.**');
      }
```

Replace with:

```js
      const afterSession = getSession();
      if (afterSession.doom >= afterSession.doom_threshold) {
        const scenario = loadScenario(afterSession);
        if (scenario) {
          if (doomCh) await doomCh.send('☠️ **Doom threshold reached — agenda advancing automatically...**');
          await advanceAgenda(interaction.guild, afterSession, scenario);
        } else {
          if (doomCh) await doomCh.send('⚠️ **Doom threshold reached! Use `/advance agenda`.**');
        }
      }
```

- [ ] **Step 3: Manual test — doom threshold auto-advance**

Start a game. Use `/doom add` to bring doom to one below threshold. Run `/nextphase` from upkeep (which triggers mythos). Verify:
- After encounter cards resolve, bot posts "Doom threshold reached — agenda advancing automatically..."
- New agenda card appears in #agenda
- Doom resets to 0 in #doom-track
- No "Use `/advance agenda`" message appears

- [ ] **Step 4: Manual test — doom below threshold stays normal**

Start a fresh game. Keep doom well below threshold. Run `/nextphase`. Verify mythos resolves normally with no agenda advance.

- [ ] **Step 5: Commit**

```bash
git add bot/commands/game/nextphase.js
git commit -m "feat: auto-advance agenda when doom threshold reached at end of mythos"
```

---

## Task 4: Add is_hunter to `/enemy spawn`

**Files:**
- Modify: `bot/commands/game/enemy.js:11-24`

- [ ] **Step 1: Add `is_hunter` option to spawn subcommand**

In `bot/commands/game/enemy.js`, inside the `spawn` subcommand builder (after the `horror` option), add:

```js
      .addBooleanOption(o => o.setName('hunter').setDescription('Is this enemy a Hunter (moves toward investigators)?'))
```

- [ ] **Step 2: Pass `is_hunter` to `spawnEnemy` and `spawnEnemyManual`**

In the `spawn` handler in `execute()`, read the new option and pass it. Find the `spawnEnemy` call (around line 56):

```js
        enemyId = spawnEnemy(session.id, loc.code, {
          code: c.code,
          name: c.name,
          health: interaction.options.getInteger('hp') || fullCard.health || c.health || 1,
          enemy_fight: interaction.options.getInteger('fight') || fullCard.enemy_fight || c.enemy_fight || 1,
          enemy_evade: interaction.options.getInteger('evade') || fullCard.enemy_evade || c.enemy_evade || 1,
          enemy_damage: interaction.options.getInteger('damage') ?? fullCard.enemy_damage ?? c.enemy_damage ?? 1,
          enemy_horror: interaction.options.getInteger('horror') ?? fullCard.enemy_horror ?? c.enemy_horror ?? 1,
          is_hunter: interaction.options.getBoolean('hunter') ? 1 : 0,
        });
```

Find the `spawnEnemyManual` call (around line 74):

```js
        enemyId = spawnEnemyManual(
          session.id, loc.code, nameQuery,
          interaction.options.getInteger('hp') || 1,
          interaction.options.getInteger('fight') || 1,
          interaction.options.getInteger('evade') || 1,
          interaction.options.getInteger('damage') ?? 1,
          interaction.options.getInteger('horror') ?? 1,
          interaction.options.getBoolean('hunter') ? 1 : 0,
        );
```

- [ ] **Step 3: Update `spawnEnemy` and `spawnEnemyManual` in `enemyEngine.js`**

In `bot/engine/enemyEngine.js`, update both functions to include `is_hunter`:

```js
function spawnEnemy(sessionId, locationCode, cardData) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO enemies (session_id, location_code, card_code, name, hp, max_hp, fight, evade, damage, horror, is_hunter)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    locationCode,
    cardData.code,
    cardData.name,
    cardData.health || 1,
    cardData.health || 1,
    cardData.enemy_fight || 1,
    cardData.enemy_evade || 1,
    cardData.enemy_damage || 1,
    cardData.enemy_horror || 1,
    cardData.is_hunter || 0,
  );
  return result.lastInsertRowid;
}

function spawnEnemyManual(sessionId, locationCode, name, hp, fight, evade, damage, horror, isHunter = 0) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO enemies (session_id, location_code, card_code, name, hp, max_hp, fight, evade, damage, horror, is_hunter)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, locationCode, 'manual', name, hp, hp, fight, evade, damage, horror, isHunter);
  return result.lastInsertRowid;
}
```

- [ ] **Step 4: Commit**

```bash
git add bot/commands/game/enemy.js bot/engine/enemyEngine.js
git commit -m "feat: add is_hunter option to /enemy spawn"
```

---

## Task 5: Enemy Activation Engine Function

**Files:**
- Modify: `bot/engine/enemyEngine.js`

- [ ] **Step 1: Add `activateEnemies` to `enemyEngine.js`**

Add this function to `bot/engine/enemyEngine.js` (before `module.exports`):

```js
/**
 * Activate all enemies for the current enemy phase.
 *
 * Hunter + not engaged (no investigator at enemy location):
 *   → Move enemy to an investigator's location, then attack.
 * Engaged (any investigator at same location as enemy) OR non-hunter at same location:
 *   → Attack the investigator at that location.
 * Non-hunter + not engaged:
 *   → No action.
 *
 * "Nearest" is simplified: any investigator's location (first non-eliminated player).
 * Adjacency is not modelled — this is a known simplification.
 *
 * Returns an array of result strings for the summary message.
 */
async function activateEnemies(guild, session, players) {
  const { getEnemies, getLocation, updateEnemy, updatePlayer, getPlayerById } = require('./gameState');
  const { updateLocationStatus } = require('./locationManager');

  const enemies = getEnemies(session.id);
  const activePlayers = players.filter(p => !p.is_eliminated);
  const results = [];

  for (const enemy of enemies) {
    if (enemy.is_exhausted) {
      results.push(`💤 **${enemy.name}** [${enemy.id}] is exhausted — skipped.`);
      continue;
    }

    // Check if any investigator is at this enemy's location (engaged)
    const engagedPlayer = activePlayers.find(p => p.location_code === enemy.location_code);

    if (!engagedPlayer && !enemy.is_hunter) {
      // Non-hunter, not engaged — no action
      continue;
    }

    let target = engagedPlayer;

    if (!engagedPlayer && enemy.is_hunter) {
      // Move hunter to first available investigator's location
      const dest = activePlayers[0];
      if (!dest) continue;

      const db = require('../db/database').getDb();
      db.prepare('UPDATE enemies SET location_code = ? WHERE id = ?').run(dest.location_code, enemy.id);

      const oldLoc = getLocation(session.id, enemy.location_code);
      const newLoc = getLocation(session.id, dest.location_code);
      if (oldLoc) await updateLocationStatus(guild, session, oldLoc);
      if (newLoc) await updateLocationStatus(guild, session, newLoc);

      const newLocCh = newLoc ? guild.channels.cache.get(newLoc.channel_id) : null;
      if (newLocCh) {
        await newLocCh.send(`👹 **${enemy.name}** hunts toward **${dest.investigator_name}** in **${newLoc.name}**!`);
      }

      target = dest;
    }

    if (!target) continue;

    // Attack target
    const freshTarget = getPlayerById(target.id);
    const newHp = Math.max(0, freshTarget.hp - enemy.damage);
    const newSan = Math.max(0, freshTarget.sanity - enemy.horror);
    updatePlayer(freshTarget.id, { hp: newHp, sanity: newSan });

    // Post attack in investigator's hand channel
    const safeName = freshTarget.investigator_name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-hand';
    const handCh = guild.channels.cache.find(c => c.name === safeName);
    const attackMsg = [
      `👹 **${enemy.name}** attacks **${freshTarget.investigator_name}**!`,
      `🩸 ${enemy.damage} damage (HP: ${freshTarget.hp} → ${newHp}/${freshTarget.max_hp})`,
      `😱 ${enemy.horror} horror (SAN: ${freshTarget.sanity} → ${newSan}/${freshTarget.max_sanity})`,
    ].join('\n');
    if (handCh) await handCh.send(attackMsg);

    // Check elimination
    if (newHp === 0 || newSan === 0) {
      updatePlayer(freshTarget.id, { is_eliminated: 1 });
      const { addCampaignLog, getCampaign } = require('./gameState');
      const campaign = getCampaign();
      const cause = newHp === 0 ? 'physical damage' : 'horror';
      addCampaignLog(campaign.id, session.scenario_code, `${freshTarget.investigator_name} was eliminated by ${cause} during enemy phase.`);
      if (handCh) await handCh.send(`💀 **${freshTarget.investigator_name}** has been eliminated!`);
    }

    const resultLine = enemy.is_hunter && !engagedPlayer
      ? `🏃 **${enemy.name}** [${enemy.id}] hunted + attacked **${target.investigator_name}** (${enemy.damage} dmg / ${enemy.horror} hor)`
      : `⚔️ **${enemy.name}** [${enemy.id}] attacked **${target.investigator_name}** (${enemy.damage} dmg / ${enemy.horror} hor)`;
    results.push(resultLine);
  }

  return results;
}
```

Update `module.exports`:

```js
module.exports = { spawnEnemy, spawnEnemyManual, damageEnemy, defeatEnemy, activateEnemies };
```

- [ ] **Step 2: Commit**

```bash
git add bot/engine/enemyEngine.js
git commit -m "feat: add activateEnemies engine function"
```

---

## Task 6: New `/enemyphase` Command

**Files:**
- Create: `bot/commands/game/enemyphase.js`

- [ ] **Step 1: Create the command file**

```js
const { SlashCommandBuilder } = require('discord.js');
const { requireSession, requireHost, getSession, getCampaign, getPlayers } = require('../../engine/gameState');
const { activateEnemies } = require('../../engine/enemyEngine');
const { updateDoomTrack } = require('../../engine/doomTrack');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('enemyphase')
    .setDescription('Trigger enemy activation. Hunter enemies move and attack. Host only.'),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const host = requireHost(interaction);
    if (!host) return;

    await interaction.deferReply();

    const campaign = getCampaign();
    const players = getPlayers(campaign.id);
    const doomCh = interaction.guild.channels.cache.get(session.doom_channel_id);

    const results = await activateEnemies(interaction.guild, session, players);

    if (results.length === 0) {
      if (doomCh) await doomCh.send(`## 👹 Enemy Phase — Round ${session.round}\n\nNo enemies activated.`);
      return interaction.editReply('✅ Enemy phase complete — no enemies activated.');
    }

    const summary = [
      `## 👹 Enemy Phase — Round ${session.round}`,
      '',
      ...results,
      '',
      'Enemy activation complete. Use `/nextphase` to continue to upkeep.',
    ].join('\n');

    if (doomCh) await doomCh.send(summary);

    const freshSession = getSession();
    const freshPlayers = getPlayers(campaign.id).filter(p => !p.is_eliminated);
    await updateDoomTrack(doomCh, freshSession.doom, freshSession.doom_threshold, freshSession.round, 'Enemy', freshPlayers);

    return interaction.editReply(`✅ Enemy phase complete. ${results.length} enemi${results.length !== 1 ? 'es' : 'y'} activated. Check #doom-track for summary.`);
  },
};
```

- [ ] **Step 2: Deploy commands**

```bash
cd bot
node deploy-commands.js
```

Expected: output lists all commands including `enemyphase`.

- [ ] **Step 3: Commit**

```bash
git add bot/commands/game/enemyphase.js
git commit -m "feat: add /enemyphase command with auto hunter movement and attack"
```

---

## Task 7: Manual Integration Test

No automated test suite exists. Run a full game loop to verify all four automations interact correctly.

- [ ] **Step 1: Start bot**

```bash
cd bot
node index.js
```

- [ ] **Step 2: Test enemy phase with hunter enemy**

1. Start a game (`/startgame`)
2. Spawn a hunter enemy: `/enemy spawn name:Ghoul Minion location:study hunter:True`
3. Move an investigator away from Study to another location: `/move`
4. Run `/enemyphase`

Expected:
- Bot posts in #doom-track: enemy hunted to investigator's location and attacked
- Bot posts attack message in investigator's hand channel (damage + horror numbers)
- Location status pins update for old and new enemy location

- [ ] **Step 3: Test non-hunter unengaged enemy — no activation**

1. Spawn a non-hunter enemy somewhere no investigator is: `/enemy spawn name:Ghoul Minion location:cellar`
2. Ensure no investigators are in cellar
3. Run `/enemyphase`

Expected: "No enemies activated." or the non-hunter enemy does not appear in the summary.

- [ ] **Step 4: Test doom auto-advance**

1. Use `/doom add` to bring doom to `threshold - 1`
2. Run `/nextphase` from upkeep (which triggers mythos)

Expected:
- After encounters resolve, bot posts "Doom threshold reached — agenda advancing automatically..."
- New agenda card appears in #agenda
- Doom track shows 0/new_threshold

- [ ] **Step 5: Verify `/advance agenda` still works manually**

Run `/advance agenda` directly. Verify it still posts new agenda card and resets doom.

- [ ] **Step 6: Final commit if any last-minute fixes needed**

```bash
git add -p   # stage only what changed
git commit -m "fix: <describe fix>"
```

---

## Self-Review Checklist

- [x] `is_hunter` migration added and checked before use
- [x] `advanceAgenda` called both from `/advance agenda` and auto-trigger in `/nextphase`
- [x] `activateEnemies` handles: hunter+not-engaged (move+attack), engaged (attack), non-hunter+not-engaged (skip), exhausted (skip)
- [x] Elimination check after enemy attack (HP=0 or SAN=0)
- [x] All new functions exported in `module.exports`
- [x] `/enemyphase` requires host
- [x] `deploy-commands.js` run after adding new command
- [x] `spawnEnemy` and `spawnEnemyManual` both updated for `is_hunter`
