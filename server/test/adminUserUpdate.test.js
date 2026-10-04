const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeAdminUserUpdate } = require('../utils/adminUserUpdate');

test('normalizeAdminUserUpdate accepts supported admin and resource fields', () => {
  const update = normalizeAdminUserUpdate({
    isBanned: true,
    banReason: 'Repeated abuse',
    isAdmin: true,
    adminRole: 'moderator',
    planetIndex: 1,
    resources: { metal: 100, crystal: 200, deuterium: 300, energy: 0 }
  }, 2);

  assert.deepEqual(update, {
    isBanned: true,
    banReason: 'Repeated abuse',
    isAdmin: true,
    adminRole: 'moderator',
    planetIndex: 1,
    resources: { metal: 100, crystal: 200, deuterium: 300, energy: 0 }
  });
});

test('normalizeAdminUserUpdate rejects invalid roles, planets, and resources', () => {
  assert.throws(
    () => normalizeAdminUserUpdate({ isAdmin: true, adminRole: 'owner' }, 1),
    /Invalid admin role/
  );
  assert.throws(
    () => normalizeAdminUserUpdate({ planetIndex: 1, resources: { metal: 1 } }, 1),
    /Invalid planet index/
  );
  assert.throws(
    () => normalizeAdminUserUpdate({ planetIndex: 0, resources: { unobtanium: 1 } }, 1),
    /Invalid resource/
  );
  assert.throws(
    () => normalizeAdminUserUpdate({ planetIndex: 0, resources: { metal: -1 } }, 1),
    /non-negative whole number/
  );
  assert.throws(
    () => normalizeAdminUserUpdate({ isAdmin: true, adminRole: null }, 1),
    /must have an admin role/
  );
});

test('normalizeAdminUserUpdate clears a role when admin access is removed', () => {
  assert.deepEqual(
    normalizeAdminUserUpdate({ isAdmin: false, adminRole: 'superadmin' }, 1),
    { isAdmin: false, adminRole: null }
  );
});
