// Transport only. All evidence admission and continuity decisions belong to Rust.
const decoder = new TextDecoder();
const faults = [null, 'NotReady', 'Disconnected', 'Stale', 'Invalid', 'SourceChanged', 'ClockBackward', 'FutureTimestamp'];
const results = ['Requested', 'Acknowledged', 'WriteFailed', 'Unknown'];
export const ESTIMATE_MAX_PACKET = 298 + 64 * 146;
function fields(v, names) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== names.length
    || names.some(n => !Object.hasOwn(v, n))) throw new TypeError('invalid estimate fields');
}
function packet(kind, write) {
  const bytes = new Uint8Array(ESTIMATE_MAX_PACKET); const view = new DataView(bytes.buffer); let at = 6;
  bytes.set([71, 70, 69, 69, 1, kind]);
  const byte = n => { if (!Number.isInteger(n) || n < 0 || n > 255) throw new TypeError('invalid byte'); view.setUint8(at++, n); };
  const flag = v => { if (typeof v !== 'boolean') throw new TypeError('invalid flag'); byte(v ? 1 : 0); };
  const u64 = value => {
    if (!(typeof value === 'bigint' || (typeof value === 'number' && Number.isSafeInteger(value))
      || (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)))) throw new TypeError('invalid exact u64');
    const n = BigInt(value); if (n < 0n || n > 0xffffffffffffffffn) throw new RangeError('u64 range');
    view.setBigUint64(at, n, true); at += 8;
  };
  const digest = d => { if (typeof d !== 'string' || !/^[0-9a-f]{64}$/.test(d)) throw new TypeError('invalid digest');
    for (let i = 0; i < 64; i += 2) byte(Number.parseInt(d.slice(i, i + 2), 16)); };
  const context = c => { fields(c, ['identities', 'run', 'timeEpoch', 'sourceEpoch']);
    if (!Array.isArray(c.identities) || c.identities.length !== 7) throw new TypeError('invalid context identities');
    c.identities.forEach(digest); u64(c.run); u64(c.timeEpoch); u64(c.sourceEpoch); };
  write({ byte, flag, u64, digest, context, bound: b => {
    if (typeof b !== 'number' || !Number.isFinite(b) || b < 0) throw new TypeError('invalid uncertainty bound');
    view.setFloat64(at, b, true); at += 8;
  } });
  return bytes.slice(0, at);
}
export function encodeEstimateConfig(config) {
  fields(config, ['basis', 'capacity', 'reference']);
  if (!['Requested', 'AcknowledgedWrites'].includes(config.basis)) throw new TypeError('invalid basis');
  if (!Number.isInteger(config.capacity) || config.capacity < 1 || config.capacity > 64) throw new RangeError('unsupported history capacity');
  return packet(0, w => {
    w.byte(config.basis === 'Requested' ? 0 : 1); w.byte(config.capacity); w.flag(config.reference !== null);
    if (config.reference !== null) {
      const r = config.reference; fields(r, ['context', 'establishedMs', 'initialSequence', 'uncertainty']);
      fields(r.uncertainty, ['meaning', 'bound']); w.context(r.context); w.u64(r.establishedMs); w.u64(r.initialSequence);
      w.digest(r.uncertainty.meaning); w.flag(r.uncertainty.bound !== null);
      if (r.uncertainty.bound !== null) w.bound(r.uncertainty.bound);
    }
  });
}
export function encodeEstimateEvaluation(evaluation) {
  fields(evaluation, ['context', 'nowMs', 'sourceFault', 'history']);
  const fault = faults.indexOf(evaluation.sourceFault); if (fault < 0) throw new TypeError('invalid source fault');
  return packet(1, w => {
    w.context(evaluation.context); w.u64(evaluation.nowMs); w.byte(fault); w.flag(evaluation.history !== null);
    if (evaluation.history !== null) {
      const h = evaluation.history;
      fields(h, ['initialSequence', 'currentSequence', 'observedFromMs', 'observedThroughMs', 'complete', 'records']);
      if (!Array.isArray(h.records) || h.records.length > 64) throw new RangeError('history capacity');
      w.u64(h.initialSequence); w.u64(h.currentSequence); w.u64(h.observedFromMs); w.u64(h.observedThroughMs);
      w.flag(h.complete); w.byte(h.records.length);
      for (const r of h.records) {
        fields(r, ['origin', 'sequence', 'identity', 'atMs', 'target', 'result']); const result = results.indexOf(r.result);
        if (result < 0) throw new TypeError('invalid application result');
        fields(r.origin, ['boot','program','binding','run','timeEpoch','sourceEpoch']);
        w.digest(r.origin.boot); w.digest(r.origin.program); w.digest(r.origin.binding);
        w.u64(r.origin.run); w.u64(r.origin.timeEpoch); w.u64(r.origin.sourceEpoch);
        w.u64(r.sequence); w.u64(r.identity); w.u64(r.atMs); w.byte(r.target); w.byte(result);
      }
    }
  });
}
export class EstimateEvidenceRuntime {
  static async instantiate(bytes, config) {
    const encoded = encodeEstimateConfig(config);
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const runtime = new EstimateEvidenceRuntime(); runtime.wasm = instance.exports;
    runtime.handle = runtime.#packet(encoded, (ptr, len) => runtime.wasm.gf_estimate_new(ptr, len));
    if (!runtime.handle) throw new Error('estimate session rejected');
    return runtime;
  }
  #packet(bytes, call) {
    const ptr = this.wasm.gf_alloc(bytes.length);
    try { new Uint8Array(this.wasm.memory.buffer, ptr, bytes.length).set(bytes); return call(ptr, bytes.length); }
    finally { this.wasm.gf_dealloc(ptr, bytes.length); }
  }
  #text(name) {
    if (!this.handle) throw new Error('estimate session disposed');
    const ptr = this.wasm[`gf_estimate_${name}_ptr`](this.handle);
    const len = this.wasm[`gf_estimate_${name}_len`](this.handle);
    return decoder.decode(new Uint8Array(this.wasm.memory.buffer, ptr, len));
  }
  get snapshot() { return JSON.parse(this.#text('snapshot')); }
  evaluate(evaluation) { return this.evaluatePacket(encodeEstimateEvaluation(evaluation)); }
  evaluatePacket(bytes) {
    if (!this.handle) throw new Error('estimate session disposed');
    if (!(bytes instanceof Uint8Array) || bytes.length > ESTIMATE_MAX_PACKET) throw new TypeError('invalid estimate packet');
    if (!this.#packet(bytes, (ptr, len) => this.wasm.gf_estimate_evaluate(this.handle, ptr, len))) throw new Error(this.#text('error'));
    return this.snapshot;
  }
  dispose() { if (this.handle) this.wasm.gf_estimate_destroy(this.handle); this.handle = 0; }
}
