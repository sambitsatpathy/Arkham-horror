// The only surface the adapter uses to talk to Discord. discord.ts implements it for real;
// fake.ts implements it in memory so the whole pipeline can be tested without a server.

export type Perm = 'view' | 'send' | 'history';
export interface Overwrite { id: string; kind: 'role' | 'member'; allow: Perm[]; deny: Perm[] }
export interface ChannelSpec { name: string; type: 'category' | 'text'; parent?: string | null; topic?: string; overwrites: Overwrite[] }
export interface ChannelInfo { id: string; name: string; topic: string; parent: string | null; type: 'category' | 'text'; overwrites: Overwrite[] }

export type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger';
export interface ButtonSpec { id: string; label: string; style?: ButtonStyle; disabled?: boolean }
export interface SelectOption { value: string; label: string; description?: string }
export interface SelectSpec { id: string; placeholder: string; options: SelectOption[]; min: number; max: number }
export type Row = { buttons: ButtonSpec[] } | { select: SelectSpec };
export interface EmbedSpec { title?: string; description?: string; fields?: { name: string; value: string; inline?: boolean }[]; footer?: string; image?: string; thumbnail?: string }
export interface MessageBody {
  content?: string; embeds?: EmbedSpec[]; rows?: Row[];
  ping?: string[];                  // user ids allowed to be mentioned. Everything else is sent with mentions off
  narrator?: boolean;               // send through the narrator persona (a webhook) when the port supports it
  ephemeral?: boolean;              // only meaningful as an interaction reply
}

export interface DiscordPort {
  createRole(guildId: string, name: string): Promise<string>;
  deleteRole(guildId: string, roleId: string): Promise<void>;
  createChannel(guildId: string, spec: ChannelSpec): Promise<string>;
  editChannel(channelId: string, patch: Partial<Pick<ChannelSpec, 'name' | 'topic' | 'parent' | 'overwrites'>>): Promise<void>;
  getChannel(channelId: string): Promise<ChannelInfo | null>;
  deleteChannel(channelId: string): Promise<void>;
  send(channelId: string, body: MessageBody): Promise<string>;
  /** Returns false when the message no longer exists, so the caller can repost. */
  edit(channelId: string, messageId: string, body: MessageBody): Promise<boolean>;
  remove(channelId: string, messageId: string): Promise<void>;
  pin(channelId: string, messageId: string): Promise<void>;
  hasMember(guildId: string, userId: string): Promise<boolean>;
  grantRole(guildId: string, userId: string, roleId: string): Promise<void>;
  /** Names of permissions the bot lacks in this guild, for /host check. Optional so simple ports can skip it. */
  missingPermissions?(guildId: string): Promise<string[]>;
}

export interface ModalSpec { id: string; title: string; inputs: { id: string; label: string; max: number; required?: boolean }[] }

/** One incoming interaction, already stripped of library types. */
export interface Incoming {
  id: string; guildId: string; channelId: string; userId: string; userName: string;
  kind: 'command' | 'button' | 'select' | 'modal' | 'autocomplete';
  command?: string; sub?: string;
  options: Record<string, string | number | boolean | undefined>;
  customId?: string; values?: string[];
  focused?: { name: string; value: string };
  modalValues?: Record<string, string>;
  isAdmin?: boolean; roles?: string[];
  /** Acknowledge now (ephemeral reply, or a deferred update for component presses). */
  defer(opts?: { update?: boolean }): Promise<void>;
  /** Final ephemeral reply (edits the deferred one if there is one). */
  reply(body: MessageBody): Promise<void>;
  /** Replace the message the component sits on. */
  update(body: MessageBody): Promise<void>;
  choices(list: { name: string; value: string }[]): Promise<void>;
  showModal(spec: ModalSpec): Promise<void>;
}
