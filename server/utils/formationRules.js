const { ENTITY_IDS } = require("../data/catalog");
const { normalizeFleet } = require("./fleetRules");
const sameId = (a, b) => String(a) === String(b);
const plain = (value) => (value?.toObject ? value.toObject() : value || {});
function availableShips(user, planetId, excludingId) {
  const planet = user.planets.find((p) => sameId(p._id, planetId));
  if (!planet)
    throw Object.assign(new Error("출발 행성을 찾을 수 없습니다."), {
      statusCode: 404,
    });
  const available = { ...plain(planet.fleet) };
  for (const formation of user.fleetFormations || []) {
    if (
      formation.status !== "ready" ||
      !sameId(formation.originPlanetId, planetId) ||
      sameId(formation._id, excludingId)
    )
      continue;
    for (const [id, count] of Object.entries(plain(formation.ships)))
      available[id] = (available[id] || 0) - count;
  }
  return available;
}
function validateComposition(ships, available, statsOf) {
  let normalized;
  try {
    normalized = normalizeFleet(ships, ENTITY_IDS.ship);
  } catch (error) {
    throw Object.assign(error, {
      statusCode: 400,
      code: "INVALID_COMPOSITION",
    });
  }
  for (const [id, count] of Object.entries(normalized)) {
    if (!(statsOf(id)?.speed > 0))
      throw Object.assign(
        new Error("이동할 수 없는 함선은 배정할 수 없습니다."),
        { statusCode: 400, code: "INVALID_COMPOSITION" },
      );
    if (count > (available[id] || 0))
      throw Object.assign(
        new Error("다른 함대에 배정되었거나 보유 함선이 부족합니다."),
        { statusCode: 409, code: "INSUFFICIENT_SHIPS" },
      );
  }
  return normalized;
}
function reconcileFormations(user) {
  for (const planet of user.planets || []) {
    const remaining = { ...plain(planet.fleet) };
    const formations = (user.fleetFormations || [])
      .filter(
        (f) => f.status === "ready" && sameId(f.originPlanetId, planet._id),
      )
      .sort((a, b) => a.number - b.number);
    for (const formation of formations) {
      const ships = {};
      let changed = false;
      for (const [id, count] of Object.entries(plain(formation.ships))) {
        const kept = Math.min(count, Math.max(0, remaining[id] || 0));
        if (kept) ships[id] = kept;
        remaining[id] = (remaining[id] || 0) - kept;
        changed ||= kept !== count;
      }
      if (changed) {
        formation.ships = ships;
        formation.revision += 1;
        formation.notice = "주둔 함선 손실로 편성이 조정되었습니다.";
      }
    }
  }
}
function normalizeName(name) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 40)
    throw Object.assign(new Error("함대 이름은 1~40자로 입력하십시오."), {
      statusCode: 400,
      code: "INVALID_NAME",
    });
  return name.trim();
}
module.exports = {
  sameId,
  plain,
  availableShips,
  validateComposition,
  reconcileFormations,
  normalizeName,
};
