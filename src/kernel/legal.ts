// Legality: what a seat can do right now, what it costs, and how costs are paid.
import type { Action, CardId, GameState, LegalOption, SeatId } from './types.ts';
import type { K } from './ctx.ts';
import type { AbilityDef, CostDef } from './scripts/types.ts';
import type { Engine } from './engine.ts';

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
export const NON_PROVOKING = new Set(['fight', 'evade', 'parley', 'resign']);

export function isFastCard(k: K, id: CardId): boolean { return k.def(id).keywords.some(x => x.name === 'fast'); }

export function extraActionCost(k: K, seat: SeatId, type: string): number {
  let extra = 0;
  for (const id of k.inPlayCards(seat)) extra += k.script(k.card(id).code)?.restrict?.actionExtraCost?.(k, seat, id, type) ?? 0;
  return extra;
}

/** True when this action ability would be paid from a restricted extra action (Daisy's tome-only action) rather than a normal one. */
export function usesRestricted(k: K, seat: SeatId, cardId: CardId, need: number): boolean {
  return (k.inv(seat).restricted.tome ?? 0) >= need && k.hasTrait(cardId, 'tome');
}

export function noteExtraCostPaid(k: K, seat: SeatId, type: string): void {
  const inv = k.inv(seat);
  for (const id of k.inPlayCards(seat)) {
    if ((k.script(k.card(id).code)?.restrict?.actionExtraCost?.(k, seat, id, type) ?? 0) > 0) inv.roundFlags['xc:' + id] = true;
  }
}

export function canAffordCost(k: K, seat: SeatId, cardId: CardId, cost?: CostDef): boolean {
  if (!cost) return true;
  const c = k.card(cardId);
  if (cost.resources && k.inv(seat).resources < cost.resources) return false;
  if (cost.uses && (c.tokens.uses[cost.uses[0]] ?? 0) < cost.uses[1]) return false;
  if (cost.exhaust && c.exhausted) return false;
  return true;
}

export function payCost(k: K, seat: SeatId, cardId: CardId, cost?: CostDef): void {
  if (!cost) return;
  const c = k.card(cardId);
  if (cost.resources) k.spendResources(seat, cost.resources);
  if (cost.uses) { c.tokens.uses[cost.uses[0]] = (c.tokens.uses[cost.uses[0]] ?? 0) - cost.uses[1]; }
  if (cost.exhaust) c.exhausted = true;
  if (cost.discard) k.discardCard(cardId);
}

export function describeCost(actions: number, cost?: CostDef, cardCost = 0): string {
  const parts: string[] = [];
  if (actions > 0) parts.push(actions === 1 ? '1 moment' : `${actions} moments`);
  const res = (cost?.resources ?? 0) + cardCost;
  if (res) parts.push(`${res} means`);
  if (cost?.uses) parts.push(`1 ${cost.uses[0]}`);
  if (cost?.discard) parts.push('the item is lost');
  return parts.length ? parts.join(', ') : 'free';
}

export interface PlayCheck { ok: boolean; free: boolean; cost: number; reason?: string }

/** The event on top of the discard pile when a card in play lets its owner play it as if it were in hand (Wendy's Amulet). */
export function playableFromDiscard(k: K, seat: SeatId): CardId | null {
  const inv = k.inv(seat);
  if (!k.inPlayCards(seat).some(id => k.script(k.card(id).code)?.playFromDiscardTop)) return null;
  const top = inv.discard[inv.discard.length - 1];
  return top && k.def(top).type === 'event' ? top : null;
}

export function canPlayCard(k: K, seat: SeatId, cardId: CardId, ctx: 'turn' | 'window'): PlayCheck {
  const no = (reason: string): PlayCheck => ({ ok: false, free: false, cost: 0, reason });
  const inv = k.inv(seat); const d = k.def(cardId); const code = k.card(cardId).code;
  if (!inv.hand.includes(cardId) && !(playableFromDiscard(k, seat) === cardId)) return no('not in hand');
  if (d.type !== 'asset' && d.type !== 'event') return no('not playable');
  const sc = k.script(code);
  if (!sc) return no('unscripted');
  const cost = typeof d.cost === 'number' ? d.cost : 0;
  if (inv.resources < cost) return no('cannot afford');
  for (const other of k.inPlayCards(seat)) if (k.script(k.card(other).code)?.restrict?.cannotPlay?.(k, seat, other, cardId)) return no('forbidden');
  if (d.type === 'event' && sc.fastWindow && ctx === 'turn') return no('timing');
  if (d.type === 'event' && !sc.play) return no('unscripted');
  if (sc.playRestriction && !sc.playRestriction(k, seat, cardId)) return no('restricted');
  return { ok: true, free: isFastCard(k, cardId), cost };
}

interface AbilityCandidate { cardId: CardId; ability: AbilityDef }

export function abilityCandidates(k: K, seat: SeatId): AbilityCandidate[] {
  const inv = k.inv(seat); const out: AbilityCandidate[] = [];
  const own = [...inv.inPlay, ...inv.threat, ...(k.textActive(seat) ? ['inv:' + seat] : [])];
  const here = [
    ...k.s.locAssets.filter(id => k.card(id).loc === inv.loc),
    ...k.enemiesAt(inv.loc),
  ];
  for (const id of [...own, ...here]) {
    const sc = k.script(k.card(id).code);
    for (const a of sc?.abilities ?? []) {
      if (a.testOnly) continue;
      const mine = own.includes(id);
      if ((a.controlledOnly ?? true) && !mine) continue;
      if (!(a.controlledOnly ?? true) && mine) continue;
      out.push({ cardId: id, ability: a });
    }
  }
  return out;
}

