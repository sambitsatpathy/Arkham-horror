// The plain-numbers layer under the story: what was needed, what was rolled, whether it went through, and what it cost.
// It is built only from event fields (never from story text), so it can say exactly what happened without touching the voice.
// Words here are the plain ones a player would use out loud: passed, failed, hit, damage, horror, health, sanity.
import type { GameEvent, GameState } from '../../kernel/types.ts';

const MINUS = '−';
export const signed = (n: number) => (n < 0 ? `${MINUS}${Math.abs(n)}` : `+${n}`);
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

const TOKEN_NAME: Record<string, string> = { skull: 'Skull', cultist: 'Cultist', tablet: 'Tablet', elder_thing: 'Elder Thing', elder_sign: 'Elder Sign', autofail: 'Auto-fail' };
export function tokenLabel(tok: string, mod: number): string {
  if (/^[+-]?\d+$/.test(tok)) return signed(Number(tok));
  return tok === 'autofail' ? 'Auto-fail' : `${TOKEN_NAME[tok] ?? tok} (${signed(mod)})`;
}
const KIND_NAME: Record<string, string> = { investigate: 'Investigate', fight: 'Fight', evade: 'Evade', parley: 'Talk' };
const SKILL_NAME: Record<string, string> = { willpower: 'willpower', intellect: 'intellect', combat: 'combat', agility: 'agility' };

/** Tokens drawn, as a short phrase: `−1`, or `Skull (−2) and +1`. Older logs without per-token numbers fall back to the total. */
export function tokensPhrase(e: Record<string, unknown>): string {
  const per = Array.isArray(e.perToken) ? (e.perToken as { token: string; mod: number }[]) : null;
  if (per?.length) return per.map(p => tokenLabel(p.token, p.mod)).join(' and ');
  const toks = (Array.isArray(e.tokens) ? e.tokens : []).filter((x): x is string => typeof x === 'string');
  return toks.length ? toks.map(t => tokenLabel(t, 0)).join(' and ') : 'nothing drawn';
}

/** The sum, written out: `Skill 3 + 1 lent − 1 token = 3 against difficulty 3`. */
export function mathsLine(e: Record<string, unknown>): string {
  const base = num(e.base, num(e.skillValue)), lent = num(e.lent), bonus = num(e.bonus), mod = num(e.tokenMod);
  const parts = [`Skill ${base}`];
  if (lent) parts.push(`${lent < 0 ? MINUS : '+'} ${Math.abs(lent)} lent`);
  if (bonus) parts.push(`${bonus < 0 ? MINUS : '+'} ${Math.abs(bonus)} from gear`);
  if (e.autofail) return `${parts.join(' ')}, but the auto-fail token counts as 0 = **0** against difficulty **${num(e.difficulty)}**`;
  parts.push(`${mod < 0 ? MINUS : '+'} ${Math.abs(mod)} token`);
  return `${parts.join(' ')} = **${num(e.total)}** against difficulty **${num(e.difficulty)}**`;
}

export function testHeadline(e: Record<string, unknown>): string {
  const ok = e.outcome === 'success'; const margin = num(e.margin);
  const src = str(e.sourceName); const kind = KIND_NAME[str(e.testKind)] ?? (src && src !== 'investigation' ? src : 'Test');
  const skill = SKILL_NAME[str(e.skill)] ?? '';
  const what = `${kind}${skill ? ` (${skill})` : ''}`;
  if (e.autofail) return `❌ **Failed** — ${what}: auto-fail`;
  return ok ? `✅ **Passed** — ${what}, by ${margin}` : `❌ **Failed** — ${what}, short by ${margin}`;
}

function testStrip(e: Record<string, unknown>): string {
  const ok = e.outcome === 'success'; const kind = str(e.testKind); const foe = str(e.enemyName, 'the foe');
  const lines = [testHeadline(e), mathsLine(e), `Drew: ${tokensPhrase(e)}`];
  const names = Array.isArray(e.committedNames) ? (e.committedNames as string[]) : [];
  if (names.length) lines[1] += ` (lent: ${names.join(', ')})`;
  if (!ok) {
    if (kind === 'fight') lines.push(`The attack misses ${foe}: no damage dealt.`);
    else if (kind === 'evade') lines.push(`Still caught by ${foe}.`);
    else if (kind === 'investigate') lines.push('No lead found.');
  }
  return lines.map((l, i) => (i === 0 ? l : `> ${l}`)).join('\n');
}

const left = (taken: number, max: number) => `${Math.max(0, max - taken)}/${max}`;
function harmWords(dmg: number, hor: number): string {
  const p = [dmg > 0 ? `**${dmg} damage**` : '', hor > 0 ? `**${hor} horror**` : ''].filter(Boolean);
  return p.length ? p.join(' and ') : '**nothing**';
}

/** `consumed`: harm events whose numbers were folded into the attack line, so they carry no line of their own (their story line stays). */
export interface Strips { lines: Map<number, string>; consumed: Set<number> }

