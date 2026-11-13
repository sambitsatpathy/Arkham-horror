// Forced effects: scanned in a fixed order (players' cards by seat, enemies, locations and what is attached to them,
// then the current agenda and act). Each match queues an effect frame. The rules let the lead investigator order
// simultaneous forced effects; this engine uses a fixed order and says so in the README.
import type { K } from './ctx.ts';

export function fireForced(k: K, trigger: string, data: Record<string, unknown> = {}): void {
  const s = k.s;
  const run = (code: string, cardId: string, owner: string | null) => {
    const sc = k.script(code);
    for (const f of sc?.forced ?? []) {
      if (f.trigger !== trigger) continue;
      if (f.when && !f.when(k, owner, cardId, data)) continue;
      k.queueEffect({ code, name: f.run, args: { cardId, data }, seat: owner });
    }
  };
  for (const seat of k.activeSeats()) for (const id of k.inPlayCards(seat)) run(k.card(id).code, id, seat);
  for (const id of s.enemies) if (!k.isBlanked(id)) run(k.card(id).code, id, (k.card(id).flags.bearer as string | undefined) ?? k.card(id).engaged);
  for (const l of Object.values(s.locations)) {
    if (!l.inPlay) continue;
    run(l.code, 'loc:' + l.id, null);
    for (const id of l.attached) run(k.card(id).code, id, null);
  }
  for (const id of s.locAssets) run(k.card(id).code, id, null);
  const ag = s.scenarioFlags.agendaCode as string | undefined; if (ag) run(ag, 'agenda', null);
  const ac = s.scenarioFlags.actCode as string | undefined; if (ac) run(ac, 'act', null);
}
