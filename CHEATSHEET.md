# Arkham Horror LCG — Discord Bot Cheatsheet

## How a Round Works

```
1. MYTHOS PHASE  → Host runs /mythos (places doom, draws encounter cards)
2. INVESTIGATION → Each investigator takes 3 actions
3. ENEMY PHASE   → Host runs /nextphase  (enemies move & attack)
4. UPKEEP        → Host runs /nextphase  (ready cards, gain 1 resource, draw 1 card)
5. REPEAT from 1
```

---

## Pregame Setup

| Command | What it does |
|---------|-------------|
| `/join` | Join the campaign. First player becomes **Host**. |
| `/investigator name:<search>` | Pick your investigator. Autocomplete searches all investigators. |
| `/deck default` | Load the starter deck for your investigator. |
| `/deck import url:<arkhamdb url>` | Import a custom deck from ArkhamDB. |
| `/startgame campaign:<c> scenario:<s> difficulty:<d>` | **Host only.** Build Discord channels, deal opening hands, seed the encounter deck. |

---

## Your 3 Actions Per Round

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
Draw cards from your deck. If your deck is empty, your discard pile is reshuffled automatically.

### Gain a Resource
```
/resource
```
Gain 1 resource token.

### Investigate *(Intellect vs Shroud)*
```
/investigate
/investigate card1:<skill card> card2:<skill card> ...
```
Test your **Intellect** against the current location's **Shroud** value. Optionally commit up to 4 skill cards — their **Intellect** and **Wild** icons each add +1.

- **Success** (total ≥ shroud): collect 1 clue from the location.
- **Fail**: nothing happens.
- The chaos token is drawn automatically. Auto-fail always fails; Elder Sign always adds +1.

### Fight *(Combat vs Enemy Fight)*
```
/fight enemy_id:<id>
/fight enemy_id:<id> damage:<n> card1:<skill card> ...
```
Attack an enemy. Test **Combat** against the enemy's **Fight** rating. Commit cards with **Combat** or **Wild** icons.

- **Success**: deal damage (`damage` option, default 1). Enemy is defeated at 0 HP.
- **Fail**: attack misses.
- Find enemy IDs with `/enemy list`.

### Evade *(Agility vs Enemy Evade)*
```
/evade enemy_id:<id>
/evade enemy_id:<id> card1:<skill card> ...
```
Slip past an enemy. Test **Agility** against the enemy's **Evade** rating. Commit cards with **Agility** or **Wild** icons.

- **Success**: enemy becomes **exhausted** and disengaged. It will not attack this round.
- **Fail**: nothing happens, enemy stays engaged.

### Play a Card
```
/play card:<name>
```
Play an asset, event, or skill from your hand. Pays the resource cost automatically.

- **Assets** enter play in your area and show in `/dashboard`.
- **Events** resolve immediately and go to discard.
- **Skills** — use `/commit` instead (during a skill test).

### Use an Asset's Ability
```
/use asset:<name>
```
Spend 1 charge from an in-play asset. Asset is discarded automatically when charges reach 0.

### Other Actions (free-form)
Parley, special actions, and card abilities that don't have a dedicated command: resolve them manually and track the effects with `/damage`, `/clue`, `/resource`, etc.

---

## Skill Tests (reference)

| Test Type | Skill Used | Committed Icon |
|-----------|-----------|----------------|
| Investigate | Intellect (🔎) | Intellect or Wild |
| Fight | Combat (⚔️) | Combat or Wild |
| Evade | Agility (💨) | Agility or Wild |
| Willpower test | Willpower (🕯️) | Willpower or Wild |

**Formula:** Skill + Committed icons + Chaos token modifier ≥ Difficulty → **Success**

Special tokens:
- **Auto-fail (❌):** Always fails, regardless of total.
- **Elder Sign (✨):** +1 to total, plus resolve your investigator's special elder sign ability.
- **Skull/Cultist/Tablet/Elder Thing:** Pull token modifier, then resolve the scenario-specific effect manually.

