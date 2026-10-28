import {
  escapeHtml as esc,
  formatAmount as amount,
  formatDuration,
} from "../dom.js";
import "../admin-user-details.css";
const missionNames = {
  attack: "공격",
  transport: "수송",
  deploy: "이동",
  colonize: "개척",
  spy: "정찰",
  deploy: "배치",
  recycle: "수거",
  expedition: "원정",
};
const date = (value) =>
  value ? esc(new Date(value).toLocaleString("ko-KR")) : "—";
const number = (value) => amount(Number(value) || 0);
const signed = (value) => `${Number(value) >= 0 ? "+" : ""}${number(value)}`;
const stats = (rows) =>
  `<dl class="aud-stats">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
export class AdminUserDetailsView {
  constructor(root, api, userId) {
    this.root = root;
    this.api = api;
    this.userId = userId;
    this.planetIndex = 0;
    this.generation = 0;
    this.busy = false;
    root.addEventListener("change", (event) => {
      if (event.target.matches("[data-detail-planet]")) {
        this.planetIndex = Number(event.target.value);
        this.render();
      }
    });
    root.addEventListener("click", (event) => {
      if (event.target.closest("[data-detail-refresh]")) this.load();
    });
  }
  async load() {
    if (this.busy) return;
    this.busy = true;
    const generation = ++this.generation;
    if (!this.user)
      this.root.innerHTML = '<p role="status">사용자 현황을 불러오는 중…</p>';
    const button = this.root.querySelector("[data-detail-refresh]");
    if (button) button.disabled = true;
    try {
      const user = await this.api.getUser(this.userId);
      if (
        generation !== this.generation ||
        !this.root.isConnected ||
        this.root.closest(".holo-modal")?.classList.contains("hidden")
      )
        return;
      this.user = user;
      this.render();
    } catch (error) {
      if (this.root.isConnected) {
        if (!this.user)
          this.root.innerHTML =
            '<p role="status" class="aud-error"></p><button data-detail-refresh>다시 불러오기</button>';
        this.root.querySelector("[role=status]").textContent = error.message;
      }
    } finally {
      this.busy = false;
      const b = this.root.querySelector("[data-detail-refresh]");
      if (b) b.disabled = false;
    }
  }
  entity(type, id) {
    return this.user.gameCatalog?.entities?.find(
      (e) => e.entityType === type && e.entityId === id,
    );
  }
  name(type, id) {
    return esc(this.entity(type, id)?.display?.name || id);
  }
  entries(type, values = {}, levels = false) {
    const positive = Object.entries(values).filter(([, n]) => Number(n) > 0);
    return positive.length
      ? `<div class="aud-entities">${positive.map(([id, n]) => `<div><span>${this.name(type, id)}</span><b>${levels ? "Lv." : ""}${number(n)}${levels ? "" : "기"}</b></div>`).join("")}</div>`
      : '<p class="aud-empty">없음</p>';
  }
  queues(items) {
    return items.length
      ? `<div class="aud-queue-list">${items.map((q) => `<article><strong>${esc(q.name || q.itemId)} ${q.level != null ? `Lv.${number(q.level)}` : `${number(q.count)}기`}</strong><span>${q.action === "demolish" ? "철거 · " : ""}${q.status === "pending" ? "대기" : "진행 중"} · 남은 ${formatDuration(Math.max(0, (new Date(q.endTime) - new Date(this.state.serverTime || Date.now())) / 1000))}</span><small>완료 예정 ${date(q.endTime)}</small></article>`).join("")}</div>`
      : '<p class="aud-empty">진행 중인 작업 없음</p>';
  }
  render() {
    const u = this.user;
    this.state = u.gameSnapshot || u;
    const s = this.state,
      planets = s.planets || [];
    this.planetIndex = Math.min(
      this.planetIndex,
      Math.max(0, planets.length - 1),
    );
    const p = planets[this.planetIndex];
    const queues =
      s.queueState?.all ||
      [
        s.queueState?.building,
        s.queueState?.research,
        s.queueState?.ship,
        s.queueState?.defense,
        ...(s.queueState?.queue || []),
      ].filter(Boolean);
    const formations = s.fleetFormations || [],
      movements = s.fleetMovements || [];
    this.root.innerHTML = `<header class="aud-heading"><div><h2>${esc(u.username)} <small>${u.isAiPlayer ? "AI 봇" : "사용자"} 상세</small></h2><p>${esc(u.email || "")}</p></div><button data-detail-refresh>새로고침</button></header><p class="aud-snapshot">${date(s.serverTime)} 기준 · 새로고침 시 생산 및 완료된 작업을 갱신합니다.</p><p role="status" class="aud-error"></p>
  ${stats([
    [
      "상태",
      `${u.isOnline ? "접속 중" : "오프라인"}${u.isBanned ? " · 계정 정지" : ""}`,
    ],
    ["권한", esc(u.adminRole || "일반 사용자")],
    ["보유 행성", number(planets.length)],
    ["가입", date(u.createdAt)],
    ["최근 로그인", date(u.lastLogin)],
  ])}
  <section class="aud-section"><h3>공통 연구 현황</h3><p class="aud-note">모든 보유 행성에 적용되는 사용자 연구</p>${this.entries("research", s.research || u.research, true)}<details><summary>미연구 기술</summary><div class="aud-entities">${
    (u.gameCatalog?.entities || [])
      .filter(
        (e) => e.entityType === "research" && !(s.research?.[e.entityId] > 0),
      )
      .map(
        (e) =>
          `<div><span>${esc(e.display?.name || e.entityId)}</span><b>Lv.0</b></div>`,
      )
      .join("") || "<p>없음</p>"
  }</div></details><h4>진행 중인 연구</h4>${this.queues(queues.filter((q) => q.type === "research"))}</section>
  <section class="aud-section"><div class="aud-heading"><h3>행성 개발 현황</h3><label>행성 선택<select data-detail-planet>${planets.map((planet, i) => `<option value="${i}" ${i === this.planetIndex ? "selected" : ""}>${esc(planet.name || `행성 ${i + 1}`)} [${planet.galaxy}:${planet.system}:${planet.planet}]${i === s.currentPlanet ? " · 현재 선택" : ""}</option>`).join("")}</select></label></div>${p ? this.planet(p, queues, formations) : "<p>행성 없음</p>"}</section>
  <section class="aud-section"><h3>편성된 함대 · ${number(formations.length)}개</h3>${formations.map((f) => `<article class="aud-fleet"><strong>${esc(f.name)} · ${f.status === "ready" ? "출격 대기" : "임무 중"}</strong><small>출발 행성 ${esc(planets.find((p) => String(p._id) === String(f.originPlanetId))?.name || "알 수 없음")}</small>${this.entries("ship", f.ships)}</article>`).join("") || '<p class="aud-empty">편성된 함대 없음</p>'}</section>
  <section class="aud-section"><h3>진행 중인 함대 이동 · ${number(movements.length)}건</h3>${movements.map((m) => `<article class="aud-fleet"><strong>${esc(m.formationName || "함대")} · ${esc(missionNames[m.mission] || m.mission)} · ${m.status === "returning" ? "귀환 중" : "이동 중"}</strong><p>[${number(m.origin?.galaxy)}:${number(m.origin?.system)}:${number(m.origin?.planet)}] → [${number(m.destination?.galaxy)}:${number(m.destination?.system)}:${number(m.destination?.planet)}]</p><small>${m.status === "returning" ? "귀환" : "도착"} 예정 ${date(m.status === "returning" ? m.returnTime : m.arrivalTime)}</small>${this.entries("ship", m.fleet)}${m.notice ? `<p>${esc(m.notice)}</p>` : ""}</article>`).join("") || '<p class="aud-empty">진행 중인 함대 이동 없음</p>'}</section>`;
  }
  planet(p, queues, formations) {
    const r = p.resources || {},
      prod = p.production || {},
      storage = p.storage || {},
      energy = p.energyState || {},
      pop = p.populationState || {},
      area = p.area || {};
    const inventory = p.fleet || {},
      unassigned = p.unassignedShips || {};
    return `<p class="aud-planet-title">${esc(p.name)} [${p.galaxy}:${p.system}:${p.planet}]</p><div class="aud-resource-table"><table><thead><tr><th>자원</th><th>보유</th><th>시간당 생산</th><th>저장 한도</th></tr></thead><tbody>${[
      ["metal", "금속"],
      ["crystal", "수정"],
      ["deuterium", "중수소"],
      ["food", "식량"],
    ]
      .map(
        ([id, label]) =>
          `<tr><th>${label}</th><td>${number(r[id])}</td><td>${signed(prod[id])}/h</td><td>${number(storage[id])}</td></tr>`,
      )
      .join("")}</tbody></table></div>
  ${stats([
    ["에너지 생산", number(energy.production)],
    ["에너지 소비", number(energy.consumption)],
    [
      "에너지 수지",
      `<span class="${energy.balance < 0 ? "aud-error" : ""}">${signed(energy.balance ?? r.energy)}</span>`,
    ],
    ["면적 사용 / 가용", `${number(area.used)} / ${number(area.usable)}칸`],
    ["건설 예약 면적", `${number(area.reserved)}칸`],
    ["남은 건설 면적", `${number(area.available)}칸`],
    ["인구 / 주거", `${number(pop.count)} / ${number(pop.housing)}`],
    ["취업 / 실업", `${number(pop.employed)} / ${number(pop.unemployed)}`],
    ["행복도 / 안정도", `${number(pop.happiness)} / ${number(pop.stability)}`],
    ["식량 수지", `${signed(pop.foodNet)}/h`],
  ])}
  <p class="aud-note">인구 성장: ${pop.growthAllowed ? "가능" : esc((pop.growthBlockers || []).join(" · ") || "—")}</p><h4>건물 레벨</h4>${this.entries("building", p.buildings, true)}<details><summary>미건설 시설</summary><div class="aud-entities">${
    (this.user.gameCatalog?.entities || [])
      .filter(
        (e) => e.entityType === "building" && !(p.buildings?.[e.entityId] > 0),
      )
      .map(
        (e) =>
          `<div><span>${esc(e.display?.name || e.entityId)}</span><b>Lv.0</b></div>`,
      )
      .join("") || "<p>없음</p>"
  }</div></details>
  <h4>주둔 함선 · ${number(Object.values(inventory).reduce((n, v) => n + Number(v || 0), 0))}기</h4>${this.entries("ship", inventory)}<details><summary>미편성 함선</summary>${this.entries("ship", unassigned)}</details>
  <h4>방어 시설</h4>${this.entries("defense", p.defense)}<h4>건설 · 조병창 대기열</h4>${this.queues(queues.filter((q) => q.type !== "research" && String(q.planetId) === String(this.planetIndex)))}`;
  }
}
