# Card Effect Parsing & Auto-Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse Arkham Horror LCG card text into JSON effect objects so the bot auto-resolves event effects, skill on-success triggers, asset passives, and weakness handling.

**Architecture:** Build-time parser (`bot/scripts/buildCardEffects.js`) reads every `<pack>/cards.json` and writes a single `bot/data/card_effects.json` keyed by card code. A runtime resolver loads that file once, exposes `resolveOnPlay`, `resolveOnSuccess`, `resolveRevelation`, `getEffectiveStat`, `getEffectiveActions`, `getEffectiveHandSize`. Existing test/fight/evade/investigate/play/nextphase commands wire to the resolver; missing entries fall through to current behavior — zero regression risk until parser fires.

**Tech Stack:** Node.js, discord.js v14, better-sqlite3, jest (added).

**Spec:** `docs/superpowers/specs/2026-04-30-card-effect-parsing-design.md`

---

## File Map

**Create:**
- `bot/scripts/buildCardEffects.js` — one-shot build script
- `bot/data/card_effects.json` — generated, committed
- `bot/engine/cardEffectParser.js` — pure parsing functions
- `bot/engine/cardEffectResolver.js` — runtime resolution + stat aggregation
- `bot/commands/game/weakness.js` — `/weakness discard` command
- `bot/tests/cardEffectParser.test.js` — parser unit tests
- `bot/tests/cardEffectResolver.test.js` — resolver unit tests

**Modify:**
- `bot/db/database.js` — add `threat_area` migration
- `bot/engine/gameState.js` — add threat-area + action helpers
- `bot/commands/game/test.js` — replace stat lookup, add on_success
- `bot/commands/game/fight.js` — same
- `bot/commands/game/evade.js` — same
- `bot/commands/game/investigate.js` — same + after_successful_investigate trigger
- `bot/commands/game/play.js` — call resolveOnPlay
- `bot/commands/game/action.js` — getEffectiveStat in stat-icon helper
- `bot/commands/game/nextphase.js` — reset action_count + hand-size warning
- `bot/commands/game/damage.js` — fire after_take_damage
- `bot/commands/game/horror.js` — fire after_take_horror
- `bot/engine/encounterEngine.js` — fire revelation on weakness draw
- `bot/package.json` — add jest devDep + test script

---

### Task 1: Jest setup + first parser test

**Files:**
- Modify: `bot/package.json`
- Create: `bot/tests/cardEffectParser.test.js`
- Create: `bot/engine/cardEffectParser.js`

- [ ] **Step 1: Install jest as devDependency**

```bash
cd bot && npm install --save-dev jest
```

- [ ] **Step 2: Add `test` script to `bot/package.json`**

Edit `bot/package.json`, change the `"scripts"` block to:

```json
"scripts": {
  "start": "node index.js",
  "deploy": "node deploy-commands.js",
  "test": "jest"
}
```

- [ ] **Step 3: Create empty parser module**

Write `bot/engine/cardEffectParser.js`:

```javascript
const EMPTY_ENTRY = {
  name: '',
  type: '',
  fast: false,
  is_weakness: false,
  conditions: [],
  effects: [],
  on_success: [],
  passive: [],
  triggers: [],
  revelation_effects: [],
  discard_cost: null,
  unparsed_text: '',
};

function emptyEntry() {
  return JSON.parse(JSON.stringify(EMPTY_ENTRY));
}

function parse(card) {
  const entry = emptyEntry();
  entry.name = card.name || '';
  entry.type = card.type_code || '';
  entry.is_weakness = card.subtype_code === 'weakness' || card.subtype_code === 'basicweakness';
  const text = stripHtml(card.text || '');
  entry.unparsed_text = text;
  return entry;
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, '');
}

module.exports = { parse, stripHtml, emptyEntry };
```

- [ ] **Step 4: Write the failing test**

Write `bot/tests/cardEffectParser.test.js`:

```javascript
const { parse, stripHtml, emptyEntry } = require('../engine/cardEffectParser');

describe('cardEffectParser', () => {
  test('emptyEntry returns the canonical shape', () => {
    const e = emptyEntry();
    expect(e.fast).toBe(false);
    expect(e.is_weakness).toBe(false);
    expect(e.effects).toEqual([]);
    expect(e.on_success).toEqual([]);
    expect(e.passive).toEqual([]);
    expect(e.triggers).toEqual([]);
    expect(e.revelation_effects).toEqual([]);
    expect(e.discard_cost).toBeNull();
  });

  test('stripHtml removes <b> and <i>', () => {
    expect(stripHtml('<b>Fight.</b> Deal <i>1</i> damage.')).toBe('Fight. Deal 1 damage.');
  });

  test('parse marks weaknesses', () => {
    const card = { name: 'Haunted', type_code: 'treachery', subtype_code: 'weakness', text: '' };
    expect(parse(card).is_weakness).toBe(true);
  });

  test('parse on a non-weakness leaves is_weakness false', () => {
    const card = { name: 'Drawn to the Flame', type_code: 'event', text: '' };
    expect(parse(card).is_weakness).toBe(false);
  });
});
```

- [ ] **Step 5: Run tests, verify pass**

Run: `cd bot && npm test`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add bot/package.json bot/package-lock.json bot/engine/cardEffectParser.js bot/tests/cardEffectParser.test.js
git commit -m "feat: jest + cardEffectParser scaffold"
```

---

### Task 2: DB migration + threat_area helpers

**Files:**
- Modify: `bot/db/database.js` (after line 147, add new migration block)
- Modify: `bot/engine/gameState.js` (add new exports)
- Create: `bot/tests/gameState.threatArea.test.js`

- [ ] **Step 1: Add migration for threat_area**

Edit `bot/db/database.js`. After the existing `scry_buffer` migration block (around line 147), add:

```javascript
  if (!playerCols.includes('threat_area')) {
    db.exec("ALTER TABLE players ADD COLUMN threat_area TEXT DEFAULT '[]'");
  }
```

- [ ] **Step 2: Add gameState helpers**

Edit `bot/engine/gameState.js`. At the bottom of the file (before `module.exports`), add:

```javascript
function getThreatArea(playerId) {
  const row = getDb().prepare('SELECT threat_area FROM players WHERE id = ?').get(playerId);
  return row ? JSON.parse(row.threat_area || '[]') : [];
}

function setThreatArea(playerId, codes) {
  getDb().prepare('UPDATE players SET threat_area = ? WHERE id = ?').run(JSON.stringify(codes), playerId);
}

function addToThreatArea(playerId, code) {
  const codes = getThreatArea(playerId);
  codes.push(code);
  setThreatArea(playerId, codes);
}

function removeFromThreatArea(playerId, code) {
  const codes = getThreatArea(playerId).filter(c => c !== code);
  setThreatArea(playerId, codes);
}

function decrementActions(playerId, n = 1) {
  const row = getDb().prepare('SELECT action_count FROM players WHERE id = ?').get(playerId);
  const next = Math.max(0, (row?.action_count ?? 0) - n);
  getDb().prepare('UPDATE players SET action_count = ? WHERE id = ?').run(next, playerId);
  return next;
}

function resetActions(playerId, count) {
  getDb().prepare('UPDATE players SET action_count = ? WHERE id = ?').run(count, playerId);
}
```

Then add the new function names to the existing `module.exports` block.

- [ ] **Step 3: Write the failing test**

Write `bot/tests/gameState.threatArea.test.js`:

```javascript
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(__dirname, 'tmp_threat.db');

beforeAll(() => {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  process.env.ARKHAM_DB_PATH = TMP_DB;
});

afterAll(() => {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
});

