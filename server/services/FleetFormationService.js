const User = require("../models/User");
const entities = require("./EntityConfigService");
const { atomic, requireTransactions } = require("./transactions");
const { canUseEmblem } = require("../data/shop/emblems");
const {
  sameId,
  availableShips,
  validateComposition,
  normalizeName,
} = require("../utils/formationRules");
function fail(message, statusCode = 409, code = "STATE_CONFLICT") {
  throw Object.assign(new Error(message), { statusCode, code });
}
async function change(userId, action, id, input = {}) {
  await requireTransactions();
  return atomic(async () => {
    const user = await User.findById(userId);
    if (!user) fail("사용자를 찾을 수 없습니다.", 404);
    let formation = user.fleetFormations.id(id);
    if (action !== "create") {
      if (!formation) fail("함대를 찾을 수 없습니다.", 404);
      if (formation.status !== "ready")
        fail("임무 중인 함대는 변경할 수 없습니다.");
      if (input.expectedRevision !== formation.revision)
        fail("다른 곳에서 함대가 변경되었습니다. 최신 편성을 확인하십시오.");
    }
    if (action === "create") {
      const planet = user.planets[user.currentPlanet] || user.planets[0];
      if (!sameId(planet._id, input.originPlanetId))
        fail("선택한 출발 행성이 변경되었습니다.");
      let number = user.nextFleetNumber++;
      while (user.fleetFormations.some((f) => f.name === `${number}함대`))
        number = user.nextFleetNumber++;
      user.fleetFormations.push({
        number,
        name: `${number}함대`,
        originPlanetId: planet._id,
      });
      formation = user.fleetFormations[user.fleetFormations.length - 1];
    } else if (action === "delete") {
      formation.deleteOne();
    } else {
      const name = normalizeName(input.name);
      if (
        user.fleetFormations.some((f) => !sameId(f._id, id) && f.name === name)
      )
        fail("같은 이름의 함대가 있습니다.");
      formation.ships = validateComposition(
        input.ships,
        availableShips(user, formation.originPlanetId, id),
        (shipId) => entities.getEntity("ship", shipId)?.stats,
      );
      if (input.emblem !== undefined) {
        const emblem = typeof input.emblem === "string" ? input.emblem : null;
        if (emblem === null || !canUseEmblem(emblem, user.entitlements?.emblems))
          fail("사용할 수 없는 문장입니다.", 400, "EMBLEM_NOT_OWNED");
        formation.emblem = emblem;
      }
      formation.name = name;
      formation.revision += 1;
      formation.notice = "";
    }
    await user.save();
    return { formationId: formation._id, stateRevision: user.stateRevision };
  });
}
module.exports = { change, fail };
