const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { calculateFleetProfile, calculateTravelSeconds } = require('../utils/fleetRules');
const { CATALOG_SPECS } = require('../data/catalog');

const CLIENT_FLEET_MATH = pathToFileURL(path.join(__dirname, '../../ogame-3d/src/data/fleetMath.js')).href;

const statsById = Object.fromEntries(CATALOG_SPECS.ship.map((ship) => [ship.id, ship.stats]));
const launchable = CATALOG_SPECS.ship.filter((ship) => ship.stats.speed > 0);

const ROUTES = [
  [{ galaxy: 1, system: 1, planet: 7 }, { galaxy: 1, system: 1, planet: 11 }],
  [{ galaxy: 1, system: 1, planet: 7 }, { galaxy: 1, system: 1, planet: 7 }],
  [{ galaxy: 1, system: 4, planet: 2 }, { galaxy: 3, system: 120, planet: 15 }],
  [{ galaxy: 9, system: 499, planet: 15 }, { galaxy: 1, system: 1, planet: 1 }]
];

test('client travel time matches server calculateTravelSeconds', async () => {
  const { travelSeconds } = await import(CLIENT_FLEET_MATH);
  for (const ship of launchable) {
    for (const [origin, destination] of ROUTES) {
      for (const speedPercent of [10, 50, 100]) {
        assert.equal(
          travelSeconds(origin, destination, ship.stats.speed, speedPercent),
          calculateTravelSeconds(origin, destination, ship.stats.speed, speedPercent),
          `${ship.id} ${JSON.stringify(origin)} -> ${JSON.stringify(destination)} @${speedPercent}%`
        );
      }
    }
  }
});

test('client fleet profile matches server for launchable fleets', async () => {
  const { fleetProfile, isLaunchable } = await import(CLIENT_FLEET_MATH);
  const fleet = Object.fromEntries(launchable.map((ship, index) => [ship.id, index + 1]));
  const server = calculateFleetProfile(fleet, statsById);
  const client = fleetProfile(fleet, (id) => statsById[id]);
  assert.equal(client.cargoCapacity, server.cargoCapacity);
  assert.equal(client.slowestSpeed, server.slowestSpeed);

  for (const ship of CATALOG_SPECS.ship) {
    const serverAccepts = (() => {
      try {
        calculateFleetProfile({ [ship.id]: 1 }, statsById);
        return true;
      } catch {
        return false;
      }
    })();
    assert.equal(isLaunchable(ship.stats), serverAccepts, ship.id);
  }
});
