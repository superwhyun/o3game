import { bindCargoControls } from '../CargoControls.js';
import { escapeHtml as e, formatAmount, formatDuration } from "../dom.js";
import { catalog } from "../../data/catalog.js";
import { travelSeconds } from "../../data/fleetMath.js";
import { recommendedCargo } from "../../data/colonyPreparation.js";

export class DirectColonyView {
  constructor(root, { state, destination, onLaunch, onClose, isPending }) {
    const origin = { ...state.planet };
    const capacity = catalog.get("ship", "colonyShip")?.stats?.cargo || 0;
    const colonists = Math.min(
      10,
      Math.floor(origin.populationState?.count || 0),
      capacity,
    );
    const cargo = recommendedCargo(state.resources, capacity, colonists);
    const eta = travelSeconds(
      origin,
      destination,
      catalog.get("ship", "colonyShip")?.stats?.speed || 2500,
      100,
      {
        serverSpeed: state.serverSpeed,
        flightSpeedMultiplier: state.flightSpeedMultiplier,
      },
    );
    root.innerHTML = `<h2>식민선으로 개척</h2><p>${e(origin.name)} → [${destination.galaxy}:${destination.system}:${destination.planet}] · 편성 없이 식민선 1척 출발</p><p>편도 약 ${formatDuration(eta)} · 적재 공간 ${formatAmount(capacity)}칸</p><form class="direct-colony-form"><label class="field">탑승 인구<input name="colonists" type="number" min="1" max="${Math.min(capacity, Math.floor(origin.populationState?.count || 0))}" step="1" value="${colonists}" inputmode="numeric" required></label>${Object.entries(
      { metal: "금속", crystal: "수정", deuterium: "중수소" },
    )
      .map(
        ([id, name]) =>
          `<label class="field">${name}<input name="${id}" type="number" min="0" max="${Math.floor(state.resources[id] || 0)}" step="1" value="${cargo[id]}" inputmode="numeric" required></label>`,
      )
      .join(
        "",
      )}<p>인구 1명당 적재 공간 1칸을 사용합니다. 개척 성공 시 식민선은 소모되며, 인구와 자원은 새 행성에 정착합니다.</p><p role="status"></p><button type="submit" class="cmd-btn primary" ${colonists < 1 || isPending ? "disabled" : ""}>개척 출발</button></form>`;
    const form = root.querySelector('form');
    bindCargoControls(form, { capacity, stock: state.resources,
      population: () => Number(form.elements.colonists.value || 0), disabled: !!isPending });
    let busy = false;
    root.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      const values = Object.fromEntries(new FormData(event.target));
      const population = Number(values.colonists);
      const cargo = Object.fromEntries(
        ["metal", "crystal", "deuterium"].map((id) => [id, Number(values[id])]),
      );
      const message = form.querySelector(":scope > [role=status]");
      if (
        !Number.isSafeInteger(population) ||
        population < 1 ||
        Object.values(cargo).some((n) => !Number.isSafeInteger(n) || n < 0) ||
        population + Object.values(cargo).reduce((a, b) => a + b, 0) > capacity
      ) {
        message.textContent =
          "인구와 자원의 합계가 적재 공간 안에 들어가도록 입력하십시오.";
        return;
      }
      busy = true;
      const button = root.querySelector("button[type=submit]");
      button.disabled = true;
      message.textContent = "식민선 출발 처리 중…";
      try {
        await onLaunch({
          mission: "colonize",
          originPlanetId: origin.id,
          destination: { ...destination },
          colonists: population,
          cargo,
        });
        onClose();
      } catch (error) {
        message.textContent =
          error.status && error.status < 500
            ? error.message
            : "출발 결과 확인 중입니다. 함대운용에서 임무 상태를 확인하십시오.";
        // An ambiguous response is recovered with the same request ID by the shared fleet dispatcher.
        if (error.status && error.status < 500) {
          busy = false;
          button.disabled = false;
        }
      }
    });
  }
}
