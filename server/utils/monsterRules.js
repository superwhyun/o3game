/**
 * Pure rules for event monsters: validation, damage state, combat wiring and payout shares.
 * A monster type is authored by an administrator; an event keeps a frozen copy of it.
 */
const { ENTITY_IDS } = require('../data/catalog');

const MAX_UNITS = 2000;
const MAX_UNIT_KINDS = 8;
const COMBAT_CLASSES = ['SWARM', 'HEAVY', 'SPLASH', 'CIVIL'];
const CATALOG_IDS = new Set([...ENTITY_IDS.ship, ...ENTITY_IDS.defense, ...ENTITY_IDS.building, ...ENTITY_IDS.research]);

class MonsterRuleError extends Error {
  constructor(message, code = 'INVALID_MONSTER') {
    super(message);
    this.name = 'MonsterRuleError';
    this.statusCode = 400;
    this.code = code;
  }
}

const bad = (message, code) => { throw new MonsterRuleError(message, code); };
const isInt = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const intOr = (value, fallback) => (value === undefined || value === null ? fallback : value);

const MAX_SHOT_MULTIPLIER = 6;

const MODEL_BODIES = ['orb', 'worm', 'crab', 'manta'];

/** Procedural 3D look of a monster; every field is optional and clamped to a safe range. */
function validateModel(input) {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) bad('모델 사양이 올바르지 않습니다.');
  const model = {};
  if (input.body !== undefined) {
    if (!MODEL_BODIES.includes(input.body)) bad(`모델 형태는 ${MODEL_BODIES.join(', ')} 중 하나여야 합니다.`);
    model.body = input.body;
  }
  if (input.color !== undefined) {
    if (typeof input.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.color)) bad('모델 색상은 #rrggbb 형식이어야 합니다.');
    model.color = input.color.toLowerCase();
  }
  for (const [key, min, max] of [['eyes', 0, 8], ['spikes', 0, 16], ['tentacles', 0, 10], ['seed', 0, 9999]]) {
    if (input[key] === undefined) continue;
    if (!isInt(input[key], min, max)) bad(`모델 ${key} 값은 ${min}~${max} 정수여야 합니다.`);
    model[key] = input[key];
  }
  if (Object.keys(input).some((key) => !(key in model))) bad('모델 사양에 알 수 없는 항목이 있습니다.');
  return model;
}

