// Pure functions: kernel view + decision in, Discord message bodies out. No I/O, no rules.
import type { Decision, GameEvent, LegalOption } from '../kernel/types.ts';
import type { PartyView, PlaceView, View } from '../kernel/view.ts';
import type { ButtonSpec, EmbedSpec, MessageBody, Row, SelectOption } from './port.ts';
import { cardArt } from './art.ts';
import { bar, dreadWord, holdingUp, leadsLeftWord, moments, momentsWord, nervesWord, remaining, situation, skillsLine, vitalsLine, woundsWord, type Immersion } from './narration/vocab.ts';
import { promptText, reactionText } from './narration/prompts.ts';
import { testBreakdown } from './narration/outcome.ts';
import { ACT_TEXT, AGENDA_TEXT, PLACE_TEXT } from './narration/gathering.ts';

export interface ScenarioText { places: Record<string, string>; agenda: Record<number, string>; act: Record<number, string> }
export const GATHERING_TEXT: ScenarioText = { places: PLACE_TEXT, agenda: AGENDA_TEXT, act: ACT_TEXT };

export const PANEL_VERBS = ['search', 'go', 'fight', 'slip', 'talk', 'rummage', 'scrounge', 'play', 'use', 'done', 'say', 'step', 'hold', 'pool'] as const;
export type PanelVerb = typeof PANEL_VERBS[number];
export const panelId = (game: string, verb: PanelVerb) => `p1:${game}:${verb}`;
export const decisionId = (game: string, did: string, choice: string) => `d1:${game}:${did}:${choice}`;
export const detailsId = (game: string, ver: number, idx: number) => `x1:${game}:${ver}:${idx}`;
export interface ParsedId { family: 'p1' | 'd1' | 'x1' | 'm1' | 'a1'; game: string; a: string; b: string }
/** custom_id carries no authority; this only splits it. */
export function parseId(id: string): ParsedId | null {
  const [family, game, a, ...rest] = id.split(':');
  if ((family !== 'p1' && family !== 'd1' && family !== 'x1' && family !== 'm1' && family !== 'a1') || !game || a === undefined) return null;
  return { family, game, a, b: rest.join(':') };
}

const btn = (id: string, label: string, style: ButtonSpec['style'] = 'secondary', disabled = false): ButtonSpec => ({ id, label: label.slice(0, 80), style, disabled });
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const list = (xs: string[], none: string) => (xs.length ? xs.join('\n') : none);

function who(p: PartyView, mode: Immersion, floor = false): string {
  const base = `**${p.name}** — ${holdingUp(p.wounds, p.maxWounds, p.nerves, p.maxNerves)}${floor ? ` · ${moments(p.moments)}${p.tome ? ' + one for the books' : ''}` : ''}`;
  return mode !== 'story' ? `${base} (${vitalsLine(p)})` : base;
}

// ───────────────────────────────────────────────────────────────────────── scene panel
export interface PanelInputs { game: string; v: View; loc: string; mode: Immersion; text: ScenarioText; frozen?: boolean }