---

## Card Management

| Command | What it does |
|---------|-------------|
| `/hand` | Show your current hand (images posted to your private hand channel). |
| `/draw [count]` | Draw 1–10 cards. |
| `/play card:<name>` | Play an asset, event, or skill (costs resources). |
| `/commit card1 ... card4` | Commit skill cards to the current test. Up to 4 cards. |
| `/discard card:<name>` | Discard a card from your hand to the discard pile. |
| `/use asset:<name>` | Spend a charge on an in-play asset. |
| `/exhaust asset:<name>` | Toggle an asset between exhausted and ready. |
| `/card name:<search>` | Look up any card's image (not hand-restricted). |

---

## Health & Sanity

| Command | What it does |
|---------|-------------|
| `/damage amount:<n>` | Take `n` physical damage. Eliminated at 0 HP. |
| `/horror amount:<n>` | Take `n` sanity damage. Eliminated at 0 Sanity. |
| `/heal type:<damage\|horror> amount:<n>` | Heal HP or Sanity (capped at max). |
| `/stats` | Show your current HP, Sanity, Resources, Clues, and skill values. |
| `/dashboard` | Post your full investigator status to your private hand channel. |

---

## Enemies

| Command | What it does |
|---------|-------------|
| `/enemy list` | List all active enemies with their IDs, locations, and stats. |
| `/enemy spawn name:<n> location:<l>` | **Host.** Spawn an enemy. Stats auto-loaded from card data if found. |
| `/fight enemy_id:<id> [damage:<n>]` | Attack an enemy (skill test). |
| `/evade enemy_id:<id>` | Evade an enemy (skill test). |
| `/enemy damage id:<id> amount:<n>` | Deal direct damage to an enemy (no skill test). |
| `/enemy defeat id:<id>` | **Host.** Instantly defeat an enemy. |

**Enemy keywords (resolve manually):**
- **Hunter:** Moves toward the nearest investigator during the Enemy Phase.
- **Aloof:** Doesn't engage automatically; must be engaged with a Fight or Engage action.
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
| `/nextphase` | Advance to the next phase: Investigation → Enemy → Upkeep → (loop). |
| `/advance type:<act\|agenda>` | Advance the act or agenda. Posts new card image. Unlocks next act category. |
| `/doom action:<add\|remove> count:<n>` | Manually adjust the doom counter. |
| `/resolved` | Confirm your encounter card has been resolved (removes it from the queue). |

---

## Chaos Bag

| Command | What it does |
|---------|-------------|
| `/pull` | Draw a chaos token and post the result to `#chaos-bag`. Use for standalone skill tests. |
| `/investigate`, `/fight`, `/evade` | Automatically draw a token and apply the modifier. |

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
| `/clear` | Delete all messages in the current channel. |
| `/newgame` | **Destructive.** Wipe all game channels and reset the database entirely. |

---

## Typical Turn Example

> **Investigation Phase — Roland Banks's turn**

1. **Action 1 — Move**
   `/move location:factory`

2. **Action 2 — Fight** (enemy is here)
   `/fight enemy_id:3 damage:2 card1:Vicious Blow`
   → Token drawn, Combat + 1 (icon) vs Fight 4 → Hit! Enemy takes 2 damage.

3. **Action 3 — Investigate**
   `/investigate card1:Deduction`
   → Token drawn, Intellect 3 + 1 (INT icon) vs Shroud 3 → Success! Clue collected.

> **Then call `/nextphase` when all investigators are done.**

---

## Quick Reference — What Skill for What Test?

| Situation | Command | Key Skill |
|-----------|---------|-----------|
| Gather a clue | `/investigate` | Intellect |
| Hit an enemy | `/fight` | Combat |
| Slip past an enemy | `/evade` | Agility |
| Treachery card test | Resolve manually, `/pull` for token | Willpower or other |
| Parley | Resolve manually, `/pull` for token | Varies |

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
| `<investigator>-hand` | Your private hand, dashboard, and drawn cards |