function validateMonsterType(input) {
  if (!input || typeof input !== 'object') bad('괴수 정의가 필요합니다.');
  const typeId = String(input.typeId ?? '');
  if (!/^[a-z][a-z0-9-]{2,40}$/.test(typeId)) bad('typeId는 영문 소문자로 시작하는 3~41자(소문자·숫자·-)여야 합니다.', 'INVALID_TYPE_ID');
  const name = String(input.name ?? '').trim();
  if (!name || name.length > 60) bad('이름은 1~60자여야 합니다.');
  const description = String(input.description ?? '').trim();
  if (description.length > 300) bad('설명은 300자 이하여야 합니다.');

  if (!Array.isArray(input.units) || input.units.length < 1 || input.units.length > MAX_UNIT_KINDS) bad(`유닛 종류는 1~${MAX_UNIT_KINDS}개여야 합니다.`);
  const seen = new Set();
  let total = 0;
  const units = input.units.map((unit, index) => {
    const where = `유닛 ${index + 1}`;
    const unitId = String(unit?.unitId ?? '');
    if (!/^[a-z][a-zA-Z0-9]{1,30}$/.test(unitId)) bad(`${where}: unitId가 올바르지 않습니다.`);
    if (CATALOG_IDS.has(unitId)) bad(`${where}: 카탈로그 항목과 같은 ID는 쓸 수 없습니다.`);
    if (seen.has(unitId)) bad(`${where}: unitId가 중복되었습니다.`);
    seen.add(unitId);
    const count = unit.count;
    if (!isInt(count, 1, MAX_UNITS)) bad(`${where}: 수량은 1~${MAX_UNITS}이어야 합니다.`);
    total += count;
    const stats = unit.stats || {};
    if (!isInt(stats.hull, 1, 1e12)) bad(`${where}: 장갑(hull)은 1 이상의 정수여야 합니다.`);
    if (!isInt(intOr(stats.shield, 0), 0, 1e9)) bad(`${where}: 방어막 값이 올바르지 않습니다.`);
    if (!isInt(intOr(stats.attack, 0), 0, 1e9)) bad(`${where}: 공격력 값이 올바르지 않습니다.`);
    const rapidFire = {};
    for (const [target, chance] of Object.entries(stats.rapidFire || {})) {
      if (!CATALOG_IDS.has(target) || typeof chance !== 'number' || !(chance >= 0 && chance <= 20)) bad(`${where}: 속사 설정이 올바르지 않습니다.`);
      rapidFire[target] = chance;
    }
    // The engine grants the extra shots per rapid-fire entry whatever the enemy fleet contains,
    // so the entries add up to a flat multiplier on the unit's volley. Keep that multiplier tunable.
    const shotMultiplier = 1 + Object.values(rapidFire).reduce((sum, chance) => sum + chance, 0);
    if (shotMultiplier > MAX_SHOT_MULTIPLIER) bad(`${where}: 속사 합계가 너무 큽니다. 한 번에 쏘는 평균 발수(1 + 속사 합)는 ${MAX_SHOT_MULTIPLIER} 이하여야 합니다. 괴수의 속사는 대상과 무관하게 모든 사격에 적용됩니다.`);
    const wave = intOr(unit.wave, 0);
    if (!isInt(wave, 0, 7)) bad(`${where}: 웨이브는 0~7이어야 합니다.`);
    const combatClass = unit.combatClass ?? 'HEAVY';
    if (!COMBAT_CLASSES.includes(combatClass)) bad(`${where}: 전투 분류가 올바르지 않습니다.`);
    const wreck = { metal: intOr(unit.wreck?.metal, 0), crystal: intOr(unit.wreck?.crystal, 0) };
    if (!isInt(wreck.metal, 0, 1e12) || !isInt(wreck.crystal, 0, 1e12)) bad(`${where}: 잔해 값이 올바르지 않습니다.`);
    return {
      unitId, name: String(unit.name ?? unitId).trim().slice(0, 60) || unitId, count, wave, combatClass, wreck,
      stats: { hull: stats.hull, shield: intOr(stats.shield, 0), attack: intOr(stats.attack, 0), rapidFire }
    };
  });
  if (total > MAX_UNITS) bad(`유닛 총 수는 ${MAX_UNITS}를 넘을 수 없습니다.`);

  const techs = {};
  for (const key of ['weapons', 'shield', 'armor']) {
    const value = intOr(input.techs?.[key], 0);
    if (!isInt(value, 0, 100)) bad('기술 수준은 0~100이어야 합니다.');
    techs[key] = value;
  }
  const regenPerHour = intOr(input.regenPerHour, 0);
  if (typeof regenPerHour !== 'number' || !(regenPerHour >= 0 && regenPerHour <= 100)) bad('재생률은 0~100이어야 합니다.');
  const defaultPoolMicro = String(intOr(input.defaultPoolMicro, '0'));
  if (!/^(0|[1-9][0-9]{0,17})$/.test(defaultPoolMicro)) bad('기본 보상 풀이 올바르지 않습니다.');
  const model = validateModel(input.model);
  return { typeId, name, description, units, techs, regenPerHour, defaultPoolMicro, model };
}

const hullOf = (stats, techs) => Math.floor(stats.hull * (1 + (techs?.armor || 0) * 0.1));

/** Undamaged state for a type snapshot. */
function initialState(snapshot) {
  return {
    units: snapshot.units.map((unit) => ({ unitId: unit.unitId, hulls: Array(unit.count).fill(hullOf(unit.stats, snapshot.techs)) })),
    lastRegenAt: null
  };
}

