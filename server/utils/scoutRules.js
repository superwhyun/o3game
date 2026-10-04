const { createHmac } = require("node:crypto");
const { plain } = require("./formationRules");
const VERSION = 1;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
function levelOf(user, planet) {
  return Math.max(
    0,
    Math.floor(
      planet?.research?.espionageTechnology ??
        user?.research?.espionageTechnology ??
        0,
    ),
  );
}
function tierOf(a, d) {
  return clamp(1 + a - d, 1, 4);
}
function detectionChance(a, d) {
  return clamp(50 + 15 * (d - a), 5, 95);
}
function detectionRoll(movementId, secret) {
  return (
    (createHmac("sha256", secret)
      .update(`scout:${VERSION}:${movementId}`)
      .digest()
      .readUInt32BE(0) /
      0x100000000) *
    100
  );
}
function canIntercept(planet, statsOf) {
  return ["ship", "defense"].some((type) =>
    Object.entries(plain(type === "ship" ? planet.fleet : planet.defense)).some(
      ([id, n]) =>
        n > 0 &&
        statsOf(type, id)?.attack > 0 &&
        (type === "defense" || statsOf(type, id)?.category === "military"),
    ),
  );
}
function sectionsOf(planet, tier) {
  const sections = {
    resources: Object.fromEntries(
      ["metal", "crystal", "deuterium"].map((id) => [
        id,
        Math.max(0, Math.floor(planet.resources?.[id] || 0)),
      ]),
    ),
  };
  if (tier >= 2) sections.fleet = { ...plain(planet.fleet) };
  if (tier >= 3) sections.defense = { ...plain(planet.defense) };
  if (tier >= 4) {
    sections.buildings = { ...plain(planet.buildings) };
    sections.research = { ...plain(planet.research) };
  }
  return sections;
}
module.exports = {
  VERSION,
  levelOf,
  tierOf,
  detectionChance,
  detectionRoll,
  canIntercept,
  sectionsOf,
};
