const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");
const base = process.env.FLEET_TEST_MONGODB_URI;
test(
  "crew transfers, upkeep settlement, supply blockade, loss and overcapacity disband",
  { skip: !base },
  async () => {
    const uri = base.replace(/\/[^/?]+(?=\?|$)/, "/cosmic_fleet_crew_test");
    await mongoose.connect(uri);
    const User = require("../models/User");
    const Config = require("../models/GameConfig");
    const Movement = require("../models/FleetMovement");
    const crew = require("../utils/fleetCrew");
    const forms = require("../services/FleetFormationService");
    const fleets = require("../services/FleetService");
    const { settleUserState } = require("../services/GameStateService");
    const { applyOfflineProduction } = require("../utils/planetEconomy");
    try {
      await mongoose.connection.dropDatabase();
      await require("../services/EntityConfigService").initialize();
      await User.init();
      await Movement.init();
      const config = await Config.getConfig();
      config.serverSpeed = 1;
      config.populationSettings.growthHours = 100000;
      await config.save();
      const user = await User.createWithHomePlanet({
        username: "crew-test",
        email: "crew@test.invalid",
        password: "test-password",
      });
      user.planets[0].population.count = 100;
      user.planets[0].population.baseHousing = 100;
      user.planets[0].population.baseFood = 100;
      user.planets[0].fleet.lightFighter = 150;
      user.planets[0].resources.food = 1000;
      user.planets[0].resources.metal = 1000;
      user.planets[0].resources.deuterium = 1000;
      user.markModified("planets");
      await user.save();
      assert.equal(
        (await User.findById(user._id)).planets[0].fleet.lightFighter,
        150,
      );
      const id = (
        await forms.change(user._id, "create", null, {
          originPlanetId: String(user.planets[0]._id),
        })
      ).formationId;
      await forms.change(user._id, "update", id, {
        expectedRevision: 1,
        name: "crew fleet",
        ships: { lightFighter: 40 },
      });
      let result = await settleUserState(user._id);
      assert.equal(result.user.planets[0].population.count, 90);
      assert.equal(result.user.fleetFormations.id(id).crew, 10);
      assert.equal(result.snapshot.planets[0].fleetSupport.crew, 10);
      assert.equal(result.snapshot.planets[0].fleetSupport.hourly.food, 10);
      assert.equal(result.snapshot.fleetFormations[0].requiredCrew, 10);
      assert.equal(
        result.snapshot.planets[0].populationState.foodConsumption,
        100,
      );
      await User.updateOne({ _id: user._id }, { $set: { 'planets.0.population.count': 0 } });
      await assert.rejects(
        forms.change(user._id, "update", id, {
          expectedRevision: 2,
          name: "crew fleet",
          ships: { lightFighter: 110 },
        }),
        { code: "INSUFFICIENT_POPULATION" },
      );
      await User.updateOne({ _id: user._id }, { $set: { 'planets.0.population.count': 90 } });
      result = await settleUserState(user._id);
      assert.equal(result.user.fleetFormations.id(id).crew, 10);
      assert.equal(result.user.planets[0].population.count, 90);
      // A one-hour upkeep period is identical whether settled once or in many reads.
      const single = result.user.planets[0].toObject();
      const split = structuredClone(single);
      const support = crew.fleetSupport(
        result.user,
        result.user.planets[0],
        config,
      );
      single.$locals = { fleetSupport: support };
      split.$locals = { fleetSupport: support };
      const start = new Date(single.lastUpdate);
      applyOfflineProduction(single, config, new Date(+start + 3600000));
      for (let i = 1; i <= 12; i++)
        applyOfflineProduction(split, config, new Date(+start + i * 300000));
      for (const key of ["metal", "deuterium", "food"])
        assert.ok(
          Math.abs(single.resources[key] - split.resources[key]) < 1e-6,
        );
      assert.equal(
        single.resources.food,
        result.user.planets[0].resources.food,
      );
      assert.ok(
        Math.abs(
          single.resources.metal - result.user.planets[0].resources.metal - 26,
        ) < 1e-6,
      );
      // Loss removes the corresponding crew rather than returning them to the colony.
      const formation = result.user.fleetFormations.id(id);
      const losses = crew.applyCrewLoss(formation, { lightFighter: 25 });
      assert.equal(losses, 4);
      assert.equal(formation.crew, 6);
      result.user.planets[0].fleet.lightFighter = 25;
      result.user.planets[0].population.baseHousing = 60;
      await result.user.save();
      await forms.change(user._id, "delete", id, {
        expectedRevision: formation.revision,
      });
      result = await settleUserState(user._id);
      assert.equal(result.user.planets[0].population.count, 96);
      assert.ok(
        result.snapshot.planets[0].populationState.growthBlockers.includes(
          "주거 부족",
        ),
      );
      assert.equal(result.snapshot.planets[0].fleetSupport.crew, 0);
      // Reassigning after overcapacity is allowed; lack of supplies blocks launch.
      const next = (
        await forms.change(user._id, "create", null, {
          originPlanetId: String(user.planets[0]._id),
        })
      ).formationId;
      await forms.change(user._id, "update", next, {
        expectedRevision: 1,
        name: "supply fleet",
        ships: { lightFighter: 10 },
      });
      let owner = await User.findById(user._id);
      owner.planets[0].population.baseFood = 0;
      owner.planets[0].resources.food = 0;
      await owner.save();
      const target = await User.createWithHomePlanet({
        username: "crew-target",
        email: "target@test.invalid",
        password: "test-password",
      });
      const order = {
        requestId: randomUUID(),
        formationId: String(next),
        originPlanetId: String(owner.planets[0]._id),
        expectedRevision: 2,
        expectedTargetPlanetId: String(target.planets[0]._id),
        mission: "attack",
        destination: {
          galaxy: target.planets[0].galaxy,
          system: target.planets[0].system,
          planet: target.planets[0].planet,
        },
      };
      await assert.rejects(fleets.launch(user._id, order), {
        code: "FLEET_SUPPLY_SHORTAGE",
      });
      owner = await User.findById(user._id);
      owner.planets[0].resources.food = 1000;
      await owner.save();
      const movement = await fleets.launch(user._id, order);
      assert.equal(
        (await User.findById(user._id)).fleetFormations.id(next).crew,
        10,
      );
      await fleets.processMovement(
        movement._id,
        new Date(+movement.arrivalTime + 1),
      );
      const returning = await Movement.findById(movement._id);
      // Returning is allowed even with supplies exhausted.
      owner = await User.findById(user._id);
      owner.planets[0].resources.food = 0;
      await owner.save();
      await fleets.processMovement(
        movement._id,
        new Date(+returning.returnTime + 1),
      );
      owner = await User.findById(user._id);
      assert.equal(owner.fleetFormations.id(next).crew, 10);
      assert.equal(owner.fleetFormations.id(next).status, "ready");
      assert.equal(owner.planets[0].population.count, 86);
      assert.equal((await Movement.findById(movement._id)).status, "completed");
      // Actual battle settlement destroys crew with ships on both sides.
      const Report = require("../models/BattleReport");
      const Combat = require("../services/CombatService");
      owner.planets[0].resources.food = 1000;
      owner.markModified("planets");
      await owner.save();
      const defenseOwner = await User.findById(target._id);
      defenseOwner.planets[0].fleet.lightFighter = 6;
      defenseOwner.planets[0].resources.food = 1000;
      defenseOwner.markModified("planets");
      await defenseOwner.save();
      const defendId = (
        await forms.change(target._id, "create", null, {
          originPlanetId: String(target.planets[0]._id),
        })
      ).formationId;
      await forms.change(target._id, "update", defendId, {
        expectedRevision: 1,
        name: "defender crew",
        ships: { lightFighter: 6 },
      });
      const attack = await fleets.launch(user._id, {
        ...order,
        requestId: randomUUID(),
        mission: "attack",
        expectedRevision: owner.fleetFormations.id(next).revision,
      });
      const originalBattle = Combat.simulateBattle8Wave;
      Combat.simulateBattle8Wave = async () => ({
        winner: "attacker",
        attackerLosses: { lightFighter: 4 },
        defenderLosses: { lightFighter: 2 },
        rounds: [],
        debrisField: { metal: 0, crystal: 0 },
      });
      try {
        await fleets.processMovement(
          attack._id,
          new Date(+attack.arrivalTime + 1),
        );
        await fleets.processMovement(
          attack._id,
          new Date(+attack.arrivalTime + 1),
        );
      } finally {
        Combat.simulateBattle8Wave = originalBattle;
      }
      owner = await User.findById(user._id);
      assert.equal(owner.fleetFormations.id(next).crew, 6);
      assert.equal(owner.planets[0].population.count, 86);
      const defender = await User.findById(target._id);
      assert.equal(defender.fleetFormations.id(defendId).crew, 6);
      const report = await Report.findOne({ movementId: attack._id });
      assert.equal(report.result.attackerCrewLosses, 4);
      assert.equal(report.result.defenderCrewLosses, 4);
      const battleReturn = await Movement.findById(attack._id);
      await fleets.processMovement(
        attack._id,
        new Date(+battleReturn.returnTime + 1),
      );
      owner = await User.findById(user._id);
      assert.equal(owner.fleetFormations.id(next).crew, 6);
      assert.equal(owner.planets[0].population.count, 86);
      // Legacy crew enrollment moves actual residents once and never invents people.
      owner.fleetFormations.push({
        number: 99,
        name: "legacy crew",
        originPlanetId: owner.planets[0]._id,
        ships: { lightFighter: 2 },
      });
      await owner.save();
      const migrated = await settleUserState(user._id);
      assert.equal(migrated.user.planets[0].population.count, 76);
      assert.equal(
        migrated.user.fleetFormations.find((f) => f.name === "legacy crew")
          .crew,
        10,
      );
      assert.equal(
        (await settleUserState(user._id)).user.planets[0].population.count,
        76,
      );
      // Two simultaneous allocations cannot spend the same residents.
      const raceUser = await User.createWithHomePlanet({
        username: "crew-race",
        email: "race@test.invalid",
        password: "test-password",
      });
      raceUser.planets[0].fleet.lightFighter = 20;
      raceUser.planets[0].resources.food = 1000;
      raceUser.markModified("planets");
      await raceUser.save();
      const one = (
        await forms.change(raceUser._id, "create", null, {
          originPlanetId: String(raceUser.planets[0]._id),
        })
      ).formationId;
      const two = (
        await forms.change(raceUser._id, "create", null, {
          originPlanetId: String(raceUser.planets[0]._id),
        })
      ).formationId;
      const changes = await Promise.allSettled(
        [one, two].map((formationId, index) =>
          forms.change(raceUser._id, "update", formationId, {
            expectedRevision: 1,
            name: `race ${index}`,
            ships: { lightFighter: 8 },
          }),
        ),
      );
      assert.equal(changes.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        changes.find((r) => r.status === "rejected").reason.code,
        "INSUFFICIENT_POPULATION",
      );
      const raceAfter = await User.findById(raceUser._id);
      assert.equal(raceAfter.planets[0].population.count, 0);
      assert.equal(
        raceAfter.fleetFormations.reduce((n, f) => n + f.crew, 0),
        10,
      );
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
