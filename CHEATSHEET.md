# Arkham Horror LCG — Discord Bot Cheatsheet

## How a Round Works

```
1. MYTHOS PHASE  → Host runs /mythos (places doom, draws encounter cards)
2. INVESTIGATION → Each investigator takes 3 actions
3. ENEMY PHASE   → Host runs /enemyphase (enemies move & attack), then /nextphase
4. UPKEEP        → Host runs /nextphase  (ready cards, gain 1 resource, draw 1 card)
5. REPEAT from 1
```

---

## Pregame Setup

| Command | What it does |
|---------|-------------|
| `/join` | Join the campaign. First player becomes **Host**. |
| `/investigator name:<search>` | Pick your investigator. Autocomplete searches all investigators. |
| `/investigator name:<search> deck_url:<arkhamdb url>` | Pick investigator and import a custom deck from ArkhamDB in one step. |
| `/startgame campaign:<c> scenario:<s> difficulty:<d>` | **Host only.** Build Discord channels, deal opening hands, seed the encounter deck. |
| `/mulligan` | After `/startgame` deals hands, swap unwanted cards. Interactive select. Round 1 only. |

> You can re-run `/investigator` to change your choice until the game starts.

---

## Your 3 Actions Per Round

> **Players:** Use `/action` to take all actions via an interactive guided menu.
> The individual commands below are available to the **Host/admin** as an escape hatch.

Every investigator gets **3 actions** each investigation phase. Each slash command below costs **1 action** unless noted.

### Move
```
/move location:<name>
```
Move to a connected location. If the location is hidden, it is automatically revealed when you enter.

### Draw a Card
```
/draw
/draw count:<1-10>
```
Draw cards from your deck. If your deck is empty, your discard pile is reshuffled automatically. Your pinned hand display in your private channel updates automatically.

### Gain a Resource
```
/resource
```
Gain 1 resource token.

### Investigate *(Intellect vs Shroud)*
```
/investigate
/investigate stat:<skill>
/investigate card1:<skill card> card2:<skill card> ...
/investigate bonus_clues:<n>
```
Test your **Intellect** (or another stat via `stat`) against the current location's **Shroud** value. Optionally commit up to 4 skill cards — their matching and Wild icons each add +1.

- **Success** (total ≥ shroud): collect 1 clue (+ `bonus_clues` if an asset grants extra).
- **Fail**: nothing happens.
- The chaos token is drawn automatically. Auto-fail always fails; Elder Sign always adds +1.

### Fight *(Combat vs Enemy Fight)*
```
/fight enemy_id:<id>
/fight enemy_id:<id> stat:<skill> damage:<n> bonus_damage:<n> card1:<skill card> ...
```
Attack an enemy. Test **Combat** (or another stat) against the enemy's **Fight** rating.

- **Success**: deal damage (default 1, or `damage` + `bonus_damage` from an asset ability). Enemy defeated at 0 HP.
- **Fail**: attack misses.
- Find enemy IDs with `/enemy list`.

### Evade *(Agility vs Enemy Evade)*
```
/evade enemy_id:<id>
/evade enemy_id:<id> stat:<skill> card1:<skill card> ...
```
Slip past an enemy. Test **Agility** (or another stat) against the enemy's **Evade** rating.

- **Success**: enemy becomes **exhausted** and disengaged. It will not attack this round.
- **Fail**: nothing happens, enemy stays engaged.

### Generic Skill Test *(Treachery, Parley, etc.)*
```
/test stat:<skill> difficulty:<n>
/test stat:<skill> difficulty:<n> card1:<skill card> ...
```
Run any skill test against a fixed difficulty number — use this for treachery cards, parley attempts, or any non-standard test.

- Draws a chaos token and applies the modifier automatically.
- Commit up to 4 skill cards to boost the total.

### Play a Card
```
/play card:<name>
```
Play an asset, event, or skill from your hand. Pays the resource cost automatically.

- **Assets** enter play in your area and show in `/dashboard`. Allies and equipment track HP/sanity for soak.
- **Events** resolve immediately and go to discard.
- **Skills** — use `/commit` instead (during a skill test).

### Use an Asset's Ability
```
/use asset:<name>              — spend 1 charge
/use asset:<name> add:<n>      — add n charges (e.g. after a recharge effect)
```
Manage charges on an in-play asset. Asset is discarded automatically when charges reach 0.

### Scry *(look at top of deck, reorder)*
```
/scry reveal [count:<1-10>] [source:<deck or tome>]
/scry place card1:<card> card2:<card> ...
```
Look at the top N cards of a deck (your own, another player's, or a tome's subdeck). Then use `/scry place` to put them back in any order — omitted cards go to the bottom.

