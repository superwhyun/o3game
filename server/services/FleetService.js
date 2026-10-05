const { createHash } = require("node:crypto");
const mongoose = require("mongoose");
const User = require("../models/User");
const FleetMovement = require("../models/FleetMovement");
const BattleReport = require("../models/BattleReport");
const entities = require("./EntityConfigService");
const Combat = require("./CombatService");
const { atomic, requireTransactions } = require("./transactions");
const { sameId, plain } = require("../utils/formationRules");
const { fail } = require("./FleetFormationService");
const { attackWaves, defenseWaves } = require("../utils/combatWaves");
const {
  assertFleetAvailable,
  assertNonEmptyFleet,
  assertCargoAvailable,
  normalizeCargo,
  calculateFleetProfile,
  calculateTravelSeconds,
} = require("../utils/fleetRules");
const {
  calculateSurvivors,
  calculateRaidLoot,
  mergeCargo,
} = require("../utils/attackRules");
const {
  GALAXY_COUNT,
  SYSTEM_COUNT,
  POSITION_COUNT,
} = require("../utils/universe");
function coords(planet) {
  return {
    galaxy: planet.galaxy,
    system: planet.system,
    planet: planet.planet,
  };
}
function sameCoords(a, b) {
  return ["galaxy", "system", "planet"].every((k) => a[k] === b[k]);
}
function cleanOrder(input) {
  if (!["attack", "transport", "colonize"].includes(input.mission))
    fail("지원하지 않는 임무입니다.", 400, "INVALID_MISSION");
  for (const key of ["formationId", "originPlanetId", ...(input.mission === "colonize" ? [] : ["expectedTargetPlanetId"])])
    if (!mongoose.isValidObjectId(input[key]))
      fail("함대와 목표를 다시 선택하십시오.", 400, "INVALID_ID");
  if (
    typeof input.requestId !== "string" ||
    !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId)
  )
    fail("출격 요청 ID가 올바르지 않습니다.", 400);
  if (!Number.isSafeInteger(input.expectedRevision))
    fail("편성 버전이 올바르지 않습니다.", 400);
  const destination = input.destination || {};
  for (const [key, max] of [
    ["galaxy", GALAXY_COUNT],
    ["system", SYSTEM_COUNT],
    ["planet", POSITION_COUNT],
  ]) {
    if (
      !Number.isSafeInteger(destination[key]) ||
      destination[key] < 1 ||
      destination[key] > max
    )
      fail("목표 좌표가 올바르지 않습니다.", 400);
  }
  return {
    formationId: input.formationId,
    originPlanetId: input.originPlanetId,
    expectedTargetPlanetId: input.mission === "colonize" ? null : input.expectedTargetPlanetId,
    expectedRevision: input.expectedRevision,
    requestId: input.requestId,
    mission: input.mission,
    destination: coords(destination),
    cargo: normalizeCargo(input.cargo),
    speed: input.speed ?? 100,
  };
}
async function launch(userId, input) {
  await requireTransactions();
  const order = cleanOrder(input);
  const hash = createHash("sha256").update(JSON.stringify(order)).digest("hex");
  const run = () =>
    atomic(async () => {
      const existing = await FleetMovement.findOne({
        userId,
        requestId: order.requestId,
      });
      if (existing) {
        if (existing.requestHash !== hash)
          fail("같은 요청 ID의 내용이 다릅니다.");
        return existing;
      }
      const user = await User.findById(userId);
      const formation = user?.fleetFormations.id(order.formationId);
      if (!formation) fail("함대를 찾을 수 없습니다.", 404);
      if (
        formation.status !== "ready" ||
        formation.revision !== order.expectedRevision
      )
        fail("함대 상태가 변경되었습니다. 다시 선택하십시오.");
      const planet = user.planets[user.currentPlanet] || user.planets[0];
      if (
        !sameId(planet._id, order.originPlanetId) ||
        !sameId(formation.originPlanetId, planet._id)
      )
        fail("출발 행성이 변경되었습니다.");
      const fleet = assertNonEmptyFleet(
        assertFleetAvailable(plain(formation.ships), plain(planet.fleet)),
      );
      const cargo = assertCargoAvailable(order.cargo, plain(planet.resources));
      const stats = Object.fromEntries(
        Object.keys(fleet).map((id) => [
          id,
          entities.getEntity("ship", id)?.stats,
        ]),
      );
      const profile = calculateFleetProfile(fleet, stats);
      if (
        Object.values(cargo).reduce((a, b) => a + b, 0) > profile.cargoCapacity
      )
        fail("적재량을 초과했습니다.", 400);
      const target = await User.findOne({
        planets: { $elemMatch: order.destination },
      });
      const targetPlanet = target?.planets.find((p) =>
        sameCoords(p, order.destination),
      );
      if (order.mission === "colonize") {
        if (!(fleet.colonyShip > 0)) fail("식민 임무에는 식민선이 필요합니다.", 400);
        if (targetPlanet) fail("이미 점령된 행성입니다.", 409, "TARGET_CHANGED");
      } else if (!targetPlanet) fail("목표 행성이 없습니다.", 409, "TARGET_CHANGED");
      if (order.mission !== "colonize" && !sameId(targetPlanet._id, order.expectedTargetPlanetId))
        fail(
          "목표 행성이 변경되었습니다. 다시 확인하십시오.",
          409,
          "TARGET_CHANGED",
        );
      if (
        sameCoords(planet, order.destination) ||
        (order.mission === "attack" && sameId(target._id, user._id))
      )
        fail("자기 행성에는 공격할 수 없습니다.", 400);
      const startedAt = new Date();
      const seconds = calculateTravelSeconds(
        coords(planet),
        order.destination,
        profile.slowestSpeed,
        order.speed,
      );
      const movement = new FleetMovement({
        userId: user._id,
        username: user.username,
        targetUserId: target?._id,
        formationId: formation._id,
        formationNameAtLaunch: formation.name,
        formationRevisionAtLaunch: formation.revision,
        originPlanetId: planet._id,
        targetPlanetId: targetPlanet?._id,
        requestId: order.requestId,
        requestHash: hash,
        mission: order.mission,
        fleet,
        initialFleet: fleet,
        deckVersion: 2,
        combatWaves: attackWaves(fleet),
        cargo,
        origin: coords(planet),
        destination: order.destination,
        startTime: startedAt,
        arrivalTime: new Date(+startedAt + seconds * 1000),
        speed: order.speed,
      });
      for (const [id, n] of Object.entries(fleet)) planet.fleet[id] -= n;
      for (const [id, n] of Object.entries(cargo)) planet.resources[id] -= n;
      formation.status = "onMission";
      formation.activeMovementId = movement._id;
      formation.revision++;
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
  const pending = await FleetMovement.findById(id).select("formationId mission").lean();
  if (pending?.mission === "spy") return require("./ScoutService").processMovement(id, now);
  if (pending?.formationId) await requireTransactions();
  const run = () => atomic(async () => {
    const movement = await FleetMovement.findById(id);
    if (!movement || !["flying", "returning"].includes(movement.status))
      return [];
    const dueTime =
      movement.status === "returning"
        ? movement.returnTime
        : movement.arrivalTime;
    if (+dueTime > +now) return [];
    const owner = (
      await require("./GameStateService").settleUserState(movement.userId, now)
    )?.user;
    if (!owner) return [];
    if (movement.status === "returning") {
      if (+movement.returnTime > +now) return [];
      const origin = owner.planets.find((p) =>
        movement.originPlanetId
          ? sameId(p._id, movement.originPlanetId)
          : sameCoords(p, movement.origin),
      );
      if (!origin) {
        if (!movement.notice) {
          movement.notice = "출발 행성이 없어 복구가 필요합니다.";
          await movement.save();
        }
        return [];
      }
      for (const [ship, n] of Object.entries(plain(movement.fleet)))
        origin.fleet[ship] = (origin.fleet[ship] || 0) + n;
      for (const [resource, n] of Object.entries(plain(movement.cargo)))
        origin.resources[resource] = (origin.resources[resource] || 0) + n;
      const formation = owner.fleetFormations.id(movement.formationId);
      if (formation && sameId(formation.activeMovementId, movement._id)) {
        formation.ships = Object.fromEntries(
          Object.entries(plain(movement.fleet)).filter(([, n]) => n > 0),
        );
        formation.status = "ready";
        formation.activeMovementId = null;
        formation.revision++;
        formation.notice = movement.mission === "colonize" && movement.notice.startsWith("식민지 개척 완료")
          ? Object.values(formation.ships).some((n) => n > 0)
            ? "식민지 개척 후 남은 함선이 귀환했습니다."
            : "식민선을 개척에 사용했습니다. 다시 편성하십시오."
          : Object.values(formation.ships).some((n) => n > 0)
            ? "생존 함선이 귀환했습니다."
            : "모든 함선을 잃었습니다. 다시 편성하십시오.";
      }
      owner.markModified("planets");
      await owner.save();
      movement.status = "completed";
      await movement.save();
      return [String(owner._id)];
    }
    if (+movement.arrivalTime > +now) return [];
    if (movement.mission === "colonize") {
      const occupied = await User.exists({ planets: { $elemMatch: coords(movement.destination) } });
      if (occupied) movement.notice = "다른 함대가 먼저 점령했습니다. 모든 함선이 귀환합니다.";
      else if (!(movement.fleet.colonyShip > 0)) movement.notice = "식민선이 없어 개척하지 못했습니다. 귀환합니다.";
      else {
        owner.planets.push({
          name: `Colony-${owner.planets.length + 1}`,
          ...coords(movement.destination),
          ...require("../utils/colonizationRules").environmentOf(movement.destination),
          resources: { ...plain(movement.cargo), energy: 0 },
          lastUpdate: now,
        });
        movement.fleet = { ...plain(movement.fleet), colonyShip: movement.fleet.colonyShip - 1 };
        movement.cargo = { metal: 0, crystal: 0, deuterium: 0 };
        movement.notice = "식민지 개척 완료 · 식민선 1척을 사용했습니다.";
      }
      movement.status = "returning";
      movement.returnTime = new Date(+now + (+movement.arrivalTime - +movement.startTime));
      owner.markModified("planets");
      await owner.save();
      await movement.save();
      return [String(owner._id)];
    }
    const target = sameId(owner._id, movement.targetUserId)
      ? owner
      : (
          await require("./GameStateService").settleUserState(
            movement.targetUserId,
            now,
          )
        )?.user;
    const planet = target?.planets.find(
      (p) =>
        sameCoords(p, movement.destination) &&
        (!movement.targetPlanetId || sameId(p._id, movement.targetPlanetId)),
    );
    const changed = [String(owner._id)];
    if (!planet) movement.notice = "목표 행성이 없어 귀환합니다.";
    else if (movement.mission === "transport") {
      for (const [resource, n] of Object.entries(plain(movement.cargo)))
        planet.resources[resource] = (planet.resources[resource] || 0) + n;
      movement.cargo = { metal: 0, crystal: 0, deuterium: 0 };
      target.markModified("planets");
      await target.save();
      changed.push(String(target._id));
    } else if (movement.mission === "attack") {
      const origin = owner.planets.find((p) => sameCoords(p, movement.origin));
      const result = await Combat.simulateBattle8Wave(
        movement.combatWaves ||
          attackWaves(plain(movement.fleet), movement.fleetDeck),
        defenseWaves(planet),
        { attacker: plain(origin?.research), defender: plain(planet.research) },
        null,
        String(movement._id),
      );
      const defenderInitial = {
        fleet: { ...plain(planet.fleet) },
        defense: { ...plain(planet.defense) },
      };
      const survivors = calculateSurvivors(
        plain(movement.fleet),
        result.attackerLosses || {},
      );
      const capacity = Object.entries(survivors).reduce(
        (n, [ship, count]) =>
          n + count * (entities.getEntity("ship", ship)?.stats?.cargo || 0),
        0,
      );
      const loot =
        result.winner === "attacker"
          ? calculateRaidLoot(
              Object.fromEntries(
                ["metal", "crystal", "deuterium"].map((r) => [
                  r,
                  Math.max(0, Math.floor(planet.resources[r] || 0)),
                ]),
              ),
              Math.max(
                0,
                capacity -
                  Object.values(plain(movement.cargo)).reduce(
                    (a, b) => a + b,
                    0,
                  ),
              ),
            )
          : { metal: 0, crystal: 0, deuterium: 0 };
      movement.fleet = survivors;
      movement.cargo = mergeCargo(plain(movement.cargo), loot);
      for (const [resource, n] of Object.entries(loot))
        planet.resources[resource] -= n;
      for (const [ship, n] of Object.entries(result.defenderLosses || {})) {
        if (planet.fleet[ship] !== undefined)
          planet.fleet[ship] = Math.max(0, planet.fleet[ship] - n);
        if (planet.defense[ship] !== undefined)
          planet.defense[ship] = Math.max(0, planet.defense[ship] - n);
      }
      const report = new BattleReport({
        movementId: movement._id,
        attacker: {
          userId: owner._id,
          username: owner.username,
          coordinates: movement.origin,
        },
        defender: {
          userId: target._id,
          username: target.username,
          coordinates: movement.destination,
        },
        attackerInitial: { fleet: plain(movement.initialFleet) },
        defenderInitial,
        rounds: result.rounds.map((r, i) => ({
          round: i + 1,
          attackerShips: Combat.countUnits(r.attackerForces),
          defenderShips: Combat.countUnits(r.defenderForces),
          attackerDamage: r.mainCombat?.attackerDamage || 0,
          defenderDamage: r.mainCombat?.defenderDamage || 0,
        })),
        result: { ...result, loot },
      });
      await report.save();
      movement.battleReport = report._id;
      target.markModified("planets");
      await target.save();
      changed.push(String(target._id));
    }
    movement.status = "returning";
    movement.returnTime = new Date(
      +now + (+movement.arrivalTime - +movement.startTime),
    );
    await movement.save();
    // Bump the owner's version so a delayed pre-combat snapshot cannot win.
    if (target !== owner) await owner.save();
    return [...new Set(changed)];
  });
  try { return await run(); }
  catch (error) {
    // A competing colony/home allocation can win the unique coordinate index.
    if (User.isCoordinateConflict(error)) return run();
    throw error;
  }
}
module.exports = { launch, processMovement };
