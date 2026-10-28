import { catalog } from "../../data/catalog.js";
import { isLaunchable, fleetCrew } from "../../data/fleetMath.js";
import { escapeHtml, formatAmount } from "../dom.js";
import {
  profileOf,
  shipImages,
  fillThumbnails,
  formationStatus,
} from "./fleetCards.js";
const formatRate = (value) =>
  Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
export class FleetFormationView {
  constructor(root, { getState, create, save, remove, onCombat }) {
    Object.assign(this, { root, getState, create, save, remove, onCombat });
    this.scope = "current";
    this.selectedId = null;
    this.draft = null;
    this.dirty = false;
    this.busy = false;
    root.className = "formation-command";
    root.innerHTML = `<div class="fleet-command-intro"><div><p class="fleet-eyebrow">FLEET HANGAR</p><h3>함선을 모아, 나만의 함대로.</h3><p>함대를 선택하고 아래 함선 카드를 눌러 편성하십시오.</p></div><button class="cmd-btn primary" data-action="create">＋ 함대 만들기</button></div>
      <div class="formation-scope"><label>기지 범위 <select data-scope><option value="current">현재 행성</option><option value="all">전체 행성</option></select></label><small>함선·승무원은 각 함대의 기지에서 배정합니다.</small></div><div class="formation-layout"><aside class="formation-list" aria-label="내 함대"></aside><section class="formation-editor" aria-label="선택한 함대 편성"></section></div>
      <p class="fleet-inline-message" role="status"></p><div class="fleet-unsaved" hidden role="dialog" aria-modal="true" aria-label="편성 변경 저장"><h3>편성을 변경했습니다.</h3><p>이동하기 전에 변경 내용을 저장하시겠습니까?</p><div><button class="cmd-btn primary" data-action="save-leave">저장 후 이동</button><button class="cmd-btn" data-action="discard">버리고 이동</button><button class="cmd-btn" data-action="stay">계속 편집</button></div></div>`;
    this.list = root.querySelector(".formation-list");
    this.editor = root.querySelector(".formation-editor");
    this.message = root.querySelector('[role="status"]');
    this.modal = root.querySelector(".fleet-unsaved");
    root.addEventListener("click", (e) => this.click(e));
    root.addEventListener("input", (e) => {
      if (e.target.matches("[data-name]")) {
        this.draft.name = e.target.value;
        this.dirty = true;
        this.renderFooter();
      }
    });
    root.addEventListener("change", (e) => {
      if (e.target.matches("[data-scope]")) {
        const scope = e.target.value, apply = () => { this.scope = scope; this.selectedId = null; this.render(true); };
        if (this.guard(apply)) apply();
        e.target.value = this.scope;
      }
      if (e.target.matches("[data-quantity]"))
        this.setCount(e.target.dataset.quantity, Number(e.target.value));
    });
    this.modal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.modal.hidden = true;
        this.leaveAction = null;
        this.restoreFocus?.focus();
      }
      if (e.key === "Tab") {
        const buttons = [...this.modal.querySelectorAll("button")].filter(
          (b) => !b.disabled,
        );
        const first = buttons[0],
          last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    window.addEventListener("beforeunload", (e) => {
      if (this.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }
  guard(action) {
    if (this.busy) return false;
    if (!this.dirty) return true;
    this.leaveAction = action;
    this.restoreFocus = document.activeElement;
    this.modal.hidden = false;
    this.modal.querySelector("button").focus();
    return false;
  }
  leave() {
    const action = this.leaveAction;
    this.leaveAction = null;
    this.modal.hidden = true;
    action?.();
  }
  selected() {
    return this.getState().fleetFormations.find(
      (f) => f.id === this.selectedId,
    );
  }
  load(id) {
    this.selectedId = id;
    const f = this.selected();
    this.draft = f
      ? { name: f.name, ships: { ...f.ships }, revision: f.revision }
      : null;
    this.dirty = false;
    this.error = "";
    this.render(true);
  }
  available() {
    const state = this.getState();
    const f = this.selected();
    const planet = state.planets.find(
      (p) => String(p._id) === String(f?.originPlanetId),
    );
    const remaining = { ...planet?.fleet };
    for (const other of state.fleetFormations)
      if (
        other.status === "ready" &&
        other.id !== f?.id &&
        String(other.originPlanetId) === String(f?.originPlanetId)
      )
        for (const [id, n] of Object.entries(other.ships))
          remaining[id] = (remaining[id] || 0) - n;
    return remaining;
  }
  async click(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.formation) {
      const id = button.dataset.formation;
      if (id === this.selectedId) return;
      if (this.guard(() => this.load(id))) this.load(id);
      return;
    }
    if (button.dataset.ship) {
      const id = button.dataset.ship;
      const step = button.dataset.step;
      this.setCount(
        id,
        step === "all"
          ? this.available()[id]
          : (this.draft.ships[id] || 0) + Number(step),
      );
      return;
    }
    const action = button.dataset.action;
    if (action === "stay") {
      this.modal.hidden = true;
      this.leaveAction = null;
      this.restoreFocus?.focus();
      return;
    }
    if (action === "discard") {
      this.dirty = false;
      this.load(this.selectedId);
      this.leave();
      return;
    }
    if (action === "save-leave") {
      if (await this.persist()) this.leave();
      return;
    }
    if (action === "save") {
      await this.persist();
      return;
    }
    if (action === "reset") {
      this.load(this.selectedId);
      return;
    }
    if (action === "combat") {
      if (this.guard(() => this.onCombat())) this.onCombat();
      return;
    }
    if (action === "create") {
      const run = async () => {
        this.busy = true;
        this.renderFooter();
        try {
          const r = await this.create();
          this.load(r.formationId);
        } catch (e) {
          this.error = e.message;
        } finally {
          this.busy = false;
          this.render(true);
        }
      };
      if (this.guard(run)) await run();
      return;
    }
    if (action === "delete") {
      if (
        !window.confirm(
          `${this.selected()?.name}를 해산하시겠습니까? 배정한 함선은 미배정으로, 승무원은 행성 인구로 돌아갑니다. 주거 초과 시 과밀 상태가 됩니다.`,
        )
      )
        return;
      this.busy = true;
      try {
        await this.remove(this.selectedId, this.draft.revision);
        this.dirty = false;
        this.selectedId = null;
        this.draft = null;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.busy = false;
        this.render(true);
      }
    }
  }
  setCount(id, value) {
    if (this.selected()?.status !== "ready" || this.busy) return;
    const n = Math.min(
      Math.max(0, Math.floor(value) || 0),
      Math.max(0, this.available()[id] || 0),
    );
    if (n) this.draft.ships[id] = n;
    else delete this.draft.ships[id];
    const active = document.activeElement;
    const focus = active?.dataset.quantity
      ? { quantity: active.dataset.quantity }
      : active?.dataset.ship
        ? { ship: active.dataset.ship, step: active.dataset.step }
        : null;
    this.dirty = true;
    this.renderEditor();
    if (focus)
      [...this.editor.querySelectorAll("input,button")]
        .find((el) =>
          focus.quantity
            ? el.dataset.quantity === focus.quantity
            : el.dataset.ship === focus.ship && el.dataset.step === focus.step,
        )
        ?.focus({ preventScroll: true });
    this.renderFooter();
  }
  async persist() {
    if (this.busy || !this.draft) return false;
    this.busy = true;
    this.error = "";
    this.renderFooter();
    try {
      await this.save(this.selectedId, {
        name: this.draft.name,
        ships: this.draft.ships,
        expectedRevision: this.draft.revision,
      });
      this.dirty = false;
      this.load(this.selectedId);
      return true;
    } catch (error) {
      this.error = error.message;
      return false;
    } finally {
      this.busy = false;
      this.render(true);
    }
  }
  render(force = false) {
    const state = this.getState();
    const visible = state.fleetFormations.filter(f => this.scope === "all" || String(f.originPlanetId) === String(state.planet.id));
    this.root.querySelector('[data-scope]').value = this.scope;
    const signature = JSON.stringify([
      this.scope, state.planet.id, state.fleetFormations,
      state.fleetMovements.map((m) => [m.id, m.status]),
      state.fleet,
      state.planets.map((p) => [p.population?.count, p.fleetSupport]),
    ]);
    if (!force && signature === this.signature) return;
    this.signature = signature;
    if (!this.dirty && !this.busy) {
      if (!visible.some(f => f.id === this.selectedId))
        this.selectedId = visible[0]?.id || null;
      const f = this.selected();
      this.draft = f
        ? { name: f.name, ships: { ...f.ships }, revision: f.revision }
        : null;
    }
    this.list.innerHTML =
      `<div class="fleet-list-title">내 함대 <span>${visible.length}</span></div>` +
      visible
        .map((f) => {
          const current = String(f.originPlanetId) === String(state.planet.id);
          const status = formationStatus(f, state);
          return `<button type="button" class="formation-card ${this.selectedId === f.id ? "is-selected" : ""}" data-formation="${escapeHtml(f.id)}" aria-pressed="${this.selectedId === f.id}"><div class="formation-card-images">${shipImages(f.ships) || '<span class="empty-fleet-symbol">＋</span>'}</div><div class="formation-card-title"><strong>${escapeHtml(f.name)}</strong><span class="fleet-status ${status === "대기" ? "ready" : ""}">${status}</span></div><small>${formatAmount(profileOf(f.ships).ships)}척 · 승무원 ${formatAmount(f.crew || 0)}명 · ${current ? "현재 행성" : escapeHtml(state.planets.find((p) => String(p._id) === String(f.originPlanetId))?.name || "다른 행성")}</small></button>`;
        })
        .join("");
    fillThumbnails(this.list);
    if (
      (!this.dirty &&
        !this.busy &&
        !this.editor.contains(document.activeElement)) ||
      force
    )
      this.renderEditor();
    this.renderFooter();
  }
  renderEditor() {
    const f = this.selected();
    if (!f || !this.draft) {
      this.editor.innerHTML =
        '<div class="fleet-empty"><span>✦</span><h3>첫 함대를 편성하십시오.</h3><p>함대를 만들고 보유 함선을 배정하면 함대운용 화면에서 출격할 수 있습니다.</p><button class="cmd-btn primary" data-action="create">＋ 함대 만들기</button></div>';
      return;
    }
    const locked = f.status !== "ready" || this.busy;
    const ships = this.draft.ships;
    const profile = profileOf(ships);
    const available = this.available();
    const state = this.getState();
    const planet = state.planets.find(
      (p) => String(p._id) === String(f.originPlanetId),
    );
    const crewNeeded = fleetCrew(ships, id => catalog.get("ship", id)?.stats);
    const population = planet?.populationState;
    const supported =
      (population?.count || 0) + (planet?.fleetSupport?.crew || 0);
    const rateScale =
      supported > 0 && population?.foodConsumption != null
        ? population.foodConsumption / supported
        : f.crew > 0
          ? (f.upkeep?.food || 0) / f.crew
          : state.serverSpeed || 1;
    const metalCost =
      Object.entries(ships).reduce(
        (n, [id, count]) =>
          n + count * (catalog.get("ship", id)?.stats?.upkeep?.metal || 0),
        0,
      ) * (state.serverSpeed || 1);
    const fuelCost =
      Object.entries(ships).reduce(
        (n, [id, count]) =>
          n + count * (catalog.get("ship", id)?.stats?.upkeep?.deuterium || 0),
        0,
      ) * (state.serverSpeed || 1);
    const previewing = this.dirty || (!locked && (f.crew || 0) < crewNeeded);
    const shownUpkeep =
      !previewing && f.upkeep
        ? f.upkeep
        : {
            food: crewNeeded * rateScale,
            metal: metalCost,
            deuterium: fuelCost,
          };
    const ids = Object.keys(available).filter(
      (id) =>
        (available[id] > 0 || ships[id] > 0) &&
        isLaunchable(catalog.get("ship", id)?.stats),
    );
    this.editor.innerHTML = `<div class="formation-stage"><div class="stage-grid" aria-hidden="true"></div><div class="formation-stage-images">${shipImages(ships, 5) || '<span class="stage-empty">함선 카드를 선택해 배정하십시오</span>'}</div><div class="formation-stage-heading"><p class="fleet-eyebrow">${escapeHtml(formationStatus(f, this.getState()))} · ${escapeHtml(this.getState().planets.find((p) => String(p._id) === String(f.originPlanetId))?.name || "")}</p><label>함대 이름<input data-name maxlength="40" value="${escapeHtml(this.draft.name)}" ${locked ? "disabled" : ""}></label><p>${formatAmount(profile.ships)}<small> 척의 함선</small></p></div></div>
      <div class="formation-specs"><span>공격력 <strong>${formatAmount(profile.attack)}</strong></span><span>적재량 <strong>${formatAmount(profile.cargoCapacity)}</strong></span><span>속도 <strong>${formatAmount(profile.slowestSpeed)}</strong></span><span class="formation-upkeep">${previewing ? "저장 후 " : ""}시간당 유지비: 식량 <strong>${formatRate(shownUpkeep.food)}</strong> · 금속 <strong>${formatRate(shownUpkeep.metal)}</strong> · 중수소 <strong>${formatRate(shownUpkeep.deuterium)}</strong></span></div>
      <div class="formation-specs"><span>배치 승무원 <strong>${formatAmount(f.crew || 0)}명</strong> / 편성 필요 ${formatAmount(crewNeeded)}명</span><span>행성에서 배치 가능 <strong>${formatAmount(planet?.population?.count || 0)}명</strong></span></div>
      <p class="fleet-notice">기본 10명 + 함선 100척당 1명. 무인 함선만 있으면 0명입니다. 편성 저장 시 승무원을 행성 인구에서 배치합니다. 함선을 줄이거나 해산하면 복귀하며, 귀환 후에도 함대에 남습니다. 정박·출격 모두 유지비가 발생합니다.</p>
      ${planet?.fleetSupport?.shortages?.length ? '<p class="fleet-notice">보급 부족 · 식량·금속·중수소를 확보하기 전에는 출격할 수 없습니다.</p>' : ""}
      ${f.notice ? `<p class="fleet-notice">${escapeHtml(f.notice)}</p>` : ""}
      ${
        locked
          ? '<p class="fleet-notice">임무 중인 함대는 귀환 후 편집할 수 있습니다.</p>'
          : `<div class="ship-picker-heading"><h4>함선 배정</h4><span>카드를 눌러 추가 · 숫자로 빠르게 조절</span></div><div class="formation-ship-grid">${
              ids
                .map((id) => {
                  const entity = catalog.get("ship", id);
                  const n = ships[id] || 0;
                  return `<article class="formation-ship-card ${n ? "is-assigned" : ""}" data-ship-card="${escapeHtml(id)}"><button type="button" class="ship-add" data-ship="${escapeHtml(id)}" data-step="1" ${n >= available[id] ? "disabled" : ""} aria-label="${escapeHtml(entity.name)} 1척 추가"><img data-fleet-thumb="${escapeHtml(id)}" alt=""><strong>${escapeHtml(entity.name)}</strong><span>${n ? `${formatAmount(n)}척 배정됨` : "＋ 편성에 추가"}</span></button><small>추가 가능 ${formatAmount(Math.max(0, available[id] - n))}척 · ${entity.stats?.crew > 0 ? "함대 인력 필요" : "무인 운용"}</small><div class="ship-count-controls"><button data-ship="${escapeHtml(id)}" data-step="-1" ${n ? "" : "disabled"} aria-label="${escapeHtml(entity.name)} 1척 제거">−</button><input type="number" data-quantity="${escapeHtml(id)}" min="0" max="${available[id]}" value="${n}" inputmode="numeric" aria-label="${escapeHtml(entity.name)} 배정 수량"><button data-ship="${escapeHtml(id)}" data-step="1" ${n >= available[id] ? "disabled" : ""} aria-label="${escapeHtml(entity.name)} 1척 추가">＋</button></div><button class="ship-assign-all" data-ship="${escapeHtml(id)}" data-step="all" ${n >= available[id] ? "disabled" : ""}>가능 수량 모두 배정</button></article>`;
                })
                .join("") ||
              '<p class="fleet-notice">배정 가능한 함선이 없습니다. 조병창에서 건조하거나 다른 함대의 배정을 줄이십시오.</p>'
            }</div>`
      }
      <div class="formation-footer"></div>`;
    fillThumbnails(this.editor);
    this.renderFooter();
  }
  renderFooter() {
    this.message.textContent = this.error || "";
    this.root
      .querySelectorAll('[data-action="create"]')
      .forEach((b) => (b.disabled = this.busy));
    this.editor.querySelectorAll("input,[data-ship]").forEach((el) => {
      if (this.busy) el.disabled = true;
    });
    const footer = this.editor.querySelector(".formation-footer");
    const f = this.selected();
    if (!footer || !f) return;
    const conflict = this.dirty && f.revision !== this.draft.revision;
    footer.innerHTML = `<span class="draft-state" role="status">${conflict ? "서버 편성이 변경되었습니다. 다시 불러오거나 수량을 확인하십시오." : this.busy ? "저장 중…" : this.dirty ? "저장하지 않은 변경 사항" : "편성이 저장되었습니다."}</span><div>${f.status === "ready" ? `<button class="cmd-btn" data-action="delete" ${this.busy ? "disabled" : ""}>해산</button><button class="cmd-btn" data-action="reset" ${this.busy ? "disabled" : ""}>${conflict ? "다시 불러오기" : "되돌리기"}</button><button class="cmd-btn primary" data-action="save" ${(!this.dirty && (f.crew || 0) >= (f.requiredCrew || 0)) || this.busy || conflict ? "disabled" : ""}>편성 저장</button>` : '<button class="cmd-btn primary" data-action="combat">임무 보기 →</button>'}</div>`;
  }
}