### Tome / Asset Subdeck
```
/subdeck init asset:<name> card1:<card> ... [shuffle:true/false]
/subdeck add  asset:<name> card:<card> [bottom:true/false]
/subdeck view asset:<name>
/subdeck clear asset:<name>
```
Attach and manage a mini-deck on an in-play asset (e.g. Daisy's Necronomicon). Once initialized, use `/scry reveal source:<tome name>` to look at and reorder its cards.

### Other Actions (free-form)
Parley, special actions, and card abilities that don't have a dedicated command: resolve them manually and track the effects with `/damage`, `/clue`, `/resource`, etc.

---

## Skill Tests (reference)

| Test Type | Default Skill | Committed Icon |
|-----------|--------------|----------------|
| Investigate | Intellect (🔎) | Intellect or Wild |
| Fight | Combat (⚔️) | Combat or Wild |
| Evade | Agility (💨) | Agility or Wild |
| Generic test | Any (you choose) | Matching stat or Wild |

> All four commands accept an optional `stat` override. Autocomplete shows your investigator's current value for each skill.

**Formula:** Skill + Committed icons + Chaos token modifier ≥ Difficulty → **Success**

Special tokens:
- **Auto-fail (❌):** Always fails, regardless of total.
- **Elder Sign (✨):** +1 to total, plus resolve your investigator's special elder sign ability.
- **Skull/Cultist/Tablet/Elder Thing:** Apply token modifier, then resolve the scenario-specific effect manually.

---

## Card Management

| Command | What it does |
|---------|-------------|
| `/hand` | Refresh the pinned hand display in your private channel. |
| `/draw [count]` | Draw 1–10 cards. Pinned hand updates automatically. |
| `/play card:<name>` | Play an asset, event, or skill (costs resources). |
| `/commit card1 ... card4` | Commit skill cards to the current test. Up to 4 cards. |
| `/discard card:<name>` | Discard a card from your hand to the discard pile. |
| `/use asset:<name> [add:<n>]` | Spend a charge or add charges to an in-play asset. |
| `/exhaust asset:<name>` | Toggle an asset between exhausted and ready. |
| `/card name:<search>` | Look up any card's image (not hand-restricted). |
| `/scry reveal [count] [source]` | Peek at the top N cards of a deck. |
| `/scry place card1 ...` | Put scried cards back in a new order. |
| `/subdeck init/add/view/clear` | Manage a tome or ally's attached card deck. |

---

## Health & Sanity

| Command | What it does |
|---------|-------------|
| `/damage amount:<n>` | Take `n` physical damage (to your HP). Eliminated at 0 HP. |
| `/damage amount:<n> asset:<name>` | Redirect damage to an in-play asset (ally, Bulletproof Vest, etc.). Asset discarded at 0 HP. |
| `/horror amount:<n>` | Take `n` sanity damage. Eliminated at 0 Sanity. |
| `/horror amount:<n> asset:<name>` | Redirect horror to an in-play asset with sanity soak. Asset discarded at 0. |
| `/heal type:<damage\|horror> amount:<n>` | Heal HP or Sanity (capped at max). |
| `/stats` | Show your current HP, Sanity, Resources, Clues, and skill values. |
| `/dashboard` | Post your full investigator status to your private hand channel. |

> Assets with HP or sanity (allies, equipment) show their current/max values in the autocomplete list.

---

## Enemies

| Command | What it does |
|---------|-------------|
| `/enemy list` | List all active enemies with their IDs, locations, and stats. |
| `/enemy spawn name:<n> location:<l>` | **Host.** Spawn an enemy. Stats auto-loaded from card data if found. |
| `/fight enemy_id:<id> [damage:<n>] [bonus_damage:<n>]` | **Host/admin.** Attack an enemy (skill test). Players use `/action`. |
| `/evade enemy_id:<id>` | **Host/admin.** Evade an enemy (skill test). Players use `/action`. |
| `/engage enemy_id:<id>` | Engage an **Aloof** enemy at your location (costs 1 action). |
| `/enemy damage id:<id> amount:<n>` | Deal direct damage to an enemy (no skill test). |
| `/enemy defeat id:<id>` | **Host.** Instantly defeat an enemy. |

**Enemy keywords (resolve manually):**
- **Hunter:** Moves toward the nearest investigator during the Enemy Phase.
- **Aloof:** Does not activate until engaged with `/engage`.
- **Retaliate:** Deals damage/horror to the attacker on a miss.

---

## Locations & Clues

| Command | What it does |
|---------|-------------|
| `/move location:<name>` | Move to a location. Reveals it if hidden. |
| `/investigate [cards]` | Collect a clue from your current location. |
| `/reveal location:<name>` | **Host.** Force-reveal a location without moving to it. |
| `/clue action:<add\|remove> location:<l> count:<n>` | **Host.** Manually adjust clues on a location. |

**Location status:**
- `hidden-` prefix → not yet visited (hidden from players)
- `revealed-` prefix → visited, clues remain
- `🔍・` prefix → active, has clues
- `✅・` prefix → cleared (no clues)

---

## Phase Commands (Host Only)

| Command | What it does |
|---------|-------------|
| `/mythos` | Run the Mythos Phase: place doom, draw encounter cards for all players. |
| `/enemyphase` | **Host.** Activate all enemies: hunters move, engaged enemies attack. |
| `/nextphase` | Advance phase: Investigation → Enemy → Upkeep → (loop). Run **after** `/enemyphase`. |
| `/advance type:<act\|agenda>` | Advance the act or agenda. Posts new card image. Unlocks next act category. |
| `/doom action:<add\|remove> count:<n>` | Manually adjust the doom counter. |
| `/resolved` | Confirm your encounter card has been resolved (removes it from the queue). |

---

## Chaos Bag

| Command | What it does |
|---------|-------------|
| `/pull` | Draw a chaos token and post the result to `#chaos-bag`. Use for standalone skill tests. |
| `/investigate`, `/fight`, `/evade`, `/test` | Automatically draw a token and apply the modifier. |

**Token values by difficulty (standard):**
```
+1, 0, 0, -1, -1, -2, -2, -3, -4, Skull, Skull, Cultist, Tablet, Auto-fail, Elder Sign
```
Harder difficulties replace positive modifiers with larger negatives.

---

## Campaign Commands

| Command | What it does |
|---------|-------------|
| `/campaignlog` | Show all campaign log entries (clues found, deaths, resolutions). |
| `/endscenario result:<victory\|defeat> [resolution:<code>]` | **Host.** End the scenario, calculate XP, apply trauma, advance campaign. |
| `/upgrade list` | Show your deck and available XP for spending. |
| `/upgrade add add_code:<code> [remove_code:<code>]` | Spend XP to add a card (optionally replacing one). |
| `/upgrade remove code:<code>` | Remove a card from your deck (no XP cost). |
| `/upgrade done` | Lock in all between-scenario upgrades. |

---

## System Commands (Host Only)

| Command | What it does |
|---------|-------------|
| `/clear scope:pregame` | Clear the `#pregame` channel only. |
| `/clear scope:bot-log` | Clear the `#bot-log` channel only. |
| `/clear scope:system` | Clear both `#pregame` and `#bot-log`. |
| `/clear scope:all` | **Destructive.** Tear down all game channels and wipe the database. |
| `/newgame` | **Destructive.** Wipe all game channels and reset the database entirely. |

---

## Typical Turn Example

> **Investigation Phase — Roland Banks's turn**
> Players use `/action` → choose action from the interactive menu.

1. **Action 1 — Move**
   `/action` → **Move** → select *Factory* → moved

2. **Action 2 — Fight** (enemy is here)
   `/action` → **Fight** → select enemy → select commit card (*Vicious Blow*) → No commit if skipping
   → Token drawn, Combat vs Fight 4 → Hit! Enemy takes 1 damage.

3. **Action 3 — Investigate**
   `/action` → **Investigate** → select commit card (*Deduction*) or skip
   → Token drawn, Intellect 3 + 1 (INT icon) vs Shroud 3 → Success! Clue collected.

> **Host: `/nextphase` when all investigators are done. Then `/enemyphase` to activate enemies.**

---

## Quick Reference — What Skill for What Test?

| Situation | Command | Default Skill | Stat Override? |
|-----------|---------|--------------|---------------|
| Gather a clue | `/investigate` | Intellect | ✅ yes |
| Hit an enemy | `/fight` | Combat | ✅ yes |
| Slip past an enemy | `/evade` | Agility | ✅ yes |
| Treachery / parley / other | `/test` | You choose | — |
| Standalone token pull | `/pull` | — | — |

---

## Channel Guide

| Channel | Purpose |
|---------|---------|
| `#doom-track` | Live doom counter, phase announcements, round tracker |
| `#agenda` | Current agenda card + doom threshold |
| `#act` | Current act card |
| `#chaos-bag` | All chaos token pulls and skill test results |
| `#encounter-deck` | Encounter cards drawn during Mythos phase |
| `revealed-<location>` / `🔍・<location>` | Location status, enemies, clues pinned here |
| `<investigator>-hand` | Your private channel — pinned hand display, dashboard, card images |
