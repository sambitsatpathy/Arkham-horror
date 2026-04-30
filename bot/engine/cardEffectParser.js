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
