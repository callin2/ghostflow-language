const encoder = new TextEncoder();
const decoder = new TextDecoder();

const QUALITY = Object.freeze({ NotReady: 0, Good: 1, Disconnected: 2, Stale: 3, Invalid: 4 });
const QUALITY_NAME = ['NotReady', 'Good', 'Disconnected', 'Stale', 'Invalid'];
const MAX_WINDOW = 31;
const MAX_SAFE_U64 = Number.MAX_SAFE_INTEGER;

function has(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

function configValue(config, key, fallback) {
  if (!has(config, key)) return fallback;
  if (config[key] === undefined) return fallback;
  return config[key];
}

function safeInteger(value, name, minimum = 0, maximum = MAX_SAFE_U64) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function finiteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function qualityCode(value) {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= QUALITY.NotReady && value <= QUALITY.Invalid) return value;
  } else if (typeof value === 'string' && has(QUALITY, value)) {
    return QUALITY[value];
  }
  throw new TypeError('quality must be one of NotReady, Good, Disconnected, Stale, Invalid');
}

function parseConfig(config) {
  if (config === null || typeof config !== 'object') throw new TypeError('config must be an object');
  const filterValue = configValue(config, 'filter', undefined);
  const filterObject = filterValue && typeof filterValue === 'object' ? filterValue : null;
  const filterName = typeof filterValue === 'string' ? filterValue : filterObject?.kind;
  const kinds = { median: 1, movingaverage: 2, 'moving-average': 2, moving_average: 2, ema: 3, EMA: 3 };
  const kind = has(kinds, filterName) ? kinds[filterName] : undefined;
  if (!kind) throw new RangeError('filter must be median, movingaverage, or ema');

  const rawWindow = has(config, 'window') ? config.window : filterObject?.window ?? (kind === 3 ? 1 : undefined);
  const window = safeInteger(rawWindow, 'window', 1, MAX_WINDOW);
  if (kind === 3 && window !== 1) throw new RangeError('EMA window must be 1');
  if (kind !== 3 && (has(config, 'alpha') || (filterObject && has(filterObject, 'alpha')))) {
    throw new RangeError('alpha is only supported by EMA');
  }
  const alpha = finiteNumber(has(config, 'alpha') ? config.alpha : filterObject?.alpha ?? 1, 'alpha');
  if (kind === 3 && !(alpha > 0 && alpha <= 1)) throw new RangeError('EMA alpha must be in (0, 1]');

  const validMin = finiteNumber(configValue(config, 'validMin', configValue(config, 'valid_min', 0)), 'validMin');
  const validMax = finiteNumber(configValue(config, 'validMax', configValue(config, 'valid_max', 100)), 'validMax');
  if (validMin > validMax) throw new RangeError('validMin must be <= validMax');
  const staleMs = safeInteger(configValue(config, 'staleMs', configValue(config, 'stale_after_ms', 3000)), 'staleMs');
  const recoverSamples = safeInteger(configValue(config, 'recoverSamples', configValue(config, 'recover_samples', 1)), 'recoverSamples', 1, MAX_WINDOW);

  const hysteresis = configValue(config, 'hysteresis', undefined);
  let h = null;
  if (hysteresis !== undefined) {
    if (hysteresis === null || typeof hysteresis !== 'object') throw new TypeError('hysteresis must be an object');
    if (!has(hysteresis, 'onBelow') && !has(hysteresis, 'on_below')) throw new TypeError('hysteresis.onBelow is required');
    if (!has(hysteresis, 'offAbove') && !has(hysteresis, 'off_above')) throw new TypeError('hysteresis.offAbove is required');
    const onBelow = finiteNumber(has(hysteresis, 'onBelow') ? hysteresis.onBelow : hysteresis.on_below, 'hysteresis.onBelow');
    const offAbove = finiteNumber(has(hysteresis, 'offAbove') ? hysteresis.offAbove : hysteresis.off_above, 'hysteresis.offAbove');
    if (onBelow >= offAbove) throw new RangeError('hysteresis.onBelow must be < offAbove');
    const initial = configValue(hysteresis, 'initial', false);
    if (typeof initial !== 'boolean') throw new TypeError('hysteresis.initial must be boolean');
    h = { onBelow, offAbove, initial };
  }
  return { kind, window, alpha, validMin, validMax, staleMs, recoverSamples, hysteresis: h };
}

