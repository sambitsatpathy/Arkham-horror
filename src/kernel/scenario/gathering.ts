// "The Gathering": the first Night of the Zealot scenario, encoded as rules behaviour.
// Cards' printed numbers come from the card data at runtime. Resolution outcomes here are authored for this project
// (see README): they record a campaign-log line and experience, nothing more.
import type { K } from '../ctx.ts';
import type { GameState, Location, SeatId, Token } from '../types.ts';
import { shuffle } from '../rng.ts';
import { fireForced } from '../forced.ts';
import type { ScenarioModule } from './types.ts';
import type { Registry } from '../scripts/types.ts';

const AGENDAS = ['01105', '01106', '01107'];
const ACTS = ['01108', '01109', '01110'];
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

const BAGS: Record<GameState['difficulty'], Token[]> = {
  easy: ['+1', '+1', '0', '0', '0', '-1', '-1', '-1', '-2', '-2', 'skull', 'skull', 'cultist', 'tablet', 'autofail', 'elder_sign'],
  standard: ['+1', '0', '0', '-1', '-1', '-1', '-2', '-2', '-3', '-4', 'skull', 'skull', 'cultist', 'tablet', 'autofail', 'elder_sign'],
  hard: ['0', '0', '0', '-1', '-1', '-1', '-2', '-2', '-3', '-3', '-4', '-5', 'skull', 'skull', 'cultist', 'tablet', 'autofail', 'elder_sign'],
  expert: ['0', '-1', '-1', '-2', '-2', '-3', '-3', '-4', '-4', '-5', '-6', '-8', 'skull', 'skull', 'cultist', 'tablet', 'autofail', 'elder_sign'],
};

const ENCOUNTER_CODES = ['01118', '01119', '01159', '01160', '01161', '01162', '01163', '01164', '01165', '01166', '01167', '01168'];

function mkLoc(k: K, id: string, code: string, o: { inPlay: boolean; revealed: boolean; connections: string[] }): void {
  const d = k.cat.get(code);
  const l: Location = {
    id, code, name: d.title, revealed: false, shroud: num(d.location?.shroud), clues: 0, connections: o.connections,
    attached: [], inPlay: o.inPlay, victory: d.victory ?? 0,
  };
  k.s.locations[id] = l;
  if (o.revealed) k.revealLocation(id);
}

function clueNeed(k: K): number {
  const d = k.cat.get(String(k.s.scenarioFlags.actCode));
  const per = d.actAgenda?.cluesFixed ? 1 : k.s.seats.length;
  return num(d.actAgenda?.clueThreshold) * per;
}

function groupClues(k: K, seats: SeatId[]): number { return seats.reduce((n, x) => n + k.inv(x).clues, 0); }

function spendClues(k: K, need: number, order: SeatId[]): void {
  let left = need;
  for (const seat of order) { const take = Math.min(left, k.inv(seat).clues); k.inv(seat).clues -= take; left -= take; }
  k.emit('cluesSpent', { count: need });
}

function advanceAct(k: K, args: { seat?: SeatId; only?: SeatId[]; free?: boolean }): void {
  const s = k.s; const old = String(s.scenarioFlags.actCode);
  if (!args.free) {
    const pool = args.only ?? k.activeSeats();
    const order = args.seat && pool.includes(args.seat) ? [args.seat, ...pool.filter(x => x !== args.seat)] : pool;
    spendClues(k, clueNeed(k), order);
  }
  k.emit('actAdvanced', { stage: s.act.stage, name: k.cat.get(old).title });
  k.queueEffect({ code: old, name: 'back', seat: s.lead });
  if (s.act.stage < ACTS.length) { s.act.stage++; s.scenarioFlags.actCode = ACTS[s.act.stage - 1]!; }
}

