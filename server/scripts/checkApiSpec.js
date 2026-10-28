// Dependency-free route coverage and basic OpenAPI consistency check.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const spec = JSON.parse(
  fs.readFileSync(path.join(root, "docs/api/openapi.json"), "utf8"),
);
const expected = new Set();
const mounts = {
  aiAdmin: "/api/admin",
  aiWorker: "/api/ai-worker",
  auth: "/api/auth",
  account: "/api/account",
  admin: "/api/admin",
  buildingQueue: "/api/queue",
  game: "/api/game",
  scouts: "/api/game",
  battleReports: "/api/game",
  improvementRequests: "/api/game/improvement-requests",
};
for (const [file, prefix] of Object.entries(mounts)) {
  const source = fs.readFileSync(
    path.join(root, `server/routes/${file}.js`),
    "utf8",
  );
  for (const match of source.matchAll(
    /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g,
  )) {
    const route = (prefix + (match[2] === "/" ? "" : match[2])).replace(
      /:([A-Za-z]+)/g,
      "{$1}",
    );
    expected.add(`${match[1]} ${route}`);
  }
  // Current dynamic formation CRUD registration. Fail closed if its template changes.
  if (file === "game") {
    for (const match of source.matchAll(
      /\['(post|patch|delete)','(\/fleet-formations[^']*)','(?:create|update|delete)'\]/g,
    )) {
      expected.add(
        `${match[1]} ${(prefix + match[2]).replace(/:([A-Za-z]+)/g, "{$1}")}`,
      );
    }
  }
}
expected.add("get /health");
expected.add("get /ready");
const actual = new Set();
const ids = new Set();
for (const [route, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
    actual.add(`${method} ${route}`);
    if (ids.has(operation.operationId))
      throw Error("Duplicate operationId: " + operation.operationId);
    ids.add(operation.operationId);
    if (!operation.responses) throw Error("Missing responses: " + route);
    for (const match of route.matchAll(/\{([^}]+)\}/g)) {
      if (
        !operation.parameters?.some(
          (p) => p.in === "path" && p.name === match[1] && p.required,
        )
      )
        throw Error("Missing path parameter: " + route);
    }
  }
}
const runtime = require("../data/apiRoutes.json");
const declared = new Set(
  runtime.flatMap((row) =>
    row.methods.map((method) => method.toLowerCase() + " " + row.path),
  ),
);
if ([...actual].some((x) => !declared.has(x)) || declared.size !== actual.size)
  throw Error("Runtime method registry differs from OpenAPI");
const missing = [...expected].filter((x) => !actual.has(x));
const extra = [...actual].filter((x) => !expected.has(x));
if (missing.length || extra.length)
  throw Error(JSON.stringify({ missing, extra }));
function walk(value) {
  if (!value || typeof value !== "object") return;
  if (value.$ref?.startsWith("#/")) {
    let target = spec;
    for (const part of value.$ref.slice(2).split("/")) target = target?.[part];
    if (!target) throw Error("Unresolved ref: " + value.$ref);
  }
  Object.values(value).forEach(walk);
}
walk(spec);
console.log(
  `API specification: ${actual.size} operations match server routes; references and IDs checked.`,
);