/** Small JS adapter for gf_signal_*; it performs no evaluation or code loading. */
export class SignalConditioner {
  static quality = QUALITY;

  constructor(exports, config) {
    this.wasm = exports;
    this.handle = 0;
    const parsed = parseConfig(config);
    const size = exports.gf_signal_sizeof();
    const ptr = exports.gf_alloc(size);
    try {
      const view = new DataView(exports.memory.buffer, ptr, size);
      view.setUint8(0, parsed.kind);
      view.setUint8(1, parsed.window);
      view.setUint8(2, parsed.hysteresis ? 1 : 0);
      view.setUint8(3, parsed.hysteresis?.initial ? 1 : 0);
      view.setFloat64(8, parsed.alpha, true);
      view.setFloat64(16, parsed.validMin, true);
      view.setFloat64(24, parsed.validMax, true);
      view.setBigUint64(32, BigInt(parsed.staleMs), true);
      view.setUint32(40, parsed.recoverSamples, true);
      view.setFloat64(48, parsed.hysteresis?.onBelow ?? 0, true);
      view.setFloat64(56, parsed.hysteresis?.offAbove ?? 1, true);
      this.handle = exports.gf_signal_create(ptr);
      if (!this.handle) throw new Error('invalid signal conditioner configuration');
    } finally {
      exports.gf_dealloc(ptr, size);
    }
  }

  update(sample, nowMs) {
    this.#assertLive();
    if (sample === null || typeof sample !== 'object') throw new TypeError('sample must be an object');
    const epoch = safeInteger(sample.epoch, 'sample.epoch');
    const id = safeInteger(sample.id, 'sample.id');
    const timestampMs = safeInteger(sample.timestampMs, 'sample.timestampMs');
    const now = safeInteger(nowMs, 'nowMs');
    const quality = qualityCode(sample.quality);
    const value = finiteNumber(sample.value, 'sample.value');
    const result = this.wasm.gf_signal_update(this.handle, BigInt(epoch), BigInt(id), BigInt(timestampMs), value, quality, BigInt(now));
    if (result === 0) throw new Error(this.#lastError() || 'signal update failed');
    return this.read(now);
  }

  read(nowMs) {
    this.#assertLive();
    const now = safeInteger(nowMs, 'nowMs');
    const code = this.wasm.gf_signal_readquality(this.handle, BigInt(now));
    if (!Number.isInteger(code) || code < QUALITY.NotReady || code > QUALITY.Invalid) throw new Error('WASM returned unsupported sensor quality');
    const value = this.wasm.gf_signal_readvalue(this.handle, BigInt(now));
    return {
      ok: code === QUALITY.Good,
      value: Number.isFinite(value) ? value : null,
      quality: QUALITY_NAME[code],
      dry: Boolean(this.wasm.gf_signal_readhysteresis(this.handle, BigInt(now))),
    };
  }

  reset() {
    this.#assertLive();
    if (!this.wasm.gf_signal_reset(this.handle)) throw new Error(this.#lastError() || 'signal reset failed');
  }

  dispose() {
    if (this.handle) this.wasm.gf_signal_free(this.handle);
    this.handle = 0;
  }

  #assertLive() {
    if (!this.handle) throw new Error('SignalConditioner is disposed');
  }

  #lastError() {
    const ptr = this.wasm.gf_signal_last_error_ptr(this.handle);
    const len = Number(this.wasm.gf_signal_last_error_len(this.handle));
    return ptr && len ? decoder.decode(new Uint8Array(this.wasm.memory.buffer, ptr, len)) : '';
  }
}

export { QUALITY as SignalQuality };
