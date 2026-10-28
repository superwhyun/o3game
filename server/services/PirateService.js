const crypto = require("node:crypto");
const User = require("../models/User");
const rules = require("../utils/pirateRules");
async function createFrom(planet, now = new Date()) {
  const info = rules.levelFor(planet),
    p = rules.profile(info.level);
  const key = crypto.randomUUID();
  return User.create({
    username: `해적 거점 ${key}`,
    email: `pirate-${key}@npc.invalid`,
    password: crypto.randomBytes(48).toString("hex"),
    isPirate: true,
    pirate: { ...info, lastUpdate: now, rebuildProgress: 0 },
    planets: [
      {
        name: `해적 행성 Lv.${info.level}`,
        galaxy: planet.galaxy,
        system: planet.system,
        planet: planet.planet,
        diameter: planet.diameter,
        minTemp: planet.minTemp,
        maxTemp: planet.maxTemp,
        baseUsablePercent: planet.baseUsablePercent,
        environmentType: planet.environmentType,
        traits: planet.traits,
        areaVersion: 1,
        resources: { metal: 0, crystal: 0, deuterium: 0, food: 0, energy: 0 },
        buildings: {
          metalMine: info.level,
          crystalMine: info.level,
          deuteriumSynthesizer: info.level,
          solarPlant: info.level * 2,
          shipyard: info.level,
          metalStorage: info.level,
          crystalStorage: info.level,
          deuteriumTank: info.level,
        },
        fleet: p.fleet,
        defense: p.defense,
        population: {
          version: 1,
          count: 0,
          baseHousing: 0,
          baseFood: 0,
          baseCulture: 0,
          foodCapacity: 0,
          growthProgress: 0,
        },
        lastUpdate: now,
      },
    ],
  });
}
async function settle(user, config, now) {
  rules.regenerate(user.planets[0], user.pirate, config, now, (type, id) =>
    require("./EntityConfigService").getEntity(type, id),
  );
  user.markModified("planets");
  await user.save();
  return user;
}
module.exports = { createFrom, settle };
