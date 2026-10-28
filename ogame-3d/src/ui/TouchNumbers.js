// Numeric fields across dynamic views share touch controls. The original input
// remains in place with its name, validation and existing event handlers intact.
export function installTouchNumbers(root = document.body) {
  const enhance = input => {
    if (input.closest('.touch-number, .coord-field') || input.dataset.touchSkip || input.hidden
      || ['galaxy', 'system', 'planet'].includes(input.name)) return;
    const label = input.getAttribute('aria-label') || input.labels?.[0]?.textContent.trim() || input.name || '수량';
    input.inputMode = input.step === 'any' || Number(input.step) % 1 ? 'decimal' : 'numeric';
    const existingStepper = input.parentElement.matches('.ship-count-controls, .squad-stepper');
    const wrapper = document.createElement('span');
    wrapper.className = `touch-number${existingStepper ? ' has-stepper' : ''}`;
    input.before(wrapper);
    const row = document.createElement('span');
    row.className = 'touch-number-row';
    wrapper.append(row);
    const button = (text, action) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = text;
      el.setAttribute('aria-label', `${label} ${text}`);
      el.addEventListener('click', event => { event.preventDefault(); if (!input.disabled && !input.readOnly) action(); });
      return el;
    };
    const step = () => input.step === 'any' ? 1 : Number(input.step) || 1;
    const bounds = () => [input.min === '' ? 0 : Number(input.min), input.max === '' ? Infinity : Number(input.max)];
    const commit = value => {
      const [min, max] = bounds();
      input.value = Math.min(max, Math.max(min, Number(value.toFixed(8))));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (input.isConnected) input.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
    };
    if (!existingStepper) row.append(button('−', () => commit(Number(input.value || 0) - step())));
    row.append(input);
    if (!existingStepper) row.append(button('＋', () => commit(Number(input.value || 0) + step())));
    const presets = document.createElement('span');
    presets.className = 'quantity-presets';
    const [min, max] = bounds();
    let slider;
    if (Number.isFinite(max) && max > min && max <= 1000000) {
      slider = document.createElement('input');
      slider.type = 'range';
      slider.min = min;
      slider.max = max;
      slider.step = step();
      slider.setAttribute('aria-label', `${label} 슬라이더`);
      slider.addEventListener('input', event => { event.stopPropagation(); input.value = slider.value; });
      slider.addEventListener('change', event => { event.stopPropagation(); commit(Number(slider.value)); });
      wrapper.append(slider);
      presets.append(button('최대', () => commit(bounds()[1])));
    }
    if (presets.childElementCount) wrapper.append(presets);
    const sync = () => {
      if (slider) { slider.min = input.min; slider.max = input.max; slider.value = input.value; }
      for (const el of wrapper.querySelectorAll('button, input[type=range]')) el.disabled = input.disabled || input.readOnly;
    };
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    wrapper._syncTouchNumber = sync;
    sync();
  };
  const scan = node => {
    if (node.nodeType !== 1) return;
    if (node.matches('input[type=number]')) enhance(node);
    node.querySelectorAll('input[type=number]').forEach(enhance);
  };
  scan(root);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(scan);
      else if (record.target.matches('input[type=number]')) record.target.closest('.touch-number')?._syncTouchNumber?.();
    }
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'readonly', 'min', 'max'] });
  return () => observer.disconnect();
}
