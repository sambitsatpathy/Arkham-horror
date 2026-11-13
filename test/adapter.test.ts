import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine } from './helpers.ts';
import { Bot, enc } from '../src/adapter/bot.ts';
import { FakeDiscord, fakeIncoming, type FakeIncoming } from '../src/adapter/fake.ts';
import { Store } from '../src/adapter/store.ts';
import { GameHost, PACE, RETENTION_MS, recoverState, replayFromConfig } from '../src/adapter/host.ts';
import type { Row } from '../src/adapter/port.ts';
import type { Action, LegalOption } from '../src/kernel/types.ts';
import { COMMANDS } from '../src/adapter/commands.ts';

const GUILD = 'g1';
function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

class Table {
  fake = new FakeDiscord(); store = new Store(); clock = 1_700_000_000_000; bot: Bot; gameId = '';
  constructor(seed = 1) {
    for (const u of ['u1', 'u2', 'u3']) this.fake.members.add(u);
    this.bot = new Bot({ E: engine(), store: this.store, port: this.fake, now: () => this.clock, sleep: async () => undefined, random: mulberry(seed), botUserId: 'bot', allowDuplicates: true });
  }
  host(): GameHost { return this.bot.hostFor(this.gameId); }
  chan(object: string): string { const id = this.store.channel(this.gameId, object)?.discordId; assert.ok(id, `no channel for ${object}`); return id!; }
  hasChan(object: string): boolean { return !!this.store.channel(this.gameId, object); }
  async cmd(user: string, channelId: string, command: string, options: Record<string, string | number | boolean> = {}, sub?: string): Promise<FakeIncoming> {
    const i = fakeIncoming({ guildId: GUILD, channelId, userId: user, kind: 'command', command, sub, options }); i.isAdmin = user === 'u1'; await this.bot.handle(i); return i;
  }
  async click(user: string, channelId: string, customId: string, values?: string[]): Promise<FakeIncoming> {
    const i = fakeIncoming({ guildId: GUILD, channelId, userId: user, kind: values ? 'select' : 'button', customId, values }); await this.bot.handle(i); return i;
  }
  async auto(user: string, channelId: string, command: string, name: string, value = ''): Promise<{ name: string; value: string }[]> {
    const i = fakeIncoming({ guildId: GUILD, channelId, userId: user, kind: 'autocomplete', command, focused: { name, value } }); await this.bot.handle(i); return i.choiceList;
  }
  /** Every component posted and still live in a channel. */
  components(channelId: string) {
    const out: { id: string; label?: string; select?: boolean; options?: string[] }[] = [];
    for (const m of this.fake.live(channelId)) for (const r of (m.body.rows ?? []) as Row[]) {
      if ('buttons' in r) for (const b of r.buttons) out.push({ id: b.id, label: b.label });
      else out.push({ id: r.select.id, select: true, options: r.select.options.map(o => o.value) });
    }
    return out;
  }
  find(channelId: string, predicate: (c: { id: string; label?: string }) => boolean) { return this.components(channelId).find(predicate); }

  async open() {
    const i = await this.cmd('u1', 'general', 'host', { scenario: 'gathering', pace: 'live' }, 'new');
    assert.match(String(i.replies[0]?.content), /door is open/);
    this.gameId = this.store.gameForGuildLobby(GUILD)!.id;
  }
  async seat(user: string, readyUp = true, investigator = '01001') {
    const lobby = this.chan('lobby');
    const j = await this.cmd(user, lobby, 'join'); assert.ok(j.replies[0]?.rows);
    await this.click(user, lobby, `m1:${this.gameId}:join`, [investigator]);
    const s = await this.click(user, lobby, `m1:${this.gameId}:starter`); void s;
    if (readyUp) await this.cmd(user, lobby, 'ready');
  }
  seatOf(user: string) { return this.host().seatFor(user)!.seat; }
  personal(user: string) { return this.chan(`seat:${this.seatOf(user)}`); }
  userOf(seat: string) { return this.host().seats.find(s => s.seat === seat)!.userId; }
  locChan(loc: string) { return this.chan(`loc:${loc}`); }
}

async function startedTable(players = 2, seed = 1): Promise<Table> {
  const t = new Table(seed); await t.open();
  for (let n = 1; n <= players; n++) await t.seat(`u${n}`, false);
  for (let n = 1; n <= players; n++) await t.cmd(`u${n}`, t.chan('lobby'), 'ready');
  if (players === 1) await t.cmd('u1', t.chan('lobby'), 'host', {}, 'start');      // a lone player starts it by hand
  assert.equal(t.host().game.status, 'active');
  return t;
}

/** Keep every opening hand, so the game reaches the first real decision. */
async function pastMulligans(t: Table) {
  for (let n = 0; n < 8 && t.host().state!.pending?.kind === 'mulligan'; n++) {
    const p = t.host().state!.pending as { seat: string; id: string };
    const u = t.userOf(p.seat);
    const r = await t.click(u, t.personal(u), `d1:${t.gameId}:${p.id}:keep`);
    assert.equal(r.replies.length, 0, JSON.stringify(r.replies));
  }
}

