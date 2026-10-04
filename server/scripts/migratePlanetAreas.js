/** Dry run by default; --apply writes only missing area metadata, transactionally. */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Queue = require('../models/BuildingQueue');
const { normalizeLegacyArea, calculateArea } = require('../utils/planetArea');
const { atomic, requireTransactions } = require('../services/transactions');
async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(process.env.MONGODB_URI);
  const apply = process.argv.includes('--apply');
  if (apply) await requireTransactions();
  const cursor = User.find({ planets: { $elemMatch: { areaVersion: { $ne: 1 } } } }).select('_id username planets terraformingLevel').lean().cursor();
  let changed = 0, exceptions = 0;
  for await (const row of cursor) {
    await atomic(async () => {
      // Re-read inside transaction to avoid overwriting ongoing gameplay.
      const user = await User.findById(row._id);
      const queues = await Queue.find({ userId: row._id, applied: false, status: { $in: ['building', 'pending'] } }).lean();
      let dirty = false;
      user.planets.forEach((p, index) => {
        if (!normalizeLegacyArea(p, queues, String(index))) return;
        dirty = true;
        const area = calculateArea(p, user.terraformingLevel, queues, String(index));
        console.log(JSON.stringify({ userId: String(row._id), planetId: index, baseUsablePercent: p.baseUsablePercent, area, applied: apply }));
        if (area.overCapacity) exceptions++;
      });
      if (dirty) { changed++; if (apply) { user.markModified('planets'); await user.save(); } }
    });
  }
  console.log(JSON.stringify({ changedUsers: changed, overCapacityPlanets: exceptions, applied: apply }));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
module.exports = { main };
