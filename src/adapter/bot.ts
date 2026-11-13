// The router: Discord interactions in, kernel answers out. It holds no rules. It decides who is allowed to ask, turns taps and commands into
// one Answer each, and hands them to the game's host. Everything the player reads is in the fiction.
import type { Action, Answer, LegalOption } from '../kernel/types.ts';
import { sameAction } from '../kernel/legal.ts';
import { SUPPORTED_INVESTIGATORS } from '../kernel/scripts/player.ts';
import { STARTERS, validateDeck } from '../kernel/deck.ts';
import { applyUpgrade, upgradeOptions } from '../kernel/improve.ts';
import type { Incoming, MessageBody, Row, SelectOption } from './port.ts';
import { DEFAULT_SETTINGS, type GameRow, type SeatRow, type SeatSettings } from './store.ts';
import { GameHost, RETENTION_MS, type HostDeps } from './host.ts';
import { GLOSSARY } from './commands.ts';
import { loadDeck, type Fetcher } from './deckSource.ts';
import { caseBody, detailsBody, handMessage, mapBody, panelId, parseId, partyBody, scenePanel, selfBody } from './render.ts';
import { narrate } from './narration/engine.ts';
import { syncChannels } from './channels.ts';

export interface BotDeps extends HostDeps {
  hostRoleId?: string | null;
  fetcher?: Fetcher;
  random?: () => number;
  /** Two players may be the same investigator. Off by default: the five Core Set investigators are all playable now. */
  allowDuplicates?: boolean;
}

import { cardArt } from './art.ts';
import { momentsWord } from './narration/vocab.ts';
const NOT_THERE = 'You’re not there.';
const NOT_IN_STORY = 'You’re not part of this story.';
const PASSED = 'That moment has passed.';
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** An opaque id for an action, issued from the kernel's own list so a player can never submit something that was not legal. */
export function enc(a: Action): string {
  switch (a.type) {
    case 'move': return `move:${a.to}`;
    case 'play': return `play:${a.cardId}`;
    case 'fight': case 'evade': case 'engage': return `${a.type}:${a.enemyId}`;
    case 'activate': return `act:${a.cardId}|${a.abilityId}|${a.targetId ?? ''}`;
    case 'parley': return `parley:${a.targetId}`;
    default: return a.type;
  }
}

type Pred = (o: LegalOption) => boolean;
const FILTER: Record<string, Pred> = {
  pool: o => o.group === 'advance', search: o => o.group === 'investigate', rummage: o => o.group === 'draw', scrounge: o => o.group === 'resource', withdraw: o => o.group === 'resign',
  go: o => o.group === 'move',
  fight: o => o.group === 'fight' || (o.group === 'activate' && o.designator === 'fight'),
  slip: o => o.group === 'evade' || (o.group === 'activate' && o.designator === 'evade'),
  confront: o => o.group === 'engage',
  talk: o => o.designator === 'parley' || o.action.type === 'parley',
  play: o => o.group === 'play',
  use: o => o.group === 'activate' && !['fight', 'evade', 'parley'].includes(o.designator ?? ''),
};
const ARG_OPTION: Record<string, string> = { go: 'place', fight: 'enemy', slip: 'enemy', confront: 'enemy', talk: 'who', play: 'card', use: 'thing' };
const VERB_OF_PANEL: Record<string, string> = { pool: 'pool', search: 'search', go: 'go', fight: 'fight', slip: 'slip', talk: 'talk', rummage: 'rummage', scrounge: 'scrounge', play: 'play', use: 'use' };

interface Confirm { gameId: string; seat: string; action: Action; how?: string; label: string; expires: number }

export class Bot {
  d: BotDeps; hosts = new Map<string, GameHost>();
  private confirms = new Map<string, Confirm>();
  constructor(d: BotDeps) { this.d = d; }
  private now() { return this.d.now(); }
  private rand() { return (this.d.random ?? Math.random)(); }

  // ───────────────────────────────────────────────────────────────────── startup, timers, retention
  async boot(): Promise<void> {
    for (const g of this.d.store.listGames()) {
      if (g.status === 'archived' && !g.archiveAt) continue;
      const h = this.hostFor(g.id); h.load();
      try { await h.resync(); } catch (e) { h.errors.push('boot: ' + (e as Error).message); }
    }
  }
  hostFor(gameId: string): GameHost {
    let h = this.hosts.get(gameId);
    if (!h) { h = new GameHost(this.d, gameId); this.hosts.set(gameId, h); if (!h.state && this.d.store.getGame(gameId)?.status !== 'lobby') h.load(); }
    return h;
  }
  /** Poll once: run due timers, then the retention job. Safe to call as often as you like. */
  async tick(): Promise<void> {
    const now = this.now();
    for (const t of this.d.store.dueTimers(now)) {
      const g = this.d.store.getGame(t.gameId); if (!g || g.status !== 'active') { this.d.store.deleteTimer(t.gameId, t.decisionId); continue; }
      await this.hostFor(t.gameId).handleTimer(t);
    }
    for (const g of this.d.store.listGames()) if ((g.status === 'ended' || g.status === 'archived') && g.archiveAt && g.archiveAt <= now) await this.purge(g.id);
  }
  /** After the retention period: personal channels first (they hold hands), then the rest, then the role. The log stays. */
  async purge(gameId: string): Promise<void> {
    const store = this.d.store; const g = store.getGame(gameId); if (!g) return;
    const chans = store.channels(gameId); const order = [...chans.filter(c => c.kind === 'personal'), ...chans.filter(c => c.kind !== 'personal' && c.kind !== 'category'), ...chans.filter(c => c.kind === 'category')];
    for (const c of order) { try { await this.d.port.deleteChannel(c.discordId); } catch { /* already gone */ } store.dropChannel(gameId, c.object); }
    if (g.roleId) { try { await this.d.port.deleteRole(g.guildId, g.roleId); } catch { /* already gone */ } }
    store.updateGame(gameId, { status: 'archived', archiveAt: null, roleId: null });
    this.hosts.delete(gameId);
  }
  /** Delete the channels of stories in this guild that are already over, so a new story starts clean. The logs stay. */
  private async cleanupOlderGames(guildId: string): Promise<number> {
    let n = 0;
    for (const g of this.d.store.listGames()) {
      if (g.guildId !== guildId || (g.status !== 'ended' && g.status !== 'archived')) continue;
      if (this.d.store.channels(g.id).length === 0 && !g.roleId) continue; // already cleared earlier: nothing to do, nothing to report
      await this.purge(g.id); n++;
    }
    return n;
  }

