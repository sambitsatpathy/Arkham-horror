// Loads .env from the project root into process.env before anything reads it.
// Uses Node's built-in env-file loader (Node >= 20.6), so there is no dependency.
// Existing environment variables are NOT overridden by .env.
//
// Import this first in any entry point that needs configuration:
//   import '../load-env.ts';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('./.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
