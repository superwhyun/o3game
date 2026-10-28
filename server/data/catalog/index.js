/**
 * Entity catalog entry point.
 *
 * To add a new building / research / ship / defense, append one spec object
 * to the matching file below — nothing else needs to change on the server
 * (User schema fields, queue handling, costs and the client catalog API are
 * all derived from these files). See ./schema.js for the spec fields.
 */

const path = require('path');
const { ENTITY_TYPES, specToDefinition, validateCatalog } = require('./schema');

const CATALOG_FILES = {
  building: {
    file: 'buildings.js',
    header: `/**
 * 건물 카탈로그 — 새 건물은 이 배열에 항목 하나를 추가하세요.
 * category: 'resources' | 'manufacturing' | 'population'
 * effects: production / energyProduction / energyConsumption / storage / constructionModifiers
 * 필드 설명: ./schema.js
 */`
  },
  research: {
    file: 'research.js',
    header: `/**
 * 연구 카탈로그 — 새 기술은 이 배열에 항목 하나를 추가하세요.
 * category: 'population' | 'planet' | 'combat' | 'drive'
 * 필드 설명: ./schema.js
 */`
  },
  ship: {
    file: 'ships.js',
    header: `/**
 * 함선 카탈로그 — 새 함선은 이 배열에 항목 하나를 추가하세요.
 * category: 'civil' | 'military'
 * model.hull: 'wedge' | 'lance' | 'fighter' | 'freighter' | 'colony' | 'probe' | 'satellite' | 'fortress'
 * model.faction: 'alliance' | 'empire' | 'civil' (도색), model.scale: 상대 크기
 * model 을 생략하면 category/스탯으로 3D 모델이 자동 선택됩니다.
 * 필드 설명: ./schema.js
 */`
  },
  defense: {
    file: 'defense.js',
    header: `/**
 * 방어시설 카탈로그 — 새 방어시설은 이 배열에 항목 하나를 추가하세요.
 * 필드 설명: ./schema.js
 */`
  }
};

function loadSpecs() {
  return Object.fromEntries(
    ENTITY_TYPES.map((entityType) => [entityType, require(path.join(__dirname, CATALOG_FILES[entityType].file))])
  );
}

const CATALOG_SPECS = loadSpecs();
validateCatalog(CATALOG_SPECS);

const ENTITY_CATALOG_DEFAULTS = ENTITY_TYPES.flatMap((entityType) =>
  CATALOG_SPECS[entityType].map((spec) => specToDefinition(entityType, spec))
);

/** @type {Record<string, string[]>} entity ids per type, in authoring order */
const ENTITY_IDS = Object.fromEntries(
  ENTITY_TYPES.map((entityType) => [entityType, CATALOG_SPECS[entityType].map((spec) => spec.id)])
);

module.exports = {
  CATALOG_DIR: __dirname,
  CATALOG_FILES,
  CATALOG_SPECS,
  ENTITY_CATALOG_DEFAULTS,
  ENTITY_IDS
};