  // ───────────────────────────────────────────────────────────────────── entry point
  async handle(i: Incoming): Promise<void> {
    if (i.kind !== 'autocomplete' && this.d.store.seen(i.id, this.now())) return;
    try {
      if (i.kind === 'autocomplete') return await this.autocomplete(i);
      if (i.kind === 'command') return await this.command(i);
      if (i.kind === 'modal') return await this.modal(i);
      return await this.component(i);
    } catch (e) {
      try { await i.reply({ content: 'Something went wrong in the house. Try again in a moment.', ephemeral: true }); } catch { /* the interaction may have expired */ }
      this.d.store.setKv('_bot', 'lastError', String((e as Error).stack ?? e));
    }
  }

  private async say(i: Incoming, text: string) { await i.reply({ content: text, ephemeral: true }); }

  /** Find the game a channel belongs to, and the seat the user holds in it. */
  private ctx(i: Incoming) {
    const owner = this.d.store.channelOwner(i.channelId);
    const game = owner ? this.d.store.getGame(owner.gameId) : this.d.store.gameForGuildLobby(i.guildId);
    if (!game) return null;
    const host = this.hostFor(game.id);
    return { host, game, seat: host.seatFor(i.userId), owner };
  }

  private isHost(i: Incoming, g: GameRow | null) {
    return i.isAdmin === true || (!!g && g.hostUserId === i.userId) || (!!this.d.hostRoleId && !!i.roles?.includes(this.d.hostRoleId));
  }

  // ───────────────────────────────────────────────────────────────────── commands
  private async command(i: Incoming): Promise<void> {
    const name = i.command!;
    if (name === 'host') return this.hostCommand(i);
    if (name === 'join') return this.join(i);
    if (name === 'card' || name === 'rules') return this.lookup(i);
    const c = this.ctx(i);
    if (!c || !c.seat) return this.say(i, c?.game.status === 'lobby' && name !== 'ready' ? 'Take a seat first: /join.' : NOT_IN_STORY);
    switch (name) {
      case 'deck': return this.deckImport(i, c.host, c.seat);
      case 'ready': return this.ready(i, c.host, c.seat);
      case 'leave': return this.leave(i, c.host, c.seat);
      case 'settings': return this.settings(i, c.host, c.seat);
      case 'improve': return this.improve(i, c.host, c.seat);
    }
    if (c.game.status === 'lobby') return this.say(i, 'The story has not begun yet. When everyone is ready, it starts.');
    const st = c.host.state; if (!st) return this.say(i, 'The story has not begun yet.');
    switch (name) {
      case 'look': { const v = c.host.viewFor(c.seat.seat); const p = scenePanel({ game: c.game.id, v, loc: v.me!.loc, mode: c.seat.settings.immersion, text: c.host.text }); return void await i.reply({ ...p, rows: [], ephemeral: true }); }
      case 'self': return void await i.reply(selfBody(c.host.viewFor(c.seat.seat), c.seat.settings.immersion));
      case 'party': return void await i.reply(partyBody(c.host.viewFor(c.seat.seat)));
      case 'case': return void await i.reply(caseBody(c.host.viewFor(c.seat.seat), c.host.text, c.seat.settings.immersion));
      case 'map': return void await i.reply(mapBody(c.host.viewFor(c.seat.seat)));
      case 'bag': {
        if (c.seat.settings.immersion !== 'math') return this.say(i, 'Your hand finds what it finds.');
        const v = c.host.viewFor(c.seat.seat);
        return this.say(i, '```\n' + Object.entries(v.bag).map(([k, n]) => `${k}: ${n}`).join('\n') + `\n(${v.bagSize} in all)\n` + '```');
      }
      case 'hand': {
        const sv = c.host.viewFor(c.seat.seat); const legal = c.host.legalFor(c.seat.seat);
        const ch = c.seat.personalChannel; if (!ch) return this.say(i, 'Your channel is not ready yet.');
        this.d.store.dropMessage(c.game.id, `hand:${c.seat.seat}`);
        await c.host.upsert(`hand:${c.seat.seat}`, ch, handMessage(c.game.id, sv, legal, c.seat.settings.immersion));
        return this.say(i, 'Done. It is in your own channel.');
      }
      case 'journal': return this.journal(i, c.host, c.seat, String(i.options.span ?? 'since you left'));
      case 'step-forward': return this.stepForward(i, c.host, c.seat, c.owner);
      case 'done': return this.done(i, c.host, c.seat, c.owner);
      case 'hold': return this.hold(i, c.host, c.seat, String(i.options.reason ?? ''));
    }
    if (!FILTER[name]) return this.say(i, 'The house does not know that word.');
    // acting commands: accepted in your current place or your own private channel; anywhere else the answer is in the fiction
    const where = this.where(c.host, c.seat, c.owner); if (where) return this.say(i, where);
    await i.defer();
    return this.act(i, c.host, c.seat, name, i.options[ARG_OPTION[name] ?? ''] as string | undefined, i.options.how as string | undefined);
  }

