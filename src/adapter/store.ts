// SQLite persistence (node:sqlite). The log of answers is the source of truth: seed + config + answers replay a whole game.
// Snapshots and Discord ids are conveniences that can be rebuilt. Snapshots hold hidden information, so treat the file like a table of open hands.
import { DatabaseSync } from 'node:sqlite';
import type { Answer, GameEvent, GameState, SeatId } from '../kernel/types.ts';

export type GameStatus = 'lobby' | 'active' | 'ended' | 'archived';
export interface GameRow {
  id: string; guildId: string; scenario: string; seed: number; difficulty: string; status: GameStatus;
  pace: 'live' | 'slow'; hostUserId: string; roleId: string | null; categoryId: string | null; behindCategoryId: string | null;
  archiveAt: number | null; paused: boolean; version: number;
}
export interface SeatRow {
  gameId: string; seat: SeatId; userId: string; userName: string; investigator: string; deck: string[]; deckOk: boolean;
  ready: boolean; away: boolean; personalChannel: string | null; settings: SeatSettings;
}
export interface SeatSettings { immersion: 'story' | 'balanced' | 'math'; pings: 'decide' | 'turns'; confirm: boolean; voice: boolean }
export const DEFAULT_SETTINGS: SeatSettings = { immersion: 'balanced', pings: 'decide', confirm: true, voice: false };
export interface StepRow { ver: number; ts: number; seat: string | null; answer: Answer | null; events: GameEvent[] }
export interface TimerRow { gameId: string; decisionId: string; due: number; kind: string; seat: string }

export class VersionConflict extends Error { constructor(msg: string) { super(msg); this.name = 'VersionConflict'; } }

export class Store {
  db: DatabaseSync;
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, scenario TEXT NOT NULL, seed INTEGER NOT NULL, difficulty TEXT NOT NULL, status TEXT NOT NULL,
        pace TEXT NOT NULL, host_user_id TEXT NOT NULL, role_id TEXT, category_id TEXT, behind_category_id TEXT, archive_at INTEGER, paused INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS seats (game_id TEXT NOT NULL, seat TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL, investigator TEXT NOT NULL, deck TEXT NOT NULL,
        deck_ok INTEGER NOT NULL DEFAULT 0, ready INTEGER NOT NULL DEFAULT 0, away INTEGER NOT NULL DEFAULT 0, personal_channel TEXT, settings TEXT NOT NULL, PRIMARY KEY (game_id, seat));
      CREATE TABLE IF NOT EXISTS events (game_id TEXT NOT NULL, version INTEGER NOT NULL, ts INTEGER NOT NULL, seat TEXT, answer TEXT, events TEXT NOT NULL, PRIMARY KEY (game_id, version));
      CREATE TABLE IF NOT EXISTS snapshots (game_id TEXT NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL, PRIMARY KEY (game_id, version));
      CREATE TABLE IF NOT EXISTS channels (game_id TEXT NOT NULL, object TEXT NOT NULL, kind TEXT NOT NULL, discord_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (game_id, object));
      CREATE INDEX IF NOT EXISTS channels_by_discord ON channels (discord_id);
      CREATE TABLE IF NOT EXISTS messages (game_id TEXT NOT NULL, purpose TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY (game_id, purpose));
      CREATE TABLE IF NOT EXISTS timers (game_id TEXT NOT NULL, decision_id TEXT NOT NULL, due INTEGER NOT NULL, kind TEXT NOT NULL, seat TEXT NOT NULL, PRIMARY KEY (game_id, decision_id));
      CREATE TABLE IF NOT EXISTS interactions_seen (id TEXT PRIMARY KEY, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS kv (game_id TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (game_id, k));
    `);
  }
  close() { this.db.close(); }
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // ── games ──
  createGame(g: GameRow) {
    this.db.prepare(`INSERT INTO games (id, guild_id, scenario, seed, difficulty, status, pace, host_user_id, role_id, category_id, behind_category_id, archive_at, paused, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(g.id, g.guildId, g.scenario, g.seed, g.difficulty, g.status, g.pace, g.hostUserId, g.roleId, g.categoryId, g.behindCategoryId, g.archiveAt, g.paused ? 1 : 0, g.version);
  }
  private gameFrom(r: Record<string, unknown>): GameRow {
    return { id: r.id as string, guildId: r.guild_id as string, scenario: r.scenario as string, seed: r.seed as number, difficulty: r.difficulty as string, status: r.status as GameStatus,
      pace: r.pace as 'live' | 'slow', hostUserId: r.host_user_id as string, roleId: r.role_id as string | null, categoryId: r.category_id as string | null,
      behindCategoryId: r.behind_category_id as string | null, archiveAt: r.archive_at as number | null, paused: !!r.paused, version: r.version as number };
  }
  getGame(id: string): GameRow | null { const r = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id); return r ? this.gameFrom(r) : null; }
  listGames(status?: GameStatus): GameRow[] {
    const rows = status ? this.db.prepare('SELECT * FROM games WHERE status = ?').all(status) : this.db.prepare('SELECT * FROM games').all();
    return rows.map(r => this.gameFrom(r));
  }
  updateGame(id: string, p: Partial<Omit<GameRow, 'id'>>) {
    const map: Record<string, string> = { guildId: 'guild_id', hostUserId: 'host_user_id', roleId: 'role_id', categoryId: 'category_id', behindCategoryId: 'behind_category_id', archiveAt: 'archive_at' };
    for (const [k, v] of Object.entries(p)) {
      const col = map[k] ?? k; const val = typeof v === 'boolean' ? (v ? 1 : 0) : v;
      this.db.prepare(`UPDATE games SET ${col} = ? WHERE id = ?`).run(val as never, id);
    }
  }
  gameForGuildLobby(guildId: string): GameRow | null {
    const r = this.db.prepare(`SELECT * FROM games WHERE guild_id = ? AND status IN ('lobby','active') ORDER BY rowid DESC LIMIT 1`).get(guildId);
    return r ? this.gameFrom(r) : null;
  }