export function scenePanel(i: PanelInputs): MessageBody {
  const { v, loc, mode } = i; const p: PlaceView | undefined = v.places[loc];
  if (!p) return { content: 'This place is out of reach now.' };
  const here = v.party.filter(x => p.here.includes(x.seat));
  const foes = p.enemies.map(e => `**${e.name}** — ${e.engagedWith ? `on ${v.party.find(x => x.seat === e.engagedWith)?.name ?? 'someone'}` : 'loose'}, ${e.wounded}${mode !== 'story' ? ` (health ${remaining(e.damage, e.health)}/${e.health})` : ''}${e.exhausted ? ', spent' : ''}`);
  const known = p.exits.filter(x => x.name).map(x => x.name!); const unopened = p.exits.filter(x => !x.name).length;
  const exits = [...known, ...(unopened ? [unopened === 1 ? 'a door you haven’t opened' : `${unopened} doors you haven’t opened`] : [])];
  const left = leadsLeftWord(p.leadsLeft) + (mode !== 'story' ? ` (${p.leadsLeft})` : '');
  const embed: EmbedSpec = {
    title: p.name + (p.clean ? ' — searched' : ''),
    description: i.text.places[loc] ?? '',
    fields: [
      { name: 'Here', value: list(here.map(x => who(x, mode, v.spotlight === x.seat && v.phase === 'investigation')), 'No one.'), inline: false },
      { name: 'Foes', value: list(foes, 'Nothing you can see.'), inline: false },
      { name: 'Ways out', value: list(exits, 'None.'), inline: true },
      { name: 'Left to find', value: left, inline: true },
      ...(p.attached.length ? [{ name: 'In the air', value: p.attached.join(', '), inline: true }] : []),
    ],
    footer: `Round ${v.round} · ${dreadWord(v.agenda.doom, v.agenda.threshold)}`,
  };
  const g = i.game; const noFoes = p.enemies.length === 0;
  const row1: Row = { buttons: [btn(panelId(g, 'search'), 'Search', 'primary', p.clean), btn(panelId(g, 'go'), 'Go', 'primary', p.exits.length === 0), btn(panelId(g, 'fight'), 'Fight', 'danger', noFoes), btn(panelId(g, 'slip'), 'Slip away', 'secondary', noFoes), btn(panelId(g, 'talk'), 'Talk')] };
  const row2: Row = { buttons: [btn(panelId(g, 'rummage'), 'Rummage'), btn(panelId(g, 'scrounge'), 'Scrounge'), btn(panelId(g, 'play'), 'Play'), btn(panelId(g, 'use'), 'Use'), btn(panelId(g, 'done'), 'Done', 'success')] };
  const row3: Row = { buttons: [btn(panelId(g, 'say'), 'Say how'), btn(panelId(g, 'step'), 'Step forward'), btn(panelId(g, 'hold'), 'Hold'), btn(panelId(g, 'pool'), 'Pool leads', 'success')] };
  return { embeds: [embed], rows: [row1, row2, row3] };
}

// ───────────────────────────────────────────────────────────────────────── trackers
export function hourPanel(v: View, text: ScenarioText): MessageBody {
  const a = v.agenda;
  return { embeds: [{
    title: 'The hour',
    description: text.agenda[a.stage] ?? '',
    image: cardArt(a.code),
    fields: [
      { name: 'Dread', value: `${bar(a.doom, a.threshold || 1)}  ${dreadWord(a.doom, a.threshold)}${a.threshold ? `  (${a.doom} of ${a.threshold} before the hour turns)` : ''}`, inline: false },
      { name: 'Round', value: String(v.round), inline: true },
      { name: 'Now', value: v.phase === 'mythos' ? 'The night deepens' : v.phase === 'enemy' ? 'The house moves' : v.phase === 'upkeep' ? 'A breath' : v.phase === 'ended' ? 'Over' : 'Your time', inline: true },
    ],
  }] };
}

export function trailPanel(v: View, text: ScenarioText, journal: string[] = []): MessageBody {
  const vit = (p: PartyView) => ` (${vitalsLine(p)})`;
  const place = (id: string) => v.places[id]?.name ?? 'out of sight';
  const fields = [
    { name: 'The trail', value: text.act[v.act.stage] ?? '', inline: false },
    { name: 'Where everyone is', value: list(v.party.map(p => `**${p.name}** — ${p.status === 'active' ? `${place(p.loc)}, ${holdingUp(p.wounds, p.maxWounds, p.nerves, p.maxNerves)}${vit(p)}` : p.status === 'resigned' ? 'got out' : 'lost to it'}`), 'No one.'), inline: false },
  ];
  if (journal.length) fields.push({ name: 'Journal', value: trunc(journal.slice(-6).join('\n'), 1000), inline: false });
  return { embeds: [{ title: 'The trail', image: cardArt(v.act.code), fields }] };
}

