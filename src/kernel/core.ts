// Core handlers: the bodies of the basic actions and the default outcomes of the three basic tests.
import type { Action, SeatId } from './types.ts';
import type { K } from './ctx.ts';
import type { Script } from './scripts/types.ts';
import { fireForced } from './forced.ts';
import { checkAllOut } from './engine.ts';

const SLOT_CAP: Record<string, number> = { hand: 2, ally: 1, accessory: 1, body: 1, arcane: 2, tarot: 1 };

export function doMove(k: K, seat: SeatId, to: string): void {
  const inv = k.inv(seat); const from = inv.loc;
  const first = !k.loc(to).revealed;
  fireForced(k, 'afterLeaveLocation', { seat, loc: from });
  for (const e of k.engagedWith(seat)) k.card(e).loc = to;
  inv.loc = to;
  if (first) k.revealLocation(to);
  k.emit('moved', { seat, from, to, firstVisit: first, name: k.loc(to).name });
  fireForced(k, 'afterEnterLocation', { seat, loc: to });
  k.engageCheck();
}

export const coreScript: Script = {
  handlers: {
    act(k, a) {
      const seat: SeatId = a.seat; const inv = k.inv(seat);
      if (inv.status !== 'active') return;
      const act: Action = a.action;
      switch (act.type) {
        case 'investigate': k.startInvestigate(seat); break;
        case 'move': doMove(k, seat, act.to); break;
        case 'draw': k.draw(seat, 1); break;
        case 'resource': k.gainResources(seat, 1); break;
        case 'engage': {
          if (!k.s.enemies.includes(act.enemyId)) return;
          k.card(act.enemyId).engaged = seat;
          k.emit('enemyEngaged', { cardId: act.enemyId, name: k.name(act.enemyId), seat, chosen: true });
          break;
        }
        case 'fight': if (k.s.enemies.includes(act.enemyId)) k.startFight(seat, act.enemyId); break;
        case 'evade': if (k.s.enemies.includes(act.enemyId)) k.startEvade(seat, act.enemyId); break;
        case 'resign': {
          inv.status = 'resigned';
          for (const e of k.engagedWith(seat)) k.card(e).engaged = null;
          k.emit('resigned', { seat, name: inv.name, loc: inv.loc });
          if (k.s.lead === seat) { const next = k.activeSeats()[0]; if (next) k.s.lead = next; }
          checkAllOut(k);
          break;
        }
        case 'advance': k.queue({ k: 'scenario', hook: 'advanceAct', stage: 0, args: { seat } }); break;
        default: break;
      }
    },

    enterPlay(k, a) {
      const seat: SeatId = a.seat; const id: string = a.cardId; const d = k.def(id); const inv = k.inv(seat);
      for (const slot of new Set(d.slots)) {
        const need = d.slots.filter(x => x === slot).length;
        for (let guard = 0; guard < 6; guard++) {
          const others = inv.inPlay.filter(x => x !== id);
          const count = (xs: string[]) => xs.reduce((n, x) => n + k.def(x).slots.filter(y => y === slot).length, 0);
          let general = 0, tomeOnly = 0;
          for (const x of others) for (const b of k.script(k.card(x).code)?.slotBonus ?? []) if (b.slot === slot) { if (b.onlyTrait) tomeOnly += b.n; else general += b.n; }
          const isTome = k.hasTrait(id, 'tome');
          const used = isTome ? count(others) : count(others.filter(x => !k.hasTrait(x, 'tome'))) + Math.max(0, count(others.filter(x => k.hasTrait(x, 'tome'))) - tomeOnly);
          if (used + need <= (SLOT_CAP[slot] ?? 1) + general + (isTome ? tomeOnly : 0)) break;
          const holders = inv.inPlay.filter(x => k.def(x).slots.includes(slot));
          const [pick] = k.choose('slot.discard', holders.map(x => ({ id: x, label: k.name(x) })), { seat });
          if (!pick) break;
          k.discardCard(pick);
        }
      }
      k.putInPlay(seat, id);
      k.emit('assetEntered', { seat, cardId: id, name: d.title });
      fireForced(k, 'afterAssetEnters', { seat, cardId: id });
      k.queue({ k: 'window', trigger: 'afterAssetEnters', data: { seat, cardId: id }, seats: [seat], used: [], stage: 0, finalize: null });
    },

    discover(k, a) {
      const d = a.data as { seat: SeatId; locId: string; n: number; source: string };
      const l = k.loc(d.locId); const n = Math.min(d.n, l.clues);
      if (n <= 0) return;
      l.clues -= n; k.inv(d.seat).clues += n;
      k.emit('clueDiscovered', { seat: d.seat, loc: d.locId, name: l.name, count: n, remaining: l.clues, source: d.source });
      if (l.clues === 0) { k.s.scenarioFlags[`clean:${d.locId}`] = true; k.emit('locationClean', { loc: d.locId, name: l.name }); }
    },

    investigateSuccess(k, a) {
      const seat: SeatId = a.seat; const loc = k.inv(seat).loc;
      k.discoverClues(seat, loc, 1 + (a.extraClues ?? 0), 'investigate');
      k.queue({ k: 'window', trigger: 'afterInvestigateSuccess', data: { seat, loc, margin: a.margin ?? 0 }, seats: [seat], used: [], stage: 0, finalize: null });
      fireForced(k, 'afterInvestigateSuccess', { seat, loc });
    },

    fightSuccess(k, a) {
      const e: string = a.enemyId;
      if (!k.s.enemies.includes(e)) return;
      let dmg = (a.data?.marginDamage ? Math.min(5, Math.max(1, Number(a.margin ?? 1))) : 1) + Number(a.data?.damageBonus ?? 0) + Number(a.bonusDamage ?? 0);
      const mb = a.data?.marginBonus as { min: number; dmg: number } | undefined; if (mb && Number(a.margin ?? 0) >= mb.min) dmg += mb.dmg;
      if (k.hasTrait(e, 'monster')) {
        const at = k.inv(a.seat).loc;
        for (const x of k.invAt(at)) if (k.controls(x.seat, '01117')) dmg += 1;
      }
      k.damageEnemy(e, dmg, a.seat, 'attack');
    },

    fightFail(k, a) {
      const e: string = a.enemyId;
      if (!k.s.enemies.includes(e)) return;
      const c = k.card(e);
      if (k.hasKeyword(e, 'retaliate') && !c.exhausted && c.engaged === a.seat)
        k.queue({ k: 'attack', enemyId: e, seat: a.seat, stage: 0, cancelled: false, opportunity: true });
    },

    evadeSuccess(k, a) {
      const e: string = a.enemyId;
      if (!k.s.enemies.includes(e)) return;
      const c = k.card(e); c.exhausted = true; c.engaged = null;
      k.emit('evaded', { seat: a.seat, cardId: e, name: k.name(e) });
      k.queue({ k: 'window', trigger: 'afterEvade', data: { seat: a.seat, enemyId: e }, seats: [a.seat], used: [], stage: 0, finalize: null });
    },
  },
};
