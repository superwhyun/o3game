const { createHash } = require("node:crypto");
const { createPlanetEnvironment, calculateArea, productionModifiers, totalArea } = require("./planetArea");
const MIN_PLANET_DIAMETER = 10000;
const MAX_PLANET_DIAMETER = 20000;
const MAX_PLANET_AREA = totalArea({ diameter: MAX_PLANET_DIAMETER });
// Versioned coordinate seed: surveys never reroll and secret rotation cannot change terrain.
function environmentOf(destination) {
  const seed = createHash("sha256").update(`terrain:v1:${destination.galaxy}:${destination.system}:${destination.planet}`).digest();
  let index = 0;
  const random = () => seed.readUInt32BE((index++ % 8) * 4) / 0x100000000;
  return { diameter: MIN_PLANET_DIAMETER + Math.floor(random() * (MAX_PLANET_DIAMETER - MIN_PLANET_DIAMETER + 1)), ...createPlanetEnvironment(random), areaVersion: 1 };
}
function surveyOf(planet, terraformingLevel = 0, config = {}) {
  const natural = calculateArea(planet, 0, [], '0', config);
  const prospective = calculateArea(planet, terraformingLevel, [], '0', config);
  return {
    environment: require('./planetEnvironment').planetEnvironment(planet),
    diameter: planet.diameter, minTemp: planet.minTemp, maxTemp: planet.maxTemp,
    maxTotal: MAX_PLANET_AREA, total: natural.total, usable: natural.usable, unusable: natural.total - natural.usable,
    baseUsablePercent: natural.baseUsablePercent,
    bonusUsable: natural.bonusUsable,
    terraformingLevel, prospectiveUsable: prospective.usable,
    production: productionModifiers(planet),
  };
}
module.exports = { environmentOf, surveyOf, MAX_PLANET_DIAMETER, MAX_PLANET_AREA };
