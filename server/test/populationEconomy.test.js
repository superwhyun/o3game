const test = require('node:test');
const assert = require('node:assert/strict');
const entities = require('../services/EntityConfigService');
const { ENTITY_CATALOG_DEFAULTS } = require('../data/catalog');
const { initializePopulation, calculatePopulation } = require('../utils/populationEconomy');
const { calculateProduction, applyOfflineProduction } = require('../utils/planetEconomy');
const { calculateArea } = require('../utils/planetArea');
for (const def of ENTITY_CATALOG_DEFAULTS) entities.cache.get(def.entityType).set(def.entityId, def);
const epoch = new Date('2026-01-01T00:00:00Z');
const config = { serverSpeed: 1, resourceSettings: { defaultStorage: { metal: 1e12, crystal: 1e12, deuterium: 1e12 } } };
const copy = p => structuredClone(p);
function planet(buildings = {}) {
  const p = { buildings, resources: { metal: 0, crystal: 0, deuterium: 0 }, traits: { metal: 1, crystal: 1 }, lastUpdate: epoch };
  initializePopulation(p, config);
  return p;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('initial support preserves all current mining production and consumes no land; transition is idempotent', () => {
  const p = { buildings: { metalMine: 40, crystalMine: 20, deuteriumSynthesizer: 5 }, diameter: 8000, baseUsablePercent: 40, resources: {} };
  const before = calculateProduction(p);
  const area = calculateArea(p);
  initializePopulation(p, config);
  const after = calculateProduction(p);
  for (const key of ['metal', 'crystal', 'deuterium', 'energy']) near(after[key], before[key]);
  assert.deepEqual(calculateArea(p), area);
  assert.equal(p.population.count, 65);
  assert.equal(p.population.baseHousing, 70);
  assert.equal(p.resources.food, 65 * 24);
  assert.equal(calculatePopulation(p).foodCapacity, 65 * 24);
  const original = copy(p);
  assert.equal(initializePopulation(p), false);
  assert.deepEqual(p, original);
});

test('automatic jobs prioritize farms and culture, then allocate mines proportionally', () => {
  const p = planet({ metalMine: 6, crystalMine: 2, hydroponicFarm: 2, cultureCenter: 1 });
  p.population.count = 7;
  const state = calculatePopulation(p);
  assert.equal(state.jobs.hydroponicFarm.assigned, 2);
  assert.equal(state.jobs.cultureCenter.assigned, 1);
  assert.equal(state.jobs.metalMine.assigned, 3);
  assert.equal(state.jobs.crystalMine.assigned, 1);
  assert.equal(state.unemployed, 0);
  p.population.count = 1;
  const low = calculatePopulation(p);
  assert.equal(low.jobs.hydroponicFarm.assigned, 1);
  assert.equal(low.jobs.cultureCenter.assigned, 0);
  assert.equal(low.jobs.metalMine.assigned, 0);
  assert.equal(calculateProduction(p).metal, 30);
});

test('culture improves happiness and staffed mining but food production does not depend on happiness', () => {
  const p = planet({ metalMine: 2, hydroponicFarm: 1 });
  const before = calculatePopulation(p);
  const metal = calculateProduction(p).metal;
  p.buildings.cultureCenter = 1;
  const after = calculatePopulation(p);
  assert.ok(after.happiness > before.happiness);
  assert.ok(calculateProduction(p).metal > metal);
  assert.equal(after.foodProduction, before.foodProduction);
});

test('growth happens after two hours, pauses without losing progress, resumes with facilities and scales with server speed', () => {
  const p = planet();
  applyOfflineProduction(p, config, new Date(+epoch + 3600000));
  near(p.population.growthProgress, .5);
  p.population.baseHousing = 10;
  applyOfflineProduction(p, config, new Date(+epoch + 4 * 3600000));
  assert.equal(p.population.count, 10);
  near(p.population.growthProgress, .5);
  p.buildings.housing = 1;
  p.buildings.hydroponicFarm = 1;
  applyOfflineProduction(p, config, new Date(+epoch + 5 * 3600000));
  assert.equal(p.population.count, 11);
  near(p.population.growthProgress, 0);
  const fast = planet();
  applyOfflineProduction(fast, { ...config, serverSpeed: 2 }, new Date(+epoch + 3600000));
  assert.equal(fast.population.count, 11);
});

test('food exhaustion starts population loss progress; agriculture restores supply', () => {
  const p = planet({ metalMine: 2 });
  p.population.count = 12;
  p.resources.food = 1;
  const before = calculateProduction(p).metal;
  applyOfflineProduction(p, config, new Date(+epoch + 3600000));
  assert.equal(p.resources.food, 0);
  assert.equal(p.population.count, 12);
  assert.ok(calculatePopulation(p).starving);
  assert.ok(calculateProduction(p).metal < before);
  p.buildings.hydroponicFarm = 1;
  const recovered = calculatePopulation(p);
  assert.equal(recovered.starving, false);
  assert.equal(recovered.growthAllowed, true);
  applyOfflineProduction(p, config, new Date(+epoch + 2 * 3600000));
  assert.ok(p.resources.food > 0);
});

test('crowding blocks growth and food exhaustion reduces residents', () => {
  const p = planet({ metalMine: 1 });
  p.population.count = 40;
  p.resources.food = 0;
  const state = calculatePopulation(p);
  assert.equal(state.growthAllowed, false);
  assert.deepEqual(state.growthBlockers, ['주거 부족', '식량 공급 부족', '행복도 부족']);
  applyOfflineProduction(p, config, new Date(+epoch + 24 * 3600000));
  assert.equal(p.population.count, 28);
  assert.equal(p.resources.food, 0);
});

test('frequent requests and offline settlement match across births, full stores and food exhaustion', () => {
  for (const buildings of [{ metalMine: 8 }, { metalMine: 12, housing: 2, hydroponicFarm: 2, cultureCenter: 1 }]) {
    const single = planet(buildings), frequent = copy(single);
    single.resources.food = frequent.resources.food = 1;
    const end = +epoch + 48 * 3600000;
    applyOfflineProduction(single, config, new Date(end));
    for (let time = +epoch + 117000; time < end; time += 117000) applyOfflineProduction(frequent, config, new Date(time));
    applyOfflineProduction(frequent, config, new Date(end));
    assert.equal(single.population.count, frequent.population.count);
    near(single.population.growthProgress, frequent.population.growthProgress);
    for (const resource of ['metal', 'crystal', 'deuterium', 'food']) near(single.resources[resource], frequent.resources[resource]);
  }
});

test('seven-day and longer offline periods are credited and old timestamps cannot double-credit', () => {
  const p = planet();
  const end = new Date(+epoch + 9 * 86400000);
  applyOfflineProduction(p, config, end);
  near(p.resources.metal, 30 * 9 * 24);
  const before = copy(p);
  applyOfflineProduction(p, config, epoch);
  assert.deepEqual(p, before);
});

test('queue boundary and food shortage produce the same result under repeated settlement', () => {
  const single = planet({ metalMine: 4 }), frequent = copy(single);
  const boundary = +epoch + 3 * 3600000, end = +epoch + 36 * 3600000;
  applyOfflineProduction(single, config, new Date(boundary));
  for (let time = +epoch + 300000; time <= boundary; time += 300000) applyOfflineProduction(frequent, config, new Date(time));
  single.buildings.hydroponicFarm = frequent.buildings.hydroponicFarm = 2;
  single.buildings.housing = frequent.buildings.housing = 1;
  single.buildings.cultureCenter = frequent.buildings.cultureCenter = 1;
  applyOfflineProduction(single, config, new Date(end));
  for (let time = boundary + 300000; time <= end; time += 300000) applyOfflineProduction(frequent, config, new Date(time));
  assert.equal(single.population.count, frequent.population.count);
  near(single.population.growthProgress, frequent.population.growthProgress);
  for (const resource of ['metal', 'crystal', 'deuterium', 'food']) near(single.resources[resource], frequent.resources[resource]);
});


test('production uses configured happiness coefficients from a Mongoose config document', () => {
  const Config = require('../models/GameConfig');
  const cfg = new Config({ populationSettings: { productionSensitivity: .02 } });
  const p = planet({ metalMine: 1, cultureCenter: 1 });
  const state = calculatePopulation(p, cfg);
  const base = calculateProduction({ buildings: { metalMine: 1 }, traits: p.traits }).metal;
  near(calculateProduction(p, 1, {}, cfg).metal, 30 + (base - 30) * state.productionMultiplier);
});

test('education and health require staff, scale per resident and affect actual mining and growth', () => {
  const p = planet({ metalMine: 2 });
  const base = calculateProduction(p).metal;
  p.buildings.school = p.buildings.clinic = 1;
  const state = calculatePopulation(p);
  assert.equal(state.knowledge, 100);
  assert.equal(state.health, 100);
  assert.equal(state.happiness, 60);
  near(state.productionMultiplier, 1.05 * 1.25);
  near(state.growthHours, 1.6);
  near(calculateProduction(p).metal, 30 + (base - 30) * 1.05 * 1.25);
  p.population.count = 20;
  assert.equal(calculatePopulation(p).knowledge, 50);
  p.population.count = 1;
  const low = calculatePopulation(p);
  assert.equal(low.jobs.clinic.assigned, 1);
  assert.equal(low.jobs.school.assigned, 0);
  assert.equal(low.knowledge, 0);
  assert.equal(calculateProduction(p).metal, 30);
});

test('all civil research modifies its target and remains local to its planet', () => {
  const p = planet({ housing: 1, hydroponicFarm: 1, school: 1, clinic: 1 });
  p.population.count = 20;
  const before = calculatePopulation(p);
  p.research = { urbanPlanning: 2, agriculturalTechnology: 3, educationTechnology: 2, medicalTechnology: 1, socialPolicy: 3 };
  const after = calculatePopulation(p);
  near(after.housing - before.housing, 2);
  near(after.foodProduction - before.foodProduction, 3);
  near(after.knowledge, 70);
  near(after.health, 60);
  near(after.happiness - before.happiness, 7);
  assert.equal(calculatePopulation(planet()).happiness, 50);
  p.research.socialPolicy = 100;
  assert.equal(calculatePopulation(p).happiness, 100);
});

test('education, medical support and civil research preserve offline/tick parity across births', () => {
  const p = planet({ metalMine: 5, housing: 3, hydroponicFarm: 3, cultureCenter: 2, school: 2, clinic: 2 });
  p.research = { agriculturalTechnology: 3, educationTechnology: 2, medicalTechnology: 2, socialPolicy: 1 };
  const frequent = copy(p);
  const end = +epoch + 24 * 3600000;
  applyOfflineProduction(p, config, new Date(end));
  for (let time = +epoch + 60000; time <= end; time += 60000) applyOfflineProduction(frequent, config, new Date(time));
  assert.equal(p.population.count, frequent.population.count);
  near(p.population.growthProgress, frequent.population.growthProgress);
  for (const key of ['metal', 'crystal', 'deuterium', 'food']) near(p.resources[key], frequent.resources[key]);
});

test('starvation waits for reserves, loses one per base growth interval, resumes supply and matches polling', () => {
  const p = planet(); p.population.count = 14; p.resources.food = 4;
  const frequent = copy(p);
  applyOfflineProduction(p, config, new Date(+epoch + 3 * 3600000));
  assert.equal(p.population.count, 13);
  assert.equal(p.resources.food, 0);
  for (let half = 1; half <= 6; half++) applyOfflineProduction(frequent, config, new Date(+epoch + half * 1800000));
  assert.equal(frequent.population.count, p.population.count);
  near(frequent.population.starvationProgress, p.population.starvationProgress);
  p.population.count = 10; // Supply now covers consumption, even at zero reserves.
  applyOfflineProduction(p, config, new Date(+epoch + 3.5 * 3600000));
  assert.equal(p.population.starvationProgress, 0);
  assert.equal(calculatePopulation(p).starving, false);
  const fast = planet(); fast.population.count = 14; fast.resources.food = 0;
  applyOfflineProduction(fast, {...config,serverSpeed:100}, new Date(+epoch + 72000));
  assert.equal(fast.population.count, 13);
  const empty = planet(); empty.population.count = 1; empty.population.baseFood = 0; empty.resources.food = 0;
  applyOfflineProduction(empty, config, new Date(+epoch + 3 * 3600000));
  assert.equal(empty.population.count, 0);
});

test('satellite power contributes to the server energy balance and varies with temperature, not speed', () => {
  const { calculateEnergyState } = require('../utils/planetEconomy');
  const p = planet({solarPlant:2,metalMine:1}); p.fleet = {solarSatellite:3}; p.maxTemp = 40;
  const without = calculateEnergyState({...p,fleet:{solarSatellite:0}});
  const actual = calculateEnergyState(p);
  const satellite = actual.sources.find(source => source.id === 'solarSatellite');
  assert.deepEqual(satellite, {id:'solarSatellite',name:'태양광 인공위성',count:3,perUnit:33,amount:99});
  near(actual.production - without.production,99);
  near(calculateProduction(p,100).energy,actual.balance);
  assert.equal(calculateEnergyState({...p,maxTemp:-60}).sources.at(-1).perUnit,16);
  assert.equal(calculateEnergyState({...p,fleet:{solarSatellite:1}}).sources.at(-1).amount,33);
});

test('food warehouses increase the storage buffer without changing production and survive offline settlement', () => {
  const p = planet({ hydroponicFarm: 2 });
  const before = calculatePopulation(p, config);
  p.buildings.foodStorage = 2;
  const after = calculatePopulation(p, config);
  assert.equal(after.foodCapacity, before.foodCapacity + 20000);
  assert.equal(after.foodProduction, before.foodProduction);
  assert.equal(after.foodConsumption, before.foodConsumption);
  p.resources.food = before.foodCapacity;
  applyOfflineProduction(p, config, new Date(+epoch + 3600 * 1000));
  assert.ok(p.resources.food > before.foodCapacity);
  assert.ok(p.resources.food <= after.foodCapacity);
  p.buildings.foodStorage = 0;
  assert.equal(calculatePopulation(p, config).foodCapacity, before.foodCapacity);
});
