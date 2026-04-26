require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { token, clientId, guildId } = require('./config');

const commands = [];

function loadCommands(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommands(full);
    } else if (entry.name.endsWith('.js')) {
      const command = require(full);
      if (command.data) commands.push(command.data.toJSON());
    }
  }
}

loadCommands(path.join(__dirname, 'commands'));

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  console.log(`Deploying ${commands.length} slash commands to guild ${guildId}…`);
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('✅ Slash commands deployed.');
  } catch (err) {
    console.error('❌ Failed to deploy commands:', err);
  }
})();
