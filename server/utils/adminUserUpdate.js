const ADMIN_ROLES = new Set(['superadmin', 'moderator', 'support']);
const RESOURCE_TYPES = new Set(['metal', 'crystal', 'deuterium', 'energy']);

const validationError = (message) => Object.assign(new Error(message), { statusCode: 400 });

const assertBoolean = (value, field) => {
  if (typeof value !== 'boolean') {
    throw validationError(`${field} must be a boolean`);
  }
  return value;
};

const normalizeAdminUserUpdate = (input, planetCount) => {
  const update = {};

  if (input.isBanned !== undefined) update.isBanned = assertBoolean(input.isBanned, 'isBanned');
  if (input.isAdmin !== undefined) update.isAdmin = assertBoolean(input.isAdmin, 'isAdmin');

  if (input.banReason !== undefined) {
    if (typeof input.banReason !== 'string' || input.banReason.length > 500) {
      throw validationError('Ban reason must be a string of 500 characters or fewer');
    }
    update.banReason = input.banReason.trim();
  }

  if (input.adminRole !== undefined && input.adminRole !== null) {
    if (!ADMIN_ROLES.has(input.adminRole)) throw validationError('Invalid admin role');
    update.adminRole = input.adminRole;
  } else if (input.adminRole === null) {
    update.adminRole = null;
  }

  if (input.resources !== undefined) {
    if (!Number.isInteger(input.planetIndex) || input.planetIndex < 0 || input.planetIndex >= planetCount) {
      throw validationError('Invalid planet index');
    }
    if (!input.resources || typeof input.resources !== 'object' || Array.isArray(input.resources)) {
      throw validationError('Resources must be an object');
    }

    const resources = {};
    for (const [resource, value] of Object.entries(input.resources)) {
      if (!RESOURCE_TYPES.has(resource)) throw validationError(`Invalid resource: ${resource}`);
      if (!Number.isSafeInteger(value) || value < 0) {
        throw validationError(`${resource} must be a non-negative whole number`);
      }
      resources[resource] = value;
    }
    update.planetIndex = input.planetIndex;
    update.resources = resources;
  }

  if (update.isAdmin === false) update.adminRole = null;
  if (update.isAdmin === true && update.adminRole === null) {
    throw validationError('An administrator must have an admin role');
  }

  return update;
};

module.exports = { normalizeAdminUserUpdate };