function maxHull(snapshot) {
  return snapshot.units.reduce((sum, unit) => sum + unit.count * hullOf(unit.stats, snapshot.techs), 0);
}
function remainingHull(state) {
  return state.units.reduce((sum, unit) => sum + unit.hulls.reduce((a, b) => a + Math.max(0, b), 0), 0);
}
function remainingCount(state) {
  return state.units.reduce((sum, unit) => sum + unit.hulls.length, 0);
}
/** Remaining health as a percentage with one decimal; never shows 0 while anything is alive. */
function hpPercent(snapshot, state) {
  const max = maxHull(snapshot);
  if (max <= 0) return 0;
  const alive = remainingCount(state) > 0;
  const value = Math.round((remainingHull(state) / max) * 1000) / 10;
  return alive ? Math.max(0.1, value) : 0;
}

/** Slow healing over time (percent of each unit's full hull per hour), capped at full. */
function applyRegen(snapshot, state, now) {
  const rate = snapshot.regenPerHour || 0;
  const last = state.lastRegenAt ? new Date(state.lastRegenAt) : null;
  if (!rate || !last) return { ...state, lastRegenAt: now };
  const hours = Math.max(0, (+now - +last) / 3_600_000);
  if (hours === 0) return state;
  const units = state.units.map((unit) => {
    const full = hullOf(snapshot.units.find((u) => u.unitId === unit.unitId).stats, snapshot.techs);
    const heal = (full * rate / 100) * hours;
    return { unitId: unit.unitId, hulls: unit.hulls.map((hull) => Math.min(full, hull + heal)) };
  });
  return { units, lastRegenAt: now };
}

/** Combat inputs for a monster in its current condition. */
function buildDefense(snapshot, state) {
  const waves = Array.from({ length: 8 }, () => ({ ships: {}, defense: {} }));
  const inlineUnits = {};
  for (const unit of snapshot.units) {
    const hulls = state.units.find((u) => u.unitId === unit.unitId)?.hulls || [];
    if (hulls.length === 0) continue;
    waves[unit.wave].ships[unit.unitId] = hulls.length;
    inlineUnits[unit.unitId] = { stats: { ...unit.stats, combatClass: unit.combatClass }, currentHull: hulls };
  }
  return { waves, inlineUnits };
}

/** New state after a battle: `remaining` maps unitId -> surviving hull values. */
function stateAfter(snapshot, state, remaining, now) {
  return {
    units: snapshot.units.map((unit) => ({
      unitId: unit.unitId,
      hulls: (remaining[unit.unitId] || []).map((hull) => Math.max(1, Math.round(hull)))
    })),
    lastRegenAt: now
  };
}

/** Wreckage value of the units destroyed between two states, before the debris ratio. */
function destroyedWreck(snapshot, before, after) {
  const total = { metal: 0, crystal: 0 };
  const destroyed = {};
  for (const unit of snapshot.units) {
    const was = before.units.find((u) => u.unitId === unit.unitId)?.hulls.length || 0;
    const now = after.units.find((u) => u.unitId === unit.unitId)?.hulls.length || 0;
    const lost = Math.max(0, was - now);
    if (lost > 0) destroyed[unit.unitId] = lost;
    total.metal += lost * unit.wreck.metal;
    total.crystal += lost * unit.wreck.crystal;
  }
  return { destroyed, wreck: total };
}

/**
 * Split a pool by damage. Each share rounds down, so the total never exceeds the pool.
 * @param {bigint} poolMicro @param {{ userId: string, damage: number }[]} entries
 */
function computeShares(poolMicro, entries) {
  const eligible = entries.filter((entry) => entry.damage > 0);
  const sum = eligible.reduce((total, entry) => total + BigInt(Math.floor(entry.damage)), 0n);
  if (sum === 0n || poolMicro <= 0n) return [];
  return eligible.map((entry) => ({ userId: entry.userId, rewardMicro: (poolMicro * BigInt(Math.floor(entry.damage))) / sum })).filter((share) => share.rewardMicro > 0n);
}

/** Small deterministic generator so a spawn choice can be reproduced from the event id. */
function seededRandom(seed) {
  let state = Array.from(String(seed)).reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 2166136261);
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let n = state;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

module.exports = {
  MAX_UNITS, MonsterRuleError, validateMonsterType, initialState, maxHull, remainingHull, remainingCount, hpPercent,
  applyRegen, buildDefense, stateAfter, destroyedWreck, computeShares, seededRandom, hullOf
};
