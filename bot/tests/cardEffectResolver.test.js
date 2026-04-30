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
