const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { getDb } = require('../../db/database');
const { getCampaign, getPlayers, getSession, requireHost, updatePlayer } = require('../../engine/gameState');
const { buildGameServer } = require('../../engine/serverBuilder');
const { buildEncounterDeck, shuffle, postEncounterCard } = require('../../engine/encounterEngine');
const { pinInitialStatus, pinHiddenStatus } = require('../../engine/locationManager');
const { findCard, findCardByCode, loadAllCards } = require('../../engine/cardLookup');
const path = require('path');
const fs = require('fs');

const CAMPAIGNS = {
  night_of_zealot: { name: 'The Night of the Zealot', dir: 'night_of_zealot' },
  dunwich_legacy:  { name: 'The Dunwich Legacy',       dir: 'dunwich_legacy'  },
  path_to_carcosa: { name: 'The Path to Carcosa',      dir: 'path_to_carcosa' },
  forgotten_age:   { name: 'The Forgotten Age',        dir: 'forgotten_age'   },
  circle_undone:   { name: 'The Circle Undone',        dir: 'circle_undone'   },
  dream_eaters:    { name: 'The Dream-Eaters',         dir: 'dream_eaters'    },
  innsmouth:       { name: 'The Innsmouth Conspiracy', dir: 'innsmouth'       },
  edge_of_earth:   { name: 'Edge of the Earth',        dir: 'edge_of_earth'   },
  scarlet_keys:    { name: 'The Scarlet Keys',         dir: 'scarlet_keys'    },
  feast_hemlock:   { name: 'Feast of Hemlock Vale',    dir: 'feast_hemlock'   },
  drowned_city:    { name: 'The Drowned City',         dir: 'drowned_city'    },
};

