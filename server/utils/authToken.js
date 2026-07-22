const jwt = require('jsonwebtoken');

const LEGACY_DEFAULT_SECRETS = new Set([
  'your-secret-key',
  'your-super-secret-jwt-key-change-in-production'
]);

function getJwtSecret(environment = process.env) {
  const secret = environment.JWT_SECRET;

  if (typeof secret !== 'string' || secret.trim().length < 32 || LEGACY_DEFAULT_SECRETS.has(secret)) {
    throw new Error('JWT_SECRET must be configured with a non-default value of at least 32 characters');
  }

  return secret;
}

function verifyUserToken(token, environment = process.env) {
  return jwt.verify(token, getJwtSecret(environment));
}

module.exports = {
  getJwtSecret,
  verifyUserToken
};
