const { AsyncLocalStorage } = require('node:async_hooks');
const battleRandom = new AsyncLocalStorage();
const GameConfig = require('../models/GameConfig');
const entityConfigService = require('../services/EntityConfigService');

const COMBAT_CLASSES = {
  SWARM: 'SWARM',
  HEAVY: 'HEAVY',
  SPLASH: 'SPLASH',
  CIVIL: 'CIVIL'
};

const RPS_MULTIPLIERS = {
  [COMBAT_CLASSES.SWARM]: { [COMBAT_CLASSES.HEAVY]: 2.0 },
  [COMBAT_CLASSES.HEAVY]: { [COMBAT_CLASSES.SPLASH]: 2.0 },
  [COMBAT_CLASSES.SPLASH]: { [COMBAT_CLASSES.SWARM]: 2.0 }
};

const DEFAULT_COMBAT_CLASSES = {
  // SWARM
  lightFighter: COMBAT_CLASSES.SWARM,
  heavyFighter: COMBAT_CLASSES.SWARM,
  espionageProbe: COMBAT_CLASSES.SWARM,
  solarSatellite: COMBAT_CLASSES.SWARM,
  rocketLauncher: COMBAT_CLASSES.SWARM,
  lightLaser: COMBAT_CLASSES.SWARM,
  // HEAVY
  cruiser: COMBAT_CLASSES.HEAVY,
  battleship: COMBAT_CLASSES.HEAVY,
  battlecruiser: COMBAT_CLASSES.HEAVY,
  heavyLaser: COMBAT_CLASSES.HEAVY,
  gaussCannon: COMBAT_CLASSES.HEAVY,
  ionCannon: COMBAT_CLASSES.HEAVY,
  // SPLASH
  bomber: COMBAT_CLASSES.SPLASH,
  destroyer: COMBAT_CLASSES.SPLASH,
  deathstar: COMBAT_CLASSES.SPLASH,
  plasmaTurret: COMBAT_CLASSES.SPLASH,
  smallShieldDome: COMBAT_CLASSES.SPLASH,
  largeShieldDome: COMBAT_CLASSES.SPLASH,
  // CIVIL
  smallCargo: COMBAT_CLASSES.CIVIL,
  largeCargo: COMBAT_CLASSES.CIVIL,
  colonyShip: COMBAT_CLASSES.CIVIL,
  recycler: COMBAT_CLASSES.CIVIL
};

