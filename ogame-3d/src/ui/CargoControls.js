import { formatAmount } from './dom.js';

const resources = { metal: '금속', crystal: '수정', deuterium: '중수소' };
const amount = value => Math.max(0, Math.floor(Number(value) || 0));

// Keep the existing numeric fields as the source of truth for dispatch / FormData.
export function bindCargoControls(root, { capacity, stock, population = () => 0, disabled = false }) {
  if (!root) return;
  const fields = Object.fromEntries(Object.keys(resources).map(id => [id,
    root.querySelector(`[data-cargo="${id}"], input[name="${id}"]`)]));
  const inputs = Object.values(fields).filter(Boolean);
  if (inputs.length !== 3) return;
  const panel = document.createElement('section');
  panel.className = 'cargo-controls';
  panel.innerHTML = `<p class="cargo-help">비율로 적재 · 100%는 보유량과 적재 공간 중 작은 값입니다.</p>${Object.entries(resources).map(([id, label]) => `<div class="cargo-resource" data-resource="${id}"><div class="cargo-heading"><strong>${label}</strong><output></output><button type="button" data-percent="100" class="cargo-fill">전부</button></div><input type="range" min="0" max="100" step="1" value="0" aria-label="${label} 적재 비율"></div>`).join('')}<p class="cargo-total" role="status"></p><button type="button" class="cargo-exact-toggle" aria-expanded="false">정확한 수량 입력</button>`;
  const exact = document.createElement('div');
  exact.className = 'cargo-exact-fields';
  exact.hidden = true;
  // Move the labels together so precise entry stays available without opening a keyboard by default.
  for (const input of inputs) {
    input.dataset.touchSkip = 'true';
    input.disabled = disabled || input.disabled;
    exact.append(input.closest('label') || input);
  }
  root.insertBefore(panel, root.querySelector(':scope > p'));
  panel.after(exact);
  const totalCapacity = amount(capacity);
  const freeCapacity = () => Math.max(0, totalCapacity - amount(population()));
  const totalCargo = () => inputs.reduce((sum, input) => sum + amount(input.value), 0);
  const limit = id => Math.min(amount(stock[id]), freeCapacity());
  const sync = () => {
    for (const [id, input] of Object.entries(fields)) {
      const row = panel.querySelector(`[data-resource="${id}"]`);
      const maximum = limit(id);
      const value = amount(input.value);
      const percent = maximum ? Math.round(value / maximum * 100) : 0;
      const slider = row.querySelector('input');
      slider.value = percent;
      slider.disabled = disabled || input.disabled || maximum === 0;
      row.querySelector('output').textContent = `${percent}% · ${formatAmount(value)} / ${formatAmount(maximum)}`;
      for (const button of row.querySelectorAll('button')) button.disabled = slider.disabled;
      input.max = Math.max(0, Math.min(maximum, freeCapacity() - totalCargo() + value));
    }
    const used = totalCargo() + amount(population());
    panel.querySelector('.cargo-total').textContent = `적재 ${formatAmount(used)} / ${formatAmount(totalCapacity)} · 남은 공간 ${formatAmount(Math.max(0, totalCapacity - used))}${population() ? ` · 인구 ${formatAmount(population())}명 포함` : ''}`;
  };
  const normalize = () => {
    let remaining = freeCapacity();
    for (const [id, input] of Object.entries(fields)) {
      input.value = Math.min(amount(input.value), amount(stock[id]), remaining);
      remaining -= amount(input.value);
    }
    sync();
  };
  const select = (id, percent) => {
    const input = fields[id];
    if (disabled || input.disabled) return;
    const remaining = Math.max(0, freeCapacity() - totalCargo() + amount(input.value));
    input.value = Math.min(remaining, Math.floor(limit(id) * percent / 100));
    sync();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  panel.addEventListener('input', event => {
    if (!event.target.matches('input[type=range]')) return;
    event.stopPropagation();
    select(event.target.closest('[data-resource]').dataset.resource, Number(event.target.value));
  });
  panel.addEventListener('click', event => {
    const button = event.target.closest('[data-percent]');
    if (button) select(button.closest('[data-resource]').dataset.resource, Number(button.dataset.percent));
    if (event.target.closest('.cargo-exact-toggle')) {
      exact.hidden = !exact.hidden;
      panel.querySelector('.cargo-exact-toggle').setAttribute('aria-expanded', String(!exact.hidden));
    }
  });
  root.addEventListener('input', event => {
    if (inputs.includes(event.target)) {
      const input = event.target;
      const id = Object.keys(fields).find(id => fields[id] === input);
      const otherCargo = inputs.filter(el => el !== input).reduce((sum, el) => sum + amount(el.value), 0);
      input.value = Math.min(amount(input.value), amount(stock[id]), Math.max(0, freeCapacity() - otherCargo));
      sync();
    } else if (event.target.name === 'colonists') normalize();
  });
  normalize();
  return { sync: normalize };
}
