const { PermissionFlagsBits, ChannelType, PermissionsBitField } = require('discord.js');

const REQUIRED_PERMISSIONS = [
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
];

function checkBotPermissions(guild, botUserId) {
  const member = guild.members.cache.get(botUserId);
  if (!member) throw new Error('Bot member not found in guild cache.');
  const missing = member.permissions.missing(REQUIRED_PERMISSIONS);
  if (missing.length > 0) {
    throw new Error(`Bot is missing required permissions: ${missing.join(', ')}. Grant the bot Administrator in Server Settings → Roles.`);
  }
}

async function ensureRole(guild, name, color = null) {
  let role = guild.roles.cache.find(r => r.name === name);
  if (!role) {
    role = await guild.roles.create({ name, colors: [color ?? 0x5865f2] });
  }
  return role;
}

async function ensureCategory(guild, name, permissionOverwrites = []) {
  let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === name);
  if (!cat) {
    cat = await guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites });
  }
  return cat;
}

async function ensureChannel(guild, name, parent, permissionOverwrites = []) {
  let ch = guild.channels.cache.find(c => c.name === name && c.parentId === parent?.id);
  if (!ch) {
    ch = await guild.channels.create({ name, type: ChannelType.GuildText, parent: parent?.id, permissionOverwrites });
  }
  return ch;
}

async function buildGameServer(guild, scenario, investigators, botUserId) {
  checkBotPermissions(guild, botUserId);

  const everyone = guild.roles.everyone;
  const step = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      err.message = `[${label}] ${err.message}`;
      throw err;
    }
  };

  // GAME INFO category — all channels here are bot-only writes; players read only
  const readOnly = [
    { id: everyone.id, deny: [PermissionFlagsBits.SendMessages] },
    { id: botUserId,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
  ];

  const gameInfoCat = await step('create GAME INFO category', () => ensureCategory(guild, '📋 GAME INFO'));
  const doomCh      = await step('create doom-track',     () => ensureChannel(guild, 'doom-track',     gameInfoCat, readOnly));
  const agendaCh    = await step('create agenda',         () => ensureChannel(guild, 'agenda',         gameInfoCat, readOnly));
  const actCh       = await step('create act',            () => ensureChannel(guild, 'act',            gameInfoCat, readOnly));
  const chaosCh     = await step('create chaos-bag',      () => ensureChannel(guild, 'chaos-bag',      gameInfoCat, readOnly));
  const encounterCh = await step('create encounter-deck', () => ensureChannel(guild, 'encounter-deck', gameInfoCat, readOnly));

  const channelIds = {
    doom: doomCh.id, agenda: agendaCh.id, act: actCh.id,
    chaos: chaosCh.id, encounter: encounterCh.id,
  };

  // Act categories + location channels
  const locationChannelIds = {};
  for (const act of scenario.acts) {
    const isFirst = act.index === 0;
    const catName = `${isFirst ? '🔍' : '🔒'} ACT ${act.index + 1} — ${act.name}`;
    const overwrite = isFirst ? [] : [
      { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: botUserId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] },
    ];

    const actCat = await step(`create act category: ${catName}`, () => ensureCategory(guild, catName, overwrite));

    for (const loc of scenario.locations.filter(l => l.act_index === act.index)) {
      const prefix = loc.start_revealed ? 'revealed-' : 'hidden-';
      const chName = prefix + loc.name.toLowerCase().replace(/\s+/g, '-');
      const locPerms = [
        { id: botUserId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
        ...(loc.start_revealed ? [] : [{ id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] }]),
      ];
      const locCh = await step(`create location channel: ${chName}`, () => ensureChannel(guild, chName, actCat, locPerms));
      locationChannelIds[loc.code] = locCh.id;
    }
  }

  // Private hand channels per investigator
  const handChannelIds = {};
  for (const inv of investigators) {
    const safeName = inv.investigator_name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-hand';
    const handCh = await step(`create hand channel: ${safeName}`, () =>
      guild.channels.create({
        name: safeName,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: inv.discord_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: botUserId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
        ],
      })
    );
    handChannelIds[inv.discord_id] = handCh.id;
  }

  return { channelIds, locationChannelIds, handChannelIds };
}

async function teardownGameChannels(guild) {
  await guild.channels.fetch();

  const isGameCategory = c =>
    c.type === ChannelType.GuildCategory && (
      c.name.startsWith('📋') ||
      c.name.startsWith('🔍') ||
      c.name.startsWith('🔒') ||
      c.name.includes('ACT ')
    );

  const gameCategories = [...guild.channels.cache.filter(isGameCategory).values()];
  const categoryIds = new Set(gameCategories.map(c => c.id));

  // Collect children of game categories
  const children = [...guild.channels.cache.filter(c => categoryIds.has(c.parentId)).values()];

  // Hand channels not in any category
  const handChannels = [...guild.channels.cache.filter(c =>
    c.type === ChannelType.GuildText &&
    c.name.endsWith('-hand') &&
    !c.parentId
  ).values()];

  // Pass 1: delete all text/voice channels inside game categories + hand channels
  for (const ch of [...children, ...handChannels]) {
    try {
      await ch.permissionOverwrites.set([]);
      await ch.delete();
    } catch (e) {
      console.error(`Failed to delete channel ${ch.name}:`, e.message);
    }
  }

  // Pass 2: delete the now-empty categories
  // Strip all permission overwrites first so the bot can always access locked categories
  for (const cat of gameCategories) {
    try {
      await cat.permissionOverwrites.set([]);
      await cat.delete();
    } catch (e) {
      console.error(`Failed to delete category ${cat.name}:`, e.message);
    }
  }
}

module.exports = { buildGameServer, teardownGameChannels, ensureRole, ensureChannel };
