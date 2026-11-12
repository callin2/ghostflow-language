import { compileSource } from '../../tools/compile-source.mjs';
import { FramedGhostFlowRuntime } from './framed-runtime.mjs';

const creation = Symbol('verified rolling output');

function milliseconds(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('expected nonnegative integer milliseconds');
  return BigInt(value);
}

/**
 * Connects a verified installation's one Bool output to an authored rolling
 * policy. The host supplies one monotonic clock for admission and applies ON/OFF
 * within the returned deadline using that same clock. A new bootEpoch is
 * required whenever the host clock resets.
 */
export class RollingOutputRuntime {
  #wasm;
  #handle;
  #store;
  #clock;
  #saved;
  #programBytes;
  #binding;
  #writing = false;

  static async open(wasmBytes, source, { binding, bootEpoch, clock, store, maxIntervals, filename, hardwareProfiles }) {
    const { manifest, bytes } = await compileSource(source, { filename, hardwareProfiles });
    const { resource, output, resourceId } = binding;
    const policy = manifest.rollingOutput;
    if (manifest.format !== 'GhostFlow/control-v29' || !policy
      || !Number.isInteger(resourceId) || resourceId < 1 || resourceId > 0xffff_ffff
      || policy.resource !== resource || policy.output !== output) {
      throw new Error('rolling output requires a verified Bool resource and output binding');
    }
    if (!Number.isInteger(maxIntervals) || maxIntervals < 1 || maxIntervals > 4096) {
      throw new RangeError('maxIntervals must be 1..4096');
    }
    if (typeof store?.read !== 'function' || typeof store?.commit !== 'function') {
      throw new TypeError('rolling output requires a durable checkpoint store');
    }
    if (!Number.isSafeInteger(bootEpoch) || bootEpoch <= 0) throw new RangeError('rolling output requires a positive boot epoch');
    if (typeof clock !== 'function') throw new TypeError('rolling output requires a monotonic clock');
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
      handle = wasm.gf_rolling_output_open(resourceId, milliseconds(policy.windowMs),
        milliseconds(policy.limitMs), milliseconds(policy.reserveMs), maxIntervals, BigInt(bootEpoch), milliseconds(clock()), ptr, size);
    } finally {
      if (size) wasm.gf_dealloc(ptr, size);
    }
    if (!handle) throw new Error('rolling output checkpoint does not match the installed policy');
    const runtime = new RollingOutputRuntime(wasm, handle, store, clock, saved, bytes, { resource, output, resourceId }, creation);
    try {
      if (saved === null) await runtime.#commit();
      return runtime;
    } catch (error) {
      runtime.dispose();
      throw error;
    }
  }

  constructor(wasm, handle, store, clock, saved, programBytes, binding, token) {
    if (token !== creation) throw new Error('use RollingOutputRuntime.open with a verified installation binding');
    this.#wasm = wasm;
    this.#handle = handle;
    this.#store = store;
    this.#clock = clock;
    this.#saved = saved?.slice() ?? null;
    this.#programBytes = programBytes;
    this.#binding = binding;
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

  /** Evaluate safe proposals. This never applies an actuator value. */
  createProposalRuntime(capabilities) {
    this.#requireReady();
    const runtime = new FramedGhostFlowRuntime(this.#wasm);
    try {
      runtime.loadRollingProposals(this.#programBytes, this.#handle, this.#binding);
      for (const { kind, name, type } of capabilities) runtime.addCapability(kind, name, type);
      runtime.activate();
      return runtime;
    } catch (error) {
      runtime.dispose();
      throw error;
    }
  }

  async requestOn(stopMarginMs = 0) {
    this.#requireReady();
    const nowMs = this.#clock();
    const status = this.#wasm.gf_rolling_output_prepare(this.#handle, milliseconds(nowMs), milliseconds(stopMarginMs));
    if (status === 2) return { status: 'budget-exceeded' };
    if (status === 3) return { status: 'unsettled-output' };
    if (status === 4) return { status: 'stop-margin' };
    if (status !== 1) return { status: 'unavailable' };
    const deadline = Number(await this.#commit());
    if (!Number.isSafeInteger(deadline) || deadline <= nowMs) return { status: 'unavailable' };
    const committedAtMs = this.#clock();
    milliseconds(committedAtMs);
    if (committedAtMs < nowMs) return { status: 'unavailable' };
    if (deadline - committedAtMs <= stopMarginMs) {
      // No ON was granted. Release the expired reservation durably.
      await this.recordOff(null, committedAtMs);
      return { status: committedAtMs >= deadline ? 'deadline-expired' : 'stop-margin' };
    }
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
