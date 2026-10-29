const { apiError } = require("../utils/apiErrors");
const id = (value) =>
  typeof value === "string" && /^[a-fA-F0-9]{24}$/.test(value);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
function invalid(field) {
  throw apiError(
    400,
    "INVALID_REQUEST",
    `${field} 입력 형식 또는 범위가 올바르지 않습니다.`,
    { field },
  );
}
function text(value, field, max = 2000, min = 1) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  )
    invalid(field);
}
function whole(value, field, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    invalid(field);
}
function safeTree(value, depth = 0) {
  if (depth > 20) invalid("body");
  if (Array.isArray(value)) {
    if (value.length > 1000) invalid("body");
    value.forEach((v) => safeTree(v, depth + 1));
  } else if (object(value))
    for (const [k, v] of Object.entries(value)) {
      if (
        k.startsWith("$") ||
        ["__proto__", "prototype", "constructor"].includes(k)
      )
        invalid(k);
      safeTree(v, depth + 1);
    }
}
function validate(prefix, req) {
  if (
    req.body === undefined &&
    ["POST", "PUT", "PATCH"].includes(req.method) &&
    prefix.includes("ai")
  )
    req.body = {};
  const p = prefix + (req.path === "/" ? "" : req.path),
    method = req.method,
    b = req.body;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && b !== undefined) {
    if (!object(b)) invalid("body");
    safeTree(b);
  }
  // ObjectId parameters on every database lookup, excluding catalog entity IDs.
  for (const match of p.matchAll(
    /\/(?:planets|reports|scout-reports|improvement-requests|users|fleet-formations|fleets|ai-models|ai-players)\/([^/]+)/g,
  )) {
    if (!["review", "read"].includes(match[1]) && !id(match[1]))
      throw apiError(400, "INVALID_ID", "유효한 대상 ID를 보내 주세요.");
  }
  if (
    /^\/api\/queue\/(?:check\/)?[^/]+$/.test(p) &&
    !["build", "demolish", "research", "ship", "planet", "speedup"].includes(
      p.split("/").at(-1),
    ) &&
    !id(p.split("/").at(-1))
  )
    throw apiError(400, "INVALID_ID", "유효한 작업 ID를 보내 주세요.");
  if (method === "GET" && p.includes("/fleet-requests/"))
    text(p.split("/").at(-1), "requestId", 80, 16);
  if (p.startsWith("/api/admin/users") && method === "PUT" && !object(b))
    invalid("body");
  if (
    method === "GET" &&
    ["/api/game/galaxy", "/api/game/galaxy/traffic"].includes(p)
  ) {
    if (req.query.galaxy === undefined) invalid("galaxy");
    if (req.query.system === undefined) invalid("system");
  }
  if (req.query.before !== undefined && !id(req.query.before))
    invalid("before");
  for (const k of ["galaxy", "system", "planet", "limit", "page"])
    if (req.query[k] !== undefined) {
      const v = req.query[k];
      if (typeof v !== "string" || !/^\d+$/.test(v)) invalid(k);
      whole(
        Number(v),
        k,
        1,
        k === "galaxy"
          ? 9
          : k === "system"
            ? 499
            : k === "planet"
              ? 15
              : k === "limit"
                ? p.includes("/scout-")
                  ? 50
                  : 100
                : 1000000,
      );
    }
  for (const k of ["cursor", "route", "type"])
    if (req.query[k] !== undefined)
      text(req.query[k], k, k === "cursor" ? 1024 : k === "route" ? 1024 : 100);
  if (
    /^\/api\/auth\/(login|register|setup-admin)$/.test(p) &&
    method === "POST"
  ) {
    if (!object(b)) invalid("body");
    text(b.username, "username", 100);
    text(b.password, "password", 128, p.endsWith("/login") ? 1 : 6);
    if (!p.endsWith("/login") && Buffer.byteLength(b.password, "utf8") > 72)
      invalid("password");
    if (!p.endsWith("/login")) {
      text(b.email, "email", 254);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) invalid("email");
    }
  }
  if (
    [
      "/api/game/trade",
      "/api/game/fleet-formations",
      "/api/game/fleets",
      "/api/game/scouts",
      "/api/game/improvement-requests",
    ].includes(p) &&
    ["POST", "PATCH"].includes(method) &&
    !object(b)
  )
    invalid("body");
  if (
    method === "PATCH" &&
    (/\/name$/.test(p) ||
      /\/review$/.test(p) ||
      /\/fleet-formations\//.test(p)) &&
    !object(b)
  )
    invalid("body");
  if (
    p.startsWith("/api/queue") &&
    method === "POST" &&
    !p.includes("/check/")
  ) {
    if (!object(b)) invalid("body");
    if (
      b.planetId !== undefined &&
      (typeof b.planetId !== "string" || !/^\d+$/.test(b.planetId))
    )
      throw apiError(
        400,
        "INVALID_PLANET",
        "행성 인덱스 문자열을 보내 주세요.",
      );
    if (p.endsWith("/planet") && b.planetId === undefined) invalid("planetId");
    for (const k of ["buildingId", "researchId", "shipId"])
      if (b[k] !== undefined) text(b[k], k, 100);
    if (b.count !== undefined) whole(b.count, "count", 1, 9999);
    if (
      b.entityType !== undefined &&
      !["ship", "defense"].includes(b.entityType)
    )
      invalid("entityType");
  }
  if (p === "/api/game/fleets" && method === "POST" && object(b)) {
    if (
      b.speed !== undefined &&
      (!Number.isSafeInteger(b.speed) ||
        b.speed < 10 ||
        b.speed > 100 ||
        b.speed % 10 !== 0)
    )
      invalid("speed");
  }
  if (
    p.startsWith("/api/game/fleet-formations") &&
    ["POST", "PATCH", "DELETE"].includes(method)
  ) {
    if (!object(b)) invalid("body");
    if (method === "POST") {
      if (!id(b.originPlanetId)) invalid("originPlanetId");
    } else {
      whole(b.expectedRevision, "expectedRevision");
      if (method === "PATCH") {
        text(b.name, "name", 40);
        if (!object(b.ships)) invalid("ships");
      }
    }
  }
  if (p === "/api/admin/users" && req.query.search !== undefined)
    text(req.query.search, "search", 100, 0);
  if (p === "/api/admin/speed" && method === "POST")
    if (
      !object(b) ||
      typeof b.speed !== "number" ||
      !Number.isFinite(b.speed) ||
      b.speed < 0.5 ||
      b.speed > 100
    )
      invalid("speed");
  if (p === "/api/admin/maintenance" && method === "POST") {
    if (!object(b) || typeof b.enabled !== "boolean") invalid("enabled");
    if (b.message !== undefined) text(b.message, "message", 2000, 0);
  }
  if (p === "/api/admin/announcement" && method === "POST") {
    if (!object(b)) invalid("body");
    text(b.message, "message");
    if (
      b.type !== undefined &&
      !["info", "warning", "error", "success"].includes(b.type)
    )
      invalid("type");
  }
  if (/^\/api\/admin\/users\/[^/]+\/resources$/.test(p) && method === "POST") {
    if (!object(b)) invalid("body");
    whole(b.amount, "amount", 1);
    if (b.planetIndex !== undefined) whole(b.planetIndex, "planetIndex");
  }
  if (p === "/api/admin/config" && method === "PUT") {
    if (!object(b)) invalid("body");
    for (const [k, v] of Object.entries(b)) {
      if (["serverName", "maintenanceMessage"].includes(k)) text(v, k, 2000, 0);
      else if (k === "maintenanceMode") {
        if (typeof v !== "boolean") invalid(k);
      } else if (k === "serverSpeed") {
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0.5 || v > 100)
          invalid(k);
      } else if (!object(v)) invalid(k);
    }
    function numbers(v) {
      for (const [k, n] of Object.entries(v)) {
        if (object(n)) numbers(n);
        else if (typeof n === "number" && (!Number.isFinite(n) || n < 0))
          invalid(k);
      }
    }
    numbers(b);
    const model = require("../models/GameConfig");
    function modelTypes(v, prefix = "") {
      for (const [k, n] of Object.entries(v)) {
        const key = prefix + k,
          field = model.schema.path(key);
        if (object(n)) modelTypes(n, key + ".");
        else if (
          field?.instance === "Number" &&
          (typeof n !== "number" ||
            !Number.isFinite(n) ||
            Math.abs(n) > Number.MAX_SAFE_INTEGER)
        )
          invalid(key);
        else if (field?.instance === "Boolean" && typeof n !== "boolean")
          invalid(key);
      }
    }
    modelTypes(b);
    if (b.areaSettings?.bonusUsableFields !== undefined)
      whole(b.areaSettings.bonusUsableFields, "bonusUsableFields");
  }
  if (
    p.startsWith("/api/admin/entity-config") &&
    ["POST", "PUT"].includes(method) &&
    !p.includes("/reset/")
  ) {
    if (!object(b)) invalid("body");
    const entityId = (value) => {
      if (typeof value !== "string" || !/^[a-z][a-zA-Z0-9]{0,99}$/.test(value))
        invalid("entityId");
    };
    if (!p.endsWith("/bulk") && p.split("/").length === 6)
      entityId(p.split("/").at(-1));
    if (b.entityId !== undefined) entityId(b.entityId);
    const numericTree = (v, k) => {
      if (!object(v) && !Array.isArray(v)) invalid(k);
      for (const [key, n] of Object.entries(v)) {
        if (
          n === null &&
          ["costMultiplier", "timeMultiplier", "baseTime"].includes(key)
        )
          continue;
        if (object(n) || Array.isArray(n)) numericTree(n, key);
        else if (key === "scalingMode") {
          if (!["exponential", "linear", "constant"].includes(n)) invalid(key);
        } else if (
          typeof n !== "number" ||
          !Number.isFinite(n) ||
          Math.abs(n) > Number.MAX_SAFE_INTEGER ||
          n < 0
        )
          invalid(key);
      }
    };
    const validatePatch = (patch) => {
      if (!object(patch)) invalid("update");
      for (const k of [
        "baseCost",
        "costModel",
        "timeModel",
        "display",
        "requirements",
        "effects",
        "stats",
        "metadata",
      ])
        if (patch[k] !== undefined && !object(patch[k])) invalid(k);
      for (const k of ["buildTime", "costMultiplier", "timeMultiplier"])
        if (
          patch[k] !== undefined &&
          (typeof patch[k] !== "number" ||
            !Number.isFinite(patch[k]) ||
            patch[k] < 0)
        )
          invalid(k);
      for (const k of [
        "baseCost",
        "costModel",
        "timeModel",
        "requirements",
        "stats",
      ])
        if (patch[k] !== undefined) numericTree(patch[k], k);
      if (patch.entityId !== undefined) entityId(patch.entityId);
      if (
        patch.entityType !== undefined &&
        !["building", "research", "ship", "defense"].includes(patch.entityType)
      )
        invalid("entityType");
      if (
        patch.status !== undefined &&
        !["active", "draft", "disabled"].includes(patch.status)
      )
        invalid("status");
    };
    if (p.endsWith("/bulk")) {
      if (
        !Array.isArray(b.updates) ||
        !b.updates.length ||
        b.updates.length > 1000
      )
        invalid("updates");
      b.updates.forEach((patch) => {
        validatePatch(patch);
        entityId(patch.entityId);
        if (
          !["building", "research", "ship", "defense"].includes(
            patch.entityType,
          )
        )
          invalid("entityType");
      });
    } else validatePatch(b);
  }
}
function apiValidation(prefix) {
  return (req, res, next) => {
    try {
      validate(prefix, req);
      next();
    } catch (error) {
      next(error);
    }
  };
}
module.exports = { apiValidation, validate, id, text, whole };
