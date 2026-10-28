const MAX_LEVEL = 10;
function levelFor(planet) {
  const score = Object.values(
    planet.buildings?.toObject?.() || planet.buildings || {},
  ).reduce((sum, value) => sum + Math.max(0, Number(value) || 0) ** 2, 0);
  return {
    level: Math.min(MAX_LEVEL, Math.max(1, Math.ceil(Math.sqrt(score) / 10))),
    developmentScore: score,
  };
}
function profile(level) {
  const n = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
  const fleet = {
    lightFighter: n * 4,
    heavyFighter: n * 2,
    cruiser: Math.max(0, n - 2),
    battleship: Math.max(0, n - 5),
  };
  const defense = {
    rocketLauncher: n * 4,
    lightLaser: n * 2,
    heavyLaser: Math.max(0, n - 3),
  };
  return {
    level: n,
    fleet,
    defense,
    maximum: {
      fleet: Object.fromEntries(
        Object.entries(fleet).map(([k, v]) => [k, v * 2]),
      ),
      defense: Object.fromEntries(
        Object.entries(defense).map(([k, v]) => [k, v * 2]),
      ),
    },
    production: {
      metal: 300 * n * n,
      crystal: 200 * n * n,
      deuterium: 100 * n * n,
    },
    storage: 10000 * n * n,
    rebuildSeconds: 300,
  };
}
function cleared(planet) {
  return ["fleet", "defense"].every((key) =>
    Object.values(planet[key]?.toObject?.() || planet[key] || {}).every(
      (n) => !n,
    ),
  );
}
function regenerate(planet, state, config, now, entityFor) {
  const p = profile(state.level);
  let elapsed =
    Math.max(0, (+now - +state.lastUpdate) / 1000) * (config.serverSpeed || 1);
  if (elapsed <= 0) return;
  // A week's simulation is enough to saturate storage and the bounded garrison;
  // bound settlement work even for a planet left untouched for years.
  elapsed = Math.min(elapsed, 7 * 86400);
  let progress = state.rebuildProgress || 0;
  const produce = (seconds) => {
    for (const [r, rate] of Object.entries(p.production))
      planet.resources[r] = Math.min(
        p.storage,
        (planet.resources[r] || 0) + (rate * seconds) / 3600,
      );
  };
  while (elapsed > 0) {
    const missing = Object.entries(p.maximum).flatMap(([type, ships]) =>
      Object.entries(ships)
        .filter(([id, max]) => (planet[type][id] || 0) < max)
        .map(([id]) => ({ type, id })),
    );
    if (!missing.length) {
      produce(elapsed);
      progress = 0;
      break;
    }
    const step = Math.min(elapsed, p.rebuildSeconds - progress);
    produce(step);
    elapsed -= step;
    progress += step;
    if (progress < p.rebuildSeconds) break;
    progress = 0;
    for (const unit of missing) {
      const cost = entityFor(
        unit.type === "fleet" ? "ship" : "defense",
        unit.id,
      )?.costModel?.baseCost;
      if (!cost) continue;
      if (
        ["metal", "crystal", "deuterium"].every(
          (r) => (planet.resources[r] || 0) >= (cost[r] || 0),
        )
      ) {
        for (const r of ["metal", "crystal", "deuterium"])
          planet.resources[r] -= cost[r] || 0;
        planet[unit.type][unit.id] = (planet[unit.type][unit.id] || 0) + 1;
        break;
      }
    }
  }
  state.rebuildProgress = progress;
  state.lastUpdate = now;
  planet.lastUpdate = now;
}
module.exports = { levelFor, profile, cleared, regenerate, MAX_LEVEL };
