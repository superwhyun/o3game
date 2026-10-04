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

function effectRows(entity, level) {
  const rows = [];
  const effects = entity.effects || {};
  const delta = (rule) => {
    const now = evaluateEffect(rule, level);
    const next = evaluateEffect(rule, level + 1);
    return { now: formatAmount(now), diff: formatAmount(next - now) };
  };

  for (const [resource, rule] of Object.entries(effects.production || {})) {
    const { now, diff } = delta(rule);
    rows.push(row(`${RESOURCE_LABELS[resource] || resource} 생산`, `${now}/h`, `다음 단계 +${diff}`));
  }
  if (effects.energyProduction?.amount) {
    const { now, diff } = delta(effects.energyProduction.amount);
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

function statRows(entity, count) {
  const stats = entity.stats || {};
  const rows = Object.entries(STAT_LABELS)
    .filter(([key]) => stats[key] !== undefined && stats[key] !== 0)
    .map(([key, label]) => row(label, formatAmount(stats[key]), count > 1 && ['attack', 'cargo'].includes(key) ? `×${count} = ${formatAmount(stats[key] * count)}` : ''));

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
export function renderSpecs(entity, { level = 0, count = 1 } = {}) {
  const rows = catalog.isLeveled(entity.type) ? effectRows(entity, level) : statRows(entity, count);
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
