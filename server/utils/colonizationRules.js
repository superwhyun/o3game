const { createHash } = require("node:crypto");
const { createPlanetEnvironment, calculateArea, productionModifiers } = require("./planetArea");
// Versioned coordinate seed: surveys never reroll and secret rotation cannot change terrain.
function environmentOf(destination) {
  const seed = createHash("sha256").update(`terrain:v1:${destination.galaxy}:${destination.system}:${destination.planet}`).digest();
  let index = 0;
  const random = () => seed.readUInt32BE((index++ % 8) * 4) / 0x100000000;
  return { diameter: 10000 + Math.floor(random() * 10001), ...createPlanetEnvironment(random), areaVersion: 1 };
}
function surveyOf(planet, terraformingLevel = 0) {
  const natural = calculateArea(planet, 0);
  const prospective = calculateArea(planet, terraformingLevel);
  return {
    diameter: planet.diameter, minTemp: planet.minTemp, maxTemp: planet.maxTemp,
    total: natural.total, usable: natural.usable, unusable: natural.total - natural.usable,
    baseUsablePercent: natural.baseUsablePercent,
    terraformingLevel, prospectiveUsable: prospective.usable,
    production: productionModifiers(planet),
  };
}
module.exports = { environmentOf, surveyOf };
