const { ENTITY_IDS } = require('../data/catalog');
const plain = value => value?.toObject ? value.toObject() : value || {};

function normalizeUserResearch(user) {
  const research = { ...plain(user.research) };
  if (user.researchScopeVersion !== 1) {
    for (const id of ENTITY_IDS.research) {
      research[id] = Math.max(0, research[id] || 0, ...(user.planets || []).map(planet => planet.research?.[id] || 0));
    }
    user.terraformingLevel = Math.max(user.terraformingLevel || 0, research.terraforming || 0);
    user.researchScopeVersion = 1;
  }
  research.terraforming = user.terraformingLevel || 0;
  user.research = research;
  // Planet fields remain a compatibility projection for economy/legacy consumers.
  for (const planet of user.planets || []) planet.research = { ...research };
  return research;
}
function researchInfrastructure(user, queues = [], originIndex = user.currentPlanet || 0) {
  const labs = (user.planets || []).map((planet, index) => ({
    planetId: String(planet._id ?? index), name: planet.name || `행성 ${index + 1}`,
    level: Math.max(0, planet.buildings?.researchLab || 0)
  }));
  const origin = labs[originIndex] || labs[0];
  return {
    labs, originPlanetId: origin?.planetId,
    originLabLevel: origin?.level || 0,
    networkLevel: Math.max(0, user.research?.intergalacticResearchNetwork || 0),
    labLevel: labs.reduce((sum, lab) => sum + lab.level, 0),
    highestLabLevel: Math.max(0, ...labs.map(lab => lab.level)),
    labCount: labs.filter(lab => lab.level > 0).length,
    labsBusy: queues.some(q => q.type === 'building' && q.itemId === 'researchLab' && !q.applied && ['building', 'pending'].includes(q.status)),
    researchBusy: queues.some(q => q.type === 'research' && !q.applied && ['building', 'pending'].includes(q.status))
  };
}
module.exports = { normalizeUserResearch, researchInfrastructure };
