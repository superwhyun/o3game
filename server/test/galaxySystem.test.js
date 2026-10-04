const assert = require('node:assert/strict');
const test = require('node:test');

const { buildGalaxySystem } = require('../utils/galaxySystem');

test('buildGalaxySystem exposes only the requested system and safe player fields', () => {
  const result = buildGalaxySystem({
    galaxy: 1,
    system: 2,
    requestingUserId: 'player-1',
    users: [
      {
        _id: 'player-1',
        username: 'Commander',
        isOnline: true,
        socketId: 'must-not-leak',
        planets: [
          { galaxy: 1, system: 2, planet: 4, name: 'Home', _id: 'home-id' },
          { galaxy: 1, system: 3, planet: 5, name: 'Elsewhere' }
        ]
      },
      {
        _id: 'player-2',
        username: 'Neighbor',
        isOnline: false,
        socketId: 'must-not-leak-either',
        planets: [{ galaxy: 1, system: 2, planet: 8, name: 'Target' }]
      }
    ]
  });

  assert.equal(result.positions[3].owner, 'self');
  assert.deepEqual(result.positions[3].planet, {
    id: 'home-id',
    name: 'Home',
    username: 'Commander',
    isOnline: true
  });
  assert.equal(result.positions[7].owner, 'other');
  assert.equal(result.positions[7].planet.socketId, undefined);
  assert.equal(result.positions[4].occupied, false);
});

test('buildGalaxySystem rejects invalid coordinates', () => {
  assert.throws(
    () => buildGalaxySystem({ galaxy: 0, system: 1, requestingUserId: 'player', users: [] }),
    /galaxy/
  );
});

test('buildGalaxySystem keeps the first claimant of a duplicated slot and reports the rest', () => {
  const result = buildGalaxySystem({
    galaxy: 1,
    system: 1,
    requestingUserId: 'player',
    users: [
      { _id: 'one', username: 'One', planets: [{ galaxy: 1, system: 1, planet: 1 }] },
      { _id: 'two', username: 'Two', planets: [{ galaxy: 1, system: 1, planet: 1 }] }
    ]
  });

  assert.equal(result.positions[0].planet.username, 'One');
  assert.deepEqual(result.conflicts, [{ position: 1, userId: 'two' }]);
});
