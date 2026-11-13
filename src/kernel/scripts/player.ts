// Scripts for the player cards the engine currently plays: Roland Banks' pool (Guardian, Seeker and neutral level 0)
// and the basic weaknesses. Card text and numbers come from the card data at runtime; these scripts only supply behaviour.
import type { K } from '../ctx.ts';
import type { CardId, SeatId } from '../types.ts';
import type { Registry, Script } from './types.ts';

const here = (k: K, seat: SeatId) => k.inv(seat).loc;
const cluesHere = (k: K, seat: SeatId) => k.loc(here(k, seat)).clues;
const testFrame = (k: K) => k.findFrame('test')!.t;

/** A weapon with a fight action. */
function weapon(o: { label: string; cost?: Script['abilities'] extends (infer A)[] | undefined ? A extends { cost?: infer C } ? C : never : never; bonus: number | ((k: K, seat: SeatId, target: string) => number); damage: number | ((k: K, seat: SeatId, target: string) => number); code: string; name: string; actions?: number }): Script {
  return {
    abilities: [{ id: 'fight', label: o.label, speed: 'action', designator: 'fight', cost: o.cost, run: 'fight', actions: o.actions }],
    handlers: {
      fight(k, a) {
        const bonus = typeof o.bonus === 'function' ? o.bonus(k, a.seat, a.targetId) : o.bonus;
        const damage = typeof o.damage === 'function' ? o.damage(k, a.seat, a.targetId) : o.damage;
        k.startFight(a.seat, a.targetId, { bonus, damageBonus: damage, sourceCode: o.code, sourceName: o.name });
      },
    },
  };
}

/** A skill card that draws a card when the test succeeds. */
const drawOnSuccess: Script = { handlers: {}, skillCard: { onSuccess: (k, t, id) => { const owner = k.card(id).owner; if (owner) k.draw(owner, 1, 'skill'); void t; } } };

const boost = (id: string, label: string, skill: 'willpower' | 'intellect' | 'combat' | 'agility') =>
  ({ id, label, speed: 'fast' as const, cost: { resources: 1 }, testOnly: { skill }, run: 'boost' });

const boostHandlers = { boost(k: K) { testFrame(k).bonus += 1; } };

const firearmsAt = (k: K, seat: SeatId): CardId[] => k.invAt(here(k, seat)).flatMap(i => i.inPlay.filter(id => k.hasTrait(id, 'firearm') && 'ammo' in k.card(id).tokens.uses));
const woundedAt = (k: K, loc: string) => k.invAt(loc).filter(i => i.damage > 0 || i.horror > 0);