function loadCampaignIndex(dir) {
  const filePath = path.join(__dirname, '../../data/scenarios', dir, 'campaign.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadScenario(dir, file) {
  const filePath = path.join(__dirname, '../../data/scenarios', dir, file + '.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('startgame')
    .setDescription('Start the game. Host only.')
    .addStringOption(opt =>
      opt.setName('campaign')
        .setDescription('Campaign to play')
        .setRequired(true)
        .addChoices(
          ...Object.entries(CAMPAIGNS).map(([value, { name }]) => ({ name, value }))
        ))
    .addStringOption(opt =>
      opt.setName('scenario')
        .setDescription('Scenario to play')
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption(opt =>
      opt.setName('difficulty')
        .setDescription('Difficulty')
        .setRequired(true)
        .addChoices(
          { name: 'Easy',     value: 'easy'     },
          { name: 'Standard', value: 'standard' },
          { name: 'Hard',     value: 'hard'     },
          { name: 'Expert',   value: 'expert'   },
        )),

  async autocomplete(interaction) {
    const campaignKey = interaction.options.getString('campaign');
    const focused = interaction.options.getFocused().toLowerCase();

    const campaign = CAMPAIGNS[campaignKey];
    if (!campaign) return interaction.respond([]);

    const index = loadCampaignIndex(campaign.dir);
    if (!index) {
      return interaction.respond([{ name: '⚠️ No scenarios authored yet for this campaign', value: '__none__' }]);
    }

    const choices = index.scenarios
      .filter(s => !focused || s.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(s => ({ name: s.name, value: s.file }));

    await interaction.respond(choices);
  },

  async execute(interaction) {
    const host = requireHost(interaction);
    if (!host) return;

    const campaignKey = interaction.options.getString('campaign');
    const scenarioFile = interaction.options.getString('scenario');
    const difficulty = interaction.options.getString('difficulty');

    if (scenarioFile === '__none__') {
      return interaction.reply({ content: '❌ No scenarios have been authored for that campaign yet.', flags: 64 });
    }

    const campaignMeta = CAMPAIGNS[campaignKey];
    if (!campaignMeta) {
      return interaction.reply({ content: '❌ Unknown campaign.', flags: 64 });
    }

    const campaign = getCampaign();
    const players = getPlayers(campaign.id);

    const notReady = players.filter(p => !p.investigator_code);
    if (notReady.length > 0) {
      return interaction.reply({
        content: `❌ Not all players have chosen an investigator: ${notReady.map(p => p.discord_name).join(', ')}`,
        flags: 64,
      });
    }

    const noDeck = players.filter(p => !p.deck_ready);
    if (noDeck.length > 0) {
      return interaction.reply({
        content: `❌ Not all players have loaded a deck: ${noDeck.map(p => p.discord_name).join(', ')}`,
        flags: 64,
      });
    }

    await interaction.deferReply();

    const scenario = loadScenario(campaignMeta.dir, scenarioFile);
    const allCards = loadAllCards();

    // Build Discord server structure
    const { channelIds, locationChannelIds, handChannelIds } = await buildGameServer(
      interaction.guild,
      scenario,
      players,
      interaction.client.user.id,
    );

    // Build encounter deck
    const encounterCodes = buildEncounterDeck(scenario.encounter_sets, allCards);
    const shuffledEncounter = shuffle(encounterCodes);

    // Initial doom threshold from first agenda
    const firstAgenda = scenario.agendas[0];
    const doomThreshold = firstAgenda.doom_threshold;

    // Create game session
    const db = getDb();
    const sessionResult = db.prepare(`
      INSERT INTO game_session
        (campaign_id, scenario_code, campaign_dir, difficulty, phase, doom, doom_threshold,
         encounter_deck, doom_channel_id, agenda_channel_id, act_channel_id,
         chaos_channel_id, encounter_channel_id)
      VALUES (?, ?, ?, ?, 'investigation', 0, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      campaign.id, scenarioFile, campaignMeta.dir, difficulty, doomThreshold,
      JSON.stringify(shuffledEncounter),
      channelIds.doom, channelIds.agenda, channelIds.act,
      channelIds.chaos, channelIds.encounter,
    );
    const sessionId = sessionResult.lastInsertRowid;

    // Create location rows
    for (const loc of scenario.locations) {
      const clues = loc.clues_per_investigator * players.length;
      db.prepare(`
        INSERT INTO locations (session_id, code, name, channel_id, status, clues, shroud, act_index)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId, loc.code, loc.name,
        locationChannelIds[loc.code] || null,
        loc.start_revealed ? 'revealed' : 'hidden',
        clues, loc.shroud, loc.act_index,
      );
    }

    // Set starting location for all investigators
    const startLoc = scenario.locations.find(l => l.starting_location);
    if (startLoc) {
      for (const p of players) {
        updatePlayer(p.id, { location_code: startLoc.code });
      }
    }

    // Deal opening hands (5 cards each)
    for (const p of players) {
      const deck = JSON.parse(p.deck);
      const hand = deck.splice(0, 5);
      updatePlayer(p.id, {
        resources: 5,
        hp: p.max_hp,
        sanity: p.max_sanity,
        deck: JSON.stringify(deck),
        hand: JSON.stringify(hand),
      });
    }

    // Post intro narration + setup instructions in pregame channel
    const pregame = interaction.guild.channels.cache.find(c => c.name === 'pregame');
    if (pregame) {
      // Post intro text paragraphs first if present
      if (scenario.intro_text?.length) {
        const introLines = [
          `# 🎴 ${scenario.name}`,
          '',
          ...scenario.intro_text.map(p => `*${p}*`),
        ];
        await pregame.send(introLines.join('\n'));
      }

      const startingLocationLine = startLoc
        ? [``, `📍 **All investigators begin at: ${startLoc.name}**`]
        : [];
      const header = scenario.intro_text?.length
        ? `## Setup — ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}`
        : `# 🎴 ${scenario.name} — ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}`;

      await pregame.send([
        header,
        '',
        '**Setup Instructions:**',
        ...scenario.setup_instructions.map(s => `• ${s}`),
        ...startingLocationLine,
      ].join('\n'));
    }

    // Announce starting location in doom-track so it's visible in the main channel
    const doomChEarly = interaction.guild.channels.cache.get(channelIds.doom);
    if (doomChEarly && startLoc) {
      await doomChEarly.send(`📍 All investigators start at **${startLoc.name}**.`);
    }

    // Pin location cards: revealed locations get full status; hidden ones get the back face
    const session = { id: sessionId };
    for (const loc of scenario.locations) {
      if (!locationChannelIds[loc.code]) continue;
      const locRow = db.prepare('SELECT * FROM locations WHERE session_id = ? AND code = ?').get(sessionId, loc.code);
      if (loc.start_revealed) {
        await pinInitialStatus(interaction.guild, session, locRow, players);
      } else {
        await pinHiddenStatus(interaction.guild, locRow, loc.card_code);
      }
    }

    // Post initial doom track
    const doomCh = interaction.guild.channels.cache.get(channelIds.doom);
    if (doomCh) {
      await doomCh.send(buildDoomTrack(scenario, players, 0, doomThreshold, 1, 'Investigation'));
    }

    // Post agenda card
    const agendaCh = interaction.guild.channels.cache.get(channelIds.agenda);
    if (agendaCh) {
      const agendaResult = findCardByCode(firstAgenda.card_code);
      if (agendaResult?.imagePath) {
        const att = new AttachmentBuilder(agendaResult.imagePath, { name: 'agenda.png' });
        await agendaCh.send({ content: `📋 **${firstAgenda.name}** — Doom: 0/${doomThreshold}`, files: [att] });
      }
    }

    // Post act card
    const actCh = interaction.guild.channels.cache.get(channelIds.act);
    const firstAct = scenario.acts[0];
    if (actCh && firstAct) {
      const actResult = findCardByCode(firstAct.card_code);
      if (actResult?.imagePath) {
        const att = new AttachmentBuilder(actResult.imagePath, { name: 'act.png' });
        await actCh.send({ content: `📖 **${firstAct.name}**`, files: [att] });
      }
    }

    await interaction.editReply(`✅ **${scenario.name}** has begun! Good luck, investigators.`);
  },
};

function buildDoomTrack(scenario, players, doom, threshold, round, phase) {
  const filled = Math.round((doom / threshold) * 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const agendaName = scenario.agendas[0].name;
  const lines = [
    '☠️  **DOOM TRACK**',
    '━━━━━━━━━━━━━━━━━━━━━━',
    `Agenda:  ${agendaName}`,
    `Doom:    ${doom} / ${threshold}  [${bar}]`,
    `Round:   ${round}`,
    `Phase:   ${phase}`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    'Investigators:',
    ...players.map(p => `  🔍 ${p.investigator_name.padEnd(20)} HP: ${p.hp}/${p.max_hp}  SAN: ${p.sanity}/${p.max_sanity}`),
    '━━━━━━━━━━━━━━━━━━━━━━',
  ];
  return lines.join('\n');
}
