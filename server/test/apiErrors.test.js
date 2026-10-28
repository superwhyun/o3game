const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeError, apiError } = require("../utils/apiErrors");
test("internal errors never expose raw messages or DB codes", () => {
  for (const error of [
    new Error("secret internal value"),
    new RangeError("secret internal range"),
    Object.assign(new Error("database secret"), { code: 999 }),
    Object.assign(new Error("query leak"), { code: 11000 }),
    Object.assign(new Error("db topology"), { code: 20, statusCode: 503 }),
  ]) {
    const result = normalizeError(error);
    assert.equal(typeof result.code, "string");
    assert.ok(!result.message.includes("secret"));
    assert.ok(!result.message.includes("query leak"));
    assert.ok(!result.message.includes("db topology"));
  }
  assert.equal(
    normalizeError(
      Object.assign(new Error("network"), { name: "MongoNetworkError" }),
    ).status,
    503,
  );
  assert.equal(
    normalizeError(
      Object.assign(new Error("body content"), {
        type: "entity.parse.failed",
        status: 400,
      }),
    ).code,
    "INVALID_JSON",
  );
});
test("business errors preserve safe machine codes and structured details", () => {
  const result = normalizeError(
    apiError(400, "INSUFFICIENT_AREA", "공간 부족", {
      required: 1,
      available: 0,
    }),
  );
  assert.equal(result.code, "INSUFFICIENT_AREA");
  assert.equal(result.status, 400);
  assert.equal(result.details.available, 0);
  assert.equal(
    normalizeError(
      Object.assign(new Error("expired"), { name: "TokenExpiredError" }),
    ).code,
    "AUTH_TOKEN_EXPIRED",
  );
});
