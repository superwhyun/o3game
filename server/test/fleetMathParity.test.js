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


test('flight multiplier is independent of economy speed, with a one-second minimum', async () => {
  const { travelSeconds } = await import(CLIENT_FLEET_MATH);
  const origin = { galaxy: 1, system: 1, planet: 1 };
  const destination = { galaxy: 1, system: 401, planet: 1 };
  assert.equal(calculateTravelSeconds(origin, destination, 5000, 100), 3575);
  assert.equal(calculateTravelSeconds(origin, destination, 5000, 100, { serverSpeed: 100 }), 3575);
  for (const serverSpeed of [0.5, 1, 10, 100]) {
    for (const flightSpeedMultiplier of [0.5, 1, 2]) {
      for (const [from, to] of ROUTES) {
        const settings = { serverSpeed, flightSpeedMultiplier };
        assert.equal(travelSeconds(from, to, 1000000, 100, settings), calculateTravelSeconds(from, to, 1000000, 100, settings));
      }
    }
  }
  assert.equal(travelSeconds(origin, origin, 1000000, 100, { serverSpeed: 100, flightSpeedMultiplier: 100 }), 1);
  for (const invalid of [0, -1, Infinity, NaN]) {
    assert.throws(() => calculateTravelSeconds(origin, destination, 5000, 100, { flightSpeedMultiplier: invalid }), /multipliers/);
  }
});

test('long routes use distinct galaxy and system scales, including probes with independent flight speed', () => {
  const home = { galaxy:1, system:1, planet:7 };
  const orbit = { galaxy:1, system:1, planet:8 };
  const farSystem = { galaxy:1, system:499, planet:7 };
  const galaxy = { galaxy:2, system:1, planet:7 };
  const farGalaxy = { galaxy:9, system:1, planet:7 };
  for (const ship of launchable) {
    const times = [orbit,farSystem,galaxy,farGalaxy].map(target => calculateTravelSeconds(home,target,ship.stats.speed,100,{serverSpeed:100}));
    assert.ok(times.every((time,i)=>!i || time > times[i-1]), `${ship.id}: ${times}`);
  }
  assert.equal(calculateTravelSeconds(home,farSystem,100000000,100,{flightSpeedMultiplier:100}),6);
  assert.equal(calculateTravelSeconds(home,galaxy,100000000,100,{flightSpeedMultiplier:100}),11);
});

test('local offsets remain significant between galaxies and between systems', () => {
  const origin = {galaxy:1,system:1,planet:1};
  for (const speed of [2500,7500,100000000]) {
    const seconds = target => calculateTravelSeconds(origin,target,speed,100);
    assert.ok(seconds({galaxy:2,system:250,planet:1}) > seconds({galaxy:2,system:1,planet:1}));
    assert.ok(seconds({galaxy:2,system:250,planet:15}) > seconds({galaxy:2,system:250,planet:1}));
    assert.ok(seconds({galaxy:1,system:250,planet:15}) > seconds({galaxy:1,system:250,planet:1}));
    assert.equal(seconds({galaxy:2,system:250,planet:15}), calculateTravelSeconds({galaxy:2,system:250,planet:15}, origin, speed,100));
  }
});
