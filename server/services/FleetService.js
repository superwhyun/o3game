const { createHash } = require("node:crypto");
const mongoose = require("mongoose");
const User = require("../models/User");
const FleetMovement = require("../models/FleetMovement");
const BattleReport = require("../models/BattleReport");
const GameConfig = require("../models/GameConfig");
const entities = require("./EntityConfigService");
const Combat = require("./CombatService");
const { atomic, requireTransactions } = require("./transactions");
const { sameId, plain, availableShips } = require("../utils/formationRules");
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
  if (!["attack", "transport", "deploy", "colonize"].includes(input.mission))
    fail("지원하지 않는 임무입니다.", 400, "INVALID_MISSION");
  const direct = input.mission === "colonize" && input.formationId == null;
  for (const key of [...(direct ? [] : ["formationId"]), "originPlanetId", ...(input.mission === "colonize" ? [] : ["expectedTargetPlanetId"])])
    if (!mongoose.isValidObjectId(input[key]))
      fail("함대와 목표를 다시 선택하십시오.", 400, "INVALID_ID");
  if (
    typeof input.requestId !== "string" ||
    !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId)
  )
    fail("출격 요청 ID가 올바르지 않습니다.", 400);
  if (!direct && !Number.isSafeInteger(input.expectedRevision))
    fail("편성 버전이 올바르지 않습니다.", 400);
  const destination = input.destination || {};
  const colonists = input.mission === 'colonize' ? (input.colonists ?? 10) : 0;
  if (!Number.isSafeInteger(colonists) || colonists < (input.mission === 'colonize' ? 1 : 0)
      || (input.mission !== 'colonize' && input.colonists != null && input.colonists !== 0))
    fail('개척 인구는 1명 이상의 정수여야 합니다. 인구는 개척 임무에만 탑승할 수 있습니다.', 400, 'INVALID_COLONISTS');
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
    formationId: direct ? null : input.formationId,
    originPlanetId: input.originPlanetId,
    expectedTargetPlanetId: input.mission === "colonize" ? null : input.expectedTargetPlanetId,
    expectedRevision: direct ? null : input.expectedRevision,
    requestId: input.requestId,
    mission: input.mission,
    destination: coords(destination),
    cargo: (() => { try { return normalizeCargo(input.cargo); } catch(error) { throw require('../utils/apiErrors').apiError(400, 'INVALID_CARGO', error.message); } })(),
    colonists,
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
        const legacyOrder = { ...order };
        delete legacyOrder.colonists;
        const legacyMatch = existing.colonistsAtLaunch == null && input.colonists == null
          && existing.requestHash === createHash('sha256').update(JSON.stringify(legacyOrder)).digest('hex');
        if (existing.requestHash !== hash && !legacyMatch)
          fail("같은 요청 ID의 내용이 다릅니다.");
        return existing;
      }
      const user = (await require('./GameStateService').settleUserState(userId))?.user;
      if (!user) fail("사용자를 찾을 수 없습니다.", 404);
      const formation = user?.fleetFormations.id(order.formationId);
      if (order.formationId && !formation) fail("함대를 찾을 수 없습니다.", 404);
      if (
        formation && (formation.status !== "ready" ||
        formation.revision !== order.expectedRevision)
      )
        fail("함대 상태가 변경되었습니다. 다시 선택하십시오.");
      const planet = user.planets.find(p => sameId(p._id, order.originPlanetId));
      if (
        !planet ||
        (formation && !sameId(formation.originPlanetId, planet._id))
      )
        fail("출발 행성이 변경되었습니다.");
      if (!formation && (availableShips(user, planet._id).colonyShip || 0) < 1)
        fail("미배정 식민선이 없습니다. 편성된 식민선은 함대운용에서 보내십시오.", 409, "INSUFFICIENT_SHIPS");
      let fleet, cargo;
      try { fleet = assertNonEmptyFleet(assertFleetAvailable(formation ? plain(formation.ships) : { colonyShip: 1 }, plain(planet.fleet))); }
      catch(error) { throw require('../utils/apiErrors').apiError(409, 'INSUFFICIENT_SHIPS', '출격 가능한 함선이 부족하거나 편성이 변경되었습니다.'); }
      try { cargo = assertCargoAvailable(order.cargo, plain(planet.resources)); }
      catch(error) { throw require('../utils/apiErrors').apiError(400, 'INSUFFICIENT_RESOURCES', '적재할 자원이 부족합니다.'); }
      if (formation) {
        const rules = require('../utils/fleetCrew');
        if ((formation.crew || 0) < rules.requiredCrew(fleet))
          fail('승무원이 부족합니다. 함대 편성에서 충원하십시오.', 409, 'INSUFFICIENT_POPULATION');
        const supplyConfig = await GameConfig.getConfig();
        const production = require('../utils/planetEconomy').calculateProduction(planet, supplyConfig.serverSpeed || 1, supplyConfig.resourceSettings || {}, supplyConfig);
        const costs = planet.$locals?.fleetSupport?.hourly || {};
        // Relocation remains possible during starvation; upkeep continues until arrival.
        const supplyKeys = order.mission === 'deploy' ? ['metal', 'deuterium'] : ['food', 'metal', 'deuterium'];
        if (supplyKeys.some(key => costs[key] > 0 && (planet.resources[key] || 0) <= 1e-9 && (production[key] || 0) <= 0))
          fail('함대 유지에 필요한 보급이 부족합니다. 식량·금속·중수소를 확보하십시오.', 409, 'FLEET_SUPPLY_SHORTAGE');
      }
      const stats = Object.fromEntries(
        Object.keys(fleet).map((id) => [
          id,
          entities.getEntity("ship", id)?.stats,
        ]),
      );
      const profile = calculateFleetProfile(fleet, stats);
      if (
        Object.values(cargo).reduce((a, b) => a + b, 0) + order.colonists > profile.cargoCapacity
      )
        fail("적재량을 초과했습니다.", 400);
      const target = await User.findOne({
        planets: { $elemMatch: order.destination },
      });
      if(target?.isPirate && order.mission === 'transport') fail('해적 행성에는 자원을 수송할 수 없습니다.',409,'PIRATE_TRANSPORT_FORBIDDEN');
      const targetPlanet = target?.planets.find((p) =>
        sameCoords(p, order.destination),
      );
      if (order.mission === "colonize") {
        if (!(fleet.colonyShip > 0)) fail("식민 임무에는 식민선이 필요합니다.", 400);
        if (targetPlanet) fail("이미 점령된 행성입니다.", 409, "TARGET_CHANGED");
        if (order.colonists > Math.floor(planet.population?.count || 0))
          fail('출발 행성의 인구가 부족합니다.', 400, 'INSUFFICIENT_POPULATION');
      } else if (!targetPlanet) fail("목표 행성이 없습니다.", 409, "TARGET_CHANGED");
      if (order.mission !== "colonize" && !sameId(targetPlanet._id, order.expectedTargetPlanetId))
        fail(
          "목표 행성이 변경되었습니다. 다시 확인하십시오.",
          409,
          "TARGET_CHANGED",
        );
      if (['deploy', 'transport'].includes(order.mission) && !sameId(target._id, user._id))
        fail(order.mission === 'deploy' ? '함대는 내 행성으로만 이동할 수 있습니다.' : '자원은 내 행성으로만 수송할 수 있습니다.', 409,
          order.mission === 'deploy' ? 'DEPLOY_TARGET_NOT_OWNED' : 'TRANSPORT_TARGET_NOT_OWNED');
      if (
        sameCoords(planet, order.destination) ||
        (order.mission === "attack" && sameId(target._id, user._id))
      )
        fail("자기 행성에는 공격할 수 없습니다.", 400);
      const config = await GameConfig.getConfig();
      const startedAt = new Date();
      const seconds = calculateTravelSeconds(
        coords(planet),
        order.destination,
        profile.slowestSpeed,
        order.speed,
        { serverSpeed: config.serverSpeed, flightSpeedMultiplier: config.fleetSettings?.flightSpeedMultiplier },
      );
      const movement = new FleetMovement({
        userId: user._id,
        username: user.username,
        targetUserId: target?._id,
        formationId: formation?._id || null,
        formationNameAtLaunch: formation?.name || "식민선",
        formationRevisionAtLaunch: formation?.revision,
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
        colonists: order.colonists,
        colonistsAtLaunch: order.colonists,
        origin: coords(planet),
        destination: order.destination,
        startTime: startedAt,
        arrivalTime: new Date(+startedAt + seconds * 1000),
        speed: order.speed,
      });
      for (const [id, n] of Object.entries(fleet)) planet.fleet[id] -= n;
      for (const [id, n] of Object.entries(cargo)) planet.resources[id] -= n;
      if (order.colonists) planet.population.count -= order.colonists;
      if (formation) {
        formation.status = "onMission";
        formation.activeMovementId = movement._id;
        formation.revision++;
      }
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
async function settleColony(owner, movement, colony) {
  const ships = Object.fromEntries(Object.entries(plain(movement.fleet)).filter(([,n]) => n > 0));
  for (const [id, n] of Object.entries(ships)) colony.fleet[id] = (colony.fleet[id] || 0) + n;
  for (const [id, n] of Object.entries(plain(movement.cargo))) colony.resources[id] = (colony.resources[id] || 0) + n;
  const colonists = movement.colonists || 0;
  if (colonists) colony.population.count += colonists;
  movement.colonists = movement.colonists == null ? null : 0;
  movement.cargo = { metal: 0, crystal: 0, deuterium: 0 };
  movement.targetPlanetId = colony._id;
  movement.targetUserId = owner._id;
  movement.status = "completed";
  movement.returnStartTime = null;
  movement.returnTime = null;
  movement.notice = `식민지 개척 완료 · ${colonists ? `인구 ${colonists}명과 ` : ''}함대가 새 식민지에 정착했습니다.`;
  const formation = owner.fleetFormations.id(movement.formationId);
  if (formation && sameId(formation.activeMovementId, movement._id)) {
    formation.originPlanetId = colony._id;
    // A colony vessel is consumed for settlement; its crew become residents.
    colony.population.count += require('../utils/fleetCrew').applyCrewLoss(formation, ships);
    formation.status = "ready";
    formation.activeMovementId = null;
    formation.revision++;
    formation.notice = Object.keys(ships).length
      ? "새 식민지에 정착했습니다. 이 행성에서 출격할 수 있습니다."
      : "식민선을 개척에 사용했습니다. 새 식민지에서 다시 편성하십시오.";
  }
  owner.markModified("planets");
  await owner.save();
  await movement.save();
  return [String(owner._id)];
}
async function processMovement(id, now = new Date()) {
  const pending = await FleetMovement.findById(id).select("formationId mission").lean();
  if (pending?.mission === "spy") return require("./ScoutService").processMovement(id, now);
  if (pending?.formationId || pending?.mission === "colonize") await requireTransactions();
  const run = () => atomic(async () => {
    const movement = await FleetMovement.findById(id);
    if (!movement || !["flying", "returning"].includes(movement.status))
      return [];
    const dueTime =
      movement.status === "returning"
        ? movement.returnTime
        : movement.arrivalTime;
    const legacySettlement = movement.mission === "colonize" && movement.status === "returning" && movement.notice.startsWith("식민지 개척 완료");
    if (+dueTime > +now && !legacySettlement) return [];
    const owner = (
      await require("./GameStateService").settleUserState(movement.userId, now)
    )?.user;
    if (!owner) return [];
    if (legacySettlement) {
      const colony = owner.planets.find(p => sameCoords(p, movement.destination));
      if (colony) return settleColony(owner, movement, colony);
    }
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
      if (movement.colonists) origin.population.count += movement.colonists;
      movement.colonists = movement.colonists == null ? null : 0;
      const formation = owner.fleetFormations.id(movement.formationId);
      if (formation && sameId(formation.activeMovementId, movement._id)) {
        require('../utils/fleetCrew').applyCrewLoss(formation, Object.fromEntries(
          Object.entries(plain(movement.fleet)).filter(([, n]) => n > 0),
        ));
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
        require('../utils/populationEconomy').initializePopulation(owner.planets[owner.planets.length - 1], await require('../models/GameConfig').getConfig());
        // New missions transfer boarded people; old missions retain their original initial population.
        if (movement.colonists != null) owner.planets[owner.planets.length - 1].population.count = 0;
        movement.fleet = { ...plain(movement.fleet), colonyShip: movement.fleet.colonyShip - 1 };
        // Resources were placed on the new planet above; settlement only adds ships.
        movement.cargo = { metal: 0, crystal: 0, deuterium: 0 };
        return settleColony(owner, movement, owner.planets[owner.planets.length - 1]);
      }
      movement.status = "returning";
      movement.returnStartTime = now;
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
    else if (movement.mission === 'deploy') {
      const formation = owner.fleetFormations.id(movement.formationId);
      if (!sameId(target._id, owner._id) || !formation || !sameId(formation.activeMovementId, movement._id)) {
        movement.notice = '이동할 내 행성 또는 함대 상태가 변경되어 귀환합니다.';
      } else {
        for (const [ship, count] of Object.entries(plain(movement.fleet)))
          planet.fleet[ship] = (planet.fleet[ship] || 0) + count;
        for (const [resource, count] of Object.entries(plain(movement.cargo)))
          planet.resources[resource] = (planet.resources[resource] || 0) + count;
        formation.originPlanetId = planet._id;
        formation.ships = plain(movement.fleet);
        formation.status = 'ready';
        formation.activeMovementId = null;
        formation.revision++;
        formation.notice = `${planet.name}에 배치되었습니다. 이 행성에서 출격할 수 있습니다.`;
        movement.cargo = { metal: 0, crystal: 0, deuterium: 0 };
        movement.status = 'completed';
        movement.returnStartTime = null;
        movement.returnTime = null;
        movement.notice = `함대 이동 완료 · ${planet.name}에 함선·승무원과 자원을 배치했습니다.`;
        owner.markModified('planets');
        owner.markModified('fleetFormations');
        await owner.save();
        await movement.save();
        return changed;
      }
    }
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
        { attacker: plain(owner.research), defender: plain(target.research) },
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
      const attackerFormation = owner.fleetFormations.id(movement.formationId);
      const attackerCrewLosses = attackerFormation ? require('../utils/fleetCrew').applyCrewLoss(attackerFormation, survivors) : 0;
      const defenderCrewBefore = (target.fleetFormations || []).reduce((n, f) => n + (f.crew || 0), 0);
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
      require('../utils/formationRules').reconcileFormations(target);
      const defenderCrewLosses = defenderCrewBefore - (target.fleetFormations || []).reduce((n, f) => n + (f.crew || 0), 0);
      const report = new BattleReport({
        movementId: movement._id,
        battleTime: now,
        formationName: movement.formationNameAtLaunch,
        fuelConsumed: { deuterium: 0 },
        fuelPolicy: 'notCharged',
        attacker: {
          userId: owner._id,
          username: owner.username,
          coordinates: movement.origin,
        },
        defender: {
          userId: target._id,
          username: target.isPirate ? "해적" : target.username,
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
        result: { ...result, loot, attackerCrewLosses, defenderCrewLosses, ...(target.isPirate ? {pirateLevel:target.pirate.level,pirateCleared: result.winner === 'attacker' && require('../utils/pirateRules').cleared(planet)} : {}) },
      });
      await report.save();
      movement.battleReport = report._id;
      movement.notice = `${{ attacker: '공격측 승리', defender: '방어측 승리', draw: '무승부' }[result.winner] || '전투 완료'} · 약탈 금속 ${loot.metal}, 수정 ${loot.crystal}, 중수소 ${loot.deuterium} · 전투 기록에서 상세 확인`;
      target.markModified("planets");
      if(target.isPirate && result.winner === 'attacker' && require('../utils/pirateRules').cleared(planet)) {
        await User.deleteOne({_id:target._id});
        movement.notice += ' · 해적 거점 소탕 완료, 다시 개척할 수 있습니다.';
      } else await target.save();
      changed.push(String(target._id));
    }
    movement.status = "returning";
    movement.returnStartTime = now;
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
async function recall(userId, id, now = new Date()) {
  if (!mongoose.isValidObjectId(id)) fail('함대 번호가 올바르지 않습니다.', 400, 'INVALID_ID');
  await requireTransactions();
  return atomic(async () => {
    const movement = await FleetMovement.findOne({ _id: id, userId });
    if (!movement) fail('함대를 찾을 수 없습니다.', 404, 'NOT_FOUND');
    if (movement.recalledAt) return movement;
    if (movement.status !== 'flying' || +movement.arrivalTime <= +now) {
      fail('이미 도착했거나 귀환 중인 함대는 취소할 수 없습니다.', 409, 'RECALL_TOO_LATE');
    }
    // Turn around at the current position: returning takes the elapsed outbound time.
    const returnDuration = Math.max(1000, +now - +movement.startTime);
    movement.recalledAt = now;
    movement.returnStartTime = now;
    movement.returnTime = new Date(+now + returnDuration);
    movement.status = 'returning';
    movement.notice = `임무 취소 · 출발 행성으로 귀환 중입니다. 함선과 적재 자원${movement.colonists ? `, 인구 ${movement.colonists}명` : ''}은 귀환 시 복구됩니다.`;
    await movement.save();
    return movement;
  });
}
module.exports = { launch, processMovement, recall };
