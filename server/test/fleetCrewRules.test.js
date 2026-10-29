const test = require('node:test'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), path = require('node:path');
const rules = require('../utils/fleetCrew');
test('fleet crew boundaries, mixed fleets and unmanned exemptions match client previews', async () => {
  const { fleetCrew } = await import(pathToFileURL(path.join(__dirname, '../../ogame-3d/src/data/fleetMath.js')).href);
  for (const [ships, expected] of [[{}, 0], [{ espionageProbe: 1000, colonyShip: 2 }, 0], [{ smallCargo: 1 }, 10], [{ largeCargo: 99 }, 10], [{ largeCargo: 100 }, 11], [{ largeCargo: 199 }, 11], [{ largeCargo: 1000 }, 20], [{ cruiser: 2 }, 10], [{ smallCargo: 1, espionageProbe: 99 }, 11]]) {
    assert.equal(rules.requiredCrew(ships), expected);
    assert.equal(fleetCrew(ships, id => ({ crew: rules.crewPerShip(id) })), expected);
  }
});
test('legacy crews return only the difference once, including mission crews, and never invent residents', () => {
  const planet = { _id: 'base', population: { count: 3 } };
  const fleet = { originPlanetId: 'base', crewVersion: 1, crew: 29, ships: { smallCargo: 1, largeCargo: 14 }, status: 'onMission' };
  const user = { planets: [planet], fleetFormations: [fleet] };
  rules.initializeCrews(user);
  assert.equal(fleet.crew, 10); assert.equal(planet.population.count, 22); assert.equal(fleet.crewVersion, 2);
  rules.initializeCrews(user); assert.equal(planet.population.count, 22);
  user.fleetFormations.push({ originPlanetId: 'base', crewVersion: 1, crew: 8, ships: { cruiser: 2 } });
  rules.initializeCrews(user); assert.equal(planet.population.count, 20); assert.equal(user.fleetFormations[1].crew, 10);
  planet.population.count = 1;
  const short = { originPlanetId: 'base', crewVersion: 1, crew: 2, ships: { smallCargo: 2 } };
  user.fleetFormations.push(short); rules.initializeCrews(user);
  assert.equal(short.crew, 3); assert.equal(planet.population.count, 0); assert.match(short.notice, /不足|부족/);
  rules.initializeCrews(user); assert.equal(short.crew, 3); assert.equal(planet.population.count, 0);
});
test('crew losses follow surviving manned ships and cannot become a resident refund', () => {
  const formation = { crew: 10, ships: { cruiser: 2, espionageProbe: 1000 } };
  assert.equal(rules.applyCrewLoss(formation, { cruiser: 1 }), 5);
  assert.equal(formation.crew, 5);
  assert.equal(rules.applyCrewLoss(formation, {}), 5);
  assert.equal(formation.crew, 0);
});
