const path = require('path');
const fs = require('fs');

const SCENARIO_ROOT = path.join(__dirname, '../data/scenarios');

// Load scenario from a session object (uses session.campaign_dir + session.scenario_code).
function loadScenario(session) {
  const dir = session.campaign_dir || 'night_of_zealot';
  const filePath = path.join(SCENARIO_ROOT, dir, session.scenario_code + '.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Load scenario by explicit directory and filename (used at game start before session exists).
function loadScenarioFile(dir, file) {
  const filePath = path.join(SCENARIO_ROOT, dir, file + '.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Load campaign index (list of scenarios) for a given campaign directory.
function loadCampaignIndex(dir) {
  const filePath = path.join(SCENARIO_ROOT, dir, 'campaign.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

module.exports = { loadScenario, loadScenarioFile, loadCampaignIndex };
