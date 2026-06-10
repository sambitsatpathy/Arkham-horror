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
  revelation: null,
  keywords: [],
  prey: null,
  victory: 0,
  uses: null,
  health_per_investigator: false,
  discard_cost: null,
  unparsed_text: '',
};

function emptyEntry() {
  return JSON.parse(JSON.stringify(EMPTY_ENTRY));
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, '');
}

const SIMPLE_EFFECT_RULES = [
  { re: /Draw the top card of the encounter deck\.?/i,
    out: () => [{ type: 'draw_encounter_card', count: 1 }] },
  { re: /Gain (\d+) resources?/i,
    out: m => [{ type: 'gain_resources', count: parseInt(m[1], 10) }] },
  { re: /Draw (\d+) cards?/i,
    out: m => [{ type: 'draw_cards', count: parseInt(m[1], 10) }] },
  { re: /Discover (\d+) clues? (?:in|at) your location/i,
    out: m => [{ type: 'discover_clues', count: parseInt(m[1], 10), target: 'self_location' }] },
  { re: /Place (\d+)( \[per_investigator\])? doom on the current agenda/i,
    out: m => [{ type: 'add_doom', count: parseInt(m[1], 10), ...(m[2] ? { per_investigator: true } : {}) }] },
  { re: /Deal (\d+) damage to an? (?:exhausted )?enemy at your location/i,
    out: m => [{ type: 'deal_damage', count: parseInt(m[1], 10), target: 'chosen_enemy' }] },
  { re: /Deal (\d+) damage to each investigator at (?:your|this|that) location/i,
    out: m => [{ type: 'deal_damage', count: parseInt(m[1], 10), target: 'all_investigators_at_location' }] },
  { re: /Deal (\d+) horror to each investigator at (?:your|this|that) location/i,
    out: m => [{ type: 'deal_horror', count: parseInt(m[1], 10), target: 'all_investigators_at_location' }] },
  // Combined forms must come before the single damage/horror rules
  { re: /[Tt]ake (\d+) damage and (\d+) horror/,
    out: m => [
      { type: 'deal_damage', count: parseInt(m[1], 10), target: 'self' },
      { type: 'deal_horror', count: parseInt(m[2], 10), target: 'self' },
    ] },
  { re: /[Tt]ake (\d+) horror and (\d+) damage/,
    out: m => [
      { type: 'deal_horror', count: parseInt(m[1], 10), target: 'self' },
      { type: 'deal_damage', count: parseInt(m[2], 10), target: 'self' },
    ] },
  { re: /Take (\d+) (direct )?horror/i,
    out: m => [{ type: 'deal_horror', count: parseInt(m[1], 10), target: 'self', ...(m[2] ? { direct: true } : {}) }] },
  { re: /Take (\d+) (direct )?damage/i,
    out: m => [{ type: 'deal_damage', count: parseInt(m[1], 10), target: 'self', ...(m[2] ? { direct: true } : {}) }] },
  { re: /Heal (\d+) horror/i,
    out: m => [{ type: 'heal_horror', count: parseInt(m[1], 10), target: 'self' }] },
  { re: /Heal (\d+) damage/i,
    out: m => [{ type: 'heal_damage', count: parseInt(m[1], 10), target: 'self' }] },
  { re: /(?:Choose and discard|Discard) (\d+) cards? (at random )?from your hand/i,
    out: m => [{ type: 'discard_cards', count: parseInt(m[1], 10), random: !!m[2] }] },
  { re: /Discard (\d+) cards? at random/i,
    out: m => [{ type: 'discard_cards', count: parseInt(m[1], 10), random: true }] },
  { re: /Discard all your resources/i,
    out: () => [{ type: 'discard_all_resources' }] },
  { re: /Lose (\d+) resources?/i,
    out: m => [{ type: 'lose_resources', count: parseInt(m[1], 10) }] },
];