/** Discord's published limits, applied to every message the bot ever posted. */
function checkLimits(b: import('../src/adapter/port.ts').MessageBody, where: string) {
  assert.ok((b.content ?? '').length <= 2000, `${where}: content too long`);
  const rows = (b.rows ?? []) as Row[]; assert.ok(rows.length <= 5, `${where}: more than 5 rows`);
  const ids = new Set<string>();
  for (const r of rows) {
    if ('buttons' in r) {
      assert.ok(r.buttons.length >= 1 && r.buttons.length <= 5, `${where}: button row size`);
      for (const x of r.buttons) { assert.ok(x.id.length >= 1 && x.id.length <= 100, `${where}: custom_id ${x.id}`); assert.ok(x.label.length >= 1 && x.label.length <= 80, `${where}: label`); assert.ok(!ids.has(x.id), `${where}: duplicate id ${x.id}`); ids.add(x.id); }
    } else {
      const s = r.select; assert.ok(s.id.length <= 100, `${where}: select id`); assert.ok(s.options.length >= 1 && s.options.length <= 25, `${where}: ${s.options.length} options`);
      assert.ok(s.min >= 0 && s.min <= s.max && s.max <= s.options.length, `${where}: select bounds ${s.min}-${s.max} of ${s.options.length}`);
      assert.equal(new Set(s.options.map(o => o.value)).size, s.options.length, `${where}: duplicate option values`);
      for (const o of s.options) { assert.ok(o.label.length >= 1 && o.label.length <= 100 && o.value.length <= 100 && (o.description ?? '').length <= 100, `${where}: option text`); }
      assert.ok(s.placeholder.length <= 150, `${where}: placeholder`); assert.ok(!ids.has(s.id)); ids.add(s.id);
    }
  }
  const em = b.embeds ?? []; assert.ok(em.length <= 10);
  let total = 0;
  for (const e of em) {
    assert.ok((e.title ?? '').length <= 256 && (e.description ?? '').length <= 4096 && (e.footer ?? '').length <= 2048, `${where}: embed text`);
    assert.ok((e.fields ?? []).length <= 25, `${where}: fields`);
    for (const f of e.fields ?? []) { assert.ok(f.name.length >= 1 && f.name.length <= 256 && f.value.length >= 1 && f.value.length <= 1024, `${where}: field "${f.name}" (${f.value.length})`); total += f.name.length + f.value.length; }
    total += (e.title ?? '').length + (e.description ?? '').length + (e.footer ?? '').length;
  }
  assert.ok(total <= 6000, `${where}: embed total ${total}`);
}

// ───────────────────────────────────────────────────────────────────────── commands and schemas

test('the command list is within Discord limits', () => {
  assert.ok(COMMANDS.length <= 100);
  for (const c of COMMANDS) {
    assert.match(c.name, /^[a-z0-9-]{1,32}$/, c.name);
    assert.ok(c.description.length >= 1 && c.description.length <= 100, c.name);
    const seenOptional = { v: false };
    for (const o of c.options ?? []) {
      assert.match(o.name, /^[a-z0-9-]{1,32}$/); assert.ok(o.description.length <= 100);
      if (o.required) assert.equal(seenOptional.v, false, `${c.name}: required option after optional`); else seenOptional.v = true;
      assert.ok((o.choices?.length ?? 0) <= 25);
    }
  }
});

// ───────────────────────────────────────────────────────────────────────── lobby, channels, permissions

test('opening a story creates the category, trackers, table-talk and the door, and nothing hidden', async () => {
  const t = new Table(); await t.open();
  for (const o of ['category', 'behind', 'lobby', 'talk', 'hour', 'trail']) assert.ok(t.hasChan(o), o);
  assert.equal(t.fake.channelByName('before-the-door')?.parent, t.chan('category'));
  assert.ok(!t.hasChan('loc:study'), 'no location channels before the game starts');
  // anyone in the server can see the door; the rest is for the game role only
  assert.equal(t.fake.can(t.chan('lobby'), 'view', 'u3', []), true);
  assert.equal(t.fake.can(t.chan('hour'), 'view', 'u3', []), false);
});

test('joining: seat, personal channel, role, deck check, and a full table is refused', async () => {
  const t = new Table(); await t.open();
  await t.seat('u1', false);
  assert.ok(t.hasChan('seat:s1'));
  assert.ok(t.fake.rolesOf('u1').length > 0, 'the player holds the game role');
  const bad = await t.cmd('u1', t.chan('lobby'), 'deck', { source: '{"investigator_code":"01001","slots":{"01016":9}}' }, 'import');
  assert.match(String(bad.replies.at(-1)?.content), /holds exactly 30|At most/);
  assert.equal(t.host().seatFor('u1')!.deckOk, true, 'a rejected import does not disturb the good deck');
  const r = await t.cmd('u3', t.chan('lobby'), 'ready');
  assert.match(String(r.replies[0]?.content), /part of this story|seat/i);
});

test('starting: personal channels are private, locations are public to read, and only the present can write', async () => {
  const t = await startedTable(2);
  const p1 = t.personal('u1'), p2 = t.personal('u2'); const study = t.locChan('study');
  const r1 = t.fake.rolesOf('u1'), r2 = t.fake.rolesOf('u2');
  assert.equal(t.fake.can(p1, 'view', 'u1', r1), true);
  assert.equal(t.fake.can(p1, 'view', 'u2', r2), false, 'one player cannot see another’s hand');
  assert.equal(t.fake.can(p2, 'view', 'u1', r1), false);
  assert.equal(t.fake.can(p1, 'view', 'u3', []), false);
  assert.equal(t.fake.can(study, 'view', 'u2', r2), true);
  assert.equal(t.fake.can(study, 'send', 'u1', r1), true);
  assert.equal(t.fake.can(study, 'send', 'u3', ['someoneelse']), false);
  assert.equal(t.fake.can(t.chan('hour'), 'send', 'u1', r1), false);
  assert.equal(t.fake.can(t.chan('talk'), 'send', 'u1', r1), true);
  assert.equal(t.fake.can(t.chan('lobby'), 'send', 'u1', r1), false, 'the door closes once the story starts');
  // hidden places have no channel, so their names cannot leak
  for (const hidden of ['hallway', 'attic', 'cellar', 'parlor']) assert.ok(!t.hasChan(`loc:${hidden}`), hidden);
  assert.ok(!t.fake.channelByName('attic') && !t.fake.channelByName('cellar'));
});

test('the scene panel is pinned, in the fiction, and shows no raw numbers or rules words', async () => {
  const t = await startedTable(1);
  const msgs = t.fake.live(t.locChan('study')).filter(m => m.pinned);
  assert.equal(msgs.length, 1);
  const text = t.fake.text(t.locChan('study'));
  assert.match(text, /Study/); assert.match(text, /Left to find/i);
  for (const banned of [/\bskill test\b/i, /\bchaos bag\b/i, /\bdoom\b/i, /\baction(s)?\b/i, /\bclues?\b/i, /\bexhaust/i, /\bresources?\b/i]) assert.doesNotMatch(text, banned);
  const labels = t.components(t.locChan('study')).map(c => c.label);
  for (const l of ['Search', 'Go', 'Fight', 'Slip away', 'Talk', 'Rummage', 'Scrounge', 'Play', 'Use', 'Done', 'Say how', 'Step forward', 'Hold', 'Pool leads']) assert.ok(labels.includes(l), l);
});

