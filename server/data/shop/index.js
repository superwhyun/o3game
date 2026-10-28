const products = require('./products');

const KINDS = new Set(['emblem', 'speedup']);
const ID_PATTERN = /^(emblem|speedup)\.[a-z0-9]+$/;

function validateProducts(list) {
  const seen = new Set();
  for (const product of list) {
    const where = `shop product ${product?.id}`;
    if (!ID_PATTERN.test(product?.id || '')) throw new Error(`${where}: invalid id`);
    if (seen.has(product.id)) throw new Error(`${where}: duplicate id`);
    seen.add(product.id);
    if (!KINDS.has(product.kind) || !product.id.startsWith(`${product.kind}.`)) throw new Error(`${where}: kind must match the id prefix`);
    if (!product.name) throw new Error(`${where}: name required`);
    if (!/^[1-9][0-9]{0,17}$/.test(product.priceMicro || '')) throw new Error(`${where}: priceMicro must be a positive integer string`);
    if (product.kind === 'emblem' && !/^[a-z]+$/.test(product.emblem || '')) throw new Error(`${where}: emblem id required`);
    if (product.kind === 'speedup' && !(Number.isSafeInteger(product.grants?.speedupSeconds) && product.grants.speedupSeconds > 0)) throw new Error(`${where}: grants.speedupSeconds required`);
    if (product.maxQuantity !== undefined && !(Number.isSafeInteger(product.maxQuantity) && product.maxQuantity >= 1 && product.maxQuantity <= 1000)) throw new Error(`${where}: invalid maxQuantity`);
    if (product.kind === 'emblem' && (product.maxQuantity ?? 1) !== 1) throw new Error(`${where}: an emblem can only be bought once`);
  }
  return list;
}

validateProducts(products);

const byId = new Map(products.map((product) => [product.id, Object.freeze({ maxQuantity: 1, ...product })]));

module.exports = {
  products: [...byId.values()],
  getProduct: (id) => byId.get(id),
  validateProducts
};