export function abilityUsable(k: K, seat: SeatId, c: AbilityCandidate): boolean {
  const { cardId, ability: a } = c;
  if (!canAffordCost(k, seat, cardId, a.cost)) return false;
  if (a.when && !a.when(k, seat, cardId)) return false;
  if (a.limitPerRound && Number(k.inv(seat).roundFlags[`lim:${cardId}:${a.id}`] ?? 0) >= a.limitPerRound) return false;
  return true;
}

export function legalActions(E: Engine, s: GameState, seat: SeatId): LegalOption[] {
  const k = E.k(s);
  const inv = k.inv(seat);
  if (inv.status !== 'active') return [];
  const out: LegalOption[] = [];
  const left = inv.actionsLeft;
  const loc = k.loc(inv.loc);
  const add = (o: Omit<LegalOption, 'cost'> & { cost?: string }, costDef?: CostDef, cardCost = 0) => {
    out.push({ ...o, cost: o.cost ?? describeCost(o.actions, costDef, cardCost) });
  };
  const ex = (t: string) => extraActionCost(k, seat, t);

  if (left >= 1 && loc.clues > 0) add({ action: { type: 'investigate' }, label: 'Search the place', group: 'investigate', actions: 1, provokes: true });
  if (left >= 1 + ex('move')) {
    for (const to of loc.connections) {
      const dest = k.s.locations[to];
      if (!dest?.inPlay || !E.scn.canMoveInto(k, seat, to)) continue;
      add({ action: { type: 'move', to }, label: dest.revealed ? `Go to ${dest.name}` : 'Go through the unopened door', group: 'move', actions: 1 + ex('move'), provokes: true, targetLabel: dest.revealed ? dest.name : 'an unopened door' });
    }
  }
  if (left >= 1) {
    add({ action: { type: 'draw' }, label: 'Rummage through your things', group: 'draw', actions: 1, provokes: true });
    add({ action: { type: 'resource' }, label: 'Scrounge up some means', group: 'resource', actions: 1, provokes: true });
  }
  const fromDiscard = playableFromDiscard(k, seat);
  for (const id of [...inv.hand, ...(fromDiscard ? [fromDiscard] : [])]) {
    const pc = canPlayCard(k, seat, id, 'turn');
    if (!pc.ok) continue;
    const need = pc.free ? 0 : 1;
    if (left < need) continue;
    add({ action: { type: 'play', cardId: id }, label: `Play ${k.name(id)}`, group: 'play', actions: need, provokes: !pc.free, sourceCardId: id, targetLabel: k.name(id) }, undefined, pc.cost);
  }
  const hereEnemies = k.enemiesAt(inv.loc);
  for (const c of abilityCandidates(k, seat)) {
    const a = c.ability;
    if (!abilityUsable(k, seat, c)) continue;
    const need = a.speed === 'fast' ? 0 : (a.actions ?? 1);
    if (left < need && !usesRestricted(k, seat, c.cardId, need)) continue;
    const provokes = need > 0 && !a.noProvoke && !(a.designator && NON_PROVOKING.has(a.designator));
    const base = { group: 'activate', actions: need, provokes, sourceCardId: c.cardId, needsConfirm: a.needsConfirm, designator: a.designator } as const;
    const nm = k.name(c.cardId);
    if (a.designator === 'fight' || a.designator === 'evade') {
      const pool = a.designator === 'fight' ? hereEnemies : k.engagedWith(seat);
      for (const e of pool) add({ ...base, action: { type: 'activate', cardId: c.cardId, abilityId: a.id, targetId: e }, label: `${a.label} (${nm}) on ${k.name(e)}`, targetLabel: k.name(e) }, a.cost);
    } else {
      add({ ...base, action: { type: 'activate', cardId: c.cardId, abilityId: a.id }, label: `${a.label} (${nm})`, targetLabel: nm }, a.cost);
    }
  }
  for (const e of hereEnemies) {
    const c = k.card(e);
    if (c.engaged !== seat && left >= 1) add({ action: { type: 'engage', enemyId: e }, label: `Square up to ${k.name(e)}`, group: 'engage', actions: 1, provokes: true, targetLabel: k.name(e) });
    if (left >= 1 + ex('fight')) add({ action: { type: 'fight', enemyId: e }, label: `Strike at ${k.name(e)}`, group: 'fight', actions: 1 + ex('fight'), provokes: false, targetLabel: k.name(e) });
  }
  for (const e of k.engagedWith(seat)) {
    if (left >= 1 + ex('evade')) add({ action: { type: 'evade', enemyId: e }, label: `Slip away from ${k.name(e)}`, group: 'evade', actions: 1 + ex('evade'), provokes: false, targetLabel: k.name(e) });
  }
  out.push(...E.scn.extraActions(k, seat).filter(o => o.actions <= left));
  const adv = E.scn.actAdvance(k, seat);
  if (adv?.ok) add({ action: { type: 'advance' }, label: adv.label, group: 'advance', actions: 0, provokes: false });
  return out;
}

export function sameAction(a: Action, b: Action): boolean { return JSON.stringify(a) === JSON.stringify(b); }
export { num };
