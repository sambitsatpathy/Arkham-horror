// Scripts for the rest of the Core Set's player cards, the four other investigators and their signature cards.
// Behaviour only: card text, costs and numbers come from the card data at runtime.
// Known simplifications are listed in the README ("What is approximated").
import { CORE, type K } from '../ctx.ts';
import { doMove } from '../core.ts';
import { shuffle } from '../rng.ts';
import type { CardId, Option, SeatId, Skill } from '../types.ts';
import type { Registry, Script } from './types.ts';

const here = (k: K, seat: SeatId) => k.inv(seat).loc;
const cluesHere = (k: K, seat: SeatId) => k.loc(here(k, seat)).clues;
const myTurn = (k: K, seat: SeatId) => k.s.phase === 'investigation' && k.s.spotlight === seat;
const testState = (k: K) => k.findFrame('test')!.t;
const nonElite = (k: K, e: CardId) => !k.isElite(e) && !k.def(e).subtype;
const names = (k: K, ids: CardId[]): Option[] => ids.map(id => ({ id, label: k.name(id) }));
const BAD_SYMBOLS = new Set(['skull', 'cultist', 'tablet', 'elder_thing', 'autofail']);
const SKILLS: Skill[] = ['willpower', 'intellect', 'combat', 'agility'];

const boost = (id: string, label: string, skill: Skill) =>
  ({ id, label, speed: 'fast' as const, cost: { resources: 1 }, testOnly: { skill }, run: 'boost' });
const boostHandlers = { boost(k: K) { testState(k).bonus += 1; } };
const passive: Script = { handlers: {} };
const plusSkill = (skill: Skill, when?: (t: { kind?: string } | null | undefined) => boolean): Script['mods'] =>
  [(_k, owner, _id, { test, tester }) => (tester === owner && (!when || when(test)) ? [{ skill, delta: 1 }] : [])];

/** A fight ability on a card: optional ammo/charge cost, a skill override, damage tweaks and a follow-up handler. */
function attack(o: { id: string; label: string; code: string; name: string; cost?: { uses?: [string, number]; exhaust?: boolean }; skill?: Skill; bonus?: number;
  damageBonus?: number; marginBonus?: { min: number; dmg: number }; marginDamage?: boolean; after?: string; fast?: boolean }): Pick<Script, 'abilities'> & { fight: (k: K, a: any) => void } {
  return {
    abilities: [{ id: o.id, label: o.label, speed: o.fast ? 'fast' : 'action', designator: 'fight', cost: o.cost, run: 'fight' }],
    fight(k, a) {
      k.startFight(a.seat, a.targetId, {
        skill: o.skill, bonus: o.bonus ?? 0, damageBonus: o.damageBonus ?? 0, sourceCode: o.code, sourceName: o.name,
        data: { ...(o.marginBonus ? { marginBonus: o.marginBonus } : {}), ...(o.marginDamage ? { marginDamage: true } : {}) },
        ...(o.after ? { after: { code: o.code, name: o.after, seat: a.seat, args: { cardId: a.cardId } } } : {}),
      });
    },
  };
}
const withFight = (o: Parameters<typeof attack>[0], extra: Partial<Script> = {}): Script => {
  const a = attack(o);
  return { ...extra, abilities: [...(a.abilities ?? []), ...(extra.abilities ?? [])], handlers: { fight: a.fight, ...(extra.handlers ?? {}) } };
};

function placeDoomOn(k: K, cardId: CardId): void {
  k.card(cardId).tokens.doom += 1;
  k.emit('doomPlaced', { count: 1, total: k.totalDoom() });
  k.queue({ k: 'scenario', hook: 'checkAgenda', stage: 0, args: {} });
}

