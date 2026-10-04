// Isolated browser fixtures. Never points at the player's database.
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");
async function main() {
  const uri = process.env.FLEET_PREVIEW_URI;
  if (!uri || !/\/_?cosmic_fleet_ui_test(\?|$)/.test(uri))
    throw new Error("Dedicated cosmic_fleet_ui_test URI required");
  await mongoose.connect(uri);
  const User = require("../models/User");
  const Config = require("../models/GameConfig");
  await mongoose.connection.dropDatabase();
  await Config.getConfig();
  await require("../services/EntityConfigService").initialize();
  // Recreate explicitly: another preview server may have cached Model.init().
  for (const model of [
    User,
    require("../models/FleetMovement"),
    require("../models/BattleReport"),
    require("../models/BuildingQueue"),
  ])
    await model.createIndexes();
  const previewCredential = randomUUID();
  const player = await User.create({
    username: "fleet_ui_test",
    email: "fleet_ui_test@example.test",
    password: previewCredential,
    isAdmin: true,
    adminRole: "superadmin",
    planets: [
      {
        name: "이젤론",
        galaxy: 1,
        system: 1,
        planet: 4,
        fleet: {
          lightFighter: 100,
          heavyFighter: 40,
          cruiser: 20,
          battleship: 12,
          smallCargo: 15,
        },
        resources: { metal: 9000, crystal: 9000, deuterium: 9000 },
      },
    ],
  });
  await User.create({
    username: "target_ui_test",
    email: "target_ui_test@example.test",
    password: previewCredential,
    planets: [
      {
        name: "하이네센",
        galaxy: 1,
        system: 1,
        planet: 8,
        resources: { metal: 300, crystal: 200, deuterium: 100 },
      },
    ],
  });
  const jwt = require("jsonwebtoken");
  const data = {
    token: jwt.sign({ userId: String(player._id) }, process.env.JWT_SECRET, {
      expiresIn: "2h",
    }),
    user: { username: player.username, id: String(player._id), isAdmin: true },
    planetId: String(player.planets[0]._id),
    password: previewCredential,
  };
  require("node:fs").writeFileSync(
    "/tmp/oogame-fleet-preview.json",
    JSON.stringify(data),
    { mode: 0o600 },
  );
  await mongoose.disconnect();
  console.log("Isolated fleet UI fixtures ready.");
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
