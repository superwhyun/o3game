const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');

const {
  getJwtSecret,
  verifyUserToken
} = require('../utils/authToken');

const createTestJwtSecret = () => [
  'test',
  'secret',
  'that',
  'is',
  'long',
  'enough',
  'for',
  'local',
  'validation'
].join('-');

test('getJwtSecret rejects a missing secret', () => {
  assert.throws(
    () => getJwtSecret({}),
    /JWT_SECRET must be configured/
  );
});

test('getJwtSecret rejects the legacy development fallback', () => {
  assert.throws(
    () => getJwtSecret({ JWT_SECRET: 'your-secret-key' }),
    /JWT_SECRET must be configured/
  );
});

test('verifyUserToken returns the signed user id', () => {
  const secret = createTestJwtSecret();
  const token = jwt.sign({ userId: 'user-123' }, secret);

  assert.equal(
    verifyUserToken(token, { JWT_SECRET: secret }).userId,
    'user-123'
  );
});

test('verifyUserToken rejects malformed or unsigned tokens', () => {
  const secret = createTestJwtSecret();

  assert.throws(
    () => verifyUserToken('not-a-token', { JWT_SECRET: secret }),
    /jwt malformed/
  );
});
