// Register every slash command for one guild in a single bulk overwrite (guild commands update immediately).
//   DISCORD_TOKEN=... APP_ID=... GUILD_ID=... npm run register
// (or put those three in .env at the project root and just run `npm run register`)
import '../load-env.ts';
import { REST, Routes } from 'discord.js';
import { COMMANDS } from '../src/adapter/commands.ts';

const { DISCORD_TOKEN: token, APP_ID: app, GUILD_ID: guild } = process.env;
if (!token || !app || !guild) { console.error('Set DISCORD_TOKEN, APP_ID and GUILD_ID.'); process.exit(1); }
const rest = new REST({ version: '10' }).setToken(token);
const out = await rest.put(Routes.applicationGuildCommands(app, guild), { body: COMMANDS }) as unknown[];
console.log(`Registered ${out.length} commands.`);
