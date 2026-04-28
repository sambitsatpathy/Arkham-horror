# Arkham Horror Bot — Roadmap

Priority order: **Command Automation → UI Polish → Scenario Data → Starter Decks**

---

## Phase 1a — Command Automation

All automations are strictly rules-timed. No shortcut triggers.

### 1. Auto-Upkeep

**Trigger:** `/nextphase` entering upkeep phase

**What bot does (all investigators, no player input needed):**
- +1 resource each
- Draw 1 card each (updates pinned hand display)
- Ready all exhausted assets in DB

**Bot posts upkeep summary in #doom-track:**
```
⏫ UPKEEP — Round 3
━━━━━━━━━━━━━━━━━━━━━━
Roland Banks  +1 resource (→4), drew Machete
Daisy Walker  +1 resource (→3), drew Deduction
━━━━━━━━━━━━━━━━━━━━━━
All exhausted cards readied. Investigation phase begins.
```

**Rules note:** Investigators may have effects that modify upkeep (e.g. "you may not draw during upkeep" on some weaknesses). These are not auto-resolved — bot does baseline upkeep, players resolve exceptions with existing commands.

---

### 2. Auto-Doom Threshold Check

**Trigger (rules-correct timing):**
1. End of mythos phase — after all encounter cards resolved, before `/mythos` returns
2. Any card effect that explicitly adds doom and states "if this would cause the doom threshold to be reached, advance the agenda" — host uses `/doom add` for these; bot checks if threshold hit

**NOT triggered by:** mid-round `/doom add` calls for manual bookkeeping

**What bot does:**
- Reads `game_session.doom` vs current agenda's `doom_threshold`
- If reached: auto-runs agenda advance logic (same as `/advance agenda`)
- Posts agenda advance announcement in #doom-track
- If it was the final agenda: triggers defeat sequence

**Implementation note:** `/mythos` already has access to doom state. Add threshold check after `encounterEngine` resolves all cards. For manual `/doom add` calls, add an optional `--check` flag or a separate post-add check.

---

### 3. Enemy Activation Phase

**New command:** `/enemyphase`

**Trigger:** Host runs `/enemyphase` during enemy phase (or `/nextphase` entering enemy phase)

**Rules:**

For each active enemy (iterate `enemies` table for current session):

```
Hunter keyword + not engaged with any investigator:
  → Move enemy to location containing nearest investigator
  → Enemy attacks that investigator

Engaged with an investigator (regardless of hunter):
  → Enemy attacks that investigator

Non-hunter + not engaged:
  → No action this phase
```

**Attack resolution:**
- Deal `enemy.damage` HP damage to investigator
- Deal `enemy.horror` sanity damage to investigator
- Auto-applies via same logic as `/damage` and `/horror`
- Bot posts attack message in investigator's hand channel + updates doom track pin

**DB change required:** Add `is_hunter INTEGER DEFAULT 0` to `enemies` table (migration via `PRAGMA table_info`).

**Rules note:** Some enemies have additional keywords (Massive, Retaliate, Alert, etc.) that modify activation. These are not auto-resolved. Bot handles Hunter + basic attack only. Host uses existing commands for keyword effects.

---

### 4. Auto-Defeat at 0 HP

**Trigger:** Any `/enemy damage` call that brings enemy HP to 0

**What bot does:**
- Deletes enemy from `enemies` table
- Updates location pin (removes enemy from Enemies list)
- Posts defeat message in location channel
- Adds enemy to `campaign_log` as defeated (for XP calculation at `/endscenario`)

**No separate `/enemy defeat` needed for combat damage.** Manual `/enemy defeat` remains for narrative defeats (e.g. scenario resolution removes an enemy).

---

## Phase 1b — UI Polish

### 1. Autocomplete Display Cleanup

**Current:** autocomplete names show verbose detail, e.g. `".38 Special (2 charges, +1 combat, cost 3)"`

**Target:** clean primary label with structured secondary detail:
```
label: ".38 Special"
description: "2 charges · Cost 3"   ← shown smaller below in select menus
```

For pure autocomplete (slash command dropdowns), format as: `".38 Special — 2 charges"` (Discord autocomplete has no description field, use em-dash separator).

