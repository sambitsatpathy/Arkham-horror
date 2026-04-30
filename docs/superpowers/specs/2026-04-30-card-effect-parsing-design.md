# Card Effect Parsing & Auto-Resolution — Design

**Goal:** Parse Arkham Horror LCG card text into structured JSON effect objects so the bot can auto-resolve card effects (event play, skill on-success triggers, asset passives, weakness handling) instead of requiring manual resolution by players.

**Approach:** Pre-built JSON cache (build-time parser) with full passive/trigger/weakness support.

**Stack:** Node.js, discord.js v14, better-sqlite3.

---

## Architecture

### New files

| Path | Responsibility |
|------|---------------|
| `bot/scripts/buildCardEffects.js` | One-shot script over all `cards.json` → writes `bot/data/card_effects.json`. Re-run when adding a new pack. |
| `bot/data/card_effects.json` | Generated effect map keyed by card code. Committed to repo. |
| `bot/engine/cardEffectParser.js` | Parsing logic (regex pipeline). Used by build script. Pure functions, no I/O. |
| `bot/engine/cardEffectResolver.js` | Loads `card_effects.json` once, exposes resolution API: `resolveOnPlay`, `resolveOnSuccess`, `resolveRevelation`, `getEffectiveStat`, `getEffectiveActions`, `getEffectiveHandSize`. |

### Modified files

| Path | Change |
|------|--------|
| `bot/db/database.js` | Add migration for `players.threat_area TEXT DEFAULT '[]'`. Existing `players.action_count` (already in schema, currently unused) becomes the live action counter. |
| `bot/engine/gameState.js` | Add `getThreatArea`, `addToThreatArea`, `removeFromThreatArea`, `decrementActions`, `resetActions(playerId, count)`. |
| `bot/commands/game/play.js` | After playing event, call `resolver.resolveOnPlay`. Block if conditions fail or `action_count == 0` and not Fast. Deduct action if non-Fast. |
| `bot/commands/game/action.js` | "Play card" sub-flow calls resolver. Stat-bonus passives included in `getEffectiveStat`. |
| `bot/commands/game/test.js` | After successful test, call `resolver.resolveOnSuccess` for each committed card. Replace `inv?.skills?.[statName] ?? 0` with `resolver.getEffectiveStat(player, statName, ctx)`. |
| `bot/commands/game/fight.js` | Same as test.js. |
| `bot/commands/game/evade.js` | Same. |
| `bot/commands/game/investigate.js` | Same, plus pass `ctx = { investigating: true }` to `getEffectiveStat`. Trigger `after_successful_investigate` on success. |
| `bot/commands/game/nextphase.js` | (1) At investigation-phase start, call `resolver.getEffectiveActions(player)` → `resetActions(playerId, n)` for every player. (2) Replace hardcoded `currentHand.length > 8` hand-size warning with `> resolver.getEffectiveHandSize(player)`. |
| `bot/commands/game/damage.js`, `horror.js` | Fire triggers `after_take_damage`, `after_take_horror` against threat-area cards. |
| `bot/commands/game/encounter.js` (new) or `mythos.js` | When weakness drawn, fire `revelation_effects` (add to threat area, deal direct damage/horror, etc). |
| New `bot/commands/game/weakness.js` | `/weakness discard <code>` — checks `discard_cost`, deducts that many actions, removes from threat area. |

---

## Effect Schema

Each entry in `card_effects.json`:

```json
{
  "01064": {
    "name": "Drawn to the Flame",
    "type": "event",
    "fast": false,
    "is_weakness": false,
    "conditions": [],
    "effects": [
      { "type": "draw_encounter_card", "count": 1 },
      { "type": "discover_clues", "count": 2, "target": "self_location" }
    ],
    "on_success": [],
    "passive": [],
    "triggers": [],
    "revelation_effects": [],
    "discard_cost": null,
    "unparsed_text": ""
  }
}
```

Every card has the full shape; arrays default to `[]`, scalars default to `null`/`false`. `unparsed_text` holds any tail of the card text that the parser did not recognize — surfaced in the resolver UI as a "manual resolution" reminder.

### Effect types (used in `effects`, `on_success`, `revelation_effects`, `triggers[].effects`)