  /** Is the user speaking from somewhere they may act from? Returns a line in the fiction when not. */
  private where(host: GameHost, seat: SeatRow, owner: { object: string; kind: string } | null): string | null {
    const st = host.state!; const inv = st.investigators[seat.seat]; if (!inv) return NOT_IN_STORY;
    if (!owner) return NOT_THERE;
    if (owner.kind === 'personal') return owner.object === `seat:${seat.seat}` ? null : 'That is someone else’s private place.';
    if (owner.kind === 'location') return owner.object === `loc:${inv.loc}` ? null : NOT_THERE;
    return 'Not here. Go back to where you are standing.';
  }

  private gate(host: GameHost, seat: SeatRow): string | null {
    const st = host.state!; const p = st.pending; const inv = st.investigators[seat.seat];
    if (st.ended) return 'The story is over.';
    if (!inv || inv.status !== 'active') return 'You are not in this any more.';
    if (!p) return 'Nothing is waiting on anyone.';
    if (p.kind === 'spotlight') return p.seats.includes(seat.seat) ? 'The floor is open. Step forward first.' : 'It is not your moment.';
    if (p.kind === 'turn') return p.seat === seat.seat ? null : `It is ${st.investigators[p.seat]?.name ?? 'someone else'}’s turn.`;
    return 'Something has to be settled first.';
  }

  private takeHow(host: GameHost, seat: string, given?: string): string | undefined {
    const kv = host.d.store.getKv<{ text: string; exp: number }>(host.gameId, `how:${seat}`);
    const text = given?.trim() || (kv && kv.exp > this.now() ? kv.text : '');
    if (kv) host.d.store.setKv(host.gameId, `how:${seat}`, null);
    return text ? text.slice(0, 300) : undefined;
  }

  private async act(i: Incoming, host: GameHost, seat: SeatRow, verb: string, arg: string | undefined, how: string | undefined): Promise<void> {
    const g = this.gate(host, seat); if (g) return this.say(i, g);
    const legal = host.legalFor(seat.seat).filter(FILTER[verb]!);
    let pick: LegalOption | undefined;
    if (!ARG_OPTION[verb]) pick = legal[0];
    else pick = legal.find(o => enc(o.action) === arg);
    if (!pick) {
      const left = host.state?.pending?.kind === 'turn' && host.state.pending.seat === seat.seat ? host.state.pending.actionsLeft : null;
      if (left === 0 && ['search', 'go', 'fight', 'slip', 'confront', 'rummage', 'scrounge', 'talk'].includes(verb)) return this.say(i, 'No moments left this turn. Press Done to hand the floor on.');
      return this.say(i, !ARG_OPTION[verb] ? 'That is not possible right now.' : 'That is not an option from here.');
    }
    return this.perform(i, host, seat, pick, how);
  }

  private async perform(i: Incoming, host: GameHost, seat: SeatRow, pick: LegalOption, howGiven?: string): Promise<void> {
    const how = this.takeHow(host, seat.seat, howGiven);
    if (pick.needsConfirm && seat.settings.confirm) {
      const token = Math.floor(this.rand() * 36 ** 6).toString(36);
      this.confirms.set(token, { gameId: host.gameId, seat: seat.seat, action: pick.action, how, label: pick.label, expires: this.now() + 5 * 60_000 });
      return void await i.reply({ ephemeral: true, content: `${pick.label} — ${pick.cost}. Are you sure?`, rows: [{ buttons: [{ id: `a1:${host.gameId}:${token}:ok`, label: 'Confirm', style: 'danger' }, { id: `a1:${host.gameId}:${token}:no`, label: 'Cancel' }] }] });
    }
    return this.submitAction(i, host, seat, pick, how);
  }

  private async submitAction(i: Incoming, host: GameHost, seat: SeatRow, pick: LegalOption, how?: string): Promise<void> {
    const p = host.state?.pending;
    if (!p || p.kind !== 'turn') return this.say(i, PASSED);
    const r = await host.submit({ seat: seat.seat, kind: 'action', action: pick.action, decisionId: p.id, ...(how ? { how } : {}) });
    const after = host.state?.pending;
    const rest = r.ok && pick.cost !== 'free' && after?.kind === 'turn' && after.seat === seat.seat ? ` ${momentsWord(after.actionsLeft)[0]!.toUpperCase()}${momentsWord(after.actionsLeft).slice(1)}.` : '';
    return this.say(i, r.ok ? `${pick.label}. ${pick.cost === 'free' ? 'No time taken.' : `It takes ${pick.cost}.`}${rest}` : r.message ?? 'That is not possible right now.');
  }

  private async stepForward(i: Incoming, host: GameHost, seat: SeatRow, owner: { object: string; kind: string } | null): Promise<void> {
    const w = this.where(host, seat, owner); if (w) return this.say(i, w);
    await i.defer(); const p = host.state?.pending;
    if (!p || p.kind !== 'spotlight') return this.say(i, p ? 'Someone else has the floor.' : 'Nothing is waiting on anyone.');
    const r = await host.submit({ seat: seat.seat, kind: 'stepForward', decisionId: p.id });
    if (r.ok) { const ch = host.chan(`loc:${host.state!.investigators[seat.seat]!.loc}`); if (ch) await this.d.port.send(ch, { content: `*${host.state!.investigators[seat.seat]!.name} steps forward.*`, narrator: true }); }
    return this.say(i, r.ok ? 'You have the floor.' : r.message ?? 'Someone else has the floor.');
  }

