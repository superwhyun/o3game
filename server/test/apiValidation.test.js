const test = require("node:test");
const assert = require("node:assert/strict");
const { validate } = require("../middleware/apiValidation");
function request(path, body, method = "POST", query = {}) {
  return { path, body, method, query };
}
test("input guard rejects unsafe identities, nested operators and numeric coercion", () => {
  for (const username of [{ $ne: null }, ["user"], 100])
    assert.throws(
      () =>
        validate(
          "/api/auth",
          request("/login", { username, password: "password" }),
        ),
      { code: "INVALID_REQUEST" },
    );
  assert.throws(
    () =>
      validate("/api/game", request("/trade", { cargo: { $where: "unsafe" } })),
    { code: "INVALID_REQUEST" },
  );
  for (const amount of ["10", -1, 0, 1.5, Infinity])
    assert.throws(
      () =>
        validate(
          "/api/admin",
          request("/users/000000000000000000000001/resources", {
            resourceType: "metal",
            amount,
          }),
        ),
      { code: "INVALID_REQUEST" },
    );
  validate(
    "/api/admin",
    request("/users/000000000000000000000001/resources", {
      resourceType: "metal",
      amount: 10,
    }),
  );
});
test("query, fleet revision and bulk schema guards are explicit", () => {
  assert.throws(
    () => validate("/api/game", request("/galaxy", undefined, "GET", {})),
    { code: "INVALID_REQUEST" },
  );
  assert.throws(
    () =>
      validate(
        "/api/game",
        request(
          "/fleet-formations/000000000000000000000001",
          { expectedRevision: "1" },
          "DELETE",
        ),
      ),
    { code: "INVALID_REQUEST" },
  );
  assert.throws(
    () =>
      validate(
        "/api/admin",
        request("/entity-config/bulk", {
          updates: [{ entityType: "building" }],
        }),
      ),
    { code: "INVALID_REQUEST" },
  );
});