describe('threat area + action helpers', () => {
  test('threat area starts empty', () => {
    const { getDb } = require('../db/database');
    const db = getDb();
    db.prepare("INSERT INTO campaign (id, name) VALUES (1, 'test')").run();
    db.prepare("INSERT INTO players (id, campaign_id, discord_id, discord_name) VALUES (1, 1, 'u1', 'p1')").run();
    const { getThreatArea, addToThreatArea, removeFromThreatArea } = require('../engine/gameState');
    expect(getThreatArea(1)).toEqual([]);
    addToThreatArea(1, '01098');
    addToThreatArea(1, '01099');
    expect(getThreatArea(1)).toEqual(['01098', '01099']);
    removeFromThreatArea(1, '01098');
    expect(getThreatArea(1)).toEqual(['01099']);
  });

  test('decrementActions floors at 0', () => {
    const { getDb } = require('../db/database');
    const db = getDb();
    db.prepare("UPDATE players SET action_count = 2 WHERE id = 1").run();
    const { decrementActions, resetActions } = require('../engine/gameState');
    expect(decrementActions(1)).toBe(1);
    expect(decrementActions(1, 5)).toBe(0);
    resetActions(1, 4);
    const row = db.prepare('SELECT action_count FROM players WHERE id = 1').get();
    expect(row.action_count).toBe(4);
  });
});
```

- [ ] **Step 4: Make `database.js` honour `ARKHAM_DB_PATH`**

Edit `bot/db/database.js` line 4. Replace:

```javascript
const DB_PATH = path.join(__dirname, 'arkham.db');
```

with:

```javascript
const DB_PATH = process.env.ARKHAM_DB_PATH || path.join(__dirname, 'arkham.db');
```

- [ ] **Step 5: Run tests, verify pass**

Run: `cd bot && npm test`
Expected: previous 4 + new 2 pass.

- [ ] **Step 6: Commit**

```bash
git add bot/db/database.js bot/engine/gameState.js bot/tests/gameState.threatArea.test.js
git commit -m "feat: threat_area column + action helpers"
```

---

### Task 3: Parser — simple effect rules (draw, resources, clues, encounter draw, doom)

**Files:**
- Modify: `bot/engine/cardEffectParser.js`
- Modify: `bot/tests/cardEffectParser.test.js`

- [ ] **Step 1: Write failing tests for simple effects**

Append to `bot/tests/cardEffectParser.test.js`:

```javascript
describe('parser - simple effects', () => {
  const parseText = (text, type = 'event') =>
    parse({ name: 'X', type_code: type, text });

  test('Drawn to the Flame', () => {
    const e = parseText('Draw the top card of the encounter deck. Then, discover 2 clues at your location.');
    expect(e.effects).toEqual([
      { type: 'draw_encounter_card', count: 1 },
      { type: 'discover_clues', count: 2, target: 'self_location' },
    ]);
    expect(e.unparsed_text).toBe('');
  });

  test('Emergency Cache', () => {
    const e = parseText('Gain 3 resources and draw 1 card.');
    expect(e.effects).toEqual([
      { type: 'gain_resources', count: 3 },
      { type: 'draw_cards', count: 1 },
    ]);
  });

  test('Working a Hunch', () => {
    const e = parseText('Fast. Play only during your turn.\nDiscover 1 clue at your location.');
    expect(e.fast).toBe(true);
    expect(e.effects).toEqual([{ type: 'discover_clues', count: 1, target: 'self_location' }]);
    expect(e.conditions).toContain('during_your_turn');
  });

  test('Dark Memory', () => {
    const e = parseText('Place 1 doom on the current agenda. This effect can cause the current agenda to advance.');
    expect(e.effects).toContainEqual({ type: 'add_doom', count: 1 });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd bot && npm test -- --testPathPattern cardEffectParser`
Expected: 4 new tests fail.

- [ ] **Step 3: Implement rules**

Edit `bot/engine/cardEffectParser.js`. Replace the body of `parse(card)` with:

```javascript
function parse(card) {
  const entry = emptyEntry();
  entry.name = card.name || '';
  entry.type = card.type_code || '';
  entry.is_weakness = card.subtype_code === 'weakness' || card.subtype_code === 'basicweakness';
  let text = stripHtml(card.text || '').trim();

  if (/^\s*Fast\./i.test(text)) {
    entry.fast = true;
    text = text.replace(/^\s*Fast\.\s*/i, '');
  }

  text = applyConditionRules(text, entry);
  text = applyEffectRules(text, entry);

  entry.unparsed_text = text.trim();
  return entry;
}

const SIMPLE_EFFECT_RULES = [
  { re: /Draw the top card of the encounter deck\.?/i,
    out: () => ({ type: 'draw_encounter_card', count: 1 }) },
  { re: /Gain (\d+) resources?/i,
    out: m => ({ type: 'gain_resources', count: parseInt(m[1], 10) }) },
  { re: /Draw (\d+) cards?/i,
    out: m => ({ type: 'draw_cards', count: parseInt(m[1], 10) }) },
  { re: /Discover (\d+) clues? (?:in|at) your location/i,
    out: m => ({ type: 'discover_clues', count: parseInt(m[1], 10), target: 'self_location' }) },
  { re: /Place (\d+) doom on the current agenda/i,
    out: m => ({ type: 'add_doom', count: parseInt(m[1], 10) }) },
];

function applyEffectRules(text, entry) {
  let remaining = text;
  let progress = true;
  while (progress) {
    progress = false;
    for (const rule of SIMPLE_EFFECT_RULES) {
      const m = remaining.match(rule.re);
      if (m) {
        entry.effects.push(rule.out(m));
        remaining = (remaining.slice(0, m.index) + remaining.slice(m.index + m[0].length)).replace(/^[\s.,]+|[\s.,]+$/g, ' ').trim();
        progress = true;
        break;
      }
    }
  }
  return remaining;
}

function applyConditionRules(text, entry) {
  let t = text;
  if (/Play only during your turn/i.test(t)) {
    entry.conditions.push('during_your_turn');
    t = t.replace(/Play only during your turn\.?/i, '').trim();
  }
  if (/no enemies at your location/i.test(t)) {
    entry.conditions.push('no_enemies_at_location');
  }
  return t;
}
```

Update the bottom of the file to export the new helpers (only `parse`, `stripHtml`, `emptyEntry` are exported; new helpers stay private).

- [ ] **Step 4: Run tests, verify pass**

Run: `cd bot && npm test -- --testPathPattern cardEffectParser`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/engine/cardEffectParser.js bot/tests/cardEffectParser.test.js
git commit -m "feat: parser - simple effect rules"
```

---

### Task 4: Parser — damage, horror, heal, take, deal-to-target

**Files:**
- Modify: `bot/engine/cardEffectParser.js`
- Modify: `bot/tests/cardEffectParser.test.js`

- [ ] **Step 1: Write failing tests**

Append to `bot/tests/cardEffectParser.test.js`:

```javascript
describe('parser - damage/horror/heal', () => {
  const parseText = text => parse({ name: 'X', type_code: 'event', text });

  test('Sneak Attack: deal 2 damage to chosen exhausted enemy', () => {
    const e = parseText('Deal 2 damage to an exhausted enemy at your location.');
    expect(e.effects).toContainEqual({ type: 'deal_damage', count: 2, target: 'chosen_enemy' });
  });

  test('Dynamite Blast: deal 3 damage to each enemy', () => {
    const e = parseText('Choose either your location or a connecting location. Deal 3 damage to each enemy and to each investigator at the chosen location.');
    expect(e.effects).toContainEqual({ type: 'deal_damage', count: 3, target: 'all_enemies_at_location' });
    expect(e.effects).toContainEqual({ type: 'deal_damage', count: 3, target: 'all_investigators_at_location' });
  });

  test('Ward of Protection: take 1 horror', () => {
    const e = parseText('Cancel that card’s revelation effect. Then, take 1 horror.');
    expect(e.effects).toContainEqual({ type: 'deal_horror', count: 1, target: 'self' });
  });

  test('Abandoned and Alone: take 2 direct horror', () => {
    const e = parseText('Take 2 direct horror and remove all cards in your discard pile from the game.');
    expect(e.effects).toContainEqual({ type: 'deal_horror', count: 2, target: 'self', direct: true });
  });

  test('Moment of Respite: heal 3 horror, draw 1 card', () => {
    const e = parseText('Heal 3 horror and draw 1 card.');
    expect(e.effects).toContainEqual({ type: 'heal_horror', count: 3, target: 'self' });
    expect(e.effects).toContainEqual({ type: 'draw_cards', count: 1 });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd bot && npm test -- --testPathPattern cardEffectParser`
Expected: 5 new tests fail.

- [ ] **Step 3: Add rules**

Edit `bot/engine/cardEffectParser.js`. Add to the `SIMPLE_EFFECT_RULES` array (in this order, before the existing rules):

```javascript
  { re: /Deal (\d+) damage to each enemy(?: and to each investigator)? at (?:the chosen|your) location/i,
    out: m => ({ type: 'deal_damage', count: parseInt(m[1], 10), target: 'all_enemies_at_location' }) },
  { re: /(?:and )?(?:deal )?(\d+) damage(?: and)? to each investigator at (?:the chosen|your) location/i,
    out: m => ({ type: 'deal_damage', count: parseInt(m[1], 10), target: 'all_investigators_at_location' }) },
  { re: /Deal (\d+) damage to an? (?:exhausted )?enemy at your location/i,
    out: m => ({ type: 'deal_damage', count: parseInt(m[1], 10), target: 'chosen_enemy' }) },
  { re: /Take (\d+) (direct )?horror/i,
    out: m => ({ type: 'deal_horror', count: parseInt(m[1], 10), target: 'self', ...(m[2] ? { direct: true } : {}) }) },
  { re: /Take (\d+) (direct )?damage/i,
    out: m => ({ type: 'deal_damage', count: parseInt(m[1], 10), target: 'self', ...(m[2] ? { direct: true } : {}) }) },
  { re: /Heal (\d+) horror/i,
    out: m => ({ type: 'heal_horror', count: parseInt(m[1], 10), target: 'self' }) },
  { re: /Heal (\d+) damage/i,
    out: m => ({ type: 'heal_damage', count: parseInt(m[1], 10), target: 'self' }) },
```

The dual-rule for "Deal 3 damage to each enemy and to each investigator at the chosen location" needs special handling: the first rule consumes "Deal 3 damage to each enemy and to each investigator at the chosen location" but we need to emit BOTH effects. Replace those first two rules with a single combined rule:

```javascript
  { re: /Deal (\d+) damage to each enemy (?:and to each investigator )?at (?:the chosen|your) location/i,
    out: m => null, // handled specially below
    special: 'damage_each_enemy_and_inv' },
```

And in `applyEffectRules`, before the for-loop, add the special handler:

```javascript
function applyEffectRules(text, entry) {
  let remaining = text;
  // Special: Dynamite Blast pattern — emit two effects
  const m = remaining.match(/Deal (\d+) damage to each enemy and to each investigator at (?:the chosen|your) location/i);
  if (m) {
    const n = parseInt(m[1], 10);
    entry.effects.push({ type: 'deal_damage', count: n, target: 'all_enemies_at_location' });
    entry.effects.push({ type: 'deal_damage', count: n, target: 'all_investigators_at_location' });
    remaining = (remaining.slice(0, m.index) + remaining.slice(m.index + m[0].length)).replace(/^[\s.,]+|[\s.,]+$/g, ' ').trim();
  }
  let progress = true;
  while (progress) {
    progress = false;
    for (const rule of SIMPLE_EFFECT_RULES) {
      if (rule.special) continue;
      const mm = remaining.match(rule.re);
      if (mm) {
        entry.effects.push(rule.out(mm));
        remaining = (remaining.slice(0, mm.index) + remaining.slice(mm.index + mm[0].length)).replace(/^[\s.,]+|[\s.,]+$/g, ' ').trim();
        progress = true;
        break;
      }
    }
  }
  return remaining;
}
```

Remove the `damage_each_enemy_and_inv` placeholder rule since it's now handled specially. Keep only the simple "deal damage to chosen enemy at your location" rule from the simple set.

- [ ] **Step 4: Run, verify pass**

Run: `cd bot && npm test -- --testPathPattern cardEffectParser`
Expected: all 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot/engine/cardEffectParser.js bot/tests/cardEffectParser.test.js
git commit -m "feat: parser - damage/horror/heal rules"
```

---

### Task 5: Parser — skill on_success triggers

**Files:**
- Modify: `bot/engine/cardEffectParser.js`
- Modify: `bot/tests/cardEffectParser.test.js`

- [ ] **Step 1: Write failing tests**

Append to test file:

```javascript
describe('parser - skill on_success', () => {
  const parseSkill = text => parse({ name: 'X', type_code: 'skill', text });

  test('Vicious Blow', () => {
    const e = parseSkill('If this skill test is successful during an attack, that attack deals +1 damage.');
    expect(e.on_success).toContainEqual({ type: 'bonus_damage_on_attack', count: 1 });
  });

  test('Guts: draw 1 on success', () => {
    const e = parseSkill('Max 1 committed per skill test.\nIf this test is successful, draw 1 card.');
    expect(e.on_success).toContainEqual({ type: 'draw_cards', count: 1 });
  });

  test('Fearless: heal horror on success', () => {
    const e = parseSkill('If this skill test is successful, heal 1 horror.');
    expect(e.on_success).toContainEqual({ type: 'heal_horror', count: 1, target: 'self' });
  });

  test('Deduction: discover 1 additional clue on success while investigating', () => {
    const e = parseSkill('If this skill test is successful while investigating a location, discover 1 additional clue at that location.');
    expect(e.on_success).toContainEqual({ type: 'discover_clues', count: 1, target: 'self_location' });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd bot && npm test -- --testPathPattern cardEffectParser`

- [ ] **Step 3: Implement on_success extraction**

Edit `bot/engine/cardEffectParser.js`. In `parse(card)`, before `applyEffectRules`, add:

```javascript
  text = extractOnSuccess(text, entry);
```

Add the helper:

```javascript
function extractOnSuccess(text, entry) {
  const m = text.match(/If this (?:skill )?test is successful(?:[^,]*)?,\s*([^.]+)\./i);
  if (!m) return text;
  const inner = m[1].trim();
  const sub = emptyEntry();
  applyEffectRules(inner, sub);
  if (sub.effects.length === 0) {
    // Look for "deals +N damage" attack bonus
    const mm = inner.match(/that attack deals \+(\d+) damage/i);
    if (mm) sub.effects.push({ type: 'bonus_damage_on_attack', count: parseInt(mm[1], 10) });
  }
  // "discover 1 additional clue at that location" → discover_clues self_location
  const dm = inner.match(/discover (\d+) additional clues? at that location/i);
  if (dm) sub.effects.push({ type: 'discover_clues', count: parseInt(dm[1], 10), target: 'self_location' });
  entry.on_success.push(...sub.effects);
  return (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd bot && npm test -- --testPathPattern cardEffectParser`

- [ ] **Step 5: Commit**

```bash
git add bot/engine/cardEffectParser.js bot/tests/cardEffectParser.test.js
git commit -m "feat: parser - skill on_success extraction"
```

---

### Task 6: Parser — passives (stat_bonus, stat_penalty, extra_actions, hand_size_bonus)

**Files:**
- Modify: `bot/engine/cardEffectParser.js`
- Modify: `bot/tests/cardEffectParser.test.js`

- [ ] **Step 1: Write failing tests**

Append:

```javascript
describe('parser - passives', () => {
  const parseAsset = text => parse({ name: 'X', type_code: 'asset', text });

  test('Beat Cop: +1 combat always-on', () => {
    const e = parseAsset('You get +1 [combat].\n[fast] Discard Beat Cop: Deal 1 damage to an enemy at your location.');
    expect(e.passive).toContainEqual({ type: 'stat_bonus', stat: 'combat', value: 1, condition: null });
  });

  test('Magnifying Glass: +1 intellect while investigating', () => {
    const e = parseAsset('Fast.\nYou get +1 [intellect] while investigating.');
    expect(e.passive).toContainEqual({ type: 'stat_bonus', stat: 'intellect', value: 1, condition: 'while_investigating' });
  });

  test('Leo De Luca: extra action', () => {
    const e = parseAsset('You may take an additional action during your turn.');
    expect(e.passive).toContainEqual({ type: 'extra_actions', value: 1 });
  });

  test('Laboratory Assistant: +2 hand size', () => {
    const e = parseAsset('Your maximum hand size is increased by 2.');
    expect(e.passive).toContainEqual({ type: 'hand_size_bonus', value: 2 });
  });

  test('Haunted: -1 to all skills', () => {
    const e = parse({ name: 'Haunted', type_code: 'treachery', subtype_code: 'weakness',
      text: 'Revelation - Add Haunted to your threat area.\nYou get -1 to each of your skills.\n[action] [action]: Discard Haunted.' });
    expect(e.passive).toContainEqual({ type: 'stat_penalty', stat: 'all', value: 1, condition: null });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd bot && npm test -- --testPathPattern cardEffectParser`

- [ ] **Step 3: Implement passive extraction**

Edit `bot/engine/cardEffectParser.js`. In `parse(card)`, after `applyConditionRules`, before `applyEffectRules`, call:

```javascript
  text = extractPassives(text, entry);
```

Add helper:

```javascript
const STAT_KEYWORDS = ['combat', 'willpower', 'intellect', 'agility'];

function extractPassives(text, entry) {
  let t = text;

  // Stat bonuses: "You get +N [stat]" optionally followed by "while X"
  for (const stat of STAT_KEYWORDS) {
    const reCondition = new RegExp(`You get \\+(\\d+) \\[${stat}\\] while investigating`, 'i');
    const m1 = t.match(reCondition);
    if (m1) {
      entry.passive.push({ type: 'stat_bonus', stat, value: parseInt(m1[1], 10), condition: 'while_investigating' });
      t = t.replace(m1[0], '').trim();
      continue;
    }
    const reSimple = new RegExp(`You get \\+(\\d+) \\[${stat}\\](?!\\s*for)`, 'i');
    const m2 = t.match(reSimple);
    if (m2) {
      entry.passive.push({ type: 'stat_bonus', stat, value: parseInt(m2[1], 10), condition: null });
      t = t.replace(m2[0], '').trim();
    }
  }

  // -N to each of your skills
  const penAll = t.match(/You get -(\d+) to each of your skills/i);
  if (penAll) {
    entry.passive.push({ type: 'stat_penalty', stat: 'all', value: parseInt(penAll[1], 10), condition: null });
    t = t.replace(penAll[0], '').trim();
  }

  // Extra actions
  if (/You may take an additional action during your turn/i.test(t)) {
    entry.passive.push({ type: 'extra_actions', value: 1 });
    t = t.replace(/You may take an additional action during your turn\.?/i, '').trim();
  }

  // Hand size
  const hs = t.match(/Your maximum hand size is increased by (\d+)/i);
  if (hs) {
    entry.passive.push({ type: 'hand_size_bonus', value: parseInt(hs[1], 10) });
    t = t.replace(hs[0], '').trim();
  }

  return t;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd bot && npm test -- --testPathPattern cardEffectParser`

- [ ] **Step 5: Commit**

```bash
git add bot/engine/cardEffectParser.js bot/tests/cardEffectParser.test.js
git commit -m "feat: parser - passive stat/action/hand-size"
```

---

### Task 7: Parser — revelation, weakness discard cost, threat-area routing

**Files:**
- Modify: `bot/engine/cardEffectParser.js`
- Modify: `bot/tests/cardEffectParser.test.js`

- [ ] **Step 1: Write failing tests**

Append:

```javascript
describe('parser - weakness fields', () => {
  test('Haunted: discard_cost 2 + revelation adds to threat area', () => {
    const e = parse({ name: 'Haunted', type_code: 'treachery', subtype_code: 'weakness',
      text: 'Revelation - Add Haunted to your threat area.\nYou get -1 to each of your skills.\n[action] [action]: Discard Haunted.' });
    expect(e.discard_cost).toBe(2);
    expect(e.revelation_effects).toContainEqual({ type: 'add_to_threat_area' });
  });

  test('Hospital Debts: revelation puts into threat area', () => {
    const e = parse({ name: 'Hospital Debts', type_code: 'treachery', subtype_code: 'weakness',
      text: 'Revelation - Put Hospital Debts into play in your threat area.\n[fast]: Move 1 resource from your resource pool to Hospital Debts.' });
    expect(e.revelation_effects).toContainEqual({ type: 'add_to_threat_area' });
  });

  test('Paranoia: revelation discards all resources', () => {
    const e = parse({ name: 'Paranoia', type_code: 'treachery', subtype_code: 'weakness',
      text: 'Revelation - Discard all your resources.' });
    expect(e.revelation_effects).toContainEqual({ type: 'discard_all_resources' });
  });

  test('Abandoned and Alone: direct horror in revelation', () => {
    const e = parse({ name: 'Abandoned and Alone', type_code: 'treachery', subtype_code: 'weakness',
      text: 'Revelation - Take 2 direct horror and remove all cards in your discard pile from the game.' });
    expect(e.revelation_effects).toContainEqual({ type: 'deal_horror', count: 2, target: 'self', direct: true });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd bot && npm test -- --testPathPattern cardEffectParser`

- [ ] **Step 3: Implement revelation routing + discard cost**

Edit `bot/engine/cardEffectParser.js`. In `parse(card)`, before `applyConditionRules`, add:

```javascript
  // Revelation routing
  const revMatch = text.match(/Revelation\s*[-—]\s*([^\n]+)/i);
  if (revMatch) {
    const revText = revMatch[1];
    if (/(?:Add|Put) [^.]* (?:to|into play in) your threat area/i.test(revText)) {
      entry.revelation_effects.push({ type: 'add_to_threat_area' });
    }
    if (/Discard all your resources/i.test(revText)) {
      entry.revelation_effects.push({ type: 'discard_all_resources' });
    }
    const dh = revText.match(/Take (\d+) (direct )?horror/i);
    if (dh) {
      entry.revelation_effects.push({ type: 'deal_horror', count: parseInt(dh[1], 10), target: 'self', ...(dh[2] ? { direct: true } : {}) });
    }
    const dd = revText.match(/Take (\d+) (direct )?damage/i);
    if (dd) {
      entry.revelation_effects.push({ type: 'deal_damage', count: parseInt(dd[1], 10), target: 'self', ...(dd[2] ? { direct: true } : {}) });
    }
    text = text.replace(revMatch[0], '').trim();
  }

  // [action] [action]: Discard <name>
  if (/\[action\]\s*\[action\][^\n]*:\s*Discard\b/i.test(text)) {
    entry.discard_cost = 2;
    text = text.replace(/\[action\]\s*\[action\][^\n]*:\s*Discard[^\n]*/i, '').trim();
  }
```

- [ ] **Step 4: Run, verify pass**

Run: `cd bot && npm test -- --testPathPattern cardEffectParser`

- [ ] **Step 5: Commit**

```bash
git add bot/engine/cardEffectParser.js bot/tests/cardEffectParser.test.js
git commit -m "feat: parser - revelation + discard_cost"
```

---

### Task 8: Build script `buildCardEffects.js`

**Files:**
- Create: `bot/scripts/buildCardEffects.js`

- [ ] **Step 1: Write the build script**

Write `bot/scripts/buildCardEffects.js`:

```javascript
const fs = require('fs');
const path = require('path');
const { cardDataRoot } = require('../config');
const { parse, emptyEntry } = require('../engine/cardEffectParser');

const OUTPUT = path.join(__dirname, '..', 'data', 'card_effects.json');

function main() {
  const map = {};
  let total = 0;
  let parsed = 0;
  const unparsedSamples = [];

  const dirs = fs.readdirSync(cardDataRoot, { withFileTypes: true })
    .filter(e => e.isDirectory());

  for (const dir of dirs) {
    const file = path.join(cardDataRoot, dir.name, 'cards.json');
    if (!fs.existsSync(file)) continue;
    const cards = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const card of cards) {
      if (!card.code) continue;
      total++;
      const entry = parse(card);
      const hasStructured =
        entry.effects.length || entry.on_success.length ||
        entry.passive.length || entry.triggers.length ||
        entry.revelation_effects.length;
      if (hasStructured) parsed++;
      else if (card.text && unparsedSamples.length < 20) {
        unparsedSamples.push(`${card.code} ${card.name}: ${entry.unparsed_text.slice(0, 80)}`);
      }
      map[card.code] = entry;
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const sorted = Object.fromEntries(Object.keys(map).sort().map(k => [k, map[k]]));
  fs.writeFileSync(OUTPUT, JSON.stringify(sorted, null, 2));

  console.log(`Wrote ${OUTPUT}`);
  console.log(`Total cards: ${total}`);
  console.log(`Parsed (any structured field): ${parsed} (${(100 * parsed / total).toFixed(1)}%)`);
  console.log(`\nFirst 20 cards with unparsed text:`);
  unparsedSamples.forEach(s => console.log(' ', s));
}

main();
```

- [ ] **Step 2: Run the build**

Run: `cd bot && node scripts/buildCardEffects.js`
Expected: prints stats, generates `bot/data/card_effects.json`. Parsed % should be > 30% on first run.

- [ ] **Step 3: Spot-check generated output**

Run:

```bash
cd bot && node -e "const m = require('./data/card_effects.json'); console.log(JSON.stringify(m['01064'], null, 2)); console.log(JSON.stringify(m['01048'], null, 2)); console.log(JSON.stringify(m['01098'], null, 2));"
```

Expected: Drawn to the Flame has effects array, Leo De Luca has passive array, Haunted has revelation + passive + discard_cost.

- [ ] **Step 4: Commit script + generated JSON**

```bash
git add bot/scripts/buildCardEffects.js bot/data/card_effects.json
git commit -m "feat: card effects build script + generated JSON"
```

---

### Task 9: Resolver — loader + getEffectiveStat

**Files:**
- Create: `bot/engine/cardEffectResolver.js`
- Create: `bot/tests/cardEffectResolver.test.js`

- [ ] **Step 1: Write failing tests**

Write `bot/tests/cardEffectResolver.test.js`:

```javascript
jest.mock('../db/database', () => ({ getDb: () => null }));

const path = require('path');
const fs = require('fs');

const TMP = path.join(__dirname, 'tmp_card_effects.json');

beforeAll(() => {
  fs.writeFileSync(TMP, JSON.stringify({
    '01018': { name: 'Beat Cop', passive: [{ type: 'stat_bonus', stat: 'combat', value: 1, condition: null }] },
    '01030': { name: 'Magnifying Glass', passive: [{ type: 'stat_bonus', stat: 'intellect', value: 1, condition: 'while_investigating' }] },
    '01098': { name: 'Haunted', passive: [{ type: 'stat_penalty', stat: 'all', value: 1, condition: null }] },
    '01048': { name: 'Leo De Luca', passive: [{ type: 'extra_actions', value: 1 }] },
    '02020': { name: 'Lab Assistant', passive: [{ type: 'hand_size_bonus', value: 2 }] },
  }));
  process.env.CARD_EFFECTS_PATH = TMP;
});

afterAll(() => fs.unlinkSync(TMP));

const investigator = { code: '01001', name: 'Roland', skills: { combat: 4, willpower: 3, intellect: 3, agility: 2 } };

describe('resolver - effective stats', () => {
  test('base stat with no assets', () => {
    const { getEffectiveStat } = require('../engine/cardEffectResolver');
    const player = { investigator_code: '01001', assets: '[]', threat_area: '[]' };
    expect(getEffectiveStat(player, 'combat', {}, investigator)).toBe(4);
  });

  test('Beat Cop adds +1 combat always', () => {
    const { getEffectiveStat } = require('../engine/cardEffectResolver');
    const player = { investigator_code: '01001', assets: '["01018"]', threat_area: '[]' };
    expect(getEffectiveStat(player, 'combat', {}, investigator)).toBe(5);
    expect(getEffectiveStat(player, 'willpower', {}, investigator)).toBe(3);
  });

  test('Magnifying Glass only applies while investigating', () => {
    const { getEffectiveStat } = require('../engine/cardEffectResolver');
    const player = { investigator_code: '01001', assets: '["01030"]', threat_area: '[]' };
    expect(getEffectiveStat(player, 'intellect', { investigating: true }, investigator)).toBe(4);
    expect(getEffectiveStat(player, 'intellect', { investigating: false }, investigator)).toBe(3);
  });

  test('Haunted applies -1 to every skill', () => {
    const { getEffectiveStat } = require('../engine/cardEffectResolver');
    const player = { investigator_code: '01001', assets: '[]', threat_area: '["01098"]' };
    expect(getEffectiveStat(player, 'combat', {}, investigator)).toBe(3);
    expect(getEffectiveStat(player, 'willpower', {}, investigator)).toBe(2);
  });

  test('getEffectiveActions adds extra_actions', () => {
    const { getEffectiveActions } = require('../engine/cardEffectResolver');
    expect(getEffectiveActions({ assets: '["01048"]', threat_area: '[]' })).toBe(4);
    expect(getEffectiveActions({ assets: '[]', threat_area: '[]' })).toBe(3);
  });

  test('getEffectiveHandSize adds hand_size_bonus', () => {
    const { getEffectiveHandSize } = require('../engine/cardEffectResolver');
    expect(getEffectiveHandSize({ assets: '["02020"]', threat_area: '[]' })).toBe(10);
    expect(getEffectiveHandSize({ assets: '[]', threat_area: '[]' })).toBe(8);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd bot && npm test -- --testPathPattern cardEffectResolver`
Expected: cannot find module errors.

- [ ] **Step 3: Implement resolver loader + stat helpers**

Write `bot/engine/cardEffectResolver.js`:

```javascript
const fs = require('fs');
const path = require('path');

let _effects = null;

function loadEffects() {
  if (_effects) return _effects;
  const file = process.env.CARD_EFFECTS_PATH || path.join(__dirname, '..', 'data', 'card_effects.json');
  if (!fs.existsSync(file)) {
    _effects = {};
    return _effects;
  }
  try {
    _effects = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    _effects = {};
  }
  return _effects;
}

function getEntry(code) {
  return loadEffects()[code] || null;
}

function passiveCardCodes(player) {
  const assets = JSON.parse(player.assets || '[]');
  const threat = JSON.parse(player.threat_area || '[]');
  return [...assets, ...threat];
}

function passiveApplies(passive, ctx) {
  if (!passive.condition) return true;
  if (passive.condition === 'while_investigating') return !!ctx.investigating;
  if (passive.condition === 'while_engaged_only_enemy') return !!ctx.engaged_only_enemy;
  if (passive.condition === 'while_no_clues') return !!ctx.no_clues;
  if (passive.condition === 'while_5_or_more_cards_in_hand') return !!ctx.five_plus_cards;
  return false;
}

function getEffectiveStat(player, stat, ctx, investigator) {
  const base = (investigator?.skills?.[stat]) ?? 0;
  let total = base;
  for (const code of passiveCardCodes(player)) {
    const entry = getEntry(code);
    if (!entry) continue;
    for (const p of (entry.passive || [])) {
      if (!passiveApplies(p, ctx || {})) continue;
      if (p.type === 'stat_bonus' && (p.stat === stat || p.stat === 'all')) total += p.value;
      if (p.type === 'stat_penalty' && (p.stat === stat || p.stat === 'all')) total -= p.value;
    }
  }
  return total;
}

function getEffectiveActions(player) {
  let total = 3;
  for (const code of passiveCardCodes(player)) {
    const entry = getEntry(code);
    if (!entry) continue;
    for (const p of (entry.passive || [])) {
      if (p.type === 'extra_actions') total += p.value;
    }
  }
  return total;
}

function getEffectiveHandSize(player) {
  let total = 8;
  for (const code of passiveCardCodes(player)) {
    const entry = getEntry(code);
    if (!entry) continue;
    for (const p of (entry.passive || [])) {
      if (p.type === 'hand_size_bonus') total += p.value;
    }
  }
  return total;
}

function _resetForTests() { _effects = null; }

module.exports = {
  getEntry,
  getEffectiveStat,
  getEffectiveActions,
  getEffectiveHandSize,
  _resetForTests,
};
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd bot && npm test -- --testPathPattern cardEffectResolver`

- [ ] **Step 5: Commit**

```bash
git add bot/engine/cardEffectResolver.js bot/tests/cardEffectResolver.test.js
git commit -m "feat: resolver - loader + stat aggregation"
```

---

### Task 10: Wire `getEffectiveStat` into test/fight/evade/investigate

**Files:**
- Modify: `bot/commands/game/test.js` lines 128-129, 217-218
- Modify: `bot/commands/game/fight.js` lines 116-117, 235-236
- Modify: `bot/commands/game/evade.js` lines 106-107, 204-205
- Modify: `bot/commands/game/investigate.js` (locate `inv?.skills?.[stat]` lines)

- [ ] **Step 1: Add resolver import + replace stat lookup in test.js**

Edit `bot/commands/game/test.js`. After existing requires at top, add:

```javascript
const { getEffectiveStat } = require('../../engine/cardEffectResolver');
```

Find the line `const statValue = inv?.skills?.[statName] ?? 0;` (around line 129) and replace with:

```javascript
    const statValue = getEffectiveStat(player, statName, {}, inv);
```

Find the same pattern around line 218 (in `executeTestAction`) — `const statValue = inv?.skills?.[stat] ?? 0;` — and replace with:

```javascript
  const statValue = getEffectiveStat(freshPlayer, stat, {}, inv);
```

- [ ] **Step 2: Same for fight.js**

Edit `bot/commands/game/fight.js`. Add the same import. Replace both `inv?.skills?.[statName] ?? 0` (line 117) and `inv?.skills?.[statName] ?? 0` (line 236) using player/freshPlayer respectively, ctx `{}`.

- [ ] **Step 3: Same for evade.js**

Edit `bot/commands/game/evade.js`. Add import. Replace both occurrences (lines 107, 205).

- [ ] **Step 4: Same for investigate.js (with investigating ctx)**

Edit `bot/commands/game/investigate.js`. Add import. Find `inv?.skills?.[statName] ?? 0` and similar — replace with:

```javascript
const statValue = getEffectiveStat(player, statName, { investigating: true }, inv);
```

- [ ] **Step 5: Smoke test (manual)**

Restart bot. Run a `/test willpower 3` while no assets in play — base stat should be unchanged. With Beat Cop (`/play 01018`) in play, run `/fight` — stat should be +1. With Leo De Luca, action_count is not yet wired (Task 12), but the fight should still resolve.

- [ ] **Step 6: Commit**

```bash
git add bot/commands/game/test.js bot/commands/game/fight.js bot/commands/game/evade.js bot/commands/game/investigate.js
git commit -m "feat: wire getEffectiveStat into all test commands"
```

---

### Task 11: Resolver — `resolveOnSuccess` (skill cards)

**Files:**
- Modify: `bot/engine/cardEffectResolver.js`
- Modify: `bot/tests/cardEffectResolver.test.js`
- Modify: `bot/commands/game/test.js`, `fight.js`, `evade.js`, `investigate.js`

- [ ] **Step 1: Write failing test**

Append to `bot/tests/cardEffectResolver.test.js`:

```javascript
describe('resolveOnSuccess', () => {
  beforeAll(() => {
    fs.writeFileSync(TMP, JSON.stringify({
      ...JSON.parse(fs.readFileSync(TMP, 'utf8')),
      '01089': { name: 'Guts', on_success: [{ type: 'draw_cards', count: 1 }] },
      '01067': { name: 'Fearless', on_success: [{ type: 'heal_horror', count: 1, target: 'self' }] },
    }));
    require('../engine/cardEffectResolver')._resetForTests();
  });

  test('aggregates effects across committed cards', () => {
    const { resolveOnSuccess } = require('../engine/cardEffectResolver');
    const out = resolveOnSuccess(['01089', '01067']);
    expect(out).toEqual([
      { type: 'draw_cards', count: 1 },
      { type: 'heal_horror', count: 1, target: 'self' },
    ]);
  });

  test('returns [] for empty / unknown', () => {
    const { resolveOnSuccess } = require('../engine/cardEffectResolver');
    expect(resolveOnSuccess([])).toEqual([]);
    expect(resolveOnSuccess(['99999'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement**

Edit `bot/engine/cardEffectResolver.js`. Add:

```javascript
function resolveOnSuccess(committedCodes) {
  const out = [];
  for (const code of committedCodes) {
    const entry = getEntry(code);
    if (!entry) continue;
    out.push(...(entry.on_success || []));
  }
  return out;
}
```

Add `resolveOnSuccess` to `module.exports`.

- [ ] **Step 3: Apply effects in test.js post-success**

Edit `bot/commands/game/test.js`. Inside the success branch (the `if (success)` block in `execute`), after the existing test outcome lines, add:

```javascript
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
```

- [ ] **Step 4: Same hook in fight.js, evade.js, investigate.js**

Apply the identical block to `fight.js`, `evade.js`, `investigate.js` inside their respective success branches in `execute`.

- [ ] **Step 5: Run jest**

Run: `cd bot && npm test`

- [ ] **Step 6: Commit**

```bash
git add bot/engine/cardEffectResolver.js bot/tests/cardEffectResolver.test.js bot/commands/game/test.js bot/commands/game/fight.js bot/commands/game/evade.js bot/commands/game/investigate.js
git commit -m "feat: resolveOnSuccess + skill on_success wire-up"
```

---

### Task 12: Wire action reset + hand-size warning into nextphase.js

**Files:**
- Modify: `bot/commands/game/nextphase.js`

- [ ] **Step 1: Add resolver import + reset on investigation start**

Edit `bot/commands/game/nextphase.js`. Add import at top:

```javascript
const { getEffectiveActions, getEffectiveHandSize } = require('../../engine/cardEffectResolver');
const { resetActions } = require('../../engine/gameState');
```

Locate the MYTHOS → INVESTIGATION block (after `current === 'mythos'`). After phase update, before the steps push, insert:

```javascript
      const players = getPlayers(getCampaign().id);
      for (const p of players) {
        const fresh = getPlayerById(p.id);
        const max = getEffectiveActions(fresh);
        resetActions(p.id, max);
      }
      steps.push(`🎯 actions reset for all players (3 + bonuses)`);
```

Apply the same insertion in the UPKEEP → MYTHOS → INVESTIGATION end-of-round block where appropriate (depending on whether your phase loop resets here or at investigation start).

- [ ] **Step 2: Replace hand-size warning**

In the same file, find line 84 (`if (currentHand.length > 8)`) and replace with:

```javascript
        const handMax = getEffectiveHandSize(p4);
        if (currentHand.length > handMax) {
```

Update the inline message: replace `(limit 8)` with `` (limit ${handMax}) ``.

- [ ] **Step 3: Smoke test**

Restart bot. Run `/nextphase` cycle. Verify all players' `action_count` updates correctly. With Leo De Luca in play, players get 4 actions.

- [ ] **Step 4: Commit**

```bash
git add bot/commands/game/nextphase.js
git commit -m "feat: nextphase action reset + dynamic hand-size warning"
```

---

### Task 13: Resolver — `resolveOnPlay` (no targeting yet)

**Files:**
- Modify: `bot/engine/cardEffectResolver.js`
- Modify: `bot/tests/cardEffectResolver.test.js`
- Create: `bot/engine/effectExecutors.js`

- [ ] **Step 1: Write failing test**

Append to `bot/tests/cardEffectResolver.test.js`:

```javascript
describe('resolveOnPlay', () => {
  test('returns plan with effects + needs_targets list', () => {
    const { resolveOnPlay } = require('../engine/cardEffectResolver');
    const plan = resolveOnPlay('01064'); // Drawn to the Flame
    expect(plan.effects[0]).toEqual({ type: 'draw_encounter_card', count: 1 });
    expect(plan.effects[1]).toEqual({ type: 'discover_clues', count: 2, target: 'self_location' });
    expect(plan.needs_targets).toEqual([]);
    expect(plan.fast).toBe(false);
  });

  test('marks targeted effects in needs_targets', () => {
    fs.writeFileSync(TMP, JSON.stringify({
      ...JSON.parse(fs.readFileSync(TMP, 'utf8')),
      '01052': { name: 'Sneak Attack', fast: false, effects: [{ type: 'deal_damage', count: 2, target: 'chosen_enemy' }] },
    }));
    require('../engine/cardEffectResolver')._resetForTests();
    const { resolveOnPlay } = require('../engine/cardEffectResolver');
    const plan = resolveOnPlay('01052');
    expect(plan.needs_targets).toContainEqual({ effect_index: 0, target: 'chosen_enemy' });
  });
});
```

- [ ] **Step 2: Implement resolveOnPlay (planning only — execution in Task 14)**

Edit `bot/engine/cardEffectResolver.js`. Add:

```javascript
function resolveOnPlay(code) {
  const entry = getEntry(code);
  if (!entry) return { effects: [], needs_targets: [], fast: false, conditions: [], unparsed: '' };
  const needsTargets = [];
  (entry.effects || []).forEach((eff, i) => {
    if (typeof eff.target === 'string' && eff.target.startsWith('chosen_')) {
      needsTargets.push({ effect_index: i, target: eff.target });
    }
  });
  return {
    effects: entry.effects || [],
    needs_targets: needsTargets,
    fast: !!entry.fast,
    conditions: entry.conditions || [],
    unparsed: entry.unparsed_text || '',
  };
}
```

Export `resolveOnPlay`.

- [ ] **Step 3: Run jest**

Run: `cd bot && npm test`

- [ ] **Step 4: Commit**

```bash
git add bot/engine/cardEffectResolver.js bot/tests/cardEffectResolver.test.js
git commit -m "feat: resolver - resolveOnPlay planning"
```

---

### Task 14: Effect executors — auto-resolve untargeted effects in play.js

**Files:**
- Create: `bot/engine/effectExecutors.js`
- Modify: `bot/commands/game/play.js`

- [ ] **Step 1: Create effect executors module**

Write `bot/engine/effectExecutors.js`:

```javascript
const { getPlayerById, updatePlayer, getLocation, updateLocation, getSession, updateSession } = require('./gameState');
const { drawCards } = require('./deck');
const { drawEncounterCard, postEncounterCard } = require('./encounterEngine');

async function execEffect(effect, ctx) {
  const { player, session, guild } = ctx;
  const fresh = getPlayerById(player.id);
  switch (effect.type) {
    case 'draw_cards': {
      drawCards(fresh, effect.count);
      return `🎴 Drew ${effect.count} card(s).`;
    }
    case 'gain_resources': {
      updatePlayer(player.id, { resources: fresh.resources + effect.count });
      return `💰 Gained ${effect.count} resource(s).`;
    }
    case 'discover_clues': {
      if (effect.target === 'self_location') {
        const loc = getLocation(session.id, fresh.location_code);
        if (loc) {
          const newClues = Math.max(0, loc.clues - effect.count);
          updateLocation(loc.id, { clues: newClues });
          return `🔎 Discovered ${effect.count} clue(s) at ${loc.name} (${newClues} remaining).`;
        }
      }
      return `🔎 Discover ${effect.count} clue(s) — manual.`;
    }
    case 'draw_encounter_card': {
      const session2 = getSession();
      const code = drawEncounterCard(session2);
      if (!code) return `📜 Encounter deck empty.`;
      const ch = guild.channels.cache.get(session2.encounter_channel_id);
      if (ch) await postEncounterCard(ch, code);
      return `📜 Drew encounter card \`${code}\`.`;
    }
    case 'add_doom': {
      updateSession(session.id, { doom: session.doom + effect.count });
      return `💀 +${effect.count} doom.`;
    }
    case 'heal_horror': {
      const newSan = Math.min(fresh.max_sanity, fresh.sanity + effect.count);
      updatePlayer(player.id, { sanity: newSan });
      return `💚 Healed ${effect.count} horror.`;
    }
    case 'heal_damage': {
      const newHp = Math.min(fresh.max_hp, fresh.hp + effect.count);
      updatePlayer(player.id, { hp: newHp });
      return `❤️ Healed ${effect.count} damage.`;
    }
    case 'deal_horror': {
      if (effect.target === 'self') {
        const newSan = Math.max(0, fresh.sanity - effect.count);
        updatePlayer(player.id, { sanity: newSan });
        return `🧠 Took ${effect.count}${effect.direct ? ' direct' : ''} horror.`;
      }
      return `🧠 Deal ${effect.count} horror — manual.`;
    }
    case 'deal_damage': {
      if (effect.target === 'self') {
        const newHp = Math.max(0, fresh.hp - effect.count);
        updatePlayer(player.id, { hp: newHp });
        return `🩸 Took ${effect.count}${effect.direct ? ' direct' : ''} damage.`;
      }
      return `🩸 Deal ${effect.count} damage — manual (target: ${effect.target}).`;
    }
    default:
      return `⚙️ Effect \`${effect.type}\` — resolve manually.`;
  }
}

module.exports = { execEffect };
```

- [ ] **Step 2: Wire into play.js after card moves to discard**

Edit `bot/commands/game/play.js`. Add imports:

```javascript
const { resolveOnPlay } = require('../../engine/cardEffectResolver');
const { execEffect } = require('../../engine/effectExecutors');
const { decrementActions } = require('../../engine/gameState');
```

After the existing card-play logic posts the card image and moves it to discard, add (locate the post-success block in `execute`):

```javascript
    const plan = resolveOnPlay(cardCode);
    if (plan.effects.length || plan.unparsed) {
      const lines = [];
      // Block on enforceable conditions
      if (plan.conditions.includes('no_enemies_at_location')) {
        const enemies = require('../../engine/gameState').getEnemiesAt(session.id, player.location_code);
        if (enemies.length > 0) {
          return interaction.followUp({ content: `❌ Cannot play \`${cardCode}\` — enemies at your location.`, flags: 64 });
        }
      }
      if (!plan.fast) {
        const remaining = decrementActions(player.id);
        lines.push(`⏱️ -1 action (${remaining} remaining).`);
      } else {
        lines.push(`⚡ Fast — no action cost.`);
      }
      const ctx = { player, session, guild: interaction.guild };
      for (let i = 0; i < plan.effects.length; i++) {
        const eff = plan.effects[i];
        if (plan.needs_targets.find(n => n.effect_index === i)) {
          lines.push(`🎯 \`${eff.type}\` requires target \`${eff.target}\` — resolve manually.`);
          continue;
        }
        lines.push(await execEffect(eff, ctx));
      }
      if (plan.unparsed) lines.push(`📖 **Manual:** ${plan.unparsed}`);
      await interaction.followUp(lines.join('\n'));
    }
```

- [ ] **Step 3: Smoke test**

Restart bot, deploy commands, in dev guild run `/play drawn-to-the-flame`. Bot should auto-draw an encounter card, discover 2 clues at the player's location, and decrement action_count by 1.

- [ ] **Step 4: Commit**

```bash
git add bot/engine/effectExecutors.js bot/commands/game/play.js
git commit -m "feat: auto-resolve untargeted effects on play"
```

---

### Task 15: Targeting select menus for `chosen_*` effects

**Files:**
- Modify: `bot/commands/game/play.js`
- Modify: `bot/index.js` (add routing for new customId prefix)
- Create: `bot/engine/targetSelector.js`

- [ ] **Step 1: Create target selector utility**

Write `bot/engine/targetSelector.js`:

```javascript
const { StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
const { getEnemiesAt, getPlayers, getLocations, getCampaign } = require('./gameState');

function buildSelectFor(target, ctx) {
  const { session, player } = ctx;
  let options = [];
  let placeholder = 'Choose target';

  if (target === 'chosen_enemy') {
    const enemies = getEnemiesAt(session.id, player.location_code);
    options = enemies.map(e => ({ label: `${e.name} (HP ${e.hp}/${e.max_hp})`, value: `enemy:${e.id}` }));
    placeholder = 'Choose enemy';
  } else if (target === 'chosen_investigator') {
    const players = getPlayers(getCampaign().id).filter(p => p.location_code === player.location_code);
    options = players.map(p => ({ label: p.investigator_name, value: `inv:${p.id}` }));
    placeholder = 'Choose investigator';
  } else if (target === 'chosen_location') {
    const locs = getLocations(session.id).filter(l => l.act_index <= session.act_index && l.status !== 'hidden');
    options = locs.map(l => ({ label: l.name, value: `loc:${l.code}` }));
    placeholder = 'Choose location';
  }
  if (options.length === 0) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`tgt:${ctx.token}`)
    .setPlaceholder(placeholder)
    .addOptions(options.slice(0, 25));
  return new ActionRowBuilder().addComponents(menu);
}

module.exports = { buildSelectFor };
```

- [ ] **Step 2: For now, defer targeting via "manual" message**

Until full targeting flow is wired, retain the existing manual-resolve path. Replace the `lines.push(\`🎯 ...\`)` line in `play.js` with:

```javascript
        if (eff.target === 'chosen_enemy') {
          const enemies = require('../../engine/gameState').getEnemiesAt(session.id, player.location_code);
          if (enemies.length === 1) {
            // Auto-pick the only enemy
            const e = enemies[0];
            const { damageEnemy, defeatEnemy } = require('../../engine/enemyEngine');
            const newHp = damageEnemy(e, eff.count);
            if (newHp === 0) defeatEnemy(e.id);
            lines.push(`🩸 Auto-applied: ${eff.count} damage to **${e.name}** (only enemy at location).`);
            continue;
          }
        }
        lines.push(`🎯 \`${eff.type}\` requires target \`${eff.target}\` — resolve manually.`);
```

(Full select-menu UX deferred to a later iteration; auto-pick when only one valid target.)

- [ ] **Step 3: Smoke test**

Restart bot. With one enemy at the location, run `/play sneak-attack` (01052). Should auto-deal 2 damage to that enemy. With multiple enemies, falls back to manual.

- [ ] **Step 4: Commit**

```bash
git add bot/engine/targetSelector.js bot/commands/game/play.js
git commit -m "feat: auto-target single-enemy effects, defer multi-target UX"
```

---

### Task 16: Weakness handling — revelation on encounter draw + `/weakness discard` command

**Files:**
- Modify: `bot/engine/encounterEngine.js`
- Create: `bot/commands/game/weakness.js`
- Modify: `bot/engine/gameState.js` (already done — ensure `addToThreatArea` and `removeFromThreatArea` exported)

- [ ] **Step 1: Fire revelation on weakness draw**

Edit `bot/engine/encounterEngine.js`. After `postEncounterCard` (or wherever a single encounter card is resolved per player), add a helper:

```javascript
async function applyRevelationIfWeakness(card, player, channel) {
  const { getEntry } = require('./cardEffectResolver');
  const { addToThreatArea, updatePlayer, getPlayerById } = require('./gameState');
  const entry = getEntry(card.code);
  if (!entry || !entry.is_weakness || !entry.revelation_effects.length) return;
  const fresh = getPlayerById(player.id);
  const lines = [];
  for (const eff of entry.revelation_effects) {
    if (eff.type === 'add_to_threat_area') {
      addToThreatArea(player.id, card.code);
      lines.push(`🔻 **${card.name}** added to threat area.`);
    } else if (eff.type === 'discard_all_resources') {
      updatePlayer(player.id, { resources: 0 });
      lines.push(`💸 All resources discarded.`);
    } else if (eff.type === 'deal_horror' && eff.target === 'self') {
      const newSan = Math.max(0, fresh.sanity - eff.count);
      updatePlayer(player.id, { sanity: newSan });
      lines.push(`🧠 Took ${eff.count}${eff.direct ? ' direct' : ''} horror.`);
    } else if (eff.type === 'deal_damage' && eff.target === 'self') {
      const newHp = Math.max(0, fresh.hp - eff.count);
      updatePlayer(player.id, { hp: newHp });
      lines.push(`🩸 Took ${eff.count}${eff.direct ? ' direct' : ''} damage.`);
    }
  }
  if (lines.length && channel) await channel.send(`**${player.investigator_name}** revelation: ${card.name}\n` + lines.join('\n'));
}

module.exports.applyRevelationIfWeakness = applyRevelationIfWeakness;
```

In `runMythosEncounters` (or whichever function deals one card per player), after `postEncounterCard(...)` call this new helper with `(card, player, channel)`.

- [ ] **Step 2: Create `/weakness discard` command**

Write `bot/commands/game/weakness.js`:

```javascript
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireSession, requirePlayer, getPlayerById, removeFromThreatArea, decrementActions, getThreatArea } = require('../../engine/gameState');
const { getEntry } = require('../../engine/cardEffectResolver');
const { findCardByCode } = require('../../engine/cardLookup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weakness')
    .setDescription('Discard a weakness from your threat area.')
    .addSubcommand(sub => sub
      .setName('discard')
      .setDescription('Discard a weakness (costs actions per card text).')
      .addStringOption(o => o.setName('code').setDescription('Card code in your threat area').setRequired(true).setAutocomplete(true))),
  async autocomplete(interaction) {
    const { getPlayer } = require('../../engine/gameState');
    const player = getPlayer(interaction.user.id);
    if (!player) return interaction.respond([]);
    const codes = getThreatArea(player.id);
    const choices = codes.map(c => {
      const r = findCardByCode(c);
      return { name: r ? `${r.card.name} (${c})` : c, value: c };
    }).slice(0, 25);
    return interaction.respond(choices);
  },
  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const player = requirePlayer(interaction);
    if (!player) return;
    const code = interaction.options.getString('code');
    const entry = getEntry(code);
    if (!entry) return interaction.reply({ content: `❌ No card data for ${code}.`, flags: 64 });
    if (entry.discard_cost == null) return interaction.reply({ content: `❌ ${entry.name} has no discard cost — resolve manually.`, flags: 64 });
    const fresh = getPlayerById(player.id);
    if ((fresh.action_count ?? 0) < entry.discard_cost) {
      return interaction.reply({ content: `❌ Need ${entry.discard_cost} actions, have ${fresh.action_count}.`, flags: 64 });
    }
    const remaining = decrementActions(player.id, entry.discard_cost);
    removeFromThreatArea(player.id, code);
    return interaction.reply(`✅ Discarded **${entry.name}** (cost ${entry.discard_cost} actions, ${remaining} left).`);
  },
};
```

- [ ] **Step 3: Deploy & smoke test**

Run: `cd bot && node deploy-commands.js && pkill -f "node.*index.js"; node index.js >> /tmp/arkham-bot.log 2>&1 &`

In Discord: simulate weakness draw via mythos (or manual `/encounter draw` if added later). Verify weakness lands in threat_area (check via `/dashboard` or DB inspection). Run `/weakness discard <code>` — should cost 2 actions and remove from threat area.

- [ ] **Step 4: Commit**

```bash
git add bot/engine/encounterEngine.js bot/commands/game/weakness.js
git commit -m "feat: weakness revelation auto-apply + /weakness discard"
```

---

### Task 17: Triggers — fire `after_take_damage` / `after_take_horror` from damage.js / horror.js

**Files:**
- Modify: `bot/commands/game/damage.js`
- Modify: `bot/commands/game/horror.js`
- Modify: `bot/engine/cardEffectResolver.js`

- [ ] **Step 1: Add `fireTriggers` to resolver**

Edit `bot/engine/cardEffectResolver.js`. Add:

```javascript
function fireTriggers(player, eventName) {
  const out = [];
  for (const code of passiveCardCodes(player)) {
    const entry = getEntry(code);
    if (!entry) continue;
    for (const trig of (entry.triggers || [])) {
      if (trig.event === eventName) {
        out.push({ source: code, source_name: entry.name, effects: trig.effects || [] });
      }
    }
  }
  return out;
}
```

Export `fireTriggers`.

- [ ] **Step 2: Wire damage.js**

Edit `bot/commands/game/damage.js`. After applying damage, add:

```javascript
const { fireTriggers } = require('../../engine/cardEffectResolver');
const { execEffect } = require('../../engine/effectExecutors');
// after damage applied:
const trigs = fireTriggers(player, 'after_take_damage');
const triggerLines = [];
for (const trig of trigs) {
  for (const eff of trig.effects) {
    triggerLines.push(`↪ from **${trig.source_name}**: ` + (await execEffect(eff, { player, session, guild: interaction.guild })));
  }
}
if (triggerLines.length) await interaction.followUp(triggerLines.join('\n'));
```

- [ ] **Step 3: Wire horror.js**

Same as damage.js but with `'after_take_horror'`.

- [ ] **Step 4: Commit**

```bash
git add bot/engine/cardEffectResolver.js bot/commands/game/damage.js bot/commands/game/horror.js
git commit -m "feat: fire after_take_damage / after_take_horror triggers"
```

---

### Task 18: Trigger — fire `after_successful_investigate`

**Files:**
- Modify: `bot/commands/game/investigate.js`

- [ ] **Step 1: Wire trigger after success**

Edit `bot/commands/game/investigate.js`. In the success branch of `execute`, after the existing success message lines, add:

```javascript
const { fireTriggers } = require('../../engine/cardEffectResolver');
const { execEffect } = require('../../engine/effectExecutors');
const trigs = fireTriggers(player, 'after_successful_investigate');
for (const trig of trigs) {
  for (const eff of trig.effects) {
    lines.push(`↪ from **${trig.source_name}**: ` + (await execEffect(eff, { player, session, guild: interaction.guild })));
  }
}
```

- [ ] **Step 2: Smoke test**

Restart bot. Play Dr. Milan Christopher (`01033`), then `/investigate` — succeed → bot should add 1 resource.

- [ ] **Step 3: Commit**

```bash
git add bot/commands/game/investigate.js
git commit -m "feat: fire after_successful_investigate trigger"
```

---

### Task 19: Parser rules for triggers (Forced/Reaction)

**Files:**
- Modify: `bot/engine/cardEffectParser.js`
- Modify: `bot/tests/cardEffectParser.test.js`
- Re-run build script

- [ ] **Step 1: Write failing tests**

Append:

```javascript
describe('parser - triggers', () => {
  test('Dr. Milan Christopher: after successful investigate', () => {
    const e = parse({ name: 'Dr. Milan Christopher', type_code: 'asset',
      text: 'You get +1 [intellect].\n[reaction] After you successfully investigate: Gain 1 resource.' });
    expect(e.triggers).toContainEqual({
      event: 'after_successful_investigate',
      effects: [{ type: 'gain_resources', count: 1 }],
    });
  });

  test('Psychosis: forced after take horror', () => {
    const e = parse({ name: 'Psychosis', type_code: 'treachery', subtype_code: 'weakness',
      text: 'Revelation - Add Psychosis to your threat area.\nForced - After you take 1 or more horror: Take 1 direct damage.\n[action] [action]: Discard Psychosis.' });
    expect(e.triggers).toContainEqual({
      event: 'after_take_horror',
      effects: [{ type: 'deal_damage', count: 1, target: 'self', direct: true }],
    });
  });
});
```

- [ ] **Step 2: Implement trigger extraction**

Edit `bot/engine/cardEffectParser.js`. In `parse(card)`, before `applyEffectRules`, add:

```javascript
  text = extractTriggers(text, entry);
```

Add helper:

```javascript
const TRIGGER_PATTERNS = [
  { re: /\[reaction\]\s*After you successfully investigate:\s*([^.\n]+)\./i, event: 'after_successful_investigate' },
  { re: /Forced\s*[-—]\s*After you take \d+ or more horror:\s*([^.\n]+)\./i, event: 'after_take_horror' },
  { re: /Forced\s*[-—]\s*After you take \d+ or more damage:\s*([^.\n]+)\./i, event: 'after_take_damage' },
];

function extractTriggers(text, entry) {
  let t = text;
  for (const { re, event } of TRIGGER_PATTERNS) {
    const m = t.match(re);
    if (m) {
      const inner = m[1].trim();
      const sub = emptyEntry();
      applyEffectRules(inner, sub);
      entry.triggers.push({ event, effects: sub.effects });
      t = t.replace(m[0], '').trim();
    }
  }
  return t;
}
```

- [ ] **Step 3: Run tests, rebuild JSON**

Run: `cd bot && npm test && node scripts/buildCardEffects.js`

- [ ] **Step 4: Commit**

```bash
git add bot/engine/cardEffectParser.js bot/tests/cardEffectParser.test.js bot/data/card_effects.json
git commit -m "feat: parser - trigger extraction (reaction/forced)"
```

---

### Task 20: Deploy + manual end-to-end smoke test

**Files:** none

- [ ] **Step 1: Deploy commands**

Run: `cd bot && node deploy-commands.js`

- [ ] **Step 2: Restart bot**

Run: `cd bot && pkill -f "node.*index.js"; node index.js >> /tmp/arkham-bot.log 2>&1 &`

- [ ] **Step 3: Manual smoke test in dev guild**

In your dev Discord, with an active session and a deck containing Drawn to the Flame, Beat Cop, Leo De Luca, Vicious Blow, Dr. Milan Christopher, and a basic weakness like Haunted:

1. Play Beat Cop → confirm `/fight` shows +1 combat in stat math.
2. Play Leo De Luca → run `/nextphase` cycle → confirm action_count goes to 4 next investigation.
3. Play Drawn to the Flame → confirm bot draws an encounter card and discovers 2 clues at your location.
4. Play Dr. Milan, then `/investigate` and succeed → confirm +1 resource posted.
5. Commit Vicious Blow to a `/fight` and succeed → confirm "+1 bonus damage" hint posted.
6. Force-add Haunted to threat area (via DB or `/clear` + manual setup) → run any test → confirm -1 to all skills. Then `/weakness discard 01098` → confirm action cost 2.

- [ ] **Step 4: Final commit**

If any tweaks needed during smoke test, commit them. Otherwise tag the implementation complete.

```bash
git log --oneline -25
```

---

## Out of Scope (Deferred to future plan)

- Full multi-target select-menu UX (Tasks 14-15 use auto-pick when single target available; multi-target falls back to manual). A subsequent plan can add the `tgt:` interaction routing and StringSelectMenu-driven flow.
- Cards modifying chaos bag behavior (Sure Gamble, etc.) — `unparsed_text` only.
- Cards modifying turn structure (Mind Wipe).
- Cancel effects (Ward of Protection, Dodge).
- Multi-effect compound triggers (`Forced` + `[reaction]` on the same card).
- `chosen_asset:{filter}` targeting for items like Extra Ammunition.

These remain manually resolved with card text shown in the `unparsed_text` reminder.
