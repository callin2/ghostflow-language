const encoder = new TextEncoder();
const decoder = new TextDecoder();
import { NativeDispatchError } from './native-dispatch.mjs';
import { encodeTemporalProfile } from './temporal-profile.mjs';
import { encodeSolarFacts, encodeScheduleFacts, validateSolarActivation } from './solar-abi.mjs';
import { encodeContextActivation, encodeContextFacts } from './context-abi.mjs';
import { temporalPlanRequest, temporalReplayPlanRequest, temporalReplayRequest } from './temporal-replay.mjs';

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
  activateTemporal(profile) {
    this.#bytes(encodeTemporalProfile(profile), (p, n) => this.#check(this.wasm.gf_activate_temporal(this.handle, p, n)));
  }
  activateSolar(profile) {
    validateSolarActivation(profile);
    this.#live();
    this.#check(this.wasm.gf_activate_solar(this.handle, BigInt(profile.bootEpoch), profile.terminalCapacity));
  }
  tickSolar(facts) {
    let packet;
    try { packet = encodeSolarFacts(facts); }
    catch (cause) { throw new NativeDispatchError(cause.message, { cause, committed: false }); }
    this.#bytes(packet, (p, n) => this.#dispatch(() => this.wasm.gf_tick_solar(this.handle, p, n)));
  }
  activateSchedules(profile) {
    validateSolarActivation(profile);
    this.#live();
    this.#check(this.wasm.gf_activate_schedules(this.handle, BigInt(profile.bootEpoch), profile.terminalCapacity));
  }
  tickSchedules(facts) {
    let packet;
    try { packet = encodeScheduleFacts(facts); }
    catch (cause) { throw new NativeDispatchError(cause.message, { cause, committed: false }); }
    this.#bytes(packet, (p, n) => this.#dispatch(() => this.wasm.gf_tick_schedules(this.handle, p, n)));
  }
  activateContext(profile) {
    const packet = encodeContextActivation(profile);
    this.#bytes(packet, (p, n) => this.#check(this.wasm.gf_activate_context(this.handle, p, n)));
  }
  tickContext(facts) {
    let packet;
    try { packet = encodeContextFacts(facts); }
    catch (cause) { throw new NativeDispatchError(cause.message, { cause, committed: false }); }
    this.#bytes(packet, (p, n) => this.#dispatch(() => this.wasm.gf_tick_context(this.handle, p, n)));
  }
  replayTemporal(options) {
    const request = temporalReplayRequest(options);
    return this.#bytes(request.profile, (p, n) => {
      this.#check(this.wasm.gf_replay_temporal(this.handle, p, n, request.count,
        request.maxPeakTemporalBytes, request.maxJsonBytes));
      return this.replay;
    });
  }
  planTemporal(options) {
    const request = temporalPlanRequest(options);
    return this.#bytes(request.profile, (p, n) => {
      this.#check(this.wasm.gf_plan_temporal(this.handle, p, n, request.maxJsonBytes));
      return this.resourcePlan;
    });
  }
  planTemporalReplay(options) {
    const request = temporalReplayPlanRequest(options);
    return this.#bytes(request.profile, (p, n) => {
      this.#check(this.wasm.gf_plan_temporal_replay(this.handle, p, n, request.count, request.maxJsonBytes));
      return this.resourcePlan;
    });
  }
  tick() { this.#dispatch(() => this.wasm.gf_tick(this.handle)); }
  tickAt(milliseconds) {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new NativeDispatchError('invalid monotonic milliseconds', { committed: false });
    }
    this.#dispatch(() => this.wasm.gf_tick_at(this.handle, BigInt(milliseconds)));
  }
  clearInputs() { this.#live(); this.wasm.gf_clear_inputs(this.handle); }
  get trace() {
    this.#live();
    const ptr = this.wasm.gf_trace_ptr(this.handle);
    const len = Number(this.wasm.gf_trace_len(this.handle));
    return JSON.parse(decoder.decode(new Uint8Array(this.wasm.memory.buffer, ptr, len)));
  }
  get replay() {
    this.#live();
    const ptr = this.wasm.gf_replay_ptr(this.handle);
    const len = Number(this.wasm.gf_replay_len(this.handle));
    return ptr && len ? JSON.parse(decoder.decode(new Uint8Array(this.wasm.memory.buffer, ptr, len))) : null;
  }
  get resourcePlan() {
    this.#live();
    const ptr = this.wasm.gf_resource_plan_ptr(this.handle);
    const len = Number(this.wasm.gf_resource_plan_len(this.handle));
    return ptr && len ? JSON.parse(decoder.decode(new Uint8Array(this.wasm.memory.buffer, ptr, len))) : null;
  }
  rewind(tick) { this.#check(this.wasm.gf_rewind(this.handle, BigInt(tick))); }
  get journalLength() { return Number(this.wasm.gf_journal_len(this.handle)); }

  addCapability(kind, name, type) {
    if (!['bool', 'number', 'int'].includes(type)) throw new Error('invalid capability type');
    this.#twoTexts(kind, name, (kp, kn, np, nn) =>
      this.#check(this.wasm.gf_add_capability(this.handle, kp, kn, np, nn, { bool: 1, number: 2, int: 3 }[type])));
  }

  setBool(name, value) {
    if (typeof value !== 'boolean') throw new Error('expected boolean');
    this.#text(name, (p, n) => this.#check(this.wasm.gf_set_bool(this.handle, p, n, value ? 1 : 0)));
  }

  setNumber(name, value) {
    if (!Number.isFinite(value)) throw new Error('expected finite number');
    this.#text(name, (p, n) => this.#check(this.wasm.gf_set_number(this.handle, p, n, value)));
  }

  setInt(name, value) {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new Error('expected signed i32 integer');
    this.#text(name, (p, n) => this.#check(this.wasm.gf_set_int(this.handle, p, n, value)));
  }

  stateBool(name) { return this.#getBool('gf_get_state_bool', name); }
  intentBool(name) { return this.#getBool('gf_get_intent_bool', name); }
  stateNumber(name) { return this.#getNumber('gf_get_state_number', name); }
  intentNumber(name) { return this.#getNumber('gf_get_intent_number', name); }
  stateInt(name) { return this.#getInt('gf_get_state_int', name); }
  intentInt(name) { return this.#getInt('gf_get_intent_int', name); }

  #getInt(functionName, name) {
    return this.#text(name, (p, n) => {
      const found = this.wasm.gf_alloc(4);
      try {
        new DataView(this.wasm.memory.buffer).setInt32(found, 0, true);
        const value = this.wasm[functionName](this.handle, p, n, found);
        return new DataView(this.wasm.memory.buffer).getInt32(found, true) ? value : undefined;
      } finally { this.wasm.gf_dealloc(found, 4); }
    });
  }

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
  #dispatch(callback) {
    let committed = false;
    try {
      committed = null;
      const ok = callback();
      committed = Boolean(ok);
      if (!ok) throw new Error(this.#lastError() || 'GhostFlow operation failed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new NativeDispatchError(message, { cause: error, committed });
    }
  }
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
