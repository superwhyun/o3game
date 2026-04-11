/**
 * Cosmic Empire 3D - Game Data
 * OGame-style resource, building, research and fleet definitions
 */

// ========================================
// Resources
// ========================================
export const RESOURCES = {
  metal: {
    id: 'metal',
    name: '금속',
    icon: '⚙️',
    color: '#9ca3af',
    baseProduction: 30, // per hour at level 0
    description: '모든 건설의 기본 자원'
  },
  crystal: {
    id: 'crystal',
    name: '수정',
    icon: '💎',
    color: '#60a5fa',
    baseProduction: 15,
    description: '전자 부품 및 연구에 사용'
  },
  deuterium: {
    id: 'deuterium',
    name: '중수소',
    icon: '💧',
    color: '#34d399',
    baseProduction: 0,
    description: '함선 연료 및 고급 연구에 사용'
  },
  energy: {
    id: 'energy',
    name: '에너지',
    icon: '⚡',
    color: '#fbbf24',
    baseProduction: 0,
    description: '모든 건설에 필요한 동력'
  }
};

// ========================================
// Buildings
// ========================================
export const BUILDINGS = {
  // Resource Buildings
  metalMine: {
    id: 'metalMine',
    name: '금속 광산',
    icon: '⛏️',
    category: 'resources',
    description: '소행성에서 금속을 채굴합니다.',
    baseCost: { metal: 60, crystal: 15 },
    costMultiplier: 1.5,
    production: (level) => Math.floor(30 * level * Math.pow(1.1, level)),
    energyConsumption: (level) => Math.floor(10 * level * Math.pow(1.1, level)),
    buildTime: 60,
    maxLevel: 50
  },
  crystalMine: {
    id: 'crystalMine',
    name: '수정 광산',
    icon: '💎',
    category: 'resources',
    description: '고순도 수정을 채굴합니다.',
    baseCost: { metal: 48, crystal: 24 },
    costMultiplier: 1.6,
    production: (level) => Math.floor(20 * level * Math.pow(1.1, level)),
    energyConsumption: (level) => Math.floor(10 * level * Math.pow(1.1, level)),
    buildTime: 90,
    maxLevel: 50
  },
  deuteriumSynthesizer: {
    id: 'deuteriumSynthesizer',
    name: '중수소 합성기',
    icon: '💧',
    category: 'resources',
    description: '바다에서 중수소를 추출합니다. 행성 온도에 영향을 받습니다.',
    baseCost: { metal: 225, crystal: 75 },
    costMultiplier: 1.5,
    production: (level, planetTemp = 0) => {
      const baseProd = 10 * level * Math.pow(1.1, level);
      const tempBonus = 1.44 - 0.004 * planetTemp;
      return Math.floor(baseProd * tempBonus);
    },
    energyConsumption: (level) => Math.floor(20 * level * Math.pow(1.1, level)),
    buildTime: 120,
    maxLevel: 50
  },
  solarPlant: {
    id: 'solarPlant',
    name: '태양광 발전소',
    icon: '☀️',
    category: 'resources',
    description: '태양 에너지를 전기로 변환합니다.',
    baseCost: { metal: 75, crystal: 30 },
    costMultiplier: 1.5,
    energyProduction: (level) => Math.floor(20 * level * Math.pow(1.1, level)),
    buildTime: 60,
    maxLevel: 50
  },
  fusionReactor: {
    id: 'fusionReactor',
    name: '핵융합 발전소',
    icon: '⚛️',
    category: 'resources',
    description: '중수소를 사용하여 대량의 에너지를 생산합니다.',
    baseCost: { metal: 900, crystal: 360, deuterium: 180 },
    costMultiplier: 1.8,
    energyProduction: (level) => Math.floor(40 * level * Math.pow(1.05 + level * 0.01, level)),
    deuteriumConsumption: (level) => Math.floor(10 * level * Math.pow(1.1, level)),
    requirements: { energyTechnology: 3 },
    buildTime: 300,
    maxLevel: 30
  },

  // Facility Buildings
  robotFactory: {
    id: 'robotFactory',
    name: '로봇 공장',
    icon: '🤖',
    category: 'facilities',
    description: '건설 속도를 높이는 로봇을 생산합니다.',
    baseCost: { metal: 400, crystal: 120, deuterium: 200 },
    costMultiplier: 2,
    buildTimeBonus: (level) => Math.pow(0.9, level), // Each level reduces time by 10%
    buildTime: 180,
    maxLevel: 20
  },
  shipyard: {
    id: 'shipyard',
    name: '함선 공장',
    icon: '🚀',
    category: 'facilities',
    description: '모든 종류의 함선과 방어 시설을 건조합니다.',
    baseCost: { metal: 400, crystal: 200, deuterium: 100 },
    costMultiplier: 2,
    requirements: { robotFactory: 2 },
    buildTime: 180,
    maxLevel: 20
  },
  researchLab: {
    id: 'researchLab',
    name: '연구소',
    icon: '🔬',
    category: 'facilities',
    description: '새로운 기술을 연구합니다.',
    baseCost: { metal: 200, crystal: 400, deuterium: 200 },
    costMultiplier: 2,
    buildTime: 240,
    maxLevel: 20
  },
  naniteFactory: {
    id: 'naniteFactory',
    name: '나노 머신 공장',
    icon: '⚙️',
    category: 'facilities',
    description: '나노 머신으로 건설 속도를 극대화합니다.',
    baseCost: { metal: 1000000, crystal: 500000, deuterium: 100000 },
    costMultiplier: 2,
    requirements: { robotFactory: 10, computerTechnology: 10 },
    buildTimeBonus: (level) => Math.pow(0.5, level), // Each level halves the time
    buildTime: 1800,
    maxLevel: 10
  },
  metalStorage: {
    id: 'metalStorage',
    name: '금속 저장고',
    icon: '🏭',
    category: 'facilities',
    description: '금속 저장 용량을 늘립니다.',
    baseCost: { metal: 1000, crystal: 0, deuterium: 0 },
    costMultiplier: 2,
    storageCapacity: (level) => 10000 * Math.floor(2.5 * Math.exp(20 * level / 33)),
    buildTime: 60,
    maxLevel: 20
  },
  crystalStorage: {
    id: 'crystalStorage',
    name: '수정 저장고',
    icon: '🏛️',
    category: 'facilities',
    description: '수정 저장 용량을 늘립니다.',
    baseCost: { metal: 1000, crystal: 500, deuterium: 0 },
    costMultiplier: 2,
    storageCapacity: (level) => 10000 * Math.floor(2.5 * Math.exp(20 * level / 33)),
    buildTime: 60,
    maxLevel: 20
  },
  deuteriumTank: {
    id: 'deuteriumTank',
    name: '중수소 탱크',
    icon: '🛢️',
    category: 'facilities',
    description: '중수소 저장 용량을 늘립니다.',
    baseCost: { metal: 1000, crystal: 1000, deuterium: 0 },
    costMultiplier: 2,
    storageCapacity: (level) => 10000 * Math.floor(2.5 * Math.exp(20 * level / 33)),
    buildTime: 60,
    maxLevel: 20
  }
};