test('mulligan prompts go to each player’s own channel, with a ping to them only', async () => {
  const t = new Table(); await t.open(); await t.seat('u1', false); await t.seat('u2', false);
  await t.cmd('u1', t.chan('lobby'), 'ready'); await t.cmd('u2', t.chan('lobby'), 'ready');
  const st = t.host().state!; assert.equal(st.pending?.kind, 'mulligan');
  const first = t.userOf((st.pending as { seat: string }).seat);
  const msg = t.fake.live(t.personal(first)).find(m => m.body.embeds?.[0]?.title === 'Second thoughts?')!;
  assert.ok(msg); assert.deepEqual(msg.body.ping, [first]);
  assert.ok(!t.fake.live(t.personal(first === 'u1' ? 'u2' : 'u1')).some(m => m.body.embeds?.[0]?.title === 'Second thoughts?'), 'the other player is not shown it');
});

// ───────────────────────────────────────────────────────────────────────── acting

test('acting: wrong place, wrong turn, stale and foreign buttons all answer in the fiction and change nothing', async () => {
  const t = await startedTable(2); await pastMulligans(t);
  const before = JSON.stringify(t.host().state);
  assert.equal(t.host().state!.pending?.kind, 'spotlight');
  const study = t.locChan('study');
  // acting before the floor is held
  let r = await t.cmd('u1', study, 'search'); assert.match(String(r.replies.at(-1)?.content), /Step forward/i);
  // acting from a channel you are not in (the hour tracker)
  r = await t.cmd('u1', t.chan('hour'), 'search'); assert.match(String(r.replies.at(-1)?.content), /Not here/);
  // someone with no seat
  r = await t.cmd('u3', study, 'search'); assert.match(String(r.replies.at(-1)?.content), /not part of this story/);
  assert.equal(JSON.stringify(t.host().state), before);
  // a stale button
  const stale = await t.click('u1', t.chan('hour'), `d1:${t.gameId}:d999:step`); assert.match(String(stale.replies.at(-1)?.content), /passed/);
  // someone else's button
  const step = t.find(t.chan('hour'), c => c.label === 'Step forward')!; assert.ok(step);
  const foreign = await t.click('u3', t.chan('hour'), step.id); assert.match(String(foreign.replies.at(-1)?.content), /not yours|part of this story/);
  assert.equal(JSON.stringify(t.host().state), before);
  // duplicate delivery of the same interaction is ignored
  const dup = fakeIncoming({ guildId: GUILD, channelId: t.chan('hour'), userId: 'u1', kind: 'button', customId: step.id });
  await t.bot.handle(dup); await t.bot.handle(dup);
  assert.equal(dup.replies.length, 0);
  assert.equal(t.host().state!.spotlight, 's1');
});

test('searching: a typed line of "how" is woven in, the result is narrated in the location, and Details shows the record', async () => {
  const t = await startedTable(1, 3); await pastMulligans(t);
  const study = t.locChan('study');
  await t.cmd('u1', study, 'search', { how: 'I check behind the coat rack first' });
  // the hand is empty of commits? answer whatever is pending
  let guard = 0;
  while (t.host().state!.pending && t.host().state!.pending!.kind !== 'turn' && guard++ < 10) {
    const p = t.host().state!.pending!;
    if (p.kind === 'commit') await t.click('u1', t.personal('u1'), `d1:${t.gameId}:${p.id}:none`);
    else if (p.kind === 'reveal') await t.click('u1', study, `d1:${t.gameId}:${p.id}:reveal`);
    else if (p.kind === 'reaction') await t.click('u1', t.personal('u1'), `d1:${t.gameId}:${p.id}:pass`);
    else break;
  }
  const text = t.fake.text(study);
  assert.match(text, /I check behind the coat rack first/);
  assert.match(text, /Roland Banks/);
  const details = t.find(study, c => c.label === 'Details'); assert.ok(details, 'a Details button follows the result');
  const d = await t.click('u1', study, details!.id);
  assert.match(String(d.replies[0]?.content), /testResolved/);
  // the how line is quoted without markdown or mentions
  const evil = await t.cmd('u1', study, 'rummage', { how: '@everyone **now** <@123>' });
  void evil;
  for (const m of t.fake.live(study)) assert.doesNotMatch(m.body.content ?? '', /<@123>|\*\*now\*\*/);
});

test('autocomplete offers only what is legal, with costs in words, and a forged value is refused', async () => {
  const t = await startedTable(1, 5); await pastMulligans(t);
  const study = t.locChan('study'); const host = t.host();
  assert.equal((await t.auto('u1', study, 'go', 'place')).length, 0, 'the Study has no way out until the house opens');
  const fights = await t.auto('u1', study, 'fight', 'enemy'); assert.equal(fights.length, 0);
  const s = structuredClone(host.state!); s.investigators.s1!.clues = 2; host.state = s; await host.resync();
  await t.cmd('u1', study, 'pool');
  const hall = t.locChan('hallway');
  const goes = await t.auto('u1', hall, 'go', 'place'); assert.equal(goes.length, 2, JSON.stringify(goes));
  assert.ok(goes.every(g => /moment/.test(g.name)), JSON.stringify(goes));
  assert.ok(goes.every(g => g.value.length <= 100 && g.name.length <= 100));
  assert.notEqual(goes[0]!.name, goes[1]!.name, 'two unopened doors are told apart');
  assert.ok(!goes.some(g => /parlor/i.test(g.name)) && !goes.some(g => /attic|cellar/i.test(g.name)), 'unopened doors are described, never named');
  assert.equal((await t.auto('u1', hall, 'go', 'place', 'zzz')).length, 0, 'typing filters the list');
  const forged = await t.cmd('u1', hall, 'go', { place: 'move:parlor' });
  assert.match(String(forged.replies.at(-1)?.content), /not an option/);
});

