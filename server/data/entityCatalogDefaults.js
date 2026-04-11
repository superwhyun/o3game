const { BUILDING_DEFAULTS, SHIP_DEFAULTS, RESEARCH_DEFAULTS, DEFENSE_DEFAULTS } = require('./entityDefaults');

const BUILDING_DISPLAY = {
  metalMine: { name: '금속 광산', icon: '⛏️', category: 'resources', description: '소행성에서 금속을 채굴합니다.' },
  crystalMine: { name: '수정 광산', icon: '💎', category: 'resources', description: '고순도 수정을 채굴합니다.' },
  deuteriumSynthesizer: { name: '중수소 합성기', icon: '⚗️', category: 'resources', description: '중수소를 추출합니다.' },
  solarPlant: { name: '태양광 발전소', icon: '☀️', category: 'resources', description: '태양 에너지를 전기로 변환합니다.' },
  fusionReactor: { name: '핵융합 발전소', icon: '⚛️', category: 'resources', description: '중수소를 소비해 에너지를 생산합니다.' },
  robotFactory: { name: '로봇 공장', icon: '🤖', category: 'facilities', description: '건설 속도를 높입니다.' },
  shipyard: { name: '함선 공장', icon: '🏭', category: 'facilities', description: '함선을 건조합니다.' },
  researchLab: { name: '연구소', icon: '🔬', category: 'facilities', description: '연구를 진행합니다.' },
  naniteFactory: { name: '나노 머신 공장', icon: '🔧', category: 'facilities', description: '건설 속도를 극대화합니다.' },
  metalStorage: { name: '금속 저장고', icon: '📦', category: 'facilities', description: '금속 저장 용량을 늘립니다.' },
  crystalStorage: { name: '수정 저장고', icon: '📦', category: 'facilities', description: '수정 저장 용량을 늘립니다.' },
  deuteriumTank: { name: '중수소 탱크', icon: '🛢️', category: 'facilities', description: '중수소 저장 용량을 늘립니다.' }
};

const RESEARCH_DISPLAY = {
  energyTechnology: { name: '에너지 기술', icon: '⚡' },
  laserTechnology: { name: '레이저 기술', icon: '🔴' },
  ionTechnology: { name: '이온 기술', icon: '🔵' },
  plasmaTechnology: { name: '플라즈마 기술', icon: '🟣' },
  combustionDrive: { name: '연소 엔진', icon: '🔥' },
  impulseDrive: { name: '충돌 엔진', icon: '💨' },
  hyperspaceDrive: { name: '하이퍼스페이스 엔진', icon: '🌌' },
  hyperspaceTechnology: { name: '하이퍼스페이스 기술', icon: '🌀' },
  espionageTechnology: { name: '첩보 기술', icon: '🕵️' },
  computerTechnology: { name: '컴퓨터 기술', icon: '💻' },
  astrophysics: { name: '천체물리학', icon: '🔭' },
  gravitonTechnology: { name: '중력자 기술', icon: '⚫' },
  weaponsTechnology: { name: '무기 기술', icon: '⚔️' },
  shieldingTechnology: { name: '보호막 기술', icon: '🛡️' },
  armorTechnology: { name: '장갑 기술', icon: '🧱' }
};

const SHIP_DISPLAY = {
  smallCargo: { name: '소형 화물선', icon: '🚚', category: 'civil' },
  largeCargo: { name: '대형 화물선', icon: '🚛', category: 'civil' },
  colonyShip: { name: '식민선', icon: '🪐', category: 'civil' },
  recycler: { name: '수확선', icon: '♻️', category: 'civil' },
  espionageProbe: { name: '정탐 드론', icon: '📡', category: 'civil' },
  solarSatellite: { name: '태양광 인공위성', icon: '🛰️', category: 'civil' },
  lightFighter: { name: '경전투기', icon: '✈️', category: 'military' },
  heavyFighter: { name: '중전투기', icon: '🛩️', category: 'military' },
  cruiser: { name: '순양함', icon: '🚢', category: 'military' },
  battleship: { name: '전함', icon: '🛳️', category: 'military' },
  battlecruiser: { name: '전투순양함', icon: '⚔️', category: 'military' },
  bomber: { name: '폭격기', icon: '💣', category: 'military' },
  destroyer: { name: '구축함', icon: '🚀', category: 'military' },
  deathstar: { name: '데스스타', icon: '🌑', category: 'military' }
};

