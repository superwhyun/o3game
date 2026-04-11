/**
 * EntityConfigManager
 * Admin UI for editing per-entity base costs and build/research times.
 * Supports tiered multipliers per 10-level ranges.
 */
import { adminService } from '../services/AdminService.js';

// Korean display names
const ENTITY_NAMES = {
  // Buildings
  metalMine: '\uae08\uc18d \uad11\uc0b0', crystalMine: '\uc218\uc815 \uad11\uc0b0', deuteriumSynthesizer: '\uc911\uc218\uc18c \ud569\uc131\uae30',
  solarPlant: '\ud0dc\uc591\uad11 \ubc1c\uc804\uc18c', fusionReactor: '\ud575\uc735\ud569 \ubc1c\uc804\uc18c',
  robotFactory: '\ub85c\ubd07 \uacf5\uc7a5', shipyard: '\ud568\uc120 \uacf5\uc7a5', researchLab: '\uc5f0\uad6c\uc18c',
  naniteFactory: '\ub098\ub178 \uba38\uc2e0 \uacf5\uc7a5',
  metalStorage: '\uae08\uc18d \uc800\uc7a5\uace0', crystalStorage: '\uc218\uc815 \uc800\uc7a5\uace0', deuteriumTank: '\uc911\uc218\uc18c \ud0f1\ud06c',
  // Ships
  smallCargo: '\uc18c\ud615 \uc218\uc1a1\uc120', largeCargo: '\ub300\ud615 \uc218\uc1a1\uc120', colonyShip: '\uc2dd\ubbfc\uc9c0 \uac1c\ucc99\uc120',
  recycler: '\uc218\ud655\uc120', espionageProbe: '\uc815\ucc30 \ud504\ub85c\ube0c', solarSatellite: '\ud0dc\uc591\uad11 \uc704\uc131',
  lightFighter: '\uacbd\uc804\ud22c\uae30', heavyFighter: '\uc911\uc804\ud22c\uae30', cruiser: '\uc21c\uc591\ud568',
  battleship: '\uc804\ud568', battlecruiser: '\uc804\ud22c\uc21c\uc591\ud568', bomber: '\ud3ed\uaca9\uae30',
  destroyer: '\uad6c\ucd95\ud568', deathstar: '\uc8fd\uc74c\uc758 \ubcc4',
  // Research
  energyTechnology: '\uc5d0\ub108\uc9c0 \uae30\uc220', laserTechnology: '\ub808\uc774\uc800 \uae30\uc220',
  ionTechnology: '\uc774\uc628 \uae30\uc220', plasmaTechnology: '\ud50c\ub77c\uc988\ub9c8 \uae30\uc220',
  combustionDrive: '\uc5f0\uc18c \uc5d4\uc9c4', impulseDrive: '\ucda9\ub3cc \uc5d4\uc9c4',
  hyperspaceDrive: '\ud558\uc774\ud37c\uc2a4\ud398\uc774\uc2a4 \uc5d4\uc9c4', hyperspaceTechnology: '\ud558\uc774\ud37c\uc2a4\ud398\uc774\uc2a4 \uae30\uc220',
  espionageTechnology: '\ucc29\ubcf4 \uae30\uc220', computerTechnology: '\ucef4\ud4e8\ud130 \uae30\uc220',
  astrophysics: '\ucc9c\uccb4\ubb3c\ub9ac\ud559', gravitonTechnology: '\uc911\ub825\uc790 \uae30\uc220',
  weaponsTechnology: '\ubb34\uae30 \uae30\uc220', shieldingTechnology: '\ubc29\ud328 \uae30\uc220', armorTechnology: '\uc7a5\uac11 \uae30\uc220'
};

// Format number to K/M/B/T
function formatNumber(num) {
  if (num === 0) return '0';
  if (num < 1000) return num.toString();
  
  const units = ['', 'K', 'M', 'B', 'T'];
  const unitIndex = Math.floor(Math.log10(num) / 3);
  const scaled = num / Math.pow(1000, unitIndex);
  
  // Show 1 decimal for larger numbers, but remove if .0
  const formatted = scaled.toFixed(1).replace(/\.0$/, '');
  return formatted + units[unitIndex];
}

export class EntityConfigManager {
  constructor() {
    this.currentType = 'building';
    this.data = [];
    this.dirty = new Map();
    this.tierCount = 10; // 10 tiers for levels 1-100
  }

  init() {
    this._bindTabs();
    this._bindActions();
    this.load('building');
  }

