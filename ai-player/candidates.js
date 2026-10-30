import { randomUUID } from "node:crypto";
const amount = (x) => (typeof x === "number" ? x : x?.level || 0);
const coord = (p) => ({ galaxy: p.galaxy, system: p.system, planet: p.planet });
export function colonyShipBudget(snapshot, job = {}) {
  const queues =
    snapshot.queueState?.all ||
    [snapshot.queueState?.ship, ...(snapshot.queueState?.queue || [])].filter(
      Boolean,
    );
  const limit = Math.min(9, job.maxColonies ?? 3);
  const owned = snapshot.planets.length;
  const stationed = snapshot.planets.reduce(
    (sum, p) => sum + (p.fleet?.colonyShip || 0),
    0,
  );
  const queued = queues
    .filter((q) => q.type === "ship" && q.itemId === "colonyShip")
    .reduce((sum, q) => sum + (q.count || 1), 0);
  const moving = (snapshot.fleetMovements || [])
    .filter((m) => ["flying", "returning"].includes(m.status))
    .reduce(
      (sum, m) =>
        sum + (m.fleet?.colonyShip || (m.mission === "colonize" ? 1 : 0)),
      0,
    );
  return {
    limit,
    owned,
    stationed,
    queued,
    moving,
    needed: Math.max(0, limit - owned - stationed - queued - moving),
  };
}
function candidatesForPlanet(snapshot, catalog, galaxy, job) {
  const list = [
    { id: "c0", label: "대기 · 자원 생산 및 진행 작업 완료", details: {} },
  ];
  const add = (label, command, details = {}) => {
    if (list.length < 512)
      list.push({ id: `c${list.length}`, label, command, details });
  };
  const planet = snapshot.planets[snapshot.currentPlanet || 0];
  const queues =
    snapshot.queueState?.all ||
    [
      snapshot.queueState?.building,
      snapshot.queueState?.research,
      snapshot.queueState?.ship,
      snapshot.queueState?.defense,
      ...(snapshot.queueState?.queue || []),
    ].filter(Boolean);
  const deathstar = catalog.entities?.find((e) => e.entityId === "deathstar");
  const gravitonTarget =
    deathstar?.requirements?.research?.gravitonTechnology || 0;
  const gravitonUseful =
    !!job.allowAttacks &&
    (job.behaviorScores?.attack ?? 1) > 0 &&
    gravitonTarget > 0 &&
    Object.entries(deathstar.requirements?.buildings || {}).every(
      ([id, level]) => amount(planet.buildings?.[id]) >= level,
    ) &&
    Object.entries(deathstar.requirements?.research || {}).every(
      ([id, level]) =>
        id === "gravitonTechnology" || amount(snapshot.research?.[id]) >= level,
    );
  // Cancel obsolete bot research from the last reserved level first. Human
  // delegation never cancels a user's queued work automatically.
  if (job.kind !== "delegate") {
    const obsolete = queues.filter(
      (q) =>
        q.type === "research" &&
        q.itemId === "gravitonTechnology" &&
        (!gravitonUseful || q.level > gravitonTarget),
    );
    const last = obsolete.sort((a, b) => b.level - a.level)[0];
    if (
      last?.id &&
      String(last.planetId) === String(snapshot.currentPlanet || 0)
    )
      add(
        `확장 병목 해소 · 불필요한 중력자 기술 Lv.${last.level} 연구 취소`,
        {
          method: "DELETE",
          path: `/api/queue/${last.id}`,
        },
        {
          type: "recovery",
          focus: "expansion",
          priority: "urgent",
          queueId: last.id,
        },
      );
  }
  for (const entity of catalog.entities || []) {
    if (entity.status && entity.status !== "active") continue;
    const type = entity.entityType,
      id = entity.entityId;
    if (
      id === "gravitonTechnology" &&
      (!gravitonUseful || amount(snapshot.research?.[id]) >= gravitonTarget)
    )
      continue;
    if (
      type === "ship" &&
      id === "colonyShip" &&
      colonyShipBudget(snapshot, job).needed <= 0
    )
      continue;
    const req = entity.requirements || {};
    if (
      !Object.entries(req.buildings || {}).every(
        ([k, n]) => amount(planet.buildings?.[k]) >= n,
      ) ||
      !Object.entries(req.research || {}).every(
        ([k, n]) => amount(snapshot.research?.[k]) >= n,
      )
    )
      continue;
    if (
      queues.some(
        (q) =>
          q.type === type &&
          (type === "research" ||
            String(q.planetId) === String(snapshot.currentPlanet || 0)) &&
          (["ship", "defense"].includes(type) || q.itemId === id),
      )
    )
      continue;
    if (type === "building" && planet.area?.available <= 0) continue;
    if (
      type === "research" &&
      (amount(planet.buildings?.researchLab) < 1 ||
        queues.some((q) => q.type === "building" && q.itemId === "researchLab"))
    )
      continue;
    if (
      type === "building" &&
      id === "researchLab" &&
      queues.some((q) => q.type === "research")
    )
      continue;
    const level = amount(
      (type === "research" ? snapshot.research : planet.buildings)?.[id],
    );
    const cost = Object.fromEntries(
      ["metal", "crystal", "deuterium"].map((k) => [
        k,
        Math.floor(
          (entity.costModel?.baseCost?.[k] || 0) *
            (["building", "research"].includes(type)
              ? (entity.costModel?.costMultiplier ?? 1.5) ** level
              : 1),
        ),
      ]),
    );
    if (
      !Object.entries(cost).every(([k, n]) => (planet.resources?.[k] || 0) >= n)
    )
      continue;
    const body =
      type === "building"
        ? { buildingId: id }
        : type === "research"
          ? { researchId: id }
          : { shipId: id, entityType: type, count: 1 };
    add(
      `${entity.display?.name || id} ${["building", "research"].includes(type) ? `Lv.${level + 1}` : "1기"} ${type === "research" ? "연구" : "건설"}`,
      {
        path: `/api/queue/${type === "building" ? "build" : type === "research" ? "research" : "ship"}`,
        body: { ...body, planetId: String(snapshot.currentPlanet || 0) },
      },
      { type, id, cost, effects: entity.effects, stats: entity.stats },
    );
  }
  const flying = (snapshot.fleetMovements || []).filter(
    (m) => m.status === "flying",
  );
  const pendingColonies = flying.filter((m) => m.mission === "colonize").length;
  const occupiedDestination = (mission, slot) =>
    flying.some(
      (m) =>
        m.mission === mission &&
        m.destination?.galaxy === (slot.galaxy ?? planet.galaxy) &&
        m.destination?.system === (slot.system ?? planet.system) &&
        m.destination?.planet === slot.position,
    );
  const slots = (
    Array.isArray(galaxy) ? galaxy : galaxy ? [galaxy] : []
  ).flatMap((g) =>
    (g.positions || []).map((slot) => ({
      ...slot,
      galaxy: g.galaxy ?? planet.galaxy,
      system: g.system ?? planet.system,
    })),
  );
  const destinationOf = (slot) => ({
    galaxy: slot.galaxy,
    system: slot.system,
    planet: slot.position,
  });
  const fleets = (snapshot.fleetFormations || []).filter(
    (f) =>
      String(f.originPlanetId) === String(planet._id) && f.status === "ready",
  );
  if ((snapshot.unassignedShips?.espionageProbe || 0) > 0) {
    for (const slot of slots
      .filter(
        (s) =>
          s.owner !== "self" && !s.scouted && !occupiedDestination("spy", s),
      )
      .slice(0, 8))
      add(`[${slot.galaxy}:${slot.system}:${slot.position}] 정찰`, {
        path: "/api/game/scouts",
        body: {
          requestId: randomUUID(),
          originPlanetId: planet._id,
          destination: destinationOf(slot),
        },
      });
  }
  if (
    Object.entries(snapshot.unassignedShips || {}).some(
      ([k, n]) => n > 0 && !["espionageProbe", "solarSatellite", "colonyShip"].includes(k),
    )
  ) {
    if (!fleets.some((f) => !Object.values(f.ships || {}).some((n) => n > 0)))
      add("함대 편성 생성", {
        path: "/api/game/fleet-formations",
        body: { originPlanetId: planet._id },
      });
    for (const f of fleets.filter(
      (f) => !Object.values(f.ships || {}).some((n) => n > 0),
    )) {
      const ships = Object.fromEntries(
        Object.entries(snapshot.unassignedShips).filter(
          ([k, n]) =>
            n > 0 && !["espionageProbe", "solarSatellite", "colonyShip"].includes(k),
        ),
      );
      const manned = Object.keys(ships).some(id => (catalog.entities.find(e => e.entityType === "ship" && e.entityId === id)?.stats?.crew || 0) > 0);
      const required = manned ? 10 + Math.floor(Object.values(ships).reduce((sum, count) => sum + count, 0) / 100) : 0;
      if (
        required >
        (planet.populationState?.count || planet.population?.count || 0) +
          (f.crew || 0)
      )
        continue;
      add(`${f.name} 함선 배치`, {
        method: "PATCH",
        path: `/api/game/fleet-formations/${f.id || f._id}`,
        body: { name: f.name, expectedRevision: f.revision, ships },
      });
    }
  }
  if (
    (snapshot.unassignedShips?.colonyShip || 0) > 0 &&
    snapshot.planets.length + pendingColonies <
      colonyShipBudget(snapshot, job).limit &&
    (planet.populationState?.count ?? planet.population?.count ?? 0) >= 10
  ) {
    for (const slot of slots
      .filter(
        (s) => s.scouted && !s.occupied && !occupiedDestination("colonize", s),
      )
      .slice(0, 3))
      add(
        `[${slot.galaxy}:${slot.system}:${slot.position}] 직접 개척 · 인구 10명`,
        {
          path: "/api/game/fleets",
          body: {
            requestId: randomUUID(),
            mission: "colonize",
            originPlanetId: planet._id,
            colonists: 10,
            speed: 100,
            cargo: {},
            destination: destinationOf(slot),
          },
        },
        { focus: "expansion" },
      );
  }
  for (const f of fleets) {
    if (
      (f.crew || 0) < (f.requiredCrew || 0) &&
      f.requiredCrew - (f.crew || 0) <=
        (planet.populationState?.count || planet.population?.count || 0)
    )
      add(`${f.name} 승무원 충원`, {
        method: "PATCH",
        path: `/api/game/fleet-formations/${f.id || f._id}`,
        body: { name: f.name, expectedRevision: f.revision, ships: f.ships },
      });
    if (
      (f.crew || 0) < (f.requiredCrew || 0) ||
      planet.fleetSupport?.shortages?.length
    )
      continue;
    const base = {
      formationId: f.id || f._id,
      originPlanetId: planet._id,
      expectedRevision: f.revision,
      speed: 100,
      cargo: {},
    };
    if (
      job.allowAttacks &&
      (job.behaviorScores?.attack ?? 1) > 0 &&
      Object.entries(f.ships || {}).some(
        ([id, n]) =>
          n > 0 &&
          catalog.entities.some(
            (e) =>
              e.entityId === id &&
              e.entityType === "ship" &&
              e.display?.category === "military",
          ),
      )
    ) {
      for (const slot of slots
        .filter((s) => s.owner === "other" && s.scouted && s.planet?.name)
        .slice(0, 3))
        add(`${slot.planet.name} 공격`, {
          path: "/api/game/fleets",
          body: {
            ...base,
            requestId: randomUUID(),
            mission: "attack",
            expectedTargetPlanetId: slot.planet.id,
            destination: destinationOf(slot),
          },
        });
    }
  }
  return list;
}
export function candidatesFor(snapshot, catalog, galaxy, job) {
  const groups = snapshot.planets.map((planet, index) => {
    const unassigned =
      index === (snapshot.currentPlanet || 0) && snapshot.unassignedShips
        ? { ...snapshot.unassignedShips }
        : { ...(planet.fleet || {}) };
    if (
      !(index === (snapshot.currentPlanet || 0) && snapshot.unassignedShips)
    ) {
      for (const formation of snapshot.fleetFormations || []) {
        if (
          formation.status !== "ready" ||
          String(formation.originPlanetId) !== String(planet._id)
        )
          continue;
        for (const [id, count] of Object.entries(formation.ships || {}))
          unassigned[id] = Math.max(0, (unassigned[id] || 0) - count);
      }
    }
    return candidatesForPlanet(
      { ...snapshot, currentPlanet: index, unassignedShips: unassigned },
      catalog,
      galaxy,
      job,
    )
      .slice(1)
      .map((candidate) => ({
        ...candidate,
        label:
          snapshot.planets.length > 1
            ? `[${planet.galaxy}:${planet.system}:${planet.planet}] ${planet.name || "행성"} · ${candidate.label}`
            : candidate.label,
        details: {
          ...candidate.details,
          originPlanetId: String(planet._id),
          coordinates: coord(planet),
        },
      }));
  });
  const result = [
    {
      id: "c0",
      label: "대기 · 실행할 일이 없어 다음 확인까지 휴식",
      details: {},
    },
  ];
  // Interleave planets so an unusually large candidate list cannot hide a colony.
  for (
    let offset = 0;
    result.length < 512 && groups.some((g) => offset < g.length);
    offset++
  ) {
    for (const group of groups)
      if (group[offset] && result.length < 512)
        result.push({ ...group[offset], id: `c${result.length}` });
  }
  for (const candidate of result) {
    const command = candidate.command;
    const entity = candidate.details.id;
    if (candidate.details.focus) continue;
    candidate.details.focus =
      command?.body?.mission === "attack"
        ? "attack"
        : command?.path === "/api/game/scouts" ||
            command?.body?.mission === "colonize" ||
            [
              "colonyShip",
              "espionageProbe",
              "astrophysics",
              "terraforming",
            ].includes(entity)
          ? "expansion"
          : "development";
  }
  return result;
}
export function observationFor(snapshot, catalog, job = {}) {
  const {
    username,
    planets,
    currentPlanet,
    research,
    researchInfrastructure,
    queueState,
    fleetFormations,
    unassignedShips,
    fleetMovements,
    serverSpeed,
  } = snapshot;
  return {
    username,
    planets,
    currentPlanet,
    research,
    researchInfrastructure,
    queueState,
    fleetFormations,
    unassignedShips,
    fleetMovements,
    serverSpeed,
    expansionPlan: {
      ...colonyShipBudget(snapshot, job),
      atLimit: snapshot.planets.length >= colonyShipBudget(snapshot, job).limit,
      instruction:
        snapshot.planets.length >= colonyShipBudget(snapshot, job).limit
          ? "행성 보유 한도 도달. 추가 개척과 식민선 생산 금지. 기존 행성의 에너지·식량·행복도·고용·연구 개선을 우선합니다."
          : colonyShipBudget(snapshot, job).needed === 0
            ? "보유·건조·이동 중인 식민선이 남은 개척 수요를 충족합니다. 추가 식민선을 생산하지 말고 기존 식민선을 활용합니다."
            : "개척 한도 내에서 필요한 식민선만 준비합니다.",
    },
    goals: (catalog.entities || []).map((e) => ({
      type: e.entityType,
      id: e.entityId,
      name: e.display?.name,
      requirements: e.requirements,
    })),
  };
}
