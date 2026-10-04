/** Visual tiers never change gameplay levels or commands. */
export const BUILDING_TIERS = [
  { min: 1, max: 9, name: '기초 시설' },
  { min: 10, max: 19, name: '확장 시설' },
  { min: 20, max: 29, name: '산업 단지' },
  { min: 30, max: Infinity, name: '통합 허브' },
];
export function buildingTier(level) {
  const n = Math.max(0, Number(level) || 0);
  return n >= 30 ? 3 : n >= 20 ? 2 : n >= 10 ? 1 : 0;
}
export function visualSpec(entity, level = 0, previewTier = null) {
  const type = entity.type;
  const tier = type === 'building' ? (previewTier ?? buildingTier(level)) : 0;
  return {
    ...entity.model,
    kind: type,
    archetype: entity.model?.archetype || entity.id,
    styleVersion: entity.model?.styleVersion || 1,
    tier: Math.min(3, Math.max(0, tier)),
    unbuilt: type === 'building' && level === 0 && previewTier === null,
  };
}
export function visualKey(entity, spec) {
  return `${entity.type}:${entity.id}:${JSON.stringify(spec)}`;
}
export const RESEARCH_EXHIBITS = {
  terraforming: ['행성 표면의 개발 가능 환경을 조성하는 실험 모형입니다.', '행성 지형 · 환경 조절 타워 · 생태 돔'],
  energyTechnology: [
    '에너지의 생성과 분배를 연구합니다.',
    '발전 코어 · 전력 링 · 측정 단자',
  ],
  laserTechnology: [
    '빛을 모아 정밀한 빔을 만드는 광학 장치입니다.',
    '발진기 · 집속 렌즈 · 시험 표적',
  ],
  ionTechnology: [
    '전하를 띤 입자를 가속하는 과정을 관찰합니다.',
    '전극 · 가속 통로 · 수집판',
  ],
  plasmaTechnology: [
    '고온 플라즈마를 자기장 안에 가두는 실험입니다.',
    '자기 코일 · 격납 챔버 · 플라즈마',
  ],
  combustionDrive: [
    '연료가 타면서 추진력을 만드는 엔진의 절개 모형입니다.',
    '연료 공급 · 연소실 · 노즐',
  ],
  impulseDrive: [
    '핵융합 에너지를 추진력으로 바꾸는 엔진입니다.',
    '융합 챔버 · 자기 코일 · 추진 노즐',
  ],
  hyperspaceDrive: [
    '공간 변형 장치와 추진 코어를 결합한 엔진 모형입니다.',
    '추진 코어 · 변형 링 · 엔진 노즐',
  ],
  hyperspaceTechnology: [
    '좌표와 공간의 연결을 탐구하는 실험 모형입니다.',
    '좌표 프레임 · 공간 격자 · 전이 링',
  ],
  espionageTechnology: [
    '미세한 신호를 수집하고 구별하는 센서 실험입니다.',
    '센서 어레이 · 분석 패널 · 탐지 표적',
  ],
  computerTechnology: [
    '대량의 명령을 처리하는 연산 장치입니다.',
    '연산 랙 · 냉각 장치 · 데이터 연결',
  ],
  astrophysics: [
    '천체의 위치와 궤도를 관측하는 장치입니다.',
    '망원경 · 관측축 · 궤도 모형',
  ],
  gravitonTechnology: [
    '시험 질량 주변의 중력 변화를 탐구하는 모형입니다.',
    '질량 시험체 · 다중 링 · 측정 챔버',
  ],
  weaponsTechnology: [
    '무기의 발사와 충격을 측정하는 시험대입니다.',
    '포신 · 시험 표적 · 계측 장치',
  ],
  shieldingTechnology: [
    '보호막의 형성과 충격 반응을 관찰합니다.',
    '발생기 · 방어막 · 충격 표적',
  ],
  armorTechnology: [
    '여러 겹의 장갑이 충격을 분산하는 과정을 연구합니다.',
    '장갑 단면 · 충격 장치 · 시험편',
  ],
};
