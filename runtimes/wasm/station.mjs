// Host wrapper for the station C ABI. Storage stays outside WASM: `prepare*`
// returns an immutable image, and only the host's successful durable write may
// be followed by `commit*`. `requestStop` is intentionally different: it
// returns a safe-output directive synchronously and never waits for storage.

const capacityCode = ['Pass', 'Violation', 'Unknown'];
const decoder = new TextDecoder();
const U64_MAX = 0xffff_ffff_ffff_ffffn;

function u64(value, name) {
  if (typeof value === 'bigint') {
    if (value < 0n || value > U64_MAX) throw new RangeError(`${name} must be an unsigned 64-bit integer`);
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new TypeError(`${name} must be a non-negative BigInt or safe integer Number`);
}

function u8(value, name) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(`${name} must be an unsigned 8-bit integer`);
  return value;
}

function u32(value, name) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError(`${name} must be an unsigned 32-bit integer`);
  return value;
}

function bool(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean`);
  return value;
}

function modeCode(mode) {
  if (mode === 'Auto' || mode === 'auto') return 1;
  if (mode === 'Manual' || mode === 'manual') return 2;
  if (mode === 'Configure' || mode === 'configure') return 3;
  throw new TypeError('mode must be Auto, Manual, or Configure');
}

function finishCode(outcome) {
  if (outcome === 'Completed' || outcome === 'completed') return 1;
  if (outcome === 'Cancelled' || outcome === 'cancelled') return 2;
  if (outcome === 'SkippedByStop' || outcome === 'skippedByStop') return 3;
  throw new TypeError('finish outcome must be Completed, Cancelled, or SkippedByStop');
}

function proofCode(proof) {
  if (proof === undefined || proof === 'Commanded' || proof === 'commanded') return 0;
  if (proof === 'Verified' || proof === 'verified') return 1;
  throw new TypeError('stop proof must be Commanded or Verified');
}

function optionalCapacity(value, name) {
  if (value === undefined || value === null) return -1n;
  return BigInt(u32(value, name));
}

export class GhostFlowStation {
  static async instantiate(wasmBytes, config = {}, imports = {}) {
    const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
    return new GhostFlowStation(instance.exports, config);
  }

  constructor(exports, config = {}) {
    if (!exports || typeof exports !== 'object') throw new TypeError('WASM exports are required');
    if (!exports.gf_station_create || !exports.gf_station_daily_used_ms || !exports.gf_station_reserved_ms || !exports.gf_alloc || !exports.gf_dealloc || !exports.memory) throw new Error('WASM module does not include the GhostFlow station ABI');
    if (config === null || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('station config must be an object');
    this.wasm = exports;
    const valveCount = u8(config.valveCount ?? 8, 'valveCount');
    const maxOpenValves = u8(config.maxOpenValves ?? 2, 'maxOpenValves');
    const quotaMs = u64(config.dailyQuotaMs ?? 3_600_000, 'dailyQuotaMs');
    const maxBudgetMs = u64(config.maxStartBudgetMs ?? 1_800_000, 'maxStartBudgetMs');
    const requireCapacityPass = bool(config.requireCapacityPass ?? false, 'requireCapacityPass');
    this.handle = exports.gf_station_create(valveCount, maxOpenValves, quotaMs, maxBudgetMs, requireCapacityPass ? 1 : 0);
    if (!this.handle) throw new Error('invalid GhostFlow station configuration');
  }

  dispose() {
    if (this.handle) this.wasm.gf_station_destroy(this.handle);
    this.handle = 0;
  }

  get claim() {
    this.#alive();
    return { revision: this.wasm.gf_station_revision(this.handle), stopGeneration: this.wasm.gf_station_stop_generation(this.handle) };
  }

  get mode() {
    this.#alive();
    return ['Stopped', 'Auto', 'Manual', 'Configure'][this.wasm.gf_station_mode(this.handle)] ?? 'Invalid';
  }

  get stopping() { this.#alive(); return Boolean(this.wasm.gf_station_stopping(this.handle)); }
  // Global physical-pump accounting: ON time is reported by the host driver and is
  // shared across every session of this one station.
  get dailyUsedMs() { this.#alive(); return this.wasm.gf_station_daily_used_ms(this.handle); }
  // Finite budgets reserved by active or conservatively cancelled starts.
  get reservedMs() { this.#alive(); return this.wasm.gf_station_reserved_ms(this.handle); }
  get lastLeaseDeadlineMs() { this.#alive(); return this.wasm.gf_station_last_lease_deadline(this.handle); }

  synchronizeDay({ day, nowMs, nextDayDeadlineMs, trusted = true }) {
    this.#alive();
    this.#check(this.wasm.gf_station_synchronize_day(this.handle, u32(day, 'day'), u64(nowMs, 'nowMs'), u64(nextDayDeadlineMs, 'nextDayDeadlineMs'), bool(trusted, 'trusted') ? 1 : 0));
  }

  acknowledgeRecoverySafeOutput({ proof = 'Commanded', nowMs }) {
    this.#alive();
    this.#check(this.wasm.gf_station_acknowledge_recovery_safe(this.handle, proofCode(proof), u64(nowMs, 'nowMs')));
  }

  enter({ requestId, revision, stopGeneration, mode }) {
    this.#alive();
    this.#check(this.wasm.gf_station_enter(this.handle, modeCode(mode), u64(requestId, 'requestId'), u64(revision, 'revision'), u64(stopGeneration, 'stopGeneration')));
  }

  // request.valves is the session's permitted set across all sequential steps.
  // It is not an output command: authorizeOutput still enforces maxOpenValves
  // on every simultaneously applied mask and rejects valves outside this set.
  prepareStart(request) {
    this.#alive();
    this.#check(this.wasm.gf_station_prepare_start(
      this.handle, u64(request.requestId, 'requestId'), u64(request.revision, 'revision'), u64(request.stopGeneration, 'stopGeneration'),
      u64(request.sessionId, 'sessionId'), u64(request.ownerId, 'ownerId'), modeCode(request.mode), u64(request.valves, 'valves'), u64(request.budgetMs, 'budgetMs'),
      request.occurrenceId === undefined || request.occurrenceId === null ? 0n : u64(request.occurrenceId, 'occurrenceId'),
      optionalCapacity(request.capacity?.availableFlow, 'capacity.availableFlow'), optionalCapacity(request.capacity?.requestedFlow, 'capacity.requestedFlow'), u64(request.nowMs, 'nowMs'),
    ));
    return this.#prepared();
  }

  commitStart(token) {
    this.#alive();
    this.#check(this.wasm.gf_station_commit_start(this.handle, u64(token, 'token')));
    return { leaseDeadlineMs: this.lastLeaseDeadlineMs, capacity: capacityCode[this.wasm.gf_station_last_capacity(this.handle)] };
  }

  async start(request, persist) {
    const prepared = this.prepareStart(request);
    await this.#persist(persist, prepared);
    return this.commitStart(prepared.token);
  }

  // This legacy durable route is useful when an orchestrator must write terminal
  // occurrence records before it considers a scheduling tick complete. It is not
  // an emergency-stop primitive; use requestStop for immediate safe output.
  prepareStop({ requestId, revision, stopGeneration, skippedOccurrenceIds = [] }) {
    this.#alive();
    return this.#u64Array(skippedOccurrenceIds, (ptr, len) => {
      this.#check(this.wasm.gf_station_prepare_stop(this.handle, u64(requestId, 'requestId'), u64(revision, 'revision'), u64(stopGeneration, 'stopGeneration'), ptr, len));
      return this.#prepared();
    });
  }

  commitStop(token) {
    this.#alive();
    this.#check(this.wasm.gf_station_commit_stop(this.handle, u64(token, 'token')));
    return { forceSafeOutputs: true, reason: 'StopRequested' };
  }

  // Synchronous and storage-independent. Apply the returned safe directive before
  // awaiting any durable write. `skippedOccurrenceIds` is recorded in snapshot().
  requestStop({ requestId, revision, stopGeneration, skippedOccurrenceIds = [] }) {
    this.#alive();
    return this.#u64Array(skippedOccurrenceIds, (ptr, len) => {
      const code = this.wasm.gf_station_request_stop(this.handle, u64(requestId, 'requestId'), u64(revision, 'revision'), u64(stopGeneration, 'stopGeneration'), ptr, len);
      return this.#directive(code, 'StopRequested');
    });
  }

  // Convenience only: the required sink must synchronously command physical safe
  // outputs before this method begins a snapshot write. Prefer direct requestStop
  // followed by the driver's safe-output command in host control code.
  async stop(request, persist, onSafeOutputs) {
    if (typeof onSafeOutputs !== 'function') throw new TypeError('onSafeOutputs must synchronously apply the safe-output directive');
    const directive = this.requestStop(request);
    const applied = onSafeOutputs(directive);
    if (applied && typeof applied.then === 'function') throw new TypeError('onSafeOutputs must be synchronous; use requestStop directly for async drivers');
    await this.#persist(persist, { token: 0n, bytes: this.snapshot() });
    return directive;
  }

  confirmStopped({ proof = 'Commanded', nowMs }) {
    this.#alive();
    this.#check(this.wasm.gf_station_confirm_stopped(this.handle, proofCode(proof), u64(nowMs, 'nowMs')));
  }

  prepareApply({ requestId, revision, stopGeneration, nextRevision }) {
    this.#alive();
    this.#check(this.wasm.gf_station_prepare_apply(this.handle, u64(requestId, 'requestId'), u64(revision, 'revision'), u64(stopGeneration, 'stopGeneration'), u64(nextRevision, 'nextRevision')));
    return this.#prepared();
  }

  commitApply(token) { this.#alive(); this.#check(this.wasm.gf_station_commit_apply(this.handle, u64(token, 'token'))); return this.claim.revision; }
  async apply(request, persist) { const prepared = this.prepareApply(request); await this.#persist(persist, prepared); return this.commitApply(prepared.token); }

  authorizeOutput({ sessionId, pumpOn, valves, nowMs }) {
    this.#alive();
    this.#check(this.wasm.gf_station_authorize_output(this.handle, u64(sessionId, 'sessionId'), bool(pumpOn, 'pumpOn') ? 1 : 0, u64(valves, 'valves'), u64(nowMs, 'nowMs')));
    return { sessionId: u64(sessionId, 'sessionId'), pumpOn, valves: u64(valves, 'valves'), leaseDeadlineMs: this.lastLeaseDeadlineMs };
  }

  reportApplied({ sessionId, pumpOn, valves, nowMs }) {
    this.#alive();
    this.#check(this.wasm.gf_station_report_applied(this.handle, u64(sessionId, 'sessionId'), bool(pumpOn, 'pumpOn') ? 1 : 0, u64(valves, 'valves'), u64(nowMs, 'nowMs')));
  }

  advance(nowMs) {
    this.#alive();
    return this.#directive(this.wasm.gf_station_advance(this.handle, u64(nowMs, 'nowMs')), 'LeaseExpired');
  }

  prepareFinish({ sessionId, outcome = 'Completed', nowMs }) {
    this.#alive();
    this.#check(this.wasm.gf_station_prepare_finish(this.handle, u64(sessionId, 'sessionId'), finishCode(outcome), u64(nowMs, 'nowMs')));
    return this.#prepared();
  }

  commitFinish(token) { this.#alive(); this.#check(this.wasm.gf_station_commit_finish(this.handle, u64(token, 'token'))); }
  async finish(request, persist) { const prepared = this.prepareFinish(request); await this.#persist(persist, prepared); this.commitFinish(prepared.token); }

  abortPrepared(token) { this.#alive(); this.#check(this.wasm.gf_station_abort_prepared(this.handle, u64(token, 'token'))); }
  snapshot() { this.#alive(); this.#check(this.wasm.gf_station_snapshot(this.handle)); return this.#storedBytes(); }
  restore(bytes) { this.#alive(); this.#bytes(bytes, (ptr, len) => this.#check(this.wasm.gf_station_restore(this.handle, ptr, len))); }

  async #persist(persist, image) {
    if (typeof persist !== 'function') throw new TypeError('persist must be an async function that durably writes station bytes');
    const acknowledged = await persist(image.bytes, image.token);
    if (acknowledged === false) throw new Error('persistence callback did not acknowledge station bytes');
  }

  #directive(code, reason) {
    if (code === 2) {
      const diagnostic = this.#lastError();
      return diagnostic ? { forceSafeOutputs: true, reason, diagnostic } : { forceSafeOutputs: true, reason };
    }
    this.#check(code);
    return { forceSafeOutputs: false, reason: undefined };
  }

  #prepared() { return { token: this.#pendingToken(), bytes: this.#storedBytes() }; }
  #storedBytes() {
    const ptr = this.wasm.gf_station_prepared_ptr(this.handle);
    const len = Number(this.wasm.gf_station_prepared_len(this.handle));
    const bytes = new Uint8Array(len);
    if (len) bytes.set(new Uint8Array(this.wasm.memory.buffer, ptr, len));
    return bytes;
  }
  #pendingToken() { return this.wasm.gf_station_pending_token(this.handle); }
  #lastError() {
    const ptr = this.wasm.gf_station_last_error_ptr(this.handle);
    const len = Number(this.wasm.gf_station_last_error_len(this.handle));
    return ptr && len ? decoder.decode(new Uint8Array(this.wasm.memory.buffer, ptr, len)) : '';
  }
  #alive() { if (!this.handle) throw new Error('GhostFlow station is disposed'); }
  #check(ok) { if (ok !== 1) throw new Error(this.#lastError() || 'GhostFlow station operation failed'); }
  #bytes(value, callback) {
    if (!(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) throw new TypeError('station bytes must be Uint8Array or ArrayBuffer');
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    const ptr = this.wasm.gf_alloc(bytes.length);
    try { new Uint8Array(this.wasm.memory.buffer, ptr, bytes.length).set(bytes); return callback(ptr, bytes.length); }
    finally { this.wasm.gf_dealloc(ptr, bytes.length); }
  }
  #u64Array(values, callback) {
    if (!Array.isArray(values)) throw new TypeError('skippedOccurrenceIds must be an array');
    if (values.length > 256) throw new RangeError('skippedOccurrenceIds exceeds the station ledger bound');
    if (!values.length) return callback(0, 0);
    const byteLength = values.length * 8;
    const ptr = this.wasm.gf_alloc(byteLength);
    try {
      const view = new DataView(this.wasm.memory.buffer);
      values.forEach((value, index) => view.setBigUint64(ptr + index * 8, u64(value, 'occurrenceId'), true));
      return callback(ptr, values.length);
    } finally { this.wasm.gf_dealloc(ptr, byteLength); }
  }
}
