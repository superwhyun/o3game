/** IRN selects the origin first, then eligible labs by level; no manual links. */
function selectResearchLabs(infrastructure, requiredLevel = 1) {
  const minimum = Math.max(1, requiredLevel || 1);
  const labs = infrastructure?.labs || [];
  const origin = labs.find(lab => String(lab.planetId) === String(infrastructure.originPlanetId));
  if (!origin || origin.level < minimum) return { labs: [], effectiveLevel: 0, eligible: false, requiredLevel: minimum };
  const additional = labs.filter(lab => lab !== origin && lab.level >= minimum)
    .sort((a, b) => b.level - a.level || String(a.planetId).localeCompare(String(b.planetId)))
    .slice(0, Math.max(0, Math.floor(infrastructure.networkLevel || 0)));
  const selected = [origin, ...additional];
  return { labs: selected, effectiveLevel: selected.reduce((sum, lab) => sum + lab.level, 0), eligible: true, requiredLevel: minimum };
}
module.exports = { selectResearchLabs };