**Affected handlers:** all autocomplete handlers in `/play`, `/discard`, `/commit`, `/use`, `/exhaust`, `/damage`, `/horror`, `/fight`, `/evade`, `/move`

---

### 2. Dashboard Embed + Action Buttons

**Command:** `/dashboard`

**Embed layout:**
```
[Roland Banks — Discord handle]         [investigator card thumbnail]
Roland Banks — The Fed
─────────────────────────────────────────
HP:        7 / 9   ████████░░
Sanity:    4 / 5   ████████░░
Resources: 3 💰
Clues:     2 🔎
Location:  Study
─────────────────────────────────────────
[ Draw ]  [ Resource ]  [ Play Card ]  [ Discard ]
[ Move ]  [ Commit ]
```

Button `customId` encodes action + player discord_id (e.g. `draw:01001:01234567890`).

`index.js` component interaction handler dispatches button clicks to same engine functions as slash commands — no duplicate logic.

**Ephemeral:** dashboard posts as ephemeral (visible only to player). Buttons update the message in-place.

---

### 3. Select Menus for Card/Location Selection

Replace autocomplete on these commands with `StringSelectMenu` when triggered via button (not slash command directly):

| Trigger | Select Menu Content |
|---------|-------------------|
| Play Card button | Hand cards — `label`: card name, `description`: type + cost |
| Discard button | Hand cards — `label`: card name, `description`: type |
| Move button | Act locations — `label`: location name, `description`: shroud + clue count |
| Commit button | Skill cards in hand — `label`: card name, `description`: skill icons |
| Damage/Horror target | Self + assets — `label`: name, `description`: current HP/sanity |

Slash command versions keep autocomplete (unchanged). Select menus are the button-triggered path only.

---

## Phase 2 — Scenario Data

Author remaining campaign scenario JSONs. Follow schema in `PLANNING.md`. Include `intro_text` and `resolutions` for all scenarios.

**Priority order:**

| Campaign | Scenarios | Status |
|----------|-----------|--------|
| The Circle Undone | 8 | Pending |
| The Dream-Eaters | 8 | Pending |
| The Innsmouth Conspiracy | 8 | Pending |
| Edge of the Earth | 8 | Pending |
| The Scarlet Keys | 8 | Pending |
| Feast of Hemlock Vale | 8 | Pending |
| The Drowned City | 8 | Pending |

**Source for narrative text:** physical scenario booklets. ArkhamDB act/agenda `back_text` has some resolution text — cross-reference when authoring.

**Register each campaign** in the `CAMPAIGNS` registry in `startgame.js` after adding its `campaign.json`.

---

## Phase 3 — Starter Decks

Add starter decks for all remaining investigators to `bot/data/investigators/starter_decks.json`.

Slot data sourced from ArkhamDB `/api/public/decklists/by_investigator/<code>.json` or official starter deck lists. Verify all card codes against local pack `cards_index.json` files.

**Pending:**

| Cycle | Investigators |
|-------|--------------|
| **Fix existing** | Zoey Samaras — illegal Mystic/Seeker cards |
| Circle Undone | Carolyn Fern, Joe Diamond, Preston Fairmont, Diana Stanley, Rita Young, Marie Lambeau |
| Dream-Eaters | Tommy Muldoon, Mandy Thompson, Tony Morgan, Luke Robinson, Patrice Hathaway |
| Innsmouth | Sister Mary, Amanda Sharpe, Trish Scarborough, Dexter Drake, Silas Marsh |
| Edge of Earth | Daniela Reyes, Norman Withers, Monterey Jack, Lily Chen, Bob Jenkins |
| Scarlet Keys | Carson Sinclair, Vincent Lee, Kymani Jones, Amina Zidane, Darrell Simmons, Charlie Kane |
| Feast of Hemlock Vale | Wilson Richards, Kate Winthrop, Alessandra Zorzi, Kōhaku Narukami, Hank Samson |
| Drowned City | Marion Tavares, Lucius Galloway, Agatha Crane, Michael McGlen, Gloria Goldberg, George Barnaby |
| Standalone | Nathaniel Cho, Harvey Walters, Winifred Habbamock, Jacqueline Fine, Stella Clark |
