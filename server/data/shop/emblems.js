/**
 * Emblem ids a fleet formation may display. Free emblems are always usable; paid
 * ones come from shop products (kind 'emblem') and must be owned.
 * Visual definitions live in ogame-3d/src/data/emblems.js and must cover every id here.
 */
const { products } = require('./index');

const FREE_EMBLEMS = Object.freeze(['star', 'chevron']);
const PAID_EMBLEMS = Object.freeze(products.filter((p) => p.kind === 'emblem').map((p) => p.emblem));
const ALL_EMBLEMS = Object.freeze([...FREE_EMBLEMS, ...PAID_EMBLEMS]);

/** @param {string} emblem '' means none. @param {string[]} owned */
function canUseEmblem(emblem, owned = []) {
  return emblem === '' || FREE_EMBLEMS.includes(emblem) || (PAID_EMBLEMS.includes(emblem) && owned.includes(emblem));
}

module.exports = { FREE_EMBLEMS, PAID_EMBLEMS, ALL_EMBLEMS, canUseEmblem };
