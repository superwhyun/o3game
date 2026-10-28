/**
 * Fleet emblems: small vector badges shown on formations and mission cards.
 * `free` emblems are available to everyone; the rest are shop products (ids must match
 * server/data/shop/emblems.js, which server/test/emblemParity.test.js checks).
 * Drawing is procedural SVG in a 48x48 box using currentColor, so no image assets are needed.
 */

export const EMBLEMS = {
  star: { name: '별', free: true, paths: ['M24 6l5.2 11.2 12.2 1.5-9 8.4 2.4 12.1L24 33.1 13.2 39.2l2.4-12.1-9-8.4 12.2-1.5z'] },
  chevron: { name: '삼각 휘장', free: true, paths: ['M10 30l14-16 14 16', 'M10 40l14-16 14 16'] },
  crescent: { name: '초승달', paths: ['M32 8a17 17 0 1 0 0 32 14 14 0 1 1 0-32z'] },
  laurel: { name: '월계관', paths: ['M24 40c-9-3-14-11-13-22', 'M24 40c9-3 14-11 13-22', 'M13 22c4 0 6 2 7 5', 'M35 22c-4 0-6 2-7 5', 'M16 31c3-1 6 0 8 2', 'M32 31c-3-1-6 0-8 2'] },
  comet: { name: '혜성', paths: ['M38 10L16 20', 'M40 16L20 24', 'M36 6L12 15', 'M16 32a8 8 0 1 0 8-8 8 8 0 0 0-8 8z'] },
  dragon: { name: '용', paths: ['M10 34c4-12 12-20 22-20 4 0 7 2 8 5-3-1-5 0-6 2 4 2 5 6 3 9-2-2-5-2-7 0 1 4-1 7-5 8-5 1-10-1-15-4z', 'M30 20l3 1'] },
  anchor: { name: '닻', paths: ['M24 8v28', 'M16 16h16', 'M10 30c2 6 8 10 14 10s12-4 14-10', 'M8 28l2 4 4-3', 'M40 28l-2 4-4-3', 'M20 8a4 4 0 1 0 8 0 4 4 0 0 0-8 0z'] },
  skull: { name: '해골', paths: ['M12 24c0-8 5-14 12-14s12 6 12 14c0 4-2 6-4 8v6H16v-6c-2-2-4-4-4-8z', 'M18 24a3 3 0 1 0 6 0 3 3 0 0 0-6 0z', 'M26 24a3 3 0 1 0 6 0 3 3 0 0 0-6 0z', 'M20 34v4', 'M24 34v4', 'M28 34v4'] }
};

export const FREE_EMBLEMS = Object.entries(EMBLEMS).filter(([, emblem]) => emblem.free).map(([id]) => id);

/** Emblems a commander may put on a formation: the free ones plus owned shop emblems. */
export function usableEmblems(owned = []) {
  return Object.keys(EMBLEMS).filter((id) => EMBLEMS[id].free || owned.includes(id));
}

const escape = (value) => String(value).replace(/[&<>"']/g, '');

/** SVG markup for an emblem id; '' draws nothing. Unknown ids render nothing rather than breaking a card. */
export function emblemSvg(id, { size = 28, label = true } = {}) {
  const emblem = EMBLEMS[id];
  if (!emblem) return '';
  const strokeOnly = emblem.paths.length > 1 && !['dragon', 'skull', 'crescent'].includes(id);
  const attrs = strokeOnly
    ? 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"'
    : 'fill="currentColor" fill-opacity="0.85" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"';
  const title = label ? `<title>${escape(emblem.name)}</title>` : '';
  return `<svg class="fleet-emblem emblem-${escape(id)}" viewBox="0 0 48 48" width="${size}" height="${size}" role="img" aria-label="${escape(emblem.name)}" focusable="false">${title}<g ${attrs}>${emblem.paths.map((d) => `<path d="${d}"/>`).join('')}</g></svg>`;
}
