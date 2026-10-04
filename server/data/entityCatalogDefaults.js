/**
 * Backwards-compatible entry point. The catalog now lives in ./catalog/
 * (one file per entity type, one object per entity).
 */
const { ENTITY_CATALOG_DEFAULTS } = require('./catalog');

module.exports = {
  ENTITY_CATALOG_DEFAULTS
};
