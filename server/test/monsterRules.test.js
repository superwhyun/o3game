const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../utils/monsterRules');

const unit = (extra = {}) => ({ unitId: 'kraken', name: '크라켄', count: 10, wave: 0, stats: { hull: 1000, shield: 5, attack: 100 }, ...extra });
const type = (extra = {}) => ({ typeId: 'sea-kraken', name: '심해 크라켄', units: [unit()], ...extra });

test('monster definitions are validated field by field and normalized', () => {
  const ok = rules.validateMonsterType(type({ techs: { armor: 2 }, regenPerHour: 1.5, defaultPoolMicro: '5000000' }));
  assert.equal(ok.units[0].combatClass, 'HEAVY');
  assert.deepEqual(ok.units[0].wreck, { metal: 0, crystal: 0 });
  assert.deepEqual(ok.techs, { weapons: 0, shield: 0, armor: 2 });
  assert.equal(ok.regenPerHour, 1.5);

  const reject = (input, pattern) => assert.throws(() => rules.validateMonsterType(input), (error) => error.name === 'MonsterRuleError' && error.statusCode === 400 && (!pattern || pattern.test(error.message)));
  reject(null);
  reject(type({ typeId: 'Bad Id' }), /typeId/);
  reject(type({ name: '  ' }), /이름/);
  reject(type({ units: [] }), /유닛 종류/);
  reject(type({ units: Array.from({ length: 9 }, (_, i) => unit({ unitId: `u${i}x` })) }), /유닛 종류/);
  reject(type({ units: [unit({ unitId: 'cruiser' })] }), /카탈로그/);
  reject(type({ units: [unit(), unit()] }), /중복/);
  reject(type({ units: [unit({ count: 0 })] }), /수량/);
  reject(type({ units: [unit({ count: 1500 }), unit({ unitId: 'second', count: 600 })] }), /총 수/);
  reject(type({ units: [unit({ stats: { hull: 0, attack: 1 } })] }), /장갑/);
  reject(type({ units: [unit({ stats: { hull: 10, shield: -1 } })] }), /방어막/);
  reject(type({ units: [unit({ stats: { hull: 10, rapidFire: { nothing: 3 } } })] }), /속사/);
  // Rapid fire multiplies every volley regardless of the enemy fleet, so the total is capped.
  reject(type({ units: [unit({ stats: { hull: 10, rapidFire: { lightFighter: 3, cruiser: 3 } } })] }), /속사 합계/);
  assert.ok(rules.validateMonsterType(type({ units: [unit({ stats: { hull: 10, rapidFire: { lightFighter: 3, cruiser: 2 } } })] })));
  reject(type({ units: [unit({ wave: 8 })] }), /웨이브/);
  reject(type({ units: [unit({ combatClass: 'MAGIC' })] }), /전투 분류/);
  reject(type({ units: [unit({ wreck: { metal: -5 } })] }), /잔해/);
  reject(type({ techs: { armor: 101 } }), /기술/);
  reject(type({ regenPerHour: 101 }), /재생률/);
  reject(type({ defaultPoolMicro: '-1' }), /보상 풀/);
  reject(type({ model: { note: 'x'.repeat(700) } }), /모델/);
  reject(type({ model: { body: 'cube' } }), /모델 형태/);
  reject(type({ model: { color: 'red' } }), /색상/);
  reject(type({ model: { tentacles: 11 } }), /tentacles/);
  assert.deepEqual(rules.validateMonsterType(type({ model: { body: 'crab', color: '#AA3322', eyes: 4, seed: 7 } })).model, { body: 'crab', color: '#aa3322', eyes: 4, seed: 7 });
});

test('health is tracked per unit, never rounds a living monster to zero and heals slowly when configured', () => {
  const snapshot = rules.validateMonsterType(type({ units: [unit({ count: 4 }), unit({ unitId: 'spawn', count: 2, stats: { hull: 500 } })], techs: { armor: 10 }, regenPerHour: 10 }));
  const state = rules.initialState(snapshot);
  assert.equal(rules.hullOf(snapshot.units[0].stats, snapshot.techs), 2000); // armor tech doubles the hull
  assert.equal(rules.maxHull(snapshot), 4 * 2000 + 2 * 1000);
  assert.equal(rules.remainingHull(state), 10000);
  assert.equal(rules.hpPercent(snapshot, state), 100);

  const nearlyDead = { units: [{ unitId: 'kraken', hulls: [1] }, { unitId: 'spawn', hulls: [] }], lastRegenAt: null };
  assert.equal(rules.hpPercent(snapshot, nearlyDead), 0.1);
  assert.equal(rules.hpPercent(snapshot, { units: [{ unitId: 'kraken', hulls: [] }, { unitId: 'spawn', hulls: [] }] }), 0);

  const hurt = { units: [{ unitId: 'kraken', hulls: [500, 2000] }, { unitId: 'spawn', hulls: [100] }], lastRegenAt: new Date('2026-01-01T00:00:00Z') };
  const healed = rules.applyRegen(snapshot, hurt, new Date('2026-01-01T02:00:00Z')); // 10%/hour of full hull for 2h
  assert.deepEqual(healed.units[0].hulls, [500 + 2 * 200, 2000]);
  assert.deepEqual(healed.units[1].hulls, [100 + 2 * 100]);
  const capped = rules.applyRegen(snapshot, hurt, new Date('2026-01-03T00:00:00Z'));
  assert.deepEqual(capped.units[0].hulls, [2000, 2000]);
  const noRegen = rules.validateMonsterType(type());
  assert.equal(rules.applyRegen(noRegen, hurt, new Date('2026-02-01')).units, hurt.units);
});