class CombatService {
  constructor() {}
  random() { return battleRandom.getStore()?.() ?? Math.random(); }
  async simulateBattle8Wave(attackerDeck, defenderDeck, techs, maxRoundsOverride = null, seed = 'legacy') {
    let state = Array.from(seed).reduce((n,c) => (Math.imul(n,31)+c.charCodeAt(0))>>>0, 2166136261);
    const rng = () => { state = (state + 0x6D2B79F5) >>> 0; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
    return battleRandom.run(rng, () => this.simulateWaves(attackerDeck, defenderDeck, techs, maxRoundsOverride));
  }

  getCombatClass(entityType) {
    const definition = entityConfigService.getEntity('ship', entityType) || 
                       entityConfigService.getEntity('defense', entityType);
    return definition?.combatClass || DEFAULT_COMBAT_CLASSES[entityType] || COMBAT_CLASSES.CIVIL;
  }

  getMultiplier(attackerClass, defenderClass) {
    if (RPS_MULTIPLIERS[attackerClass] && RPS_MULTIPLIERS[attackerClass][defenderClass]) {
      return RPS_MULTIPLIERS[attackerClass][defenderClass];
    }
    return 1.0;
  }

  async simulateWaves(attackerDeck, defenderDeck, techs, maxRoundsOverride = null) {
    const config = await GameConfig.getConfig();
    const rounds = [];
    
    let attackerCarry = {};
    let ambushForces = {}; // Defender forces that were skipped
    
    let totalAttackerLosses = {};
    let totalDefenderLosses = {};
    let totalInitialAttacker = {};
    let totalInitialDefender = {};

    for (let wave = 0; wave < 8; wave++) {
      const waveState = {
        waveIndex: wave,
        attackerForces: { ...this.cloneForces(attackerCarry) },
        defenderForces: {},
        ambushAttacks: [],
        mainCombat: null
      };

      // 1. Initialize Attacker for this wave
      const aSlot = attackerDeck[wave];
      const attackers = aSlot?.ships || (aSlot?.type ? { [aSlot.type]: aSlot.count } : {});
      for (const [type, count] of Object.entries(attackers)) {
        const force = this.initializeUnit(type, count, techs.attacker);
        if (!force) continue;
        if (waveState.attackerForces[type]) this.mergeForces(waveState.attackerForces[type], force);
        else waveState.attackerForces[type] = force;
        totalInitialAttacker[type] = (totalInitialAttacker[type] || 0) + count;
      }
      const dSlot = defenderDeck[wave];
      const defenders = dSlot?.ships || (dSlot?.shipType ? { [dSlot.shipType]: dSlot.shipCount } : {});
      const defenses = dSlot?.defense || (dSlot?.defenseType ? { [dSlot.defenseType]: dSlot.defenseCount } : {});
      for (const [type, count] of Object.entries({ ...defenders, ...defenses })) {
        const force = this.initializeUnit(type, count, techs.defender);
        if (!force) continue;
        waveState.defenderForces[type] = force;
        totalInitialDefender[type] = (totalInitialDefender[type] || 0) + count;
      }

      const hasAttacker = Object.keys(waveState.attackerForces).length > 0;
      const hasDefender = Object.keys(waveState.defenderForces).length > 0;

      // 3. Ambush Phase (Free Fire)
      if (hasAttacker && Object.keys(ambushForces).length > 0) {
        const ambushResult = this.executeFire(ambushForces, waveState.attackerForces, 2.0); // 2.0x Backstab Multiplier
        waveState.attackerForces = ambushResult.remaining;
        waveState.ambushAttacks.push({
          damage: ambushResult.damage,
          details: "Ambush forces struck the attacker's back."
        });
        // Ambush forces are consumed/done after they fire
        ambushForces = {};
      }

      const hasAttackerAfterAmbush = Object.keys(waveState.attackerForces).length > 0;

      // 4. Main Combat Phase
      if (hasAttackerAfterAmbush && hasDefender) {
        // Attacker shoots
        const atkResult = this.executeFire(waveState.attackerForces, waveState.defenderForces, 1.0);
        waveState.defenderForces = atkResult.remaining;

        // Defender shoots back
        const defResult = this.executeFire(waveState.defenderForces, waveState.attackerForces, 1.0);
        waveState.attackerForces = defResult.remaining;

        waveState.mainCombat = {
          attackerDamage: atkResult.damage,
          defenderDamage: defResult.damage
        };
      } else if (!hasAttackerAfterAmbush && hasDefender) {
        // Defender survives, no attacker to fight -> enters Ambush mode
        this.mergeForcesDict(ambushForces, waveState.defenderForces);
        waveState.defenderForces = {}; // Moved to ambush
      }

      // 5. Carry Over
      attackerCarry = this.cloneForces(waveState.attackerForces);
      
      rounds.push(waveState);
    }

    // Calculate Losses
    const finalAttacker = this.countUnits(attackerCarry);
    const finalDefender = this.countUnits(ambushForces); // Any ambush forces left never got to shoot

    for (const type of Object.keys(totalInitialAttacker)) {
      totalAttackerLosses[type] = totalInitialAttacker[type] - (finalAttacker[type] || 0);
    }
    for (let i=0; i<rounds.length; i++) {
        const defCounts = this.countUnits(rounds[i].defenderForces);
        for(const t of Object.keys(defCounts)) {
            finalDefender[t] = (finalDefender[t] || 0) + defCounts[t];
        }
    }
    for (const type of Object.keys(totalInitialDefender)) {
        totalDefenderLosses[type] = totalInitialDefender[type] - (finalDefender[type] || 0);
    }

    const debrisField = this.calculateDebris(totalAttackerLosses, totalDefenderLosses, config.combatSettings?.debrisFieldPercentage ?? 30, { includeDefense: Boolean(config.combatSettings?.defenseToDebris) });
    const winner = this.determineWinner8Wave(finalAttacker, finalDefender, totalInitialAttacker);

    return {
      rounds,
      winner,
      attackerForces: finalAttacker,
      defenderForces: finalDefender,
      attackerLosses: totalAttackerLosses,
      defenderLosses: totalDefenderLosses,
      debrisField,
      moonChance: this.calculateMoonChance(debrisField),
      roundCount: rounds.length
    };
  }

  initializeUnit(unitType, count, techs) {
    if (count <= 0) return null;
    const definition = entityConfigService.getEntity('ship', unitType) || 
                       entityConfigService.getEntity('defense', unitType);
    if (!definition || !definition.stats) return null;

    const weaponBonus = 1 + (techs.weapons || 0) * 0.1;
    const shieldBonus = 1 + (techs.shield || 0) * 0.1;
    const armorBonus = 1 + (techs.armor || 0) * 0.1;
    const stats = definition.stats;

    return {
      count,
      hull: Math.floor(stats.hull * armorBonus),
      shield: Math.floor(stats.shield * shieldBonus),
      attack: Math.floor(stats.attack * weaponBonus),
      rapidFire: stats.rapidFire || {},
      isDefense: stats.isDefense || false,
      combatClass: this.getCombatClass(unitType),
      currentHull: Array(count).fill(Math.floor(stats.hull * armorBonus))
    };
  }

  mergeForces(target, source) {
    target.count += source.count;
    target.currentHull.push(...source.currentHull);
  }

  mergeForcesDict(targetDict, sourceDict) {
    for (const [type, force] of Object.entries(sourceDict)) {
      if (targetDict[type]) {
        this.mergeForces(targetDict[type], force);
      } else {
        targetDict[type] = this.cloneForces({ dummy: force }).dummy;
      }
    }
  }

  executeFire(attacker, defender, globalMultiplier = 1.0) {
    let totalDamage = 0;
    const remaining = this.cloneForces(defender);
    
    for (const [attackerType, attackerData] of Object.entries(attacker)) {
      if (attackerData.count <= 0) continue;
      
      let shots = [];
      for (let i = 0; i < attackerData.count; i++) {
        shots.push({
          damage: attackerData.attack * globalMultiplier,
          type: attackerType,
          combatClass: attackerData.combatClass
        });
        
        for (const [targetType, chance] of Object.entries(attackerData.rapidFire)) {
          let currentChance = chance;
          while (currentChance >= 1) {
            shots.push({ damage: attackerData.attack * globalMultiplier, type: attackerType, combatClass: attackerData.combatClass });
            currentChance--;
          }
          if (this.random() < currentChance) {
            shots.push({ damage: attackerData.attack * globalMultiplier, type: attackerType, combatClass: attackerData.combatClass });
          }
        }
      }
      
      const defenderTypes = Object.keys(remaining).filter(t => remaining[t].count > 0);
      if (defenderTypes.length === 0) break;
      
      for (const shot of shots) {
        // The last defender can fall mid-volley; remaining shots have nothing to hit.
        if (defenderTypes.length === 0) break;
        const targetType = defenderTypes[Math.floor(this.random() * defenderTypes.length)];
        const target = remaining[targetType];
        
        if (target.count <= 0) continue;
        const targetIndex = Math.floor(this.random() * target.count);

        // Calculate final damage with RPS Multiplier
        let rpsBonus = this.getMultiplier(shot.combatClass, target.combatClass);
        let finalDamage = shot.damage * rpsBonus;
        
        totalDamage += finalDamage;
        
        let damageToHull = finalDamage;
        if (target.shield > 0) {
          if (finalDamage < target.shield * 0.01) {
            damageToHull = 0; 
          } else {
            damageToHull = Math.max(0, finalDamage - target.shield);
          }
        }
        
        target.currentHull[targetIndex] -= damageToHull;
        
        if (target.currentHull[targetIndex] <= 0) {
          target.count--;
          target.currentHull.splice(targetIndex, 1);
          
          if (target.count <= 0) {
            delete remaining[targetType];
            const idx = defenderTypes.indexOf(targetType);
            if (idx > -1) defenderTypes.splice(idx, 1);
          }
        }
      }
    }
    
    return { remaining, damage: totalDamage };
  }
  
  determineWinner8Wave(finalAttacker, finalDefender, initialAttacker) {
    const atkCount = Object.values(finalAttacker).reduce((sum, count) => sum + count, 0);
    const defCount = Object.values(finalDefender).reduce((sum, count) => sum + count, 0);
    const initialAtkCount = Object.values(initialAttacker).reduce((sum, count) => sum + count, 0);

    if (atkCount === 0 && defCount === 0) return 'draw';
    if (atkCount === 0) return 'defender';
    // Attacker wins if they crack the base and still have ships
    return 'attacker';
  }

  /**
   * Wreckage left by a battle: a share of the metal and crystal cost of every destroyed
   * ship on both sides. Defense installations only count when defenseToDebris is on.
   */
  calculateDebris(attackerLosses, defenderLosses, debrisFieldPercentage = 30, { includeDefense = false } = {}) {
    const ratio = Math.max(0, debrisFieldPercentage) / 100;
    const total = { metal: 0, crystal: 0 };
    for (const losses of [attackerLosses, defenderLosses]) {
      for (const [type, count] of Object.entries(losses || {})) {
        const ship = entityConfigService.getEntity('ship', type);
        const definition = ship || (includeDefense ? entityConfigService.getEntity('defense', type) : null);
        const cost = definition?.costModel?.baseCost;
        if (!cost || !(count > 0)) continue;
        total.metal += (cost.metal || 0) * count;
        total.crystal += (cost.crystal || 0) * count;
      }
    }
    return { metal: Math.floor(total.metal * ratio), crystal: Math.floor(total.crystal * ratio) };
  }
  
  calculateResourceValue(losses) {
    let totalValue = 0;
    for (const [type, count] of Object.entries(losses)) {
      const definition = entityConfigService.getEntity('ship', type) || 
                         entityConfigService.getEntity('defense', type);
      if (definition?.costModel?.baseCost) {
        const cost = definition.costModel.baseCost;
        totalValue += ((cost.metal || 0) + (cost.crystal || 0)) * count;
      }
    }
    return totalValue;
  }
  
  calculateMoonChance(debris) {
    const total = debris.metal + debris.crystal;
    return Math.min(20, Math.floor(total / 100000));
  }
  
  countUnits(forces) {
    const counts = {};
    for (const [type, data] of Object.entries(forces)) {
      counts[type] = data.count;
    }
    return counts;
  }
  
  cloneForces(forces) {
    const cloned = {};
    for (const [type, data] of Object.entries(forces)) {
      cloned[type] = {
        ...data,
        currentHull: [...data.currentHull]
      };
    }
    return cloned;
  }
}

module.exports = new CombatService();
