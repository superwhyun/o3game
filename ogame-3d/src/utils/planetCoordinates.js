/** Numeric coordinate order, shared by owned-planet selectors. */
export function comparePlanetCoordinates(a, b) {
  return Number(a.galaxy) - Number(b.galaxy)
    || Number(a.system) - Number(b.system)
    || Number(a.planet) - Number(b.planet);
}
