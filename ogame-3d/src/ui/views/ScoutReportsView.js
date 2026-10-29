import { escapeHtml as e, formatAmount, formatDuration } from "../dom.js";
import { catalog } from "../../data/catalog.js";
import { travelSeconds } from "../../data/fleetMath.js";
const coord = (p) => `[${p.galaxy}:${p.system}:${p.planet}]`;
const resources = { metal: "금속", crystal: "크리스탈", deuterium: "듀테륨" };
function section(title, values, type) {
  return `<section class="scout-information"><h5>${title}</h5>${
    values
      ? `<dl>${
          Object.entries(values)
            .filter(([, n]) => !type || n > 0)
            .map(
              ([id, n]) =>
                `<div><dt>${e(type ? catalog.get(type, id)?.name || id : resources[id] || id)}</dt><dd>${formatAmount(n)}${type === "ship" ? "척" : ""}</dd></div>`,
            )
            .join("") || "<div><dt>관측 결과</dt><dd>0</dd></div>"
        }</dl>`
      : '<p class="scout-locked">미확인 · 더 높은 첩보 기술이 필요합니다.</p>'
  }</section>`;
}
function terrainSection(info) {
  if (!info) return '<p class="scout-locked">지형 정보 없음 · 다시 정찰하면 개척 정보를 확인할 수 있습니다.</p>';
  const rows = [
    ['행성 지름', `${formatAmount(info.diameter)} km`],
    ['온도', `${info.minTemp} ~ ${info.maxTemp} °C`],
    ['전체 면적', `${formatAmount(info.total)}칸`],
    ['초기 사용 가능', `${formatAmount(info.usable)}칸 (${info.baseUsablePercent}%${info.bonusUsable ? ` + 추가 ${info.bonusUsable}칸` : ''})`],
    ['사용 불가 지형', `${formatAmount(info.unusable)}칸`],
    [`내 테라포밍 Lv.${info.terraformingLevel} 적용 시`, `${formatAmount(info.prospectiveUsable)}칸 사용 가능`],
    ...Object.entries(info.production || {}).map(([key, value]) => [{ metal: '금속 생산', crystal: '수정 생산', deuterium: '중수소 생산', solar: '태양광 발전' }[key] || key, `${Math.round(value * 100)}%`]),
  ];
  return `<section class="scout-information scout-terrain"><h5>지형·개척 기초정보</h5><dl>${rows.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl><p class="detail-muted">면적은 건물 레벨이 사용하는 건설 칸입니다. 사용 불가 지형은 테라포밍으로 개선할 수 있습니다. 점령자의 건설 사용량은 포함하지 않습니다.</p></section>`;
}
function graphSection(title, values, type, suffix = "") {
  if (!values) return `<section class="scout-graph-section"><h5>${e(title)}</h5><p class="scout-locked">미확인 · 더 높은 첩보 기술이 필요합니다.</p></section>`;
  const entries = Object.entries(values).filter(([, value]) => Number.isFinite(Number(value)) && (!type || Number(value) > 0));
  const maximum = Math.max(1, ...entries.map(([, value]) => Number(value)));
  return `<section class="scout-graph-section"><h5>${e(title)}</h5>${entries.map(([id, value]) => {
    const label = type ? catalog.get(type, id)?.name || id : resources[id] || id;
    return `<div class="scout-graph-row"><span title="${e(label)}">${e(label)}</span><progress max="${maximum}" value="${Math.max(0, Number(value))}" aria-label="${e(label)}">${formatAmount(value)}</progress><strong>${formatAmount(value)}${e(suffix)}</strong></div>`;
  }).join('') || '<p class="scout-locked">관측 수량 0</p>'}</section>`;
}
function productionGraph(values) {
  return `<section class="scout-graph-section"><h5>생산·발전 보정</h5>${Object.entries(values || {}).map(([key, value]) => {
    const percent = Math.round(Number(value) * 100);
    if (!Number.isFinite(percent)) return '';
    const label = { metal:'금속', crystal:'수정', deuterium:'중수소', solar:'태양광' }[key] || key;
    const excess = Math.max(0, percent - 100);
    return `<div class="scout-graph-row scout-production-row"><span>${e(label)}</span><div class="scout-production-chart" role="img" aria-label="${e(`${label} ${percent}%${excess ? `, 추가 보정 +${excess}%` : ''}`)}"><span class="scout-production-base" style="width:${Math.max(0, Math.min(100, percent)) / 1.2}%"></span>${excess ? `<span class="scout-production-bonus" style="width:${Math.min(20, excess) / 1.2}%"></span>` : ''}<i></i></div><strong>${percent}%${excess ? ` <em class="scout-production-extra">+${excess}%</em>` : ''}</strong></div>`;
  }).join('')}</section>`;
}
function graphicsReport(report) {
  const sections = report.sections || {}, info = sections.environment;
  const terrain = info ? `<section class="scout-graph-section"><h5>행성·개척</h5><div class="scout-graph-facts"><span>지름 <strong>${formatAmount(info.diameter)} km</strong></span><span>온도 <strong>${e(info.minTemp)} ~ ${e(info.maxTemp)} °C</strong></span></div>${Number(info.maxTotal) > 0 ? `<div class="scout-area-chart" role="img" aria-label="${e(`게임 최대 ${info.maxTotal}칸 중 전체 면적 ${info.total}칸`)}"><span style="width:${Math.max(0, Math.min(100, Number(info.total) / Number(info.maxTotal) * 100))}%"></span></div><p class="scout-locked">전체 면적 ${formatAmount(info.total)} / 게임 최대 ${formatAmount(info.maxTotal)}칸</p>` : ''}<p class="scout-locked">초기 사용 가능 ${formatAmount(info.usable)} / ${formatAmount(info.total)}칸 · 내 테라포밍 Lv.${formatAmount(info.terraformingLevel)} 적용 시 ${formatAmount(info.prospectiveUsable)}칸</p>${productionGraph(info.production)}</section>` : '<p class="scout-locked">지형 정보 미확인</p>';
  return `<div class="scout-mode-graphics"><div class="scout-graphics-grid">${terrain}${report.outcome === 'occupied' ? graphSection('자원', sections.resources) + graphSection('주둔 함선', sections.fleet, 'ship', '척') + graphSection('방어시설', sections.defense, 'defense') + graphSection('건물 레벨', sections.buildings, 'building') + graphSection('연구 레벨', sections.research, 'research') : ''}</div><p class="scout-survivors">정찰선 ${formatAmount(report.initialProbeCount)}척 출격 · ${formatAmount(report.survivorCount)}척 생존${report.intercepted ? ' · 정보 전송 후 격추' : ''}</p><p class="scout-locked">관측 당시 정보 · 막대는 각 항목 내 상대 크기입니다.</p></div>`;
}
function simpleReport(report) {
  const info = report.sections?.environment;
  return `<div class="scout-mode-simple"><p class="scout-locked">${info ? `초기 사용 가능 ${formatAmount(info.usable)} / ${formatAmount(info.total)}칸` : '지형 정보 미확인'}</p>${report.outcome === 'occupied' ? section('자원', report.sections?.resources) : ''}<p class="scout-survivors">정찰선 ${formatAmount(report.survivorCount)} / ${formatAmount(report.initialProbeCount)}척 생존</p></div>`;
}
export function reportCard(report, position) {
  const stale =
    position &&
    (String(report.targetPlanetId || "") !==
      String(position.planet?.id || "") ||
      report.targetCommander !== position.planet?.username);
  const title = {
    empty: "미점령 행성 · 개척 조사",
    occupied: report.targetName || "행성 관측",
    friendly: "현재 아군 행성",
    unavailable: "관측 대상 확인 불가",
  }[report.outcome];
  return `<article class="scout-report" data-scout-report="${e(report.id)}"><header><div><span class="scout-eyebrow"><button type="button" class="scout-coordinate" data-scout-galaxy="${report.destination.galaxy}" data-scout-system="${report.destination.system}" data-scout-planet="${report.destination.planet}" aria-label="${e(coord(report.destination))} 성계도에서 보기">${e(coord(report.destination))}</button> · ${report.informationTier ? `정보 ${report.informationTier}단계` : "관측 완료"}</span><h4>${e(title)}</h4></div><span class="scout-result ${report.intercepted ? "is-lost" : ""}">${report.intercepted ? "격추" : report.detected ? "탐지됨" : "미탐지"}</span></header><p class="scout-observed">${e(new Date(report.observedAt).toLocaleString("ko-KR"))} 관측 · <span data-observed-time="${e(report.observedAt)}"></span>${stale ? " · 이전 점령 상태의 관측" : ""}</p>${report.targetCommander ? `<p>당시 사령관 · ${e(report.targetCommander)}</p>` : ""}${graphicsReport(report)}${simpleReport(report)}<details class="scout-full-information" data-report-id="${e(report.id)}"><summary><span class="scout-mode-detailed">관측 정보 보기</span><span class="scout-mode-compact">자세한 관측 정보</span></summary>${terrainSection(report.sections?.environment)}${report.outcome === "occupied" ? section("자원", report.sections.resources) + section("주둔 함선", report.sections.fleet, "ship") + section("방어시설", report.sections.defense, "defense") + section("건물", report.sections.buildings, "building") + section("연구", report.sections.research, "research") : `<p>${report.outcome === "empty" ? "도착 당시 미점령 상태입니다." : report.outcome === "friendly" ? "도착 당시 아군 행성으로 확인했습니다." : "점령 정보가 충돌해 상세 관측을 하지 않았습니다."}</p>`}<p class="scout-survivors">정찰선 ${report.initialProbeCount}척 출격 · ${report.survivorCount}척 생존${report.intercepted ? " · 정보 전송 후 격추" : " · 귀환 임무와 별도로 기록됩니다."}</p></details></article>`;
}
export class ScoutReportsView {
  constructor(root, { controller, state, onNavigate, onMissions, onCoordinate }) {
    Object.assign(this, { root, controller, state, onNavigate, onMissions, onCoordinate });
    this.opened = new Set();
    root.addEventListener(
      "toggle",
      (event) => {
        const id = event.target.dataset.reportId;
        if (id) {
          if (event.target.open) this.opened.add(id);
          else this.opened.delete(id);
        }
      },
      true,
    );
    root.addEventListener("click", (event) => {
      const coordinate = event.target.closest('[data-scout-galaxy]');
      if (coordinate) {
        onCoordinate?.({ galaxy:Number(coordinate.dataset.scoutGalaxy), system:Number(coordinate.dataset.scoutSystem), planet:Number(coordinate.dataset.scoutPlanet) });
        return;
      }
      const action = event.target.closest("[data-scout-action]")?.dataset
        .scoutAction;
      if (action === "launch") controller.launch(this.target);
      if (action === "shipyard" || action === "fleet") onNavigate(action);
      if (action === "missions") onMissions();
      if (action === "history") {
        this.history = true;
        void controller.refresh(this.target);
      }
      if (action === "more")
        void this.loadMore().catch((error) => {
          this.controller.error = error.message;
          this.render(this.position);
        });
    });
  }
  async loadMore() {
    if (this.loading) return;
    this.loading = true;
    const targetKey = this.targetKey,
      account = this.account;
    try {
      const list = await this.controller.api.getScoutReports({
        ...this.target,
        cursor: this.cursor,
        limit: 20,
      });
      if (
        account === String(this.state.userId) &&
        targetKey === this.targetKey
      ) {
        this.extra = [...(this.extra || []), ...list.reports];
        this.cursor = list.nextCursor;
        this.render(this.position);
      }
    } finally {
      this.loading = false;
    }
  }
  render(position = null) {
    const c = this.controller;
    c.ensureAccount();
    if (this.account !== String(this.state.userId)) {
      this.account = String(this.state.userId);
      this.opened.clear();
      this.extra = [];
      this.history = false;
      this.signature = null;
    }
    this.position = position;
    const target = position ? { ...this.controller.target } : null;
    const key = target ? coord(target) : "all";
    if (this.targetKey !== key) {
      this.history = false;
      this.extra = [];
      this.cursor = null;
      this.targetKey = key;
    }
    this.target = target;
    let body = "";
    if (position && target) {
      const own = position.owner === "self",
        available = c.available(),
        stock = this.state.fleet?.espionageProbe || 0;
      const eta = travelSeconds(
        this.state.planet,
        target,
        catalog.get("ship", "espionageProbe")?.stats?.speed || 1,
        100,
        { serverSpeed: this.state.serverSpeed, flightSpeedMultiplier: this.state.flightSpeedMultiplier },
      );
      const pending = Object.values(c.pending).filter(
        (o) => coord(o.destination) === coord(target),
      ).length;
      const movements = (this.state.fleetMovements || []).filter(
        (m) => m.mission === "spy" && coord(m.destination) === coord(target),
      );
      body += `<div class="scout-command"><span class="scout-eyebrow">RECONNAISSANCE</span><h4>정찰 출격</h4><p>${e(this.state.planet.name || "현재 행성")} 출발 · 출격 가능 <strong data-scout-available>${available}</strong>척</p><button class="cmd-btn primary scout-launch" data-scout-action="launch" ${own || !available ? "disabled" : ""}>정찰 · 1척</button><p class="scout-command-hint">${own ? "아군 행성은 정찰할 필요가 없습니다." : available ? `한 번에 1척 · 도착 약 ${formatDuration(eta)} · 요격 위험 미확인` : stock ? "정찰선이 다른 함대에 배정되어 있거나 출격 확인 중입니다." : "정찰선을 먼저 건조하십시오."}</p>${!own && !available ? `<button class="cmd-btn" data-scout-action="${stock ? "fleet" : "shipyard"}">${stock ? "함대 편성 확인" : "정찰선 건조"}</button>` : ""}${pending ? `<p role="status">출격 확인 중 ${pending}건</p>` : ""}${movements.map((m) => `<p class="scout-flight">정찰 · ${m.status === "returning" ? "귀환 중" : "관측 이동 중"} <span data-scout-eta="${e(m.status === "returning" ? m.returnTime : m.arrivalTime)}"></span></p>`).join("")}${movements.length ? '<button class="cmd-btn" data-scout-action="missions">진행 중인 임무 보기</button>' : ""}</div>`;
      const list = c.targetReports;
      body +=
        `<div class="scout-heading"><h4>최신 정찰 정보</h4><button class="cmd-btn" data-scout-action="history">정찰 기록</button></div>` +
        (list[0]
          ? reportCard(list[0], position)
          : '<p class="scout-empty">아직 관측한 정보가 없습니다. 정찰선이 도착하면 보고가 전달됩니다.</p>');
      if (!this.extra?.length) this.cursor = c.targetCursor;
      if (this.history) {
        body += `<div class="scout-history">${[...list.slice(1), ...(this.extra || [])].map((r) => reportCard(r, position)).join("") || "<p>이전 보고가 없습니다.</p>"}${this.cursor ? '<button class="cmd-btn" data-scout-action="more">이전 보고 더 보기</button>' : ""}</div>`;
      }
    } else {
      if (!this.extra?.length) this.cursor = c.historyCursor;
      body =
        [...c.reports, ...(this.extra || [])]
          .map((r) => reportCard(r))
          .join("") ||
        '<p class="scout-empty">정찰 보고가 없습니다. 성계도에서 정찰선을 보내십시오.</p>';
      if (this.cursor)
        body +=
          '<button class="cmd-btn" data-scout-action="more">이전 보고 더 보기</button>';
    }
    if (!position)
      body += `<h4>정찰 침입 탐지</h4>${c.alerts.map((a) => `<div class="scout-alert">${e(coord(a.destination))} · ${e(a.attackerName)} · ${a.intercepted ? "정찰선 요격" : "침입 탐지"}<small>${e(new Date(a.observedAt).toLocaleString("ko-KR"))}</small></div>`).join("") || '<p class="scout-empty">탐지 기록이 없습니다.</p>'}`;
    if (c.error)
      body += `<p role="status">보고 연결 확인 중 · ${e(c.error)}</p>`;
    if (body !== this.signature) {
      const focused = this.root.contains(document.activeElement)
        ? document.activeElement?.dataset.scoutAction
        : null;
      this.signature = body;
      const template = document.createElement("template");
      template.innerHTML = body;
      const liveCommand = this.root.querySelector(".scout-command"),
        newCommand = template.content.querySelector(".scout-command");
      if (
        liveCommand &&
        newCommand &&
        this.renderedTargetKey === key &&
        this.renderedAccount === this.account
      ) {
        const button = liveCommand.querySelector(
            '[data-scout-action="launch"]',
          ),
          nextButton = newCommand.querySelector('[data-scout-action="launch"]');
        for (const child of [...liveCommand.childNodes])
          if (child !== button) child.remove();
        let after = false;
        for (const child of [...newCommand.childNodes]) {
          if (child === nextButton) {
            after = true;
            continue;
          }
          if (after) liveCommand.append(child);
          else liveCommand.insertBefore(child, button);
        }
        button.disabled = nextButton.disabled;
        newCommand.remove();
        for (const child of [...this.root.childNodes])
          if (child !== liveCommand) child.remove();
        this.root.append(template.content);
      } else this.root.replaceChildren(template.content);
      this.renderedTargetKey = key;
      this.renderedAccount = this.account;
      for (const el of this.root.querySelectorAll("[data-report-id]"))
        el.open = this.opened.has(el.dataset.reportId);
      if (focused)
        this.root.querySelector(`[data-scout-action="${focused}"]`)?.focus();
    }
    this.tick();
  }
  tick() {
    const now = Date.now() + (this.state.serverOffset || 0);
    for (const el of this.root.querySelectorAll("[data-observed-time]"))
      el.textContent =
        formatDuration((now - new Date(el.dataset.observedTime)) / 1000) +
        " 전";
    for (const el of this.root.querySelectorAll("[data-scout-eta]")) {
      const remaining = (new Date(el.dataset.scoutEta) - now) / 1000;
      el.textContent =
        remaining > 0 ? formatDuration(remaining) : "도착 처리 중";
    }
  }
}
