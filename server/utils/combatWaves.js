const { ENTITY_IDS } = require("../data/catalog");
const { plain } = require("./formationRules");
const emptyWaves = () =>
  Array.from({ length: 8 }, () => ({ ships: {}, defense: {} }));
function attackWaves(fleet, legacyDeck) {
  const waves = emptyWaves();
  const remaining = { ...plain(fleet) };
  for (let i = 0; i < Math.min(8, legacyDeck?.length || 0); i++) {
    const slot = legacyDeck[i];
    if (slot?.type && slot.count > 0 && remaining[slot.type] > 0) {
      const count = Math.min(slot.count, remaining[slot.type]);
      waves[i].ships[slot.type] = count;
      remaining[slot.type] -= count;
    }
  }
  const ids = [
    ...ENTITY_IDS.ship,
    ...Object.keys(remaining).filter((id) => !ENTITY_IDS.ship.includes(id)),
  ];
  ids
    .filter((id) => remaining[id] > 0)
    .forEach((id, i) => {
      waves[i % 8].ships[id] = (waves[i % 8].ships[id] || 0) + remaining[id];
    });
  return waves;
}
function defenseWaves(planet) {
  const waves = emptyWaves();
  waves[0].defense = Object.fromEntries(
    Object.entries(plain(planet.defense)).filter(([, n]) => n > 0),
  );
  waves[1].ships = Object.fromEntries(
    Object.entries(plain(planet.fleet)).filter(([, n]) => n > 0),
  );
  return waves;
}
module.exports = { attackWaves, defenseWaves };
