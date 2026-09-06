const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class GhostFlowRuntime {
  static async instantiate(wasmBytes, imports = {}) {
    const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
    return new GhostFlowRuntime(instance.exports);
  }

  constructor(exports) {
    this.wasm = exports;
    this.handle = exports.gf_create();
    if (!this.handle) throw new Error('GhostFlow runtime allocation failed');
  }

  dispose() {
    if (this.handle) this.wasm.gf_destroy(this.handle);
    this.handle = 0;
  }

  load(moduleBytes) { this.#bytes(moduleBytes, (p, n) => this.#check(this.wasm.gf_load(this.handle, p, n))); }
  hotSwap(moduleBytes) { this.#bytes(moduleBytes, (p, n) => this.#check(this.wasm.gf_hot_swap(this.handle, p, n))); }
  activate() { this.#check(this.wasm.gf_activate(this.handle)); }
  tick() { this.#check(this.wasm.gf_tick(this.handle)); }
  tickAt(milliseconds) {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error('invalid monotonic milliseconds');
    this.#check(this.wasm.gf_tick_at(this.handle, BigInt(milliseconds)));
  }
  clearInputs() { this.#live(); this.wasm.gf_clear_inputs(this.handle); }
  get trace() {
    this.#live();
    const ptr = this.wasm.gf_trace_ptr(this.handle);
    const len = Number(this.wasm.gf_trace_len(this.handle));
    return JSON.parse(decoder.decode(new Uint8Array(this.wasm.memory.buffer, ptr, len)));
  }
  rewind(tick) { this.#check(this.wasm.gf_rewind(this.handle, BigInt(tick))); }
  get journalLength() { return Number(this.wasm.gf_journal_len(this.handle)); }

  addCapability(kind, name, type) {
    if (!['bool', 'number'].includes(type)) throw new Error('invalid capability type');
    this.#twoTexts(kind, name, (kp, kn, np, nn) =>
      this.#check(this.wasm.gf_add_capability(this.handle, kp, kn, np, nn, type === 'number' ? 2 : 1)));
  }

  setBool(name, value) {
    if (typeof value !== 'boolean') throw new Error('expected boolean');
    this.#text(name, (p, n) => this.#check(this.wasm.gf_set_bool(this.handle, p, n, value ? 1 : 0)));
  }

  setNumber(name, value) {
    if (!Number.isFinite(value)) throw new Error('expected finite number');
    this.#text(name, (p, n) => this.#check(this.wasm.gf_set_number(this.handle, p, n, value)));
  }

  stateBool(name) { return this.#getBool('gf_get_state_bool', name); }
  intentBool(name) { return this.#getBool('gf_get_intent_bool', name); }
  stateNumber(name) { return this.#getNumber('gf_get_state_number', name); }
  intentNumber(name) { return this.#getNumber('gf_get_intent_number', name); }

  #getNumber(functionName, name) {
    return this.#text(name, (p, n) => {
      const found = this.wasm.gf_alloc(4);
      try {
        const value = this.wasm[functionName](this.handle, p, n, found);
        return new DataView(this.wasm.memory.buffer).getInt32(found, true) ? value : undefined;
      } finally { this.wasm.gf_dealloc(found, 4); }
    });
  }
  #live() { if (!this.handle) throw new Error('runtime is disposed'); }

  #getBool(functionName, name) {
    return this.#text(name, (p, n) => {
      const found = this.wasm.gf_alloc(4);
      try {
        new DataView(this.wasm.memory.buffer).setInt32(found, 0, true);
        const value = this.wasm[functionName](this.handle, p, n, found);
        return new DataView(this.wasm.memory.buffer).getInt32(found, true) ? Boolean(value) : undefined;
      } finally { this.wasm.gf_dealloc(found, 4); }
    });
  }

  #check(ok) { if (!ok) throw new Error(this.#lastError() || 'GhostFlow operation failed'); }
  #lastError() {
    const ptr = this.wasm.gf_last_error_ptr(this.handle);
    const len = Number(this.wasm.gf_last_error_len(this.handle));
    return ptr && len ? decoder.decode(new Uint8Array(this.wasm.memory.buffer, ptr, len)) : '';
  }
  #bytes(value, callback) {
    this.#live();
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    const ptr = this.wasm.gf_alloc(bytes.length);
    try { new Uint8Array(this.wasm.memory.buffer, ptr, bytes.length).set(bytes); return callback(ptr, bytes.length); }
    finally { this.wasm.gf_dealloc(ptr, bytes.length); }
  }
  #text(value, callback) { return this.#bytes(encoder.encode(value), callback); }
  #twoTexts(a, b, callback) {
    return this.#text(a, (ap, an) => this.#text(b, (bp, bn) => callback(ap, an, bp, bn)));
  }
}
