// The real Discord, behind the same DiscordPort the tests use. This file is a thin translation layer and holds no game logic.
// It type-checks against discord.js 14 but has NOT been run against a live server in this build: treat the first deploy as a test.
import {
  ActionRowBuilder, ApplicationCommandOptionType, AutocompleteInteraction, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelType, ChatInputCommandInteraction, EmbedBuilder,
  GuildMember, MessageFlags, ModalBuilder, ModalSubmitInteraction, OverwriteType, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuInteraction, TextInputBuilder, TextInputStyle,
  type Client, type Guild, type GuildBasedChannel, type Interaction, type PermissionResolvable, type TextChannel, type Webhook,
} from 'discord.js';
import type { ChannelInfo, ChannelSpec, DiscordPort, EmbedSpec, Incoming, MessageBody, ModalSpec, Overwrite, Perm, Row } from './port.ts';

const PERM: Record<Perm, bigint> = { view: PermissionFlagsBits.ViewChannel, send: PermissionFlagsBits.SendMessages, history: PermissionFlagsBits.ReadMessageHistory };
const STYLE = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger } as const;
export const REQUIRED_PERMISSIONS: [string, bigint][] = [
  ['View Channels', PermissionFlagsBits.ViewChannel], ['Send Messages', PermissionFlagsBits.SendMessages], ['Embed Links', PermissionFlagsBits.EmbedLinks],
  ['Read Message History', PermissionFlagsBits.ReadMessageHistory], ['Manage Channels', PermissionFlagsBits.ManageChannels], ['Manage Roles', PermissionFlagsBits.ManageRoles],
  ['Manage Messages', PermissionFlagsBits.ManageMessages], ['Manage Webhooks', PermissionFlagsBits.ManageWebhooks],
];

const trunc = (s: string | undefined, n: number) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

function embeds(e: EmbedSpec[] | undefined): EmbedBuilder[] {
  return (e ?? []).map(x => {
    const b = new EmbedBuilder();
    if (x.title) b.setTitle(trunc(x.title, 256)!); if (x.description) b.setDescription(trunc(x.description, 4096)!);
    if (x.fields?.length) b.addFields(x.fields.slice(0, 25).map(f => ({ name: trunc(f.name, 256) || '​', value: trunc(f.value, 1024) || '​', inline: !!f.inline })));
    if (x.image) b.setImage(x.image); if (x.thumbnail) b.setThumbnail(x.thumbnail);
    if (x.footer) b.setFooter({ text: trunc(x.footer, 2048)! });
    return b;
  });
}
function rows(r: Row[] | undefined) {
  return (r ?? []).slice(0, 5).map(row => {
    if ('buttons' in row) return new ActionRowBuilder<ButtonBuilder>().addComponents(row.buttons.slice(0, 5).map(b => new ButtonBuilder().setCustomId(b.id).setLabel(trunc(b.label, 80)!).setStyle(STYLE[b.style ?? 'secondary']).setDisabled(!!b.disabled)));
    const s = row.select;
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(s.id).setPlaceholder(trunc(s.placeholder, 150)!).setMinValues(s.min).setMaxValues(Math.max(s.min, s.max))
      .addOptions(s.options.slice(0, 25).map(o => ({ label: trunc(o.label, 100) || '—', value: o.value, ...(o.description ? { description: trunc(o.description, 100) } : {}) }))));
  });
}
/** Every message goes out with mentions off, except the users a prompt is deliberately pinging. */
export function toDiscord(b: MessageBody) {
  return { content: b.content ?? '', embeds: embeds(b.embeds), components: rows(b.rows), allowedMentions: { parse: [] as never[], users: b.ping ?? [] } };
}

function toOverwrites(o: Overwrite[]) {
  const bits = (ps: Perm[]) => ps.map(p => PERM[p]);
  return o.map(x => ({ id: x.id, type: x.kind === 'role' ? OverwriteType.Role : OverwriteType.Member, allow: bits(x.allow), deny: bits(x.deny) }));
}
function fromOverwrites(ch: GuildBasedChannel): Overwrite[] {
  const cache = 'permissionOverwrites' in ch ? ch.permissionOverwrites.cache : null; if (!cache) return [];
  const pick = (bf: { has(p: bigint): boolean }) => (Object.keys(PERM) as Perm[]).filter(p => bf.has(PERM[p]));
  return [...cache.values()].map(o => ({ id: o.id, kind: o.type === OverwriteType.Role ? 'role' as const : 'member' as const, allow: pick(o.allow), deny: pick(o.deny) }));
}

