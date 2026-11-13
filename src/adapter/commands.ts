// Slash command schemas in Discord's API shape. Registered once per guild in a single bulk overwrite (scripts/register.ts).
// Names are lowercase, 1-32 chars; descriptions 1-100; required options come first; at most 25 choices.
const S = 3, I = 4, B = 5, U = 6, SUB = 1;
type Opt = { type: number; name: string; description: string; required?: boolean; autocomplete?: boolean; max_length?: number; choices?: { name: string; value: string }[]; options?: Opt[] };
export interface CommandSchema { name: string; description: string; type: 1; options?: Opt[] }

const how: Opt = { type: S, name: 'how', description: 'Say how you do it (optional, up to 300 characters)', max_length: 300 };
const auto = (name: string, description: string, required = true): Opt => ({ type: S, name, description, required, autocomplete: true });
const cmd = (name: string, description: string, options?: Opt[]): CommandSchema => ({ name, description, type: 1, ...(options ? { options } : {}) });
const choice = (name: string, description: string, values: string[], required = false): Opt => ({ type: S, name, description, required, choices: values.map(v => ({ name: v, value: v })) });

export const COMMANDS: CommandSchema[] = [
  // doing things
  cmd('search', 'Look closer: search the place you are standing in', [how]),
  cmd('go', 'Head somewhere', [auto('place', 'Where to'), how]),
  cmd('fight', 'Strike at something', [auto('enemy', 'Who or what'), how]),
  cmd('slip', 'Slip away from something that has hold of you', [auto('enemy', 'Who or what'), how]),
  cmd('confront', 'Square up to something in the room', [auto('enemy', 'Who or what'), how]),
  cmd('talk', 'Speak to someone', [auto('who', 'To whom'), how]),
  cmd('rummage', 'Rummage through your things', [how]),
  cmd('scrounge', 'Scrounge up some means', [how]),
  cmd('play', 'Put a card from your hand to use', [auto('card', 'Which one'), how]),
  cmd('use', 'Use something you have out', [auto('thing', 'Which one'), how]),
  cmd('pool', 'Pool your leads and push on', [how]),
  cmd('withdraw', 'Walk away from it all', [how]),
  // turn flow and looking around
  cmd('step-forward', 'Take the floor when no one holds it'),
  cmd('done', 'That is all for now: end your turn'),
  cmd('hold', 'Ask the table for a moment', [{ type: S, name: 'reason', description: 'Why (optional)', max_length: 200 }]),
  cmd('look', 'Look around the room you are in'),
  cmd('self', 'Check how you are holding up'),
  cmd('hand', 'Put your hand back in your own channel'),
  cmd('party', 'Where everyone is and how they are holding up'),
  cmd('case', 'The trail you are on and the hour'),
  cmd('map', 'A sketch of the places you know'),
  cmd('bag', 'What is known to be in the bag (show-the-math mode only)'),
  cmd('journal', 'The story so far', [choice('span', 'How far back', ['since you left', 'this scenario'])]),
  cmd('card', 'Look up a card (only you see it)', [auto('name', 'Card name')]),
  cmd('rules', 'Look up a rules term (only you see it)', [auto('phrase', 'Term')]),
  // setup, between scenarios, and the host
  cmd('join', 'Take a seat and choose an investigator'),
  cmd('deck', 'Deck tools', [{ type: SUB, name: 'import', description: 'Import a deck by ArkhamDB link, id or pasted JSON', options: [{ type: S, name: 'source', description: 'Deck link, id, or JSON', required: true }] }]),
  cmd('ready', 'You are set; the story starts when everyone is'),
  cmd('improve', 'Between scenarios: spend experience on your deck'),
  cmd('leave', 'Walk away from the table'),
  cmd('settings', 'Your personal preferences', [
    choice('immersion', 'How much of the machinery you see', ['story', 'balanced', 'math']),
    choice('pings', 'When to ping you', ['only when I must decide', 'also when it is my turn']),
    choice('voice', 'Re-post your chat in character', ['off', 'on']),
    choice('confirm', 'Ask before costly actions', ['yes', 'no']),
  ]),
  cmd('host', 'Host controls', [
    { type: SUB, name: 'new', description: 'Open a new story', options: [
      { ...choice('scenario', 'Which scenario', ['gathering'], true), name: 'scenario' }, choice('difficulty', 'How hard', ['easy', 'standard', 'hard', 'expert']), choice('pace', 'How fast the table plays', ['slow', 'live']) ] },
    { type: SUB, name: 'start', description: 'Begin the story now' },
    { type: SUB, name: 'pause', description: 'Pause timeouts' },
    { type: SUB, name: 'resume', description: 'Resume timeouts' },
    { type: SUB, name: 'swap', description: 'Give a seat to someone else', options: [{ type: S, name: 'seat', description: 'Seat id, like s1', required: true }, { type: U, name: 'user', description: 'The new player', required: true }] },
    { type: SUB, name: 'away', description: 'Mark a player away (their turns pass)', options: [{ type: U, name: 'user', description: 'The player', required: true }] },
    { type: SUB, name: 'resync', description: 'Repair channels, permissions and panels' },
    { type: SUB, name: 'check', description: 'Check bot permissions and recent problems' },
    { type: SUB, name: 'end', description: 'End and archive the story' },
  ]),
];
void I; void B;

/** Plain-language glossary for /rules. Original wording. */
export const GLOSSARY: Record<string, string> = {
  moment: 'You get three moments on your turn. Most things you do spend one.',
  means: 'Spare resources you scrape together. Cards cost means to put into play.',
  lead: 'A clue. Leads are what the story needs from you.',
  dread: 'The mounting pressure of the night. When it fills, the hour turns.',
  hour: 'The scenario clock. It advances as dread builds.',
  wounds: 'Harm to your body. Too many and you are carried out.',
  nerves: 'Harm to your mind. Too many and you are lost to it.',
  bag: 'The bag your hand reaches into when something is uncertain. Its contents are the odds.',
  engaged: 'A foe has hold of you. If you do something other than fight, slip away or talk, it gets a free swing.',
  spent: 'A card you used and have to wait to get back at hand, which happens when the round turns.',
  fast: 'Fast cards and abilities cost no moment.',
  lend: 'Put cards from your hand into someone’s attempt; their icons help, and the cards are spent either way.',
  spotlight: 'Only one investigator acts at a time. Step forward when no one holds the floor.',
  weakness: 'A card that works against you, shuffled into your deck. You cannot choose to avoid it.',
};