// ========================================
// Research
// ========================================
export const RESEARCH = {
  energyTechnology: {
    id: 'energyTechnology',
    name: '에너지 기술',
    icon: '⚡',
    description: '에너지 생산 및 무기 시스템의 기초',
    baseCost: { metal: 0, crystal: 800, deuterium: 400 },
    costMultiplier: 2,
    requirements: { researchLab: 1 },
    researchTime: 240,
    maxLevel: 25
  },
  laserTechnology: {
    id: 'laserTechnology',
    name: '레이저 기술',
    icon: '🔴',
    description: '레이저 무기 시스템 개발',
    baseCost: { metal: 200, crystal: 100, deuterium: 0 },
    costMultiplier: 2,
    requirements: { energyTechnology: 2, researchLab: 1 },
    researchTime: 300,
    maxLevel: 20
  },
  ionTechnology: {
    id: 'ionTechnology',
    name: '이온 기술',
    icon: '🔵',
    description: '이온 추진 및 무기 시스템',
    baseCost: { metal: 1000, crystal: 300, deuterium: 100 },
    costMultiplier: 2,
    requirements: { laserTechnology: 5, energyTechnology: 4, researchLab: 4 },
    researchTime: 600,
    maxLevel: 20
  },
  plasmaTechnology: {
    id: 'plasmaTechnology',
    name: '플라즈마 기술',
    icon: '🟣',
    description: '플라즈마 무기 및 고급 에너지 시스템',
    baseCost: { metal: 2000, crystal: 4000, deuterium: 1000 },
    costMultiplier: 2,
    requirements: { energyTechnology: 8, laserTechnology: 10, ionTechnology: 5, researchLab: 4 },
    researchTime: 1200,
    maxLevel: 20
  },
  combustionDrive: {
    id: 'combustionDrive',
    name: '연소 엔진',
    icon: '🔥',
    description: '화학 연료 추진 엔진. 소형/대형 수송선, 경전투기 속도 증가',
    baseCost: { metal: 400, crystal: 0, deuterium: 600 },
    costMultiplier: 2,
    requirements: { energyTechnology: 1, researchLab: 1 },
    researchTime: 180,
    speedBonus: (level) => level * 0.1, // 10% per level
    maxLevel: 25
  },
  impulseDrive: {
    id: 'impulseDrive',
    name: '충돌 엔진',
    icon: '⚡',
    description: '핵융합 추진 엔진. 중전투기, 폭격기, 순양함 속도 증가',
    baseCost: { metal: 2000, crystal: 4000, deuterium: 600 },
    costMultiplier: 2,
    requirements: { energyTechnology: 1, researchLab: 2 },
    researchTime: 360,
    speedBonus: (level) => level * 0.2, // 20% per level
    maxLevel: 25
  },
  hyperspaceDrive: {
    id: 'hyperspaceDrive',
    name: '하이퍼스페이스 엔진',
    icon: '🌌',
    description: '시공간을 왜곡하는 추진 엔진. 전함, 파괴함, 죽음의 별 속도 증가',
    baseCost: { metal: 10000, crystal: 20000, deuterium: 6000 },
    costMultiplier: 2,
    requirements: { hyperspaceTechnology: 3, researchLab: 7 },
    researchTime: 1800,
    speedBonus: (level) => level * 0.3, // 30% per level
    maxLevel: 25
  },
  hyperspaceTechnology: {
    id: 'hyperspaceTechnology',
    name: '하이퍼스페이스 기술',
    icon: '🌀',
    description: '하이퍼스페이스 여행의 기초',
    baseCost: { metal: 0, crystal: 4000, deuterium: 2000 },
    costMultiplier: 2,
    requirements: { energyTechnology: 5, shieldingTechnology: 5, researchLab: 7 },
    researchTime: 900,
    maxLevel: 20
  },
  espionageTechnology: {
    id: 'espionageTechnology',
    name: '첩보 기술',
    icon: '👁️',
    description: '정찰 정보 품질 향상',
    baseCost: { metal: 200, crystal: 1000, deuterium: 200 },
    costMultiplier: 2,
    requirements: { researchLab: 3 },
    researchTime: 300,
    maxLevel: 20
  },
  computerTechnology: {
    id: 'computerTechnology',
    name: '컴퓨터 기술',
    icon: '💻',
    description: '함대 명령 가능 수 증가',
    baseCost: { metal: 0, crystal: 400, deuterium: 600 },
    costMultiplier: 2,
    requirements: { researchLab: 1 },
    researchTime: 180,
    fleetSlots: (level) => level + 1,
    maxLevel: 25
  },
  astrophysics: {
    id: 'astrophysics',
    name: '천체물리학',
    icon: '🌠',
    description: '새로운 행성 개척 가능',
    baseCost: { metal: 4000, crystal: 8000, deuterium: 4000 },
    costMultiplier: 1.75,
    requirements: { espionageTechnology: 4, impulseDrive: 3, researchLab: 3 },
    researchTime: 1500,
    maxColonies: (level) => Math.floor((level + 1) / 2),
    maxLevel: 25
  },
  gravitonTechnology: {
    id: 'gravitonTechnology',
    name: '중력자 기술',
    icon: '⚫',
    description: '중력 조작 기술. 죽음의 별 건조 가능',
    baseCost: { energy: 300000 },
    costMultiplier: 3,
    requirements: { researchLab: 12 },
    researchTime: 1,
    maxLevel: 1
  },
  weaponsTechnology: {
    id: 'weaponsTechnology',
    name: '무기 기술',
    icon: '⚔️',
    description: '모든 함선 및 방어시설 공격력 증가',
    baseCost: { metal: 800, crystal: 200, deuterium: 0 },
    costMultiplier: 2,
    requirements: { researchLab: 4 },
    researchTime: 300,
    weaponBonus: (level) => level * 0.1, // 10% per level
    maxLevel: 25
  },
  shieldingTechnology: {
    id: 'shieldingTechnology',
    name: '방패 기술',
    icon: '🛡️',
    description: '모든 함선 및 방어시설 방패 강도 증가',
    baseCost: { metal: 200, crystal: 600, deuterium: 0 },
    costMultiplier: 2,
    requirements: { energyTechnology: 3, researchLab: 6 },
    researchTime: 360,
    shieldBonus: (level) => level * 0.1,
    maxLevel: 25
  },
  armorTechnology: {
    id: 'armorTechnology',
    name: '장갑 기술',
    icon: '🔩',
    description: '모든 함선 및 방어시설 장갑 증가',
    baseCost: { metal: 1000, crystal: 0, deuterium: 0 },
    costMultiplier: 2,
    requirements: { researchLab: 2 },
    researchTime: 240,
    armorBonus: (level) => level * 0.1,
    maxLevel: 25
  }
};

