/**
 * Starter monster types (small / medium / large). `scripts/seedMonsters.js` writes them to the
 * database; afterwards they are ordinary administrator-editable types.
 *
 * Stats were tuned with the in-game simulator against reference fleets without technology bonuses
 * (small: 50 cruisers, medium: 200 cruisers, large: 1500 cruisers + 300 battleships). A reference
 * fleet loses roughly 5-30% of its ships per battle and removes 20-85% of the monster's hull.
 * Monsters keep their damage between battles and do not regenerate, so several fleets wear one
 * down over many fights. Fleets with weapon/shield/armor technology fare much better.
 */
module.exports = [
  {
    typeId: 'abyss-whelp',
    name: '심연 새끼',
    description: '무리 지어 떠도는 소형 괴수. 함대 하나로도 쓰러뜨릴 수 있다.',
    techs: { weapons: 0, shield: 0, armor: 0 },
    regenPerHour: 0,
    defaultPoolMicro: '20000000',
    model: { body: 'orb', color: '#5b6fb5', eyes: 3, spikes: 5, tentacles: 4, seed: 11 },
    units: [
      { unitId: 'whelp', name: '심연 새끼', count: 30, wave: 0, combatClass: 'SWARM', stats: { hull: 20000, shield: 20, attack: 10000 }, wreck: { metal: 4000, crystal: 2000 } }
    ]
  },
  {
    typeId: 'void-carapace',
    name: '공허 갑각수',
    description: '단단한 껍질의 중형 괴수. 여러 사령관이 힘을 모아야 한다.',
    techs: { weapons: 2, shield: 2, armor: 3 },
    regenPerHour: 0,
    defaultPoolMicro: '100000000',
    model: { body: 'crab', color: '#a8432e', eyes: 4, spikes: 8, tentacles: 0, seed: 23 },
    units: [
      { unitId: 'carapace', name: '갑각수', count: 40, wave: 0, combatClass: 'HEAVY', stats: { hull: 120000, shield: 150, attack: 18000 }, wreck: { metal: 30000, crystal: 15000 } },
      { unitId: 'spitter', name: '산성 사수', count: 60, wave: 1, combatClass: 'SWARM', stats: { hull: 30000, shield: 50, attack: 10500 }, wreck: { metal: 8000, crystal: 4000 } }
    ]
  },
  {
    typeId: 'nebula-sovereign',
    name: '성운의 군주',
    description: '수많은 호위를 거느린 대형 괴수. 서버 전체가 달라붙어야 쓰러진다.',
    techs: { weapons: 5, shield: 5, armor: 5 },
    regenPerHour: 0,
    defaultPoolMicro: '500000000',
    model: { body: 'manta', color: '#7a3f9d', eyes: 6, spikes: 12, tentacles: 6, seed: 37 },
    units: [
      { unitId: 'sovereign', name: '성운의 군주', count: 8, wave: 0, combatClass: 'HEAVY', stats: { hull: 3000000, shield: 800, attack: 50000 }, wreck: { metal: 600000, crystal: 300000 } },
      { unitId: 'warden', name: '군주의 수호자', count: 200, wave: 1, combatClass: 'HEAVY', stats: { hull: 150000, shield: 200, attack: 21000 }, wreck: { metal: 40000, crystal: 20000 } },
      { unitId: 'brood', name: '군주의 무리', count: 500, wave: 2, combatClass: 'SWARM', stats: { hull: 40000, shield: 50, attack: 10000 }, wreck: { metal: 10000, crystal: 5000 } }
    ]
  }
];
