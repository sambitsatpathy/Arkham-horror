// view(state, seat): everything the adapter is allowed to display to one player.
// Hidden information (other hands, deck order, the encounter deck, the bag, unrevealed places) never appears here.
import type { CardId, GameState, LocId, SeatId, SeatStatus } from './types.ts';
import type { Engine } from './engine.ts';
import { K } from './ctx.ts';

export interface CardView { id: CardId; code: string; name: string; type: string; cost: number | null; exhausted: boolean; uses: Record<string, number>; damage: number; horror: number; fast: boolean }
export interface EnemyView { id: CardId; name: string; engagedWith: SeatId | null; exhausted: boolean; wounded: 'unhurt' | 'hurt' | 'badly hurt'; damage: number; health: number; traits: string[] }
export interface PlaceView {
  id: LocId; name: string; revealed: boolean; inPlay: boolean;
  exits: { id: LocId; name: string | null }[];       // name is null for places nobody has opened yet
  here: SeatId[]; enemies: EnemyView[]; leadsLeft: number; attached: string[]; clean: boolean; shroud: number;
}
export interface PartyView {
  seat: SeatId; code: string; name: string; loc: LocId; status: SeatStatus; wounds: number; maxWounds: number; nerves: number; maxNerves: number;
  leads: number; means: number; handCount: number; inPlay: CardView[]; threat: string[]; moments: number; tome: number;
}
export interface SelfView extends PartyView { hand: CardView[]; deckCount: number; discardCount: number; skills: Record<string, number> }
export interface View {
  seat: SeatId | null; round: number; phase: GameState['phase']; spotlight: SeatId | null; lead: SeatId;
  me: SelfView | null; party: PartyView[]; places: Record<LocId, PlaceView>;
  agenda: { stage: number; code: string; title: string; doom: number; threshold: number };
  act: { stage: number; code: string; title: string; cluesNeeded: number | null; cluesHeld: number };
  pending: { kind: string; seats: SeatId[]; id: string } | null;
  bagSize: number; bag: Record<string, number>; encounterCount: number; ended: GameState['ended'];
  flags: Record<string, number | string | boolean>;
}

export function cardView(k: K, id: CardId): CardView {
  const c = k.card(id); const d = k.def(id);
  return {
    id, code: c.code, name: d.title, type: d.type, cost: typeof d.cost === 'number' ? d.cost : null, exhausted: c.exhausted,
    uses: { ...c.tokens.uses }, damage: c.tokens.damage, horror: c.tokens.horror,
    fast: d.keywords.some(x => x.name === 'fast'),
  };
}

function enemyView(k: K, id: CardId): EnemyView {
  const c = k.card(id); const hp = k.enemyHealth(id); const dm = c.tokens.damage;
  return {
    id, name: k.name(id), engagedWith: c.engaged, exhausted: c.exhausted, damage: dm, health: hp,
    wounded: dm === 0 ? 'unhurt' : dm * 2 >= hp ? 'badly hurt' : 'hurt', traits: k.def(id).traits,
  };
}

function partyView(k: K, seat: SeatId): PartyView {
  const i = k.inv(seat);
  return {
    seat, code: i.code, name: i.name, loc: i.loc, status: i.status, wounds: i.damage, maxWounds: i.maxHealth, nerves: i.horror, maxNerves: i.maxSanity,
    leads: i.clues, means: i.resources, handCount: i.hand.length, inPlay: i.inPlay.map(id => cardView(k, id)),
    threat: i.threat.map(id => k.name(id)), moments: i.actionsLeft, tome: i.restricted.tome ?? 0,
  };
}

export function view(E: Engine, s: GameState, seat: SeatId | null): View {
  const k = new K(s, E.cat, E.reg);
  const places: Record<LocId, PlaceView> = {};
  for (const l of Object.values(s.locations)) {
    if (!l.inPlay) continue;
    places[l.id] = {
      id: l.id, name: l.revealed ? l.name : 'an unopened door', revealed: l.revealed, inPlay: true,
      exits: l.connections.filter(c => s.locations[c]?.inPlay).map(c => ({ id: c, name: s.locations[c]!.revealed ? s.locations[c]!.name : null })),
      here: s.seats.filter(x => k.inv(x).loc === l.id && k.inv(x).status === 'active'),
      enemies: l.revealed ? k.enemiesAt(l.id).map(e => enemyView(k, e)) : [],
      leadsLeft: l.revealed ? l.clues : 0, attached: l.attached.map(id => k.name(id)),
      clean: l.revealed && l.clues === 0 && !!s.scenarioFlags[`clean:${l.id}`], shroud: l.shroud,
    };
  }
  const agendaCode = String(s.scenarioFlags.agendaCode ?? ''); const actCode = String(s.scenarioFlags.actCode ?? '');
  const ag = agendaCode && E.cat.has(agendaCode) ? E.cat.get(agendaCode) : null;
  const ac = actCode && E.cat.has(actCode) ? E.cat.get(actCode) : null;
  const thr = (v: unknown) => (typeof v === 'number' ? v : Number((v as { value?: number } | undefined)?.value ?? 0));
  const clueNeed = ac?.actAgenda?.clueThreshold != null ? thr(ac.actAgenda.clueThreshold) * (ac.actAgenda.cluesFixed ? 1 : s.seats.length) : null;
  const p = s.pending;
  const pseats = !p ? [] : p.kind === 'spotlight' ? p.seats : [p.seat];
  const me = seat && s.investigators[seat] ? k.inv(seat) : null;
  return {
    seat, round: s.round, phase: s.phase, spotlight: s.spotlight, lead: s.lead,
    me: me ? { ...partyView(k, seat!), hand: me.hand.map(id => cardView(k, id)), deckCount: me.deck.length, discardCount: me.discard.length, skills: { ...me.skills } } : null,
    party: s.seats.map(x => partyView(k, x)),
    places,
    agenda: { stage: s.agenda.stage, code: agendaCode, title: ag?.title ?? '', doom: k.totalDoom(), threshold: thr(ag?.actAgenda?.doomThreshold) },
    act: { stage: s.act.stage, code: actCode, title: ac?.title ?? '', cluesNeeded: clueNeed, cluesHeld: s.seats.reduce((n, x) => n + k.inv(x).clues, 0) },
    pending: p ? { kind: p.kind, seats: pseats, id: p.id } : null,
    bagSize: s.chaosBag.length, bag: s.chaosBag.reduce<Record<string, number>>((m, x) => { m[x] = (m[x] ?? 0) + 1; return m; }, {}), encounterCount: s.encounterDeck.length, ended: s.ended,
    flags: { ...s.scenarioFlags },
  };
}