// ========================================
// Ships / Fleet
// ========================================
export const SHIPS = {
  // Civil Ships
  smallCargo: {
    id: 'smallCargo',
    name: '소형 수송선',
    icon: '📦',
    type: 'civil',
    description: '빠른 소량 수송',
    cost: { metal: 2000, crystal: 2000, deuterium: 0 },
    techRequirements: { combustionDrive: 2 },
    buildTime: 120,
    stats: {
      hull: 4000,
      shield: 10,
      attack: 5,
      cargo: 5000,
      speed: 5000,
      fuelConsumption: 10
    },
    rapidFire: {}
  },
  largeCargo: {
    id: 'largeCargo',
    name: '대형 수송선',
    icon: '🚢',
    type: 'civil',
    description: '대량 자원 수송',
    cost: { metal: 6000, crystal: 6000, deuterium: 0 },
    techRequirements: { combustionDrive: 6 },
    buildTime: 360,
    stats: {
      hull: 12000,
      shield: 25,
      attack: 5,
      cargo: 25000,
      speed: 7500,
      fuelConsumption: 50
    },
    rapidFire: {}
  },
  colonyShip: {
    id: 'colonyShip',
    name: '식민지 개척선',
    icon: '🌍',
    type: 'civil',
    description: '새로운 행성 개척',
    cost: { metal: 10000, crystal: 20000, deuterium: 10000 },
    techRequirements: { impulseDrive: 3 },
    buildTime: 1800,
    stats: {
      hull: 30000,
      shield: 100,
      attack: 50,
      cargo: 7500,
      speed: 2500,
      fuelConsumption: 1000
    },
    rapidFire: {}
  },
  recycler: {
    id: 'recycler',
    name: '수확선',
    icon: '♻️',
    type: 'civil',
    description: '전투 잔해 수거',
    cost: { metal: 10000, crystal: 6000, deuterium: 2000 },
    techRequirements: { combustionDrive: 6, shieldingTechnology: 2 },
    buildTime: 600,
    stats: {
      hull: 16000,
      shield: 10,
      attack: 1,
      cargo: 20000,
      speed: 2000,
      fuelConsumption: 300
    },
    rapidFire: {}
  },
  espionageProbe: {
    id: 'espionageProbe',
    name: '정찰 프로브',
    icon: '🛸',
    type: 'civil',
    description: '적 행성 정찰',
    cost: { metal: 0, crystal: 1000, deuterium: 0 },
    techRequirements: { espionageTechnology: 2 },
    buildTime: 30,
    stats: {
      hull: 1000,
      shield: 0,
      attack: 0,
      cargo: 5,
      speed: 100000000,
      fuelConsumption: 1
    },
    rapidFire: {}
  },
  solarSatellite: {
    id: 'solarSatellite',
    name: '태양광 위성',
    icon: '☀️',
    type: 'civil',
    description: '에너지 생산 (행성 위치에 따라 변동)',
    cost: { metal: 0, crystal: 2000, deuterium: 500 },
    techRequirements: {},
    buildTime: 60,
    stats: {
      hull: 2000,
      shield: 10,
      attack: 1,
      cargo: 0,
      speed: 0,
      fuelConsumption: 0
    },
    energyProduction: (position) => Math.floor((position % 10 + 1) * 20),
    rapidFire: {}
  },

  // Military Ships
  lightFighter: {
    id: 'lightFighter',
    name: '경전투기',
    icon: '🛩️',
    type: 'military',
    description: '빠른 공격 함선',
    cost: { metal: 3000, crystal: 1000, deuterium: 0 },
    techRequirements: { combustionDrive: 1 },
    buildTime: 180,
    stats: {
      hull: 4000,
      shield: 10,
      attack: 50,
      cargo: 50,
      speed: 12500,
      fuelConsumption: 20
    },
    rapidFire: { espionageProbe: 5, solarSatellite: 5 }
  },
  heavyFighter: {
    id: 'heavyFighter',
    name: '중전투기',
    icon: '✈️',
    type: 'military',
    description: '개량된 전투기',
    cost: { metal: 6000, crystal: 4000, deuterium: 0 },
    techRequirements: { armorTechnology: 2, impulseDrive: 2 },
    buildTime: 360,
    stats: {
      hull: 10000,
      shield: 25,
      attack: 150,
      cargo: 100,
      speed: 10000,
      fuelConsumption: 75
    },
    rapidFire: { smallCargo: 3, espionageProbe: 5, solarSatellite: 5 }
  },
  cruiser: {
    id: 'cruiser',
    name: '순양함',
    icon: '🚀',
    type: 'military',
    description: '경전투기에 강함',
    cost: { metal: 20000, crystal: 7000, deuterium: 2000 },
    techRequirements: { impulseDrive: 4, ionTechnology: 2 },
    buildTime: 600,
    stats: {
      hull: 27000,
      shield: 50,
      attack: 400,
      cargo: 800,
      speed: 15000,
      fuelConsumption: 300
    },
    rapidFire: { lightFighter: 6, espionageProbe: 5, solarSatellite: 5, rocketLauncher: 10 }
  },
  battleship: {
    id: 'battleship',
    name: '전함',
    icon: '🛰️',
    type: 'military',
    description: '강력한 화력',
    cost: { metal: 45000, crystal: 15000, deuterium: 0 },
    techRequirements: { hyperspaceDrive: 4 },
    buildTime: 1200,
    stats: {
      hull: 60000,
      shield: 200,
      attack: 1000,
      cargo: 1500,
      speed: 10000,
      fuelConsumption: 500
    },
    rapidFire: { espionageProbe: 5, solarSatellite: 5 }
  },
  battlecruiser: {
    id: 'battlecruiser',
    name: '전투순양함',
    icon: '🌟',
    type: 'military',
    description: '대형 함선에 강함',
    cost: { metal: 30000, crystal: 40000, deuterium: 15000 },
    techRequirements: { hyperspaceDrive: 5, laserTechnology: 12, hyperspaceTechnology: 5 },
    buildTime: 1500,
    stats: {
      hull: 70000,
      shield: 400,
      attack: 700,
      cargo: 750,
      speed: 10000,
      fuelConsumption: 250
    },
    rapidFire: { smallCargo: 3, largeCargo: 3, heavyFighter: 4, cruiser: 4, battleship: 7, espionageProbe: 5, solarSatellite: 5 }
  },
  bomber: {
    id: 'bomber',
    name: '폭격기',
    icon: '💣',
    type: 'military',
    description: '방어시설에 강함',
    cost: { metal: 50000, crystal: 25000, deuterium: 15000 },
    techRequirements: { impulseDrive: 6, plasmaTechnology: 5 },
    buildTime: 1800,
    stats: {
      hull: 75000,
      shield: 500,
      attack: 1000,
      cargo: 500,
      speed: 4000,
      fuelConsumption: 1000
    },
    rapidFire: { espionageProbe: 5, solarSatellite: 5, rocketLauncher: 20, lightLaser: 20, heavyLaser: 10, ionCannon: 10 }
  },
  destroyer: {
    id: 'destroyer',
    name: '파괴함',
    icon: '☄️',
    type: 'military',
    description: '순양함에 강함',
    cost: { metal: 60000, crystal: 50000, deuterium: 15000 },
    techRequirements: { hyperspaceDrive: 6, hyperspaceTechnology: 5 },
    buildTime: 2400,
    stats: {
      hull: 110000,
      shield: 500,
      attack: 2000,
      cargo: 2000,
      speed: 5000,
      fuelConsumption: 1000
    },
    rapidFire: { espionageProbe: 5, solarSatellite: 5, battlecruiser: 2 }
  },
  deathstar: {
    id: 'deathstar',
    name: '죽음의 별',
    icon: '🌑',
    type: 'military',
    description: '궁극의 무기',
    cost: { metal: 5000000, crystal: 4000000, deuterium: 1000000 },
    techRequirements: { hyperspaceDrive: 7, gravitonTechnology: 1, hyperspaceTechnology: 12 },
    buildTime: 28800,
    stats: {
      hull: 9000000,
      shield: 50000,
      attack: 200000,
      cargo: 1000000,
      speed: 100,
      fuelConsumption: 1
    },
    rapidFire: { 
      smallCargo: 250, largeCargo: 250, lightFighter: 200, heavyFighter: 100,
      cruiser: 33, battleship: 30, battlecruiser: 15, bomber: 25, destroyer: 5,
      espionageProbe: 1250, solarSatellite: 1250, rocketLauncher: 200,
      lightLaser: 200, heavyLaser: 100, gaussCannon: 50, ionCannon: 100,
      plasmaTurret: 50, smallShieldDome: 1, largeShieldDome: 1
    }
  }
};

