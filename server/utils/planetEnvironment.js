const ENVIRONMENTS = Object.freeze({
  ice: { name: '얼음 행성', description: '빙하와 얼어붙은 바다로 덮인 저온 행성' },
  volcanic: { name: '화산 행성', description: '용암과 화산 지형이 발달한 고온 행성' },
  tropical: { name: '열대 행성', description: '바다와 숲이 발달한 온화한 행성' },
  desert: { name: '사막 행성', description: '건조한 모래와 암석으로 덮인 행성' }
});
function inferEnvironment(planet) {
  const average = ((planet.minTemp ?? -20) + (planet.maxTemp ?? 40)) / 2;
  return average <= -20 ? 'ice' : average >= 60 ? 'volcanic' : average >= 30 ? 'desert' : 'tropical';
}
function planetEnvironment(planet) {
  const type = ENVIRONMENTS[planet.environmentType] ? planet.environmentType : inferEnvironment(planet);
  return { type, ...ENVIRONMENTS[type] };
}
function initializeEnvironment(planet) {
  if (ENVIRONMENTS[planet.environmentType]) return false;
  planet.environmentType = inferEnvironment(planet);
  return true;
}
module.exports = { ENVIRONMENTS, inferEnvironment, planetEnvironment, initializeEnvironment };
