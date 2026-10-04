/**
 * Cosmic Empire 3D - Game Data
 *
 * Resources and formatting helpers. Entity definitions (buildings, research,
 * ships, defense) are NOT authored here any more — they come from the server
 * catalog (server/data/catalog) through ./catalog.js. The BUILDINGS / RESEARCH /
 * SHIPS / DEFENSE exports below are live, legacy-shaped views of that catalog
 * kept for existing callers (e.g. window.GameData in the console).
 */
import { catalog } from './catalog.js';

// ========================================
// Resources
// ========================================
export const RESOURCES = {
  metal: {
    id: 'metal',
    name: '금속',
    icon: '⚙️',
    color: '#a9b1bd',
    baseProduction: 30, // per hour at level 0
    description: '모든 건설의 기본 자원'
  },
  crystal: {
    id: 'crystal',
    name: '수정',
    icon: '💎',
    color: '#7fb2e5',
    baseProduction: 15,
    description: '전자 부품 및 연구에 사용'
  },
  deuterium: {
    id: 'deuterium',
    name: '중수소',
    icon: '💧',
    color: '#7fc8a9',
    baseProduction: 0,
    description: '함선 연료 및 고급 연구에 사용'
  },
  energy: {
    id: 'energy',
    name: '에너지',
    icon: '⚡',
    color: '#e2c26a',
    baseProduction: 0,
    description: '모든 건설에 필요한 동력'
  }
};

// ========================================
// Entity registries (hydrated from the server catalog)
// ========================================
export const BUILDINGS = {};
export const RESEARCH = {};
export const SHIPS = {};
export const DEFENSE = {};

const REGISTRIES = { building: BUILDINGS, research: RESEARCH, ship: SHIPS, defense: DEFENSE };

function toLegacyShape(entity) {
  const requirements = {
    ...(entity.requirements.buildings || {}),
    ...(entity.requirements.research || {})
  };
  const base = {
    id: entity.id,
    name: entity.name,
    icon: entity.icon,
    category: entity.category,
    description: entity.description,
    requirements,
    buildTime: entity.timeModel?.baseTime ?? 0
  };
  if (catalog.isLeveled(entity.type)) {
    return { ...base, baseCost: entity.costModel.baseCost, costMultiplier: entity.costModel.costMultiplier };
  }
  return {
    ...base,
    type: entity.category,
    cost: entity.costModel.baseCost,
    techRequirements: requirements,
    stats: entity.stats,
    rapidFire: entity.stats?.rapidFire || {},
    model: entity.model
  };
}

function syncRegistries() {
  for (const [type, registry] of Object.entries(REGISTRIES)) {
    for (const key of Object.keys(registry)) delete registry[key];
    for (const entity of catalog.list(type)) registry[entity.id] = toLegacyShape(entity);
  }
}

catalog.on('changed', syncRegistries);

// ========================================
// Helper Functions (same formulas as the server)
// ========================================
export function calculateBuildingCost(buildingId, level) {
  const entity = catalog.get('building', buildingId);
  return entity ? catalog.cost(entity, level) : null;
}

export function calculateResearchCost(researchId, currentLevel) {
  const entity = catalog.get('research', researchId);
  return entity ? catalog.cost(entity, currentLevel + 1) : null;
}

export function calculateShipCost(shipId, count = 1) {
  const entity = catalog.get('ship', shipId);
  return entity ? catalog.cost(entity, count) : null;
}

export function calculateDefenseCost(defenseId, count = 1) {
  const entity = catalog.get('defense', defenseId);
  return entity ? catalog.cost(entity, count) : null;
}

export function formatNumber(num) {
  if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

export function formatTime(seconds) {
  if (seconds < 60) return `${seconds}초`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 ${Math.floor((seconds % 3600) / 60)}분`;
  return `${Math.floor(seconds / 86400)}일 ${Math.floor((seconds % 86400) / 3600)}시간`;
}