/** One pass over a step's events. An attack gathers the harm it caused into a single line; harm with no attack in the step stands alone. */
export function buildStrips(events: GameEvent[], s: GameState): Strips {
  const lines = new Map<number, string>(); const consumed = new Set<number>();
  const nameOf = (seat: unknown) => (typeof seat === 'string' && s.investigators[seat] ? s.investigators[seat]!.name : 'Someone');
  events.forEach((e, i) => {
    const d = e as Record<string, unknown>;
    switch (e.kind) {
      case 'testResolved': lines.set(i, testStrip(d)); break;
      case 'enemyAttacks': {
        const dmg = num(d.damage), hor = num(d.horror); let tookD = 0, tookH = 0; let last: Record<string, unknown> | null = null; let cancelled = false;
        for (let j = i + 1; j < events.length; j++) {
          const n = events[j]! as Record<string, unknown>;
          if (n.kind === 'enemyAttacks') break;
          if (n.kind === 'attackCancelled') { cancelled = true; break; }
          if ((n.kind === 'damageTaken' || n.kind === 'horrorTaken') && n.seat === d.seat && n.source === d.name) {
            consumed.add(j); if (n.kind === 'damageTaken') tookD += num(n.amount); else tookH += num(n.amount); last = n;
          }
        }
        const who = nameOf(d.seat); const foe = str(d.name, 'it'); const inv = typeof d.seat === 'string' ? s.investigators[d.seat] : undefined;
        if (cancelled) lines.set(i, `🛡️ ${foe}'s attack on ${who} is stopped: **no damage**.`);
        else if (!dmg && !hor) lines.set(i, `⚔️ ${foe} attacks ${who}: **no damage** (nothing printed to deal).`);
        else if (last) lines.set(i, `⚔️ ${foe} hits ${who} for ${harmWords(tookD, tookH)}${inv ? ` — health ${left(inv.damage, inv.maxHealth)} · sanity ${left(inv.horror, inv.maxSanity)}` : ''}`);
        else lines.set(i, `⚔️ ${foe} attacks ${who}: up to ${harmWords(dmg, hor)} — who takes it is still being decided.`);
        break;
      }
      case 'damageTaken': case 'horrorTaken': {
        if (consumed.has(i)) break;
        const dmg = e.kind === 'damageTaken'; const amt = num(d.amount); const unit = dmg ? 'damage' : 'horror'; const src = str(d.source);
        if (d.target === 'ally') lines.set(i, `${dmg ? '💥' : '🌀'} ${str(d.name, 'An ally')} takes **${amt} ${unit}**${src ? ` from ${src}` : ''} (${left(num(d.now), num(d.max))} left)`);
        else lines.set(i, `${dmg ? '💥' : '🌀'} ${nameOf(d.seat)} takes **${amt} ${unit}**${src ? ` from ${src}` : ''} — ${dmg ? 'health' : 'sanity'} ${left(num(d.now), num(d.max))}`);
        break;
      }
      case 'enemyDamaged': {
        const total = num(d.total), health = num(d.health); const dead = health > 0 && total >= health;
        lines.set(i, `🗡️ **Hit!** ${str(d.name, 'The foe')} takes **${num(d.amount)} damage** — ${dead ? '**defeated**' : `${Math.max(0, health - total)} of ${health} health left`}`);
        break;
      }
      case 'clueDiscovered': lines.set(i, `🔎 **${num(d.count)} ${num(d.count) === 1 ? 'lead' : 'leads'}** found — ${num(d.remaining)} left here`); break;
      case 'healed': {
        const bits = [num(d.damage) ? `${num(d.damage)} damage` : '', num(d.horror) ? `${num(d.horror)} horror` : ''].filter(Boolean);
        if (bits.length) { const inv = typeof d.seat === 'string' ? s.investigators[d.seat] : undefined; lines.set(i, `💚 ${nameOf(d.seat)} recovers **${bits.join(' and ')}**${inv ? ` — health ${left(inv.damage, inv.maxHealth)} · sanity ${left(inv.horror, inv.maxSanity)}` : ''}`); }
        break;
      }
      case 'doomPlaced': lines.set(i, `🕯️ Dread **+${num(d.count)}** — now **${num(d.total)}**${num(d.threshold) ? ` of ${num(d.threshold)} before the hour turns` : ''}`); break;
      default: break;
    }
  });
  return { lines, consumed };
}

/** The Details button: the same sum, one line per part, in words. For the last test in the events it was asked about. */
export function testBreakdown(events: GameEvent[]): string | null {
  const e = [...events].reverse().find(x => x.kind === 'testResolved') as Record<string, unknown> | undefined; if (!e) return null;
  const base = num(e.base, num(e.skillValue)), lent = num(e.lent), bonus = num(e.bonus), mod = num(e.tokenMod), ok = e.outcome === 'success';
  const names = Array.isArray(e.committedNames) ? (e.committedNames as string[]) : [];
  const foe = str(e.enemyName);
  const rows = [
    `**${testHeadline(e).replace(/^[^ ]+ /, '')}**${foe ? ` against ${foe}` : ''}`,
    `• Your ${SKILL_NAME[str(e.skill)] ?? 'skill'}: **${base}**`,
    `• Lent by cards: **${signed(lent)}**${names.length ? ` (${names.join(', ')})` : ''}`,
    ...(bonus ? [`• Gear and other bonuses: **${signed(bonus)}**`] : []),
    `• Token drawn: **${e.autofail ? 'auto-fail' : signed(mod)}** — ${tokensPhrase(e)}`,
    `• Total: **${num(e.total)}**, needed **${num(e.difficulty)}** → ${ok ? `passed by ${num(e.margin)}` : `failed by ${num(e.margin)}`}`,
  ];
  return rows.join('\n');
}