function applyEffectRules(text, entry) {
  let remaining = text;
  // Special: Dynamite Blast — emit two effects from one phrase
  const dyn = remaining.match(/Deal (\d+) damage to each enemy and to each investigator at (?:the chosen|your) location/i);
  if (dyn) {
    const n = parseInt(dyn[1], 10);
    entry.effects.push({ type: 'deal_damage', count: n, target: 'all_enemies_at_location' });
    entry.effects.push({ type: 'deal_damage', count: n, target: 'all_investigators_at_location' });
    remaining = (remaining.slice(0, dyn.index) + remaining.slice(dyn.index + dyn[0].length))
      .replace(/^[\s.,]+|[\s.,]+$/g, ' ')
      .replace(/^\s*\bThen\b[\s,.]*/i, '')
      .replace(/[\s,.]*\bThen\b\s*$/i, '')
      .trim();
  }
  let progress = true;
  while (progress) {
    progress = false;
    for (const rule of SIMPLE_EFFECT_RULES) {
      const m = remaining.match(rule.re);
      if (m) {
        entry.effects.push(...rule.out(m));
        remaining = (remaining.slice(0, m.index) + remaining.slice(m.index + m[0].length))
          .replace(/^[\s.,]+|[\s.,]+$/g, ' ')
          .replace(/^\s*\bThen\b[\s,.]*/i, '')
          .replace(/[\s,.]*\bThen\b\s*$/i, '')
          .trim();
        progress = true;
        break;
      }
    }
  }
  return remaining;
}

// Keyword sentences are capitalized on cards — match case-sensitively so prose
// like "Stay alert." is not consumed.
const KEYWORD_RE = /(?:^|\s)(Hunter|Aloof|Retaliate|Alert|Massive|Elusive|Surge|Peril)\.(?=\s|$)/;

function extractKeywords(text, entry) {
  let t = text;
  let m;
  while ((m = t.match(KEYWORD_RE))) {
    const kw = m[1].toLowerCase();
    if (!entry.keywords.includes(kw)) entry.keywords.push(kw);
    t = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)).trim();
  }
  return t;
}

