import { selectResearchLabs } from './researchNetwork.js';
/**
 * Client entity catalog.
 *
 * Mirrors server/data/catalog via GET /api/game/catalog, so buildings,
 * research, ships and defenses added on the server show up in the UI with no
 * client changes. Cost / duration formulas mirror server/utils/gameCalculations.js.
 */
import { EventEmitter } from '../utils/EventEmitter.js';

export const ENTITY_TYPES = ['building', 'research', 'ship', 'defense'];
const LEVELED_TYPES = new Set(['building', 'research']);
const UNIT_TYPES = new Set(['ship', 'defense']);
const DEFAULT_MULTIPLIER = 1.5;

/** Same rule as server scaleExponentially(). */
export function scaleExponentially(baseValue, level, multiplier = null) {
  if (baseValue == null || Number.isNaN(baseValue)) return 0;
  const safeLevel = Number.isNaN(level) ? 0 : Math.max(0, level);
  if (safeLevel <= 1) return Math.floor(baseValue);
  const mult = (multiplier == null || Number.isNaN(multiplier) || multiplier < 1) ? DEFAULT_MULTIPLIER : multiplier;
  return Math.floor(baseValue * Math.pow(mult, safeLevel - 1));
}

/** Same rule as server evaluateScaledFormula() in utils/planetEconomy.js. */
export function evaluateEffect(rule, level = 0) {
  if (!rule) return 0;
  let result = 0;
  if (rule.kind === 'scaled') {
    result = level === 0 ? 0 : rule.coefficient * level * Math.pow(rule.growth || 1, level);
  } else if (rule.kind === 'storage') {
    result = (rule.base || 10000) * Math.floor(
      (rule.multiplier || 1) * Math.exp((rule.exponentNumerator || 0) * level / (rule.exponentDenominator || 1))
    );
  }
  return Number.isNaN(result) ? 0 : result;
}

/**
 * @typedef {Object} CatalogEntity
 * @property {string} id
 * @property {'building'|'research'|'ship'|'defense'} type
 * @property {string} name
 * @property {string} icon
 * @property {string} category
 * @property {string} description
 * @property {{buildings?: Object<string, number>, research?: Object<string, number>}} requirements
 * @property {Object} costModel
 * @property {Object} timeModel
 * @property {Object} effects
 * @property {Object} stats
 * @property {Object|null} model
 */

function toEntity(raw) {
  return Object.freeze({
    id: raw.entityId,
    type: raw.entityType,
    name: raw.display?.name || raw.entityId,
    icon: raw.display?.icon || '',
    category: raw.display?.category || '',
    description: raw.display?.description || '',
    model: raw.display?.model || null,
    requirements: raw.requirements || {},
    costModel: raw.costModel || { baseCost: {} },
    timeModel: raw.timeModel || {},
    effects: raw.effects || {},
    stats: raw.stats || {}
  });
}

class Catalog extends EventEmitter {
  constructor() {
    super();
    this.revision = null;
    this.timeMultipliers = { building: 1, research: 1, ship: 1, defense: 1 };
    this.byType = new Map(ENTITY_TYPES.map((type) => [type, new Map()]));
    this.loaded = false;
  }

  /** @param {{ revision: number, entities: object[], timeMultipliers?: object }} payload */
  hydrate(payload) {
    const next = new Map(ENTITY_TYPES.map((type) => [type, new Map()]));
    for (const raw of payload.entities || []) {
      next.get(raw.entityType)?.set(raw.entityId, toEntity(raw));
    }
    this.byType = next;
    this.revision = payload.revision ?? null;
    this.timeMultipliers = { ...this.timeMultipliers, ...(payload.timeMultipliers || {}) };
    this.loaded = true;
    this.emit('changed', { revision: this.revision });
  }

  /** @param {{ getCatalog: () => Promise<object> }} api */
  async load(api) {
    this.hydrate(await api.getCatalog());
    return this;
  }

  /** @returns {CatalogEntity|null} */
  get(type, id) {
    return this.byType.get(type)?.get(id) || null;
  }