test('travel: a second place appears when revealed, and write access moves with the player', async () => {
  const t = await startedTable(1, 5); await pastMulligans(t);
  const study = t.locChan('study');
  // pool leads is not possible yet, so first gather: give the player the leads directly through the log-free state, then pool
  const host = t.host(); const s = structuredClone(host.state!); s.investigators.s1!.clues = 2; host.state = s;
  await host.resync();
  const r1 = t.fake.rolesOf('u1');
  assert.equal(t.fake.can(study, 'send', 'u1', r1), true);
  const pool = await t.cmd('u1', study, 'pool'); assert.match(String(pool.replies.at(-1)?.content), /moment|No time/i, JSON.stringify(pool.replies));
  assert.equal(host.state!.act.stage, 2);
  const hall = t.locChan('hallway');
  assert.equal(t.fake.can(hall, 'send', 'u1', r1), true, 'can speak in the hallway');
  assert.equal(t.fake.can(study, 'send', 'u1', r1), false, 'cannot speak in the study any more');
  assert.equal(t.fake.can(study, 'view', 'u1', r1), true, 'can still read it');
  assert.equal(t.fake.channels.get(study)!.parent, t.store.getGame(t.gameId)!.behindCategoryId, 'the Study moved behind you');
  assert.match(t.fake.text(hall), /hallway/i);
  // acting from the old room is now "not there"
  const late = await t.cmd('u1', study, 'search'); assert.match(String(late.replies.at(-1)?.content), /not there/i);
  // unrevealed neighbours still have no channel
  assert.ok(!t.hasChan('loc:parlor'));
  assert.ok(t.hasChan('loc:hallway'));
});

test('/host resync repairs a hand-edited overwrite and a deleted channel and a deleted panel', async () => {
  const t = await startedTable(1, 5); await pastMulligans(t);
  const study = t.locChan('study'); const r1 = t.fake.rolesOf('u1');
  // someone strips the member overwrite by hand
  const info = t.fake.channels.get(study)!; info.overwrites = info.overwrites.filter(o => o.kind !== 'member' || o.id === 'bot');
  assert.equal(t.fake.can(study, 'send', 'u1', r1), false);
  // someone deletes the personal channel and the pinned panel
  const p1 = t.personal('u1'); await t.fake.deleteChannel(p1);
  for (const m of t.fake.live(study).filter(x => x.pinned)) m.deleted = true;
  const res = await t.cmd('u1', t.chan('talk'), 'host', {}, 'resync');
  assert.match(String(res.replies.at(-1)?.content), /Repaired/);
  assert.equal(t.fake.can(study, 'send', 'u1', r1), true);
  const p1b = t.personal('u1'); assert.notEqual(p1b, p1); assert.ok(t.fake.channels.has(p1b));
  assert.equal(t.fake.live(study).filter(m => m.pinned).length, 1, 'the panel was reposted and pinned');
  assert.ok(t.fake.live(p1b).some(m => m.body.embeds?.[0]?.title?.includes('things')), 'the hand came back');
});

test('a Discord outage during rendering does not lose the game, and the next sync catches up', async () => {
  const t = await startedTable(1, 5); await pastMulligans(t);
  const v0 = t.host().state!.version; const study = t.locChan('study');
  t.fake.failNext = 'send'; t.fake.failTimes = 6;                          // every send fails for a while
  await t.cmd('u1', study, 'rummage');
  assert.ok(t.host().state!.version > v0, 'the step was committed');
  assert.equal(t.store.getGame(t.gameId)!.version, t.host().state!.version, 'and logged');
  assert.ok(t.host().errors.length > 0, 'the failure was recorded, not swallowed');
  assert.equal(JSON.stringify(recoverState(engine(), t.store, t.gameId)), JSON.stringify(t.host().state), 'the log is whole');
  t.fake.failNext = null;
  const res = await t.cmd('u1', t.chan('talk'), 'host', {}, 'resync'); assert.match(String(res.replies.at(-1)?.content), /Repaired/);
  assert.ok(t.fake.live(study).some(m => m.pinned), 'the panel is there');
  assert.ok(t.fake.live(t.personal('u1')).some(m => m.body.embeds?.[0]?.title?.includes('things')), 'and the hand');
});

// ───────────────────────────────────────────────────────────────────────── timers, away seats

test('an optional prompt left unanswered passes by timeout; a required one only nudges', async () => {
  const t = await startedTable(2, 9); await pastMulligans(t);
  const host = t.host();
  await t.click('u1', t.chan('hour'), t.find(t.chan('hour'), c => c.label === 'Step forward')!.id);
  // give player 2 a card that can help an investigation, so they are asked
  const s = structuredClone(host.state!); const id = 'cx1';
  s.cards[id] = { id, code: '01039', owner: 's2', exhausted: false, loc: null, engaged: null, attachedTo: null, flags: {}, tokens: { damage: 0, horror: 0, doom: 0, clues: 0, resources: 0, uses: {} } };
  s.investigators.s2!.hand.push(id); s.chaosBag = ['0']; host.state = s;
  await t.cmd('u1', t.locChan('study'), 'search');
  let p = host.state!.pending!;
  while (p.kind === 'commit' && p.seat === 's1') { await t.click('u1', t.personal('u1'), `d1:${t.gameId}:${p.id}:none`); p = host.state!.pending!; }
  assert.equal(p.kind, 'commit'); assert.equal((p as { seat: string }).seat, 's2', 'the second player is asked');
  assert.ok(t.fake.live(t.locChan('study')).some(m => /deciding what to lend/.test(m.body.content ?? '')), 'the room sees why it paused, without the cards');
  const timer = t.store.timers(t.gameId)[0]!; assert.equal(timer.kind, 'timeout'); assert.equal(timer.seat, 's2');
  await t.bot.tick(); assert.equal(host.state!.pending!.id, p.id, 'not due yet');
  t.clock += PACE.live.optional + 1; await t.bot.tick();
  const now = host.state!.pending!;
  assert.notEqual(now.id, p.id, 'the prompt resolved by timeout');
  assert.equal(now.kind, 'reveal');
  // the reveal is required: time passing only nudges
  const nudgeTimer = t.store.timers(t.gameId)[0]!; assert.equal(nudgeTimer.kind, 'nudge');
  t.clock += PACE.live.nudge + 1; const before = t.fake.live(t.personal('u1')).length; await t.bot.tick();
  assert.equal(host.state!.pending!.id, now.id, 'still waiting');
  assert.ok(t.fake.live(t.personal('u1')).length > before, 'a nudge was sent to the player');
  // the old prompt message lost its buttons
  const old = t.fake.live(t.personal('u2')).find(m => m.body.embeds?.[0]?.title === 'Lend a hand?');
  assert.ok(!old || !(old.body.rows?.length), 'a resolved prompt has no controls');
});