// ───────────────────────────────────────────────────────────────────────── personal channel
/** The investigator's own card face, with health and sanity as bars and as numbers (what is left out of the most). */
export function investigatorSheet(me: PartyView & { skills: Record<string, number> }, numbers = true): EmbedSpec {
  const health = remaining(me.wounds, me.maxWounds), sanity = remaining(me.nerves, me.maxNerves);
  const fields = numbers ? [
    { name: 'Health', value: `${bar(health, me.maxWounds, 9)}\n**${health}** of ${me.maxWounds}${me.wounds ? ` · ${me.wounds} damage taken` : ''}`, inline: true },
    { name: 'Sanity', value: `${bar(sanity, me.maxNerves, 9)}\n**${sanity}** of ${me.maxNerves}${me.nerves ? ` · ${me.nerves} horror taken` : ''}`, inline: true },
    { name: 'Skills', value: skillsLine(me.skills), inline: false },
  ] : [];
  const art = cardArt(me.code);
  return { title: me.name, ...(art ? { image: art } : {}), ...(fields.length ? { fields } : {}) };
}
export function handMessage(game: string, v: View, playable: LegalOption[], mode: Immersion): MessageBody {
  const me = v.me; if (!me) return { content: 'Nothing here yet.' };
  const group = (type: string) => me.hand.filter(c => c.type === type).map(c => `${c.name}${c.cost !== null ? ` (${c.cost})` : ''}`);
  const nums = mode !== 'story';
  const fields = [
    { name: 'Assets', value: list(group('asset'), '—'), inline: true },
    { name: 'Events', value: list(group('event'), '—'), inline: true },
    { name: 'Skills', value: list(group('skill'), '—'), inline: true },
    { name: 'You', value: `${momentsWord(me.moments)} ${moments(me.moments)}${me.tome ? ' (and one more, only for the books)' : ''}\nMeans: ${me.means} · Leads: ${me.leads}\n${woundsWord(me.wounds, me.maxWounds)}, ${nervesWord(me.nerves, me.maxNerves)}`, inline: false },
  ];
  const sheet = investigatorSheet(me, nums);
  const opts: SelectOption[] = playable.filter(o => o.action.type === 'play').slice(0, 25).map(o => ({
    value: (o.action as { cardId: string }).cardId, label: trunc(o.label, 100), description: trunc(o.cost, 100),
  }));
  const rows: Row[] = [];
  if (opts.length) rows.push({ select: { id: `p1:${game}:playsel`, placeholder: 'Put something into play…', options: opts, min: 1, max: 1 } });
  const seen = new Set<string>(); const look: SelectOption[] = [...me.hand, ...me.inPlay].filter(c => cardArt(c.code) && !seen.has(c.id) && seen.add(c.id)).slice(0, 25).map(c => ({ value: c.id, label: trunc(c.name, 100), description: c.cost !== null ? `costs ${c.cost}` : undefined }));
  if (look.length) rows.push({ select: { id: `p1:${game}:looksel`, placeholder: 'Look closely at a card…', options: look, min: 1, max: 1 } });
  rows.push({ buttons: [btn(`p1:${game}:self`, 'Self'), btn(`p1:${game}:journal`, 'Journal'), btn(`p1:${game}:settings`, 'Settings')] });
  return { embeds: [sheet, { title: `${me.name}’s things`, fields }], rows };
}

export function boardMessage(game: string, v: View, abilities: LegalOption[]): MessageBody {
  const me = v.me; if (!me) return { content: '' };
  const lines = me.inPlay.map(c => `${c.exhausted ? '◌' : '●'} **${c.name}** — ${c.exhausted ? 'spent' : 'at hand'}${Object.entries(c.uses).filter(([, n]) => n > 0).map(([k, n]) => `, ${k} ${n}`).join('')}`);
  const opts: SelectOption[] = abilities.filter(o => o.action.type === 'activate').slice(0, 25).map(o => {
    const a = o.action as { cardId: string; abilityId: string; targetId?: string };
    return { value: [a.cardId, a.abilityId, a.targetId ?? ''].join('|'), label: trunc(o.label, 100), description: trunc(o.cost, 100) };
  });
  const rows: Row[] = opts.length ? [{ select: { id: `p1:${game}:usesel`, placeholder: 'Use something…', options: opts, min: 1, max: 1 } }] : [];
  return { embeds: [{ title: 'What you have out', description: list(lines, 'Nothing yet.'), ...(me.threat.length ? { fields: [{ name: 'Weighing on you', value: me.threat.join(', ') }] } : {}) }], rows };
}

// ───────────────────────────────────────────────────────────────────────── decisions
export interface DecisionCtx { game: string; v: View; mode: Immersion; selection?: string[]; names?: Record<string, string> }

/** Where a pending decision should be shown: a seat's personal channel, or the location channel of the active test. */
export type PromptHome = { kind: 'personal'; seat: string } | { kind: 'loc'; loc: string } | { kind: 'hour' };

export function promptHome(d: Decision, v: View): PromptHome {
  if (d.kind === 'reveal') return { kind: 'loc', loc: d.test.locId ?? v.party.find(p => p.seat === d.seat)?.loc ?? '' };
  if (d.kind === 'spotlight') return { kind: 'hour' };
  return { kind: 'personal', seat: d.kind === 'turn' ? d.seat : d.seat };
}

