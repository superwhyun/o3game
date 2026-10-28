import { escapeHtml as e, formatAmount } from "../dom.js";
import "../display-modes.css";
const modes = new Set(["simple", "detailed", "graphics"]);
export function applyDisplayMode(mode) {
  const selected = modes.has(mode) ? mode : "detailed";
  if (document.documentElement.dataset.uiMode === selected) return;
  document.documentElement.dataset.uiMode = selected;
  window.dispatchEvent(new Event("uiModeChanged"));
}
function bar(label, value, maximum, suffix = "") {
  const safeMax = Math.max(1, maximum || 0);
  return `<div class="mode-bar"><div><span>${e(label)}</span><strong>${formatAmount(value)}${maximum == null ? "" : ` / ${formatAmount(maximum)}`}${e(suffix)}</strong></div><progress value="${Math.max(0, Math.min(safeMax, value || 0))}" max="${safeMax}" aria-label="${e(label)}">${formatAmount(value)}</progress></div>`;
}
export function renderGraphics(root, state) {
  if (!root || document.documentElement.dataset.uiMode !== "graphics") return;
  const p = state.planet.populationState || {},
    area = state.planet.area || {};
  const rates = ["metal", "crystal", "deuterium", "food"].map(
    (key) => Number(state.productionRates[key]) || 0,
  );
  const maxRate = Math.max(1, ...rates.map(Math.abs));
  const labels = {
    metal: "금속",
    crystal: "수정",
    deuterium: "중수소",
    food: "식량",
  };
  root.innerHTML = `<article class="holo-card"><h3>자원 저장량</h3>${Object.entries(
    labels,
  )
    .map(([key, label]) => bar(label, state.resources[key], state.storage[key]))
    .join("")}</article>
    <article class="holo-card"><h3>시간당 생산·수지</h3><p class="detail-muted">막대는 절대량 비율이며, 음수는 소비 초과입니다.</p>${Object.entries(
      labels,
    )
      .map(
        ([key, label], i) =>
          `<div class="production-graph ${rates[i] < 0 ? "is-negative" : ""}"><span>${label}</span><div class="production-track"><div style="width:${(Math.abs(rates[i]) / maxRate) * 100}%"></div></div><strong>${rates[i] >= 0 ? "+" : ""}${formatAmount(rates[i])}/h</strong></div>`,
      )
      .join("")}</article>
    <article class="holo-card"><h3>주민·행성 개발</h3>${bar("인구 / 주거", p.count, p.housing)}${bar("취업 인구", p.employed, p.count)}${bar("행복도", p.happiness, 100)}<p class="detail-muted">${p.starving ? `<span class="area-warning">식량 고갈 · 인구 감소 진행 ${Math.round((p.starvationProgress || 0) * 100)}%</span><br>` : ""}함대 배치 인구 ${formatAmount(state.planet.fleetSupport?.crew || 0)}명 · 함대 식량 유지비 ${formatAmount(p.fleetFoodConsumption || 0)}/h</p>${bar("건설 공간 사용·예약", (area.used || 0) + (area.reserved || 0), area.usable, "칸")}</article>
    <article class="holo-card"><h3>에너지 생산·소비</h3>${bar("생산", state.energyProduction, Math.max(state.energyProduction, state.energyConsumption))}${bar("소비", state.energyConsumption, Math.max(state.energyProduction, state.energyConsumption))}${(state.planet.energyState?.sources || []).map(source => bar(source.name || source.id, source.amount, state.energyProduction)).join("")}<p class="${state.energyProduction < state.energyConsumption ? "area-warning" : ""}">에너지 수지 <strong>${formatAmount(state.energyProduction - state.energyConsumption)}</strong></p></article>`;
}
