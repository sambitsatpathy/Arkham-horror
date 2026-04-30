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
