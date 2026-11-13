// Run the bot. Configuration is by environment variable, or by a .env file at the
// project root (load-env.ts reads it before anything below runs):
//   DISCORD_TOKEN       bot token (required)
//   ARKHAM_DATA         path to your clone of Kamalisk/arkhamdb-json-data (defaults to
//                       the bundled ./arkhamdb-json-data-master folder; card data is not
//                       shipped with this project)
//   DB_PATH             SQLite file (default ./arkham.sqlite)
//   HOST_ROLE_ID        optional role allowed to use /host
//   ARCHIVE_CATEGORY_ID optional category finished games are moved under
//   NARRATOR_WEBHOOK=1  post plain narration through a webhook persona instead of as the bot
//   CARD_IMAGES         off hides card faces (default on)
//   CARD_IMAGE_BASE / CARD_IMAGE_EXT  where card faces are linked from
import '../load-env.ts';
import { configureArt } from './adapter/art.ts';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDefaultEngine } from './kernel/index.ts';
import { Store } from './adapter/store.ts';
import { Bot } from './adapter/bot.ts';
import { DiscordJsPort, wrap } from './adapter/discord.ts';

configureArt(process.env);
const token = process.env.DISCORD_TOKEN;
const dataDir = process.env.ARKHAM_DATA
  ?? fileURLToPath(new URL('../arkhamdb-json-data-master/', import.meta.url));
if (!token) { console.error('Set DISCORD_TOKEN.'); process.exit(1); }
if (!dataDir || !existsSync(dataDir + '/pack/core/core.json')) { console.error('Set ARKHAM_DATA to your clone of arkhamdb-json-data (it must contain pack/core/core.json).'); process.exit(1); }

const E = createDefaultEngine(dataDir);
if (E.cat.loadErrors.length) console.warn(`${E.cat.loadErrors.length} card(s) failed to load:`, E.cat.loadErrors.slice(0, 5));
const store = new Store(process.env.DB_PATH ?? './arkham.sqlite');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const port = new DiscordJsPort(client, { useWebhook: process.env.NARRATOR_WEBHOOK === '1' });
const bot = new Bot({ E, store, port, now: () => Date.now(), hostRoleId: process.env.HOST_ROLE_ID ?? null, archiveCategoryId: process.env.ARCHIVE_CATEGORY_ID ?? null, botUserId: undefined });

client.once(Events.ClientReady, async c => {
  bot.d.botUserId = c.user.id;
  console.log(`Logged in as ${c.user.tag}`);
  await bot.boot();                                   // load every game from the log and repair channels and panels
  setInterval(() => { bot.tick().catch(e => console.error('tick', e)); }, 15_000);
});
client.on(Events.InteractionCreate, i => { const w = wrap(i); if (w) bot.handle(w).catch(e => console.error('interaction', e)); });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { console.log('Shutting down.'); client.destroy().finally(() => { store.close(); process.exit(0); }); });
await client.login(token);