function extractPrey(text, entry) {
  const m = text.match(/Prey\s*-\s*([^.\n]+)\.?/);
  if (!m) return text;
  entry.prey = m[1].trim();
  return (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
}

function extractUses(text, entry) {
  const m = text.match(/Uses\s*\((\d+)\s+([a-z]+)\)\.?/i);
  if (!m) return text;
  let type = m[2].toLowerCase();
  if (type === 'charge') type = 'charges';
  entry.uses = { type, count: parseInt(m[1], 10) };
  return (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
}

function parseClauseEffects(clause) {
  const sub = emptyEntry();
  const remaining = applyEffectRules(clause, sub);
  return { effects: sub.effects, remaining };
}

// Parses the body of a "Revelation - ..." line into { effects, test, unparsed }.
// Test-conditional effects live under test.on_fail / test.on_pass so they are
// never applied unconditionally; whatever can't be parsed lands in `unparsed`
// for manual resolution.
function parseRevelation(revText) {
  const rev = { effects: [], test: null, unparsed: '' };
  let t = revText.trim();

  if (/(?:Add|Put) [^.]* (?:to|into play in) your threat area/i.test(t)) {
    rev.effects.push({ type: 'add_to_threat_area' });
    t = t.replace(/(?:Add|Put) [^.]*? (?:to|into play in) your threat area\.?/i, '').trim();
  }

  const tm = t.match(/Test\s+\[(\w+)\](?:\s+or\s+\[(\w+)\])?\s*\((\d+)\)\.?/i);
  if (tm) {
    rev.test = {
      stat: tm[1].toLowerCase(),
      stat_alternatives: tm[2] ? [tm[2].toLowerCase()] : [],
      difficulty: parseInt(tm[3], 10),
      on_fail: [],
      on_pass: [],
    };
    t = (t.slice(0, tm.index) + t.slice(tm.index + tm[0].length)).trim();

    const perPoint = t.match(/For each point you fail by,\s*([^.]+)\./i);
    if (perPoint) {
      const { effects } = parseClauseEffects(perPoint[1]);
      if (effects.length) {
        effects.forEach(e => { e.per_point_failed = true; });
        rev.test.on_fail.push(...effects);
        t = (t.slice(0, perPoint.index) + t.slice(perPoint.index + perPoint[0].length)).trim();
      }
    }

    const onFail = t.match(/If you fail,\s*([^.]+)\./i);
    if (onFail) {
      const { effects } = parseClauseEffects(onFail[1]);
      if (effects.length) {
        rev.test.on_fail.push(...effects);
        t = (t.slice(0, onFail.index) + t.slice(onFail.index + onFail[0].length)).trim();
      }
    }

    const onPass = t.match(/If you succeed,\s*([^.]+)\./i);
    if (onPass) {
      const { effects } = parseClauseEffects(onPass[1]);
      if (effects.length) {
        rev.test.on_pass.push(...effects);
        t = (t.slice(0, onPass.index) + t.slice(onPass.index + onPass[0].length)).trim();
      }
    }
  }

  const direct = parseClauseEffects(t);
  rev.effects.push(...direct.effects);
  rev.unparsed = direct.remaining.trim();
  return rev;
}

const TRIGGER_PATTERNS = [
  { re: /\[reaction\]\s*After you successfully investigate:\s*([^.\n]+)\./i, event: 'after_successful_investigate' },
  { re: /Forced\s*-\s*After you take \d+ or more horror:\s*([^.\n]+)\./i, event: 'after_take_horror' },
  { re: /Forced\s*-\s*After you take \d+ or more damage:\s*([^.\n]+)\./i, event: 'after_take_damage' },
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

function extractOnSuccess(text, entry) {
  const m = text.match(/If this (?:skill )?test is successful(?:[^,]*)?,\s*([^.]+)\./i);
  if (!m) return text;
  const inner = m[1].trim();
  const sub = emptyEntry();
  applyEffectRules(inner, sub);
  if (sub.effects.length === 0) {
    // "that attack deals +N damage"
    const mm = inner.match(/that attack deals \+(\d+) damage/i);
    if (mm) sub.effects.push({ type: 'bonus_damage_on_attack', count: parseInt(mm[1], 10) });
  }
  // "discover N additional clues at that location"
  const dm = inner.match(/discover (\d+) additional clues? at that location/i);
  if (dm) sub.effects.push({ type: 'discover_clues', count: parseInt(dm[1], 10), target: 'self_location' });
  entry.on_success.push(...sub.effects);
  return (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
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

const STAT_KEYWORDS = ['combat', 'willpower', 'intellect', 'agility'];

function extractPassives(text, entry) {
  let t = text;

  // Stat bonuses: "You get +N [stat] while investigating" — must check before simple form
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

  // Hand size bonus
  const hs = t.match(/Your maximum hand size is increased by (\d+)/i);
  if (hs) {
    entry.passive.push({ type: 'hand_size_bonus', value: parseInt(hs[1], 10) });
    t = t.replace(hs[0], '').trim();
  }

  return t;
}

function parse(card) {
  const entry = emptyEntry();
  entry.name = card.name || '';
  entry.type = card.type_code || '';
  entry.is_weakness = card.subtype_code === 'weakness' || card.subtype_code === 'basicweakness';
  entry.victory = typeof card.victory === 'number' ? card.victory : 0;
  entry.health_per_investigator = !!card.health_per_investigator;
  // Normalize en/em dashes so "Revelation –" and "Forced —" all parse alike
  let text = stripHtml(card.text || '').replace(/[–—]/g, '-').trim();

  if (/^\s*Fast\./i.test(text)) {
    entry.fast = true;
    text = text.replace(/^\s*Fast\.\s*/i, '');
  }

  text = extractKeywords(text, entry);
  text = extractPrey(text, entry);
  text = extractUses(text, entry);

  const vm = text.match(/Victory (\d+)\.?/i);
  if (vm) {
    if (!entry.victory) entry.victory = parseInt(vm[1], 10);
    text = (text.slice(0, vm.index) + text.slice(vm.index + vm[0].length)).trim();
  }

  // Revelation routing
  const revMatch = text.match(/Revelation\s*-\s*([^\n]+)/i);
  if (revMatch) {
    const rev = parseRevelation(revMatch[1]);
    entry.revelation = rev;
    // Legacy flat list, kept for existing consumers — unconditional effects only,
    // so test-gated damage/horror is no longer flattened into always-on effects.
    for (const eff of rev.effects) {
      if (eff.type === 'add_to_threat_area' || eff.type === 'discard_all_resources') {
        entry.revelation_effects.push(eff);
      } else if ((eff.type === 'deal_horror' || eff.type === 'deal_damage') && eff.target === 'self') {
        entry.revelation_effects.push(eff);
      }
    }
    text = text.replace(revMatch[0], '').trim();
  }

  // [action] [action]: Discard <name>
  if (/\[action\]\s*\[action\][^\n]*:\s*Discard\b/i.test(text)) {
    entry.discard_cost = 2;
    text = text.replace(/\[action\]\s*\[action\][^\n]*:\s*Discard[^\n]*/i, '').trim();
  }

  text = applyConditionRules(text, entry);
  text = extractPassives(text, entry);
  text = extractTriggers(text, entry);
  text = extractOnSuccess(text, entry);
  text = applyEffectRules(text, entry);

  entry.unparsed_text = text.trim();
  return entry;
}

module.exports = { parse, stripHtml, emptyEntry };
