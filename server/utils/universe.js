/**
 * Universe dimensions and planet coordinate helpers shared by the galaxy view,
 * fleet validation and home-planet allocation.
 */

const GALAXY_COUNT = 9;
const SYSTEM_COUNT = 499;
const POSITION_COUNT = 15;
// Mid-orbit slots new players are placed in first (temperate, OGame-style).
const PREFERRED_HOME_POSITIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12];

/** @param {{ galaxy: number, system: number, planet: number }} coordinate */
function coordinateKey({ galaxy, system, planet }) {
  return `${galaxy}:${system}:${planet}`;
}

function isValidCoordinate({ galaxy, system, planet }) {
  return [
    [galaxy, GALAXY_COUNT],
    [system, SYSTEM_COUNT],
    [planet, POSITION_COUNT],
  ].every(
    ([value, maximum]) =>
      Number.isSafeInteger(value) && value >= 1 && value <= maximum,
  );
}

/**
 * Pick a free home coordinate. Fills systems in order so players end up as
 * neighbours, choosing a random free preferred orbit inside the first system
 * that has one; falls back to any free orbit.
 * @param {Set<string>} occupiedKeys coordinate keys already taken
 * @param {{ rng?: () => number, galaxy?: number }} [options]
 * @returns {{ galaxy: number, system: number, planet: number }}
 */
function pickHomeCoordinate(
  occupiedKeys,
  { rng = Math.random, galaxy: selectedGalaxy, randomized = false } = {},
) {
  if (
    selectedGalaxy !== undefined &&
    (!Number.isSafeInteger(selectedGalaxy) ||
      selectedGalaxy < 1 ||
      selectedGalaxy > GALAXY_COUNT)
  )
    throw require("./apiErrors").apiError(
      400,
      "INVALID_REQUEST",
      "은하는 1~9 사이의 정수로 선택해 주세요.",
    );
  const galaxies =
    selectedGalaxy === undefined
      ? Array.from({ length: GALAXY_COUNT }, (_, index) => index + 1)
      : [selectedGalaxy];
  const allPositions = Array.from(
    { length: POSITION_COUNT },
    (_, index) => index + 1,
  );

  if (randomized) {
    const free = [];
    for (const galaxy of galaxies)
      for (let system = 1; system <= SYSTEM_COUNT; system++)
        for (const planet of allPositions) {
          if (!occupiedKeys.has(coordinateKey({ galaxy, system, planet })))
            free.push({ galaxy, system, planet });
        }
    if (free.length)
      return free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
  }
  for (const candidates of [PREFERRED_HOME_POSITIONS, allPositions]) {
    for (const galaxy of galaxies) {
      for (let system = 1; system <= SYSTEM_COUNT; system++) {
        const free = candidates.filter(
          (planet) =>
            !occupiedKeys.has(coordinateKey({ galaxy, system, planet })),
        );
        if (free.length > 0) {
          const planet =
            free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
          return { galaxy, system, planet };
        }
      }
    }
  }

  throw require("./apiErrors").apiError(
    409,
    "RESOURCE_CONFLICT",
    selectedGalaxy === undefined
      ? "배치할 빈 행성 좌표가 없습니다."
      : "선택한 은하에 배치할 빈 행성 좌표가 없습니다.",
  );
}

module.exports = {
  GALAXY_COUNT,
  SYSTEM_COUNT,
  POSITION_COUNT,
  PREFERRED_HOME_POSITIONS,
  coordinateKey,
  isValidCoordinate,
  pickHomeCoordinate,
};