  // ── seats ──
  upsertSeat(s: SeatRow) {
    this.db.prepare(`INSERT INTO seats (game_id, seat, user_id, user_name, investigator, deck, deck_ok, ready, away, personal_channel, settings) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(game_id, seat) DO UPDATE SET user_id=excluded.user_id, user_name=excluded.user_name, investigator=excluded.investigator, deck=excluded.deck, deck_ok=excluded.deck_ok,
      ready=excluded.ready, away=excluded.away, personal_channel=excluded.personal_channel, settings=excluded.settings`)
      .run(s.gameId, s.seat, s.userId, s.userName, s.investigator, JSON.stringify(s.deck), s.deckOk ? 1 : 0, s.ready ? 1 : 0, s.away ? 1 : 0, s.personalChannel, JSON.stringify(s.settings));
  }
  seats(gameId: string): SeatRow[] {
    return this.db.prepare('SELECT * FROM seats WHERE game_id = ? ORDER BY seat').all(gameId).map(r => ({
      gameId: r.game_id as string, seat: r.seat as string, userId: r.user_id as string, userName: r.user_name as string, investigator: r.investigator as string,
      deck: JSON.parse(r.deck as string) as string[], deckOk: !!r.deck_ok, ready: !!r.ready, away: !!r.away, personalChannel: r.personal_channel as string | null,
      settings: { ...DEFAULT_SETTINGS, ...(JSON.parse(r.settings as string) as Partial<SeatSettings>) },
    }));
  }
  removeSeat(gameId: string, seat: string) { this.db.prepare('DELETE FROM seats WHERE game_id = ? AND seat = ?').run(gameId, seat); }

  // ── log and snapshots ──
  /** Append one step. The expected version makes a second writer fail instead of interleaving. */
  appendStep(gameId: string, expectedVer: number, row: StepRow, snapshot?: GameState) {
    this.tx(() => {
      const g = this.getGame(gameId); if (!g) throw new Error('no such game');
      if (g.version !== expectedVer) throw new VersionConflict(`game ${gameId} is at version ${g.version}, expected ${expectedVer}`);
      this.db.prepare('INSERT INTO events (game_id, version, ts, seat, answer, events) VALUES (?,?,?,?,?,?)')
        .run(gameId, row.ver, row.ts, row.seat, row.answer ? JSON.stringify(row.answer) : null, JSON.stringify(row.events));
      if (snapshot) this.db.prepare('INSERT OR REPLACE INTO snapshots (game_id, version, state) VALUES (?,?,?)').run(gameId, row.ver, JSON.stringify(snapshot));
      this.db.prepare('UPDATE games SET version = ? WHERE id = ?').run(row.ver, gameId);
    });
  }
  saveSnapshot(gameId: string, ver: number, s: GameState) { this.db.prepare('INSERT OR REPLACE INTO snapshots (game_id, version, state) VALUES (?,?,?)').run(gameId, ver, JSON.stringify(s)); }
  latestSnapshot(gameId: string): { ver: number; state: GameState } | null {
    const r = this.db.prepare('SELECT version, state FROM snapshots WHERE game_id = ? ORDER BY version DESC LIMIT 1').get(gameId);
    return r ? { ver: r.version as number, state: JSON.parse(r.state as string) as GameState } : null;
  }
  steps(gameId: string, afterVer = 0): StepRow[] {
    return this.db.prepare('SELECT * FROM events WHERE game_id = ? AND version > ? ORDER BY version').all(gameId, afterVer).map(r => ({
      ver: r.version as number, ts: r.ts as number, seat: r.seat as string | null, answer: r.answer ? JSON.parse(r.answer as string) as Answer : null, events: JSON.parse(r.events as string) as GameEvent[],
    }));
  }
  step(gameId: string, ver: number): StepRow | null { return this.steps(gameId, ver - 1).find(s => s.ver === ver) ?? null; }

