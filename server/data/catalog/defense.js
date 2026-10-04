/**
 * 방어시설 카탈로그 — 새 방어시설은 이 배열에 항목 하나를 추가하세요.
 * 필드 설명: ./schema.js
 */

module.exports = [
  {
    id: 'rocketLauncher',
    name: '로켓 발사기',
    icon: '🚀',
    category: 'defense',
    description: '기본 방어 시설',
    cost: { metal: 2000, crystal: 0, deuterium: 0 },
    buildTime: 60,
    requires: { buildings: { shipyard: 1 } },
    stats: { hull: 2000, shield: 20, attack: 80, isDefense: true }
  },

  {
    id: 'lightLaser',
    name: '경레이저',
    icon: '🔴',
    category: 'defense',
    description: '레이저 방어 시설',
    cost: { metal: 1500, crystal: 500, deuterium: 0 },
    buildTime: 60,
    requires: { buildings: { shipyard: 2 }, research: { laserTechnology: 3 } },
    stats: { hull: 2000, shield: 25, attack: 100, isDefense: true }
  },

  {
    id: 'heavyLaser',
    name: '중레이저',
    icon: '🟠',
    category: 'defense',
    description: '강화된 레이저 방어',
    cost: { metal: 6000, crystal: 2000, deuterium: 0 },
    buildTime: 120,
    requires: { buildings: { shipyard: 4 }, research: { laserTechnology: 6 } },
    stats: { hull: 8000, shield: 100, attack: 250, isDefense: true }
  },

  {
    id: 'gaussCannon',
    name: '가우스 캐논',
    icon: '🔫',
    category: 'defense',
    description: '고성능 동포',
    cost: { metal: 20000, crystal: 15000, deuterium: 2000 },
    buildTime: 300,
    requires: {
      buildings: { shipyard: 6 },
      research: { weaponsTechnology: 3, shieldingTechnology: 1 }
    },
    stats: { hull: 35000, shield: 200, attack: 1100, isDefense: true }
  },

  {
    id: 'ionCannon',
    name: '이온 캐논',
    icon: '🔵',
    category: 'defense',
    description: '이온 무기 방어',
    cost: { metal: 2000, crystal: 6000, deuterium: 0 },
    buildTime: 120,
    requires: { buildings: { shipyard: 4 }, research: { ionTechnology: 4 } },
    stats: { hull: 8000, shield: 500, attack: 150, isDefense: true }
  },

  {
    id: 'plasmaTurret',
    name: '플라즈마 포',
    icon: '🟣',
    category: 'defense',
    description: '최첨단 방어 무기',
    cost: { metal: 50000, crystal: 50000, deuterium: 30000 },
    buildTime: 600,
    requires: { buildings: { shipyard: 8 }, research: { plasmaTechnology: 7 } },
    stats: { hull: 100000, shield: 300, attack: 3000, isDefense: true }
  },

  {
    id: 'smallShieldDome',
    name: '소형 보호막 돔',
    icon: '🛡️',
    category: 'defense',
    description: '행성 방어 방패',
    cost: { metal: 10000, crystal: 10000, deuterium: 0 },
    buildTime: 300,
    requires: { buildings: { shipyard: 2 }, research: { shieldingTechnology: 2 } },
    stats: { hull: 20000, shield: 2000, attack: 1, isDefense: true }
  },

  {
    id: 'largeShieldDome',
    name: '대형 보호막 돔',
    icon: '💠',
    category: 'defense',
    description: '강화된 방어 방패',
    cost: { metal: 50000, crystal: 50000, deuterium: 0 },
    buildTime: 600,
    requires: { buildings: { shipyard: 6 }, research: { shieldingTechnology: 6 } },
    stats: { hull: 100000, shield: 10000, attack: 1, isDefense: true }
  }
];