export class DiscordJsPort implements DiscordPort {
  private webhooks = new Map<string, Webhook>();
  private client: Client; private opts: { narratorName?: string; narratorAvatar?: string; useWebhook?: boolean };
  constructor(client: Client, opts: { narratorName?: string; narratorAvatar?: string; useWebhook?: boolean } = {}) { this.client = client; this.opts = opts; }

  private async guild(id: string): Promise<Guild> { return this.client.guilds.fetch(id); }
  private async text(id: string): Promise<TextChannel> {
    const c = await this.client.channels.fetch(id);
    if (!c || c.type !== ChannelType.GuildText) throw new Error('not a text channel: ' + id);
    return c;
  }
  async createRole(guildId: string, name: string) { return (await (await this.guild(guildId)).roles.create({ name, permissions: [], mentionable: false })).id; }
  async deleteRole(guildId: string, roleId: string) { await (await this.guild(guildId)).roles.delete(roleId); }
  async createChannel(guildId: string, spec: ChannelSpec) {
    const g = await this.guild(guildId);
    const c = await g.channels.create(spec.type === 'category'
      ? { name: spec.name, type: ChannelType.GuildCategory, permissionOverwrites: toOverwrites(spec.overwrites) }
      : { name: spec.name, type: ChannelType.GuildText, topic: spec.topic, parent: spec.parent ?? undefined, permissionOverwrites: toOverwrites(spec.overwrites) });
    return c.id;
  }
  async editChannel(id: string, patch: Partial<Pick<ChannelSpec, 'name' | 'topic' | 'parent' | 'overwrites'>>) {
    const c = await this.client.channels.fetch(id); if (!c || !('edit' in c)) throw new Error('no such channel ' + id);
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = patch.name; if (patch.topic !== undefined) data.topic = patch.topic;
    if (patch.parent !== undefined) data.parent = patch.parent; if (patch.overwrites) data.permissionOverwrites = toOverwrites(patch.overwrites);
    await (c as TextChannel).edit(data);
  }
  async getChannel(id: string): Promise<ChannelInfo | null> {
    try {
      const c = await this.client.channels.fetch(id, { force: true }); if (!c || !('guild' in c)) return null;
      const ch = c as GuildBasedChannel;
      return { id, name: ch.name, topic: 'topic' in ch ? ch.topic ?? '' : '', parent: ch.parentId ?? null, type: ch.type === ChannelType.GuildCategory ? 'category' : 'text', overwrites: fromOverwrites(ch) };
    } catch (e) { if ((e as { code?: number }).code === 10003) return null; throw e; }
  }
  async deleteChannel(id: string) { const c = await this.client.channels.fetch(id).catch(() => null); if (c && 'delete' in c) await c.delete(); }

  private async hook(ch: TextChannel): Promise<Webhook | null> {
    const cached = this.webhooks.get(ch.id); if (cached) return cached;
    try {
      const mine = (await ch.fetchWebhooks()).find(w => w.owner?.id === this.client.user?.id && w.name === (this.opts.narratorName ?? 'The Narrator'))
        ?? await ch.createWebhook({ name: this.opts.narratorName ?? 'The Narrator', avatar: this.opts.narratorAvatar });
      this.webhooks.set(ch.id, mine); return mine;
    } catch { return null; }
  }
  async send(channelId: string, body: MessageBody) {
    const ch = await this.text(channelId); const payload = toDiscord(body);
    // narration goes through the narrator persona when allowed; messages with buttons stay ordinary bot messages so the buttons are reliable
    if (body.narrator && this.opts.useWebhook && !body.rows?.length) {
      const h = await this.hook(ch);
      if (h) return (await h.send({ content: payload.content, username: this.opts.narratorName ?? 'The Narrator', allowedMentions: payload.allowedMentions })).id;
    }
    return (await ch.send(payload)).id;
  }
  async edit(channelId: string, messageId: string, body: MessageBody) {
    try { const m = await (await this.text(channelId)).messages.fetch(messageId); await m.edit(toDiscord(body)); return true; }
    catch (e) { if ((e as { code?: number }).code === 10008) return false; throw e; }
  }
  async remove(channelId: string, messageId: string) { try { await (await this.text(channelId)).messages.delete(messageId); } catch { /* already gone */ } }
  async pin(channelId: string, messageId: string) { const m = await (await this.text(channelId)).messages.fetch(messageId); await m.pin(); }
  async hasMember(guildId: string, userId: string) { try { await (await this.guild(guildId)).members.fetch(userId); return true; } catch { return false; } }
  async grantRole(guildId: string, userId: string, roleId: string) { const m = await (await this.guild(guildId)).members.fetch(userId); if (!m.roles.cache.has(roleId)) await m.roles.add(roleId); }
  async missingPermissions(guildId: string) {
    const me = (await this.guild(guildId)).members.me; if (!me) return ['(could not read my own member)'];
    return REQUIRED_PERMISSIONS.filter(([, p]) => !me.permissions.has(p as PermissionResolvable)).map(([n]) => n);
  }
}

