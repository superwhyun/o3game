/**
 * 연구 카탈로그 — 새 기술은 이 배열에 항목 하나를 추가하세요.
 * category: 'basic' | 'drive' | 'combat'
 * 필드 설명: ./schema.js
 */

module.exports = [
  {
    id: 'energyTechnology',
    name: '에너지 기술',
    icon: '⚡',
    category: 'basic',
    description: '에너지 생산 및 무기 시스템의 기초',
    cost: { metal: 0, crystal: 800, deuterium: 400 },
    costMultiplier: 2,
    buildTime: 240,
    requires: { buildings: { researchLab: 1 } }
  },

  {
    id: 'laserTechnology',
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
    name: '하이퍼스페이스 기술',
    icon: '🌀',
    category: 'basic',
    description: '하이퍼스페이스 여행의 기초',
    cost: { metal: 0, crystal: 4000, deuterium: 2000 },
    costMultiplier: 2,
    buildTime: 900
  },

  {
    id: 'espionageTechnology',
    name: '첩보 기술',
    icon: '🕵️',
    category: 'basic',
    description: '정찰 정보 품질 향상',
    cost: { metal: 200, crystal: 1000, deuterium: 200 },
    costMultiplier: 2,
    buildTime: 240
  },

  {
    id: 'computerTechnology',
    name: '컴퓨터 기술',
    icon: '💻',
    category: 'basic',
    description: '함대 명령 가능 수 증가',
    cost: { metal: 0, crystal: 400, deuterium: 600 },
    costMultiplier: 2,
    buildTime: 300
  },

  {
    id: 'astrophysics',
    name: '천체물리학',
    icon: '🔭',
    category: 'basic',
    description: '새로운 행성 개척 가능',
    cost: { metal: 4000, crystal: 8000, deuterium: 4000 },
    costMultiplier: 1.75,
    buildTime: 900
  },

  {
    id: 'gravitonTechnology',
    name: '중력자 기술',
    icon: '⚫',
    category: 'basic',
    description: '중력 조작 기술. 죽음의 별 건조 가능',
    cost: { metal: 0, crystal: 0, deuterium: 0 },
    costMultiplier: 3,
    buildTime: 1800
  },

  {
    id: 'weaponsTechnology',
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
    name: '장갑 기술',
    icon: '🧱',
    category: 'combat',
    description: '모든 함선 및 방어시설 장갑 증가',
    cost: { metal: 1000, crystal: 0, deuterium: 0 },
    costMultiplier: 2,
    buildTime: 240
  }
];