function advanceAgenda(k: K): void {
  const s = k.s; const old = String(s.scenarioFlags.agendaCode);
  s.agenda.doom = 0; k.clearCardDoom();
  k.emit('agendaAdvanced', { stage: s.agenda.stage, name: k.cat.get(old).title });
  if (s.agenda.stage < AGENDAS.length) { s.agenda.stage++; s.scenarioFlags.agendaCode = AGENDAS[s.agenda.stage - 1]!; }
  k.queueEffect({ code: old, name: 'back', seat: s.lead });
}

/** Spawn a ghoul from the encounter deck for agenda 2b / the hard skull token. */
function drawGhoul(k: K, seat: SeatId, o: { fromDiscardToo: boolean }): void {
  const s = k.s;
  if (o.fromDiscardToo) { s.encounterDeck = shuffle(s, [...s.encounterDeck, ...s.encounterDiscard.splice(0)]); }
  while (s.encounterDeck.length) {
    const id = s.encounterDeck.shift()!;
    if (k.def(id).type === 'enemy' && k.hasTrait(id, 'ghoul')) {
      k.emit('ghoulFound', { name: k.name(id), seat });
      const spawn = k.def(id).abilities.find(a => a.kind === 'spawn');
      const loc = spawn && spawn.kind === 'spawn' ? k.locByName(spawn.instruction.replace(/\.$/, '').trim()) : undefined;
      if (spawn && !loc) { k.discardCard(id); continue; }
      k.spawnEnemy(id, loc ? { loc: loc.id } : { engage: seat });
      return;
    }
    s.encounterDiscard.push(id);
  }
}

