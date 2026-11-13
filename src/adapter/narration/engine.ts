// Events in, authored lines out. Every selection is deterministic from (game seed, step version, event index),
// using a generator separate from the kernel's, so the story text can never change a result and a replay tells the same story.
import type { GameEvent, GameState } from '../../kernel/types.ts';
import { narrationPick } from '../../kernel/rng.ts';
import { cleanHow, escapeMd, tokenFeel, FEEL_LINE } from './vocab.ts';
import { buildStrips } from './outcome.ts';

export type Target =
  | { kind: 'loc'; loc: string } | { kind: 'hour' } | { kind: 'trail' } | { kind: 'none' };
export interface Narrated { target: Target; text: string; eventIdx: number; details: boolean }

export interface Template {
  event: string;
  match?: Record<string, string | number | boolean>;
  who?: string;                          // investigator code, for lines written for one person
  place?: string;                        // location id
  variants: string[];
}
export interface NarrationPack { id: string; templates: Template[] }

/** Events the story says nothing about on purpose (private, bookkeeping, or covered by another line). */
export const SILENT = new Set(['testStarted', 'tokenRevealed', 'turnStarted', 'resources', 'drew', 'cardDiscarded', 'deckReshuffled', 'encounterReshuffled', 'mulliganed', 'handTrimmed', 'cluesSpent', 'unscripted', 'enemyDamaged', 'assetEntered']);

export interface NarrateCtx { state: GameState; version: number; gameId: string; pack: NarrationPack[] }

function specificity(t: Template): number { return (t.who ? 4 : 0) + (t.place ? 2 : 0) + Object.keys(t.match ?? {}).length; }

function derive(e: GameEvent, s: GameState): Record<string, unknown> {
  const d: Record<string, unknown> = { ...e };
  if (e.kind === 'testResolved') {
    d.feel = tokenFeel((e.tokens as (string | null)[]) ?? [], !!e.autofail);
    d.close = Number(e.margin) <= 1;
  }
  if (e.kind === 'clueDiscovered') d.multi = Number(e.count) > 1;
  if (e.kind === 'phaseStarted') d.round1 = Number(e.round) === 1;
  if (e.kind === 'gameEnded') d.resolution = String(e.resolution);
  void s;
  return d;
}

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');
}

export function pickTemplate(pack: NarrationPack[], d: Record<string, unknown>, who: string | undefined, place: string | undefined): Template | null {
  let best: Template | null = null; let bestScore = -1;
  for (const p of pack) {
    for (const t of p.templates) {
      if (t.event !== d.kind) continue;
      if (t.who && t.who !== who) continue;
      if (t.place && t.place !== place) continue;
      if (t.match && !Object.entries(t.match).every(([k, v]) => d[k] === v)) continue;
      const sc = specificity(t);
      if (sc > bestScore) { best = t; bestScore = sc; }
    }
  }
  return best;
}

/** Which channel does this event belong in? */
export function targetFor(e: GameEvent, s: GameState): Target {
  const seatLoc = e.seat && s.investigators[e.seat as string] ? s.investigators[e.seat as string]!.loc : null;
  switch (e.kind) {
    case 'phaseStarted': case 'roundStarted': case 'doomPlaced': case 'agendaAdvanced': case 'actAdvanced': case 'actOneBack': case 'actTwoBack': case 'ancientEvils': case 'gameEnded':
      return { kind: 'hour' };
    case 'investigatorDefeated': case 'resigned': return { kind: 'trail' };
    case 'moved': return { kind: 'loc', loc: String(e.to) };
    case 'departed': return { kind: 'loc', loc: String(e.from) };
    case 'locationRevealed': case 'locationClean': return { kind: 'loc', loc: String(e.loc) };
    case 'enemySpawned': case 'enemyDefeated': return typeof e.loc === 'string' ? { kind: 'loc', loc: e.loc } : seatLoc ? { kind: 'loc', loc: seatLoc } : { kind: 'hour' };
    case 'enemyMoved': return { kind: 'loc', loc: String(e.to) };
    case 'clueDiscovered': return { kind: 'loc', loc: String(e.loc) };
    default: return seatLoc ? { kind: 'loc', loc: seatLoc } : { kind: 'hour' };
  }
}

export function narrate(events: GameEvent[], ctx: NarrateCtx): Narrated[] {
  const { state: s } = ctx; const out: Narrated[] = [];
  const expanded: { e: GameEvent; idx: number }[] = [];
  events.forEach((e, idx) => {
    if (e.kind === 'moved') expanded.push({ e: { ...e, kind: 'departed' }, idx });
    expanded.push({ e, idx });
  });
  const seed = [...ctx.gameId].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 7);
  const strips = buildStrips(events, s);
  expanded.forEach(({ e, idx }, n) => {
    const strip = strips.lines.get(idx);
    if (SILENT.has(e.kind)) { if (strip) out.push({ target: targetFor(e, s), text: strip, eventIdx: idx, details: false }); return; }
    const who = e.seat ? s.investigators[e.seat as string] : undefined;
    const target = targetFor(e, s);
    const placeId = target.kind === 'loc' ? target.loc : undefined;
    const d = derive(e, s);
    const t = pickTemplate(ctx.pack, d, who?.code, placeId);
    const loc = (id: unknown) => (typeof id === 'string' && s.locations[id] ? s.locations[id]!.name : 'the place');
    const vars: Record<string, string> = {
      who: who ? who.name : 'Someone', place: loc(placeId ?? e.loc), name: escapeMd(String(e.name ?? e.label ?? 'it')), enemy: escapeMd(String(e.name ?? 'it')),
      feel: d.feel ? FEEL_LINE[d.feel as keyof typeof FEEL_LINE] : '', from: loc(e.from), to: loc(e.to), target: escapeMd(String(e.target ?? 'it')), count: String(e.count ?? ''),
    };
    let text: string;
    if (t) { const v = t.variants.length === 1 ? 0 : narrationPick(seed, ctx.version, idx * 16 + n, t.variants.length); text = fill(t.variants[v]!, vars); }
    else text = '';                       // no authored or neutral line: stay quiet rather than print a raw tag; the coverage report lists it
    if (strip) text = text ? `${text}\n${strip}` : strip;
    if (text === '') return;
    if (e.kind === 'action' && e.how) text = `*${vars.who}: “${cleanHow(e.how)}”*\n${text}`;
    out.push({ target, text, eventIdx: idx, details: e.kind === 'testResolved' });
  });
  return out;
}