  /** Find an entity by id regardless of type (requirements reference ids only). */
  find(id) {
    for (const type of ENTITY_TYPES) {
      const entity = this.get(type, id);
      if (entity) return entity;
    }
    return null;
  }

  /** @returns {CatalogEntity[]} */
  list(type, { category } = {}) {
    const items = [...(this.byType.get(type)?.values() || [])];
    return category ? items.filter((item) => item.category === category) : items;
  }

  categories(type) {
    return [...new Set(this.list(type).map((item) => item.category).filter(Boolean))];
  }

  isLeveled(type) {
    return LEVELED_TYPES.has(type);
  }

  /**
   * Cost of the next level (building/research) or of `count` units (ship/defense).
   * @param {CatalogEntity} entity
   * @param {number} levelOrCount  target level for leveled types, unit count otherwise
   */
  cost(entity, levelOrCount = 1) {
    const baseCost = entity?.costModel?.baseCost || {};
    const multiplier = entity?.costModel?.costMultiplier ?? DEFAULT_MULTIPLIER;
    const cost = {};
    for (const [resource, amount] of Object.entries(baseCost)) {
      if (!(amount > 0)) continue;
      cost[resource] = LEVELED_TYPES.has(entity.type)
        ? scaleExponentially(amount, levelOrCount, multiplier)
        : amount * levelOrCount;
    }
    return cost;
  }

  /**
   * Duration in seconds; mirrors server calculateQueueDuration().
   * @param {CatalogEntity} entity
   * @param {{ level?: number, count?: number, buildings?: object, serverSpeed?: number }} context
   */
  duration(entity, { level = 1, count = 1, buildings = {}, serverSpeed = 1 } = {}) {
    if (!entity) return 0;
    const isUnit = UNIT_TYPES.has(entity.type);
    let duration = scaleExponentially(
      entity.timeModel?.baseTime ?? 0,
      isUnit ? 1 : level,
      entity.timeModel?.timeMultiplier ?? entity.costModel?.costMultiplier ?? DEFAULT_MULTIPLIER
    );

    for (const [buildingId, buildingLevel] of Object.entries(buildings)) {
      if (!buildingLevel) continue;
      for (const modifier of this.get('building', buildingId)?.effects?.constructionModifiers || []) {
        if (!modifier.targetTypes?.includes(entity.type)) continue;
        if (modifier.mode === 'powerMultiplier') {
          duration *= Math.pow(modifier.value || 1, buildingLevel);
        } else if (modifier.mode === 'linearDivider') {
          duration /= (modifier.base || 1) + buildingLevel * (modifier.value || 0);
        }
      }
    }

    if (isUnit) duration *= count;
    const timeMultiplier = this.timeMultipliers[entity.type] || 1;
    return Math.max(1, Math.floor((duration / (serverSpeed || 1)) * timeMultiplier));
  }

  /**
   * Requirement rows with current progress, for both gating and display.
   * @param {CatalogEntity} entity
   * @param {{ buildings: object, research: object }} state
   * @returns {{ id: string, name: string, kind: 'building'|'research', required: number, current: number, met: boolean }[]}
   */
  researchNetwork(entity, state) {
    return selectResearchLabs(state.researchInfrastructure, entity?.requirements?.buildings?.researchLab);
  }

  requirementStatus(entity, state) {
    const rows = [];
    const groups = [['buildings', 'building', state.buildings || {}], ['research', 'research', state.research || {}]];
    const requirements = entity?.type === 'research' ? { ...entity.requirements, buildings: { ...entity.requirements?.buildings, researchLab: Math.max(1, entity.requirements?.buildings?.researchLab || 0) } } : entity?.requirements || {};
    for (const [group, kind, levels] of groups) {
      for (const [id, required] of Object.entries(requirements[group] || {})) {
        const current = entity?.type === 'research' && id === 'researchLab' ? (state.researchInfrastructure?.originLabLevel ?? levels[id] ?? 0) : levels[id] || 0;
        rows.push({ id, kind, name: this.get(kind, id)?.name || id, required, current, met: current >= required });
      }
    }
    return rows;
  }
}

export const catalog = new Catalog();