const registry: Registry = {
  '01104': {
    handlers: {
      horror(k, a) { k.harm(a.seat, 0, k.s.difficulty === 'hard' || k.s.difficulty === 'expert' ? 2 : 1, { source: 'the cultist token' }); },
      tablet(k, a) {
        const hard = k.s.difficulty === 'hard' || k.s.difficulty === 'expert';
        if (k.ghoulsAt(k.inv(a.seat).loc) > 0) k.harm(a.seat, 1, hard ? 1 : 0, { source: 'the tablet token' });
      },
      ghoulSearch(k, a) { drawGhoul(k, a.seat, { fromDiscardToo: true }); shuffle(k.s, k.s.encounterDeck); },
    },
  },
  '01105': {
    handlers: {
      back(k) {
        const lead = k.s.lead;
        const [pick] = k.choose('agenda1b', [
          { id: 'discard', label: 'Lose something from your hands' },
          { id: 'horror', label: 'Let the lead investigator bear it (2 nerves)' },
        ], { seat: lead });
        if (pick === 'discard') {
          for (const seat of k.activeSeats()) {
            const hand = k.inv(seat).hand;
            if (hand.length) k.discardCard(hand[k.rand(hand.length)]!);
          }
          k.emit('agenda1Discard', {});
        } else { k.harm(lead, 0, 2, { source: 'A Lapse in Time' }); }
      },
    },
  },
  '01106': {
    handlers: {
      back(k) {
        const s = k.s;
        s.encounterDeck = shuffle(s, [...s.encounterDeck, ...s.encounterDiscard.splice(0)]);
        drawGhoul(k, s.lead, { fromDiscardToo: false });
      },
    },
  },
  '01107': {
    forced: [
      { trigger: 'endOfEnemyPhase', run: 'march' },
      { trigger: 'endOfRound', run: 'doom' },
    ],
    handlers: {
      march(k) {
        for (const id of [...k.s.enemies]) {
          const c = k.card(id);
          if (c.engaged || !c.loc || !k.hasTrait(id, 'ghoul') || c.loc === 'parlor') continue;
          const next = k.stepToward(c.loc, 'parlor');
          if (next) { const from = c.loc; c.loc = next; k.emit('enemyMoved', { cardId: id, name: k.name(id), from, to: next, march: true }); }
        }
        k.engageCheck();
      },
      doom(k) {
        let n = 0;
        for (const id of k.s.enemies) if (k.hasTrait(id, 'ghoul') && ['hallway', 'parlor'].includes(k.card(id).loc ?? '')) n++;
        if (n > 0) k.placeDoom(n);
      },
      back(k) {
        if (k.s.act.stage >= 3) {
          for (const seat of k.activeSeats()) {
            k.s.scenarioFlags[`trauma:${seat}:physical`] = Number(k.s.scenarioFlags[`trauma:${seat}:physical`] ?? 0) + 1;
            k.inv(seat).status = 'defeated';
          }
          k.s.campaignLog.push('The ghouls broke free and the house fell to them.');
          k.endGame('ghouls_loose');
        } else {
          k.s.campaignLog.push('The investigators were trapped inside and overrun.');
          k.endGame('R3');
        }
      },
    },
  },
  '01108': {
    handlers: {
      back(k) {
        const s = k.s;
        for (const id of ['hallway', 'attic', 'cellar', 'parlor']) s.locations[id]!.inPlay = true;
        for (const e of [...k.enemiesAt('study')]) k.discardCard(e);
        for (const seat of k.activeSeats()) { k.inv(seat).loc = 'hallway'; }
        k.revealLocation('hallway');
        s.locations.study!.inPlay = false;
        s.locations.study!.clues = 0;
        k.emit('actOneBack', {});
      },
    },
  },
  '01109': {
    handlers: {
      barrier(k) {
        const [pick] = k.choose('act2.barrier', [
          { id: 'go', label: 'Pool your leads and break the barrier' },
          { id: 'wait', label: 'Not yet' },
        ], { seat: k.s.lead });
        if (pick === 'go') k.queue({ k: 'scenario', hook: 'advanceAct', stage: 0, args: { only: k.invAt('hallway').map(i => i.seat) } });
      },
      back(k) {
        const s = k.s;
        s.scenarioFlags.parlorOpen = true;
        k.revealLocation('parlor');
        const lita = s.setAside.cards.find(id => k.card(id).code === '01117');
        if (lita) { s.setAside.cards.splice(s.setAside.cards.indexOf(lita), 1); k.card(lita).loc = 'parlor'; s.locAssets.push(lita); }
        const priest = s.setAside.cards.find(id => k.card(id).code === '01116');
        if (priest) { s.setAside.cards.splice(s.setAside.cards.indexOf(priest), 1); k.spawnEnemy(priest, { loc: 'hallway' }); }
        k.emit('actTwoBack', {});
      },
    },
  },
  '01110': {
    handlers: {
      back(k) {
        const [pick] = k.choose('act3.resolution', [
          { id: 'R1', label: 'Burn the house down' },
          { id: 'R2', label: 'Defend the home' },
        ], { seat: k.s.lead });
        if (pick === 'R1') k.s.campaignLog.push('The house was burned to the ground.'); else k.s.campaignLog.push('The house still stands.');
        k.endGame(pick ?? 'R2');
      },
    },
  },
  '01113': {
    forced: [{ trigger: 'afterEnterLocation', when: (_k, _o, id, d) => id === 'loc:attic' && d.loc === 'attic', run: 'dread' }],
    handlers: { dread(k, a) { k.harm(a.data.seat, 0, 1, { source: 'the attic' }); } },
  },
  '01114': {
    forced: [{ trigger: 'afterEnterLocation', when: (_k, _o, id, d) => id === 'loc:cellar' && d.loc === 'cellar', run: 'chill' }],
    handlers: { chill(k, a) { k.harm(a.data.seat, 1, 0, { source: 'the cellar' }); } },
  },
};

