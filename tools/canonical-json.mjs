const DEFAULT_DEPTH_LIMIT = 64;

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isWellFormed(value) {
  if (typeof value.isWellFormed === 'function') return value.isWellFormed();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function jsonString(value) {
  if (!isWellFormed(value)) throw new TypeError('canonical JSON strings must be well-formed Unicode');
  return JSON.stringify(value);
}

function canonicalValue(value, depth, options) {
  if (depth > options.depthLimit) throw new RangeError(`canonical JSON nesting exceeds ${options.depthLimit}`);
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return jsonString(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON does not support non-finite numbers');
    if (options.rejectUnsafeIntegers && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError('canonical JSON does not support integers outside the safe range');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (options.rejectSparseArrays) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError('canonical JSON does not support sparse arrays');
      }
    }
    return `[${value.map(item => canonicalValue(item, depth + 1, options)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${jsonString(key)}:${canonicalValue(value[key], depth + 1, options)}`).join(',')}}`;
  }
  throw new TypeError('canonical JSON only supports plain JSON values');
}

/** Deterministic JSON: recursive key sort, preserved array order, ECMAScript number spelling. */
export function canonicalJson(value, {
  depthLimit = DEFAULT_DEPTH_LIMIT,
  rejectSparseArrays = false,
  rejectUnsafeIntegers = false,
} = {}) {
  if (!Number.isSafeInteger(depthLimit) || depthLimit < 1) throw new RangeError('canonical JSON depthLimit must be a positive safe integer');
  return canonicalValue(value, 0, { depthLimit, rejectSparseArrays, rejectUnsafeIntegers });
}
