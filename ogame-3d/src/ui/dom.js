/** Small DOM/formatting helpers shared by UI views. */

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}일 ${h}시간`;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

export function formatAmount(value) {
  return Math.floor(value || 0).toLocaleString('ko-KR');
}

/** Korean labels for catalog categories; unknown categories fall back to the raw key. */
export const CATEGORY_LABELS = {
  resources: '자원',
  manufacturing: '제조',
  population: '인구',
  planet: '행성',
  facilities: '시설',
  basic: '기초',
  drive: '추진',
  combat: '전투',
  civil: '민간',
  military: '군용',
  defense: '방어'
};

export const TYPE_LABELS = {
  building: { title: '건설', hanja: '建設', action: '건설 명령' },
  research: { title: '연구', hanja: '硏究', action: '연구 개시' },
  ship: { title: '조병', hanja: '造兵', action: '건조 명령' },
  defense: { title: '방어', hanja: '防衛', action: '배치 명령' }
};

export const STAT_LABELS = {
  attack: '공격력',
  shield: '방어막',
  hull: '장갑',
  speed: '속도',
  cargo: '적재량',
  fuel: '연료 소모'
};

export const RESOURCE_LABELS = { metal: '금속', crystal: '수정', deuterium: '중수소', energy: '에너지', food: '식량' };
