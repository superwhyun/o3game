const User = require("../models/User");
const Queue = require("../models/BuildingQueue");
const Movement = require("../models/FleetMovement");
const { atomic, requireTransactions } = require("./transactions");
const { settleUserState } = require("./GameStateService");
const { apiError } = require("../utils/apiErrors");
const sameId = (a, b) => String(a) === String(b);

async function abandon(userId, planetId, confirmationName) {
  if (
    typeof confirmationName !== "string" ||
    !confirmationName.trim() ||
    confirmationName.length > 30
  ) {
    throw apiError(
      400,
      "INVALID_REQUEST",
      "포기할 행성 이름을 입력해 주세요.",
      { field: "confirmationName" },
    );
  }
  await requireTransactions();
  return atomic(async () => {
    const settled = await settleUserState(userId);
    if (!settled)
      throw apiError(404, "NOT_FOUND", "사용자를 찾을 수 없습니다.");
    const { user } = settled;
    const index = user.planets.findIndex((p) => sameId(p._id, planetId));
    if (index < 0)
      throw apiError(404, "NOT_FOUND", "소유한 행성을 찾을 수 없습니다.");
    const planet = user.planets[index];
    if (planet.name !== confirmationName.trim())
      throw apiError(
        400,
        "PLANET_NAME_MISMATCH",
        "행성 이름이 일치하지 않습니다.",
      );
    if (user.planets.length <= 1)
      throw apiError(
        409,
        "LAST_PLANET",
        "마지막 행성은 포기할 수 없습니다. 다른 행성을 먼저 개척해 주세요.",
      );
    const queues = await Queue.find({ userId: user._id }).lean();
    const active = queues.filter(
      (q) => !q.applied && ["building", "pending"].includes(q.status),
    );
    if (active.some((q) => String(q.planetId) === String(index)))
      throw apiError(
        409,
        "PLANET_BUSY",
        "이 행성의 건설·연구·함선·방어시설 작업을 완료하거나 취소해 주세요.",
      );
    if (
      (planet.buildings.researchLab || 0) > 0 &&
      active.some((q) => q.type === "research")
    )
      throw apiError(
        409,
        "PLANET_BUSY",
        "공통 연구가 진행 중입니다. 연구를 완료하거나 취소한 뒤 연구소가 있는 행성을 포기해 주세요.",
      );
    const coordinates = {
      galaxy: planet.galaxy,
      system: planet.system,
      planet: planet.planet,
    };
    const origin = Object.fromEntries(
      Object.entries(coordinates).map(([k, v]) => [`origin.${k}`, v]),
    );
    const destination = Object.fromEntries(
      Object.entries(coordinates).map(([k, v]) => [`destination.${k}`, v]),
    );
    const movement = await Movement.exists({
      status: { $in: ["flying", "returning"] },
      $or: [
        { userId: user._id, originPlanetId: planet._id },
        { userId: user._id, ...origin },
        { status: "flying", ...destination },
      ],
    });
    if (
      movement ||
      user.fleetFormations.some(
        (f) => sameId(f.originPlanetId, planet._id) && f.status === "onMission",
      )
    ) {
      throw apiError(
        409,
        "PLANET_BUSY",
        "이 행성에서 출발한 함대의 귀환 또는 접근 중인 함대의 임무가 끝난 뒤 포기해 주세요.",
      );
    }
    const abandonedPlanet = {
      id: String(planet._id),
      name: planet.name,
      ...coordinates,
    };
    const currentId = user.planets[user.currentPlanet]?._id;
    user.fleetFormations = user.fleetFormations.filter(
      (f) => !sameId(f.originPlanetId, planet._id),
    );
    user.planets.splice(index, 1);
    const selected = user.planets.findIndex((p) => sameId(p._id, currentId));
    user.currentPlanet =
      selected >= 0 ? selected : Math.min(index, user.planets.length - 1);
    // Queues use numeric planet indexes. Remap every surviving record by ID,
    // and retain terminal records for the lost planet with an explicit tombstone.
    const updates = queues.flatMap((q) => {
      const oldIndex = Number(q.planetId);
      if (!Number.isSafeInteger(oldIndex) || oldIndex < index) return [];
      const next =
        oldIndex === index ? `abandoned:${planetId}` : String(oldIndex - 1);
      return [
        {
          updateOne: {
            filter: { _id: q._id, userId: user._id },
            update: { $set: { planetId: next } },
          },
        },
      ];
    });
    if (updates.length) await Queue.bulkWrite(updates);
    user.markModified("planets");
    await user.save();
    const pirate = await require('./PirateService').createFrom(planet);
    abandonedPlanet.pirateLevel = pirate.pirate.level;
    abandonedPlanet.piratePlanetId = String(pirate.planets[0]._id);
    const { snapshot } = await settleUserState(user._id);
    return { abandonedPlanet, snapshot };
  });
}
module.exports = { abandon };