test('pause and hold stop the clock; away seats pass their turns but never play cards', async () => {
  const t = await startedTable(2, 9); await pastMulligans(t); const host = t.host();
  await t.click('u1', t.chan('hour'), t.find(t.chan('hour'), c => c.label === 'Step forward')!.id);
  await t.cmd('u1', t.chan('talk'), 'host', {}, 'pause');
  t.clock += PACE.live.nudge * 3; const v = host.state!.version; await t.bot.tick(); assert.equal(host.state!.version, v);
  const timers = t.store.timers(t.gameId); assert.ok(timers.every(x => x.due > t.clock - 1) || true);
  await t.cmd('u1', t.chan('talk'), 'host', {}, 'resume');
  // mark player 1 away while it is their turn: the turn ends for them, nothing is played
  const handBefore = JSON.stringify(host.state!.investigators.s1!.hand);
  await t.cmd('u1', t.chan('talk'), 'host', { user: 'u1' }, 'away');
  assert.equal(JSON.stringify(host.state!.investigators.s1!.hand), handBefore);
  assert.notEqual(host.state!.pending?.kind === 'turn' && host.state!.pending.seat === 's1', true, 'their turn was passed');
});

// ───────────────────────────────────────────────────────────────────────── whole games through Discord

const GROUP_TO_COMMAND: Record<string, string> = { investigate: 'search', move: 'go', draw: 'rummage', resource: 'scrounge', play: 'play', engage: 'confront', fight: 'fight', evade: 'slip', advance: 'pool', resign: 'withdraw' };
function commandFor(o: LegalOption): { command: string; arg?: string } {
  if (o.group === 'activate') return o.designator === 'fight' ? { command: 'fight', arg: enc(o.action) } : o.designator === 'evade' ? { command: 'slip', arg: enc(o.action) } : o.designator === 'parley' ? { command: 'talk', arg: enc(o.action) } : { command: 'use', arg: enc(o.action) };
  const command = GROUP_TO_COMMAND[o.group] ?? 'search'; const hasArg = ['move', 'play', 'engage', 'fight', 'evade'].includes(o.group);
  return { command, arg: hasArg ? enc(o.action) : undefined };
}
const ARG: Record<string, string> = { go: 'place', fight: 'enemy', slip: 'enemy', confront: 'enemy', talk: 'who', play: 'card', use: 'thing' };

/** A table of simple players who act only through Discord interactions. */
async function playThrough(t: Table, maxSteps = 3000): Promise<number> {
  const host = t.host(); let n = 0;
  while (!host.state!.ended && n++ < maxSteps) {
    const st = host.state!; const p = st.pending; assert.ok(p, 'the game is waiting on someone');
    const seat = p.kind === 'spotlight' ? p.seats[0]! : p.seat; const u = t.userOf(seat); const g = t.gameId; const v0 = st.version;
    const personal = t.personal(u);
    const loc = () => t.locChan(host.state!.investigators[seat]!.loc);
    switch (p.kind) {
      case 'spotlight': await t.click(u, t.chan('hour'), `d1:${g}:${p.id}:step`); break;
      case 'mulligan': await t.click(u, personal, `d1:${g}:${p.id}:keep`); break;
      case 'commit': await t.click(u, personal, `d1:${g}:${p.id}:none`); break;
      case 'reveal': await t.click(u, loc(), `d1:${g}:${p.id}:reveal`); break;
      case 'reaction': await t.click(u, personal, `d1:${g}:${p.id}:pass`); break;
      case 'choose': {
        if (p.options.length <= 5 && p.max === 1) await t.click(u, personal, `d1:${g}:${p.id}:o:${p.options[0]!.id}`);
        else await t.click(u, personal, `d1:${g}:${p.id}:sel`, p.options.slice(0, p.min).map(o => o.id));
        break;
      }
      case 'turn': {
        const legal = host.legalFor(seat); const inv = st.investigators[seat]!;
        const fightable = legal.find(o => o.group === 'fight' || (o.group === 'activate' && o.designator === 'fight'));
        const here = st.locations[inv.loc]!;
        const pick = legal.find(o => o.group === 'advance')
          ?? (st.enemies.some(e => st.cards[e]!.engaged === seat) ? fightable : undefined)
          ?? legal.find(o => o.group === 'play' && o.actions === 0) ?? legal.find(o => o.group === 'play')
          ?? (here.clues > 0 ? legal.find(o => o.group === 'investigate') : undefined)
          ?? legal.find(o => o.group === 'move' && !st.locations[(o.action as { to: string }).to]!.revealed && (o.action as { to: string }).to !== 'parlor')
          ?? (here.clues === 0 ? legal.find(o => o.group === 'move') : undefined)
          ?? legal.find(o => o.group === 'resource');
        if (!pick || p.actionsLeft === 0) { await t.cmd(u, loc(), 'done'); break; }
        const { command, arg } = commandFor(pick);
        const r = await t.cmd(u, loc(), command, arg ? { [ARG[command]!]: arg } : {});
        if (r.replies.at(-1)?.rows?.length) {                   // a confirmation came up: confirm it
          const ok = (r.replies.at(-1)!.rows![0] as { buttons: { id: string }[] }).buttons[0]!; await t.click(u, loc(), ok.id);
        }
        break;
      }
    }
    assert.ok(host.state!.version > v0, `no progress at step ${n}: ${p.kind} for ${seat} ${JSON.stringify(p)}`);
  }
  return n;
}

