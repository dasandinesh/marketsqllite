const { isDeepStrictEqual } = require('node:util');

function values(document, path) {
  const parts = Array.isArray(path) ? path : path.split('.');
  if (!parts.length) return Array.isArray(document) ? document.flat() : [document];
  if (Array.isArray(document)) return document.flatMap(item => values(item, parts));
  if (document == null) return [undefined];
  return values(document[parts[0]], parts.slice(1));
}

function equal(left, right) {
  if (left?.toHexString || right?.toHexString) return String(left) === String(right);
  return isDeepStrictEqual(left, right);
}

function condition(actual, expected) {
  if (expected instanceof RegExp) return expected.test(String(actual ?? ''));
  if (!expected || typeof expected !== 'object' || expected instanceof Date || expected._bsontype) return equal(actual, expected);
  if (!Object.keys(expected).some(key => key.startsWith('$'))) return equal(actual, expected);
  return Object.entries(expected).every(([operator, value]) => {
    switch (operator) {
      case '$exists': return (actual !== undefined) === Boolean(value);
      case '$ne': return !equal(actual, value);
      case '$in': return value.some(item => equal(actual, item));
      case '$gte': return actual != null && actual >= value;
      case '$lte': return actual != null && actual <= value;
      case '$gt': return actual != null && actual > value;
      case '$lt': return actual != null && actual < value;
      case '$regex': return new RegExp(value, expected.$options || '').test(String(actual ?? ''));
      case '$options': return true;
      default: throw new Error(`Unsupported storage query operator: ${operator}`);
    }
  });
}

function matches(document, filter = {}) {
  return Object.entries(filter).every(([path, expected]) => {
    if (path === '$or') return expected.some(part => matches(document, part));
    if (path === '$and') return expected.every(part => matches(document, part));
    if (path === '$expr') {
      const expression = expected.$eq;
      if (!expression || expression[0] !== '$$ROOT' || !Object.hasOwn(expression[1], '$literal')) {
        throw new Error('Unsupported storage comparison expression.');
      }
      return equal(document, expression[1].$literal);
    }
    if (path.startsWith('$')) throw new Error(`Unsupported storage query: ${path}`);
    const candidates = values(document, path);
    return expected && typeof expected === 'object' && Object.hasOwn(expected, '$ne')
      ? candidates.every(actual => condition(actual, expected))
      : candidates.some(actual => condition(actual, expected));
  });
}

function sortDocuments(documents, order = {}) {
  return documents.sort((left, right) => {
    for (const [path, direction] of Object.entries(order)) {
      const a = values(left, path)[0];
      const b = values(right, path)[0];
      if (equal(a, b)) continue;
      return (a == null ? -1 : b == null ? 1 : a < b ? -1 : 1) * direction;
    }
    return 0;
  });
}

function setPath(document, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  let parent = document;
  for (const part of parts) {
    if (['__proto__', 'constructor', 'prototype'].includes(part)) throw new Error('Invalid update path.');
    if (!parent[part] || typeof parent[part] !== 'object') parent[part] = {};
    parent = parent[part];
  }
  if (['__proto__', 'constructor', 'prototype'].includes(last)) throw new Error('Invalid update path.');
  if (value === undefined) delete parent[last];
  else parent[last] = value;
}

function patch(document, update, inserting = false) {
  for (const [operator, entries] of Object.entries(update)) {
    if (!operator.startsWith('$')) { if (entries !== undefined) setPath(document, operator, entries); continue; }
    if (operator === '$setOnInsert' && !inserting) continue;
    if (!['$set', '$setOnInsert', '$inc', '$unset', '$max'].includes(operator)) throw new Error(`Unsupported storage update: ${operator}`);
    for (const [path, value] of Object.entries(entries)) {
      const current = values(document, path)[0];
      setPath(document, path, operator === '$unset' ? undefined : operator === '$inc' ? Number(current || 0) + Number(value)
        : operator === '$max' ? (current == null || current < value ? value : current) : value);
    }
  }
  return document;
}

module.exports = { values, equal, matches, sortDocuments, setPath, patch };
