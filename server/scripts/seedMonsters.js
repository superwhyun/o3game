/**
 * Register the starter monster types (small / medium / large) in the database.
 *
 *   node scripts/seedMonsters.js              # add missing types, leave existing ones alone
 *   node scripts/seedMonsters.js --overwrite  # also reset existing types to the preset values
 *
 * Uses MONGODB_URI like the game server. Existing types are never touched without --overwrite,
 * so values an administrator edited afterwards are kept. Running events keep their own copy.
 */
const mongoose = require('mongoose');
const presets = require('../data/monsters/presets');
const MonsterType = require('../models/MonsterType');
const monsters = require('../services/MonsterService');

async function seedMonsters({ overwrite = false } = {}) {
  const report = { created: [], updated: [], kept: [] };
  for (const preset of presets) {
    const exists = await MonsterType.exists({ typeId: preset.typeId });
    if (exists && !overwrite) { report.kept.push(preset.typeId); continue; }
    await monsters.saveType(null, preset);
    (exists ? report.updated : report.created).push(preset.typeId);
  }
  return report;
}

module.exports = { seedMonsters };

if (require.main === module) {
  (async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cosmic_empire');
    const report = await seedMonsters({ overwrite: process.argv.includes('--overwrite') });
    console.log(`created: ${report.created.join(', ') || '-'}\nupdated: ${report.updated.join(', ') || '-'}\nkept (already present): ${report.kept.join(', ') || '-'}`);
    await mongoose.disconnect();
    process.exit(0); // the service modules keep timers alive
  })().catch((error) => { console.error(error.message); process.exit(1); });
}