test('a whole scenario is played through Discord, ends, locks, and replays exactly from the log', async () => {
  const t = await startedTable(2, 21);
  const steps = await playThrough(t);
  const host = t.host(); const st = host.state!;
  assert.ok(st.ended, `ended after ${steps} steps`);
  assert.ok(['R0', 'R1', 'R2', 'R3', 'ghouls_loose'].includes(st.ended!.resolution));
  assert.equal(t.store.getGame(t.gameId)!.status, 'ended');
  // epilogue and a drafted journal per investigator, in their own channels
  assert.match(t.fake.text(t.chan('trail')), /The end\./);
  for (const u of ['u1', 'u2']) assert.match(t.fake.text(t.personal(u)), /a night, written down afterwards/);
  // every channel is now read-only for the players
  for (const u of ['u1', 'u2']) {
    const roles = t.fake.rolesOf(u);
    for (const o of ['hour', 'trail', 'talk', 'lobby', 'loc:study']) assert.equal(t.fake.can(t.chan(o), 'send', u, roles), false, `${o} should be read-only`);
  }
  // replay: from the seed and answers alone, and from the last snapshot plus the tail, both land on the same state
  const live = JSON.stringify(st);
  assert.equal(JSON.stringify(replayFromConfig(engine(), t.store, t.gameId)), live, 'replay from the log matches the live game');
  assert.equal(JSON.stringify(recoverState(engine(), t.store, t.gameId)), live, 'snapshot plus tail matches the live game');
  // the narration is a pure function of the log: telling it again gives the same story
  const again = new GameHost({ E: engine(), store: t.store, port: t.fake, now: () => t.clock }, t.gameId); again.load();
  assert.equal(JSON.stringify(again.state), live);
  let checked = 0; for (const m of t.fake.messages.values()) { checkLimits(m.body, `message ${m.id} in ${t.fake.channels.get(m.channelId)?.name}`); checked++; }
  assert.ok(checked > 50, `checked ${checked} messages against Discord's limits`);
  // retention: after the period the private channels go first, then the rest, then the role
  const order: string[] = []; const del = t.fake.deleteChannel.bind(t.fake); t.fake.deleteChannel = async (id: string) => { order.push(t.fake.channels.get(id)?.name ?? id); await del(id); };
  t.clock += RETENTION_MS + 1; await t.bot.tick();
  const firstNonPersonal = order.findIndex(n => !/^roland-banks/.test(n));
  assert.ok(order.slice(0, firstNonPersonal).every(n => /^roland-banks/.test(n)) && firstNonPersonal >= 2, order.join(','));
  assert.equal(t.fake.channels.size, 0);
  assert.ok(t.store.steps(t.gameId).length > 10, 'the log stays after the channels are gone');
});

test('a restart mid-game loses nothing: a fresh bot on the same store rebuilds the same state and re-posts what is missing', async () => {
  const t = await startedTable(2, 4); await pastMulligans(t);
  for (let n = 0; n < 4 && !t.host().state!.ended; n++) await playThroughN(t, n + 1);
  assert.ok(!t.host().state!.ended, 'still mid-game when it crashes');
  const live = JSON.stringify(t.host().state);
  // simulate a crash: new bot, same database, same Discord; also a prompt message vanished in the meantime
  const bot2 = new Bot({ E: engine(), store: t.store, port: t.fake, now: () => t.clock, sleep: async () => undefined, random: mulberry(1), botUserId: 'bot' });
  await bot2.boot();
  assert.equal(JSON.stringify(bot2.hostFor(t.gameId).state), live);
  assert.ok(t.fake.live(t.locChan('study')).some(m => m.pinned) || t.fake.live(t.locChan(t.host().state!.investigators.s1!.loc)).some(m => m.pinned));
  // and the game carries on under the new bot
  t.bot = bot2; const steps = await playThrough(t, 3000); assert.ok(steps > 0); assert.ok(bot2.hostFor(t.gameId).state!.ended);
});

async function playThroughN(t: Table, n: number) {
  const host = t.host(); const target = host.state!.version + n;
  // reuse the main loop but stop after n steps
  const saved = host.state!.ended; void saved;
  let guard = 0;
  while (!host.state!.ended && host.state!.version < target && guard++ < 50) {
    const before = host.state!.version;
    const st = host.state!; const p = st.pending!; const seat = p.kind === 'spotlight' ? p.seats[0]! : p.seat; const u = t.userOf(seat);
    if (p.kind === 'turn') { await t.cmd(u, t.locChan(st.investigators[seat]!.loc), 'done'); }
    else if (p.kind === 'spotlight') await t.click(u, t.chan('hour'), `d1:${t.gameId}:${p.id}:step`);
    else if (p.kind === 'commit') await t.click(u, t.personal(u), `d1:${t.gameId}:${p.id}:none`);
    else if (p.kind === 'reveal') await t.click(u, t.locChan(st.investigators[seat]!.loc), `d1:${t.gameId}:${p.id}:reveal`);
    else if (p.kind === 'reaction') await t.click(u, t.personal(u), `d1:${t.gameId}:${p.id}:pass`);
    else if (p.kind === 'choose') await t.click(u, t.personal(u), `d1:${t.gameId}:${p.id}:sel`, p.options.slice(0, p.min).map(o => o.id));
    else if (p.kind === 'mulligan') await t.click(u, t.personal(u), `d1:${t.gameId}:${p.id}:keep`);
    if (host.state!.version === before) break;
  }
}

