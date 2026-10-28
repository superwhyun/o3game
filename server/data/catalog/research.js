/**
 * 연구 카탈로그 — 새 기술은 이 배열에 항목 하나를 추가하세요.
 * category: 'population' | 'planet' | 'combat' | 'drive'
 * 필드 설명: ./schema.js
 */

module.exports = [
  {
    id: 'urbanPlanning', name: '도시계획', icon: '🏙️', category: 'population',
    model: { kind: 'research', archetype: 'urbanPlanning', styleVersion: 1 },
    description: '현재 행성 주거시설의 수용량을 단계당 10% 높입니다.',
    cost: { metal: 500, crystal: 300, deuterium: 0 }, costMultiplier: 1.7, buildTime: 240,
    requires: { buildings: { researchLab: 1, housing: 1 } },
    effects: { population: { housingBonusPerLevel: 0.1 } }
  },
  {
    id: 'agriculturalTechnology', name: '농업기술', icon: '🌾', category: 'population',
    model: { kind: 'research', archetype: 'agriculturalTechnology', styleVersion: 1 },
    description: '현재 행성 수경농장의 식량 생산을 단계당 10% 높입니다.',
    cost: { metal: 300, crystal: 500, deuterium: 100 }, costMultiplier: 1.7, buildTime: 240,
    requires: { buildings: { researchLab: 1, hydroponicFarm: 1 } },
    effects: { population: { foodBonusPerLevel: 0.1 } }
  },
  {
    id: 'educationTechnology', name: '교육체계', icon: '🎓', category: 'population',
    model: { kind: 'research', archetype: 'educationTechnology', styleVersion: 1 },
    description: '현재 행성 교육원의 교육 수용량을 단계당 20% 높입니다.',
    cost: { metal: 300, crystal: 600, deuterium: 100 }, costMultiplier: 1.7, buildTime: 300,
    requires: { buildings: { researchLab: 1, school: 1 } },
    effects: { population: { knowledgeBonusPerLevel: 0.2 } }
  },
  {
    id: 'medicalTechnology', name: '의학', icon: '🧬', category: 'population',
    model: { kind: 'research', archetype: 'medicalTechnology', styleVersion: 1 },
    description: '현재 행성 의료센터의 의료 수용량을 단계당 20% 높입니다.',
    cost: { metal: 400, crystal: 500, deuterium: 200 }, costMultiplier: 1.7, buildTime: 300,
    requires: { buildings: { researchLab: 2, clinic: 1 } },
    effects: { population: { healthBonusPerLevel: 0.2 } }
  },
  {
    id: 'socialPolicy', name: '사회정책', icon: '🤝', category: 'population',
    model: { kind: 'research', archetype: 'socialPolicy', styleVersion: 1 },
    description: '현재 행성의 행복도를 단계당 2 높입니다. 행복도 상한은 100입니다.',
    cost: { metal: 400, crystal: 400, deuterium: 100 }, costMultiplier: 1.7, buildTime: 300,
    requires: { buildings: { researchLab: 1, cultureCenter: 1 } },
    effects: { population: { happinessPerLevel: 2 } }
  },
  {
    id: 'terraforming',
    model: { kind: 'research', archetype: 'terraforming', styleVersion: 1 }, name: '테라포밍', icon: '🌱', category: 'planet',
    description: '모든 소유 행성의 가용률을 단계당 2%p 늘립니다. 최대 30레벨, 가용률 상한 100%.',
    cost: { metal: 100000, crystal: 150000, deuterium: 100000 },
    costMultiplier: 1.6, buildTime: 7200,
    requires: { buildings: { researchLab: 10 }, research: { energyTechnology: 12, astrophysics: 4 } },
    effects: { usablePercentPerLevel: 2, maxLevel: 30 }
  },
  {
    id: 'energyTechnology',
    model: { kind: 'research', archetype: 'energyTechnology', styleVersion: 1 },
    name: '에너지 기술',
    icon: '⚡',
    category: 'planet',
    description: '에너지 생산 및 무기 시스템의 기초',
    cost: { metal: 0, crystal: 800, deuterium: 400 },
    costMultiplier: 2,
    buildTime: 240,
    requires: { buildings: { researchLab: 1 } }
  },

  {
    id: 'laserTechnology',
    model: { kind: 'research', archetype: 'laserTechnology', styleVersion: 1 },
    name: '레이저 기술',
    icon: '🔴',
    category: 'combat',
    description: '레이저 무기 시스템 개발',
    cost: { metal: 200, crystal: 100, deuterium: 0 },
    costMultiplier: 2,
    buildTime: 300,
    requires: { buildings: { researchLab: 1 }, research: { energyTechnology: 2 } }
  },

  {
    id: 'ionTechnology',
    model: { kind: 'research', archetype: 'ionTechnology', styleVersion: 1 },
    name: '이온 기술',
    icon: '🔵',
    category: 'combat',
    description: '이온 추진 및 무기 시스템',
    cost: { metal: 1000, crystal: 300, deuterium: 100 },
    costMultiplier: 2,
    buildTime: 600,
    requires: {
      buildings: { researchLab: 4 },
      research: { laserTechnology: 5, energyTechnology: 4 }
    }
  },

  {
    id: 'plasmaTechnology',
    model: { kind: 'research', archetype: 'plasmaTechnology', styleVersion: 1 },
    name: '플라즈마 기술',
    icon: '🟣',
    category: 'combat',
    description: '플라즈마 무기 및 고급 에너지 시스템',
    cost: { metal: 2000, crystal: 4000, deuterium: 1000 },
    costMultiplier: 2,
    buildTime: 1200,
    requires: {
      buildings: { researchLab: 4 },
      research: { energyTechnology: 8, laserTechnology: 10, ionTechnology: 5 }
    }
  },

  {
    id: 'combustionDrive',
    model: { kind: 'research', archetype: 'combustionDrive', styleVersion: 1 },
    name: '연소 엔진',
    icon: '🔥',
    category: 'drive',
    description: '화학 연료 추진 엔진. 소형/대형 수송선, 경전투기 속도 증가',
    cost: { metal: 400, crystal: 0, deuterium: 600 },
    costMultiplier: 2,
    buildTime: 180,
    requires: { buildings: { researchLab: 1 }, research: { energyTechnology: 1 } }
  },

  {
    id: 'impulseDrive',
    model: { kind: 'research', archetype: 'impulseDrive', styleVersion: 1 },
    name: '충돌 엔진',
    icon: '💨',
    category: 'drive',
    description: '핵융합 추진 엔진. 중전투기, 폭격기, 순양함 속도 증가',
    cost: { metal: 2000, crystal: 4000, deuterium: 600 },
    costMultiplier: 2,
    buildTime: 360,
    requires: { buildings: { researchLab: 2 }, research: { energyTechnology: 1 } }
  },

  {
    id: 'hyperspaceDrive',
    model: { kind: 'research', archetype: 'hyperspaceDrive', styleVersion: 1 },
    name: '하이퍼스페이스 엔진',
    icon: '🌌',
    category: 'drive',
    description: '시공간을 왜곡하는 추진 엔진. 전함, 파괴함, 죽음의 별 속도 증가',
    cost: { metal: 10000, crystal: 20000, deuterium: 6000 },
    costMultiplier: 2,
    buildTime: 1800,
    requires: {
      buildings: { researchLab: 7 },
      research: { energyTechnology: 5, shieldingTechnology: 5 }
    }
  },

  {
    id: 'hyperspaceTechnology',
    model: { kind: 'research', archetype: 'hyperspaceTechnology', styleVersion: 1 },
    name: '하이퍼스페이스 기술',
    icon: '🌀',
    category: 'drive',
    description: '하이퍼스페이스 여행의 기초',
    cost: { metal: 0, crystal: 4000, deuterium: 2000 },
    costMultiplier: 2,
    buildTime: 900
  },

  {
    id: 'espionageTechnology',
    model: { kind: 'research', archetype: 'espionageTechnology', styleVersion: 1 },
    name: '첩보 기술',
    icon: '🕵️',
    category: 'combat',
    description: '정찰 정보 품질 향상',
    cost: { metal: 200, crystal: 1000, deuterium: 200 },
    costMultiplier: 2,
    buildTime: 240
  },

  {
    id: 'computerTechnology',
    model: { kind: 'research', archetype: 'computerTechnology', styleVersion: 1 },
    name: '컴퓨터 기술',
    icon: '💻',
    category: 'planet',
    description: '함대 명령 가능 수 증가',
    cost: { metal: 0, crystal: 400, deuterium: 600 },
    costMultiplier: 2,
    buildTime: 300
  },

  {
    id: 'astrophysics',
    model: { kind: 'research', archetype: 'astrophysics', styleVersion: 1 },
    name: '천체물리학',
    icon: '🔭',
    category: 'planet',
    description: '새로운 행성 개척 가능',
    cost: { metal: 4000, crystal: 8000, deuterium: 4000 },
    costMultiplier: 1.75,
    buildTime: 900
  },

  {
    id: 'gravitonTechnology',
    model: { kind: 'research', archetype: 'gravitonTechnology', styleVersion: 1 },
    name: '중력자 기술',
    icon: '⚫',
    category: 'combat',
    description: '중력 조작 기술. 죽음의 별 건조 가능',
    cost: { metal: 0, crystal: 0, deuterium: 0 },
    costMultiplier: 3,
    buildTime: 1800
  },

  {
    id: 'weaponsTechnology',
    model: { kind: 'research', archetype: 'weaponsTechnology', styleVersion: 1 },
    name: '무기 기술',
    icon: '⚔️',
    category: 'combat',
    description: '모든 함선 및 방어시설 공격력 증가',
    cost: { metal: 800, crystal: 200, deuterium: 0 },
    costMultiplier: 2,
    buildTime: 300
  },

  {
    id: 'shieldingTechnology',
    model: { kind: 'research', archetype: 'shieldingTechnology', styleVersion: 1 },
    name: '보호막 기술',
    icon: '🛡️',
    category: 'combat',
    description: '모든 함선 및 방어시설 방패 강도 증가',
    cost: { metal: 200, crystal: 600, deuterium: 0 },
    costMultiplier: 2,
    buildTime: 360
  },

  {
    id: 'armorTechnology',
    model: { kind: 'research', archetype: 'armorTechnology', styleVersion: 1 },
    name: '장갑 기술',
    icon: '🧱',
    category: 'combat',
    description: '모든 함선 및 방어시설 장갑 증가',
    cost: { metal: 1000, crystal: 0, deuterium: 0 },
    costMultiplier: 2,
    buildTime: 240
  },
  {
    id: 'intergalacticResearchNetwork',
    name: '은하간 연구망', icon: '🔗', category: 'planet',
    description: '연구를 시작한 행성의 연구소에 다른 행성의 연구소를 자동 연결합니다. 레벨마다 1곳을 추가하며, 해당 연구의 최소 연구소 레벨을 충족하는 곳을 높은 레벨 순으로 선택합니다.',
    cost: { metal: 240000, crystal: 400000, deuterium: 160000 },
    costMultiplier: 2, buildTime: 3600,
    requires: { buildings: { researchLab: 10 }, research: { computerTechnology: 8, hyperspaceTechnology: 8 } },
    effects: { researchNetwork: { additionalLabsPerLevel: 1 } }
  }
];