// ========================================
// Defense
// ========================================
export const DEFENSE = {
  rocketLauncher: {
    id: 'rocketLauncher',
    name: '로켓 발사기',
    icon: '🎯',
    description: '기본 방어 시설',
    cost: { metal: 2000, crystal: 0, deuterium: 0 },
    buildTime: 60,
    stats: {
      hull: 2000,
      shield: 20,
      attack: 80
    }
  },
  lightLaser: {
    id: 'lightLaser',
    name: '경레이저 포',
    icon: '🔴',
    description: '레이저 방어 시설',
    cost: { metal: 1500, crystal: 500, deuterium: 0 },
    techRequirements: { energyTechnology: 1, laserTechnology: 3 },
    buildTime: 90,
    stats: {
      hull: 2000,
      shield: 25,
      attack: 100
    }
  },
  heavyLaser: {
    id: 'heavyLaser',
    name: '중레이저 포',
    icon: '🔴',
    description: '강화된 레이저 방어',
    cost: { metal: 6000, crystal: 2000, deuterium: 0 },
    techRequirements: { energyTechnology: 3, laserTechnology: 6 },
    buildTime: 180,
    stats: {
      hull: 8000,
      shield: 100,
      attack: 250
    }
  },
  gaussCannon: {
    id: 'gaussCannon',
    name: '가우스 포',
    icon: '⚡',
    description: '고성능 동포',
    cost: { metal: 20000, crystal: 15000, deuterium: 2000 },
    techRequirements: { energyTechnology: 6, weaponsTechnology: 3, shieldingTechnology: 1 },
    buildTime: 600,
    stats: {
      hull: 35000,
      shield: 200,
      attack: 1100
    }
  },
  ionCannon: {
    id: 'ionCannon',
    name: '이온 포',
    icon: '🔵',
    description: '이온 무기 방어',
    cost: { metal: 2000, crystal: 6000, deuterium: 0 },
    techRequirements: { ionTechnology: 4 },
    buildTime: 300,
    stats: {
      hull: 8000,
      shield: 500,
      attack: 150
    }
  },
  plasmaTurret: {
    id: 'plasmaTurret',
    name: '플라즈마 포탑',
    icon: '🟣',
    description: '최첨단 방어 무기',
    cost: { metal: 50000, crystal: 50000, deuterium: 30000 },
    techRequirements: { plasmaTechnology: 7 },
    buildTime: 1800,
    stats: {
      hull: 100000,
      shield: 300,
      attack: 3000
    }
  },
  smallShieldDome: {
    id: 'smallShieldDome',
    name: '소형 방패 돔',
    icon: '🛡️',
    description: '행성 방어 방패',
    cost: { metal: 10000, crystal: 10000, deuterium: 0 },
    techRequirements: { shieldingTechnology: 2 },
    buildTime: 1800,
    isUnique: true,
    stats: {
      hull: 20000,
      shield: 2000,
      attack: 1
    }
  },
  largeShieldDome: {
    id: 'largeShieldDome',
    name: '대형 방패 돔',
    icon: '🔰',
    description: '강화된 방어 방패',
    cost: { metal: 50000, crystal: 50000, deuterium: 0 },
    techRequirements: { shieldingTechnology: 6 },
    buildTime: 3600,
    isUnique: true,
    stats: {
      hull: 100000,
      shield: 10000,
      attack: 1
    }
  },
  antiBallisticMissile: {
    id: 'antiBallisticMissile',
    name: '요격 미사일',
    icon: '🚀',
    description: '공격 미사iel 요격',
    cost: { metal: 5000, crystal: 0, deuterium: 0 },
    buildTime: 30,
    stats: {}
  },
  interplanetaryMissile: {
    id: 'interplanetaryMissile',
    name: '행성간 미사일',
    icon: '🎆',
    description: '원격 공격 미사일',
    cost: { metal: 12500, crystal: 2500, deuterium: 10000 },
    techRequirements: { missileSilo: 4 },
    buildTime: 120,
    stats: {
      attack: 12000
    }
  }
};

