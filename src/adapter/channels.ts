// syncChannels: compute the channels, names, topics and permissions the game should have, diff against Discord, apply the difference.
// Idempotent. Run it after every step, at startup, and on /host resync. A half-finished travel is repaired by the next run.
import type { DiscordPort, ChannelInfo, ChannelSpec, Overwrite, Perm } from './port.ts';
import type { Store, GameRow, SeatRow } from './store.ts';
import type { GameState } from '../kernel/types.ts';

export const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'place';

export interface SyncDeps { port: DiscordPort; store: Store; botUserId?: string; archiveCategoryId?: string | null; gameLabel?: string }

interface Plan { object: string; kind: string; spec: ChannelSpec; parentObject: string | null }

const V: Perm[] = ['view', 'history'];
const ow = (id: string, kind: 'role' | 'member', allow: Perm[], deny: Perm[] = []): Overwrite => ({ id, kind, allow, deny });

export function planChannels(game: GameRow, seats: SeatRow[], state: GameState | null, guildId: string, bot: string | undefined, archived: boolean, known: { object: string; name: string }[] = []): Plan[] {
  const role = game.roleId!; const plans: Plan[] = []; const everyone = guildId;
  const botOw = bot ? [ow(bot, 'member', ['view', 'send', 'history'])] : [];
  const lockedSend = (extra: Overwrite[] = []) => [ow(everyone, 'role', [], ['view']), ow(role, 'role', V, ['send']), ...extra, ...botOw];
  const label = `Night ${game.id}`;
  plans.push({ object: 'category', kind: 'category', parentObject: null, spec: { name: label, type: 'category', overwrites: [ow(everyone, 'role', [], ['view']), ow(role, 'role', ['view']), ...botOw] } });
  plans.push({ object: 'behind', kind: 'category', parentObject: null, spec: { name: `Behind you ${game.id}`, type: 'category', overwrites: [ow(everyone, 'role', [], ['view']), ow(role, 'role', ['view']), ...botOw] } });
  const started = game.status !== 'lobby';
  plans.push({ object: 'lobby', kind: 'lobby', parentObject: 'category', spec: { name: 'before-the-door', type: 'text', topic: 'Joining, choosing an investigator, importing a deck, second thoughts.',
    overwrites: started ? [ow(everyone, 'role', [], ['view', 'send']), ow(role, 'role', V, ['send']), ...botOw] : [ow(everyone, 'role', ['view', 'send', 'history']), ow(role, 'role', ['view', 'send', 'history']), ...botOw] } });
  plans.push({ object: 'talk', kind: 'talk', parentObject: 'category', spec: { name: 'table-talk', type: 'text', topic: 'Out of character: rules questions, lookups, scheduling.', overwrites: [ow(everyone, 'role', [], ['view']), ow(role, 'role', ['view', 'send', 'history']), ...botOw] } });
  plans.push({ object: 'hour', kind: 'tracker', parentObject: 'category', spec: { name: 'the-hour', type: 'text', topic: 'The night, and how late it is.', overwrites: lockedSend() } });
  plans.push({ object: 'trail', kind: 'tracker', parentObject: 'category', spec: { name: 'the-trail', type: 'text', topic: 'Where you are, what you are after, and the journal.', overwrites: lockedSend() } });
  for (const s of seats) {
    const inv = state?.investigators[s.seat];
    plans.push({ object: `seat:${s.seat}`, kind: 'personal', parentObject: 'category', spec: {
      name: slug(inv?.name ?? s.userName) + (seats.filter(x => x.investigator === s.investigator).length > 1 ? `-${s.seat}` : ''), type: 'text', topic: `${inv?.name ?? s.userName}: your hand, your things, your private questions.`,
      overwrites: [ow(everyone, 'role', [], ['view']), ow(role, 'role', [], ['view']), ow(s.userId, 'member', ['view', 'send', 'history']), ...botOw] } });
  }
  if (state && started) {
    for (const l of Object.values(state.locations)) {
      if (!l.inPlay || !l.revealed) continue;              // hidden places have no channel, so their names never leak
      const clean = l.clues === 0 && !!state.scenarioFlags[`clean:${l.id}`];
      const writers = archived ? [] : seats.filter(s => { const i = state.investigators[s.seat]; return i && i.status === 'active' && i.loc === l.id; });
      plans.push({ object: `loc:${l.id}`, kind: 'location', parentObject: clean ? 'behind' : 'category', spec: {
        name: slug(l.name) + (clean ? '-searched' : ''), type: 'text', topic: clean ? 'Nothing more to find.' : l.name,
        overwrites: lockedSend(writers.map(w => ow(w.userId, 'member', ['view', 'send', 'history']))) } });
    }
  }
  // a place that has left play (the Study once the house opens) keeps its channel, read-only, behind you
  for (const k of known) {
    if (!k.object.startsWith('loc:') || plans.some(p => p.object === k.object)) continue;
    plans.push({ object: k.object, kind: 'location', parentObject: 'behind', spec: { name: k.name, type: 'text', topic: 'Behind you.', overwrites: lockedSend() } });
  }
  if (archived) for (const p of plans) {
    p.spec.overwrites = p.spec.overwrites.filter(o => o.kind !== 'member' || o.id === bot).map(o => ({ ...o, deny: [...new Set([...o.deny, ...(o.id === bot ? [] : ['send' as Perm])])], allow: o.allow.filter(a => a !== 'send' || o.id === bot) }));
  }
  return plans;
}

