# Pending Items

Deferred items from the card effect parsing & auto-resolution implementation
(spec: `specs/2026-04-30-card-effect-parsing-design.md`,
plan: `plans/2026-04-30-card-effect-parsing.md`).

## Minor polish

- **M1** — Trim trailing punctuation/period residue in `entry.unparsed_text`
  after all extraction passes in `bot/engine/cardEffectParser.js`. Currently
  cards like Dr. Milan emit `unparsed_text: "."`. Harmless for assets (play.js
  exits early), but any future event card with similar residue would display
  `📖 Manual: .` to the user.
  Fix sketch: `entry.unparsed_text = text.trim().replace(/^[.,;\s]+$/, '');`

- **M2** — Autocomplete handlers in `fight.js`, `evade.js`, `investigate.js`,
  `test.js` show base `inv.skills?.[s] ?? 0` in stat-pick dropdowns. With
  passives in play (Beat Cop, Magnifying Glass, Haunted), the dropdown shows
  the wrong number even though the actual computation uses `getEffectiveStat`.
  Display inconsistency only — no math error.
  Fix sketch: pass the player + ctx through to the autocomplete handler and
  call `getEffectiveStat` for each stat option.

- **M3** — Add a parser test asserting that **Dr. Milan Christopher** emits
  BOTH a `passive` (`stat_bonus` intellect +1) AND a `triggers`
  (`after_successful_investigate`) entry. Current test only checks `triggers`.
  Regression guard.

- **I3** — `damage.js` and `horror.js` pass a stale `player` snapshot to
  `fireTriggers`. Currently harmless because `execEffect` re-fetches via
  `getPlayerById`, but the pattern is fragile. Add a fresh `getPlayerById`
  fetch right before `fireTriggers` for defensive consistency.

## Out of scope (explicitly deferred per spec)

- Cards that modify chaos bag behavior (Sure Gamble's "switch '−' to '+'", etc.)
- Cards with conditional resolution branches based on token results
  (Elder Sign abilities)
- Cards modifying turn structure (Mind Wipe blanking enemy text)
- Cancellation effects (Ward of Protection, Dodge)
- Multi-target select-menu UX for `chosen_*` effects (current code auto-picks
  only when exactly one valid target exists; otherwise falls back to manual)
- `chosen_asset:{filter}` targeting for items like Extra Ammunition
- Multi-effect compound triggers (`Forced` + `[reaction]` on the same card)
- Per-card play permissions/restrictions beyond the parsed `conditions[]` set

## Out of scope items left in `unparsed_text`

The build script reports cards with non-empty `unparsed_text`. Those are the
candidates for future parser rule additions. Run
`node bot/scripts/buildCardEffects.js` to see the latest list.

## Future ideas

- Override file `bot/data/card_effect_overrides.json` to hand-correct specific
  cards without touching parser logic. Approach 3 from brainstorming, currently
  unused — add only if specific cards keep mis-parsing.
- Integration tests with an in-memory better-sqlite3 instance simulating
  `/play 01064` end-to-end against the actual resolver + executors.
