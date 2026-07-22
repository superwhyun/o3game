/** Server-side validation rules for fleet-launch input. */

const CARGO_RESOURCES = Object.freeze(['metal', 'crystal', 'deuterium']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative integer`);
  }

  return value;
}

/** Validate one coordinate segment received from a fleet-launch request. */
function validateCoordinate(value, label = 'coordinate') {
  return assertNonNegativeInteger(value, label);
}

function normalizeKnownTypes(allowedFleetTypes) {
  if (!Array.isArray(allowedFleetTypes) || allowedFleetTypes.some(
    (type) => typeof type !== 'string' || type.length === 0
  )) {
    throw new TypeError('allowedFleetTypes must contain non-empty strings');
  }

  return new Set(allowedFleetTypes);
}

/**
 * Normalize a selected fleet, rejecting unsupported ship types and invalid
 * quantities instead of coercing client input.
 */
function normalizeFleet(fleet, allowedFleetTypes) {
  assertPlainObject(fleet, 'fleet');
  const knownTypes = normalizeKnownTypes(allowedFleetTypes);
  const normalizedFleet = {};

  for (const [shipType, quantity] of Object.entries(fleet)) {
    if (!knownTypes.has(shipType)) {
      throw new RangeError(`Unknown fleet type: ${shipType}`);
    }

    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new RangeError(`${shipType} quantity must be a positive integer`);
    }

    normalizedFleet[shipType] = quantity;
  }

  return normalizedFleet;
}

/** Normalize cargo to the game's transportable resource set. */
function normalizeCargo(cargo = {}) {
  assertPlainObject(cargo, 'cargo');

  for (const resource of Object.keys(cargo)) {
    if (!CARGO_RESOURCES.includes(resource)) {
      throw new RangeError(`Unknown cargo resource: ${resource}`);
    }
  }

  return CARGO_RESOURCES.reduce((normalizedCargo, resource) => {
    normalizedCargo[resource] = assertNonNegativeInteger(cargo[resource] ?? 0, resource);
    return normalizedCargo;
  }, {});
}

/** Ensure every selected ship exists at the origin in sufficient quantity. */
function assertFleetAvailable(selectedFleet, originFleet) {
  assertPlainObject(originFleet, 'origin fleet');
  const normalizedFleet = normalizeFleet(selectedFleet, Object.keys(originFleet));

  for (const [shipType, quantity] of Object.entries(normalizedFleet)) {
    const available = assertNonNegativeInteger(originFleet[shipType], `origin ${shipType}`);
    if (quantity > available) {
      throw new RangeError(`Insufficient ${shipType} at origin`);
    }
  }

  return normalizedFleet;
}

/** Ensure requested cargo does not exceed the origin's stored resources. */
function assertCargoAvailable(cargo, originResources) {
  assertPlainObject(originResources, 'origin resources');
  const normalizedCargo = normalizeCargo(cargo);

  for (const resource of CARGO_RESOURCES) {
    const available = assertNonNegativeInteger(originResources[resource] ?? 0, `origin ${resource}`);
    if (normalizedCargo[resource] > available) {
      throw new RangeError(`Insufficient ${resource} at origin`);
    }
  }

  return normalizedCargo;
}

/** Reject a launch request that contains no ships. */
function assertNonEmptyFleet(fleet) {
  assertPlainObject(fleet, 'fleet');
  if (Object.keys(fleet).length === 0) {
    throw new RangeError('A fleet launch requires at least one ship');
  }

  return fleet;
}

function calculateFleetProfile(fleet, shipStatsByType) {
  assertPlainObject(shipStatsByType, 'shipStatsByType');
  let cargoCapacity = 0;
  let slowestSpeed = Infinity;

  for (const [shipType, quantity] of Object.entries(fleet)) {
    const stats = shipStatsByType[shipType];
    const cargo = stats?.cargo;
    const speed = stats?.speed;

    if (!Number.isSafeInteger(cargo) || cargo < 0) {
      throw new RangeError(`${shipType} cargo capacity must be a finite non-negative integer`);
    }
    if (!Number.isSafeInteger(speed) || speed <= 0) {
      throw new RangeError(`${shipType} speed must be a finite positive integer`);
    }

    cargoCapacity += cargo * quantity;
    slowestSpeed = Math.min(slowestSpeed, speed);
  }

  return { cargoCapacity, slowestSpeed };
}

function calculateTravelSeconds(origin, destination, slowestSpeed, speedPercent) {
  if (!Number.isSafeInteger(slowestSpeed) || slowestSpeed <= 0) {
    throw new RangeError('slowestSpeed must be a finite positive integer');
  }
  if (!Number.isSafeInteger(speedPercent) || speedPercent < 10 || speedPercent > 100 || speedPercent % 10 !== 0) {
    throw new RangeError('speedPercent must be a supported value between 10 and 100');
  }

  const coordinateDistance = ['galaxy', 'system', 'planet'].reduce((total, coordinate) => {
    const from = validateCoordinate(origin?.[coordinate], `origin ${coordinate}`);
    const to = validateCoordinate(destination?.[coordinate], `destination ${coordinate}`);
    return total + Math.abs(to - from);
  }, 0);
  const distance = Math.max(1, coordinateDistance);

  return Math.ceil((distance * 350 * 1000 * 100) / (slowestSpeed * speedPercent));
}

module.exports = {
  CARGO_RESOURCES,
  assertCargoAvailable,
  assertFleetAvailable,
  assertNonEmptyFleet,
  calculateFleetProfile,
  calculateTravelSeconds,
  normalizeCargo,
  normalizeFleet,
  validateCoordinate
};
