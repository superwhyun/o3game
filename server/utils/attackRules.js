const RESOURCES = Object.freeze(['metal', 'crystal', 'deuterium']);

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertQuantity(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative integer`);
  }
  return value;
}

function normalizeResources(resources = {}) {
  assertObject(resources, 'resources');
  for (const key of Object.keys(resources)) {
    if (!RESOURCES.includes(key)) throw new RangeError(`Unknown resource: ${key}`);
  }
  return Object.fromEntries(RESOURCES.map((resource) => [
    resource,
    assertQuantity(resources[resource] ?? 0, resource)
  ]));
}

function calculateRaidLoot(defenderResources, cargoCapacity) {
  assertQuantity(cargoCapacity, 'cargoCapacity');
  const cappedResources = normalizeResources(defenderResources);
  let remainingCapacity = cargoCapacity;
  const loot = {};

  for (const resource of RESOURCES) {
    const cappedAmount = Math.floor(cappedResources[resource] / 2);
    const amount = Math.min(cappedAmount, remainingCapacity);
    loot[resource] = amount;
    remainingCapacity -= amount;
  }

  return loot;
}

function calculateSurvivors(initialUnits, losses) {
  assertObject(initialUnits, 'initialUnits');
  assertObject(losses, 'losses');
  const survivors = {};

  for (const [unit, initial] of Object.entries(initialUnits)) {
    const initialCount = assertQuantity(initial, unit);
    const lossCount = assertQuantity(losses[unit] ?? 0, unit);
    if (lossCount > initialCount) throw new RangeError(`${unit} losses cannot exceed initial units`);
    survivors[unit] = initialCount - lossCount;
  }
  for (const unit of Object.keys(losses)) {
    if (!(unit in initialUnits)) throw new RangeError(`Unknown unit: ${unit}`);
  }

  return survivors;
}

function mergeCargo(left, right) {
  const first = normalizeResources(left);
  const second = normalizeResources(right);
  return Object.fromEntries(RESOURCES.map((resource) => [resource, first[resource] + second[resource]]));
}

module.exports = { calculateRaidLoot, calculateSurvivors, mergeCargo, normalizeResources };
