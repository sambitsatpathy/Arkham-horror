const { getPlayerById, decrementActions } = require('./gameState');

// Actions are only enforced during the investigation phase. Tests, plays and
// engages triggered by treacheries or enemy attacks happen outside a player's
// turn and must stay free.
function trySpendAction(playerId, session, { fast = false, cost = 1 } = {}) {
  if (fast) return { ok: true, remaining: null, note: '⚡ Fast — no action cost.' };
  if (!session || session.phase !== 'investigation') return { ok: true, remaining: null, note: null };
  const fresh = getPlayerById(playerId);
  const have = fresh?.action_count ?? 0;
  if (have < cost) return { ok: false, remaining: have, note: null };
  const remaining = decrementActions(playerId, cost);
  return { ok: true, remaining, note: `⏱️ -${cost} action${cost !== 1 ? 's' : ''} (${remaining} remaining).` };
}

function actionGuardMessage() {
  return '❌ No actions remaining this turn. Wait for the next investigation phase (host: `/nextphase`).';
}

module.exports = { trySpendAction, actionGuardMessage };
