/**
 * Needs a real MongoDB. Skipped unless MONGODB_TEST_URI is set, e.g.
 *   MONGODB_TEST_URI=mongodb://localhost:27017/cosmic_empire_test npm test
 * The database is dropped afterwards — never point this at real data.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');

require('../models/GameConfig');
const User = require('../models/User');

const uri = process.env.MONGODB_TEST_URI;

test('home planet allocation against MongoDB', { skip: !uri && 'MONGODB_TEST_URI not set' }, async (t) => {
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await User.createIndexes();
  t.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  await t.test('concurrent registrations get distinct coordinates', async () => {
    const users = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      User.createWithHomePlanet({ username: `pilot${i}`, email: `pilot${i}@example.com`, password: 'secret12' })
    ));
    const keys = users.map((user) => user.planets[0].coordinateKey);
    assert.equal(new Set(keys).size, keys.length);
    for (const user of users) {
      assert.equal(user.planets[0].position, user.planets[0].planet);
      assert.equal(await user.comparePassword('secret12'), true, 'password must not be double-hashed by retries');
    }
  });

  await t.test('the database rejects a second owner of the same slot', async () => {
    const [taken] = await User.find({}).limit(1).lean();
    const intruder = new User({
      username: 'intruder',
      email: 'intruder@example.com',
      password: 'secret12',
      planets: [{ galaxy: taken.planets[0].galaxy, system: taken.planets[0].system, planet: taken.planets[0].planet }]
    });
    await assert.rejects(intruder.save(), (error) => User.isCoordinateConflict(error));
  });
});
