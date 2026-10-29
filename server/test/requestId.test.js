const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('request ID uses native UUID when available', async () => {
  const { createRequestId } = await import('../../ogame-3d/src/utils/requestId.js');
  assert.equal(createRequestId({ randomUUID: () => 'native-request-id' }), 'native-request-id');
});

test('HTTP fallback produces distinct version 4 UUIDs accepted by fleet and scout routes', async () => {
  const { createRequestId } = await import('../../ogame-3d/src/utils/requestId.js');
  const cryptoProvider = { getRandomValues: bytes => webcrypto.getRandomValues(bytes) };
  const ids = Array.from({ length: 1000 }, () => createRequestId(cryptoProvider));
  assert.equal(new Set(ids).size, 1000);
  for (const id of ids) assert.match(id, pattern);
  assert.equal(createRequestId({ getRandomValues: bytes => bytes.fill(255) }), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
});

test('missing browser randomness gives an actionable error', async () => {
  const { createRequestId } = await import('../../ogame-3d/src/utils/requestId.js');
  assert.throws(() => createRequestId({}), /출격 요청 ID/);
});