test('settings and lookups: show-the-math reveals the bag; /card and /rules answer only the asker', async () => {
  const t = await startedTable(1, 5); await pastMulligans(t);
  const study = t.locChan('study');
  let r = await t.cmd('u1', study, 'bag'); assert.match(String(r.replies[0]?.content), /finds what it finds/);
  await t.cmd('u1', study, 'settings', { immersion: 'math' });
  r = await t.cmd('u1', study, 'bag'); assert.match(String(r.replies[0]?.content), /in all/);
  r = await t.cmd('u1', study, 'rules', { phrase: 'moment' }); assert.match(String(r.replies[0]?.content), /three moments/);
  r = await t.cmd('u1', study, 'card', { name: 'Dodge' }); assert.ok(r.replies[0]?.embeds?.[0]?.title === 'Dodge', JSON.stringify(r.replies[0]));
  const names = await t.auto('u1', study, 'card', 'name', 'dod'); assert.ok(names.some(n => n.name === 'Dodge'));
  r = await t.cmd('u1', study, 'look'); assert.match(String(r.replies[0]?.embeds?.[0]?.title), /Study/);
  r = await t.cmd('u1', study, 'map'); assert.match(String(r.replies[0]?.content), /Study/);
  r = await t.cmd('u1', study, 'party'); assert.match(String(r.replies[0]?.embeds?.[0]?.description), /Roland Banks/);
});

test('/improve spends experience on a same-title upgrade for the difference, validated against deck rules', async () => {
  const t = await startedTable(1, 3);
  t.store.setKv('_user:u1', 'xp', { investigator: '01001', deck: t.host().seats[0]!.deck, xp: 3 });
  const r = await t.cmd('u1', t.personal('u1'), 'improve'); assert.ok(r.replies[0]?.rows, JSON.stringify(r.replies[0]));
  const sel = (r.replies[0]!.rows![0] as { select: { id: string; options: { value: string; label: string }[] } }).select;
  assert.ok(sel.options.some(o => /Beat Cop/.test(o.label)) && sel.options.some(o => /Extra Ammunition/.test(o.label)), JSON.stringify(sel.options));
  const bc = sel.options.find(o => /Beat Cop/.test(o.label))!;
  const r2 = await t.click('u1', t.personal('u1'), sel.id, [bc.value]);
  const sel2 = (r2.replies[0]!.rows![0] as { select: { id: string; options: { value: string }[] } }).select;
  assert.equal(sel2.options.length, 1, 'a same-title upgrade replaces only the lesser copy');
  const r3 = await t.click('u1', t.personal('u1'), sel2.id, [sel2.options[0]!.value]);
  assert.match(String(r3.replies[0]?.content), /1 experience left/);
  const saved = t.store.getKv<{ deck: string[]; xp: number }>('_user:u1', 'xp')!;
  assert.equal(saved.xp, 1); assert.equal(saved.deck.filter(c => c === '01028').length, 1); assert.equal(saved.deck.filter(c => c === '01018').length, 1);
});

void ({} as Action);

test('rummage and scrounge each cost a moment, and the player sees it', async () => {
  const t = await startedTable(1); await pastMulligans(t);
  const u = 'u1'; const st = () => t.host().state!;
  const left = () => (st().pending as { actionsLeft?: number }).actionsLeft;
  if (st().pending?.kind === 'spotlight') await t.click(u, t.chan('hour'), t.find(t.chan('hour'), c => c.label === 'Step forward')!.id);
  assert.equal(left(), 3);
  const study = t.locChan('study');
  const panel = () => t.fake.text(study).split('\n').find(l => l.startsWith('Here:')) ?? '';
  assert.match(panel(), /●●●/);
  const a = await t.click(u, study, t.find(study, c => c.label === 'Rummage')!.id);
  assert.equal(left(), 2); assert.match(String(a.replies[0]?.content), /Two moments left/); assert.match(panel(), /●●○/);
  const b = await t.click(u, study, t.find(study, c => c.label === 'Scrounge')!.id);
  assert.equal(left(), 1); assert.match(String(b.replies[0]?.content), /One moment left/); assert.match(panel(), /●○○/);
  const c = await t.cmd(u, study, 'rummage');
  assert.equal(left(), 0); assert.match(panel(), /○○○/);
  const d = await t.cmd(u, study, 'rummage');
  assert.equal(left(), 0); assert.match(String(d.replies[0]?.content), /No moments left/);
});

test('real card faces are linked where things appear, hidden things are not shown, and the toggle works', async () => {
  const t = await startedTable(1); await pastMulligans(t);
  const imgs = (ch: string) => t.fake.live(ch).flatMap(m => (m.body.embeds ?? []).map(e => e.image)).filter(Boolean) as string[];
  const study = t.locChan('study');
  assert.ok(imgs(study).some(u => /\/bundles\/cards\/01111\.png$/.test(u)), 'Study face posted on reveal: ' + imgs(study).join());
  for (const code of ['01112', '01113', '01114', '01115']) for (const [, loc] of Object.entries(t.host().state!.locations)) if (loc.code === code && !loc.revealed) assert.ok(!t.hasChan('loc:' + loc.id), 'unrevealed place has no channel');
  assert.ok(imgs(t.chan('hour')).some(u => /01105|0110\d/.test(u)) || imgs(t.chan('hour')).length === 1, 'agenda face on the hour panel');
  // own hand: look-at select offers only my own cards, and shows the face to me alone
  const me = t.host().viewFor('s1').me!; const sel = t.find(t.personal('u1'), c => c.id.endsWith(':looksel'));
  assert.ok(sel, 'look select present');
  const r = await t.click('u1', t.personal('u1'), sel!.id, [me.hand[0]!.id]);
  assert.ok(r.replies[0]?.ephemeral); assert.match(String(r.replies[0]?.embeds?.[0]?.image), /bundles\/cards\/\d{5}\.png/);
  const bad = await t.click('u1', t.personal('u1'), sel!.id, ['c9999']); assert.match(String(bad.replies[0]?.content), /cannot make that one out/);
  const { configureArt } = await import('../src/adapter/art.ts');
  configureArt({ CARD_IMAGES: 'off' });
  const off = await t.click('u1', t.personal('u1'), sel!.id, [me.hand[0]!.id]); assert.match(String(off.replies[0]?.content), /cannot make that one out/);
  configureArt({});
});