// ───────────────────────────────────────────────────────────────────────── interactions

type Any = ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction | AutocompleteInteraction;

export function wrap(i: Interaction): Incoming | null {
  if (!i.guildId || !i.channelId) return null;
  const any = i as Any; let acked = false; let updated = false;
  const member = i.member instanceof GuildMember ? i.member : null;
  const flat = (opts: readonly { name: string; value?: unknown; options?: readonly unknown[]; type: number }[], out: Record<string, string | number | boolean>) => {
    for (const o of opts) { if (o.type === ApplicationCommandOptionType.Subcommand) flat((o.options ?? []) as never, out); else if (o.value !== undefined) out[o.name] = o.value as string | number | boolean; }
  };
  const inc: Incoming = {
    id: i.id, guildId: i.guildId, channelId: i.channelId, userId: i.user.id, userName: member?.displayName ?? i.user.username,
    kind: i.isChatInputCommand() ? 'command' : i.isButton() ? 'button' : i.isStringSelectMenu() ? 'select' : i.isModalSubmit() ? 'modal' : i.isAutocomplete() ? 'autocomplete' : 'command',
    options: {}, isAdmin: !!member?.permissions.has(PermissionFlagsBits.Administrator) || !!member?.permissions.has(PermissionFlagsBits.ManageGuild), roles: member ? [...member.roles.cache.keys()] : [],
    async defer(o) {
      if (acked || i.isAutocomplete()) return; acked = true;
      if ((i.isButton() || i.isStringSelectMenu()) && o?.update) { updated = true; await i.deferUpdate(); } else await (any as ChatInputCommandInteraction).deferReply({ flags: MessageFlags.Ephemeral });
    },
    async reply(b) {
      const p = { ...toDiscord(b), flags: MessageFlags.Ephemeral } as const;
      if (!acked) { acked = true; await (any as ChatInputCommandInteraction).reply(p); }
      else if (updated) await (any as ButtonInteraction).followUp(p);
      else await (any as ChatInputCommandInteraction).editReply(toDiscord(b));
    },
    async update(b) { if (!acked && (i.isButton() || i.isStringSelectMenu())) { acked = true; updated = true; await i.update(toDiscord(b)); } else await (any as ButtonInteraction).editReply(toDiscord(b)); },
    async choices(list) { if (i.isAutocomplete()) await i.respond(list.slice(0, 25).map(c => ({ name: c.name.slice(0, 100), value: c.value.slice(0, 100) }))); },
    async showModal(m: ModalSpec) {
      if (!(i.isButton() || i.isStringSelectMenu() || i.isChatInputCommand())) return; acked = true;
      await i.showModal(new ModalBuilder().setCustomId(m.id).setTitle(m.title.slice(0, 45)).addComponents(m.inputs.map(x =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(x.id).setLabel(x.label.slice(0, 45)).setStyle(TextInputStyle.Paragraph).setMaxLength(Math.min(4000, x.max)).setRequired(x.required ?? false)))));
    },
  };
  if (i.isChatInputCommand()) {
    inc.command = i.commandName; inc.sub = i.options.getSubcommand(false) ?? undefined; flat(i.options.data as never, inc.options as Record<string, string | number | boolean>);
  } else if (i.isAutocomplete()) {
    inc.command = i.commandName; inc.sub = i.options.getSubcommand(false) ?? undefined; const f = i.options.getFocused(true); inc.focused = { name: f.name, value: String(f.value) };
  } else if (i.isButton()) inc.customId = i.customId;
  else if (i.isStringSelectMenu()) { inc.customId = i.customId; inc.values = i.values; }
  else if (i.isModalSubmit()) { inc.customId = i.customId; inc.modalValues = Object.fromEntries(i.fields.fields.map(f => [f.customId, 'value' in f ? String(f.value) : ''])); }
  return inc;
}
void (null as unknown as Guild);