export function decisionMessage(d: Decision, c: DecisionCtx): MessageBody | null {
  const g = c.game; const did = d.id;
  switch (d.kind) {
    case 'spotlight':
      return { embeds: [{ title: 'The floor is open', description: 'Who steps forward?' }], rows: [{ buttons: [btn(decisionId(g, did, 'step'), 'Step forward', 'primary')] }] };
    case 'turn': return null;                                    // the scene panel is the interface; see turnPing
    case 'commit': {
      const sel = c.selection ?? [];
      const opts: SelectOption[] = d.cards.slice(0, 25).map(o => ({ value: o.id, label: trunc(o.label, 100), ...(o.detail ? { description: trunc(o.detail, 100) } : {}) }));
      const rows: Row[] = [];
      if (opts.length) rows.push({ select: { id: decisionId(g, did, 'sel'), placeholder: 'Lend a hand from your hand…', options: opts, min: 0, max: Math.min(opts.length, 5) } });
      const buttons: ButtonSpec[] = [btn(decisionId(g, did, 'lend'), sel.length ? `Lend ${sel.length}` : 'Lend these', 'primary', sel.length === 0), btn(decisionId(g, did, 'none'), 'Go without help')];
      rows.push({ buttons });
      const abil = d.abilities.slice(0, 5).map(o => btn(decisionId(g, did, 'ab:' + o.id), trunc(`Use ${o.label}`, 80), 'secondary'));
      if (abil.length) rows.push({ buttons: abil });
      const sit = situation(d.test.label, d.test.kind, d.skillValue, d.test.difficulty, c.mode);
      const need = d.test.difficulty - d.skillValue;
      const sum = c.mode === 'story' ? '' : `\n**Skill ${d.skillValue}** against **difficulty ${d.test.difficulty}**. ${need <= 0 ? `The token can take up to ${-need} off and you still pass.` : `You are ${need} short before the token and any help from your hand.`}`;
      return { content: undefined, embeds: [{ title: 'Lend a hand?', description: `${d.test.sourceName ? `**${d.test.sourceName}.** ` : ''}${sit}${sum}`, footer: 'Cards you lend are spent on this either way.' }], rows };
    }
    case 'reveal':
      return { embeds: [{ description: `${c.v.party.find(p => p.seat === d.seat)?.name ?? 'Someone'} is ready. Everyone who wanted to help has.` }], rows: [{ buttons: [btn(decisionId(g, did, 'reveal'), 'Reach into the bag', 'primary')] }] };
    case 'reaction': {
      const buttons = d.options.slice(0, 4).map(o => btn(decisionId(g, did, 'r:' + o.id), trunc(`Use: ${o.label}`, 80), 'primary'));
      buttons.push(btn(decisionId(g, did, 'pass'), 'Let it pass'));
      const detail = d.options.map(o => `**${o.label}**${o.detail ? ` — ${o.detail}` : ''}`).join('\n');
      return { embeds: [{ title: reactionText(d.trigger), description: detail }], rows: [{ buttons }] };
    }
    case 'choose': {
      const rows: Row[] = [];
      if (d.options.length <= 5 && d.max === 1) rows.push({ buttons: d.options.map(o => btn(decisionId(g, did, 'o:' + o.id), trunc(o.label, 80), 'primary')) });
      else {
        const opts = d.options.slice(0, 25).map(o => ({ value: o.id, label: trunc(o.label, 100), ...(o.detail ? { description: trunc(o.detail, 100) } : {}) }));
        rows.push({ select: { id: decisionId(g, did, 'sel'), placeholder: d.max > 1 ? `Choose ${d.min === d.max ? d.min : `${d.min}–${d.max}`}…` : 'Choose…', options: opts, min: d.min, max: Math.min(d.max, opts.length) } });
        if (d.max > 1) rows.push({ buttons: [btn(decisionId(g, did, 'ok'), 'That’s it', 'primary', (c.selection?.length ?? 0) < d.min)] });
      }
      const detail = d.options.some(o => o.detail) ? d.options.map(o => `**${o.label}**${o.detail ? ` — ${o.detail}` : ''}`).join('\n') : undefined;
      return { embeds: [{ title: promptText(d.prompt), ...(detail ? { description: detail } : {}) }], rows };
    }
    case 'mulligan': {
      const opts = d.cards.slice(0, 25).map(o => ({ value: o.id, label: trunc(o.label, 100) }));
      return { embeds: [{ title: 'Second thoughts?', description: 'Pick any cards you would rather put back, or keep what you have.' }], rows: [
        { select: { id: decisionId(g, did, 'sel'), placeholder: 'Put these back…', options: opts, min: 0, max: opts.length } },
        { buttons: [btn(decisionId(g, did, 'swap'), c.selection?.length ? `Put back ${c.selection.length}` : 'Put these back', 'primary', !(c.selection?.length)), btn(decisionId(g, did, 'keep'), 'Keep my hand', 'success')] },
      ] };
    }
  }
}

