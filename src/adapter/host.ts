// One GameHost per game. It is the only writer: every state change goes through its queue, is persisted before any Discord call,
// and is then presented (channels, narration, panels, prompts, timers). Presentation failures are retried and recorded; they never undo the game.
import { legalActions, start, step, type Engine } from '../kernel/engine.ts';
import { setupGame, type GameConfig } from '../kernel/setup.ts';
import { view, type View } from '../kernel/view.ts';
import type { Answer, Decision, GameEvent, GameState, LegalOption, SeatId } from '../kernel/types.ts';
import type { DiscordPort, MessageBody } from './port.ts';
import { DEFAULT_SETTINGS, type GameRow, type SeatRow, type Store, type TimerRow } from './store.ts';
import { syncChannels, type SyncReport } from './channels.ts';
import { narrate, type NarrationPack, type Target } from './narration/engine.ts';
import { generic } from './narration/generic.ts';
import { gatheringPack } from './narration/gathering.ts';
import { cardArt } from './art.ts';
import { GATHERING_TEXT, boardMessage, decisionMessage, detailsId, drawnMessage, handMessage, hourPanel, promptHome, resolvedPrompt, scenePanel, trailPanel, turnPing, type ScenarioText } from './render.ts';
import { draftJournal } from './journal.ts';
import { ENDING_TEXT } from './narration/gathering.ts';

export const PACE = {
  slow: { optional: 15 * 60_000, nudge: 4 * 3_600_000 },
  live: { optional: 2 * 60_000, nudge: 5 * 60_000 },
} as const;
export const SNAPSHOT_EVERY = 10;
export const RETENTION_MS = 7 * 24 * 3_600_000;

export interface HostDeps {
  E: Engine; store: Store; port: DiscordPort; now: () => number;
  botUserId?: string; archiveCategoryId?: string | null;
  text?: ScenarioText; packs?: NarrationPack[];
  sleep?: (ms: number) => Promise<void>;
}
export interface SubmitResult { ok: boolean; code?: string; message?: string }
interface PromptRec { decisionId: string; channelId: string; messageId: string; summary: string; noteChannel?: string; noteMessage?: string }

// ───────────────────────────────────────────────────────────────────────── recovery
export function recoverState(E: Engine, store: Store, gameId: string): GameState | null {
  const snap = store.latestSnapshot(gameId); if (!snap) return null;
  let s = snap.state;
  for (const row of store.steps(gameId, snap.ver)) {
    if (!row.answer) continue;
    const r = step(E, s, row.answer);
    if (r.error) throw new Error(`log replay failed at version ${row.ver}: ${r.error.code}`);
    s = r.state;
  }
  return s;
}
/** The whole game from its seed, config and answers alone. Used by the replay check. */
export function replayFromConfig(E: Engine, store: Store, gameId: string): GameState {
  const cfg = store.getKv<GameConfig>(gameId, 'config'); if (!cfg) throw new Error('no config stored');
  let s = start(E, setupGame(E, cfg)).state;
  for (const row of store.steps(gameId)) {
    if (!row.answer) continue;
    const r = step(E, s, row.answer);
    if (r.error) throw new Error(`replay failed at version ${row.ver}: ${r.error.code}`);
    s = r.state;
  }
  return s;
}

const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };
const OPTIONAL = new Set(['commit', 'reaction', 'mulligan']);
const seatOf = (p: Decision): SeatId => (p.kind === 'spotlight' ? p.seats[0]! : p.seat);

