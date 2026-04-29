require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { token } = require('./config');
const { getDb } = require('./db/database');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

client.commands = new Collection();

// Load all commands recursively from commands/
function loadCommands(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommands(full);
    } else if (entry.name.endsWith('.js')) {
      const command = require(full);
      if (command.data && command.execute) {
        client.commands.set(command.data.name, command);
      }
    }
  }
}

loadCommands(path.join(__dirname, 'commands'));

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  getDb();
  // Pre-fetch bot's own member in each guild so permission checks work
  for (const [, guild] of client.guilds.cache) {
    await guild.members.fetch(client.user.id).catch(() => {});
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try { await command.autocomplete(interaction); } catch (e) {
        console.error(`Autocomplete error in /${interaction.commandName}:`, e.message);
        await interaction.respond([]).catch(() => {});
      }
    }
    return;
  }

  // Component interaction routing
  if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
    const customId = interaction.customId;

    if (customId.startsWith('mull:')) {
      const mulligan = client.commands.get('mulligan');
      if (!mulligan) return;
      try {
        if (interaction.isStringSelectMenu()) return await mulligan.handleSelect(interaction);
        if (interaction.isButton()) return await mulligan.handleButton(interaction);
      } catch (e) {
        console.error('Mulligan interaction error:', e);
        await interaction.reply({ content: `❌ Error: ${e.message}`, flags: 64 }).catch(() => {});
      }
      return;
    }

    if (customId.startsWith('ah:')) {
      const action = client.commands.get('action');
      if (!action) return;
      try {
        if (interaction.isButton()) return await action.handleButton(interaction);
        if (interaction.isStringSelectMenu()) return await action.handleSelect(interaction);
        if (interaction.isModalSubmit()) return await action.handleModal(interaction);
      } catch (e) {
        console.error('Action hub interaction error:', e);
        await interaction.reply({ content: `❌ Error: ${e.message}`, flags: 64 }).catch(() => {});
      }
      return;
    }

    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error in /${interaction.commandName}:`, err);
    const msg = { content: `❌ An error occurred: ${err.message}`, flags: 64 };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }

    // Log to #bot-log channel if available
    try {
      const guild = interaction.guild;
      if (guild) {
        const logCh = guild.channels.cache.find(c => c.name === 'bot-log');
        if (logCh) {
          await logCh.send(`❌ Error in \`/${interaction.commandName}\` (user: ${interaction.user.tag}):\n\`\`\`${err.stack?.slice(0, 1800) || err.message}\`\`\``);
        }
      }
    } catch (_) {}
  }
});

client.login(token);
