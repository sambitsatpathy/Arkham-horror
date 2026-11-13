// An in-memory Discord. Records everything so tests can assert on channels, permissions, messages and replies.
import type { ChannelInfo, ChannelSpec, DiscordPort, Incoming, MessageBody, ModalSpec, Overwrite } from './port.ts';

export interface FakeMessage { id: string; channelId: string; body: MessageBody; pinned: boolean; deleted: boolean }

export class FakeDiscord implements DiscordPort {
  channels = new Map<string, ChannelInfo>();
  messages = new Map<string, FakeMessage>();
  roles = new Set<string>();
  members = new Set<string>();
  calls: string[] = [];
  failNext: string | null = null;           // set to a method name to make its next calls throw (failTimes of them)
  failTimes = 1;
  private n = 1;
  private id(p: string) { return `${p}${this.n++}`; }
  private maybeFail(m: string) { this.calls.push(m); if (this.failNext === m && this.failTimes > 0) { if (--this.failTimes <= 0) this.failNext = null; throw new Error('fake outage in ' + m); } }

  async createRole(_g: string, name: string) { this.maybeFail('createRole'); const id = this.id('role'); this.roles.add(id); void name; return id; }
  async deleteRole(_g: string, id: string) { this.maybeFail('deleteRole'); this.roles.delete(id); }
  async createChannel(_g: string, spec: ChannelSpec) {
    this.maybeFail('createChannel'); const id = this.id('ch');
    this.channels.set(id, { id, name: spec.name, topic: spec.topic ?? '', parent: spec.parent ?? null, type: spec.type, overwrites: structuredClone(spec.overwrites) });
    return id;
  }
  async editChannel(id: string, patch: Partial<Pick<ChannelSpec, 'name' | 'topic' | 'parent' | 'overwrites'>>) {
    this.maybeFail('editChannel'); const c = this.channels.get(id); if (!c) throw new Error('no channel ' + id);
    if (patch.name !== undefined) c.name = patch.name;
    if (patch.topic !== undefined) c.topic = patch.topic;
    if (patch.parent !== undefined) c.parent = patch.parent;
    if (patch.overwrites) c.overwrites = structuredClone(patch.overwrites);
  }
  async getChannel(id: string) { const c = this.channels.get(id); return c ? structuredClone(c) : null; }
  async deleteChannel(id: string) { this.maybeFail('deleteChannel'); this.channels.delete(id); for (const m of this.messages.values()) if (m.channelId === id) m.deleted = true; }
  async send(channelId: string, body: MessageBody) {
    this.maybeFail('send'); if (!this.channels.has(channelId)) throw new Error('no channel ' + channelId);
    const id = this.id('m'); this.messages.set(id, { id, channelId, body: structuredClone(body), pinned: false, deleted: false }); return id;
  }
  async edit(channelId: string, messageId: string, body: MessageBody) {
    this.maybeFail('edit'); const m = this.messages.get(messageId);
    if (!m || m.deleted || m.channelId !== channelId) return false;
    m.body = structuredClone(body); return true;
  }
  async remove(_c: string, messageId: string) { const m = this.messages.get(messageId); if (m) m.deleted = true; }
  async pin(_c: string, messageId: string) { const m = this.messages.get(messageId); if (m) m.pinned = true; }
  async hasMember(_g: string, userId: string) { return this.members.has(userId); }
  roleMembers = new Map<string, Set<string>>();
  async grantRole(_g: string, userId: string, roleId: string) { this.maybeFail('grantRole'); (this.roleMembers.get(roleId) ?? this.roleMembers.set(roleId, new Set()).get(roleId)!).add(userId); }
  rolesOf(userId: string): string[] { return [...this.roleMembers].filter(([, s]) => s.has(userId)).map(([r]) => r); }

  // ── test helpers ──
  channelByName(name: string) { return [...this.channels.values()].find(c => c.name === name); }
  live(channelId: string) { return [...this.messages.values()].filter(m => m.channelId === channelId && !m.deleted); }
  text(channelId: string) {
    return this.live(channelId).map(m => [m.body.content, ...(m.body.embeds ?? []).flatMap(e => [e.title, e.description, ...(e.fields ?? []).map(f => `${f.name}: ${f.value}`)])].filter(Boolean).join('\n')).join('\n---\n');
  }
  /** Discord's order: @everyone first, then the member's roles (denies, then allows), then the member's own overwrite. Channels carry their full set (no inheritance). */
  can(channelId: string, perm: 'view' | 'send' | 'history', userId: string, userRoles: string[], everyoneId = 'g1'): boolean {
    const c = this.channels.get(channelId); if (!c) return false;
    if (perm !== 'view' && !this.can(channelId, 'view', userId, userRoles, everyoneId)) return false;   // no seeing, no speaking
    let ok = true;
    const step = (ows: Overwrite[]) => { if (ows.some(o => o.deny.includes(perm))) ok = false; if (ows.some(o => o.allow.includes(perm))) ok = true; };
    step(c.overwrites.filter(o => o.kind === 'role' && o.id === everyoneId));
    step(c.overwrites.filter(o => o.kind === 'role' && userRoles.includes(o.id)));
    step(c.overwrites.filter(o => o.kind === 'member' && o.id === userId));
    return ok;
  }
}

export interface FakeIncomingOpts {
  guildId?: string; channelId: string; userId: string; userName?: string;
  kind: Incoming['kind']; command?: string; sub?: string; options?: Incoming['options']; customId?: string; values?: string[];
  focused?: Incoming['focused']; modalValues?: Record<string, string>;
}
export interface FakeIncoming extends Incoming { replies: MessageBody[]; updates: MessageBody[]; deferred: boolean; choiceList: { name: string; value: string }[]; modal: ModalSpec | null }
let seq = 1;
export function fakeIncoming(o: FakeIncomingOpts): FakeIncoming {
  const x: FakeIncoming = {
    id: 'i' + seq++, guildId: o.guildId ?? 'g1', channelId: o.channelId, userId: o.userId, userName: o.userName ?? o.userId,
    kind: o.kind, command: o.command, sub: o.sub, options: o.options ?? {}, customId: o.customId, values: o.values, focused: o.focused, modalValues: o.modalValues,
    replies: [], updates: [], deferred: false, choiceList: [], modal: null,
    async defer() { x.deferred = true; },
    async reply(b) { x.replies.push(b); },
    async update(b) { x.updates.push(b); },
    async choices(l) { x.choiceList = l; },
    async showModal(m) { x.modal = m; },
  };
  return x;
}
