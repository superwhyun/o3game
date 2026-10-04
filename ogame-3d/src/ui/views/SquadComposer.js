/**
 * Strike-group builder: pick how many of each owned, launchable ship to send.
 * Renders the draggable squad token that StrikeMap turns into a course line.
 */
import { catalog } from '../../data/catalog.js';
import { fleetProfile, isLaunchable } from '../../data/fleetMath.js';
import { getShipThumbnail } from '../../three/ships/ShipThumbnails.js';
import { resolveModelSpec } from '../../three/ships/ShipModelFactory.js';
import { escapeHtml, formatAmount } from '../dom.js';

export class SquadComposer {
  /**
   * @param {HTMLElement} root
   * @param {{ getOwned: () => Record<string, number>, onChange?: () => void }} options
   */
  constructor(root, { getOwned, onChange }) {
    this.root = root;
    this.getOwned = getOwned;
    this.onChange = onChange;
    this.counts = new Map();

    root.classList.add('squad');
    root.innerHTML = `
      <h3 class="block-title">공격대 편성 <small>攻擊隊</small></h3>
      <ul class="squad-list"></ul>
      <div class="squad-actions">
        <button type="button" class="holo-btn-small" data-squad="all">전 함선</button>
        <button type="button" class="holo-btn-small" data-squad="clear">초기화</button>
      </div>
      <dl class="squad-summary"></dl>
      <button type="button" class="squad-token" aria-describedby="squad-token-hint">
        <span class="token-emblem" aria-hidden="true">✦</span>
        <span class="token-text"><strong></strong><small id="squad-token-hint"></small></span>
      </button>`;
    this.listEl = root.querySelector('.squad-list');
    this.summaryEl = root.querySelector('.squad-summary');
    this.token = root.querySelector('.squad-token');

    this.listEl.addEventListener('click', (event) => {
      const button = event.target.closest('[data-step]');
      if (!button) return;
      const shipId = button.closest('[data-ship]').dataset.ship;
      this.set(shipId, (this.counts.get(shipId) || 0) + Number(button.dataset.step));
    });
    this.listEl.addEventListener('change', (event) => {
      const input = event.target.closest('input[data-count]');
      if (input) this.set(input.closest('[data-ship]').dataset.ship, Number(input.value));
    });
    root.querySelector('[data-squad="all"]').addEventListener('click', () => {
      for (const [shipId, owned] of Object.entries(this.launchableOwned())) this.counts.set(shipId, owned);
      this.render();
    });
    root.querySelector('[data-squad="clear"]').addEventListener('click', () => this.reset());
  }

  /** Owned ships that can actually fly. */
  launchableOwned() {
    return Object.fromEntries(Object.entries(this.getOwned() || {})
      .filter(([shipId, count]) => count > 0 && isLaunchable(catalog.get('ship', shipId)?.stats)));
  }

  set(shipId, value) {
    const owned = this.launchableOwned()[shipId] || 0;
    const count = Math.min(owned, Math.max(0, Math.floor(Number(value)) || 0));
    if (count > 0) this.counts.set(shipId, count);
    else this.counts.delete(shipId);
    this.render();
  }

  reset() {
    this.counts.clear();
    this.render();
  }

  /** @returns {Record<string, number>} the squad, clamped to what is still owned */
  fleet() {
    const owned = this.launchableOwned();
    return Object.fromEntries([...this.counts]
      .map(([shipId, count]) => [shipId, Math.min(count, owned[shipId] || 0)])
      .filter(([, count]) => count > 0));
  }

  profile() {
    return fleetProfile(this.fleet(), (shipId) => catalog.get('ship', shipId)?.stats);
  }

  render() {
    const owned = this.launchableOwned();
    const ids = Object.keys(owned);
    if (ids.length === 0) {
      this.listEl.innerHTML = '<li class="detail-muted">출격 가능한 함선이 없습니다. 조병창에서 함선을 건조하십시오.</li>';
    } else {
      this.listEl.innerHTML = ids.map((shipId) => {
        const entity = catalog.get('ship', shipId);
        const count = Math.min(this.counts.get(shipId) || 0, owned[shipId]);
        return `<li class="squad-row ${count > 0 ? 'is-picked' : ''}" data-ship="${escapeHtml(shipId)}">
          <img alt="" data-thumb="${escapeHtml(shipId)}">
          <span class="squad-name">${escapeHtml(entity?.name || shipId)}<small>보유 ${formatAmount(owned[shipId])}</small></span>
          <span class="squad-stepper">
            <button type="button" data-step="-1" aria-label="${escapeHtml(entity?.name || shipId)} 1척 빼기">−</button>
            <input type="number" min="0" max="${owned[shipId]}" value="${count}" data-count inputmode="numeric" aria-label="${escapeHtml(entity?.name || shipId)} 편성 수">
            <button type="button" data-step="1" aria-label="${escapeHtml(entity?.name || shipId)} 1척 더하기">+</button>
          </span>
        </li>`;
      }).join('');
      for (const img of this.listEl.querySelectorAll('img[data-thumb]')) {
        const entity = catalog.get('ship', img.dataset.thumb);
        if (!entity) continue;
        getShipThumbnail(resolveModelSpec(entity), entity.id)
          .then((url) => { img.src = url; })
          .catch((error) => console.warn('[SquadComposer] thumbnail failed', entity.id, error));
      }
    }

    const profile = this.profile();
    this.summaryEl.innerHTML = `
      <div><dt>척수</dt><dd>${formatAmount(profile.ships)}</dd></div>
      <div><dt>공격력</dt><dd>${formatAmount(profile.attack)}</dd></div>
      <div><dt>적재량</dt><dd>${formatAmount(profile.cargoCapacity)}</dd></div>
      <div><dt>최저 속도</dt><dd>${profile.slowestSpeed ? formatAmount(profile.slowestSpeed) : '—'}</dd></div>`;

    const ready = profile.ships > 0;
    this.token.disabled = !ready;
    this.token.classList.toggle('is-ready', ready);
    this.token.querySelector('strong').textContent = ready ? `공격대 ${formatAmount(profile.ships)}척` : '공격대 미편성';
    this.token.querySelector('small').textContent = ready
      ? '끌어서 목표 행성에 놓으십시오'
      : '위에서 출격할 함선 수를 정하십시오';
    this.onChange?.();
  }
}