| type | params | bot action |
|------|--------|-----------|
| `draw_cards` | `count` | `drawCards(player, count)` |
| `gain_resources` | `count` | `player.resources += count` |
| `discover_clues` | `count`, `target` | adjust location.clues |
| `deal_damage` | `count`, `target` | `damageEnemy` or player damage |
| `deal_horror` | `count`, `target` | adjust player.sanity |
| `heal_damage` | `count`, `target` | adjust player.hp or asset hp |
| `heal_horror` | `count`, `target` | adjust player.sanity |
| `draw_encounter_card` | `count` | `drawEncounterCard` + `postEncounterCard` |
| `place_tokens` | `token_type`, `count`, `target` | adjust asset state (ammo/charge) |
| `add_doom` | `count` | `session.doom += count` |
| `move_to` | `target` | call `executeMoveAction` |
| `cancel_attack` | — | log "attack cancelled", show reminder |
| `add_to_threat_area` | — | append self code to player.threat_area |
| `spawn_enemy` | `code` | `spawnEnemy(session, code, location)` |
| `unknown` | `text` | resolver shows raw text + "resolve manually" |

### Targets

| value | meaning |
|-------|---------|
| `self` | acting player |
| `self_location` | acting player's current location |
| `chosen_investigator` | resolver shows select menu of players at same location |
| `chosen_enemy` | select menu of active enemies at player's location |
| `chosen_asset:{type_filter}` | select menu of player's assets with matching `type_code` (e.g. `firearm`) |
| `chosen_location` | select menu of revealed locations in current act |
| `all_enemies_at_location` | every enemy at player's location |
| `all_investigators_at_location` | every player at this location |

### Conditions (in `conditions[]`)

| value | enforced? | semantics |
|-------|-----------|-----------|
| `no_enemies_at_location` | ✅ | block play if any enemy present |
| `no_enemies_engaged` | ✅ | block play if any enemy engaged with player |
| `investigator_at_location` | ✅ | requires another investigator at location |
| `during_your_turn` | ⚠️ warn-only | bot doesn't track turn order strictly |
| `timing_trigger:{description}` | ⚠️ warn-only | reactions ("after fail", "when attacked") — shown as reminder |
| `deck_only:{investigator_code}` | ✅ at deck-import time only | already enforced; not re-checked at play |

### Passive types (in `passive[]`)

| type | params | semantics |
|------|--------|-----------|
| `extra_actions` | `value` | adds N to `action_count` reset |
| `stat_bonus` | `stat`, `value`, `condition` | adds N to that stat in `getEffectiveStat`. `condition` is `null` (always) or a string like `while_investigating`, `while_engaged_only_enemy`, `while_no_clues`, `while_5_or_more_cards_in_hand`. |
| `stat_penalty` | `stat`, `value`, `condition` | same as stat_bonus with negative value. `stat` may be `"all"` for "-1 to each skill" (Haunted). |
| `hand_size_bonus` | `value` | adds N to base hand size (8). |

### Triggers (in `triggers[]`)

```json
{
  "event": "after_successful_investigate",
  "effects": [{ "type": "gain_resources", "count": 1 }]
}
```

| event | fired by |
|-------|----------|
| `after_successful_investigate` | `investigate.js` post-success |
| `after_successful_fight` | `fight.js` post-success |
| `after_defeat_enemy` | `enemyEngine.defeatEnemy` |
| `after_take_damage` | `damage.js` |
| `after_take_horror` | `horror.js` |
| `after_card_played` | `play.js` |

Each trigger fires for every in-play asset OR threat-area card belonging to the relevant player whose `triggers[].event` matches.

### Weakness fields

| field | semantics |
|-------|-----------|
| `is_weakness` | `true` if `subtype_code` is `weakness` or `basicweakness` |
| `discard_cost` | integer (usually 2) if card text matches `[action] [action]: Discard`, else `null` |
| `revelation_effects` | resolved when card is drawn from encounter deck (or held in hand for player weaknesses) |

---

## Resolution Flow

### When player runs `/play <card>` for an event

1. Resolver loads card entry. If absent → fall through to current `play.js` behavior (move to discard, post image), no auto-resolve.
2. Check `conditions[]`. Any enforceable condition fails → ephemeral error, abort. Warn-only conditions → display as reminder, continue.
3. Check `action_count`: if `fast == false` and `action_count == 0` → ephemeral error "no actions remaining".
4. For each effect in `effects`:
   - Resolve target. If `target` starts with `chosen_` → pause and present `StringSelectMenu` of valid options; resume on select.
   - Execute effect via dedicated handler in resolver.