  async load(type) {
    this.currentType = type;
    this.dirty.clear();
    this._setTabActive(type);
    this._setLoading(true);

    try {
      this.data = await adminService.getEntityConfig(type);
    } catch (e) {
      this._showMessage(`불러오기 실패: ${e.message}`, 'error');
      this._setLoading(false);
      return;
    }

    this._renderCards();
    this._setLoading(false);
    this._updateSaveBtn();
  }

  // Get default tier multipliers if not set
  _getTierMultipliers(row) {
    const defaultTiers = [];
    for (let i = 0; i < this.tierCount; i++) {
      const level = i * 10 + 1; // 1, 11, 21, 31...
      defaultTiers.push({
        startLevel: level,
        endLevel: level + 9,
        costMult: 2.0 - (i * 0.1), // 2.0, 1.9, 1.8, ... decreasing
        timeMult: 2.0 - (i * 0.1)
      });
    }
    
    // If row has existing tier multipliers, use them
    if (row.tierMultipliers && row.tierMultipliers.length > 0) {
      // Merge with defaults to ensure all tiers exist
      return defaultTiers.map((defaultTier, i) => {
        const existing = row.tierMultipliers[i];
        return existing ? { ...defaultTier, ...existing } : defaultTier;
      });
    }
    
    return defaultTiers;
  }

  // Calculate cost for specific level using tiered multipliers
  _calculateLevelCost(baseCost, level, tierMultipliers, isTime = false) {
    if (level === 1) return baseCost;
    
    let totalMultiplier = 1;
    let remainingLevels = level - 1;
    let currentTier = 0;
    
    while (remainingLevels > 0 && currentTier < tierMultipliers.length) {
      const tier = tierMultipliers[currentTier];
      const mult = isTime ? tier.timeMult : tier.costMult;
      const levelsInThisTier = Math.min(remainingLevels, 10); // Each tier is 10 levels
      
      totalMultiplier *= Math.pow(mult, levelsInThisTier);
      remainingLevels -= levelsInThisTier;
      currentTier++;
    }
    
    return Math.floor(baseCost * totalMultiplier);
  }

