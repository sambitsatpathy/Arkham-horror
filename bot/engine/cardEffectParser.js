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

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, '');
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
        entry.effects.push(rule.out(m));
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
  let text = stripHtml(card.text || '').trim();

  if (/^\s*Fast\./i.test(text)) {
    entry.fast = true;
    text = text.replace(/^\s*Fast\.\s*/i, '');
  }

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

  text = applyConditionRules(text, entry);
  text = extractPassives(text, entry);
  text = extractTriggers(text, entry);
  text = extractOnSuccess(text, entry);
  text = applyEffectRules(text, entry);

  entry.unparsed_text = text.trim();
  return entry;
}

module.exports = { parse, stripHtml, emptyEntry };
