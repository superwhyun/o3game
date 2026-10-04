/**
 * 건물 카탈로그 — 새 건물은 이 배열에 항목 하나를 추가하세요.
 * category: 'resources' | 'facilities'
 * effects: production / energyProduction / energyConsumption / storage / constructionModifiers
 * 필드 설명: ./schema.js
 */

module.exports = [
  {
    id: 'metalMine',
    model: { kind: 'building', archetype: 'metalMine', styleVersion: 1 },
    name: '금속 광산',
    icon: '⛏️',
    category: 'resources',
    description: '소행성에서 금속을 채굴합니다.',
    cost: { metal: 60, crystal: 15, deuterium: 0 },
    costMultiplier: 1.5,
    buildTime: 60,
    effects: {
      production: { metal: { kind: 'scaled', coefficient: 30, growth: 1.1 } },
      energyConsumption: { amount: { kind: 'scaled', coefficient: 10, growth: 1.1 } }
    }
  },

  {
    id: 'crystalMine',
    model: { kind: 'building', archetype: 'crystalMine', styleVersion: 1 },
    name: '수정 광산',
    icon: '💎',
    category: 'resources',
    description: '고순도 수정을 채굴합니다.',
    cost: { metal: 48, crystal: 24, deuterium: 0 },
    costMultiplier: 1.6,
    buildTime: 90,
    effects: {
      production: { crystal: { kind: 'scaled', coefficient: 20, growth: 1.1 } },
      energyConsumption: { amount: { kind: 'scaled', coefficient: 10, growth: 1.1 } }
    }
  },

  {
    id: 'deuteriumSynthesizer',
    model: { kind: 'building', archetype: 'deuteriumSynthesizer', styleVersion: 1 },
    name: '중수소 합성기',
    icon: '⚗️',
    category: 'resources',
    description: '중수소를 추출합니다.',
    cost: { metal: 225, crystal: 75, deuterium: 0 },
    costMultiplier: 1.5,
    buildTime: 120,
    effects: {
      production: { deuterium: { kind: 'scaled', coefficient: 10, growth: 1.1 } },
      energyConsumption: { amount: { kind: 'scaled', coefficient: 20, growth: 1.1 } }
    }
  },

  {
    id: 'solarPlant',
    model: { kind: 'building', archetype: 'solarPlant', styleVersion: 1 },
    name: '태양광 발전소',
    icon: '☀️',
    category: 'resources',
    description: '태양 에너지를 전기로 변환합니다.',
    cost: { metal: 75, crystal: 30, deuterium: 0 },
    costMultiplier: 1.5,
    buildTime: 60,
    effects: {
      energyProduction: { amount: { kind: 'scaled', coefficient: 20, growth: 1.1 } }
    }
  },

  {
    id: 'fusionReactor',
    model: { kind: 'building', archetype: 'fusionReactor', styleVersion: 1 },
    name: '핵융합 발전소',
    icon: '⚛️',
    category: 'resources',
    description: '중수소를 소비해 에너지를 생산합니다.',
    cost: { metal: 900, crystal: 360, deuterium: 180 },
    costMultiplier: 1.8,
    buildTime: 300,
    requires: { research: { energyTechnology: 3 } },
    effects: {
      energyProduction: { amount: { kind: 'scaled', coefficient: 30, growth: 1.05 } }
    }
  },

  {
    id: 'robotFactory',
    model: { kind: 'building', archetype: 'robotFactory', styleVersion: 1 },
    name: '로봇 공장',
    icon: '🤖',
    category: 'facilities',
    description: '건설 속도를 높입니다.',
    cost: { metal: 400, crystal: 120, deuterium: 200 },
    costMultiplier: 2,
    buildTime: 180,
    effects: {
      constructionModifiers: [{ targetTypes: ['building'], mode: 'powerMultiplier', value: 0.9 }]
    }
  },

  {
    id: 'shipyard',
    model: { kind: 'building', archetype: 'shipyard', styleVersion: 1 },
    name: '함선 공장',
    icon: '🏭',
    category: 'facilities',
    description: '함선을 건조합니다.',
    cost: { metal: 400, crystal: 200, deuterium: 100 },
    costMultiplier: 2,
    buildTime: 180,
    requires: { buildings: { robotFactory: 2 } },
    effects: {
      constructionModifiers: [{ targetTypes: ['ship'], mode: 'linearDivider', value: 0.1, base: 1 }]
    }
  },

  {
    id: 'researchLab',
    model: { kind: 'building', archetype: 'researchLab', styleVersion: 1 },
    name: '연구소',
    icon: '🔬',
    category: 'facilities',
    description: '연구를 진행합니다.',
    cost: { metal: 200, crystal: 400, deuterium: 200 },
    costMultiplier: 2,
    buildTime: 240,
    effects: {
      constructionModifiers: [{ targetTypes: ['research'], mode: 'linearDivider', value: 0.1, base: 1 }]
    }
  },

  {
    id: 'naniteFactory',
    model: { kind: 'building', archetype: 'naniteFactory', styleVersion: 1 },
    name: '나노 머신 공장',
    icon: '🔧',
    category: 'facilities',
    description: '건설 속도를 극대화합니다.',
    cost: { metal: 1000000, crystal: 500000, deuterium: 100000 },
    costMultiplier: 2,
    buildTime: 1800,
    requires: { buildings: { robotFactory: 10 }, research: { computerTechnology: 10 } },
    effects: {
      constructionModifiers: [{ targetTypes: ['building', 'ship'], mode: 'powerMultiplier', value: 0.5 }]
    }
  },

  {
    id: 'metalStorage',
    model: { kind: 'building', archetype: 'metalStorage', styleVersion: 1 },
    name: '금속 저장고',
    icon: '📦',
    category: 'facilities',
    description: '금속 저장 용량을 늘립니다.',
    cost: { metal: 1000, crystal: 0, deuterium: 0 },
    costMultiplier: 2,
    buildTime: 60,
    effects: {
      storage: {
        metal: {
          kind: 'storage',
          base: 10000,
          multiplier: 2.5,
          exponentNumerator: 20,
          exponentDenominator: 33
        }
      }
    }
  },

  {
    id: 'crystalStorage',
    model: { kind: 'building', archetype: 'crystalStorage', styleVersion: 1 },
    name: '수정 저장고',
    icon: '📦',
    category: 'facilities',
    description: '수정 저장 용량을 늘립니다.',
    cost: { metal: 1000, crystal: 500, deuterium: 0 },
    costMultiplier: 2,
    buildTime: 60,
    effects: {
      storage: {
        crystal: {
          kind: 'storage',
          base: 10000,
          multiplier: 2.5,
          exponentNumerator: 20,
          exponentDenominator: 33
        }
      }
    }
  },

  {
    id: 'deuteriumTank',
    model: { kind: 'building', archetype: 'deuteriumTank', styleVersion: 1 },
    name: '중수소 탱크',
    icon: '🛢️',
    category: 'facilities',
    description: '중수소 저장 용량을 늘립니다.',
    cost: { metal: 1000, crystal: 1000, deuterium: 0 },
    costMultiplier: 2,
    buildTime: 60,
    effects: {
      storage: {
        deuterium: {
          kind: 'storage',
          base: 10000,
          multiplier: 2.5,
          exponentNumerator: 20,
          exponentDenominator: 33
        }
      }
    }
  }
];