  // ── channels and messages ──
  setChannel(gameId: string, object: string, kind: string, discordId: string, name: string) {
    this.db.prepare('INSERT OR REPLACE INTO channels (game_id, object, kind, discord_id, name) VALUES (?,?,?,?,?)').run(gameId, object, kind, discordId, name);
  }
  channels(gameId: string): { object: string; kind: string; discordId: string; name: string }[] {
    return this.db.prepare('SELECT * FROM channels WHERE game_id = ?').all(gameId).map(r => ({ object: r.object as string, kind: r.kind as string, discordId: r.discord_id as string, name: r.name as string }));
  }
  channel(gameId: string, object: string) { return this.channels(gameId).find(c => c.object === object) ?? null; }
  /** Which game and which object does this Discord channel belong to? */
  channelOwner(discordId: string): { gameId: string; object: string; kind: string } | null {
    const r = this.db.prepare('SELECT game_id, object, kind FROM channels WHERE discord_id = ?').get(discordId);
    return r ? { gameId: r.game_id as string, object: r.object as string, kind: r.kind as string } : null;
  }
  dropChannel(gameId: string, object: string) { this.db.prepare('DELETE FROM channels WHERE game_id = ? AND object = ?').run(gameId, object); }
  setMessage(gameId: string, purpose: string, channelId: string, messageId: string) {
    this.db.prepare('INSERT OR REPLACE INTO messages (game_id, purpose, channel_id, message_id) VALUES (?,?,?,?)').run(gameId, purpose, channelId, messageId);
  }
  message(gameId: string, purpose: string): { channelId: string; messageId: string } | null {
    const r = this.db.prepare('SELECT channel_id, message_id FROM messages WHERE game_id = ? AND purpose = ?').get(gameId, purpose);
    return r ? { channelId: r.channel_id as string, messageId: r.message_id as string } : null;
  }
  dropMessage(gameId: string, purpose: string) { this.db.prepare('DELETE FROM messages WHERE game_id = ? AND purpose = ?').run(gameId, purpose); }
  messagesLike(gameId: string, prefix: string) {
    return this.db.prepare('SELECT * FROM messages WHERE game_id = ? AND purpose LIKE ?').all(gameId, prefix + '%')
      .map(r => ({ purpose: r.purpose as string, channelId: r.channel_id as string, messageId: r.message_id as string }));
  }

  // ── timers ──
  setTimer(t: TimerRow) { this.db.prepare('INSERT OR REPLACE INTO timers (game_id, decision_id, due, kind, seat) VALUES (?,?,?,?,?)').run(t.gameId, t.decisionId, t.due, t.kind, t.seat); }
  clearTimers(gameId: string) { this.db.prepare('DELETE FROM timers WHERE game_id = ?').run(gameId); }
  dueTimers(now: number): TimerRow[] {
    return this.db.prepare('SELECT * FROM timers WHERE due <= ? ORDER BY due').all(now).map(r => ({ gameId: r.game_id as string, decisionId: r.decision_id as string, due: r.due as number, kind: r.kind as string, seat: r.seat as string }));
  }
  timers(gameId: string): TimerRow[] {
    return this.db.prepare('SELECT * FROM timers WHERE game_id = ?').all(gameId).map(r => ({ gameId: r.game_id as string, decisionId: r.decision_id as string, due: r.due as number, kind: r.kind as string, seat: r.seat as string }));
  }
  deleteTimer(gameId: string, decisionId: string) { this.db.prepare('DELETE FROM timers WHERE game_id = ? AND decision_id = ?').run(gameId, decisionId); }

  // ── idempotency ──
  /** True if this interaction id was already handled. Records it otherwise. Prunes entries older than 15 minutes. */
  seen(interactionId: string, now: number): boolean {
    this.db.prepare('DELETE FROM interactions_seen WHERE ts < ?').run(now - 15 * 60_000);
    const r = this.db.prepare('SELECT 1 AS x FROM interactions_seen WHERE id = ?').get(interactionId);
    if (r) return true;
    this.db.prepare('INSERT INTO interactions_seen (id, ts) VALUES (?, ?)').run(interactionId, now);
    return false;
  }

  // ── small per-game key/value (config, pending say-how lines, scratch) ──
  setKv(gameId: string, k: string, v: unknown) { this.db.prepare('INSERT OR REPLACE INTO kv (game_id, k, v) VALUES (?,?,?)').run(gameId, k, JSON.stringify(v)); }
  getKv<T>(gameId: string, k: string): T | null { const r = this.db.prepare('SELECT v FROM kv WHERE game_id = ? AND k = ?').get(gameId, k); return r ? JSON.parse(r.v as string) as T : null; }
}
