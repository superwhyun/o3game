const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

test('seeding adds the starter monsters once, keeps administrator edits and resets them only on request', { timeout: 120000 }, async () => {
  const db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri('seed_test'));
  try {
    const MonsterType = require('../models/MonsterType');
    const { seedMonsters } = require('../scripts/seedMonsters');
    await MonsterType.init();

    assert.deepEqual(await seedMonsters(), { created: ['abyss-whelp', 'void-carapace', 'nebula-sovereign'], updated: [], kept: [] });
    assert.equal(await MonsterType.countDocuments(), 3);

    await MonsterType.updateOne({ typeId: 'abyss-whelp' }, { $set: { name: '관리자가 바꾼 이름' } });
    const again = await seedMonsters();
    assert.deepEqual(again.kept, ['abyss-whelp', 'void-carapace', 'nebula-sovereign']);
    assert.equal((await MonsterType.findOne({ typeId: 'abyss-whelp' })).name, '관리자가 바꾼 이름');
    assert.equal(await MonsterType.countDocuments(), 3);

    const reset = await seedMonsters({ overwrite: true });
    assert.equal(reset.updated.length, 3);
    assert.equal((await MonsterType.findOne({ typeId: 'abyss-whelp' })).name, '심연 새끼');
  } finally { await mongoose.disconnect(); await db.stop(); }
});