/** What you just drew, for your eyes only. `why` is the kernel's reason for the draw. */
export interface DrawnCard { name: string; type: string; cost: number | null; code: string }
const DRAW_LEAD: Record<string, string> = {
  upkeep: 'A new round begins. You draw',
  draw: 'You rummage through your things and come up with',
  skill: 'Your effort pays off. You draw',
  luck: 'Luck turns your way. You draw',
};
export function drawnMessage(why: string, cards: DrawnCard[]): MessageBody {
  const one = (c: DrawnCard) => `**${c.name}** (${c.type}${c.cost !== null ? `, costs ${c.cost}` : ''})`;
  const lead = DRAW_LEAD[why] ?? 'You draw';
  const art = cards.length === 1 ? cardArt(cards[0]!.code) : undefined;
  return { content: `📥 ${lead}: ${cards.map(one).join(', ')}.`, ...(art ? { embeds: [{ thumbnail: art }] } : {}) };
}

export function turnPing(name: string, left: number): string { return `**${name}** — your turn. ${momentsWord(left)} ${moments(left)}`; }

/** An answered prompt becomes one quiet line and loses its controls, so stale buttons cannot be pressed. */
export function resolvedPrompt(summary: string): MessageBody { return { content: `~~${summary}~~`, embeds: [], rows: [] }; }

// ───────────────────────────────────────────────────────────────────────── details and self
export function detailsBody(events: GameEvent[]): MessageBody {
  const sum = testBreakdown(events);
  return { content: sum ?? 'Nothing more to add to that.', ephemeral: true };
}

export function selfBody(v: View, mode: Immersion): MessageBody {
  const me = v.me; if (!me) return { content: 'You are not part of this story.', ephemeral: true };
  return { ephemeral: true, embeds: [investigatorSheet(me, mode !== 'story'), { title: 'How you stand', fields: [
    { name: 'Holding up', value: `${woundsWord(me.wounds, me.maxWounds)}, ${nervesWord(me.nerves, me.maxNerves)}`, inline: true },
    { name: 'Means · Leads', value: `${me.means} · ${me.leads}`, inline: true },
    { name: 'Moments', value: `${moments(me.moments)} ${momentsWord(me.moments)}`, inline: true },
    { name: 'Out', value: list(me.inPlay.map(c => `${c.exhausted ? '◌' : '●'} ${c.name}`), 'Nothing.') },
    { name: 'Weighing on you', value: list(me.threat, 'Nothing.') },
    ...(mode === 'math' ? [{ name: 'The numbers', value: `Deck ${me.deckCount} · discard ${me.discardCount}` }] : []),
  ] }] };
}

export function caseBody(v: View, text: ScenarioText, mode: Immersion = 'balanced'): MessageBody {
  return { ephemeral: true, embeds: [{ title: 'The case', fields: [
    { name: 'The trail', value: text.act[v.act.stage] ?? '' }, { name: 'The hour', value: `${text.agenda[v.agenda.stage] ?? ''}\n${dreadWord(v.agenda.doom, v.agenda.threshold)}${mode === 'math' ? ` (${v.agenda.doom} of ${v.agenda.threshold})` : ''}` },
  ] }] };
}
export function partyBody(v: View): MessageBody {
  return { ephemeral: true, embeds: [{ title: 'The party', description: list(v.party.map(p => `**${p.name}** — ${p.status === 'active' ? `${v.places[p.loc]?.name ?? 'somewhere'}, ${holdingUp(p.wounds, p.maxWounds, p.nerves, p.maxNerves)} (${vitalsLine(p)})` : p.status === 'resigned' ? 'got out' : 'lost to it'}`), 'No one.') }] };
}
export function mapBody(v: View): MessageBody {
  const lines = Object.values(v.places).filter(p => p.revealed).map(p => `${p.here.length ? '◉' : '○'} ${p.name} → ${p.exits.map(e => e.name ?? '?').join(', ') || '—'}`);
  return { ephemeral: true, content: '```\n' + (lines.join('\n') || 'Nothing charted yet.') + '\n```' };
}