  private async done(i: Incoming, host: GameHost, seat: SeatRow, owner: { object: string; kind: string } | null): Promise<void> {
    const w = this.where(host, seat, owner); if (w) return this.say(i, w);
    await i.defer(); const g = this.gate(host, seat); if (g) return this.say(i, g);
    const p = host.state!.pending!;
    const r = await host.submit({ seat: seat.seat, kind: 'done', decisionId: p.id });
    return this.say(i, r.ok ? 'That is all for now.' : r.message ?? PASSED);
  }

  private async hold(i: Incoming, host: GameHost, seat: SeatRow, reason: string): Promise<void> {
    host.d.store.setKv(host.gameId, 'holdUntil', this.now() + 30 * 60_000);
    const st = host.state; const inv = st?.investigators[seat.seat];
    const ch = inv ? host.chan(`loc:${inv.loc}`) : null;
    if (ch) await this.d.port.send(ch, { content: `*${inv!.name} asks the table for a moment.${reason ? ` “${reason.replace(/[`*_~|>\\@<]/g, '').slice(0, 200)}”` : ''}*`, narrator: true });
    return this.say(i, 'The clock waits for half an hour.');
  }

  private async journal(i: Incoming, host: GameHost, seat: SeatRow, span: string): Promise<void> {
    const st = host.state!; const store = host.d.store;
    const seen = store.getKv<number>(host.gameId, `seen:${seat.seat}`) ?? 0;
    const steps = store.steps(host.gameId, span === 'since you left' ? seen : 0);
    const lines: string[] = [];
    for (const s of steps) for (const n of narrate(s.events, { state: st, version: s.ver, gameId: host.gameId, pack: host.packs })) if (n.text) lines.push(n.text);
    store.setKv(host.gameId, `seen:${seat.seat}`, st.version);
    const mine = store.getKv<string>(host.gameId, `journal:${seat.seat}`);
    const body = (lines.slice(-18).join('\n') || 'Nothing new.') + (mine ? `\n\n${mine}` : '');
    return void await i.reply({ ephemeral: true, embeds: [{ title: span === 'since you left' ? 'While you were away' : 'The story so far', description: trunc(body, 3900) }] });
  }

  // ───────────────────────────────────────────────────────────────────── lookups and autocomplete
  private async lookup(i: Incoming): Promise<void> {
    if (i.command === 'rules') {
      const key = String(i.options.phrase ?? '').toLowerCase().trim(); const hit = GLOSSARY[key] ?? Object.entries(GLOSSARY).find(([k]) => key.includes(k) || k.includes(key))?.[1];
      return this.say(i, hit ?? 'The house has no word for that.');
    }
    const c = this.d.E.cat.byName(String(i.options.name ?? ''));
    if (!c) return this.say(i, 'No such card.');
    return void await i.reply({ ephemeral: true, embeds: [{ title: c.title, image: cardArt(c.code), description: trunc(c.textRaw || '—', 3500), fields: [{ name: 'Type', value: c.type, inline: true }, ...(typeof c.cost === 'number' ? [{ name: 'Cost', value: String(c.cost), inline: true }] : [])] }] });
  }

  private async autocomplete(i: Incoming): Promise<void> {
    const f = i.focused; if (!f) return void await i.choices([]);
    const q = f.value.toLowerCase();
    if (i.command === 'card') return void await i.choices(this.d.E.cat.all().filter(c => c.type !== 'investigator' && c.title.toLowerCase().includes(q)).map(c => c.title).filter((t, n, a) => a.indexOf(t) === n).slice(0, 25).map(t => ({ name: trunc(t, 100), value: trunc(t, 100) })));
    if (i.command === 'rules') return void await i.choices(Object.keys(GLOSSARY).filter(k => k.includes(q)).slice(0, 25).map(k => ({ name: k, value: k })));
    const c = this.ctx(i); const pred = FILTER[i.command ?? ''];
    if (!c || !c.seat || !pred || !c.host.state || this.where(c.host, c.seat, c.owner)) return void await i.choices([]);
    const seen = new Map<string, number>();
    const out = c.host.legalFor(c.seat.seat).filter(pred).map(o => {
      const base = trunc(`${o.label} · ${o.cost}`, 92); const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
      return { name: n > 1 ? `${base} (${n})` : base, value: enc(o.action) };
    }).filter(o => o.name.toLowerCase().includes(q)).slice(0, 25);
    return void await i.choices(out);
  }

  // ───────────────────────────────────────────────────────────────────── lobby
  private async hostCommand(i: Incoming): Promise<void> {
    const sub = i.sub!; const store = this.d.store;
    if (sub === 'new') {
      if (!this.isHost(i, null)) return this.say(i, 'Only the host can open a story.');
      if (store.gameForGuildLobby(i.guildId)) return this.say(i, 'A story is already open here.');
      await i.defer();
      const cleaned = await this.cleanupOlderGames(i.guildId);
      const id = Math.floor(this.rand() * 36 ** 4).toString(36).padStart(4, '0');
      const g: GameRow = { id, guildId: i.guildId, scenario: String(i.options.scenario ?? 'gathering'), seed: 0, difficulty: String(i.options.difficulty ?? 'standard'), status: 'lobby', pace: (i.options.pace === 'live' ? 'live' : 'slow'), hostUserId: i.userId, roleId: null, categoryId: null, behindCategoryId: null, archiveAt: null, paused: false, version: 0 };
      store.createGame(g);
      const host = this.hostFor(id); await host.resync();
      const lobby = host.chan('lobby');
      if (lobby) await host.upsert('lobby', lobby, { embeds: [{ title: 'Before the door', description: 'Take a seat, choose who you are, bring a deck, and say when you are ready. The story starts when everyone is.' }], rows: [{ buttons: [{ id: `m1:${id}:joinbtn`, label: 'Take a seat', style: 'primary' }] }] }, true);
      try { await this.d.port.grantRole(i.guildId, i.userId, host.game.roleId!); } catch { /* host may be an admin who sees everything anyway */ }
      return this.say(i, cleaned
        ? `The door is open. The channels of ${cleaned} finished ${cleaned === 1 ? 'story' : 'stories'} were cleared. Everyone who wants a seat can find it in #before-the-door.`
        : 'The door is open. Everyone who wants a seat can find it in #before-the-door.');
    }
    const c = this.ctx(i); if (!c) return this.say(i, 'No story is open here.');
    if (!this.isHost(i, c.game)) return this.say(i, 'That is for the host.');
    const host = c.host; await i.defer();
    switch (sub) {
      case 'start': { const r = await this.tryStart(host, true); return this.say(i, r.ok ? 'The story begins.' : r.message ?? 'It cannot begin yet.'); }
      case 'pause': this.d.store.updateGame(c.game.id, { paused: true }); return this.say(i, 'Paused. Timers will wait.');
      case 'resume': this.d.store.updateGame(c.game.id, { paused: false }); return this.say(i, 'Resumed.');
      case 'resync': { const r = await host.resync(); return this.say(i, `Repaired. Created ${r.created.length}, recreated ${r.recreated.length}, edited ${r.edited.length}${r.errors.length ? `, problems: ${r.errors.slice(0, 3).join('; ')}` : ''}.`); }
      case 'check': {
        const missing = this.d.port.missingPermissions ? await this.d.port.missingPermissions(c.game.guildId) : [];
        return this.say(i, `${missing.length ? `Missing permissions: ${missing.join(', ')}.` : 'Permissions look fine.'}\nRecent problems: ${host.errors.slice(-5).join(' | ') || 'none'}`);
      }
      case 'away': {
        const uid = String(i.options.user ?? ''); const s = host.seatFor(uid); if (!s) return this.say(i, 'No one at the table by that name.');
        s.away = !s.away; this.d.store.upsertSeat(s);
        await host.enqueue(async () => { await host.autoAway(); });
        return this.say(i, s.away ? 'Marked away. Their turns will pass.' : 'Welcome back.');
      }
      case 'swap': {
        const s = host.seats.find(x => x.seat === String(i.options.seat)); const uid = String(i.options.user ?? ''); if (!s || !uid) return this.say(i, 'Give a seat id and a player.');
        s.userId = uid; s.userName = uid; this.d.store.upsertSeat(s); await host.resync(); return this.say(i, 'The seat has a new occupant.');
      }
      case 'end': {
        await host.enqueue(async () => { this.d.store.updateGame(c.game.id, { status: 'archived', archiveAt: this.now() + RETENTION_MS }); await syncChannels({ port: this.d.port, store: this.d.store, botUserId: this.d.botUserId, archiveCategoryId: this.d.archiveCategoryId }, host.game, host.seats, host.state); this.d.store.clearTimers(c.game.id); });
        return this.say(i, 'The story is archived.');
      }
    }
    return this.say(i, 'Unknown host command.');
  }

  private async join(i: Incoming): Promise<void> {
    const g = this.d.store.gameForGuildLobby(i.guildId);
    if (!g || g.status !== 'lobby') return this.say(i, 'There is no open door right now.');
    return this.showJoin(i, g.id);
  }
  private async showJoin(i: Incoming, gameId: string): Promise<void> {
    const opts: SelectOption[] = SUPPORTED_INVESTIGATORS.map(code => ({ value: code, label: this.d.E.cat.get(code).title }));
    return void await i.reply({ ephemeral: true, content: 'Who are you?', rows: [{ select: { id: `m1:${gameId}:join`, placeholder: 'Choose an investigator…', options: opts, min: 1, max: 1 } }] });
  }

  private async deckImport(i: Incoming, host: GameHost, seat: SeatRow): Promise<void> {
    if (host.game.status !== 'lobby') return this.say(i, 'Decks are settled before the story begins.');
    await i.defer();
    const fetcher: Fetcher = this.d.fetcher ?? (async (url: string) => fetch(url));
    const r = await loadDeck(String(i.options.source ?? ''), fetcher);
    if (!r.deck) return this.say(i, r.error ?? 'I could not read that deck.');
    if (r.deck.investigator !== seat.investigator) return this.say(i, `That deck belongs to ${this.d.E.cat.has(r.deck.investigator) ? this.d.E.cat.get(r.deck.investigator).title : 'someone else'}, not ${this.d.E.cat.get(seat.investigator).title}.`);
    return this.acceptDeck(i, host, seat, r.deck.codes);
  }
  private async acceptDeck(i: Incoming, host: GameHost, seat: SeatRow, codes: string[]): Promise<void> {
    const rep = validateDeck(this.d.E.cat, this.d.E.reg, seat.investigator, codes);
    if (!rep.ok) return this.say(i, [...rep.errors, ...rep.warnings].slice(0, 12).join('\n'));
    seat.deck = codes; seat.deckOk = true; this.d.store.upsertSeat(seat);
    return this.say(i, `That deck is good: ${rep.count} cards. Say /ready when you are set.`);
  }

  private async ready(i: Incoming, host: GameHost, seat: SeatRow): Promise<void> {
    if (host.game.status !== 'lobby') return this.say(i, 'The story has already begun.');
    if (!seat.deckOk) return this.say(i, 'Bring a deck first: /deck import, or take the starter from the door.');
    seat.ready = true; this.d.store.upsertSeat(seat);
    await i.defer(); const r = await this.tryStart(host, false);
    return this.say(i, r.ok ? 'Everyone is set. The story begins.' : 'You are set. Waiting on the others.');
  }

  /** Start when every seat is ready (or the host forces it). */
  private async tryStart(host: GameHost, force: boolean) {
    const seats = host.seats;
    if (!seats.length) return { ok: false, message: 'No one has taken a seat.' };
    if (!seats.every(s => s.deckOk)) return { ok: false, message: 'Someone still needs a deck.' };
    if (!force && seats.length < 2) return { ok: false, message: 'Waiting for company. The host can start it alone with /host start.' };
    if (!force && !seats.every(s => s.ready)) return { ok: false, message: 'Not everyone is ready.' };
    return host.startGame(Math.floor(this.rand() * 2 ** 31));
  }

  private async leave(i: Incoming, host: GameHost, seat: SeatRow): Promise<void> {
    if (host.game.status === 'lobby') { this.d.store.removeSeat(host.gameId, seat.seat); return this.say(i, 'You have left the table.'); }
    seat.away = true; this.d.store.upsertSeat(seat);
    const talk = host.chan('talk'); if (talk) await this.d.port.send(talk, { content: `${seat.userName} has stepped away from the table. The host decides what happens to their investigator.` });
    await host.enqueue(async () => { await host.autoAway(); });
    return this.say(i, 'You are marked away. The host will decide what happens next.');
  }

  private async settings(i: Incoming, host: GameHost, seat: SeatRow): Promise<void> {
    const s: SeatSettings = { ...DEFAULT_SETTINGS, ...seat.settings };
    if (i.options.immersion) s.immersion = i.options.immersion as SeatSettings['immersion'];
    if (i.options.pings) s.pings = String(i.options.pings).startsWith('also') ? 'turns' : 'decide';
    if (i.options.voice) s.voice = i.options.voice === 'on';
    if (i.options.confirm) s.confirm = i.options.confirm === 'yes';
    seat.settings = s; this.d.store.upsertSeat(seat);
    return this.say(i, `Saved. ${s.immersion === 'story' ? 'Story only.' : s.immersion === 'math' ? 'Showing the math.' : 'Balanced.'} ${s.pings === 'turns' ? 'You will hear about your turns too.' : 'You will only hear when you must decide.'}`);
  }

  private async improve(i: Incoming, host: GameHost, seat: SeatRow): Promise<void> {
    const saved = this.d.store.getKv<{ investigator: string; deck: string[]; xp: number }>('_user:' + seat.userId, 'xp');
    if (!saved || saved.xp <= 0) return this.say(i, host.game.status === 'lobby' || host.game.status === 'active' ? 'Not yet. Finish the night first.' : 'You have nothing to spend.');
    const opts = upgradeOptions(this.d.E.cat, this.d.E.reg, saved.investigator, saved.deck, saved.xp);
    if (!opts.length) return this.say(i, `You are carrying ${saved.xp} experience, and nothing you can use is within reach yet.`);
    const sel: SelectOption[] = opts.slice(0, 25).map(o => ({ value: o.add, label: trunc(`${o.title} (level ${o.level})`, 100), description: `${o.cost} experience${o.sameTitle ? ', replaces the lesser copy' : ''}` }));
    return void await i.reply({ ephemeral: true, content: `You carry ${saved.xp} experience. What do you take on?`, rows: [{ select: { id: `m1:${host.gameId}:impadd`, placeholder: 'Choose a card…', options: sel, min: 1, max: 1 } }] });
  }

  // ───────────────────────────────────────────────────────────────────── components
  private async modal(i: Incoming): Promise<void> {
    const id = parseId(i.customId ?? ''); if (!id || id.family !== 'm1' || id.a !== 'how') return;
    const host = this.hosts.get(id.game) ?? this.hostFor(id.game); const seat = host.seatFor(i.userId);
    if (!seat) return this.say(i, NOT_IN_STORY);
    const text = String(i.modalValues?.how ?? '').trim().slice(0, 300);
    host.d.store.setKv(host.gameId, `how:${seat.seat}`, { text, exp: this.now() + 120_000 });
    return this.say(i, text ? 'Noted. It will go with your next move.' : 'Cleared.');
  }

  private async component(i: Incoming): Promise<void> {
    const id = parseId(i.customId ?? ''); if (!id) return this.say(i, PASSED);
    const store = this.d.store; const game = store.getGame(id.game);
    if (!game || game.guildId !== i.guildId) return this.say(i, PASSED);
    const host = this.hostFor(id.game); const seat = host.seatFor(i.userId);
    if (id.family === 'x1') {
      const row = store.step(id.game, Number(id.a)); if (!row) return this.say(i, PASSED);
      const ev = row.events[Number(id.b)]; if (!ev) return this.say(i, PASSED);
      // the test's own record: everything the step logged for this seat's test, so nothing is invented
      return void await i.reply(detailsBody(row.events.filter((e, n) => n <= Number(id.b) && ['action', 'testStarted', 'committed', 'tokenRevealed', 'testResolved'].includes(e.kind) || n === Number(id.b))));
    }
    if (id.family === 'm1') return this.lobbyComponent(i, id, host, seat);
    if (!seat) return this.say(i, NOT_IN_STORY);
    if (id.family === 'a1') {
      const c = this.confirms.get(id.a); this.confirms.delete(id.a);
      if (!c || c.expires < this.now() || c.seat !== seat.seat || c.gameId !== host.gameId || id.b !== 'ok') return this.say(i, id.b === 'no' ? 'Left as it was.' : PASSED);
      await i.defer({ update: true });
      const legal = host.legalFor(seat.seat).find(o => sameAction(o.action, c.action));
      return legal ? this.submitAction(i, host, seat, legal, c.how) : this.say(i, PASSED);
    }
    if (id.family === 'p1') return this.panel(i, id.a, host, seat);
    return this.decision(i, id.a, id.b, host, seat);
  }

  private async panel(i: Incoming, verb: string, host: GameHost, seat: SeatRow): Promise<void> {
    if (host.game.status !== 'active' || !host.state) return this.say(i, 'The story has not begun yet.');
    const owner = this.d.store.channelOwner(i.channelId);
    switch (verb) {
      case 'self': return void await i.reply(selfBody(host.viewFor(seat.seat), seat.settings.immersion));
      case 'looksel': {
        const me = host.viewFor(seat.seat).me; const c = [...(me?.hand ?? []), ...(me?.inPlay ?? [])].find(x => x.id === (i.values?.[0] ?? ''));
        const art = cardArt(c?.code);
        return void await i.reply(c && art ? { ephemeral: true, embeds: [{ title: c.name, image: art }] } : { ephemeral: true, content: 'You cannot make that one out.' });
      }
      case 'journal': return this.journal(i, host, seat, 'since you left');
      case 'settings': return this.say(i, 'Use /settings to change how much you see and when you are pinged.');
      case 'say': return void await i.showModal({ id: `m1:${host.gameId}:how`, title: 'Say how', inputs: [{ id: 'how', label: 'How do you do it?', max: 300, required: false }] });
      case 'hold': return this.hold(i, host, seat, '');
      case 'step': return this.stepForward(i, host, seat, owner);
      case 'done': return this.done(i, host, seat, owner);
    }
    const w = this.where(host, seat, owner); if (w) return this.say(i, w);
    // selects coming back from an argument menu
    const selMatch = verb.match(/^(\w+)sel$/);
    if (selMatch) {
      await i.defer({ update: true }); const v = selMatch[1]!;
      const gate = this.gate(host, seat); if (gate) return this.say(i, gate);
      if (v === 'play' || v === 'use') {
        const value = i.values?.[0] ?? '';
        const pick = v === 'play' ? host.legalFor(seat.seat).find(o => o.action.type === 'play' && (o.action as { cardId: string }).cardId === value)
          : host.legalFor(seat.seat).find(o => o.action.type === 'activate' && [(o.action as { cardId: string }).cardId, (o.action as { abilityId: string }).abilityId, (o.action as { targetId?: string }).targetId ?? ''].join('|') === value);
        return pick ? this.perform(i, host, seat, pick) : this.say(i, 'That is not possible right now.');
      }
      const pick = host.legalFor(seat.seat).filter(FILTER[v] ?? (() => false)).find(o => enc(o.action) === (i.values?.[0] ?? ''));
      return pick ? this.perform(i, host, seat, pick) : this.say(i, 'That is not possible right now.');
    }
    const key = VERB_OF_PANEL[verb]; if (!key) return this.say(i, PASSED);
    await i.defer(); const gate = this.gate(host, seat); if (gate) return this.say(i, gate);
    const legal = host.legalFor(seat.seat).filter(FILTER[key]!);
    if (!legal.length) return this.say(i, key === 'go' ? 'There is nowhere to go from here.' : 'There is nothing like that to do right now.');
    if (!ARG_OPTION[key]) return this.perform(i, host, seat, legal[0]!);
    if (legal.length === 1 && key !== 'play' && key !== 'use') return this.perform(i, host, seat, legal[0]!);
    const seen = new Map<string, number>();
    const options: SelectOption[] = legal.slice(0, 25).map(o => {
      const base = trunc(o.label, 92); const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
      const value = o.action.type === 'activate' && (key === 'use') ? [o.action.cardId, o.action.abilityId, o.action.targetId ?? ''].join('|') : o.action.type === 'play' ? o.action.cardId : enc(o.action);
      return { value, label: n > 1 ? `${base} (${n})` : base, description: trunc(o.cost, 100) };
    });
    const rows: Row[] = [{ select: { id: panelId(host.gameId, `${key}sel` as never), placeholder: 'Choose…', options, min: 1, max: 1 } }];
    return void await i.reply({ ephemeral: true, content: 'Which?', rows });
  }

  private async decision(i: Incoming, did: string, choice: string, host: GameHost, seat: SeatRow): Promise<void> {
    const st = host.state; const p = st?.pending;
    if (!st || !p || p.id !== did) return this.say(i, PASSED);
    const addressed = p.kind === 'spotlight' ? p.seats.includes(seat.seat) : p.seat === seat.seat;
    if (!addressed) return this.say(i, 'That is not yours to answer.');
    const base = { seat: seat.seat, decisionId: did } as const;
    let a: Answer | null = null;
    const vals = i.values ?? [];
    switch (p.kind) {
      case 'spotlight': if (choice === 'step') a = { ...base, kind: 'stepForward' }; break;
      case 'reveal': if (choice === 'reveal') a = { ...base, kind: 'reveal' }; break;
      case 'reaction':
        if (choice === 'pass') a = { ...base, kind: 'react', optionId: null };
        else if (choice.startsWith('r:')) a = { ...base, kind: 'react', optionId: choice.slice(2) };
        break;
      case 'commit':
        if (choice === 'sel') { await i.defer({ update: true }); await host.setSelection(did, vals); return; }
        if (choice === 'lend') a = { ...base, kind: 'commit', cards: host.selection(did) };
        else if (choice === 'none') a = { ...base, kind: 'commit', cards: [] };
        else if (choice.startsWith('ab:')) { const [cardId, ...rest] = choice.slice(3).split(':'); a = { ...base, kind: 'useAbility', cardId: cardId!, abilityId: rest.join(':') }; }
        break;
      case 'choose':
        if (choice.startsWith('o:')) a = { ...base, kind: 'choose', optionIds: [choice.slice(2)] };
        else if (choice === 'sel') {
          if (p.max === 1 && p.min === 1) a = { ...base, kind: 'choose', optionIds: vals.slice(0, 1) };
          else { await i.defer({ update: true }); await host.setSelection(did, vals); return; }
        } else if (choice === 'ok') a = { ...base, kind: 'choose', optionIds: host.selection(did) };
        break;
      case 'mulligan':
        if (choice === 'sel') { await i.defer({ update: true }); await host.setSelection(did, vals); return; }
        if (choice === 'swap') a = { ...base, kind: 'mulligan', cards: host.selection(did) };
        else if (choice === 'keep') a = { ...base, kind: 'mulligan', cards: [] };
        break;
      default: break;
    }
    if (!a) return this.say(i, PASSED);
    await i.defer({ update: true });
    const r = await host.submit(a);
    if (!r.ok) return this.say(i, r.code === 'stale' ? PASSED : r.message ?? PASSED);
  }

  private async lobbyComponent(i: Incoming, id: { a: string; b: string; game: string }, host: GameHost, seat: SeatRow | null): Promise<void> {
    const store = this.d.store; const g = host.game;
    if (id.a === 'joinbtn') return g.status === 'lobby' ? this.showJoin(i, g.id) : this.say(i, 'The story has already begun.');
    if (id.a === 'join') {
      if (g.status !== 'lobby') return this.say(i, 'The story has already begun.');
      const code = i.values?.[0] ?? ''; if (!(SUPPORTED_INVESTIGATORS as readonly string[]).includes(code)) return this.say(i, 'That investigator is not ready to play yet.');
      await i.defer({ update: true });
      const seats = host.seats;
      if (seats.some(s => s.userId === i.userId)) return this.say(i, 'You already have a seat.');
      if (seats.length >= 4) return this.say(i, 'The table is full.');
      if (!(this.d.allowDuplicates ?? false) && seats.some(s => s.investigator === code)) return this.say(i, 'Someone is already them.');
      const n = Array.from({ length: 5 }, (_, k) => `s${k + 1}`).find(x => !seats.some(s => s.seat === x))!;
      store.upsertSeat({ gameId: g.id, seat: n, userId: i.userId, userName: i.userName, investigator: code, deck: [], deckOk: false, ready: false, away: false, personalChannel: null, settings: { ...DEFAULT_SETTINGS } });
      await host.resync();
      const saved = store.getKv<{ investigator: string; deck: string[] }>('_user:' + i.userId, 'xp');
      const rows: Row[] = [{ buttons: [{ id: `m1:${g.id}:starter`, label: 'Use the starter deck', style: 'primary' }, ...(saved && saved.investigator === code ? [{ id: `m1:${g.id}:saved`, label: 'Use my saved deck', style: 'secondary' as const }] : [])] }];
      return void await i.reply({ ephemeral: true, content: `You are ${this.d.E.cat.get(code).title}. Bring a deck with /deck import, or take a ready-made one.`, rows });
    }
    if (!seat) return this.say(i, NOT_IN_STORY);
    if (id.a === 'starter' || id.a === 'saved') {
      if (g.status !== 'lobby') return this.say(i, 'The story has already begun.');
      await i.defer({ update: true });
      const saved = store.getKv<{ investigator: string; deck: string[] }>('_user:' + i.userId, 'xp');
      const codes = id.a === 'saved' && saved && saved.investigator === seat.investigator ? saved.deck : STARTERS[seat.investigator] ?? [];
      return this.acceptDeck(i, host, seat, codes);
    }
    if (id.a === 'impadd') {
      const add = i.values?.[0] ?? ''; const saved = store.getKv<{ investigator: string; deck: string[]; xp: number }>('_user:' + i.userId, 'xp'); if (!saved) return this.say(i, PASSED);
      const o = upgradeOptions(this.d.E.cat, this.d.E.reg, saved.investigator, saved.deck, saved.xp).find(x => x.add === add); if (!o) return this.say(i, PASSED);
      const sel: SelectOption[] = o.removeChoices.slice(0, 25).map(code => ({ value: code, label: trunc(this.d.E.cat.get(code).title, 100) }));
      return void await i.reply({ ephemeral: true, content: `Which card makes room for ${o.title}?`, rows: [{ select: { id: `m1:${g.id}:imprem:${add}`, placeholder: 'Choose a card to let go…', options: sel, min: 1, max: 1 } }] });
    }
    if (id.a === 'imprem') {
      const add = id.b; const remove = i.values?.[0] ?? ''; const saved = store.getKv<{ investigator: string; deck: string[]; xp: number }>('_user:' + i.userId, 'xp'); if (!saved) return this.say(i, PASSED);
      const o = upgradeOptions(this.d.E.cat, this.d.E.reg, saved.investigator, saved.deck, saved.xp).find(x => x.add === add);
      if (!o || !o.removeChoices.includes(remove)) return this.say(i, PASSED);
      const next = { ...saved, deck: applyUpgrade(saved.deck, add, remove), xp: saved.xp - o.cost };
      store.setKv('_user:' + i.userId, 'xp', next);
      return this.say(i, `Done. ${o.title} is in, ${this.d.E.cat.get(remove).title} is out. ${next.xp} experience left.`);
    }
    return this.say(i, PASSED);
  }
}
