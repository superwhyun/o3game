/**
 * Shop catalog (CGC). One object per product.
 *
 *   id          unique, "<kind>.<name>"
 *   kind        'emblem' (permanent fleet emblem) | 'speedup' (adds speed-up time to the account)
 *   name        display name
 *   emblem      emblem id for kind 'emblem' (must exist in ogame-3d/src/data/emblems.js)
 *   grants      { speedupSeconds } per unit for kind 'speedup'
 *   maxQuantity highest quantity per order (default 1)
 *
 * Prices are not part of the catalog: the administrator sets them (GameConfig.shop.prices);
 * a product without a price is not for sale.
 * Purchases grant entitlements; applying a speed-up is a separate in-game action.
 */
module.exports = [
  { id: 'emblem.crescent', kind: 'emblem', emblem: 'crescent', name: '초승달 문장' },
  { id: 'emblem.laurel', kind: 'emblem', emblem: 'laurel', name: '월계관 문장' },
  { id: 'emblem.comet', kind: 'emblem', emblem: 'comet', name: '혜성 문장' },
  { id: 'emblem.dragon', kind: 'emblem', emblem: 'dragon', name: '용 문장' },
  { id: 'emblem.anchor', kind: 'emblem', emblem: 'anchor', name: '닻 문장' },
  { id: 'emblem.skull', kind: 'emblem', emblem: 'skull', name: '해골 문장' },
  { id: 'speedup.1h', kind: 'speedup', name: '가속 1시간', grants: { speedupSeconds: 3600 }, maxQuantity: 24 },
  { id: 'speedup.6h', kind: 'speedup', name: '가속 6시간', grants: { speedupSeconds: 21600 }, maxQuantity: 12 },
  { id: 'speedup.24h', kind: 'speedup', name: '가속 24시간', grants: { speedupSeconds: 86400 }, maxQuantity: 7 }
];