const DEFENSE_DISPLAY = {
  rocketLauncher: { name: '로켓 발사기', icon: '🚀', category: 'defense' },
  lightLaser: { name: '경레이저', icon: '🔴', category: 'defense' },
  heavyLaser: { name: '중레이저', icon: '🟠', category: 'defense' },
  gaussCannon: { name: '가우스 캐논', icon: '🔫', category: 'defense' },
  ionCannon: { name: '이온 캐논', icon: '🔵', category: 'defense' },
  plasmaTurret: { name: '플라즈마 포', icon: '🟣', category: 'defense' },
  smallShieldDome: { name: '소형 보호막 돔', icon: '🛡️', category: 'defense' },
  largeShieldDome: { name: '대형 보호막 돔', icon: '💠', category: 'defense' }
};

const BUILDING_REQUIREMENTS = {
  fusionReactor: { research: { energyTechnology: 3 } },
  shipyard: { buildings: { robotFactory: 2 } },
  naniteFactory: { buildings: { robotFactory: 10 }, research: { computerTechnology: 10 } }
};

const RESEARCH_REQUIREMENTS = {
  energyTechnology: { buildings: { researchLab: 1 } },
  laserTechnology: { buildings: { researchLab: 1 }, research: { energyTechnology: 2 } },
  ionTechnology: { buildings: { researchLab: 4 }, research: { laserTechnology: 5, energyTechnology: 4 } },
  plasmaTechnology: { buildings: { researchLab: 4 }, research: { energyTechnology: 8, laserTechnology: 10, ionTechnology: 5 } },
  combustionDrive: { buildings: { researchLab: 1 }, research: { energyTechnology: 1 } },
  impulseDrive: { buildings: { researchLab: 2 }, research: { energyTechnology: 1 } },
  hyperspaceDrive: { buildings: { researchLab: 7 }, research: { energyTechnology: 5, shieldingTechnology: 5 } }
};

const SHIP_REQUIREMENTS = {
  smallCargo: { buildings: { shipyard: 2 }, research: { combustionDrive: 2 } },
  largeCargo: { buildings: { shipyard: 4 }, research: { combustionDrive: 6 } },
  colonyShip: { buildings: { shipyard: 4 }, research: { impulseDrive: 3 } },
  recycler: { buildings: { shipyard: 4 }, research: { combustionDrive: 6, shieldingTechnology: 2 } },
  espionageProbe: { buildings: { shipyard: 3 }, research: { combustionDrive: 3, espionageTechnology: 2 } },
  solarSatellite: { buildings: { shipyard: 1 } },
  lightFighter: { buildings: { shipyard: 1 }, research: { combustionDrive: 1 } },
  heavyFighter: { buildings: { shipyard: 3 }, research: { impulseDrive: 2, armorTechnology: 2 } },
  cruiser: { buildings: { shipyard: 5 }, research: { impulseDrive: 4, ionTechnology: 2 } },
  battleship: { buildings: { shipyard: 7 }, research: { hyperspaceDrive: 4 } },
  battlecruiser: { buildings: { shipyard: 8 }, research: { hyperspaceTechnology: 5, laserTechnology: 12 } },
  bomber: { buildings: { shipyard: 8 }, research: { impulseDrive: 6, plasmaTechnology: 5 } },
  destroyer: { buildings: { shipyard: 9 }, research: { hyperspaceDrive: 6, hyperspaceTechnology: 5 } },
  deathstar: { buildings: { shipyard: 12 }, research: { hyperspaceDrive: 7, gravitonTechnology: 1 } }
};

const DEFENSE_REQUIREMENTS = {
  rocketLauncher: { buildings: { shipyard: 1 } },
  lightLaser: { buildings: { shipyard: 2 }, research: { laserTechnology: 3 } },
  heavyLaser: { buildings: { shipyard: 4 }, research: { laserTechnology: 6 } },
  gaussCannon: { buildings: { shipyard: 6 }, research: { weaponsTechnology: 3, shieldingTechnology: 1 } },
  ionCannon: { buildings: { shipyard: 4 }, research: { ionTechnology: 4 } },
  plasmaTurret: { buildings: { shipyard: 8 }, research: { plasmaTechnology: 7 } },
  smallShieldDome: { buildings: { shipyard: 2 }, research: { shieldingTechnology: 2 } },
  largeShieldDome: { buildings: { shipyard: 6 }, research: { shieldingTechnology: 6 } }
};