// ========================================
// Helper Functions
// ========================================
export function calculateBuildingCost(buildingId, level) {
  const building = BUILDINGS[buildingId];
  if (!building) return null;
  
  const cost = {};
  for (const [resource, baseAmount] of Object.entries(building.baseCost)) {
    cost[resource] = Math.floor(baseAmount * Math.pow(building.costMultiplier, level - 1));
  }
  return cost;
}

export function calculateResearchCost(researchId, level) {
  const research = RESEARCH[researchId];
  if (!research) return null;
  
  const cost = {};
  for (const [resource, baseAmount] of Object.entries(research.baseCost)) {
    cost[resource] = Math.floor(baseAmount * Math.pow(research.costMultiplier, level));
  }
  return cost;
}

export function calculateShipCost(shipId, count = 1) {
  const ship = SHIPS[shipId];
  if (!ship) return null;
  
  const cost = {};
  for (const [resource, amount] of Object.entries(ship.cost)) {
    cost[resource] = amount * count;
  }
  return cost;
}

export function calculateDefenseCost(defenseId, count = 1) {
  const defense = DEFENSE[defenseId];
  if (!defense) return null;
  
  const cost = {};
  for (const [resource, amount] of Object.entries(defense.cost)) {
    cost[resource] = amount * count;
  }
  return cost;
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
