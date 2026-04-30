const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { requireHost, resetDb } = require('../../engine/gameState');
const { teardownGameChannels } = require('../../engine/serverBuilder');

const SYSTEM_CHANNELS = ['pre-game', 'bot-log'];

async function cloneAndClear(guild, channelName) {
  const ch = guild.channels.cache.find(c => c.name === channelName);
  if (!ch) {
    // Channel doesn't exist — create it fresh
    const created = await guild.channels.create({ name: channelName, type: ChannelType.GuildText });
    await created.send(`🧹 Channel created fresh.`);
    return;
  }
  const position = ch.position;
  const parent = ch.parentId;
  const clone = await ch.clone({ reason: '/clear command' });
  await clone.setPosition(position);
  if (parent) await clone.setParent(parent, { lockPermissions: false });
  await ch.delete();
  await clone.send(`🧹 Channel cleared.`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear messages or wipe the entire server. Host only.')
    .addStringOption(opt =>
      opt.setName('scope')
        .setDescription('What to clear')
        .setRequired(true)
        .addChoices(
          { name: '#pre-game only',  value: 'pre-game' },
          { name: '#bot-log only',   value: 'bot-log'  },
          { name: 'System channels (pre-game + bot-log)', value: 'system' },
          { name: 'Everything (all game + system channels)', value: 'all' },
        )),

  async execute(interaction) {
    const host = requireHost(interaction);
    if (!host) return;

    const scope = interaction.options.getString('scope');

    await interaction.reply({ content: `🧹 Clearing **${scope}**…`, flags: 64 });

    if (scope === 'pre-game' || scope === 'bot-log') {
      await cloneAndClear(interaction.guild, scope);
      return;
    }

    if (scope === 'system') {
      for (const name of SYSTEM_CHANNELS) {
        await cloneAndClear(interaction.guild, name);
      }
      return;
    }

    if (scope === 'all') {
      // 1. Tear down all game channels (categories, locations, hand channels)
      await teardownGameChannels(interaction.guild);

      // 2. Wipe all DB tables
      resetDb();

      // 3. Remove host role
      const hostRole = interaction.guild.roles.cache.find(r => r.name === '🎲 Game Host');
      if (hostRole) await hostRole.delete().catch(() => {});

      // 4. Clear system channels
      for (const name of SYSTEM_CHANNELS) {
        await cloneAndClear(interaction.guild, name);
      }
    }
  },
};
