import { catalog } from "../../data/catalog.js";
import { fleetProfile } from "../../data/fleetMath.js";
import { escapeHtml, formatAmount } from "../dom.js";
import { getShipThumbnail } from "../../three/ships/ShipThumbnails.js";
import { resolveModelSpec } from "../../three/ships/ShipModelFactory.js";
export const profileOf = (ships) =>
  fleetProfile(ships || {}, (id) => catalog.get("ship", id)?.stats);
export function shipImages(ships, limit = 3) {
  return Object.entries(ships || {})
    .filter(([, n]) => n > 0)
    .slice(0, limit)
    .map(
      ([id]) =>
        `<img data-fleet-thumb="${escapeHtml(id)}" alt="${escapeHtml(catalog.get("ship", id)?.name || id)}">`,
    )
    .join("");
}
export function fillThumbnails(root) {
  for (const img of root.querySelectorAll("img[data-fleet-thumb]")) {
    const entity = catalog.get("ship", img.dataset.fleetThumb);
    if (entity)
      getShipThumbnail(resolveModelSpec(entity), entity.id)
        .then((url) => {
          if (img.isConnected) img.src = url;
        })
        .catch(() => {
          img.classList.add("thumb-unavailable");
        });
  }
}
export function compositionText(ships) {
  return Object.entries(ships || {})
    .filter(([, n]) => n > 0)
    .map(
      ([id, n]) =>
        `${catalog.get("ship", id)?.name || id} × ${formatAmount(n)}`,
    )
    .join(" · ");
}
export function formationStatus(formation, state) {
  if (formation.status === "onMission")
    return state.fleetMovements?.find(
      (m) => String(m.id) === String(formation.activeMovementId),
    )?.status === "returning"
      ? "귀환 중"
      : "출격 중";
  return profileOf(formation.ships).ships ? "대기" : "빈 편성";
}
