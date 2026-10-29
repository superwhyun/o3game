export function recommendedCargo(resources, capacity, colonists) {
  const targets = { metal: 5000, crystal: 2000, deuterium: 500 };
  const desired = Object.fromEntries(Object.entries(targets).map(([key, n]) => [key, Math.min(n, Math.max(0, Math.floor(resources?.[key] || 0)))]));
  const space = Math.max(0, Math.floor(capacity - colonists));
  const sum = Object.values(desired).reduce((n, value) => n + value, 0);
  const ratio = sum > space ? space / sum : 1;
  const result = Object.fromEntries(Object.entries(desired).map(([key, n]) => [key, Math.floor(n * ratio)]));
  let spare = Math.min(sum, space) - Object.values(result).reduce((n, value) => n + value, 0);
  for (const key of Object.keys(result)) {
    const add = Math.min(spare, desired[key] - result[key]);
    result[key] += add; spare -= add;
  }
  return result;
}

export function surveyArea(survey, terraformLevel, bonusFields = 40) {
  const percent = Math.min(100, survey.baseUsablePercent + Math.max(0, terraformLevel) * 2);
  return Math.min(survey.total, Math.floor(survey.total * percent / 100 + 1e-9) + bonusFields);
}

export function surveyName(survey) {
  if (survey.environment?.name) return survey.environment.name;
  const average = (survey.minTemp + survey.maxTemp) / 2;
  return average <= -20 ? '얼음 행성' : average >= 60 ? '화산 행성' : average >= 30 ? '사막 행성' : '열대 행성';
}