export const playerScripts: Registry = {
  // ---------------------------------------------------------------- Roland Banks and his signature cards
  '01001': {
    reactions: [{
      id: 'clue', label: 'Discover a clue where you stand', trigger: 'afterEnemyDefeated', limitPerRound: 1, run: 'clue',
      when: (k, seat, _id, data) => data.seat === seat && cluesHere(k, seat) > 0,
    }],
    elderSign: (k, seat) => cluesHere(k, seat),
    handlers: { clue(k, a) { k.discoverClues(a.seat, here(k, a.seat), 1, 'reaction'); } },
  },
  '01006': weapon({ label: 'Fire the .38', cost: { uses: ['ammo', 1] }, code: '01006', name: "Roland's .38",
    bonus: (k, seat) => (cluesHere(k, seat) >= 1 ? 3 : 1), damage: 1 }),
  '01007': {
    revelation: 'enter',
    reactions: [{
      id: 'cover', label: 'Hide what you found', trigger: 'wouldDiscover', run: 'replace',
      when: (k, seat, id, data) => data.seat === seat && k.card(id).tokens.clues > 0,
    }],
    handlers: {
      enter(k, a) { k.putInThreat(a.seat, a.cardId); k.card(a.cardId).tokens.clues = 3; k.emit('coverUpPlaced', { seat: a.seat }); },
      replace(k, a) {
        const w = k.windowFrame('wouldDiscover'); if (!w) return;
        const c = k.card(a.cardId); const take = Math.min(Number(w.data.n), c.tokens.clues);
        c.tokens.clues -= take; w.data.n = Number(w.data.n) - take;
        k.emit('coverUpUsed', { seat: a.seat, count: take, left: c.tokens.clues });
      },
    },
  },

  // ---------------------------------------------------------------- Guardian
  '01016': weapon({ label: 'Fire the .45', cost: { uses: ['ammo', 1] }, code: '01016', name: '.45 Automatic', bonus: 1, damage: 1 }),
  '01017': { abilities: [boost('wp', 'Steel yourself (+1 willpower)', 'willpower'), boost('cb', 'Put your back into it (+1 combat)', 'combat')], handlers: boostHandlers },
  '01018': {
    mods: [(k, owner, _id, { tester }) => (tester === owner ? [{ skill: 'combat', delta: 1 }] : [])],
    abilities: [{
      id: 'shoot', label: 'Beat Cop takes a shot', speed: 'fast', cost: { discard: true }, run: 'shoot',
      when: (k, seat) => k.enemiesAt(here(k, seat)).length > 0,
    }],
    handlers: {
      shoot(k, a) {
        const [e] = k.choose('beatcop.target', k.enemiesAt(here(k, a.seat)).map(x => ({ id: x, label: k.name(x) })), { seat: a.seat });
        if (e) k.damageEnemy(e, 1, a.seat, 'Beat Cop');
      },
    },
  },
  // Level 2 Beat Cop: stays in play, pays with its own wounds instead of leaving.
  '01028': {
    mods: [(k, owner, _id, { tester }) => (tester === owner ? [{ skill: 'combat', delta: 1 }] : [])],
    abilities: [{
      id: 'shoot', label: 'Beat Cop takes a shot', speed: 'fast', cost: { exhaust: true }, run: 'shoot',
      when: (k, seat) => k.enemiesAt(here(k, seat)).length > 0,
    }],
    handlers: {
      shoot(k, a) {
        const [e] = k.choose('beatcop.target', k.enemiesAt(here(k, a.seat)).map(x => ({ id: x, label: k.name(x) })), { seat: a.seat });
        if (e) k.damageEnemy(e, 1, a.seat, 'Beat Cop');
        const c = k.card(a.cardId); c.tokens.damage += 1;
        if (c.tokens.damage >= Number(k.def(a.cardId).health ?? 0)) { k.emit('allyDefeated', { seat: a.seat, name: k.name(a.cardId) }); k.discardCard(a.cardId); }
      },
    },
  },
  '01026': {
    play: 'play',
    playRestriction: (k, seat) => firearmsAt(k, seat).length > 0,
    handlers: {
      play(k, a) {
        const opts = firearmsAt(k, a.seat).map(id => ({ id, label: k.name(id), detail: k.inv(k.card(id).owner!).name }));
        const [pick] = k.choose('ammo.pick', opts, { seat: a.seat });
        if (pick) { const u = k.card(pick).tokens.uses; u.ammo = (u.ammo ?? 0) + 3; }
      },
    },
  },
  '01019': {
    abilities: [{
      id: 'aid', label: 'Patch someone up', speed: 'action', cost: { uses: ['supply', 1] }, run: 'aid',
      when: (k, seat) => woundedAt(k, here(k, seat)).length > 0,
    }],
    handlers: {
      aid(k, a) {
        const cands = woundedAt(k, here(k, a.seat));
        const [who] = k.choose('firstaid.who', cands.map(i => ({ id: i.seat, label: i.name })), { seat: a.seat });
        if (who) {
          const t = k.inv(who as SeatId);
          const kinds = [...(t.damage > 0 ? [{ id: 'damage', label: 'wounds' }] : []), ...(t.horror > 0 ? [{ id: 'horror', label: 'nerves' }] : [])];
          const [kind] = k.choose('firstaid.kind', kinds, { seat: a.seat });
          if (kind === 'damage') k.heal(who as SeatId, 1, 0); else if (kind === 'horror') k.heal(who as SeatId, 0, 1);
        }
        if ((k.card(a.cardId).tokens.uses.supply ?? 0) <= 0) k.discardCard(a.cardId);
      },
    },
  },
  '01020': weapon({ label: 'Swing the machete', code: '01020', name: 'Machete', bonus: 1,
    damage: (k, seat, target) => (k.engagedWith(seat).length === 1 && k.card(target).engaged === seat ? 1 : 0) }),
  '01021': {
    reactions: [{
      id: 'bite', label: 'The dog bites back', trigger: 'assetDamagedByEnemy', run: 'bite',
      when: (_k, _seat, id, data) => data.cardId === id,
    }],
    handlers: { bite(k, a) { const e = a.data?.enemyId as CardId | undefined; if (e && k.s.enemies.includes(e)) k.damageEnemy(e, 1, a.seat, 'Guard Dog'); } },
  },
  '01022': {
    play: 'play',
    fastWindow: { trigger: 'afterEnemyDefeated', when: (k, seat, _id, data) => data.seat === seat && cluesHere(k, seat) > 0 },
    handlers: { play(k, a) { k.discoverClues(a.seat, here(k, a.seat), 1, 'event'); } },
  },
  '01023': {
    play: 'play',
    fastWindow: { trigger: 'enemyAttacks', when: (k, seat, _id, data) => k.inv(data.seat as SeatId).loc === here(k, seat) },
    handlers: { play(k) { const f = k.findFrame('attack'); if (f) f.cancelled = true; } },
  },
  '01024': {
    play: 'play',
    handlers: {
      play(k, a) {
        const loc = here(k, a.seat);
        const opts = [loc, ...k.loc(loc).connections].filter(l => k.s.locations[l]?.inPlay && (l === loc || k.s.locations[l]!.revealed))
          .map(l => ({ id: l, label: k.loc(l).name }));
        const [pick] = k.choose('dynamite.where', opts, { seat: a.seat });
        if (!pick) return;
        k.emit('explosion', { seat: a.seat, loc: pick, name: k.loc(pick).name });
        for (const e of [...k.enemiesAt(pick)]) k.damageEnemy(e, 3, a.seat, 'Dynamite Blast');
        for (const i of k.invAt(pick)) k.harm(i.seat, 3, 0, { source: 'Dynamite Blast' });
      },
    },
  },
  '01025': { handlers: {}, skillCard: { onSuccess: (_k, t) => { if (t.kind === 'fight') t.bonusDamage += 1; } } },

  // ---------------------------------------------------------------- Seeker
  '01030': { mods: [(_k, owner, _id, { test, tester }) => (tester === owner && test?.kind === 'investigate' ? [{ skill: 'intellect', delta: 1 }] : [])], handlers: {} },
  '01031': {
    abilities: [{ id: 'lore', label: 'Consult the old book', speed: 'action', cost: { exhaust: true }, run: 'lore' }],
    handlers: {
      lore(k, a) {
        const [who] = k.choose('oldbook.who', k.invAt(here(k, a.seat)).map(i => ({ id: i.seat, label: i.name })), { seat: a.seat });
        if (!who) return;
        const inv = k.inv(who as SeatId); const topCards = inv.deck.slice(0, 3);
        const [pick] = k.choose('oldbook.pick', topCards.map(id => ({ id, label: k.name(id) })), { seat: a.seat, min: 0, max: 1 });
        if (pick) k.drawSpecific(who as SeatId, pick, 'search');
        k.shuffleDeck(who as SeatId);
      },
    },
  },
  '01032': {
    reactions: [{
      id: 'tome', label: 'Fetch a tome from the stacks', trigger: 'afterAssetEnters', run: 'tome',
      when: (k, seat, id, data) => data.cardId === id && k.inv(seat).deck.some(c => k.hasTrait(c, 'tome') && k.def(c).type === 'asset'),
    }],
    handlers: {
      tome(k, a) {
        const inv = k.inv(a.seat);
        const tomes = inv.deck.filter(c => k.hasTrait(c, 'tome') && k.def(c).type === 'asset');
        const [pick] = k.choose('librarian.pick', tomes.map(id => ({ id, label: k.name(id) })), { seat: a.seat, min: 0, max: 1 });
        if (pick) k.drawSpecific(a.seat, pick, 'search');
        k.shuffleDeck(a.seat);
      },
    },
  },
  '01033': {
    mods: [(_k, owner, _id, { tester }) => (tester === owner ? [{ skill: 'intellect', delta: 1 }] : [])],
    reactions: [{ id: 'pay', label: 'Dr. Christopher finds a little extra', trigger: 'afterInvestigateSuccess', run: 'pay', when: (_k, seat, _id, data) => data.seat === seat }],
    handlers: { pay(k, a) { k.gainResources(a.seat, 1); } },
  },
  '01034': { abilities: [boost('int', 'Notice what others miss (+1 intellect)', 'intellect'), boost('agi', 'Stay light on your feet (+1 agility)', 'agility')], handlers: boostHandlers },
  '01035': {
    abilities: [{ id: 'treat', label: 'Consult the medical text', speed: 'action', run: 'treat', when: (k, seat) => k.invAt(here(k, seat)).length > 0 }],
    handlers: {
      treat(k, a) {
        const [who] = k.choose('medtexts.who', k.invAt(here(k, a.seat)).map(i => ({ id: i.seat, label: i.name })), { seat: a.seat });
        if (!who) return;
        k.startTest({
          seat: a.seat, skill: 'intellect', difficulty: 2, kind: 'other', sourceCode: '01035', sourceName: 'Medical Texts', label: 'medical_texts',
          onSuccess: { code: '01035', name: 'heal', args: { who }, seat: a.seat }, onFailure: { code: '01035', name: 'hurt', args: { who }, seat: a.seat },
        });
      },
      heal(k, a) { k.heal(a.who, 1, 0); },
      hurt(k, a) { k.harm(a.who, 1, 0, { source: 'Medical Texts' }); },
    },
  },
  '01036': {
    play: 'play',
    handlers: { play(k, a) { k.inv(a.seat).roundFlags.mindOverMatter = true; k.emit('mindOverMatter', { seat: a.seat }); } },
  },
  '01037': {
    play: 'play',
    playRestriction: (k, seat) => cluesHere(k, seat) > 0,
    handlers: { play(k, a) { k.discoverClues(a.seat, here(k, a.seat), 1, 'event'); } },
  },
  '01038': {
    play: 'play', stays: true,
    forced: [{ trigger: 'afterLeaveLocation', when: (k, _o, id, data) => k.card(id).attachedTo === data.loc, run: 'fall' }],
    handlers: {
      play(k, a) { k.attachToLocation(here(k, a.seat), a.cardId); k.emit('barricaded', { seat: a.seat, loc: here(k, a.seat) }); },
      fall(k, a) { k.discardCard(a.cardId); k.emit('barricadeFell', {}); },
    },
  },
  '01039': { handlers: {}, skillCard: { onSuccess: (_k, t) => { if (t.kind === 'investigate') t.extraClues += 1; } } },

  // ---------------------------------------------------------------- Neutral
  '01080': {
    play: 'play',
    fastWindow: { trigger: 'wouldFailTest', when: (_k, seat, _id, data) => data.seat === seat },
    handlers: { play(k) { testFrame(k).bonus += 2; } },
  },
  '01086': {
    abilities: [
      { id: 'slash', label: 'Slash with the knife', speed: 'action', designator: 'fight', run: 'slash' },
      { id: 'throw', label: 'Put everything into one thrust', speed: 'action', designator: 'fight', cost: { discard: true }, run: 'throw' },
    ],
    handlers: {
      slash(k, a) { k.startFight(a.seat, a.targetId, { bonus: 1, sourceCode: '01086', sourceName: 'Knife' }); },
      throw(k, a) { k.startFight(a.seat, a.targetId, { bonus: 2, damageBonus: 1, sourceCode: '01086', sourceName: 'Knife' }); },
    },
  },
  '01087': {
    abilities: [{ id: 'beam', label: 'Shine the flashlight', speed: 'action', designator: 'investigate', cost: { uses: ['supply', 1] }, run: 'beam', when: (k, seat) => cluesHere(k, seat) > 0 }],
    handlers: { beam(k, a) { k.startInvestigate(a.seat, { shroudDelta: -2, sourceCode: '01087', sourceName: 'Flashlight' }); } },
  },
  '01088': { play: 'play', handlers: { play(k, a) { k.gainResources(a.seat, 3); } } },
  '01089': drawOnSuccess,
  '01091': drawOnSuccess,
  '01092': drawOnSuccess,
  '01093': { handlers: {} },

  // ---------------------------------------------------------------- Basic weaknesses
  '01096': {
    revelation: 'amnesia',
    handlers: {
      amnesia(k, a) {
        k.discardCard(a.cardId);
        const hand = k.inv(a.seat).hand;
        const [keep] = k.choose('amnesia.keep', hand.map(id => ({ id, label: k.name(id) })), { seat: a.seat });
        for (const id of [...hand]) if (id !== keep) k.discardCard(id);
        k.emit('amnesia', { seat: a.seat });
      },
    },
  },
  '01097': { revelation: 'paranoia', handlers: { paranoia(k, a) { k.discardCard(a.cardId); const n = k.inv(a.seat).resources; k.spendResources(a.seat, n); k.emit('paranoia', { seat: a.seat, lost: n }); } } },
  '01098': {
    revelation: 'enter',
    mods: [(_k, owner, _id, { tester }) => (tester === owner ? [{ skill: 'all', delta: -1 }] : [])],
    abilities: [{ id: 'shake', label: 'Shake off the haunting', speed: 'action', actions: 2, cost: { discard: true }, run: 'noop' }],
    handlers: { enter(k, a) { k.putInThreat(a.seat, a.cardId); }, noop() {} },
  },
  '01099': {
    revelation: 'enter',
    forced: [{ trigger: 'afterTakeHorror', when: (_k, owner, _id, data) => owner === data.seat, run: 'sting' }],
    abilities: [{ id: 'shake', label: 'Calm your mind', speed: 'action', actions: 2, cost: { discard: true }, run: 'noop' }],
    handlers: { enter(k, a) { k.putInThreat(a.seat, a.cardId); }, sting(k, a) { k.harm(a.seat, 1, 0, { source: 'Psychosis', direct: true }); }, noop() {} },
  },
  '01100': {
    revelation: 'enter',
    forced: [{ trigger: 'afterTakeDamage', when: (_k, owner, _id, data) => owner === data.seat, run: 'sting' }],
    abilities: [{ id: 'shake', label: 'Settle your nerves', speed: 'action', actions: 2, cost: { discard: true }, run: 'noop' }],
    handlers: { enter(k, a) { k.putInThreat(a.seat, a.cardId); }, sting(k, a) { k.harm(a.seat, 0, 1, { source: 'Hypochondria', direct: true }); }, noop() {} },
  },
  '01101': {
    abilities: [{
      id: 'bribe', label: 'Pay the enforcer off', speed: 'action', designator: 'parley', cost: { resources: 4 }, controlledOnly: false, run: 'bribe',
      when: (k, seat, id) => k.card(id).engaged === seat,
    }],
    handlers: { bribe(k, a) { k.discardCard(a.cardId); k.emit('bribed', { seat: a.seat }); } },
  },
  '01102': {
    forced: [{ trigger: 'afterAttack', when: (_k, _o, id, data) => data.enemyId === id, run: 'doom' }],
    handlers: { doom(k) { k.placeDoom(1); } },
  },
  '01103': { handlers: {} },
};

export const SUPPORTED_INVESTIGATORS = ['01001', '01002', '01003', '01004', '01005'];
