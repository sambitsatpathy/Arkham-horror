const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const SHEET_PATH = path.join(__dirname, '..', '..', '..', 'CHEATSHEET.md');

const SECTIONS = [
  { name: 'How a Round Works',           value: 'round' },
  { name: 'Pregame Setup',               value: 'pregame' },
  { name: 'Your 3 Actions Per Round',    value: 'actions' },
  { name: 'Skill Tests',                 value: 'skills' },
  { name: 'Card Management',             value: 'cards' },
  { name: 'Health & Sanity',             value: 'health' },
  { name: 'Enemies',                     value: 'enemies' },
  { name: 'Locations & Clues',           value: 'locations' },
  { name: 'Phase Commands',              value: 'phase' },
  { name: 'Chaos Bag',                   value: 'chaos' },
  { name: 'Campaign Commands',           value: 'campaign' },
  { name: 'System Commands',             value: 'system' },
  { name: 'Typical Turn Example',        value: 'example' },
  { name: 'Quick Reference',             value: 'quickref' },
  { name: 'Channel Guide',               value: 'channels' },
];

function loadSections() {
  const raw = fs.readFileSync(SHEET_PATH, 'utf8');
  const lines = raw.split('\n');
  const result = {};
  let current = null;
  let buf = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) result[current] = buf.join('\n').trim();
      current = line.slice(3).trim();
      buf = [`## ${current}`];
    } else if (current) {
      buf.push(line);
    }
  }
  if (current) result[current] = buf.join('\n').trim();
  return result;
}

// Map section value → heading text
const VALUE_TO_HEADING = {
  round:    'How a Round Works',
  pregame:  'Pregame Setup',
  actions:  'Your 3 Actions Per Round',
  skills:   'Skill Tests (reference)',
  cards:    'Card Management',
  health:   'Health & Sanity',
  enemies:  'Enemies',
  locations:'Locations & Clues',
  phase:    'Phase Commands (Host Only)',
  chaos:    'Chaos Bag',
  campaign: 'Campaign Commands',
  system:   'System Commands (Host Only)',
  example:  'Typical Turn Example',
  quickref: 'Quick Reference — What Skill for What Test?',
  channels: 'Channel Guide',
};

const TOC = [
  '# Arkham Horror LCG — Bot Cheatsheet',
  '',
  'Use `/cheatsheet section:<name>` to see a section. Available sections:',
  '',
  ...SECTIONS.map(s => `• **${s.name}**`),
  '',
  '> Tip: Individual action commands are **Host/admin only**. Players use `/action`.',
].join('\n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cheatsheet')
    .setDescription('Quick reference for all bot commands.')
    .addStringOption(opt =>
      opt.setName('section')
        .setDescription('Which section to show')
        .setRequired(false)
        .setAutocomplete(true)),

  autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = SECTIONS
      .filter(s => s.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(s => ({ name: s.name, value: s.value }));
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const sectionVal = interaction.options.getString('section');

    if (!sectionVal) {
      return interaction.reply({ content: TOC, flags: 64 });
    }

    const heading = VALUE_TO_HEADING[sectionVal];
    if (!heading) {
      return interaction.reply({ content: '❌ Unknown section. Use autocomplete to pick one.', flags: 64 });
    }

    const sections = loadSections();
    const content = sections[heading];
    if (!content) {
      return interaction.reply({ content: `❌ Section "${heading}" not found in cheatsheet.`, flags: 64 });
    }

    // Discord message limit is 2000 chars — split if needed
    if (content.length <= 1990) {
      return interaction.reply({ content, flags: 64 });
    }

    // Split at paragraph boundaries
    await interaction.deferReply({ flags: 64 });
    const chunks = [];
    let chunk = '';
    for (const line of content.split('\n')) {
      if (chunk.length + line.length + 1 > 1990) {
        chunks.push(chunk.trim());
        chunk = line;
      } else {
        chunk += (chunk ? '\n' : '') + line;
      }
    }
    if (chunk.trim()) chunks.push(chunk.trim());

    await interaction.editReply({ content: chunks[0] });
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({ content: chunks[i], flags: 64 });
    }
  },
};
