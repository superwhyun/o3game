const GameConfig = require('../models/GameConfig');
const entityConfigService = require('../services/EntityConfigService');

class CombatService {
  constructor() {
    // Stats will be loaded dynamically from EntityConfigService
  }

  
  /**
   * Simulate battle between attacker and defender
   */
  async simulateBattle(attackerFleet, defenderFleet, defenderDefense, techs, maxRoundsOverride = null) {
    const config = await GameConfig.getConfig();
    const maxRounds = maxRoundsOverride || config.combatSettings?.maxRounds || 6;
    const rounds = [];
    
    // Initialize forces with tech bonuses
    let attackerForces = this.initializeForces(attackerFleet, techs.attacker);
    let defenderForces = this.initializeForces(
      { ...defenderFleet, ...defenderDefense }, 
      techs.defender
    );
    
    // Track initial state
    const initialState = {
      attacker: this.cloneForces(attackerForces),
      defender: this.cloneForces(defenderForces)
    };
    
    // Combat rounds
    for (let round = 1; round <= maxRounds; round++) {
      // Check if battle should end
      if (this.isBattleOver(attackerForces, defenderForces)) break;
      
      // Attacker shoots first
      const attackResult = this.executeFire(attackerForces, defenderForces, 'attacker');
      defenderForces = attackResult.remaining;
      
      // Defender shoots back (if anything remains)
      const defendResult = this.executeFire(defenderForces, attackerForces, 'defender');
      attackerForces = defendResult.remaining;
      
      // Record round
      rounds.push({
        round,
        attackerShips: this.countUnits(attackerForces),
        defenderShips: this.countUnits(defenderForces),
        attackerDamage: attackResult.damage,
        defenderDamage: defendResult.damage
      });
    }
    
    // Determine winner
    const winner = this.determineWinner(attackerForces, defenderForces);
    
    // Calculate losses
    const attackerLosses = this.calculateLosses(initialState.attacker, attackerForces);
    const defenderLosses = this.calculateLosses(initialState.defender, defenderForces);
    
    // Calculate debris
    const debrisField = this.calculateDebris(attackerLosses, defenderLosses, config.combatSettings?.debrisFieldPercentage || 30);
    
    return {
      rounds,
      winner,
      attackerForces: this.convertToFleet(attackerForces),
      defenderForces: this.convertToFleet(defenderForces),
      attackerLosses,
      defenderLosses,
      debrisField,
      moonChance: this.calculateMoonChance(debrisField),
      roundCount: rounds.length
    };
  }
  
  initializeForces(fleet, techs) {
    const forces = {};
    const weaponBonus = 1 + (techs.weapons || 0) * 0.1;
    const shieldBonus = 1 + (techs.shield || 0) * 0.1;
    const armorBonus = 1 + (techs.armor || 0) * 0.1;
    
    for (const [unitType, count] of Object.entries(fleet)) {
      if (count <= 0) continue;
      
      const definition = entityConfigService.getEntity('ship', unitType) || 
                         entityConfigService.getEntity('defense', unitType);
      if (!definition || !definition.stats) continue;
      
      const stats = definition.stats;
      forces[unitType] = {
        count,
        hull: Math.floor(stats.hull * armorBonus),
        shield: Math.floor(stats.shield * shieldBonus),
        attack: Math.floor(stats.attack * weaponBonus),
        rapidFire: stats.rapidFire || {},
        isDefense: stats.isDefense || false,
        currentHull: Array(count).fill(Math.floor(stats.hull * armorBonus))
      };
    }
    
    return forces;
  }
  
  executeFire(attacker, defender, attackerSide) {
    let totalDamage = 0;
    const remaining = this.cloneForces(defender);
    
    // Each unit type fires
    for (const [attackerType, attackerData] of Object.entries(attacker)) {
      if (attackerData.count <= 0) continue;
      
      // Calculate shots with rapid fire
      let shots = [];
      for (let i = 0; i < attackerData.count; i++) {
        shots.push({
          damage: attackerData.attack,
          type: attackerType
        });
        
        // Check rapid fire
        for (const [targetType, chance] of Object.entries(attackerData.rapidFire)) {
          let currentChance = chance;
          while (currentChance >= 1) {
            shots.push({ damage: attackerData.attack, type: attackerType });
            currentChance--;
          }
          if (Math.random() < currentChance) {
            shots.push({ damage: attackerData.attack, type: attackerType });
          }
        }
      }
      
      // Distribute shots
      const defenderTypes = Object.keys(remaining).filter(t => remaining[t].count > 0);
      if (defenderTypes.length === 0) break;
      
      for (const shot of shots) {
        // Pick random target
        const targetType = defenderTypes[Math.floor(Math.random() * defenderTypes.length)];
        const target = remaining[targetType];
        
        if (target.count <= 0) continue;
        
        // Pick random unit in stack
        const targetIndex = Math.floor(Math.random() * target.count);
        
        // Apply damage
        totalDamage += shot.damage;
        
        // Shield absorption
        let damageToHull = shot.damage;
        if (target.shield > 0) {
          if (shot.damage < target.shield * 0.01) {
            damageToHull = 0; // Shot too weak
          } else {
            damageToHull = Math.max(0, shot.damage - target.shield);
          }
        }
        
        target.currentHull[targetIndex] -= damageToHull;
        
        // Check destruction
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
  
  isBattleOver(forces1, forces2) {
    const count1 = Object.values(forces1).reduce((sum, f) => sum + f.count, 0);
    const count2 = Object.values(forces2).reduce((sum, f) => sum + f.count, 0);
    return count1 === 0 || count2 === 0;
  }
  
  determineWinner(attacker, defender) {
    const attackerCount = Object.values(attacker).reduce((sum, f) => sum + f.count, 0);
    const defenderCount = Object.values(defender).reduce((sum, f) => sum + (f.isDefense ? 0 : f.count), 0);
    
    if (attackerCount === 0 && defenderCount === 0) return 'draw';
    if (attackerCount === 0) return 'defender';
    if (defenderCount === 0) return 'attacker';
    return 'draw'; // Max rounds reached
  }
  
  calculateLosses(initial, remaining) {
    const losses = {};
    for (const [type, data] of Object.entries(initial)) {
      const remainingCount = remaining[type]?.count || 0;
      if (data.count > remainingCount) {
        losses[type] = data.count - remainingCount;
      }
    }
    return losses;
  }
  
  calculateDebris(attackerLosses, defenderLosses, debrisFieldPercentage = 30) {
    const debrisRatio = debrisFieldPercentage / 100;
    const metal = Math.floor((this.calculateResourceValue(attackerLosses) + 
                              this.calculateResourceValue(defenderLosses)) * debrisRatio);
    return {
      metal: Math.floor(metal * 0.7),
      crystal: Math.floor(metal * 0.3)
    };
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
  
  convertToFleet(forces) {
    const fleet = {};
    for (const [type, data] of Object.entries(forces)) {
      if (!data.isDefense) {
        fleet[type] = data.count;
      }
    }
    return fleet;
  }
}

module.exports = new CombatService();