5. If `unparsed_text` is non-empty → append "**Manual:** {text}" to reply.
6. Move card to discard. If non-Fast → `decrementActions(player)`.
7. Fire `after_card_played` triggers.

### When skill card committed and test succeeds

After a successful test in `test.js` / `fight.js` / `evade.js` / `investigate.js`:

1. For each committed code, look up `on_success` array.
2. Resolve each effect (skill on-success effects always target `self` or `self_location`; no select menus needed).

### When weakness card drawn from encounter deck

In `encounterEngine.runMythosEncounters` (and any future single-draw command):

1. Detect `is_weakness`. Read `revelation_effects`.
2. If revelation contains `add_to_threat_area` → append code to player's `threat_area` JSON.
3. Resolve any other revelation effects (deal damage, discard resources, etc).
4. Post card image and revelation summary in encounter channel.

### When `/weakness discard <code>` invoked

1. Lookup card entry. If `discard_cost == null` → reply "this weakness has no discard cost; manual resolution required".
2. Check `action_count >= discard_cost` → block if not.
3. Deduct cost from `action_count`. Remove code from `threat_area`. Reply summary.

### Stat computation (replaces hardcoded `inv?.skills?.[statName] ?? 0`)

`getEffectiveStat(player, stat, ctx)`:

1. Start with `base = investigator.skills[stat] || 0`.
2. For each asset in `player.assets`: load entry, sum matching `passive[].stat_bonus` (and `stat_penalty`). Apply `condition` filter using `ctx` (e.g. `while_investigating` only counts when `ctx.investigating === true`).
3. For each threat-area card in `player.threat_area`: same.
4. Return total.

`getEffectiveActions(player)` = `3 + Σ passive.extra_actions` across in-play assets and threat-area cards.

`getEffectiveHandSize(player)` = `8 + Σ passive.hand_size_bonus` across in-play assets and threat-area cards.

---

## Build Script

`bot/scripts/buildCardEffects.js`:

1. Walks every `<pack>/cards.json` under `cardDataRoot`.
2. For each card with `text`, calls `cardEffectParser.parse(card)`.
3. Writes `bot/data/card_effects.json` sorted by code.
4. Prints summary: total cards parsed, % with at least one structured effect, list of cards with non-empty `unparsed_text`.

Re-run manually whenever a new pack is added to the repo.

---

## Parser Pipeline

`cardEffectParser.parse(card)`:

1. Strip HTML tags (`<b>`, `<i>`).
2. Detect keywords (`Fast.`, `Permanent.`).
3. Detect weakness via `card.subtype_code`.
4. Walk a list of regex rules in priority order. Each rule matches a phrase, extracts an effect object, and consumes the matched text.
5. After all rules run, residue text → `unparsed_text`.

Initial rule set (extend as cards exposed during play):

| pattern (regex, simplified) | produces |
|---|---|
| `Discover (\d+) clues? at your location` | `{type:"discover_clues", count:N, target:"self_location"}` |
| `Draw (\d+) cards?` | `{type:"draw_cards", count:N}` |
| `Gain (\d+) resources?` | `{type:"gain_resources", count:N}` |
| `Heal (\d+) (damage|horror) from?` | `{type:"heal_*", count:N, target:...}` |
| `Deal (\d+) damage to (each enemy at your location|an enemy at your location)` | `{type:"deal_damage", count:N, target:...}` |
| `Take (\d+) (direct )?(damage|horror)` | `{type:"deal_*", count:N, target:"self"}` |
| `Draw the top card of the encounter deck` | `{type:"draw_encounter_card", count:1}` |
| `Place (\d+) (ammo|charge) tokens? on a ([[A-Za-z]+]) asset` | `{type:"place_tokens", ...}` |
| `Place (\d+) doom on the current agenda` | `{type:"add_doom", count:N}` |
| `If this skill test is successful, (.+)` | recurse on RHS → `on_success` array |
| `You get \+(\d+) \[(\w+)\]` (no "for this") | `{type:"stat_bonus", stat, value, condition:null}` (passive) |
| `You get \+(\d+) \[(\w+)\] while investigating` | passive with condition |
| `You get -(\d+) to each of your skills` | passive `stat_penalty` with `stat:"all"` |
| `You may take an additional action` | passive `extra_actions:1` |
| `Your maximum hand size is increased by (\d+)` | passive `hand_size_bonus:N` |
| `\[action\] \[action\]: Discard` | sets `discard_cost: 2` |
| `Put .+ into play in your threat area` (inside `Revelation - …`) | `revelation_effects: [{type:"add_to_threat_area"}]` |

