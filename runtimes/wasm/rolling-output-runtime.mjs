import { compileSource } from '../../tools/compile-source.mjs';

const creation = Symbol('verified rolling output');

function milliseconds(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('expected nonnegative integer milliseconds');
  return BigInt(value);
}

/**
 * Connects a verified installation's one Bool output to an authored rolling
 * policy. The host still owns applying ON/OFF and obtaining their timestamps.
 */
export class RollingOutputRuntime {
  #wasm;
  #handle;
  #store;
  #saved;
  #writing = false;

  static async open(wasmBytes, source, { binding, nowMs, store, maxIntervals }) {
    const { manifest } = await compileSource(source);
    const { resource, output, resourceId } = binding;
    if (!Number.isInteger(resourceId) || resourceId < 1 || resourceId > 0xffff_ffff
      || !manifest.resources?.some(port => port.name === resource && port.type === 'BoolActuator')
      || !manifest.outputs.some(port => port.name === output && port.type === 'Bool')) {
      throw new Error('rolling output requires a verified Bool resource and output binding');
    }
    const { bindings = [], constraints = [] } = manifest.accounting ?? {};
    const [account] = bindings;
    const limits = constraints.flatMap(group => group.limits);
    const [limit] = limits;
    if (bindings.length !== 1 || limits.length !== 1 || account.operation !== 'on_time'
      || account.persistence !== 'durable' || account.evidenceBinding.stage !== 'applied'
      || account.evidenceBinding.target !== resource || limit.account !== account.name
      || limit.operator !== '<=' || limit.basis.kind !== 'rolling' || limit.onUnknown !== 'block') {
      throw new Error('expected one durable applied rolling limit for the installed output');
    }
    if (!Number.isInteger(maxIntervals) || maxIntervals < 1 || maxIntervals > 4096) {
      throw new RangeError('maxIntervals must be 1..4096');
    }
    if (typeof store?.read !== 'function' || typeof store?.commit !== 'function') {
      throw new TypeError('rolling output requires a durable checkpoint store');
    }
    const { instance: { exports: wasm } } = await WebAssembly.instantiate(wasmBytes);
    // null is an explicit known-empty result from the installation owner.
    // Missing or unreadable existing history must be reported as an error.
    const saved = await store.read();
    if (saved !== null && (!(saved instanceof Uint8Array) || saved.length === 0)) {
      throw new Error('invalid rolling output checkpoint');
    }
    const size = saved?.length ?? 0;
    const ptr = size ? wasm.gf_alloc(size) : 0;
    let handle;
    try {
      if (size) new Uint8Array(wasm.memory.buffer, ptr, size).set(saved);
      handle = wasm.gf_rolling_output_open(resourceId, milliseconds(limit.basis.durationMs),
        milliseconds(limit.boundMs), milliseconds(limit.reserveMs), maxIntervals, milliseconds(nowMs), ptr, size);
    } finally {
      if (size) wasm.gf_dealloc(ptr, size);
    }
    if (!handle) throw new Error('rolling output checkpoint does not match the installed policy');
    const runtime = new RollingOutputRuntime(wasm, handle, store, saved, creation);
    try {
      if (saved === null) await runtime.#commit();
      return runtime;
    } catch (error) {
      runtime.dispose();
      throw error;
    }
  }

  constructor(wasm, handle, store, saved, token) {
    if (token !== creation) throw new Error('use RollingOutputRuntime.open with a verified installation binding');
    this.#wasm = wasm;
    this.#handle = handle;
    this.#store = store;
    this.#saved = saved?.slice() ?? null;
  }

  #requireReady() {
    if (!this.#handle || this.#writing) throw new Error('rolling output is unavailable while saving or closed');
  }

  async #commit() {
    const wasm = this.#wasm;
    const size = wasm.gf_rolling_output_pending_len(this.#handle);
    if (!size) throw new Error('no pending rolling output checkpoint');
    const ptr = wasm.gf_rolling_output_pending_ptr(this.#handle);
    const snapshot = new Uint8Array(wasm.memory.buffer, ptr, size).slice();
    this.#writing = true;
    try {
      // The store must compare and replace atomically, even across hosts.
      if (await this.#store.commit(snapshot.slice(), this.#saved?.slice() ?? null) !== true) {
        throw new Error('rolling output checkpoint was not committed');
      }
      this.#saved = snapshot;
      return wasm.gf_rolling_output_ack(this.#handle);
    } finally {
      this.#writing = false;
    }
  }

  async requestOn(nowMs) {
    this.#requireReady();
    const status = this.#wasm.gf_rolling_output_prepare(this.#handle, milliseconds(nowMs));
    if (status === 2) return { status: 'budget-exceeded' };
    if (status === 3) return { status: 'unsettled-output' };
    if (status !== 1) return { status: 'unavailable' };
    const deadline = Number(await this.#commit());
    if (!Number.isSafeInteger(deadline) || deadline <= nowMs) return { status: 'unavailable' };
    return { status: 'allowed', deadlineMs: deadline };
  }

  async recordOff(startedAtMs, offAtMs) {
    this.#requireReady();
    const status = this.#wasm.gf_rolling_output_finish(this.#handle,
      startedAtMs !== null, milliseconds(startedAtMs ?? 0), milliseconds(offAtMs));
    if (status !== 1) throw new Error('rolling output could not settle the applied interval');
    await this.#commit();
  }

  async recoverAfterConfirmedOff(confirmedOffAtMs, nowMs) {
    this.#requireReady();
    const status = this.#wasm.gf_rolling_output_recover(this.#handle, milliseconds(confirmedOffAtMs), milliseconds(nowMs));
    if (status === 2) return false;
    if (status !== 1) throw new Error('rolling output cannot recover the previous application');
    await this.#commit();
    return true;
  }

  explain(nowMs) {
    this.#requireReady();
    const wasm = this.#wasm;
    const ptr = wasm.gf_alloc(40);
    try {
      const status = wasm.gf_rolling_output_explain(this.#handle, milliseconds(nowMs), ptr);
      if (status !== 1) return null;
      const [usedMs, reservedMs, blocked, hasRelease, releaseMs] = new BigUint64Array(wasm.memory.buffer, ptr, 5);
      return { usedMs, reservedMs, blocked: blocked !== 0n, nextReleaseMs: hasRelease ? releaseMs : null };
    } finally {
      wasm.gf_dealloc(ptr, 40);
    }
  }

  dispose() {
    this.#requireReady();
    this.#wasm.gf_rolling_output_close(this.#handle);
    this.#handle = 0;
  }
}
