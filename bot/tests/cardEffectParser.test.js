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

describe('parser - keywords / prey / victory / uses', () => {
  test('Ghoul Priest: Hunter + Retaliate, Prey, per-investigator health, Victory 2', () => {
    const e = parse({
      name: 'Ghoul Priest', type_code: 'enemy', health: 5, health_per_investigator: true, victory: 2,
      text: '<b>Prey</b> - Highest [combat].\nHunter. Retaliate.',
    });
    expect(e.keywords).toEqual(expect.arrayContaining(['hunter', 'retaliate']));
    expect(e.prey).toBe('Highest [combat]');
    expect(e.victory).toBe(2);
    expect(e.health_per_investigator).toBe(true);
    expect(e.unparsed_text).toBe('');
  });

  test('keyword chain: Aloof. Elusive. Hunter.', () => {
    const e = parse({ name: 'X', type_code: 'enemy', text: 'Aloof. Elusive. Hunter.' });
    expect(e.keywords).toEqual(expect.arrayContaining(['aloof', 'elusive', 'hunter']));
  });

  test('prose with lowercase keyword is not consumed', () => {
    const e = parse({ name: 'X', type_code: 'enemy', text: 'Stay alert. Hunter.' });
    expect(e.keywords).toEqual(['hunter']);
    expect(e.unparsed_text).toContain('Stay alert.');
  });

  test('Victory from text when no data field', () => {
    const e = parse({ name: 'X', type_code: 'enemy', text: 'Hunter.\nVictory 1.' });
    expect(e.victory).toBe(1);
    expect(e.unparsed_text).toBe('');
  });

  test('.45 Automatic: Uses (4 ammo)', () => {
    const e = parse({ name: '.45 Automatic', type_code: 'asset',
      text: 'Uses (4 ammo).\n[action] Spend 1 ammo: Fight. You get +1 [combat] for this attack.' });
    expect(e.uses).toEqual({ type: 'ammo', count: 4 });
  });

  test('Shrivelling: Uses (4 charges)', () => {
    const e = parse({ name: 'Shrivelling', type_code: 'asset',
      text: 'Uses (4 charges).\n[action] Spend 1 charge: Fight. Use [willpower] instead of [combat] for this attack.' });
    expect(e.uses).toEqual({ type: 'charges', count: 4 });
  });

  test('Old Book of Lore: Uses (2 secrets)', () => {
    const e = parse({ name: 'Old Book of Lore', type_code: 'asset', text: 'Uses (2 secrets).' });
    expect(e.uses).toEqual({ type: 'secrets', count: 2 });
  });
});

describe('parser - revelation tests', () => {
  test('Rotting Remains: test-gated horror is not flattened', () => {
    const e = parse({ name: 'Rotting Remains', type_code: 'treachery',
      text: '<b>Revelation</b> - Test [willpower] (3). For each point you fail by, take 1 horror.' });
    expect(e.revelation.test).toEqual({
      stat: 'willpower', stat_alternatives: [], difficulty: 3,
      on_fail: [{ type: 'deal_horror', count: 1, target: 'self', per_point_failed: true }],
      on_pass: [],
    });
    expect(e.revelation.effects).toEqual([]);
    // the old bug: unconditional horror in revelation_effects
    expect(e.revelation_effects).toEqual([]);
  });

  test('Frozen in Fear: unparsed body falls back to manual', () => {
    const e = parse({ name: 'Frozen in Fear', type_code: 'treachery',
      text: '<b>Revelation</b> - Attach Frozen in Fear to your play area.' });
    expect(e.revelation.test).toBeNull();
    expect(e.revelation.unparsed).toContain('Attach Frozen in Fear');
  });

  test('en-dash revelation parses after normalization', () => {
    const e = parse({ name: 'X', type_code: 'treachery',
      text: 'Revelation – Test [intellect] or [agility] (4). If you fail, take 2 damage.' });
    expect(e.revelation.test.stat).toBe('intellect');
    expect(e.revelation.test.stat_alternatives).toEqual(['agility']);
    expect(e.revelation.test.difficulty).toBe(4);
    expect(e.revelation.test.on_fail).toContainEqual({ type: 'deal_damage', count: 2, target: 'self' });
  });

  test('direct revelation damage still parses (Grasping Hands shape)', () => {
    const e = parse({ name: 'Grasping Hands', type_code: 'treachery',
      text: 'Revelation - Test [agility] (3). For each point you fail by, take 1 damage.' });
    expect(e.revelation.test.on_fail).toContainEqual({ type: 'deal_damage', count: 1, target: 'self', per_point_failed: true });
  });

  test('unconditional revelation keeps legacy revelation_effects', () => {
    const e = parse({ name: 'X', type_code: 'treachery', subtype_code: 'weakness',
      text: 'Revelation - Take 2 direct horror and remove all cards in your discard pile from the game.' });
    expect(e.revelation.effects).toContainEqual({ type: 'deal_horror', count: 2, target: 'self', direct: true });
    expect(e.revelation_effects).toContainEqual({ type: 'deal_horror', count: 2, target: 'self', direct: true });
  });

  test('Surge keyword extracted from treachery', () => {
    const e = parse({ name: 'Ancient Evils', type_code: 'treachery',
      text: 'Revelation - Place 1 doom on the current agenda. This effect can cause the current agenda to advance.\nSurge.' });
    expect(e.keywords).toContain('surge');
    expect(e.revelation.effects).toContainEqual({ type: 'add_doom', count: 1 });
  });
});

describe('parser - new effect rules', () => {
  const parseText = text => parse({ name: 'X', type_code: 'event', text });

  test('combined damage and horror', () => {
    const e = parseText('Take 1 damage and 1 horror.');
    expect(e.effects).toEqual([
      { type: 'deal_damage', count: 1, target: 'self' },
      { type: 'deal_horror', count: 1, target: 'self' },
    ]);
  });

  test('discard cards at random from hand', () => {
    const e = parseText('Discard 2 cards at random from your hand.');
    expect(e.effects).toContainEqual({ type: 'discard_cards', count: 2, random: true });
  });

  test('choose and discard from hand', () => {
    const e = parseText('Choose and discard 1 card from your hand.');
    expect(e.effects).toContainEqual({ type: 'discard_cards', count: 1, random: false });
  });

  test('lose resources', () => {
    const e = parseText('Lose 2 resources.');
    expect(e.effects).toContainEqual({ type: 'lose_resources', count: 2 });
  });

  test('damage to each investigator at location', () => {
    const e = parseText('Deal 1 damage to each investigator at your location.');
    expect(e.effects).toContainEqual({ type: 'deal_damage', count: 1, target: 'all_investigators_at_location' });
  });
});

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
