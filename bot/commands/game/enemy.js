const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { requireSession, requireHost, requirePlayer, getSession, getEnemy, getLocation, getCampaign, getPlayers } = require('../../engine/gameState');
const { spawnEnemyManual, damageEnemy, defeatEnemy } = require('../../engine/enemyEngine');
const { updateLocationStatus } = require('../../engine/locationManager');
const { findCard, findCardByCode } = require('../../engine/cardLookup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('enemy')
    .setDescription('Manage enemies.')
    .addSubcommand(sub =>
      sub.setName('spawn')
        .setDescription('Spawn an enemy at a location. Host only.')
        .addStringOption(o => o.setName('name').setDescription('Enemy name or card code').setRequired(true))
        .addStringOption(o => o.setName('location').setDescription('Location code').setRequired(true))
        .addIntegerOption(o => o.setName('hp').setDescription('HP (if manually specifying)').setMinValue(1))
        .addIntegerOption(o => o.setName('fight').setDescription('Fight value').setMinValue(1))
        .addIntegerOption(o => o.setName('evade').setDescription('Evade value').setMinValue(1))
        .addIntegerOption(o => o.setName('damage').setDescription('Damage').setMinValue(0))
        .addIntegerOption(o => o.setName('horror').setDescription('Horror').setMinValue(0)))
    .addSubcommand(sub =>
      sub.setName('damage')
        .setDescription('Deal damage to an enemy.')
        .addIntegerOption(o => o.setName('id').setDescription('Enemy ID').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Damage amount').setRequired(true).setMinValue(1)))
    .addSubcommand(sub =>
      sub.setName('defeat')
        .setDescription('Defeat an enemy.')
        .addIntegerOption(o => o.setName('id').setDescription('Enemy ID').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all active enemies.')),

  async execute(interaction) {
    const session = requireSession(interaction);
    if (!session) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'spawn') {
      requireHost(interaction);
      const nameQuery = interaction.options.getString('name');
      const locQuery = interaction.options.getString('location').toLowerCase();

      const { getLocations } = require('../../engine/gameState');
      const locations = getLocations(session.id);
      const loc = locations.find(l => l.code.includes(locQuery) || l.name.toLowerCase().includes(locQuery));
      if (!loc) return interaction.reply({ content: `Location "${locQuery}" not found.`, flags: 64 });

      // Try to look up card data
      const cardResult = findCard(nameQuery, { typeCode: 'enemy' });
      let enemyId;

      if (cardResult) {
        const c = cardResult.card;
        const { spawnEnemy } = require('../../engine/enemyEngine');
        // Build full card object for spawnEnemy
        const { findCardByCode: fcbc } = require('../../engine/cardLookup');
        const fullResult = fcbc(c.code);
        const fullCard = fullResult?.card || c;
        enemyId = spawnEnemy(session.id, loc.code, {
          code: c.code,
          name: c.name,
          health: interaction.options.getInteger('hp') || fullCard.health || c.health || 1,
          enemy_fight: interaction.options.getInteger('fight') || fullCard.enemy_fight || c.enemy_fight || 1,
          enemy_evade: interaction.options.getInteger('evade') || fullCard.enemy_evade || c.enemy_evade || 1,
          enemy_damage: interaction.options.getInteger('damage') ?? fullCard.enemy_damage ?? c.enemy_damage ?? 1,
          enemy_horror: interaction.options.getInteger('horror') ?? fullCard.enemy_horror ?? c.enemy_horror ?? 1,
        });

        if (cardResult.imagePath) {
          const locCh = interaction.guild.channels.cache.get(loc.channel_id);
          if (locCh) {
            const att = new AttachmentBuilder(cardResult.imagePath, { name: 'enemy.png' });
            await locCh.send({ content: `👹 **${c.name}** spawns in **${loc.name}**!`, files: [att] });
          }
        }
      } else {
        enemyId = spawnEnemyManual(
          session.id, loc.code, nameQuery,
          interaction.options.getInteger('hp') || 1,
          interaction.options.getInteger('fight') || 1,
          interaction.options.getInteger('evade') || 1,
          interaction.options.getInteger('damage') ?? 1,
          interaction.options.getInteger('horror') ?? 1,
        );
        const locCh = interaction.guild.channels.cache.get(loc.channel_id);
        if (locCh) await locCh.send(`👹 **${nameQuery}** spawns in **${loc.name}**!`);
      }

      const refreshedLoc = getLocation(session.id, loc.code);
      const campaign = getCampaign();
      const players = getPlayers(campaign.id);
      await updateLocationStatus(interaction.guild, session, refreshedLoc);
      await interaction.reply(`✅ Enemy spawned in **${loc.name}** (ID: ${enemyId}).`);
    }

    else if (sub === 'damage') {
      requirePlayer(interaction);
      const id = interaction.options.getInteger('id');
      const amount = interaction.options.getInteger('amount');
      const enemy = getEnemy(id);
      if (!enemy) return interaction.reply({ content: `No enemy with ID ${id}.`, flags: 64 });

      const newHp = damageEnemy(enemy, amount);
      if (newHp === 0) {
        defeatEnemy(id);
        const loc = getLocation(session.id, enemy.location_code);
        if (loc) {
          const campaign = getCampaign();
          const players = getPlayers(campaign.id);
          await updateLocationStatus(interaction.guild, session, loc);
        }
        await interaction.reply(`💀 **${enemy.name}** (ID: ${id}) has been defeated!`);
      } else {
        await interaction.reply(`⚔️ **${enemy.name}** took ${amount} damage. HP: **${newHp}/${enemy.max_hp}**`);
      }
    }

    else if (sub === 'defeat') {
      requireHost(interaction);
      const id = interaction.options.getInteger('id');
      const enemy = getEnemy(id);
      if (!enemy) return interaction.reply({ content: `No enemy with ID ${id}.`, flags: 64 });
      defeatEnemy(id);
      const loc = getLocation(session.id, enemy.location_code);
      if (loc) {
        const campaign = getCampaign();
        const players = getPlayers(campaign.id);
        await updateLocationStatus(interaction.guild, session, loc);
      }
      await interaction.reply(`💀 **${enemy.name}** (ID: ${id}) defeated.`);
    }

    else if (sub === 'list') {
      const { getEnemies } = require('../../engine/gameState');
      const enemies = getEnemies(session.id);
      if (enemies.length === 0) return interaction.reply({ content: 'No active enemies.', flags: 64 });
      const lines = enemies.map(e => `**[${e.id}]** ${e.name} @ ${e.location_code} — HP: ${e.hp}/${e.max_hp} | Fight: ${e.fight} | Evade: ${e.evade}`);
      await interaction.reply({ content: '👹 **Active Enemies:**\n' + lines.join('\n'), flags: 64 });
    }
  },
};