const norm = (o: Overwrite[]) => JSON.stringify([...o].map(x => ({ ...x, allow: [...x.allow].sort(), deny: [...x.deny].sort() })).sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id)));

export interface SyncReport { created: string[]; edited: string[]; recreated: string[]; errors: string[] }

export async function syncChannels(d: SyncDeps, game: GameRow, seats: SeatRow[], state: GameState | null): Promise<SyncReport> {
  const { port, store } = d; const rep: SyncReport = { created: [], edited: [], recreated: [], errors: [] };
  const archived = game.status === 'archived' || game.status === 'ended';
  if (!game.roleId) { game.roleId = await port.createRole(game.guildId, `Night ${game.id}`); store.updateGame(game.id, { roleId: game.roleId }); }
  const plans = planChannels(game, seats, state, game.guildId, d.botUserId, archived, store.channels(game.id).map(c => ({ object: c.object, name: c.name })));
  const ids = new Map<string, string>();
  for (const p of plans) {
    try {
      const parent = p.parentObject ? ids.get(p.parentObject) ?? null : null;
      const saved = store.channel(game.id, p.object);
      let info: ChannelInfo | null = saved ? await port.getChannel(saved.discordId) : null;
      if (saved && !info) { store.dropChannel(game.id, p.object); rep.recreated.push(p.object); }
      if (!info) {
        const id = await port.createChannel(game.guildId, { ...p.spec, parent });
        store.setChannel(game.id, p.object, p.kind, id, p.spec.name); ids.set(p.object, id);
        if (!rep.recreated.includes(p.object)) rep.created.push(p.object);
        continue;
      }
      ids.set(p.object, info.id);
      const patch: Parameters<DiscordPort['editChannel']>[1] = {};
      if (info.name !== p.spec.name) patch.name = p.spec.name;
      if ((info.topic ?? '') !== (p.spec.topic ?? '') && p.spec.type === 'text') patch.topic = p.spec.topic ?? '';
      if ((info.parent ?? null) !== parent && p.spec.type === 'text') patch.parent = parent;
      if (norm(info.overwrites) !== norm(p.spec.overwrites)) patch.overwrites = p.spec.overwrites;
      if (Object.keys(patch).length) { await port.editChannel(info.id, patch); rep.edited.push(p.object); if (patch.name) store.setChannel(game.id, p.object, p.kind, info.id, p.spec.name); }
    } catch (e) { rep.errors.push(`${p.object}: ${(e as Error).message}`); }
  }
  // seat records learn their personal channel; the game learns its categories
  for (const s of seats) { const id = ids.get(`seat:${s.seat}`); if (id && s.personalChannel !== id) { s.personalChannel = id; store.upsertSeat(s); } }
  const cat = ids.get('category'); const behind = ids.get('behind');
  if (cat && game.categoryId !== cat) { game.categoryId = cat; store.updateGame(game.id, { categoryId: cat }); }
  if (behind && game.behindCategoryId !== behind) { game.behindCategoryId = behind; store.updateGame(game.id, { behindCategoryId: behind }); }
  if (archived && d.archiveCategoryId && cat) { try { await port.editChannel(cat, { parent: d.archiveCategoryId }); } catch (e) { rep.errors.push('archive: ' + (e as Error).message); } }
  // everyone who sits at the table holds the game role
  for (const s of seats) { try { await port.grantRole(game.guildId, s.userId, game.roleId); } catch (e) { rep.errors.push(`role ${s.userId}: ${(e as Error).message}`); } }
  return rep;
}