export const gathering: ScenarioModule = {
  id: 'gathering',
  title: 'The Gathering',
  agendaCodes: AGENDAS,
  actCodes: ACTS,
  registry,
  chaosBag: (d) => [...BAGS[d]],

  setup(k) {
    const s = k.s;
    mkLoc(k, 'study', '01111', { inPlay: true, revealed: true, connections: [] });
    mkLoc(k, 'hallway', '01112', { inPlay: false, revealed: false, connections: ['attic', 'cellar', 'parlor'] });
    mkLoc(k, 'attic', '01113', { inPlay: false, revealed: false, connections: ['hallway'] });
    mkLoc(k, 'cellar', '01114', { inPlay: false, revealed: false, connections: ['hallway'] });
    mkLoc(k, 'parlor', '01115', { inPlay: false, revealed: false, connections: ['hallway'] });
    for (const seat of s.seats) k.inv(seat).loc = 'study';
    s.act = { stage: 1, clues: 0 }; s.agenda = { stage: 1, doom: 0, deckStage: 1 };
    s.scenarioFlags.actCode = ACTS[0]!; s.scenarioFlags.agendaCode = AGENDAS[0]!; s.scenarioFlags.parlorOpen = false;
    for (const code of ['01116', '01117']) s.setAside.cards.push(k.newCard(code, null));
    const deck: string[] = [];
    for (const code of ENCOUNTER_CODES) for (let i = 0; i < Math.max(1, k.cat.get(code).quantity); i++) deck.push(k.newCard(code, null));
    s.encounterDeck = shuffle(s, deck);
    s.chaosBag = BAGS[s.difficulty].slice();
  },

  tokenEffect(k, seat, token, t) {
    const hard = k.s.difficulty === 'hard' || k.s.difficulty === 'expert';
    const loc = k.inv(seat).loc;
    switch (token) {
      case 'skull':
        return hard
          ? { modifier: -2, ifFail: { code: '01104', name: 'ghoulSearch', seat } }
          : { modifier: -k.ghoulsAt(loc) };
      case 'cultist':
        return hard ? { modifier: 0, revealAnother: true, ifFail: { code: '01104', name: 'horror', seat } } : { modifier: -1, ifFail: { code: '01104', name: 'horror', seat } };
      case 'tablet':
        return { modifier: hard ? -4 : -2, immediate: { code: '01104', name: 'tablet', seat } };
      default: void t; return { modifier: 0 };
    }
  },

  hook(k, name, args) {
    const s = k.s;
    switch (name) {
      case 'checkAgenda': {
        const thr = num(k.cat.get(String(s.scenarioFlags.agendaCode)).actAgenda?.doomThreshold);
        if (k.totalDoom() >= thr) advanceAgenda(k);
        break;
      }
      case 'advanceAct': advanceAct(k, args as { seat?: SeatId; only?: SeatId[]; free?: boolean }); break;
      case 'enemyDefeated':
        if (args.code === '01116' && s.act.stage === 3) advanceAct(k, { free: true });
        break;
      case 'endOfRound':
        if (s.act.stage === 2 && groupClues(k, k.invAt('hallway').map(i => i.seat)) >= clueNeed(k) && k.activeSeats().length)
          k.queueEffect({ code: '01109', name: 'barrier', seat: s.lead });
        break;
      case 'noInvestigators': {
        const anyResigned = s.seats.some(x => k.inv(x).status === 'resigned');
        s.campaignLog.push(anyResigned ? 'The survivors fled the house.' : 'No one walked out of the house.');
        k.endGame(anyResigned ? 'R0' : 'R3');
        break;
      }
      default: break;
    }
  },

  canMoveInto(k, _seat, to) { return to !== 'parlor' || !!k.s.scenarioFlags.parlorOpen; },

  actAdvance(k, seat) {
    const s = k.s;
    if (s.act.stage !== 1) return null;
    const need = clueNeed(k);
    if (groupClues(k, k.activeSeats()) < need) return null;
    void seat;
    return { ok: true, label: 'Piece together what you have found' };
  },

  extraActions(k, seat) {
    if (k.inv(seat).loc !== 'parlor') return [];
    return [{ action: { type: 'resign' }, label: 'Run out the front door', cost: '1 moment', group: 'resign', actions: 1, provokes: false, needsConfirm: true }];
  },
};

void fireForced;
