// Scripts for the encounter cards used by The Gathering (treacheries, enemies' special behaviour, Lita).
import type { Registry } from './types.ts';

const noop = { handlers: {} };

export const encounterScripts: Registry = {
  // ---- enemies (their keywords, spawn and prey come from the parsed card data)
  '01116': noop, '01118': noop, '01119': noop, '01159': noop, '01160': noop, '01161': noop,

  // ---- Lita Chantler (story ally)
  '01117': {
    mods: [(k, owner, _id, { tester }) => (k.inv(tester).loc === k.inv(owner).loc ? [{ skill: 'combat', delta: 1 }] : [])],
    abilities: [{
      id: 'parley', label: 'Win her trust', speed: 'action', designator: 'parley', controlledOnly: false, run: 'parley',
      when: (k, _seat, id) => k.s.locAssets.includes(id),
    }],
    handlers: {
      parley(k, a) {
        k.startTest({
          seat: a.seat, skill: 'intellect', difficulty: 4, kind: 'parley', sourceCode: '01117', sourceName: 'Lita Chantler', label: 'parley_lita',
          onSuccess: { code: '01117', name: 'win', args: { cardId: a.cardId }, seat: a.seat },
        });
      },
      win(k, a) {
        const i = k.s.locAssets.indexOf(a.cardId); if (i >= 0) k.s.locAssets.splice(i, 1);
        k.card(a.cardId).loc = null;
        k.putInPlay(a.seat, a.cardId);
        k.emit('litaWon', { seat: a.seat });
      },
    },
  },

  // ---- treacheries
  '01162': {
    revelation: 'enter',
    handlers: {
      enter(k, a) {
        k.startTest({ seat: a.seat, skill: 'agility', difficulty: 3, kind: 'treachery', sourceCode: '01162', sourceName: 'Grasping Hands', label: 'grasping_hands',
          onFailure: { code: '01162', name: 'fail', seat: a.seat } });
      },
      fail(k, a) { k.harm(a.seat, a.margin, 0, { source: 'Grasping Hands' }); },
    },
  },
  '01163': {
    revelation: 'enter',
    handlers: {
      enter(k, a) {
        k.startTest({ seat: a.seat, skill: 'willpower', difficulty: 3, kind: 'treachery', sourceCode: '01163', sourceName: 'Rotting Remains', label: 'rotting_remains',
          onFailure: { code: '01163', name: 'fail', seat: a.seat } });
      },
      fail(k, a) { k.harm(a.seat, 0, a.margin, { source: 'Rotting Remains' }); },
    },
  },
  '01164': {
    revelation: 'enter',
    restrict: {
      actionExtraCost: (k, seat, id, type) => (['move', 'fight', 'evade'].includes(type) && !k.inv(seat).roundFlags['xc:' + id] ? 1 : 0),
    },
    forced: [{ trigger: 'endOfTurn', when: (_k, owner, _id, data) => owner === data.seat, run: 'shake' }],
    handlers: {
      enter(k, a) { k.putInThreat(a.seat, a.cardId); k.emit('frozenInFear', { seat: a.seat }); },
      shake(k, a) {
        k.startTest({ seat: a.seat, skill: 'willpower', difficulty: 3, kind: 'treachery', sourceCode: '01164', sourceName: 'Frozen in Fear', label: 'frozen_shake',
          onSuccess: { code: '01164', name: 'free', args: { cardId: a.cardId }, seat: a.seat } });
      },
      free(k, a) { k.discardCard(a.cardId); k.emit('frozenLifted', { seat: a.seat }); },
    },
  },
  '01165': {
    revelation: 'enter',
    restrict: { cannotPlay: (k, _seat, _own, played) => ['asset', 'event'].includes(k.def(played).type) },
    forced: [{ trigger: 'endOfRound', run: 'fade' }],
    handlers: {
      enter(k, a) { k.putInThreat(a.seat, a.cardId); k.emit('dissonantVoices', { seat: a.seat }); },
      fade(k, a) { k.discardCard(a.cardId); },
    },
  },
  '01166': { revelation: 'enter', handlers: { enter(k) { k.emit('ancientEvils', {}); k.placeDoom(1); } } },
  '01167': {
    revelation: 'enter',
    handlers: {
      enter(k, a) {
        k.startTest({ seat: a.seat, skill: 'willpower', difficulty: 4, kind: 'treachery', sourceCode: '01167', sourceName: 'Crypt Chill', label: 'crypt_chill',
          onFailure: { code: '01167', name: 'fail', seat: a.seat } });
      },
      fail(k, a) {
        const assets = k.inv(a.seat).inPlay.filter(id => k.def(id).type === 'asset');
        if (!assets.length) { k.harm(a.seat, 2, 0, { source: 'Crypt Chill' }); return; }
        const [pick] = k.choose('cryptchill.discard', assets.map(id => ({ id, label: k.name(id) })), { seat: a.seat });
        if (pick) { k.emit('assetLost', { seat: a.seat, name: k.name(pick) }); k.discardCard(pick); }
      },
    },
  },
  '01168': {
    revelation: 'enter',
    shroudMod: () => 2,
    forced: [{ trigger: 'afterInvestigateSuccess', when: (k, _o, id, data) => k.card(id).attachedTo === data.loc, run: 'clear' }],
    handlers: {
      enter(k, a) {
        const loc = k.inv(a.seat).loc;
        if (k.loc(loc).attached.some(id => k.card(id).code === '01168')) { k.discardCard(a.cardId); return; }
        k.attachToLocation(loc, a.cardId); k.emit('fogRolls', { seat: a.seat, loc });
      },
      clear(k, a) { k.discardCard(a.cardId); k.emit('fogLifts', {}); },
    },
  },
};
