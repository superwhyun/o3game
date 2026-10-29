import { formatAmount } from '../dom.js';

const RESOURCES = { metal: ['금속', '◆'], crystal: ['수정', '◇'], deuterium: ['중수소', '◈'], food: ['식량', '●'] };
const integer = n => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number(n) || 0)));
export class ResourceTradeView {
  constructor({ root, getState, isPending }) {
    Object.assign(this, { root, getState, isPending });
    const options = selected => Object.entries(RESOURCES).map(([id, [name]]) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${name}</option>`).join('');
    root.className = 'exchange-form';
    root.innerHTML = `<div class="exchange-context" id="trade-rates"></div><div class="exchange-pair"><section class="exchange-card" data-side="from"><label for="trade-from">지불할 자원</label><div class="exchange-resource"><span data-symbol></span><select id="trade-from" name="from" aria-label="지불할 자원">${options('metal')}</select></div><input id="trade-amount" name="amount" type="number" data-touch-skip="true" min="0" step="1" value="0" inputmode="numeric" aria-label="지불할 수량"><small data-balance></small><p data-after></p></section><button type="button" class="exchange-swap" aria-label="교환 방향 바꾸기">⇄</button><section class="exchange-card" data-side="to"><label for="trade-to">받을 자원</label><div class="exchange-resource"><span data-symbol></span><select id="trade-to" name="to" aria-label="받을 자원">${options('crystal')}</select></div><output class="exchange-received">0</output><small data-balance></small><p data-after></p></section></div><div class="exchange-slider-heading"><label for="trade-percentage">교환량 <output data-percent>0%</output></label><button type="button" class="exchange-max">최대 교환</button></div><input id="trade-percentage" type="range" min="0" max="100" step="1" value="25" aria-label="교환량 비율"><div class="exchange-limit"></div><p id="trade-quote" aria-live="polite"></p><button type="submit" class="cmd-btn primary" id="trade-submit" disabled>교환하기</button><p id="trade-message" role="status"></p>`;
    this.from = root.querySelector('#trade-from');
    this.to = root.querySelector('#trade-to');
    this.amount = root.querySelector('#trade-amount');
    this.slider = root.querySelector('#trade-percentage');
    this.previous = { from: 'metal', to: 'crystal' };
    root.addEventListener('input', event => {
      if (isPending()) return;
      if (event.target === this.from || event.target === this.to) {
        if (this.from.value === this.to.value) {
          if (event.target === this.from) this.to.value = this.previous.from;
          else this.from.value = this.previous.to;
        }
        this.previous = { from: this.from.value, to: this.to.value };
        this.initialized = false;
      }
      if (event.target === this.slider) this.amount.value = Math.floor(this.maximum * Number(this.slider.value) / 100);
      root.querySelector('#trade-message').textContent = '';
      this.render();
    });
    root.querySelector('.exchange-swap').addEventListener('click', () => {
      if (isPending()) return;
      [this.from.value, this.to.value] = [this.to.value, this.from.value];
      this.previous = { from: this.from.value, to: this.to.value };
      this.initialized = false;
      this.render();
    });
    root.querySelector('.exchange-max').addEventListener('click', () => {
      if (isPending()) return;
      this.amount.value = this.maximum;
      this.render();
    });
  }
  render() {
    const state = this.getState(), { rates, fee } = state.exchange || {};
    const pending = this.isPending();
    const configured = rates && Number.isFinite(fee) && fee >= 0 && fee < 1 && rates[this.from.value] > 0 && rates[this.to.value] > 0;
    if (this.planetId !== state.planet.id) { this.planetId = state.planet.id; this.initialized = false; }
    const from = this.from.value, to = this.to.value;
    const stock = integer(state.resources[from]), targetStock = Number(state.resources[to] || 0);
    const capacity = to === 'food' ? state.planet.populationState?.foodCapacity : state.storage[to];
    const room = integer(Number(capacity || 0) - targetStock);
    const receive = n => configured ? Math.floor(n / rates[from] * rates[to] * (1 - fee)) : 0;
    // Search with the exact server rounding formula so the maximum cannot overflow storage.
    let lo = 0, hi = configured && room > 0 ? stock : 0;
    while (lo < hi) {
      const mid = lo + Math.ceil((hi - lo) / 2);
      if (receive(mid) <= room && Number.isSafeInteger(receive(mid))) lo = mid;
      else hi = mid - 1;
    }
    this.maximum = lo;
    if (!this.initialized && lo > 0) { this.amount.value = Math.min(lo, Math.max(1, Math.floor(lo * .25))); if (receive(Number(this.amount.value)) < 1) this.amount.value = lo; this.initialized = true; }
    if (Number(this.amount.value) > lo) this.amount.value = lo;
    this.amount.max = lo;
    const amount = Number(this.amount.value), displayAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0, received = receive(displayAmount);
    const valid = configured && Number.isSafeInteger(amount) && amount > 0 && Number.isSafeInteger(received) && received >= 1 && amount <= lo;
    const percent = lo ? Math.min(100, Math.round(displayAmount / lo * 100)) : 0;
    this.slider.value = Math.min(100, Math.max(0, percent || 0));
    this.root.querySelector('[data-percent]').textContent = `${percent || 0}%`;
    for (const [side, id, balance, after] of [['from', from, stock, stock - displayAmount], ['to', to, targetStock, targetStock + received]]) {
      const card = this.root.querySelector(`[data-side=${side}]`);
      card.dataset.resource = id;
      card.querySelector('[data-symbol]').textContent = RESOURCES[id][1];
      card.querySelector('[data-balance]').textContent = `보유 ${formatAmount(balance)}${side === 'to' ? ` / 저장 ${formatAmount(capacity || 0)}` : ''}`;
      card.querySelector('[data-after]').textContent = `교환 후 ${formatAmount(Number.isFinite(after) ? Math.max(0, after) : balance)}`;
    }
    this.root.querySelector('.exchange-received').textContent = formatAmount(Number.isSafeInteger(received) ? received : 0);
    this.root.querySelector('#trade-rates').textContent = configured ? `${state.planet.name} · 수수료 ${Math.round(fee * 100)}% 포함` : '교환 정보를 불러오는 중입니다.';
    this.root.querySelector('.exchange-limit').textContent = `최대 ${formatAmount(lo)} · 보유량과 받을 자원의 저장 공간 기준`;
    this.root.querySelector('#trade-quote').textContent = !configured ? '교환 정보를 불러오는 중입니다.' : !stock ? '지불할 자원이 없습니다.' : !room ? '받을 자원의 저장고가 가득 찼습니다.' : !valid ? '슬라이더로 교환량을 선택하세요. 받을 자원이 1 이상이어야 합니다.' : `${RESOURCES[from][0]} ${formatAmount(amount)} → ${RESOURCES[to][0]} ${formatAmount(received)}`;
    this.root.querySelector('#trade-submit').textContent = pending ? '교환 중…' : `${RESOURCES[to][0]} ${formatAmount(valid ? received : 0)} 교환받기`;
    for (const el of this.root.querySelectorAll('input, select, button')) el.disabled = pending || !configured;
    this.slider.disabled ||= !lo;
    this.root.querySelector('.exchange-max').disabled ||= !lo;
    this.root.querySelector('#trade-submit').disabled = pending || !valid;
    return valid ? { from, to, amount } : null;
  }
}
