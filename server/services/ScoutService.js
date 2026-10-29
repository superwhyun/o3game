const { createHash } = require("node:crypto");
const mongoose = require("mongoose");
const User = require("../models/User");
const GameConfig = require("../models/GameConfig");
const Movement = require("../models/FleetMovement");
const Report = require("../models/ScoutReport");
const entities = require("./EntityConfigService");
const { atomic, requireTransactions } = require("./transactions");
const { settleUserState } = require("./GameStateService");
const { availableShips, sameId, plain } = require("../utils/formationRules");
const { calculateTravelSeconds } = require("../utils/fleetRules");
const {
  GALAXY_COUNT,
  SYSTEM_COUNT,
  POSITION_COUNT,
} = require("../utils/universe");
const { getJwtSecret } = require("../utils/authToken");
const rules = require("../utils/scoutRules");
function fail(message, statusCode = 400, code = "INVALID_SCOUT_ORDER") {
  throw Object.assign(new Error(message), { statusCode, code });
}
const coords = (p) => ({
  galaxy: p.galaxy,
  system: p.system,
  planet: p.planet,
});
const sameCoords = (a, b) =>
  ["galaxy", "system", "planet"].every((k) => a[k] === b[k]);
function cleanOrder(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("정찰 명령이 올바르지 않습니다.");
  if (
    Object.keys(input).some(
      (k) => !["requestId", "originPlanetId", "destination"].includes(k),
    )
  )
    fail("정찰은 정찰선 1척으로만 출격합니다.");
  if (
    typeof input.requestId !== "string" ||
    !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId)
  )
    fail("요청 ID가 올바르지 않습니다.");
  if (!mongoose.isValidObjectId(input.originPlanetId))
    fail("출발 행성을 다시 선택하십시오.");
  const d = input.destination;
  if (
    !d ||
    typeof d !== "object" ||
    Array.isArray(d) ||
    Object.keys(d).some((k) => !["galaxy", "system", "planet"].includes(k))
  )
    fail("목표 좌표가 올바르지 않습니다.");
  for (const [key, max] of [
    ["galaxy", GALAXY_COUNT],
    ["system", SYSTEM_COUNT],
    ["planet", POSITION_COUNT],
  ])
    if (!Number.isSafeInteger(d[key]) || d[key] < 1 || d[key] > max)
      fail("목표 좌표가 올바르지 않습니다.");
  return {
    requestId: input.requestId,
    originPlanetId: input.originPlanetId,
    destination: coords(d),
  };
}
async function launch(userId, input) {
  await requireTransactions();
  const order = cleanOrder(input);
  const hash = createHash("sha256")
    .update(JSON.stringify({ mission: "spy", ...order }))
    .digest("hex");
  const run = () =>
    atomic(async () => {
      const previous = await Movement.findOne({
        userId,
        requestId: order.requestId,
      });
      if (previous) {
        if (previous.requestHash !== hash)
          fail("같은 요청 ID의 내용이 다릅니다.", 409, "REQUEST_CONFLICT");
        return previous;
      }
      const { user } = await settleUserState(userId);
      const planet = user.planets[user.currentPlanet] || user.planets[0];
      if (!sameId(planet._id, order.originPlanetId))
        fail("출발 행성이 변경되었습니다.", 409, "ORIGIN_CHANGED");
      if (user.planets.some((p) => sameCoords(p, order.destination)))
        fail("자기 행성에는 정찰을 보낼 수 없습니다.");
      if ((availableShips(user, planet._id).espionageProbe || 0) < 1)
        fail(
          "출격 가능한 미배정 정찰선이 없습니다.",
          409,
          "INSUFFICIENT_PROBES",
        );
      const owners = await User.find({
        planets: { $elemMatch: order.destination },
      }).select("_id planets.galaxy planets.system planets.planet");
      if (
        owners.flatMap((u) =>
          u.planets.filter((p) => sameCoords(p, order.destination)),
        ).length > 1
      )
        fail("목표 좌표의 점령 정보가 충돌합니다.", 409, "TARGET_CONFLICT");
      const speed = entities.getEntity("ship", "espionageProbe")?.stats?.speed;
      if (!(speed > 0)) fail("정찰선 이동 성능을 확인할 수 없습니다.", 503);
      const config = await GameConfig.getConfig();
      const now = new Date();
      const seconds = calculateTravelSeconds(
        coords(planet),
        order.destination,
        speed,
        100,
        { serverSpeed: config.serverSpeed, flightSpeedMultiplier: config.fleetSettings?.flightSpeedMultiplier },
      );
      const movement = new Movement({
        userId: user._id,
        username: user.username,
        mission: "spy",
        formationNameAtLaunch: "정찰",
        originPlanetId: planet._id,
        origin: coords(planet),
        destination: order.destination,
        requestId: order.requestId,
        requestHash: hash,
        fleet: { espionageProbe: 1 },
        initialFleet: { espionageProbe: 1 },
        startTime: now,
        arrivalTime: new Date(+now + seconds * 1000),
        speed: 100,
        spyContext: {
          attackerEspionageLevel: rules.levelOf(user, planet),
          rulesVersion: rules.VERSION,
        },
      });
      planet.fleet.espionageProbe -= 1;
      user.markModified("planets");
      await user.save();
      await movement.save();
      return movement;
    });
  try {
    return await run();
  } catch (error) {
    if (error.code === 11000) return run();
    throw error;
  }
}
async function processMovement(id, now = new Date()) {
  await requireTransactions();
  return atomic(async () => {
    const movement = await Movement.findById(id);
    if (
      !movement ||
      movement.mission !== "spy" ||
      !["flying", "returning"].includes(movement.status)
    )
      return [];
    if (
      +(movement.status === "returning"
        ? movement.returnTime
        : movement.arrivalTime) > +now
    )
      return [];
    const { user: owner } = (await settleUserState(movement.userId, now)) || {};
    if (!owner) return [];
    const origin = owner.planets.find((p) =>
      movement.originPlanetId
        ? sameId(p._id, movement.originPlanetId)
        : sameCoords(p, movement.origin),
    );
    const fleet = plain(movement.fleet);
    if (
      Object.entries(fleet).some(
        ([id, n]) => id !== "espionageProbe" && n > 0,
      ) ||
      !Number.isSafeInteger(fleet.espionageProbe) ||
      fleet.espionageProbe < 1
    ) {
      movement.notice =
        "정찰 임무의 함선 구성을 확인할 수 없어 복구가 필요합니다.";
      await movement.save();
      return [];
    }
    if (movement.status === "returning") {
      if (!origin) {
        movement.notice = "출발 행성이 없어 복구가 필요합니다.";
        await movement.save();
        return [];
      }
      origin.fleet.espionageProbe =
        (origin.fleet.espionageProbe || 0) + fleet.espionageProbe;
      owner.markModified("planets");
      await owner.save();
      movement.status = "completed";
      await movement.save();
      return [String(owner._id)];
    }
    const matches = await User.find({
      planets: { $elemMatch: coords(movement.destination) },
    }).select("_id planets._id planets.galaxy planets.system planets.planet");
    const locations = matches.flatMap((u) =>
      u.planets
        .filter((p) => sameCoords(p, movement.destination))
        .map((p) => ({ userId: u._id, planetId: p._id })),
    );
    let target, planet;
    if (locations.length === 1) {
      target = sameId(locations[0].userId, owner._id)
        ? owner
        : (await settleUserState(locations[0].userId, now))?.user;
      planet = target?.planets.find((p) =>
        sameId(p._id, locations[0].planetId),
      );
    }
    const report = new Report({
      movementId: movement._id,
      ownerUserId: owner._id,
      attackerName: owner.username,
      originPlanetId: movement.originPlanetId,
      origin: coords(movement.origin),
      destination: coords(movement.destination),
      observedAt: now,
      initialProbeCount:
        movement.initialFleet?.espionageProbe || fleet.espionageProbe,
      survivorCount: fleet.espionageProbe,
      rulesVersion: rules.VERSION,
      outcome:
        locations.length > 1
          ? "unavailable"
          : planet
            ? sameId(target._id, owner._id)
              ? "friendly"
              : "occupied"
            : "empty",
    });
    if (planet) {
      report.targetPlanetId = planet._id;
      report.targetUserId = target._id;
      report.targetName = planet.name;
      report.targetCommander = target.isPirate ? '해적' : target.username;
      if(target.isPirate) report.pirateLevel = target.pirate.level;
    }
    if (report.outcome === "occupied") {
      const a =
        movement.spyContext?.attackerEspionageLevel ??
        rules.levelOf(owner, origin);
      const d = rules.levelOf(target, planet);
      report.informationTier = rules.tierOf(a, d);
      report.sections = rules.sectionsOf(planet, report.informationTier);
      report.detected =
        rules.detectionRoll(movement._id, getJwtSecret()) <
        rules.detectionChance(a, d);
      report.intercepted =
        report.detected &&
        rules.canIntercept(planet, (type, id) => {
          const entity = entities.getEntity(type, id);
          return entity
            ? { ...entity.stats, category: entity.display?.category }
            : null;
        });
      if (report.intercepted) report.survivorCount = 0;
    }
    if (["empty", "occupied", "friendly"].includes(report.outcome)) {
      const { environmentOf, surveyOf } = require("../utils/colonizationRules");
      const config = await GameConfig.getConfig();
      report.sections = { ...report.sections, environment: surveyOf(planet || environmentOf(movement.destination), owner.terraformingLevel || 0, config) };
    }
    await report.save();
    movement.scoutReportId = report._id;
    movement.targetUserId = report.targetUserId;
    movement.targetPlanetId = report.targetPlanetId;
    movement.notice = report.intercepted
      ? "정보 전송 후 정찰선이 격추되었습니다."
      : report.outcome === "empty"
        ? "미점령 행성 지형 관측 완료 · 귀환 중"
        : report.outcome === "unavailable"
          ? "관측 대상 확인 불가 · 귀환 중"
          : "정찰 정보 전송 완료 · 귀환 중";
    if (report.intercepted) {
      movement.fleet = {};
      movement.status = "completed";
    } else {
      movement.status = "returning";
      movement.returnStartTime = now;
      movement.returnTime = new Date(
        +now + (+movement.arrivalTime - +movement.startTime),
      );
    }
    await movement.save();
    await owner.save();
    return [
      ...new Set([
        String(owner._id),
        ...(report.detected ? [String(target._id)] : []),
      ]),
    ];
  });
}
module.exports = { launch, processMovement, cleanOrder };
