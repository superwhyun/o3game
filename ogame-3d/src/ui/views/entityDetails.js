/**
 * Pure HTML builders for the entity detail pane (spec rows, requirements,
 * costs, unlocks). Kept separate from EntityBrowser so new effect / stat kinds
 * only need a line here.
 */
import { catalog, evaluateEffect } from '../../data/catalog.js';
import { escapeHtml, formatAmount, RESOURCE_LABELS, STAT_LABELS } from '../dom.js';

function row(label, value, note = '') {
  return `<div class="spec-row"><dt>${escapeHtml(label)}</dt><dd>${value}${note ? `<small>${note}</small>` : ''}</dd></div>`;
}

function effectRows(entity, level, modifiers = {}) {
  const rows = [];
  const effects = entity.effects || {};
  if (effects.researchNetwork) rows.push(row('연결 가능한 연구소', `${level + 1}곳`, '다음 단계 +1곳 · 최소 연구소 레벨 충족 시 자동 연결'));
  for (const [key, label] of Object.entries({ housingPerLevel: '인구 수용량', jobsPerLevel: '일자리', foodPerLevel: '식량 생산', foodStoragePerLevel: '추가 식량 저장량', culturePerLevel: '문화 수용량', knowledgePerLevel: '교육 수용량', healthPerLevel: '의료 수용량', happinessPerLevel: '행복도' })) {
    const perLevel = effects.population?.[key];
    if (perLevel) rows.push(row(label, `${formatAmount(perLevel * level)}${key === 'foodPerLevel' ? '/h' : ''}`, `다음 단계 +${formatAmount(perLevel)}`));
  }
  for (const [key, label] of Object.entries({ housingBonusPerLevel: '주거시설 수용량', foodBonusPerLevel: '농장 식량 생산', knowledgeBonusPerLevel: '교육원 수용량', healthBonusPerLevel: '의료센터 수용량' })) {
    const value = effects.population?.[key];
    if (value) rows.push(row(label, `+${Math.round(value * level * 100)}%`, `다음 단계 +${Math.round(value * 100)}% · 현재 행성`));
  }
  if (effects.usablePercentPerLevel) rows.push(row('모든 행성 가용률', `단계당 +${effects.usablePercentPerLevel}%p`, `최대 ${effects.maxLevel}레벨 · 가용률 상한 100%`));
  const delta = (rule, multiplier = 1) => {
    const now = evaluateEffect(rule, level) * multiplier;
    const next = evaluateEffect(rule, level + 1) * multiplier;
    return { now: formatAmount(now), diff: formatAmount(next - now) };
  };

  for (const [resource, rule] of Object.entries(effects.production || {})) {
    const { now, diff } = delta(rule, modifiers[resource] ?? 1);
    rows.push(row(`${RESOURCE_LABELS[resource] || resource} 생산`, `${now}/h`, `다음 단계 +${diff}`));
  }
  if (effects.energyProduction?.amount) {
    const { now, diff } = delta(effects.energyProduction.amount, entity.id === 'solarPlant' ? modifiers.solar ?? 1 : 1);
    rows.push(row('에너지 생산', now, `다음 단계 +${diff}`));
  }
  if (effects.energyConsumption?.amount) {
    const { now, diff } = delta(effects.energyConsumption.amount);
    rows.push(row('에너지 소비', now, `다음 단계 +${diff}`));
  }
  for (const [resource, rule] of Object.entries(effects.storage || {})) {
    const { now } = delta(rule);
    rows.push(row(`${RESOURCE_LABELS[resource] || resource} 저장`, now, `다음 단계 ${formatAmount(evaluateEffect(rule, level + 1))}`));
  }
  for (const modifier of effects.constructionModifiers || []) {
    const targets = (modifier.targetTypes || []).map((type) => ({ building: '건설', research: '연구', ship: '함선', defense: '방어' })[type] || type).join('·');
    const text = modifier.mode === 'powerMultiplier'
      ? `단계당 ×${modifier.value}`
      : `단계당 +${Math.round((modifier.value || 0) * 100)}% 속도`;
    rows.push(row(`${targets} 시간`, text));
  }
  return rows;
}