  _renderCards() {
    const grid = document.getElementById('entity-config-grid');
    if (!grid) return;

    const showMultiplier = this.currentType !== 'ship';
    grid.innerHTML = '';

    this.data.forEach(row => {
      const card = document.createElement('div');
      card.className = 'ec-entity-card';
      card.dataset.id = row.entityId;
      if (row.isOverridden) card.classList.add('overridden');

      const name = ENTITY_NAMES[row.entityId] || row.entityId;
      const bc = row.baseCost || {};
      const tierMults = this._getTierMultipliers(row);

      let tierInputsHtml = '';
      if (showMultiplier) {
        tierInputsHtml = `
          <div class="ec-tier-section">
            <div class="ec-tier-header">
              <span class="ec-input-label">Level Tier Multipliers (Cost / Time)</span>
            </div>
            <div class="ec-tier-grid">
              ${tierMults.map((tier, idx) => `
                <div class="ec-tier-item">
                  <span class="ec-tier-label">${tier.startLevel}-${tier.endLevel}</span>
                  <input type="number" class="ec-input ec-tier-input" 
                    data-field="tierCostMult" data-tier="${idx}" 
                    value="${tier.costMult.toFixed(1)}" min="1" step="0.1" title="Cost multiplier">
                  <input type="number" class="ec-input ec-tier-input" 
                    data-field="tierTimeMult" data-tier="${idx}" 
                    value="${tier.timeMult.toFixed(1)}" min="1" step="0.1" title="Time multiplier">
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="ec-card-header">
          <h4 class="ec-card-title">${name}</h4>
          <div class="ec-card-actions">
            <button class="ec-card-btn preview" title="레벨별 비용 미리보기">🔍</button>
          </div>
        </div>
        <div class="ec-cost-grid">
          <div class="ec-input-group">
            <label class="ec-input-label">Metal (Lv1)</label>
            <div class="ec-cost-input-wrap">
              <span class="ec-cost-icon">⚙️</span>
              <input type="number" class="ec-input" data-field="metal" value="${bc.metal || 0}" min="0">
            </div>
          </div>
          <div class="ec-input-group">
            <label class="ec-input-label">Crystal (Lv1)</label>
            <div class="ec-cost-input-wrap">
              <span class="ec-cost-icon">💎</span>
              <input type="number" class="ec-input" data-field="crystal" value="${bc.crystal || 0}" min="0">
            </div>
          </div>
          <div class="ec-input-group">
            <label class="ec-input-label">Deuterium (Lv1)</label>
            <div class="ec-cost-input-wrap">
              <span class="ec-cost-icon">💧</span>
              <input type="number" class="ec-input" data-field="deuterium" value="${bc.deuterium || 0}" min="0">
            </div>
          </div>
        </div>
        <div class="ec-input-group" style="margin-top: 12px;">
          <label class="ec-input-label">Base Time (seconds, Lv1)</label>
          <input type="number" class="ec-input" data-field="buildTime" value="${row.buildTime || 0}" min="0">
        </div>
        ${tierInputsHtml}
      `;

      // Bind base input events
      card.querySelectorAll('.ec-input[data-field="metal"], .ec-input[data-field="crystal"], .ec-input[data-field="deuterium"], .ec-input[data-field="buildTime"]').forEach(input => {
        input.addEventListener('change', (e) => {
          this._recordChange(row.entityId, e.target.dataset.field, parseFloat(e.target.value));
          input.classList.add('modified');
          card.classList.add('modified');
        });
      });

      // Bind tier multiplier events
      if (showMultiplier) {
        card.querySelectorAll('.ec-tier-input').forEach(input => {
          input.addEventListener('change', (e) => {
            const tierIdx = parseInt(e.target.dataset.tier);
            const field = e.target.dataset.field;
            const value = parseFloat(e.target.value);
            this._recordTierChange(row.entityId, tierIdx, field, value);
            input.classList.add('modified');
            card.classList.add('modified');
          });
        });
      }

      // Bind preview button
      const previewBtn = card.querySelector('.ec-card-btn.preview');
      if (previewBtn) {
        previewBtn.addEventListener('click', () => this._showPreview(row.entityId));
      }

      grid.appendChild(card);
    });
  }

  _recordChange(entityId, field, value) {
    const original = this.data.find(r => r.entityId === entityId);
    if (!this.dirty.has(entityId)) {
      this.dirty.set(entityId, {
        entityType: this.currentType,
        entityId,
        baseCost: { ...(original?.baseCost || {}) },
        buildTime: original?.buildTime ?? null,
        tierMultipliers: this._getTierMultipliers(original)
      });
    }

    const entry = this.dirty.get(entityId);
    if (['metal', 'crystal', 'deuterium'].includes(field)) {
      entry.baseCost[field] = value;
    } else if (field === 'buildTime') {
      entry.buildTime = value;
    }

    this._updateSaveBtn();
  }

  _recordTierChange(entityId, tierIdx, field, value) {
    const original = this.data.find(r => r.entityId === entityId);
    if (!this.dirty.has(entityId)) {
      this.dirty.set(entityId, {
        entityType: this.currentType,
        entityId,
        baseCost: { ...(original?.baseCost || {}) },
        buildTime: original?.buildTime ?? null,
        tierMultipliers: this._getTierMultipliers(original)
      });
    }

    const entry = this.dirty.get(entityId);
    if (!entry.tierMultipliers) {
      entry.tierMultipliers = this._getTierMultipliers(original);
    }
    
    if (field === 'tierCostMult') {
      entry.tierMultipliers[tierIdx].costMult = value;
    } else if (field === 'tierTimeMult') {
      entry.tierMultipliers[tierIdx].timeMult = value;
    }

    this._updateSaveBtn();
  }

  _showPreview(entityId) {
    const modal = document.getElementById('ec-preview-modal');
    const title = document.getElementById('ec-preview-title');
    const tbody = document.getElementById('ec-preview-tbody');
    const formulaText = document.getElementById('ec-preview-formula-text');

    const row = this._getMergedData().find(r => r.entityId === entityId);
    if (!row) return;

    const name = ENTITY_NAMES[entityId] || entityId;
    title.textContent = `${name} - Level Cost Preview`;

    const tierMults = this._getTierMultipliers(row);
    const bc = row.baseCost || {};

    formulaText.textContent = 'Tiered multipliers: Cost and Time multiply by tier-specific rates every 10 levels';

    // Generate preview for levels 1, 5, 10, 20, 30, ..., 100
    const levels = [1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    
    tbody.innerHTML = levels.map(lvl => {
      const metal = this._calculateLevelCost(bc.metal || 0, lvl, tierMults, false);
      const crystal = this._calculateLevelCost(bc.crystal || 0, lvl, tierMults, false);
      const deuterium = this._calculateLevelCost(bc.deuterium || 0, lvl, tierMults, false);
      const time = row.buildTime ? this._calculateLevelCost(row.buildTime, lvl, tierMults, true) : 0;
      const total = metal + crystal + deuterium;

      // Find which tier this level belongs to
      const tierIdx = Math.min(Math.floor((lvl - 1) / 10), tierMults.length - 1);
      const tier = tierMults[tierIdx];

      return `
        <tr>
          <td><strong>Lv${lvl}</strong></td>
          <td>${formatNumber(metal)}</td>
          <td>${formatNumber(crystal)}</td>
          <td>${formatNumber(deuterium)}</td>
          <td>${time > 0 ? formatNumber(time) + 's' : '-'}</td>
          <td class="ec-preview-total">${formatNumber(total)}</td>
          <td><small style="opacity:0.6">${tier.costMult.toFixed(1)}x / ${tier.timeMult.toFixed(1)}x</small></td>
        </tr>
      `;
    }).join('');

    modal.classList.remove('hidden');
  }

  _getMergedData() {
    return this.data.map(row => {
      if (!this.dirty.has(row.entityId)) return row;
      const d = this.dirty.get(row.entityId);
      return {
        ...row,
        baseCost: { ...row.baseCost, ...d.baseCost },
        buildTime: d.buildTime ?? row.buildTime,
        tierMultipliers: d.tierMultipliers || row.tierMultipliers
      };
    });
  }

  async _save() {
    if (this.dirty.size === 0) {
      this._showMessage('변경된 항목이 없습니다.', 'info');
      return;
    }

    const updates = Array.from(this.dirty.values());
    const btn = document.getElementById('btn-save-entity-config');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    try {
      await adminService.bulkUpdateEntityConfig(updates);
      this._showMessage(`${updates.length}개 항목 저장 완료`, 'success');
      await this.load(this.currentType);
    } catch (e) {
      this._showMessage(`오류: ${e.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 SAVE'; }
    }
  }

  async _reset() {
    const typeLabel = { building: 'BUILDINGS', ship: 'SHIPS', research: 'RESEARCH' }[this.currentType];
    if (!confirm(`${typeLabel} 설정을 기본값으로 초기화하시겠습니까?`)) return;

    try {
      await adminService.resetEntityConfig(this.currentType);
      this._showMessage('초기화 완료', 'success');
      await this.load(this.currentType);
    } catch (e) {
      this._showMessage(`오류: ${e.message}`, 'error');
    }
  }

  _bindTabs() {
    document.querySelectorAll('.ec-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.load(btn.dataset.type);
      });
    });
  }

