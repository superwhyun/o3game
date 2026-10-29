/**
 * CGC amounts: 6 decimal places. Internally integer micro-units (BigInt); the
 * API takes positive decimal strings like "4.000000". Never use floats.
 */
const DECIMALS = 6;
const SCALE = 10n ** BigInt(DECIMALS);
const AMOUNT_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;

function toMicro(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError('micro amount must be a safe integer');
    return BigInt(value);
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  throw new TypeError('micro amount must be a non-negative integer');
}

/** @param {string|number|bigint} micro @returns {string} e.g. 4000000 -> "4.000000" */
function formatCgc(micro) {
  const value = toMicro(micro);
  if (value < 0n) throw new RangeError('amount cannot be negative');
  const whole = value / SCALE;
  const fraction = String(value % SCALE).padStart(DECIMALS, '0');
  return `${whole}.${fraction}`;
}

/** @param {string} text e.g. "4.5" -> 4500000n */
function parseCgc(text) {
  if (typeof text !== 'string' || !AMOUNT_PATTERN.test(text)) throw new TypeError(`invalid CGC amount: ${text}`);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(DECIMALS, '0'));
}

function isPositiveMicro(value) {
  try { return toMicro(value) > 0n; } catch { return false; }
}

module.exports = { DECIMALS, SCALE, toMicro, formatCgc, parseCgc, isPositiveMicro };