function statRows(entity, count, energyState) {
  const stats = entity.stats || {};
  const rows = Object.entries(STAT_LABELS)
    .filter(([key]) => stats[key] !== undefined && stats[key] !== 0)
    .map(([key, label]) => row(label, formatAmount(stats[key]), count > 1 && ['attack', 'cargo'].includes(key) ? `×${count} = ${formatAmount(stats[key] * count)}` : ''));

  if (entity.type === 'ship' && stats.crew != null) {
    rows.push(row('척당 승무원', stats.crew ? `${formatAmount(stats.crew)}명 · 편성 시 행성 인구에서 배치` : '무인'));
    if (stats.upkeep) rows.push(row('척당 자원 유지비', `금속 ${Number(stats.upkeep.metal || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} · 중수소 ${Number(stats.upkeep.deuterium || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}`, '시간당 · 서버 속도 배율 적용'));
  }

  if (entity.id === 'solarSatellite') {
    const contribution = energyState?.sources?.find(source => source.id === 'solarSatellite');
    if (contribution) {
      rows.push(row('1기당 발전량', formatAmount(contribution.perUnit), '현재 행성 온도 기준 · 서버 속도와 무관'));
      rows.push(row('보유 위성 총 발전량', formatAmount(contribution.amount), `보유 ${formatAmount(contribution.count)}기`));
      rows.push(row('건조 시 추가 발전량', `+${formatAmount(contribution.perUnit * count)}`, `${formatAmount(count)}기 건조 기준`));
    }
  }
  const rapidFire = Object.entries(stats.rapidFire || {});
  if (rapidFire.length > 0) {
    const targets = rapidFire
      .map(([id, shots]) => `${escapeHtml(catalog.find(id)?.name || id)} ${shots}`)
      .join(', ');
    rows.push(row('속사', `<span class="spec-wrap">${targets}</span>`));
  }
  return rows;
}

/** @returns {string} */
export function renderSpecs(entity, { level = 0, count = 1, modifiers = {}, energyState } = {}) {
  const rows = catalog.isLeveled(entity.type) ? effectRows(entity, level, modifiers) : statRows(entity, count, energyState);
  return rows.length ? `<dl class="spec-list">${rows.join('')}</dl>` : '';
}

/** @returns {string} */
export function renderRequirements(requirements) {
  if (requirements.length === 0) return '<p class="detail-muted">선행 조건 없음</p>';
  return `<ul class="req-list">${requirements.map((req) => `
    <li class="${req.met ? 'is-met' : 'is-unmet'}">
      <span class="req-mark" aria-hidden="true">${req.met ? '◆' : '◇'}</span>
      <span class="req-name">${escapeHtml(req.name)}</span>
      <span class="req-level">${req.current} / ${req.required}</span>
      <span class="sr-only">${req.met ? '충족' : '미충족'}</span>
    </li>`).join('')}</ul>`;
}

/** @returns {string} */
export function renderCosts(cost, resources) {
  const entries = Object.entries(cost);
  if (entries.length === 0) return '<p class="detail-muted">비용 없음</p>';
  return `<table class="cost-table"><tbody>${entries.map(([resource, amount]) => {
    const have = resources[resource] || 0;
    const short = have < amount;
    return `<tr class="${short ? 'is-short' : ''}">
      <th scope="row"><i class="res-dot res-${resource}"></i>${RESOURCE_LABELS[resource] || resource}</th>
      <td>${formatAmount(amount)}</td>
      <td class="cost-have">${short ? `−${formatAmount(amount - have)}` : '충분'}</td>
    </tr>`;
  }).join('')}</tbody></table>`;
}

/** Entities that list this one as a prerequisite. */
export function renderUnlocks(entity) {
  const group = entity.type === 'building' ? 'buildings' : entity.type === 'research' ? 'research' : null;
  if (!group) return '';
  const unlocks = ['building', 'research', 'ship', 'defense']
    .flatMap((type) => catalog.list(type))
    .filter((other) => other.requirements?.[group]?.[entity.id])
    .map((other) => `<li>${escapeHtml(other.name)}<span>Lv ${other.requirements[group][entity.id]}</span></li>`);
  if (unlocks.length === 0) return '';
  return `<section class="detail-section"><h4>해금</h4><ul class="unlock-list">${unlocks.join('')}</ul></section>`;
}
