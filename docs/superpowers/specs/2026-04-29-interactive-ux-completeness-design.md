# Design: Interactive UX & Game Completeness

**Date:** 2026-04-29
**Status:** Approved

## Problem

Bot has all core game commands but they are loosely tied — easy to forget steps, no guided flow. Three mechanical gaps exist: no mulligan, no engage action for aloof enemies, no hand size enforcement.

## Goals

1. Fill mechanical gaps: mulligan, engage, hand size warning
2. Single guided entry point for player actions (`/action` hub)
3. Interactive select menus for multi-option commands
4. Phase-aware checklists so players know what to do next
5. Hide individual action commands from regular users to reduce confusion

---

## New Commands

### `/mulligan`

- **When:** Round 1, investigation phase only
- **Flow:**
  1. `/mulligan` → ephemeral embed showing hand as `StringSelectMenu` (multi-select)
  2. Player picks cards to swap → bot discards selected, redraws same count, refreshes embed with new hand + new select menu
  3. Repeatable until satisfied
  4. **Done** button → shuffles all non-hand cards (discard pile) back into deck, dismisses embed
- **Gate:** Phase `investigation`, `session.round === 1`
- **No DB schema change needed** — uses existing hand/deck/discard fields

### `/engage`

- **Purpose:** Formally engage an aloof enemy at your location (costs 1 action, self-enforced)
- **DB change:** Add `is_aloof` column to `enemies` table (migration pattern, default 0)
- **Spawn change:** `/enemy spawn` gets `is_aloof` boolean option
- **Logic:** Verify enemy at player's `location_code` → clear `is_aloof` flag → post confirm to hand channel
- **`/enemyphase` behavior:** Aloof enemies (is_aloof=1) skip activation entirely until engaged

---

## `/action` Hub

Single command replacing direct player-facing commands.

### Flow

1. `/action` → ephemeral embed + button row:
   ```
   [Move] [Investigate] [Fight] [Evade] [Draw] [Resource]
   [Play] [Engage] [Use] [Exhaust] [Test] [Commit]
   ```
2. Player clicks action → embed updates with context-aware sub-menu:

| Button | Sub-menu content |
|--------|-----------------|
| Move | `StringSelectMenu` of connected locations (from scenario data) |
| Fight | `StringSelectMenu` of enemies at current location |
| Evade | `StringSelectMenu` of enemies at current location |
| Engage | `StringSelectMenu` of enemies at current location |
| Investigate | Commit select (hand filtered to skill-icon cards, labeled) → auto-runs test |
| Fight (after enemy) | Commit select → auto-runs fight test |
| Evade (after enemy) | Commit select → auto-runs evade test |
| Play | `StringSelectMenu` of hand cards player can afford (asset/event) |
| Use | `StringSelectMenu` of in-play assets with charges |
| Exhaust | `StringSelectMenu` of in-play assets |
| Draw | Executes immediately, no sub-menu |
| Resource | Executes immediately, no sub-menu |
| Test | Discord Modal — inputs: stat (select) + difficulty (number) → commit select → runs test |
| Commit | `StringSelectMenu` of hand filtered to cards with any `skill_*` > 0, labeled with icons |

3. Confirm → bot executes action, posts result to appropriate channel

### Skill Card Filtering

Card data contains `skill_willpower`, `skill_intellect`, `skill_combat`, `skill_agility`, `skill_wild` fields on all card types. Commit menu:
- Filters hand to cards where any `skill_*` value > 0
- Labels each card with icons (e.g. "Vicious Blow [⚔️×1]", "Deduction [🔎×1]")
- For typed tests, highlights matching + wild icons vs off-icon cards

### Backward Compatibility

Existing typed commands (`/fight`, `/move`, `/investigate`, etc.) remain in codebase unchanged — they are the execution layer `/action` calls into. They are set to `default_member_permissions: PermissionFlagsBits.Administrator` so they disappear from regular user autocomplete but remain available to Host/admin as escape hatch.

---

## Phase Checklists

Each phase transition posts a structured summary to `#doom-track`:

**Investigation Phase:**
```
🔍 Investigation Phase — Round N
Each investigator: 3 actions. Use /action to take them.
Skill test formula: Skill + Committed icons + Chaos token ≥ Difficulty
Host: /nextphase when all investigators are done.
```

**Enemy Phase:**
```
👹 Enemy Phase — Round N
1. Run /enemyphase to activate enemies (hunters move + all attack)
2. Resolve manual effects: Retaliate, Aloof, etc.
Host: /nextphase when done.
```

**Upkeep Phase:**
```
☀️ Upkeep — Round N
✅ Assets readied  ✅ Drew 1 card  ✅ Gained 1 resource
⚠️ Hand size warnings sent to hand channels (if applicable)
Host: /nextphase to begin Mythos.
```

**Mythos Phase:**
```
🌙 Mythos Phase — Round N
✅ Doom placed  ✅ Encounter cards drawn
Each investigator: resolve your encounter card → /resolved when done.
```

---

## Hand Size Enforcement

In `nextphase.js` upkeep block, after auto-draw step:
- For each player: if `hand.length > 8`, post to their hand channel:
  `⚠️ Hand has X cards (limit 8). Use /discard to reduce to 8.`
- No forced discard — player resolves manually

---

## Cheatsheet Updates

- Fix round flow: `Enemy Phase → /enemyphase` (not `/nextphase`)
- Add `/action` as primary player command
- Add `/mulligan` to pregame section
- Add `/engage` to enemies section
- Note typed commands are Host/admin only

---

## DB Schema Changes

| Table | Change |
|-------|--------|
| `enemies` | Add `is_aloof INTEGER DEFAULT 0` |

Migration: check `PRAGMA table_info(enemies)` before adding, follow existing migration pattern in `database.js`.

---

## Testing Checklist

After each feature:
1. `node deploy-commands.js` + restart bot
2. Smoke test happy path via Discord
3. Verify DB state after interaction (SQLite browser or `.tables` query)
4. Confirm backward compat: Host can still use typed commands directly
5. Regression: existing commands unaffected
