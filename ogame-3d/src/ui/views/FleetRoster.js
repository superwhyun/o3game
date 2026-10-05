import { escapeHtml, formatAmount } from "../dom.js";
import {
  profileOf,
  shipImages,
  fillThumbnails,
  compositionText,
} from "./fleetCards.js";
export class FleetRoster {
  constructor(root, { getFormations, isPending, onManage, onChange }) {
    Object.assign(this, { root, getFormations, isPending, onManage, onChange });
    this.selectedId = null;
    root.className = "combat-fleet-roster";
    root.innerHTML =
      '<div class="combat-roster-heading"><h3>출격 가능한 함대</h3><button class="holo-btn-small" data-manage>편성 →</button></div><p class="combat-roster-hint">함대를 끌어 목표 행성에 놓으십시오.<br>함대 선택 후 행성을 눌러도 출격할 수 있습니다.</p><div class="combat-fleet-list"></div>';
    this.list = root.querySelector(".combat-fleet-list");
    root
      .querySelector("[data-manage]")
      .addEventListener("click", () => onManage());
    root.addEventListener("click", (e) => {
      const card = e.target.closest("[data-combat-fleet]");
      if (card && !card.disabled) this.select(card.dataset.combatFleet);
    });
  }
  get formation() {
    return this.getFormations().find((f) => f.id === this.selectedId);
  }
  get token() {
    return (
      [...this.list.querySelectorAll("[data-combat-fleet]")].find(
        (el) => el.dataset.combatFleet === this.selectedId,
      ) || this.list
    );
  }
  fleet() {
    return this.formation?.ships || {};
  }
  profile() {
    return profileOf(this.fleet());
  }
  select(id) {
    this.selectedId = id;
    for (const card of this.list.querySelectorAll("[data-combat-fleet]")) {
      card.classList.toggle("is-selected", card.dataset.combatFleet === id);
      card.setAttribute(
        "aria-pressed",
        String(card.dataset.combatFleet === id),
      );
    }
    this.onChange?.();
  }
  render() {
    const formations = this.getFormations();
    if (!formations.some((f) => f.id === this.selectedId))
      this.selectedId =
        formations.find((f) => !this.isPending(f.id))?.id || null;
    const signature = JSON.stringify(
      formations.map((f) => [
        f.id,
        f.name,
        f.revision,
        f.ships,
        this.isPending(f.id),
      ]),
    );
    if (signature === this.signature) return;
    this.signature = signature;
    this.list.innerHTML =
      formations
        .map((f) => {
          const profile = profileOf(f.ships),
            pending = this.isPending(f.id);
          return `<button type="button" class="combat-fleet-card ${f.id === this.selectedId ? "is-selected" : ""}" data-combat-fleet="${escapeHtml(f.id)}" aria-pressed="${f.id === this.selectedId}" ${pending ? "disabled" : ""}><div class="combat-fleet-images">${shipImages(f.ships)}</div><div class="combat-card-heading"><strong>${escapeHtml(f.name)}</strong><span>${formatAmount(profile.ships)}척</span></div><small>${escapeHtml(compositionText(f.ships))}</small><div class="combat-card-bottom"><span>공격력 ${formatAmount(profile.attack)}</span><b>${pending ? "결과 확인 중…" : "끌어서 출격 ↗"}</b></div></button>`;
        })
        .join("") ||
      '<div class="fleet-empty compact"><span>✦</span><h4>출격 가능한 함대가 없습니다.</h4><p>함대를 편성하거나 진행 중인 임무의 귀환을 기다리십시오.</p><button class="cmd-btn" data-empty-manage>함대편성 →</button></div>';
    this.list
      .querySelector("[data-empty-manage]")
      ?.addEventListener("click", () => this.onManage());
    fillThumbnails(this.list);
  }
}