  _bindActions() {
    document.getElementById('btn-save-entity-config')?.addEventListener('click', () => this._save());
    document.getElementById('btn-reset-entity-config')?.addEventListener('click', () => this._reset());
    document.getElementById('btn-preview-all')?.addEventListener('click', () => this._previewAll());

    // Modal close
    document.querySelector('.ec-modal-close')?.addEventListener('click', () => {
      document.getElementById('ec-preview-modal')?.classList.add('hidden');
    });
    document.getElementById('ec-preview-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'ec-preview-modal') {
        e.target.classList.add('hidden');
      }
    });
  }

  _previewAll() {
    if (this.data.length > 0) {
      this._showPreview(this.data[0].entityId);
    }
  }

  _setTabActive(type) {
    document.querySelectorAll('.ec-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === type);
    });
  }

  _setLoading(on) {
    const el = document.getElementById('entity-config-loading');
    if (el) el.style.display = on ? 'flex' : 'none';
    const grid = document.getElementById('entity-config-grid');
    if (grid) grid.style.opacity = on ? '0.35' : '1';
  }

  _updateSaveBtn() {
    const btn = document.getElementById('btn-save-entity-config');
    const badge = document.getElementById('ec-dirty-badge');

    if (btn) {
      btn.classList.toggle('ec-has-changes', this.dirty.size > 0);
      btn.textContent = this.dirty.size > 0 ? `💾 SAVE (${this.dirty.size})` : '💾 SAVE';
    }
    if (badge) {
      badge.style.display = this.dirty.size > 0 ? 'inline-block' : 'none';
      badge.textContent = `${this.dirty.size} PENDING`;
    }
  }

  _showMessage(text, type = 'info') {
    const el = document.getElementById('entity-config-message');
    if (!el) return;
    el.textContent = text;
    el.className = `ec-message ec-message-${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3500);
  }
}
