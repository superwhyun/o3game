import { escapeHtml, formatAmount, formatDuration } from '../dom.js';

export const POPULATION_SETTING_LABELS = {
  initialPopulation: '초기 인구', initialHousingExtra: '초기 주거 여유',
  initialFoodHours: '초기 식량 지급 시간', foodStorage: '기본 식량 저장량',
  foodConsumptionPerPopulation: '인구당 시간당 식량 소비', growthHours: '인구 1 성장 시간',
  minimumGrowthHappiness: '성장 최소 행복도', baseHappiness: '기본 행복도',
  cultureHappinessRange: '문화 행복도 영향', overcrowdingPenalty: '주거 부족 최대 불이익',
  starvationPenalty: '식량 고갈 불이익', stabilitySensitivity: '행복도의 안정도 영향',
  productionSensitivity: '안정도당 생산 배율 변화'
};
const number = n => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
const signed = n => `${n >= 0 ? '+' : ''}${number(n)}`;
const row = (label, value) => `<div class="spec-row"><dt>${label}</dt><dd>${value}</dd></div>`;
export function renderPopulationDetails(state) {
  const p = state.planet.populationState;
  if (!p) return '<p>인구 정보를 불러오는 중입니다.</p>';
  const reasons = p.happinessReasons;
  const jobs = Object.values(p.jobs).map(job => `<tr><td>${escapeHtml(job.name)}</td><td>${number(job.assigned)} / ${number(job.required)}</td><td>${Math.round(job.ratio * 100)}%</td></tr>`).join('');
  const summary = `<h3>${escapeHtml(state.planet.name)} · 주민 생활</h3>
    <dl class="spec-list">
      ${row('인구 / 주거', `${formatAmount(p.count)} / ${formatAmount(p.housing)}`)}
      ${row('함대 배치 인구', formatAmount(state.planet.fleetSupport?.crew || 0))}
      ${row('취업 / 미배치', `${number(p.employed)} / ${number(p.unemployed)}`)}
      ${row('행복도 / 안정도', `${number(p.happiness)} / ${number(p.stability)}`)}
      ${row('지식 / 건강', `${number(p.knowledge)} / ${number(p.health)}`)}
      ${row('자원 생산 배율', `${Math.round(p.productionMultiplier * 100)}%`)}
      ${row('행복·안정 효과 × 지식 효과', `${number((p.happinessMultiplier ?? p.productionMultiplier) * 100)}% × ${number((p.knowledgeMultiplier ?? 1) * 100)}%`)}
    </dl>
    <h3>인구 성장</h3>
    <progress value="${p.growthProgress}" max="1" aria-label="인구 성장 진행률"></progress>
    <p>${Math.round(p.growthProgress * 100)}% · ${p.growthAllowed ? `다음 성장까지 ${formatDuration(p.nextGrowthSeconds)}` : `<span class="population-warning">성장 중단: ${p.growthBlockers.map(escapeHtml).join(' · ')}</span>`}</p>
    `;
  return summary + `<h3>식량 공급</h3>
    <dl class="spec-list">
      ${row('식량 재고 / 저장량', `${number(state.resources.food)} / ${formatAmount(p.foodCapacity)}`)}
      ${row('생산 / 소비', `${number(p.foodProduction)} / ${number(p.foodConsumption)} /h`)}
      ${row('함대 식량 유지비', `${number(p.fleetFoodConsumption || 0)} /h`)}
      ${row('시간당 수지', `${signed(p.foodNet)}/h`)}
      ${row('비축 식량 지속 시간', p.foodNet < 0 ? formatDuration((state.resources.food || 0) / -p.foodNet * 3600) : '생산이 소비 이상 · 고갈 없음')}
    </dl>
    ${p.starving ? `<p class="population-warning">식량이 고갈되어 행복도와 생산 효율이 낮아졌습니다.${p.nextStarvationSeconds != null ? ` 다음 인구 감소까지 ${formatDuration(p.nextStarvationSeconds)} · ${Math.round((p.starvationProgress || 0) * 100)}%` : ''}</p>` : ''}
    <h3>행복도 구성</h3>
    <dl class="spec-list">
      ${row('기본', number(reasons.base))}${row(`문화 (${number(p.culture)} / ${formatAmount(p.count)})`, signed(reasons.culture))}
      ${row('주거', signed(reasons.housing))}${row('식량', signed(reasons.food))}
      ${row('건강', signed(reasons.health || 0))}${row('사회정책', signed(reasons.policy || 0))}
    </dl>
    <h3>지식과 건강</h3>
    <p>교육 수용량 ${number(p.knowledgeCapacity)} · 의료 수용량 ${number(p.healthCapacity)}. 각 수용량 ÷ 인구 × 100으로 지식·건강을 계산합니다 (최대 100).</p>
    <p>지식 1당 광산 생산 +0.25%. 건강 1당 행복 +0.1, 성장 속도 +0.25%. 광산 생산은 인력 가동률 × 행복·안정 배율 × 지식 배율로 결정됩니다. 초기 기본 자원 생산은 유지됩니다.</p>
    <h3>자동 일자리 배치</h3>
    <p>농업 → 문화 → 의료 → 교육 → 자원시설 순으로 배치합니다.</p>
    ${jobs ? `<table><thead><tr><th>시설</th><th>배치 / 필요</th><th>가동률</th></tr></thead><tbody>${jobs}</tbody></table>` : '<p>아직 일자리를 제공하는 시설이 없습니다.</p>'}
    <h3>콜로니 초기 지원</h3>
    <p>주거 ${formatAmount(p.support.housing)} · 식량 ${number(p.support.food)}/h · 문화 ${formatAmount(p.support.culture)}</p>
    <p>초기 지원은 고정됩니다. 추가 인구를 위해 주거시설·수경농장·문화센터·교육원·의료센터를 건설하고 관련 연구를 진행하세요.</p>`;
}