const SHIP_STATS = {
  smallCargo: { hull: 4000, shield: 10, attack: 5, speed: 5000, rapidFire: {} },
  largeCargo: { hull: 12000, shield: 25, attack: 5, speed: 7500, rapidFire: {} },
  colonyShip: { hull: 30000, shield: 100, attack: 50, speed: 2500, rapidFire: {} },
  recycler: { hull: 16000, shield: 10, attack: 1, speed: 2000, rapidFire: {} },
  espionageProbe: { hull: 1000, shield: 0, attack: 0, speed: 100000000, rapidFire: {} },
  solarSatellite: { hull: 2000, shield: 10, attack: 1, speed: 0, rapidFire: {} },
  lightFighter: { hull: 4000, shield: 10, attack: 50, speed: 12500, rapidFire: { espionageProbe: 5, solarSatellite: 5 } },
  heavyFighter: { hull: 10000, shield: 25, attack: 150, speed: 10000, rapidFire: { smallCargo: 3, espionageProbe: 5, solarSatellite: 5 } },
  cruiser: { hull: 27000, shield: 50, attack: 400, speed: 15000, rapidFire: { lightFighter: 6, espionageProbe: 5, solarSatellite: 5, rocketLauncher: 10 } },
  battleship: { hull: 60000, shield: 200, attack: 1000, speed: 10000, rapidFire: { espionageProbe: 5, solarSatellite: 5 } },
  battlecruiser: { hull: 70000, shield: 400, attack: 700, speed: 10000, rapidFire: { smallCargo: 3, largeCargo: 3, heavyFighter: 4, cruiser: 4, battleship: 7, espionageProbe: 5, solarSatellite: 5 } },
  bomber: { hull: 75000, shield: 500, attack: 1000, speed: 4000, rapidFire: { espionageProbe: 5, solarSatellite: 5, rocketLauncher: 20, lightLaser: 20, heavyLaser: 10, ionCannon: 10 } },
  destroyer: { hull: 110000, shield: 500, attack: 2000, speed: 5000, rapidFire: { espionageProbe: 5, solarSatellite: 5, battlecruiser: 2 } },
  deathstar: { hull: 9000000, shield: 50000, attack: 200000, speed: 100, rapidFire: { smallCargo: 250, largeCargo: 250, lightFighter: 200, heavyFighter: 100, cruiser: 33, battleship: 30, battlecruiser: 15, bomber: 25, destroyer: 5, espionageProbe: 1250, solarSatellite: 1250, rocketLauncher: 200, lightLaser: 200, heavyLaser: 100, gaussCannon: 50, ionCannon: 100, plasmaTurret: 50, smallShieldDome: 1, largeShieldDome: 1 } }
};

const DEFENSE_STATS = {
  rocketLauncher: { hull: 2000, shield: 20, attack: 80, isDefense: true },
  lightLaser: { hull: 2000, shield: 25, attack: 100, isDefense: true },
  heavyLaser: { hull: 8000, shield: 100, attack: 250, isDefense: true },
  gaussCannon: { hull: 35000, shield: 200, attack: 1100, isDefense: true },
  ionCannon: { hull: 8000, shield: 500, attack: 150, isDefense: true },
  plasmaTurret: { hull: 100000, shield: 300, attack: 3000, isDefense: true },
  smallShieldDome: { hull: 20000, shield: 2000, attack: 1, isDefense: true },
  largeShieldDome: { hull: 100000, shield: 10000, attack: 1, isDefense: true }
};

