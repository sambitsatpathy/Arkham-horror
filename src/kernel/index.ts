import { loadCatalog } from './catalog.ts';
import { createEngine, type Engine } from './engine.ts';
import { gathering } from './scenario/gathering.ts';
import { playerScripts } from './scripts/player.ts';
import { player2Scripts } from './scripts/player2.ts';
import { encounterScripts } from './scripts/encounter.ts';

export function createDefaultEngine(dataDir: string): Engine {
  const cat = loadCatalog(dataDir);
  return createEngine(cat, gathering, [playerScripts, player2Scripts, encounterScripts]);
}

export * from './types.ts';
export { step, start, legalActions, createEngine } from './engine.ts';
export type { Engine } from './engine.ts';
export { setupGame, type GameConfig, type SeatConfig } from './setup.ts';
export { validateDeck, ROLAND_STARTER, STARTERS } from './deck.ts';
export { loadCatalog } from './catalog.ts';