export class GameHost {
  d: HostDeps; gameId: string;
  state: GameState | null = null;
  errors: string[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  packs: NarrationPack[]; text: ScenarioText;

  constructor(d: HostDeps, gameId: string) {
    this.d = d; this.gameId = gameId;
    this.packs = d.packs ?? [gatheringPack, generic]; this.text = d.text ?? GATHERING_TEXT;
  }
  get game(): GameRow { return this.d.store.getGame(this.gameId)!; }
  get seats(): SeatRow[] { return this.d.store.seats(this.gameId); }
  seatFor(userId: string): SeatRow | null { return this.seats.find(s => s.userId === userId) ?? null; }
  chan(object: string): string | null { return this.d.store.channel(this.gameId, object)?.discordId ?? null; }

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Load state from the latest snapshot plus the log tail. */
  load(): GameState | null { this.state = recoverState(this.d.E, this.d.store, this.gameId); return this.state; }

  viewFor(seat: SeatId | null): View { return view(this.d.E, this.state!, seat); }
  /** What the seat could do right now (only meaningful on their turn). */
  legalFor(seat: SeatId): LegalOption[] {
    const p = this.state?.pending;
    return p && p.kind === 'turn' && p.seat === seat ? legalActions(this.d.E, this.state!, seat) : [];
  }

  private async guard<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    const sleep = this.d.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await fn(); } catch (e) {
        if (attempt === 2) { this.errors.push(`${label}: ${(e as Error).message}`); this.errors = this.errors.slice(-50); return undefined; }
        await sleep(150 * 2 ** attempt);
      }
    }
    return undefined;
  }

  // ───────────────────────────────────────────────────────────────────── starting
  /** Build the game from the lobby, log version 1 and present the opening. Runs in the queue. */
  startGame(seed: number): Promise<SubmitResult> {
    return this.enqueue(async () => {
      const g = this.game; if (g.status !== 'lobby') return { ok: false, code: 'state', message: 'The story has already begun.' };
      const seats = this.seats; if (!seats.length) return { ok: false, code: 'empty', message: 'No one has taken a seat.' };
      const cfg: GameConfig = { seed, difficulty: g.difficulty as GameConfig['difficulty'], seats: seats.map(s => ({ seat: s.seat, investigatorCode: s.investigator, deck: s.deck, userId: s.userId })) };
      this.d.store.setKv(this.gameId, 'config', cfg);
      const r = start(this.d.E, setupGame(this.d.E, cfg));
      this.d.store.updateGame(this.gameId, { status: 'active', seed });
      this.d.store.appendStep(this.gameId, 0, { ver: r.state.version, ts: this.d.now(), seat: null, answer: null, events: r.events }, r.state);
      this.state = r.state;
      await this.present(r.events, r.state.version);
      await this.autoAway();
      return { ok: true };
    });
  }

  // ───────────────────────────────────────────────────────────────────── answers
  submit(answer: Answer): Promise<SubmitResult> {
    return this.enqueue(async () => {
      const r = await this.applyOne(answer);
      if (r.ok) await this.autoAway();
      return r;
    });
  }

  private async applyOne(answer: Answer): Promise<SubmitResult> {
    const before = this.state; if (!before) return { ok: false, code: 'state', message: 'The story has not begun.' };
    const res = step(this.d.E, before, answer);
    if (res.error) return { ok: false, code: res.error.code, message: res.error.message };
    const ver = res.state.version; const store = this.d.store;
    store.appendStep(this.gameId, this.game.version, { ver, ts: this.d.now(), seat: answer.seat, answer, events: res.events }, ver % SNAPSHOT_EVERY === 0 || res.ended ? res.state : undefined);
    this.state = res.state;
    await this.present(res.events, ver);
    return { ok: true };
  }

  /** Seats marked away end their turn and let optional prompts pass. They never have cards played for them. */
  async autoAway(): Promise<void> {
    for (let i = 0; i < 60; i++) {
      const st = this.state; const p = st?.pending; if (!st || !p || st.ended) return;
      const seat = this.seats.find(s => s.seat === seatOf(p)); if (!seat?.away) return;
      let a: Answer | null = null;
      if (p.kind === 'turn') a = { seat: seat.seat, kind: 'done', decisionId: p.id };
      else if (OPTIONAL.has(p.kind)) a = { seat: seat.seat, kind: 'timeout', decisionId: p.id };
      else if (p.kind === 'reveal') a = { seat: seat.seat, kind: 'reveal', decisionId: p.id };
      if (!a) return;
      const r = await this.applyOne(a); if (!r.ok) return;
    }
  }

  // ───────────────────────────────────────────────────────────────────── presenting
  async present(events: GameEvent[], ver: number): Promise<void> {
    const st = this.state!;
    await this.guard('channels', async () => {
      const rep = await syncChannels({ port: this.d.port, store: this.d.store, botUserId: this.d.botUserId, archiveCategoryId: this.d.archiveCategoryId }, this.game, this.seats, st);
      for (const e of rep.errors) this.errors.push('sync ' + e);
    });
    await this.guard('narration', () => this.postNarration(events, ver));
    await this.guard('panels', () => this.renderPanels());
    await this.guard('prompt', () => this.renderPrompt());
    this.setTimers();
    if (st.ended && this.game.status === 'active') await this.guard('finish', () => this.finish());
  }

  private channelFor(t: Target): string | null {
    if (t.kind === 'hour') return this.chan('hour');
    if (t.kind === 'trail') return this.chan('trail');
    if (t.kind === 'loc') return this.chan(`loc:${t.loc}`) ?? this.chan('hour');
    return null;
  }

  private async postNarration(events: GameEvent[], ver: number): Promise<void> {
    const lines = narrate(events, { state: this.state!, version: ver, gameId: this.gameId, pack: this.packs });
    for (const l of lines) {
      const ch = this.channelFor(l.target); if (!ch) continue;
      const body: MessageBody = { content: l.text, narrator: true, ...(l.details ? { rows: [{ buttons: [{ id: detailsId(this.gameId, ver, l.eventIdx), label: 'Details', style: 'secondary' as const }] }] } : {}) };
      await this.guard('narrate', () => this.d.port.send(ch, body));
    }
    await this.postCards(events);
    await this.postDraws(events);
  }

  /** Whatever a player draws is told to that player alone, in their own channel: at the start of a round and whenever a card or action draws. */
  private async postDraws(events: GameEvent[]): Promise<void> {
    const st = this.state!; const k = this.d.E.k(st);
    const bySeat = new Map<string, { why: string; cards: { name: string; type: string; cost: number | null; code: string }[] }[]>();
    for (const e of events) {
      if (e.kind !== 'drew') continue;
      const p = e as Record<string, any>; const why = String(p.why ?? 'draw');
      if (why === 'mulligan' || !st.cards[p.cardId]) continue;           // the hand panel already shows a mulligan
      const d = k.def(p.cardId); const list = bySeat.get(p.seat) ?? []; bySeat.set(p.seat, list);
      let g = list[list.length - 1]; if (!g || g.why !== why) { g = { why, cards: [] }; list.push(g); }
      g.cards.push({ name: d.title, type: d.type, cost: typeof d.cost === 'number' ? d.cost : null, code: st.cards[p.cardId]!.code });
    }
    for (const [seat, groups] of bySeat) {
      const ch = this.seats.find(x => x.seat === seat)?.personalChannel; if (!ch) continue;
      for (const g of groups) await this.guard('draw-note', () => this.d.port.send(ch, drawnMessage(g.why, g.cards)));
    }
  }

  /** The real card faces, linked from ArkhamDB, shown where the thing shows up: a place when it opens, a foe when it arrives, a
   *  treachery where it strikes. Hidden things are never shown (nothing here is posted for a card nobody has seen yet). */
  private async postCards(events: GameEvent[]): Promise<void> {
    const st = this.state!; const k = this.d.E.k(st);
    // places: every revealed one gets its face once, including the place the story starts in (which no event announces)
    for (const l of Object.values(st.locations)) {
      if (!l.inPlay || !l.revealed || this.d.store.getKv<boolean>(this.gameId, `art:loc:${l.id}`)) continue;
      const art = cardArt(l.code), ch = this.chan(`loc:${l.id}`); if (!art || !ch) continue;
      if (await this.guard('card-art', () => this.d.port.send(ch, { embeds: [{ title: l.name, image: art }] }))) this.d.store.setKv(this.gameId, `art:loc:${l.id}`, true);
    }
    for (const e of events) {
      const p = e as Record<string, any>; let code: string | undefined; let ch: string | null = null; let title = String(p.name ?? '');
      if (e.kind === 'enemySpawned') { try { code = k.card(p.cardId).code; } catch { /* gone already */ } ch = this.chan(`loc:${p.loc}`); }
      else if (e.kind === 'encounterDrawn' && p.type !== 'enemy') { try { code = k.card(p.cardId).code; } catch { /* gone already */ } const inv = st.investigators[p.seat]; ch = inv ? this.chan(`loc:${inv.loc}`) : null; }
      else continue;
      const art = cardArt(code);
      if (art && ch) await this.guard('card-art', () => this.d.port.send(ch!, { embeds: [{ title, image: art }] }));
    }
  }

  /** Edit a stored message in place; repost (and pin) if it was deleted. Skips the call when nothing changed. */
  async upsert(purpose: string, channelId: string | null, body: MessageBody, pin = false): Promise<void> {
    if (!channelId) return; const store = this.d.store;
    const h = hash(JSON.stringify(body)); const saved = store.message(this.gameId, purpose);
    if (saved && saved.channelId === channelId && store.getKv<string>(this.gameId, 'h:' + purpose) === h) return;
    if (saved && saved.channelId === channelId && await this.d.port.edit(channelId, saved.messageId, body)) { store.setKv(this.gameId, 'h:' + purpose, h); return; }
    const id = await this.d.port.send(channelId, body);
    if (pin) await this.guard('pin', () => this.d.port.pin(channelId, id));
    store.setMessage(this.gameId, purpose, channelId, id); store.setKv(this.gameId, 'h:' + purpose, h);
  }

  async renderPanels(): Promise<void> {
    const st = this.state!; const v = this.viewFor(null);
    for (const l of Object.values(st.locations)) {
      if (!l.inPlay || !l.revealed) continue;
      await this.guard('panel', () => this.upsert(`panel:loc:${l.id}`, this.chan(`loc:${l.id}`), scenePanel({ game: this.gameId, v, loc: l.id, mode: 'balanced', text: this.text }), true));
    }
    await this.guard('hour', () => this.upsert('hour', this.chan('hour'), hourPanel(v, this.text), true));
    await this.guard('trail', () => this.upsert('trail', this.chan('trail'), trailPanel(v, this.text, st.campaignLog), true));
    for (const s of this.seats) {
      const sv = this.viewFor(s.seat); const legal = this.legalFor(s.seat);
      const all = st.pending?.kind === 'turn' && st.pending.seat === s.seat ? legal : [];
      await this.guard('hand', () => this.upsert(`hand:${s.seat}`, s.personalChannel, handMessage(this.gameId, sv, all, s.settings.immersion)));
      await this.guard('board', () => this.upsert(`board:${s.seat}`, s.personalChannel, boardMessage(this.gameId, sv, all)));
    }
  }

  private async renderPrompt(): Promise<void> {
    const st = this.state!; const store = this.d.store; const port = this.d.port;
    const cur = store.getKv<PromptRec>(this.gameId, 'prompt');
    if (cur && (!st.pending || st.pending.id !== cur.decisionId)) {
      await this.guard('resolve', () => port.edit(cur.channelId, cur.messageId, resolvedPrompt(cur.summary)));
      if (cur.noteChannel && cur.noteMessage) await this.guard('note', () => port.remove(cur.noteChannel!, cur.noteMessage!));
      store.setKv(this.gameId, 'prompt', null);
    }
    const p = st.pending; if (!p || st.ended) return;
    if (store.getKv<PromptRec>(this.gameId, 'prompt')?.decisionId === p.id) return;
    const seats = this.seats; const owner = seats.find(s => s.seat === seatOf(p));
    const v = this.viewFor(owner?.seat ?? null);
    let body = decisionMessage(p, { game: this.gameId, v, mode: owner?.settings.immersion ?? 'balanced', selection: [] });
    let ping: string[] = owner ? [owner.userId] : [];
    if (p.kind === 'turn') {
      if (!owner || owner.settings.pings !== 'turns') return;
      body = { content: turnPing(v.me?.name ?? 'You', p.actionsLeft) };
    }
    if (p.kind === 'spotlight') ping = p.seats.map(x => seats.find(s => s.seat === x)?.userId).filter((x): x is string => !!x);
    if (!body) return;
    const home = promptHome(p, v);
    const channel = home.kind === 'personal' ? seats.find(s => s.seat === home.seat)?.personalChannel ?? null : home.kind === 'loc' ? this.chan(`loc:${home.loc}`) : this.chan('hour');
    if (!channel) return;
    const mention = ping.map(u => `<@${u}>`).join(' ');
    const sent: MessageBody = { ...body, content: [mention, body.content].filter(Boolean).join(' ') || undefined, ping };
    const messageId = await this.guard('prompt-send', () => this.d.port.send(channel, sent));
    if (!messageId) return;
    const rec: PromptRec = { decisionId: p.id, channelId: channel, messageId, summary: p.kind === 'reveal' ? 'The bag was opened.' : 'Answered.' };
    // a neutral line in the room, so the table sees why the game paused without seeing anyone's cards
    const note = p.kind === 'commit' ? 'is deciding what to lend.' : p.kind === 'reaction' ? 'is thinking it over.' : p.kind === 'choose' ? 'is deciding.' : null;
    if (note && owner && v.me) {
      const loc = this.chan(`loc:${v.me.loc}`);
      if (loc && channel !== loc) { const nid = await this.guard('note', () => this.d.port.send(loc, { content: `*${v.me!.name} ${note}*`, narrator: true })); if (nid) { rec.noteChannel = loc; rec.noteMessage = nid; } }
    }
    store.setKv(this.gameId, 'prompt', rec);
  }

  /** The player changed a multi-select: remember it and redraw the prompt with the count on its button. */
  async setSelection(decisionId: string, values: string[]): Promise<void> {
    this.d.store.setKv(this.gameId, `sel:${decisionId}`, values);
    const st = this.state; const p = st?.pending; const rec = this.d.store.getKv<PromptRec>(this.gameId, 'prompt');
    if (!st || !p || p.id !== decisionId || !rec) return;
    const owner = this.seats.find(s => s.seat === seatOf(p));
    const body = decisionMessage(p, { game: this.gameId, v: this.viewFor(owner?.seat ?? null), mode: owner?.settings.immersion ?? 'balanced', selection: values });
    if (body) await this.guard('selection', () => this.d.port.edit(rec.channelId, rec.messageId, body));
  }
  selection(decisionId: string): string[] { return this.d.store.getKv<string[]>(this.gameId, `sel:${decisionId}`) ?? []; }

  // ───────────────────────────────────────────────────────────────────── timers
  setTimers(): void {
    const st = this.state!; const store = this.d.store;
    store.clearTimers(this.gameId);
    const p = st.pending; if (!p || st.ended) return;
    const pace = PACE[(this.game.pace as 'slow' | 'live')] ?? PACE.slow; const optional = OPTIONAL.has(p.kind);
    store.setTimer({ gameId: this.gameId, decisionId: p.id, due: this.d.now() + (optional ? pace.optional : pace.nudge), kind: optional ? 'timeout' : 'nudge', seat: seatOf(p) });
  }

  handleTimer(t: TimerRow): Promise<void> {
    return this.enqueue(async () => {
      const st = this.state; const store = this.d.store; const now = this.d.now();
      if (!st || st.ended || st.pending?.id !== t.decisionId) { store.deleteTimer(this.gameId, t.decisionId); return; }
      const g = this.game; const pace = PACE[(g.pace as 'slow' | 'live')] ?? PACE.slow;
      const hold = store.getKv<number>(this.gameId, 'holdUntil') ?? 0;
      if (g.paused || hold > now) { store.setTimer({ ...t, due: Math.max(now, hold) + pace.nudge }); return; }
      if (t.kind === 'timeout') {
        const r = await this.applyOne({ seat: t.seat, kind: 'timeout', decisionId: t.decisionId });
        if (r.ok) { await this.autoAway(); return; }
      }
      // required, or the kernel declined to time it out: nudge, and tell the host after three
      const n = (store.getKv<number>(this.gameId, `nudges:${t.decisionId}`) ?? 0) + 1; store.setKv(this.gameId, `nudges:${t.decisionId}`, n);
      const seat = this.seats.find(s => s.seat === t.seat); const v = this.viewFor(t.seat);
      const ch = seat?.personalChannel ?? this.chan('hour');
      if (ch && seat) await this.guard('nudge', () => this.d.port.send(ch, { content: `<@${seat.userId}> the story is waiting on you.`, ping: [seat.userId] }));
      if (n === 3) { const talk = this.chan('talk'); if (talk) await this.guard('host-note', () => this.d.port.send(talk, { content: `${v.me?.name ?? 'Someone'} has been quiet for a while. The host can mark them away with /host away.` })); }
      store.setTimer({ ...t, kind: 'nudge', due: now + pace.nudge });
    });
  }

  // ───────────────────────────────────────────────────────────────────── the end
  private async finish(): Promise<void> {
    const st = this.state!; const store = this.d.store; const res = st.ended!.resolution;
    const steps = store.steps(this.gameId);
    const trail = this.chan('trail'); const seed = this.game.seed;
    if (trail) await this.guard('epilogue', () => this.d.port.send(trail, { content: `**The end.**\n${ENDING_TEXT[res] ?? ''}`, narrator: true }));
    for (const s of this.seats) {
      const entry = draftJournal(st, steps, s.seat, seed);
      store.setKv(this.gameId, `journal:${s.seat}`, entry);
      const xp = st.ended!.xp[s.seat] ?? 0;
      const ch = s.personalChannel;
      if (ch) await this.guard('journal', () => this.d.port.send(ch, { content: `${entry}\n\n*What you carry out of it: ${xp} experience. Use /improve when you are ready.*` }));
      store.setKv('_user:' + s.userId, 'xp', { investigator: s.investigator, deck: s.deck, xp });
    }
    store.updateGame(this.gameId, { status: 'ended', archiveAt: this.d.now() + RETENTION_MS });
    store.clearTimers(this.gameId);
    await this.guard('lock', async () => { await syncChannels({ port: this.d.port, store, botUserId: this.d.botUserId, archiveCategoryId: this.d.archiveCategoryId }, this.game, this.seats, st); });
  }

  /** Called by the host command: repair every channel and message from the stored state. */
  async resync(): Promise<SyncReport> {
    return this.enqueue(async () => {
      if (!this.state) this.load();
      const rep = await syncChannels({ port: this.d.port, store: this.d.store, botUserId: this.d.botUserId, archiveCategoryId: this.d.archiveCategoryId }, this.game, this.seats, this.state);
      if (this.state) {
        // a stale hash would hide a deleted message, so forget what we think is posted
        this.d.store.setKv(this.gameId, 'prompt', null);
        for (const m of this.d.store.messagesLike(this.gameId, '')) this.d.store.setKv(this.gameId, 'h:' + m.purpose, 'stale');
        await this.guard('panels', () => this.renderPanels());
        await this.guard('prompt', () => this.renderPrompt());
        this.setTimers();
      }
      return rep;
    });
  }

  settings(seat: SeatId) { return this.seats.find(s => s.seat === seat)?.settings ?? DEFAULT_SETTINGS; }
}