const BUILDING_EFFECTS = {
  metalMine: {
    production: {
      metal: { kind: 'scaled', coefficient: 30, growth: 1.1 }
    },
    energyConsumption: {
      amount: { kind: 'scaled', coefficient: 10, growth: 1.1 }
    }
  },
  crystalMine: {
    production: {
      crystal: { kind: 'scaled', coefficient: 20, growth: 1.1 }
    },
    energyConsumption: {
      amount: { kind: 'scaled', coefficient: 10, growth: 1.1 }
    }
  },
  deuteriumSynthesizer: {
    production: {
      deuterium: { kind: 'scaled', coefficient: 10, growth: 1.1 }
    },
    energyConsumption: {
      amount: { kind: 'scaled', coefficient: 20, growth: 1.1 }
    }
  },
  solarPlant: {
    energyProduction: {
      amount: { kind: 'scaled', coefficient: 20, growth: 1.1 }
    }
  },
  fusionReactor: {
    energyProduction: {
      amount: { kind: 'scaled', coefficient: 30, growth: 1.05 }
    }
  },
  robotFactory: {
    constructionModifiers: [
      { targetTypes: ['building'], mode: 'powerMultiplier', value: 0.9 }
    ]
  },
  shipyard: {
    constructionModifiers: [
      { targetTypes: ['ship'], mode: 'linearDivider', value: 0.1, base: 1 }
    ]
  },
  researchLab: {
    constructionModifiers: [
      { targetTypes: ['research'], mode: 'linearDivider', value: 0.1, base: 1 }
    ]
  },
  naniteFactory: {
    constructionModifiers: [
      { targetTypes: ['building', 'ship'], mode: 'powerMultiplier', value: 0.5 }
    ]
  },
  metalStorage: {
    storage: {
      metal: { kind: 'storage', base: 10000, multiplier: 2.5, exponentNumerator: 20, exponentDenominator: 33 }
    }
  },
  crystalStorage: {
    storage: {
      crystal: { kind: 'storage', base: 10000, multiplier: 2.5, exponentNumerator: 20, exponentDenominator: 33 }
    }
  },
  deuteriumTank: {
    storage: {
      deuterium: { kind: 'storage', base: 10000, multiplier: 2.5, exponentNumerator: 20, exponentDenominator: 33 }
    }
  }
};

function defaultTierMultipliers() {
  return Array.from({ length: 10 }, (_, index) => ({
    startLevel: index * 10 + 1,
    endLevel: index * 10 + 10,
    costMult: null,
    timeMult: null
  }));
}

function normalizeDefaults(entityType, defaults, displayMap, requirementsMap = {}, effectsMap = {}, statsMap = {}) {
  return Object.entries(defaults).map(([entityId, def]) => ({
    entityType,
    entityId,
    status: 'active',
    schemaVersion: 2,
    revision: 1,
    display: {
      name: displayMap[entityId]?.name || entityId,
      icon: displayMap[entityId]?.icon || '',
      category: displayMap[entityId]?.category || '',
      description: displayMap[entityId]?.description || ''
    },
    requirements: requirementsMap[entityId] || {},
    costModel: {
      baseCost: {
        metal: def.baseCost?.metal || 0,
        crystal: def.baseCost?.crystal || 0,
        deuterium: def.baseCost?.deuterium || 0
      },
      costMultiplier: def.costMultiplier ?? null,
      scalingMode: 'exponential',
      tierMultipliers: defaultTierMultipliers()
    },
    timeModel: {
      baseTime: def.buildTime ?? null,
      timeMultiplier: def.costMultiplier ?? null,
      scalingMode: 'exponential',
      tierMultipliers: defaultTierMultipliers()
    },
    effects: effectsMap[entityId] || {},
    stats: statsMap[entityId] || {},
    metadata: { seeded: true }
  }));
}

const ENTITY_CATALOG_DEFAULTS = [
  ...normalizeDefaults('building', BUILDING_DEFAULTS, BUILDING_DISPLAY, BUILDING_REQUIREMENTS, BUILDING_EFFECTS, {}),
  ...normalizeDefaults('research', RESEARCH_DEFAULTS, RESEARCH_DISPLAY, RESEARCH_REQUIREMENTS, {}, {}),
  ...normalizeDefaults('ship', SHIP_DEFAULTS, SHIP_DISPLAY, SHIP_REQUIREMENTS, {}, SHIP_STATS),
  ...normalizeDefaults('defense', DEFENSE_DEFAULTS, DEFENSE_DISPLAY, DEFENSE_REQUIREMENTS, {}, DEFENSE_STATS)
];

module.exports = {
  ENTITY_CATALOG_DEFAULTS
};