Rules accumulate into `effects` by default; `Revelation - ` prefix routes into `revelation_effects`; `Forced - After …` and `[reaction] After …` route into `triggers[]`.

---

## Data Flow

```
card text (cards.json)
   ↓ parser (build-time)
card_effects.json
   ↓ resolver.load() (once at startup)
in-memory effect map
   ↓
play.js / test.js / fight.js / evade.js / investigate.js / encounter / weakness
   ↓ resolver.resolveOnPlay / resolveOnSuccess / resolveRevelation / getEffectiveStat / getEffectiveActions
DB writes via gameState.js
   ↓
Discord replies + select menus + chaos channel posts
```

---

## Error Handling & Compatibility

- **Missing `card_effects.json`:** resolver returns empty effect entries for every code. All commands fall back to current behavior. Bot fully functional without parsing.
- **Card code not in map:** treated as missing entry, same fallback.
- **Parser regression:** since parser runs at build time, errors are visible in build output; runtime is unaffected by parser bugs.
- **DB migration:** `threat_area` column added via existing `PRAGMA table_info` pattern in `database.js`. Existing campaigns get column with default `'[]'`.
- **`action_count` already in schema:** wire-up is additive, no migration needed.
- **No regression on stat computation:** `getEffectiveStat` returns same value as `inv.skills[stat]` for any asset/threat-area card with no `passive` entries — i.e., until a card with a passive is parsed and in play, totals are identical to today.

---

## Testing Strategy

1. **Parser unit tests** (Jest, `bot/tests/cardEffectParser.test.js`):
   - Hand-pick 30 representative cards across factions and types.
   - Assert exact JSON output for each.
   - Cards: Drawn to the Flame, Emergency Cache, Working a Hunch, Vicious Blow, Guts, Beat Cop, Dr. Milan Christopher, Magnifying Glass, Leo De Luca, Laboratory Assistant, Haunted, Psychosis, Hypochondria, Cover Up, Mob Enforcer, Lucky!, Dynamite Blast, Mind over Matter, Cunning Distraction, Backstab, Sneak Attack, Evidence!, Sure Gamble, Fearless, Police Badge, .45 Automatic, Machete, Rite of Seeking, Charisma, Stand Together.
2. **Resolver unit tests** (`bot/tests/cardEffectResolver.test.js`):
   - Mocked game state. Test stat-bonus aggregation, condition filtering, action count math, hand size math.
3. **Integration tests:**
   - Stand up an in-memory better-sqlite3 instance, simulate `/play 01064`, assert encounter card drawn + 2 clues placed.
   - Simulate `/test willpower 3` with Beat Cop in play (combat passive does not apply to willpower test) → base stat unchanged.
   - Simulate Leo De Luca in play → `getEffectiveActions` returns 4.
   - Simulate Haunted in threat area → all 4 stats return base − 1.
4. **Manual smoke test in dev guild:**
   - Build, deploy commands, run a turn end-to-end with a deck containing Drawn to the Flame, Beat Cop, Leo De Luca, Vicious Blow.

---

## Out of Scope (Defer)

- Cards modifying chaos bag behavior (e.g. Sure Gamble's "switch token's '−' to '+'") — `unparsed_text` only.
- Cards with conditional resolution branches based on token results (Elder Sign abilities).
- Cards modifying turn structure (Mind Wipe blanking enemy text).
- Cards with `Forced` triggers that branch on game state not tracked in DB.
- Multi-player synchronization (resource pools shared across investigators) — bot stays single-acting-player per command.
- Per-card play permissions/restrictions beyond `conditions[]`.
- Auto-resolution of cancellation effects (Ward of Protection, Dodge) — tagged `unknown`, manual resolution.

These remain manually resolved with card text shown in `unparsed_text`.

---

## Open Questions (none — closed before implementation)

All clarifications resolved during brainstorming:
- Coverage: full parsing attempt with override-via-rebuild fallback.
- Skill cards: `on_success` triggers handled.
- Targeting: select-menu UX for `chosen_*` targets.
- Conditions: enforced where checkable, warn-only for timing reactions.
- Action tracking: enforced via `action_count`.
- Passives: `extra_actions`, `stat_bonus`, `stat_penalty`, `hand_size_bonus` with optional conditions.
- Weaknesses: threat area, discard cost, revelation effects, forced triggers.
