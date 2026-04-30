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