export const player2Scripts: Registry = {
  // ================================================================ investigators
  // Daisy Walker: one more action, for tomes only; the elder sign draws for each tome she controls.
  '01002': {
    turnStart: (k, seat) => { k.inv(seat).restricted.tome = 1; },
    elderSign: () => 0,
    handlers: { elderSuccess(k, a) { const n = k.inPlayCards(a.seat).filter(id => k.hasTrait(id, 'tome')).length; if (n) k.draw(a.seat, n, 'elder'); } },
  },
  // "Skids" O'Toole: spend two means for one more action; the elder sign pays back two means.
  '01003': {
    abilities: [{ id: 'extra', label: 'Spend two means to find another moment', speed: 'fast', cost: { resources: 2 }, limitPerRound: 1, when: (k, seat) => myTurn(k, seat), run: 'extra' }],
    elderSign: () => 2,
    handlers: { extra(k, a) { k.inv(a.seat).actionsLeft += 1; k.emit('extraMoment', { seat: a.seat }); }, elderSuccess(k, a) { k.gainResources(a.seat, 2); } },
  },
  // Agnes Baker: pain lashes out at a foe; the elder sign grows with her wounds of the mind.
  '01004': {
    reactions: [{
      id: 'burn', label: 'The pain lashes out', trigger: 'afterHorrorPlaced', limitPerPhase: 1, run: 'burn',
      when: (k, seat, _id, data) => data.seat === seat && k.enemiesAt(here(k, seat)).length > 0,
    }],
    elderSign: (k, seat) => k.inv(seat).horror,
    handlers: {
      burn(k, a) {
        const [e] = k.choose('agnes.target', names(k, k.enemiesAt(here(k, a.seat))), { seat: a.seat });
        if (e) k.damageEnemy(e, 1, a.seat, 'Agnes Baker');
      },
    },
  },
  // Wendy Adams: give up a memory to turn the draw; with the amulet in play the elder sign always carries it.
  '01005': {
    reactions: [{
      id: 'cancel', label: 'Let a memory go to turn the luck', trigger: 'tokenRevealed', run: 'cancel',
      when: (k, seat, _id, data) => data.seat === seat && k.inv(seat).hand.length > 0 && !testState(k).data.wendyUsed,
    }],
    elderSign: () => 0,
    elderSignAutoSucceed: (k, seat) => !!k.controls(seat, '01014'),
    handlers: {
      cancel(k, a) {
        const [c] = k.choose('wendy.discard', names(k, k.inv(a.seat).hand), { seat: a.seat });
        if (!c) return;
        k.discardCard(c); const t = testState(k); t.data.redraw = true; t.data.wendyUsed = true;
        k.emit('tokenCancelled', { seat: a.seat });
      },
    },
  },

  // ================================================================ signature cards and neutral cards
  '01008': { slotBonus: [{ slot: 'hand', n: 2, onlyTrait: 'tome' }], handlers: {} },                                    // Daisy's Tote Bag
  '01009': {                                                                                                          // The Necronomicon
    revelation: 'enter', elderSignAsAutofail: true,
    abilities: [{ id: 'read', label: 'Read until it lets go', speed: 'action', run: 'read' }],
    handlers: {
      enter(k, a) { k.putInThreat(a.seat, a.cardId); k.card(a.cardId).tokens.horror = 3; },
      read(k, a) {
        const c = k.card(a.cardId); c.tokens.horror -= 1;
        k.harm(a.seat, 0, 1, { source: 'The Necronomicon', direct: true });
        if (c.tokens.horror <= 0) k.discardCard(a.cardId);
      },
    },
  },
  '01010': {                                                                                                          // On the Lam
    play: 'play', playRestriction: (k, seat) => myTurn(k, seat),
    handlers: { play(k, a) { k.inv(a.seat).roundFlags.onTheLam = true; } },
  },
  '01011': {                                                                                                          // Hospital Debts
    revelation: 'enter',
    abilities: [{ id: 'pay', label: 'Put a little toward the debt', speed: 'fast', cost: { resources: 1 }, limitPerRound: 2, run: 'pay' }],
    endGameXp: (k, _seat, id) => (k.card(id).tokens.resources < 6 ? -2 : 0),
    handlers: { enter(k, a) { k.putInThreat(a.seat, a.cardId); }, pay(k, a) { k.card(a.cardId).tokens.resources += 1; } },
  },
  '01012': {                                                                                                          // Heirloom of Hyperborea
    reactions: [{ id: 'draw', label: 'The heirloom hums', trigger: 'afterPlay', run: 'draw', when: (_k, seat, _id, data) => data.seat === seat && data.traits.includes('spell') }],
    handlers: { draw(k, a) { k.draw(a.seat, 1, 'heirloom'); } },
  },
  '01013': {                                                                                                          // Dark Memory
    play: 'play',
    forced: [{ trigger: 'endOfTurnInHand', run: 'dread' }],
    handlers: { play(k) { k.placeDoom(1); }, dread(k, a) { k.emit('memoryResurfaces', { seat: a.seat }); k.harm(a.seat, 0, 2, { source: 'Dark Memory' }); } },
  },
  '01014': { eventsToBottom: true, playFromDiscardTop: true, handlers: {} },                                          // Wendy's Amulet
  '01015': {                                                                                                          // Abandoned and Alone
    revelation: 'alone',
    handlers: {
      alone(k, a) {
        k.harm(a.seat, 0, 2, { source: 'Abandoned and Alone', direct: true });
        for (const id of [...k.inv(a.seat).discard]) k.detach(id);                      // removed from the game
        k.discardCard(a.cardId);
      },
    },
  },

  // ================================================================ Guardian (the leftovers)
  '01027': {                                                                                                          // Police Badge (2)
    mods: plusSkill('willpower'),
    abilities: [{
      id: 'rush', label: 'Hand over the badge for a burst of time', speed: 'fast', cost: { discard: true }, run: 'rush',
      when: (k, seat) => myTurn(k, seat),
    }],
    handlers: { rush(k, a) { k.inv(a.seat).actionsLeft += 2; k.emit('extraMoment', { seat: a.seat }); } },
  },
  '01029': withFight({ id: 'fight', label: 'Fire the shotgun', code: '01029', name: 'Shotgun', cost: { uses: ['ammo', 1] }, bonus: 3, marginDamage: true }),

  // ================================================================ Seeker (the leftovers)
  '01040': {                                                                                                          // Magnifying Glass (1)
    mods: [(_k, owner, _id, { test, tester }) => (tester === owner && test?.kind === 'investigate' ? [{ skill: 'intellect', delta: 1 }] : [])],
    abilities: [{ id: 'ret', label: 'Tuck the glass back into your pocket', speed: 'fast', run: 'ret', when: (k, seat) => cluesHere(k, seat) === 0 }],
    handlers: { ret(k, a) { k.detach(a.cardId); k.inv(a.seat).hand.push(a.cardId); } },
  },
  '01041': {                                                                                                          // Disc of Itzamna (2)
    reactions: [{
      id: 'dispel', label: 'Break the disc over the thing', trigger: 'afterEnemySpawn', cost: { discard: true }, run: 'dispel',
      when: (k, seat, _id, data) => k.s.enemies.includes(data.enemyId) && data.loc === here(k, seat) && nonElite(k, data.enemyId),
    }],
    handlers: {
      dispel(k, a) {
        const e = a.data?.enemyId as CardId | undefined; if (!e || !k.s.enemies.includes(e)) return;
        k.emit('enemyDismissed', { seat: a.seat, name: k.name(e) }); k.card(e).tokens.damage = 0; k.discardCard(e);
      },
    },
  },
  '01042': {                                                                                                          // Encyclopedia (2)
    abilities: [{ id: 'consult', label: 'Consult the encyclopedia', speed: 'action', cost: { exhaust: true }, run: 'consult' }],
    mods: [(k, _owner, id, { tester }) => {
      const f = k.card(id).flags['boost:' + tester]; if (typeof f !== 'string') return [];
      const [skill, when] = f.split('|'); return when === `${k.s.round}:${k.s.phase}` ? [{ skill: skill as Skill, delta: 2 }] : [];
    }],
    handlers: {
      consult(k, a) {
        const [who] = k.choose('encyclopedia.who', k.invAt(here(k, a.seat)).map(i => ({ id: i.seat, label: i.name })), { seat: a.seat });
        const [skill] = k.choose('encyclopedia.skill', SKILLS.map(x => ({ id: x, label: x[0]!.toUpperCase() + x.slice(1) })), { seat: a.seat });
        if (who && skill) k.card(a.cardId).flags['boost:' + who] = `${skill}|${k.s.round}:${k.s.phase}`;
      },
    },
  },
  '01043': {                                                                                                          // Cryptic Research (4)
    play: 'play', playRestriction: (k, seat) => myTurn(k, seat),
    handlers: {
      play(k, a) {
        const [who] = k.choose('cryptic.who', k.invAt(here(k, a.seat)).map(i => ({ id: i.seat, label: i.name })), { seat: a.seat });
        if (who) k.draw(who as SeatId, 3, 'event');
      },
    },
  },

  // ================================================================ Rogue
  '01044': withFight({ id: 'fight', label: 'Cut with the switchblade', code: '01044', name: 'Switchblade', marginBonus: { min: 2, dmg: 1 } }),
  '01045': {                                                                                                          // Burglary
    abilities: [{ id: 'rob', label: 'Case the place for valuables', speed: 'action', designator: 'investigate', cost: { exhaust: true }, run: 'rob' }],
    handlers: {
      rob(k, a) { k.startInvestigate(a.seat, { sourceCode: '01045', sourceName: 'Burglary', swapCluesFor: { code: '01045', name: 'loot', seat: a.seat } }); },
      loot(k, a) { k.gainResources(a.seat, 3); },
    },
  },
  '01046': {                                                                                                          // Pickpocketing
    reactions: [{ id: 'lift', label: 'Lift something on the way out', trigger: 'afterEvade', cost: { exhaust: true }, run: 'lift', when: (_k, seat, _id, data) => data.seat === seat }],
    handlers: { lift(k, a) { k.draw(a.seat, 1, 'pickpocket'); } },
  },
  '01047': withFight({ id: 'fight', label: 'Fire the derringer', code: '01047', name: '.41 Derringer', cost: { uses: ['ammo', 1] }, bonus: 2, marginBonus: { min: 2, dmg: 1 } }),
  '01048': { extraActions: () => 1, handlers: {} },                                                                   // Leo De Luca
  '01054': { extraActions: () => 1, handlers: {} },                                                                   // Leo De Luca (1)
  '01049': { abilities: [boost('cb', 'Put your back into it (+1 combat)', 'combat'), boost('ag', 'Move like you mean it (+1 agility)', 'agility')], handlers: boostHandlers },
  '01050': {                                                                                                          // Elusive
    play: 'play', playRestriction: (k, seat) => myTurn(k, seat),
    handlers: {
      play(k, a) {
        const cur = here(k, a.seat);
        const opts = Object.values(k.s.locations).filter(l => l.inPlay && l.revealed && l.id !== cur && k.enemiesAt(l.id).length === 0).map(l => ({ id: l.id, label: l.name }));
        const [to] = k.choose('elusive.where', opts, { seat: a.seat });
        for (const e of k.engagedWith(a.seat)) k.card(e).engaged = null;
        if (to) doMove(k, a.seat, to);
      },
    },
  },
  '01051': {                                                                                                          // Backstab
    play: 'play', playRestriction: (k, seat) => k.enemiesAt(here(k, seat)).length > 0,
    handlers: {
      play(k, a) {
        const [e] = k.choose('backstab.target', names(k, k.enemiesAt(here(k, a.seat))), { seat: a.seat });
        if (e) k.startFight(a.seat, e, { skill: 'agility', damageBonus: 2, sourceCode: '01051', sourceName: 'Backstab' });
      },
    },
  },
  '01052': {                                                                                                          // Sneak Attack
    play: 'play', playRestriction: (k, seat) => k.enemiesAt(here(k, seat)).some(e => k.card(e).exhausted),
    handlers: {
      play(k, a) {
        const [e] = k.choose('sneak.target', names(k, k.enemiesAt(here(k, a.seat)).filter(x => k.card(x).exhausted)), { seat: a.seat });
        if (e) k.damageEnemy(e, 2, a.seat, 'Sneak Attack');
      },
    },
  },
  '01053': { handlers: {}, skillCard: { onSuccess: (k, t, id) => { if (t.margin >= 3) k.card(id).flags.returnToHand = true; } } },   // Opportunist
  '01055': {                                                                                                          // Cat Burglar (1)
    mods: plusSkill('agility'),
    abilities: [{ id: 'slip', label: 'Vanish into the crowd', speed: 'action', cost: { exhaust: true }, noProvoke: true, run: 'slip' }],
    handlers: {
      slip(k, a) {
        const opts = k.loc(here(k, a.seat)).connections.filter(l => k.s.locations[l]?.inPlay).map(l => ({ id: l, label: k.s.locations[l]!.revealed ? k.loc(l).name : 'an unopened door' }));
        const [to] = k.choose('catburglar.where', opts, { seat: a.seat });
        for (const e of k.engagedWith(a.seat)) k.card(e).engaged = null;
        if (to) doMove(k, a.seat, to);
      },
    },
  },
  '01056': {                                                                                                          // Sure Gamble (3)
    play: 'play',
    fastWindow: { trigger: 'tokenRevealed', when: (_k, seat, _id, data) => data.seat === seat && /^-\d+$/.test(String(data.token)) },
    handlers: { play(k) { const t = testState(k); t.data.pre = ('+' + String(t.data.pre).slice(1)) as never; k.emit('tokenSwitched', { seat: t.seat }); } },
  },
  '01057': { play: 'play', handlers: { play(k, a) { k.gainResources(a.seat, 10); } } },                               // Hot Streak (4)

  // ================================================================ Mystic
  '01058': {                                                                                                          // Forbidden Knowledge
    abilities: [{ id: 'draw', label: 'Pay in dread for something to spend', speed: 'fast', cost: { exhaust: true, uses: ['secret', 1] }, run: 'draw' }],
    handlers: {
      draw(k, a) {
        k.gainResources(a.seat, 1); k.harm(a.seat, 0, 1, { source: 'Forbidden Knowledge' });
        if ((k.card(a.cardId).tokens.uses.secret ?? 0) <= 0) k.discardCard(a.cardId);
      },
    },
  },
  '01059': { mods: plusSkill('willpower'), handlers: {} },                                                            // Holy Rosary
  '01060': withFight({ id: 'cast', label: 'Cast the withering', code: '01060', name: 'Shrivelling', cost: { uses: ['charge', 1] }, skill: 'willpower', damageBonus: 1, after: 'recoil' }, {
    handlers: { recoil(k, a) { if ((a.tokens as string[]).some(t => BAD_SYMBOLS.has(t))) k.harm(a.seat, 0, 1, { source: 'Shrivelling' }); } },
  }),
  '01061': {                                                                                                          // Scrying
    abilities: [{ id: 'scry', label: 'Gaze into the glass', speed: 'action', cost: { exhaust: true, uses: ['charge', 1] }, run: 'scry' }],
    handlers: {
      scry(k, a) {
        const piles: Option[] = [...k.activeSeats().map(s => ({ id: 'deck:' + s, label: `${k.inv(s).name}’s future` })), { id: 'enc', label: 'what waits in the dark' }];
        const [which] = k.choose('scrying.who', piles, { seat: a.seat }); if (!which) return;
        const pile = which === 'enc' ? k.s.encounterDeck : k.inv(which.slice(5) as SeatId).deck;
        let rest = pile.slice(0, 3); const order: CardId[] = [];
        while (rest.length > 1) {
          const [pick] = k.choose('scrying.next', names(k, rest), { seat: a.seat }); if (!pick) break;
          order.push(pick); rest = rest.filter(x => x !== pick);
        }
        order.push(...rest);
        pile.splice(0, order.length, ...order);
      },
    },
  },
  '01062': { abilities: [boost('wp', 'Gather your will (+1 willpower)', 'willpower'), boost('int', 'Sharpen your mind (+1 intellect)', 'intellect')], handlers: boostHandlers },
  '01063': {                                                                                                          // Arcane Initiate
    forced: [{ trigger: 'afterAssetEnters', when: (_k, _o, id, data) => data.cardId === id, run: 'doom' }],
    abilities: [{ id: 'search', label: 'Search the old pages for a spell', speed: 'fast', cost: { exhaust: true }, run: 'search' }],
    handlers: {
      doom(k, a) { placeDoomOn(k, a.cardId); },
      search(k, a) {
        const top = k.inv(a.seat).deck.slice(0, 3).filter(id => k.hasTrait(id, 'spell'));
        const [pick] = k.choose('initiate.pick', names(k, top), { seat: a.seat, min: 0, max: 1 });
        if (pick) k.drawSpecific(a.seat, pick, 'search');
        k.shuffleDeck(a.seat);
      },
    },
  },
  '01064': {                                                                                                          // Drawn to the Flame
    play: 'play',
    handlers: {
      play(k, a) { k.queue({ k: 'drawEncounter', seat: a.seat, stage: 0, cardId: null }); k.queueEffect({ code: '01064', name: 'clues', seat: a.seat }); },
      clues(k, a) { k.discoverClues(a.seat, here(k, a.seat), 2, 'event'); },
    },
  },
  '01065': {                                                                                                          // Ward of Protection
    play: 'play', fastWindow: { trigger: 'treacheryDrawn', when: (_k, seat, _id, data) => data.seat === seat },
    handlers: { play(k, a) { const f = k.findFrame('drawEncounter'); if (f) f.cancelled = true; k.harm(a.seat, 0, 1, { source: 'Ward of Protection' }); } },
  },
  '01066': blindingLight('01066', 1, false),
  '01069': blindingLight('01069', 2, true),
  '01067': { handlers: {}, skillCard: { onSuccess: (k, _t, id) => { const o = k.card(id).owner; if (o) k.heal(o, 0, 1); } } },   // Fearless
  '01068': {                                                                                                          // Mind Wipe (1)
    play: 'play',
    fastWindow: { trigger: 'afterPhaseBegins', when: (k, seat) => k.enemiesAt(here(k, seat)).some(e => nonElite(k, e)) },
    handlers: {
      play(k, a) {
        const [e] = k.choose('mindwipe.target', names(k, k.enemiesAt(here(k, a.seat)).filter(x => nonElite(k, x))), { seat: a.seat });
        if (e) { k.card(e).flags.blank = `${k.s.round}:${k.s.phase}`; k.emit('enemyBlanked', { seat: a.seat, name: k.name(e) }); }
      },
    },
  },
  '01070': {                                                                                                          // Book of Shadows (3)
    slotBonus: [{ slot: 'arcane', n: 1 }],
    abilities: [{ id: 'charge', label: 'Feed a spell from the book', speed: 'action', cost: { exhaust: true }, run: 'charge',
      when: (k, seat) => k.inv(seat).inPlay.some(id => k.hasTrait(id, 'spell') && 'charge' in k.card(id).tokens.uses) }],
    handlers: {
      charge(k, a) {
        const opts = names(k, k.inv(a.seat).inPlay.filter(id => k.hasTrait(id, 'spell') && 'charge' in k.card(id).tokens.uses));
        const [pick] = k.choose('bookshadows.which', opts, { seat: a.seat });
        if (pick) k.card(pick).tokens.uses.charge! += 1;
      },
    },
  },
  '01071': {                                                                                                          // Grotesque Statue (4)
    reactions: [{ id: 'twice', label: 'Ask the statue for a second draw', trigger: 'wouldRevealToken', cost: { uses: ['charge', 1] }, run: 'twice', when: (_k, seat, _id, data) => data.seat === seat }],
    handlers: { twice(k, a) { testState(k).data.statue = true; if ((k.card(a.cardId).tokens.uses.charge ?? 0) <= 0) k.discardCard(a.cardId); } },
  },

  // ================================================================ Survivor
  '01072': passive,                                                                                                   // Leather Coat
  '01073': {                                                                                                          // Scavenging
    reactions: [{
      id: 'scav', label: 'Pick through what was left behind', trigger: 'afterInvestigateSuccess', cost: { exhaust: true }, run: 'scav',
      when: (k, seat, _id, data) => data.seat === seat && Number(data.margin) >= 2 && k.inv(seat).discard.some(id => k.hasTrait(id, 'item')),
    }],
    handlers: {
      scav(k, a) {
        const [pick] = k.choose('scavenging.pick', names(k, k.inv(a.seat).discard.filter(id => k.hasTrait(id, 'item'))), { seat: a.seat });
        if (pick) k.drawSpecific(a.seat, pick, 'scavenge');
      },
    },
  },
  '01074': withFight({ id: 'fight', label: 'Swing the bat', code: '01074', name: 'Baseball Bat', bonus: 2, damageBonus: 1, after: 'splinter' }, {
    handlers: { splinter(k, a) { if ((a.tokens as string[]).some(t => t === 'skull' || t === 'autofail')) { k.emit('batBroke', { seat: a.seat }); k.discardCard(a.cardId); } } },
  }),
  '01075': {                                                                                                          // Rabbit's Foot
    reactions: [{ id: 'luck', label: 'Rub the rabbit’s foot', trigger: 'afterFailTest', cost: { exhaust: true }, run: 'luck', when: (_k, seat, _id, data) => data.seat === seat }],
    handlers: { luck(k, a) { k.draw(a.seat, 1, 'luck'); } },
  },
  '01076': {                                                                                                          // Stray Cat
    abilities: [{ id: 'dart', label: 'The cat bolts and draws the eye', speed: 'fast', cost: { discard: true }, run: 'dart', when: (k, seat) => k.enemiesAt(here(k, seat)).some(e => nonElite(k, e)) }],
    handlers: {
      dart(k, a) {
        const [e] = k.choose('straycat.target', names(k, k.enemiesAt(here(k, a.seat)).filter(x => nonElite(k, x))), { seat: a.seat });
        if (e) k.queueEffect({ code: CORE, name: 'evadeSuccess', args: { enemyId: e }, seat: a.seat });
      },
    },
  },
  '01077': { abilities: [boost('wp', 'Dig deep (+1 willpower)', 'willpower'), boost('ag', 'Dig deep (+1 agility)', 'agility')], handlers: boostHandlers },
  '01078': {                                                                                                          // Cunning Distraction
    play: 'play', playRestriction: (k, seat) => k.enemiesAt(here(k, seat)).length > 0,
    handlers: { play(k, a) { for (const e of k.enemiesAt(here(k, a.seat))) k.queueEffect({ code: CORE, name: 'evadeSuccess', args: { enemyId: e }, seat: a.seat }); } },
  },
  '01079': {                                                                                                          // "Look what I found!"
    play: 'play',
    fastWindow: { trigger: 'afterFailTest', when: (_k, seat, _id, data) => data.seat === seat && data.testKind === 'investigate' && Number(data.margin) <= 2 },
    handlers: { play(k, a) { k.discoverClues(a.seat, here(k, a.seat), 2, 'event'); } },
  },
  '01081': {                                                                                                          // Survival Instinct
    handlers: {
      run(k, a) {
        for (const e of k.engagedWith(a.seat)) k.card(e).engaged = null;
        const opts = [{ id: 'stay', label: 'stay where you are' }, ...k.loc(here(k, a.seat)).connections.filter(l => k.s.locations[l]?.inPlay).map(l => ({ id: l, label: k.s.locations[l]!.revealed ? k.loc(l).name : 'an unopened door' }))];
        const [to] = k.choose('survival.where', opts, { seat: a.seat });
        if (to && to !== 'stay') doMove(k, a.seat, to);
      },
    },
    skillCard: { onSuccess: (k, t) => { if (t.kind === 'evade') k.queueEffect({ code: '01081', name: 'run', seat: t.seat }); } },
  },
  '01082': {                                                                                                          // Aquinnah (1)
    reactions: [{
      id: 'redirect', label: 'Aquinnah turns the blow on another', trigger: 'enemyAttacks', cost: { exhaust: true }, run: 'redirect',
      when: (k, seat, _id, data) => data.seat === seat && k.enemiesAt(here(k, seat)).some(e => e !== data.enemyId),
    }],
    handlers: {
      redirect(k, a) {
        const [e] = k.choose('aquinnah.target', names(k, k.enemiesAt(here(k, a.seat)).filter(x => x !== a.data?.enemyId)), { seat: a.seat });
        const f = k.findFrame('attack'); if (e && f) f.redirectTo = e;
        const c = k.card(a.cardId); c.tokens.horror += 1;
        if (c.tokens.horror >= Number(k.def(a.cardId).sanity ?? 1)) { k.emit('allyDefeated', { seat: a.seat, name: k.name(a.cardId) }); k.discardCard(a.cardId); }
      },
    },
  },
  '01083': {                                                                                                          // Close Call (2)
    play: 'play',
    fastWindow: { trigger: 'afterEvade', when: (k, seat, _id, data) => data.seat === seat && k.s.enemies.includes(data.enemyId) && nonElite(k, data.enemyId) && k.card(data.enemyId).loc === here(k, seat) },
    handlers: {
      play(k, a) {
        const e = a.data?.enemyId as CardId | undefined; if (!e || !k.s.enemies.includes(e)) return;
        const c = k.card(e); k.detach(e); c.exhausted = false; c.loc = null; c.tokens.damage = 0;
        k.s.encounterDeck.push(e); k.s.encounterDeck = shuffle(k.s, k.s.encounterDeck);
        k.emit('enemyShuffled', { seat: a.seat, name: k.name(e) });
      },
    },
  },
  '01084': {                                                                                                          // Lucky! (2)
    play: 'play', fastWindow: { trigger: 'wouldFailTest', when: (_k, seat, _id, data) => data.seat === seat },
    handlers: { play(k, a) { testState(k).bonus += 2; k.draw(a.seat, 1, 'event'); } },
  },
  '01085': {                                                                                                          // Will to Survive (3)
    play: 'play', playRestriction: (k, seat) => myTurn(k, seat),
    handlers: { play(k, a) { k.inv(a.seat).roundFlags.noTokens = true; } },
  },
  '01090': { handlers: {}, skillCard: { onSuccess: (k, _t, id) => { const o = k.card(id).owner; if (o) k.draw(o, 1, 'skill'); } } },   // Perception
  '01094': passive,                                                                                                   // Bulletproof Vest (3)
  '01095': passive,                                                                                                   // Elder Sign Amulet (3)
  '01000': passive,                                                                                                   // the placeholder weakness (swapped for a real one at setup)
};

function blindingLight(code: string, damage: number, horror: boolean): Script {
  return {
    play: 'play', playRestriction: (k, seat) => k.engagedWith(seat).length > 0,
    handlers: {
      play(k, a) {
        const [e] = k.choose('evade.which', names(k, k.engagedWith(a.seat)), { seat: a.seat });
        if (e) k.startEvade(a.seat, e, { skill: 'willpower', sourceCode: code, sourceName: 'Blinding Light', onSuccessExtra: { code, name: 'flash', seat: a.seat } });
      },
      flash(k, a) {
        if (a.outcome === 'success' && a.enemyId && k.s.enemies.includes(a.enemyId)) k.damageEnemy(a.enemyId, damage, a.seat, 'Blinding Light');
        if ((a.tokens as string[]).some(t => BAD_SYMBOLS.has(t))) {
          const inv = k.inv(a.seat); inv.actionsLeft = Math.max(0, inv.actionsLeft - 1);
          k.emit('momentLost', { seat: a.seat });
          if (horror) k.harm(a.seat, 0, 1, { source: 'Blinding Light' });
        }
      },
    },
  };
}