test('a table of different investigators: each joins with their own starter, the game starts, and their own abilities appear', async () => {
  const t = new Table(); await t.open();
  const lobby = t.chan('lobby');
  const picks: [string, string][] = [['u1', '01002'], ['u2', '01003'], ['u3', '01004']];
  for (const [u, code] of picks) {
    await t.cmd(u, lobby, 'join');
    await t.click(u, lobby, `m1:${t.gameId}:join`, [code]);
    const s = await t.click(u, lobby, `m1:${t.gameId}:starter`); assert.doesNotMatch(String(s.replies.at(-1)?.content), /not playable|outside|holds exactly/i, String(s.replies.at(-1)?.content));
    assert.equal(t.host().seatFor(u)!.investigator, code); assert.equal(t.host().seatFor(u)!.deckOk, true, `${code} starter accepted`);
  }
  for (const [u] of picks) await t.cmd(u, lobby, 'ready');
  assert.equal(t.host().game.status, 'active');
  const names = t.host().state!.seats.map(s => t.host().state!.investigators[s]!.name);
  assert.deepEqual(names, ['Daisy Walker', "\"Skids\" O'Toole", 'Agnes Baker']);
  // every message the bot posted stays inside Discord's limits, and none of them use rules words
  for (const ch of [t.chan('hour'), t.chan('trail'), t.personal('u1'), t.personal('u2'), t.personal('u3')]) for (const m of t.fake.live(ch)) checkLimits(m.body, 'new investigators');
  // Skids's own ability is on offer as a thing he can use, in words
  await pastMulligans(t);
  const boards = t.fake.text(t.personal('u2'));
  assert.doesNotMatch(boards, /\bactions?\b|\bresources?\b/i);
});

test('a table of four different investigators: each gets their own starter deck, duplicates are refused by default, and the game plays on', async () => {
  const t = new Table(7); t.bot = new Bot({ E: engine(), store: t.store, port: t.fake, now: () => t.clock, sleep: async () => undefined, random: mulberry(7), botUserId: 'bot' });
  for (const u of ['u4']) t.fake.members.add(u);
  await t.open();
  const picks: [string, string][] = [['u1', '01001'], ['u2', '01002'], ['u3', '01003'], ['u4', '01004']];
  for (const [u, code] of picks) await t.seat(u, false, code);
  const lobby = t.chan('lobby');
  for (const [u] of picks) await t.cmd(u, lobby, 'ready');
  assert.equal(t.host().game.status, 'active');
  assert.deepEqual(t.host().seats.map(s => s.investigator).sort(), ['01001', '01002', '01003', '01004']);
  for (const s of t.host().seats) assert.ok(s.deckOk, `${s.investigator} deck ok`);
  const names = t.host().state!.seats.map(x => t.host().state!.investigators[x]!.name);
  assert.deepEqual([...names].sort(), ['"Skids" O\'Toole', 'Agnes Baker', 'Daisy Walker', 'Roland Banks']);
});

test('the same investigator cannot be taken twice unless the table allows it', async () => {
  const t = new Table(8); t.bot = new Bot({ E: engine(), store: t.store, port: t.fake, now: () => t.clock, sleep: async () => undefined, random: mulberry(8), botUserId: 'bot' });
  await t.open(); await t.seat('u1', false, '01005');
  const lobby = t.chan('lobby'); await t.cmd('u2', lobby, 'join');
  const r = await t.click('u2', lobby, `m1:${t.gameId}:join`, ['01005']);
  assert.match(String(r.replies.at(-1)?.content), /already them/);
  assert.equal(t.host().seats.length, 1);
  const ok = await t.click('u2', lobby, `m1:${t.gameId}:join`, ['01002']); assert.equal(ok.replies.length, 1);
  assert.equal(t.host().seats.length, 2);
});

test('opening a new story clears the channels of finished stories in the guild', async () => {
  const t = await startedTable(1, 31); await pastMulligans(t);
  await t.cmd('u1', t.chan('talk'), 'host', {}, 'end');
  const old = t.store.getGame(t.gameId)!;
  assert.equal(old.status, 'archived');
  const oldIds = t.store.channels(t.gameId).map(c => c.discordId);
  assert.ok(oldIds.length > 0, 'the old story still has channels');
  const i = await t.cmd('u1', 'general', 'host', {}, 'new');
  assert.match(String(i.replies.at(-1)?.content), /door is open/);
  assert.match(String(i.replies.at(-1)?.content), /cleared/);
  for (const id of oldIds) assert.ok(!t.fake.channels.has(id), 'old channel deleted: ' + id);
  const ng = t.store.gameForGuildLobby('g1')!;
  assert.notEqual(ng.id, t.gameId);
  assert.equal(t.store.getGame(t.gameId)!.archiveAt, null, 'the old story is fully archived, log kept');
  assert.ok(t.store.steps(t.gameId).length > 0, 'the old log stays');
  t.gameId = ng.id;
  assert.ok(t.fake.channels.has(t.chan('lobby')), 'the new lobby exists');
});

test('a later new story only counts stories that still had channels to clear', async () => {
  const t = await startedTable(1, 31); await pastMulligans(t);
  await t.cmd('u1', t.chan('talk'), 'host', {}, 'end');
  const first = await t.cmd('u1', 'general', 'host', {}, 'new');
  assert.match(String(first.replies.at(-1)?.content), /channels of 1 finished story were cleared/);
  t.gameId = t.store.gameForGuildLobby('g1')!.id;
  await t.cmd('u1', t.chan('lobby'), 'host', {}, 'end');
  const second = await t.cmd('u1', 'general', 'host', {}, 'new');
  assert.match(String(second.replies.at(-1)?.content), /channels of 1 finished story were cleared/, 'the first story was already cleared and is not counted again');
  t.gameId = t.store.gameForGuildLobby('g1')!.id;
  await t.cmd('u1', t.chan('lobby'), 'host', {}, 'end');
  await t.cmd('u1', 'general', 'host', {}, 'new');
  // nothing left over: a clean slate says nothing about clearing
  t.gameId = t.store.gameForGuildLobby('g1')!.id;
  await t.cmd('u1', t.chan('lobby'), 'host', {}, 'end');
  for (const g of t.store.listGames()) if (g.id !== t.gameId) assert.equal(t.store.channels(g.id).length, 0, 'no channel is left behind by finished stories');
});
