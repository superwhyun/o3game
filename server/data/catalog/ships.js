/**
 * 함선 카탈로그 — 새 함선은 이 배열에 항목 하나를 추가하세요.
 * category: 'civil' | 'military'
 * model.hull: 'wedge' | 'lance' | 'fighter' | 'freighter' | 'colony' | 'probe' | 'satellite' | 'fortress'
 * model.faction: 'alliance' | 'empire' | 'civil' (도색), model.scale: 상대 크기
 * model 을 생략하면 category/스탯으로 3D 모델이 자동 선택됩니다.
 * 필드 설명: ./schema.js
 */

module.exports = [
  {
    id: 'smallCargo',
    name: '소형 화물선',
    icon: '🚚',
    category: 'civil',
    description: '빠른 소량 수송',
    cost: { metal: 2000, crystal: 2000, deuterium: 0 },
    buildTime: 120,
    requires: { buildings: { shipyard: 2 }, research: { combustionDrive: 2 } },
    stats: {
      hull: 4000,
      shield: 10,
      attack: 5,
      speed: 5000,
      cargo: 5000,
      fuel: 10,
      engineType: 'combustion',
      rapidFire: {}
    },
    model: { hull: 'freighter', faction: 'civil', scale: 0.9, pods: 2 }
  },

  {
    id: 'largeCargo',
    name: '대형 화물선',
    icon: '🚛',
    category: 'civil',
    description: '대량 자원 수송',
    cost: { metal: 6000, crystal: 6000, deuterium: 0 },
    buildTime: 300,
    requires: { buildings: { shipyard: 4 }, research: { combustionDrive: 6 } },
    stats: {
      hull: 12000,
      shield: 25,
      attack: 5,
      speed: 7500,
      cargo: 25000,
      fuel: 50,
      engineType: 'combustion',
      rapidFire: {}
    },
    model: { hull: 'freighter', faction: 'civil', scale: 1.4, pods: 4 }
  },

  {
    id: 'colonyShip',
    name: '식민선',
    icon: '🪐',
    category: 'civil',
    description: '새로운 행성 개척',
    cost: { metal: 10000, crystal: 20000, deuterium: 10000 },
    buildTime: 600,
    requires: { buildings: { shipyard: 4 }, research: { impulseDrive: 3 } },
    stats: {
      hull: 30000,
      shield: 100,
      attack: 50,
      speed: 2500,
      cargo: 7500,
      fuel: 1000,
      engineType: 'impulse',
      rapidFire: {}
    },
    model: { hull: 'colony', faction: 'civil', scale: 1.5 }
  },

  {
    id: 'recycler',
    name: '수확선',
    icon: '♻️',
    category: 'civil',
    description: '전투 잔해 수거',
    cost: { metal: 10000, crystal: 6000, deuterium: 2000 },
    buildTime: 300,
    requires: {
      buildings: { shipyard: 4 },
      research: { combustionDrive: 6, shieldingTechnology: 2 }
    },
    stats: {
      hull: 16000,
      shield: 10,
      attack: 1,
      speed: 2000,
      cargo: 20000,
      fuel: 300,
      engineType: 'combustion',
      rapidFire: {}
    },
    model: { hull: 'freighter', faction: 'civil', scale: 1.2, pods: 2, arms: true }
  },

  {
    id: 'espionageProbe',
    name: '정탐 드론',
    icon: '📡',
    category: 'civil',
    description: '적 행성 정찰',
    cost: { metal: 0, crystal: 1000, deuterium: 0 },
    buildTime: 60,
    requires: {
      buildings: { shipyard: 3 },
      research: { combustionDrive: 3, espionageTechnology: 2 }
    },
    stats: {
      hull: 1000,
      shield: 0,
      attack: 0,
      speed: 100000000,
      cargo: 0,
      fuel: 1,
      engineType: 'combustion',
      rapidFire: {}
    },
    model: { hull: 'probe', faction: 'civil', scale: 0.5 }
  },

  {
    id: 'solarSatellite',
    name: '태양광 인공위성',
    icon: '🛰️',
    category: 'civil',
    description: '에너지 생산 (행성 위치에 따라 변동)',
    cost: { metal: 0, crystal: 2000, deuterium: 500 },
    buildTime: 180,
    requires: { buildings: { shipyard: 1 } },
    stats: {
      hull: 2000,
      shield: 10,
      attack: 1,
      speed: 0,
      cargo: 0,
      fuel: 0,
      engineType: 'none',
      rapidFire: {}
    },
    model: { hull: 'satellite', faction: 'civil', scale: 0.8 }
  },

  {
    id: 'lightFighter',
    name: '경전투기',
    icon: '✈️',
    category: 'military',
    description: '빠른 공격 함선',
    cost: { metal: 3000, crystal: 1000, deuterium: 0 },
    buildTime: 120,
    requires: { buildings: { shipyard: 1 }, research: { combustionDrive: 1 } },
    stats: {
      hull: 4000,
      shield: 10,
      attack: 50,
      speed: 12500,
      cargo: 50,
      fuel: 20,
      engineType: 'combustion',
      rapidFire: { espionageProbe: 5, solarSatellite: 5 }
    },
    model: { hull: 'fighter', faction: 'alliance', scale: 0.55 }
  },

  {
    id: 'heavyFighter',
    name: '중전투기',
    icon: '🛩️',
    category: 'military',
    description: '개량된 전투기',
    cost: { metal: 6000, crystal: 4000, deuterium: 0 },
    buildTime: 300,
    requires: {
      buildings: { shipyard: 3 },
      research: { impulseDrive: 2, armorTechnology: 2 }
    },
    stats: {
      hull: 10000,
      shield: 25,
      attack: 150,
      speed: 10000,
      cargo: 100,
      fuel: 75,
      engineType: 'impulse',
      rapidFire: { smallCargo: 3, espionageProbe: 5, solarSatellite: 5 }
    },
    model: { hull: 'fighter', faction: 'empire', scale: 0.7, wings: 'swept' }
  },

  {
    id: 'cruiser',
    name: '순양함',
    icon: '🚢',
    category: 'military',
    description: '경전투기에 강함',
    cost: { metal: 20000, crystal: 7000, deuterium: 2000 },
    buildTime: 600,
    requires: { buildings: { shipyard: 5 }, research: { impulseDrive: 4, ionTechnology: 2 } },
    stats: {
      hull: 27000,
      shield: 50,
      attack: 400,
      speed: 15000,
      cargo: 800,
      fuel: 300,
      engineType: 'impulse',
      rapidFire: { lightFighter: 6, espionageProbe: 5, solarSatellite: 5, rocketLauncher: 10 }
    },
    model: { hull: 'wedge', faction: 'alliance', scale: 1.4, engines: 2 }
  },

  {
    id: 'battleship',
    name: '전함',
    icon: '🛳️',
    category: 'military',
    description: '강력한 화력',
    cost: { metal: 45000, crystal: 15000, deuterium: 0 },
    buildTime: 1200,
    requires: { buildings: { shipyard: 7 }, research: { hyperspaceDrive: 4 } },
    stats: {
      hull: 60000,
      shield: 200,
      attack: 1000,
      speed: 10000,
      cargo: 1500,
      fuel: 500,
      engineType: 'hyperspace',
      rapidFire: { espionageProbe: 5, solarSatellite: 5 }
    },
    model: { hull: 'wedge', faction: 'alliance', scale: 2, engines: 4 }
  },

  {
    id: 'battlecruiser',
    name: '전투순양함',
    icon: '⚔️',
    category: 'military',
    description: '대형 함선에 강함',
    cost: { metal: 30000, crystal: 40000, deuterium: 15000 },
    buildTime: 1800,
    requires: {
      buildings: { shipyard: 8 },
      research: { hyperspaceTechnology: 5, laserTechnology: 12 }
    },
    stats: {
      hull: 70000,
      shield: 400,
      attack: 700,
      speed: 10000,
      cargo: 750,
      fuel: 250,
      engineType: 'hyperspace',
      rapidFire: {
        smallCargo: 3,
        largeCargo: 3,
        heavyFighter: 4,
        cruiser: 4,
        battleship: 7,
        espionageProbe: 5,
        solarSatellite: 5
      }
    },
    model: { hull: 'lance', faction: 'empire', scale: 2.2, engines: 3 }
  },

  {
    id: 'bomber',
    name: '폭격기',
    icon: '💣',
    category: 'military',
    description: '방어시설에 강함',
    cost: { metal: 50000, crystal: 25000, deuterium: 15000 },
    buildTime: 2400,
    requires: {
      buildings: { shipyard: 8 },
      research: { impulseDrive: 6, plasmaTechnology: 5 }
    },
    stats: {
      hull: 75000,
      shield: 500,
      attack: 1000,
      speed: 4000,
      cargo: 500,
      fuel: 700,
      engineType: 'impulse',
      rapidFire: {
        espionageProbe: 5,
        solarSatellite: 5,
        rocketLauncher: 20,
        lightLaser: 20,
        heavyLaser: 10,
        ionCannon: 10
      }
    },
    model: { hull: 'lance', faction: 'empire', scale: 1.7, engines: 2, sponsons: 'heavy' }
  },

  {
    id: 'destroyer',
    name: '구축함',
    icon: '🚀',
    category: 'military',
    description: '순양함에 강함',
    cost: { metal: 60000, crystal: 50000, deuterium: 15000 },
    buildTime: 3000,
    requires: {
      buildings: { shipyard: 9 },
      research: { hyperspaceDrive: 6, hyperspaceTechnology: 5 }
    },
    stats: {
      hull: 110000,
      shield: 500,
      attack: 2000,
      speed: 5000,
      cargo: 2000,
      fuel: 1000,
      engineType: 'hyperspace',
      rapidFire: { espionageProbe: 5, solarSatellite: 5, battlecruiser: 2 }
    },
    model: { hull: 'wedge', faction: 'alliance', scale: 2.6, engines: 5, flagship: true }
  },

  {
    id: 'deathstar',
    name: '데스스타',
    icon: '🌑',
    category: 'military',
    description: '궁극의 무기',
    cost: { metal: 5000000, crystal: 4000000, deuterium: 1000000 },
    buildTime: 86400,
    requires: {
      buildings: { shipyard: 12 },
      research: { hyperspaceDrive: 7, gravitonTechnology: 1 }
    },
    stats: {
      hull: 9000000,
      shield: 50000,
      attack: 200000,
      speed: 100,
      cargo: 1000000,
      fuel: 1,
      engineType: 'hyperspace',
      rapidFire: {
        smallCargo: 250,
        largeCargo: 250,
        lightFighter: 200,
        heavyFighter: 100,
        cruiser: 33,
        battleship: 30,
        battlecruiser: 15,
        bomber: 25,
        destroyer: 5,
        espionageProbe: 1250,
        solarSatellite: 1250,
        rocketLauncher: 200,
        lightLaser: 200,
        heavyLaser: 100,
        gaussCannon: 50,
        ionCannon: 100,
        plasmaTurret: 50,
        smallShieldDome: 1,
        largeShieldDome: 1
      }
    },
    model: { hull: 'fortress', faction: 'empire', scale: 4 }
  }
];
