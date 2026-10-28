import { catalog } from '../../data/catalog.js';
import { formatAmount } from '../dom.js';
import { renderCosts, renderRequirements } from './entityDetails.js';

export function renderAreaWarning(state) {
  const area = state.planet?.area;
  if (!area || area.available > Math.max(10, Math.ceil(area.usable * .1))) return '';
  const level = state.research?.terraforming || 0;
  const next = Math.min(area.total, Math.floor(area.total * Math.min(100, area.baseUsablePercent + (level + 1) * 2) / 100 + 1e-9) + (area.bonusUsable || 0));
  if (area.usable >= area.total || level >= 30) return '<section class="area-warning"><p>면적이 부족합니다. 테라포밍으로 추가 공간을 확보할 수 없습니다. 철거하거나 다른 행성에서 개발하세요.</p></section>';
  const entity = catalog.get('research', 'terraforming');
  const missing = entity ? catalog.requirementStatus(entity, state).filter(row => !row.met) : [];
  return `<section class="area-warning area-capacity-warning"><p>남은 면적 ${formatAmount(area.available)}칸 · 예약 ${formatAmount(area.reserved)}칸. 테라포밍 Lv ${level + 1}로 +${next - area.usable}칸 확보 가능.</p>${entity ? `<details><summary>테라포밍 비용·선행조건</summary>${renderCosts(catalog.cost(entity, level + 1), state.resources || {})}${missing.length ? renderRequirements(missing) : '<p>선행조건 충족</p>'}</details>` : ''}<button type="button" class="holo-btn-small" data-open-entity="terraforming" data-entity-view="research">테라포밍 연구 보기</button></section>`;
}