test('combat inputs follow each unit\'s wave and carry its damage', () => {
  const snapshot = rules.validateMonsterType(type({ units: [unit({ count: 3, wave: 2 }), unit({ unitId: 'guard', count: 1, wave: 0 })] }));
  const state = { units: [{ unitId: 'kraken', hulls: [10, 20] }, { unitId: 'guard', hulls: [] }] };
  const { waves, inlineUnits } = rules.buildDefense(snapshot, state);
  assert.deepEqual(waves[2].ships, { kraken: 2 });
  assert.deepEqual(waves[0].ships, {}); // dead groups are not sent into battle
  assert.deepEqual(inlineUnits.kraken.currentHull, [10, 20]);
  assert.equal(inlineUnits.kraken.stats.combatClass, 'HEAVY');
  assert.equal(inlineUnits.guard, undefined);
  const after = rules.stateAfter(snapshot, state, { kraken: [7.6] }, new Date());
  assert.deepEqual(after.units.map((u) => u.hulls), [[8], []]);
  const lost = rules.destroyedWreck(rules.validateMonsterType(type({ units: [unit({ wreck: { metal: 30, crystal: 10 } })] })), { units: [{ unitId: 'kraken', hulls: [1, 1, 1, 1] }] }, { units: [{ unitId: 'kraken', hulls: [1] }] });
  assert.deepEqual(lost, { destroyed: { kraken: 3 }, wreck: { metal: 90, crystal: 30 } });
});

test('payout shares split the pool by damage, round down and never exceed it', () => {
  const shares = rules.computeShares(10_000_000n, [{ userId: 'a', damage: 600 }, { userId: 'b', damage: 300 }, { userId: 'c', damage: 100 }, { userId: 'nobody', damage: 0 }]);
  assert.deepEqual(shares.map((s) => [s.userId, s.rewardMicro]), [['a', 6_000_000n], ['b', 3_000_000n], ['c', 1_000_000n]]);
  const odd = rules.computeShares(100n, [{ userId: 'a', damage: 1 }, { userId: 'b', damage: 1 }, { userId: 'c', damage: 1 }]);
  assert.deepEqual(odd.map((s) => s.rewardMicro), [33n, 33n, 33n]);
  assert.ok(odd.reduce((n, s) => n + s.rewardMicro, 0n) <= 100n);
  assert.deepEqual(rules.computeShares(0n, [{ userId: 'a', damage: 5 }]), []);
  assert.deepEqual(rules.computeShares(100n, []), []);
  // Splitting one account into many does not change the total anyone can extract.
  const together = rules.computeShares(1000n, [{ userId: 'sybil', damage: 500 }, { userId: 'other', damage: 500 }])[0].rewardMicro;
  const split = rules.computeShares(1000n, [{ userId: 's1', damage: 250 }, { userId: 's2', damage: 250 }, { userId: 'other', damage: 500 }]);
  assert.equal(split[0].rewardMicro + split[1].rewardMicro, together);
  const huge = rules.computeShares(10n ** 17n, [{ userId: 'a', damage: 9e12 }, { userId: 'b', damage: 1e12 }]);
  assert.equal(huge[0].rewardMicro + huge[1].rewardMicro, 10n ** 17n);
});

test('seeded randomness is reproducible per event and move', () => {
  const a = rules.seededRandom('event-1:0'), b = rules.seededRandom('event-1:0'), c = rules.seededRandom('event-1:1');
  const first = [a(), a(), a()], second = [b(), b(), b()];
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, [c(), c(), c()]);
  assert.ok(first.every((value) => value >= 0 && value < 1));
});

test('the starter presets are valid and grow from small to large', async () => {
  const presets = require('../data/monsters/presets');
  assert.deepEqual(presets.map((p) => p.typeId), ['abyss-whelp', 'void-carapace', 'nebula-sovereign']);
  for (const preset of presets) assert.ok(rules.validateMonsterType(preset));
  const hulls = presets.map((p) => rules.maxHull(rules.validateMonsterType(p)));
  assert.ok(hulls[0] < hulls[1] && hulls[1] < hulls[2], 'small < medium < large');
  const pools = presets.map((p) => BigInt(p.defaultPoolMicro));
  assert.ok(pools[0] < pools[1] && pools[1] < pools[2]);
});
