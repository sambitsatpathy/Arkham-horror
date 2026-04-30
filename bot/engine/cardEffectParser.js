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

module.exports = { parse, stripHtml, emptyEntry };
