/**
 * Serializes catalog specs into readable CommonJS source (unquoted keys,
 * single quotes) so files written by EntityConfigService.syncToFile stay
 * pleasant to hand-edit.
 */

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function formatKey(key) {
  return IDENTIFIER.test(key) ? key : `'${String(key).replace(/'/g, "\\'")}'`;
}

function formatValue(value, indent) {
  const pad = '  '.repeat(indent);
  const innerPad = '  '.repeat(indent + 1);

  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => formatValue(item, indent + 1));
    const inline = `[${items.join(', ')}]`;
    if (inline.length <= 80 && !inline.includes('\n')) return inline;
    return `[\n${items.map((item) => innerPad + item).join(',\n')}\n${pad}]`;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const parts = entries.map(([key, item]) => `${formatKey(key)}: ${formatValue(item, indent + 1)}`);
  const inline = `{ ${parts.join(', ')} }`;
  if (inline.length <= 80 && !inline.includes('\n')) return inline;
  return `{\n${parts.map((part) => innerPad + part).join(',\n')}\n${pad}}`;
}

/**
 * @param {string} header  comment block placed above module.exports
 * @param {object[]} specs
 * @returns {string}
 */
function serializeCatalogModule(header, specs) {
  const body = specs.map((spec) => `  ${formatValue(spec, 1)}`).join(',\n\n');
  return `${header.trim()}\n\nmodule.exports = [\n${body}\n];\n`;
}

module.exports = { serializeCatalogModule, formatValue };
