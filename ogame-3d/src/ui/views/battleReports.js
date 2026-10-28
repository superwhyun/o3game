import { escapeHtml, formatAmount } from '../dom.js';
import { catalog } from '../../data/catalog.js';
import '../battle-reports.css';
const coordinate = value => value ? `[${value.galaxy}:${value.system}:${value.planet}]` : '—';
const amount = value => formatAmount(value || 0);
const resources = [['metal', '금속'], ['crystal', '수정'], ['deuterium', '중수소']];
export function reportIsRead(report, userId) {
  return String(report.attacker?.userId) === String(userId) ? report.attackerRead : report.defenderRead;
}
export function battleOutcome(report, userId) {
  if (report.result?.winner === 'draw') return '무승부';
  if (!['attacker', 'defender'].includes(report.result?.winner)) return '전투 완료';
  const side = String(report.attacker?.userId) === String(userId) ? 'attacker' : 'defender';
  return report.result.winner === side ? '승리' : '패배';
}
function forceTable(initial, losses) {
  const ids = [...new Set([...Object.keys(initial || {}), ...Object.keys(losses || {})])].filter(id => (initial?.[id] || losses?.[id]) > 0);
  return ids.length ? `<table><thead><tr><th>함선 / 방어시설</th><th>투입</th><th>손실</th><th>생존</th></tr></thead><tbody>${ids.map(id => `<tr><th>${escapeHtml(catalog.get('ship', id)?.name || catalog.get('defense', id)?.name || id)}</th><td>${amount(initial?.[id])}</td><td>${amount(losses?.[id])}</td><td>${amount(Math.max(0, (initial?.[id] || 0) - (losses?.[id] || 0)))}</td></tr>`).join('')}</tbody></table>` : '<p>투입 전력 없음</p>';
}
export function renderBattleReports(root, reports, userId) {
  const opened = new Set([...root.querySelectorAll('details[open]')].map(el => el.dataset.detailId));
  root.innerHTML = reports.length ? reports.map(report => {
    const attacker = String(report.attacker?.userId) === String(userId);
    const loot = report.result?.loot || {};
    const fuel = report.fuelConsumed?.deuterium;
    const defenderInitial = { ...report.defenderInitial?.fleet };
    for (const [id, count] of Object.entries(report.defenderInitial?.defense || {})) defenderInitial[id] = (defenderInitial[id] || 0) + count;
    const read = reportIsRead(report, userId);
    return `<article class="battle-report-card" data-report-id="${escapeHtml(report._id)}">
      <header><div><span class="battle-report-role">${attacker ? '공격' : '방어'} · ${read ? '확인함' : '새 기록'}</span><h3>${battleOutcome(report, userId)} <small>${escapeHtml(report.formationName || '전투 보고')}</small></h3></div>${read ? '' : '<button class="holo-btn-small" data-report-read>확인</button>'}</header>
      <p class="battle-report-meta">${escapeHtml(new Date(report.battleTime).toLocaleString('ko-KR'))}<br>${escapeHtml(report.attacker?.username)} ${escapeHtml(coordinate(report.attacker?.coordinates))} → ${escapeHtml(report.defender?.username)} ${escapeHtml(coordinate(report.defender?.coordinates))}</p>
      <dl class="battle-resource-grid">${resources.map(([id, label]) => `<div><dt>${attacker ? '약탈' : '약탈당한'} ${label}</dt><dd>${amount(loot[id])}</dd></div>`).join('')}<div><dt>공격측 연료 소모 · 중수소</dt><dd>${fuel == null ? '기록 없음' : amount(fuel)}</dd></div></dl>
      ${report.result?.pirateLevel ? `<p class="battle-report-note">해적 Lv.${report.result.pirateLevel} · ${report.result.pirateCleared ? '소탕 완료 · 다시 개척 가능' : '거점 잔존 · 병력 재건 가능'}</p>` : ''}
      ${report.result?.attackerCrewLosses != null ? `<p class="battle-report-note">승무원 손실 · 공격측 ${amount(report.result.attackerCrewLosses)}명 / 방어측 ${amount(report.result.defenderCrewLosses)}명</p>` : ''}
      ${report.fuelPolicy === 'notCharged' ? '<p class="battle-report-note">현재 출격에는 연료 차감이 없습니다.</p>' : ''}
      ${attacker ? `<p class="battle-report-note">${report.returnStatus === 'completed' ? '귀환 완료 · 약탈 자원이 출발 행성에 반영되었습니다.' : report.returnStatus === 'returning' ? `귀환 중 · 약탈 자원은 귀환 후 반영됩니다.${report.returnTime ? ' 귀환 예정 ' + escapeHtml(new Date(report.returnTime).toLocaleString('ko-KR')) : ''}` : '약탈 자원은 함대 귀환 시 출발 행성에 반영됩니다.'}</p>` : '<p class="battle-report-note">약탈당한 자원은 전투 시 방어 행성에서 차감되었습니다.</p>'}
      <details data-detail-id="${escapeHtml(report._id)}" ${opened.has(String(report._id)) ? 'open' : ''}><summary>함선 손실 · 교전 내역</summary><h4>공격측 전력</h4>${forceTable(report.attackerInitial?.fleet, report.result?.attackerLosses)}<h4>방어측 전력</h4>${forceTable(defenderInitial, report.result?.defenderLosses)}
      <h4>잔해</h4><p>금속 ${amount(report.result?.debrisField?.metal)} · 수정 ${amount(report.result?.debrisField?.crystal)} (약탈량에 포함되지 않음)</p>
      <h4>교전 ${report.rounds?.length || 0}회</h4><ol class="battle-rounds">${(report.rounds || []).map(round => `<li>${round.round}차 교전 · 공격측 가한 피해 ${amount(round.attackerDamage)} / 방어측 가한 피해 ${amount(round.defenderDamage)}</li>`).join('')}</ol></details>
    </article>`;
  }).join('') : '<p class="battle-report-empty">아직 전투 기록이 없습니다. 공격하거나 공격받은 전투가 끝나면 여기에 표시됩니다.</p>';
}
