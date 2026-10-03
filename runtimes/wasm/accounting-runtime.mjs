// Host transport for the bounded caller-validated Rust accounting ledger.
import { compileSource } from '../../tools/browser-toolchain.mjs';

const U64_MAX = 0xffff_ffff_ffff_ffffn;
const encoder = new TextEncoder();

function unsigned64(value, label) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = BigInt(value);
  if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) throw new TypeError(`${label} must be an unsigned 64-bit integer`);
  return value;
}
function uint32(value, label, { signed = false } = {}) {
  const min = signed ? -0x8000_0000 : 0;
  const max = signed ? 0x7fff_ffff : 0xffff_ffff;
  if (!Number.isInteger(value) || value < min || value > max) throw new TypeError(`${label} is outside its integer range`);
  return value;
}
function identity(value, label) {
  if (!(value instanceof Uint8Array) || value.length !== 16) throw new TypeError(`${label} must be a 16-byte Uint8Array`);
  return value;
}

export class AccountingRuntime {
  /** Binds one checked account declaration to a caller-supplied stable host ID. */
  static async instantiateSource(wasmBytes, document, { filename = 'program.ghost.md', account, resourceId, eventType, config } = {}) {
    if (typeof account !== 'string' || !account) throw new TypeError('account name is required');
    const artifact = await compileSource(document, { filename });
    const descriptor = artifact.manifest?.format === 'GhostFlow/control-v10'
      ? artifact.manifest.accounting?.bindings.find(item => item.name === account)
      : undefined;
    if (!descriptor) throw new Error(`source has no accounting account ${account}`);
    if (descriptor.persistence !== 'durable') throw new Error('unsupported accounting persistence');
    const evidence = descriptor.evidenceBinding;
    let binding;
    if (descriptor.operation === 'on_time') {
      if (evidence?.kind !== 'applied_interval' || evidence.stage !== 'applied') throw new Error('unsupported accounting stage');
      if (resourceId === undefined || eventType !== undefined) throw new TypeError('resourceId is required for an on_time account');
      const limits = (artifact.manifest.accounting.constraints ?? [])
        .flatMap(group => group.limits).filter(limit => limit.account === account);
      binding = { operation: 'on_time', id: uint32(resourceId, 'resourceId'),
        limits: Object.freeze(limits.map(limit => Object.freeze({ ...limit, basis: Object.freeze({ ...limit.basis }) }))) };
    } else if (descriptor.operation === 'count_events' && descriptor.basis?.kind === 'local_day') {
      if (evidence?.kind !== 'typed_event') throw new Error('unsupported accounting evidence binding');
      if (eventType === undefined || resourceId !== undefined) throw new TypeError('eventType is required for a count_events account');
      binding = { operation: 'count_events', id: uint32(eventType, 'eventType') };
    } else throw new Error('unsupported accounting operation or basis');
    const runtime = await this.instantiate(wasmBytes, config);
    Object.defineProperty(runtime, 'binding', { enumerable: true, value: Object.freeze(binding) });
    Object.defineProperty(runtime, 'source', { enumerable: true, value: Object.freeze({
      ...artifact.sourceDocument, account, target: evidence.target, stage: evidence.stage ?? null,
      operation: descriptor.operation, artifactSha256: artifact.manifest.bytecodeSha256,
    }) });
    return runtime;
  }

  static async instantiate(wasmBytes, config) {
    const { instance } = await WebAssembly.instantiate(wasmBytes);
    return new AccountingRuntime(instance.exports, config);
  }

  constructor(wasm, config) {
    if (!wasm || typeof wasm !== 'object') throw new TypeError('WASM exports are required');
    const required = [
      'gf_accounting_create', 'gf_accounting_destroy', 'gf_accounting_initialize_empty',
      'gf_accounting_restore', 'gf_accounting_record_applied_segment',
      'gf_accounting_record_reserved_segment', 'gf_accounting_record_event',
      'gf_accounting_reserve_rolling', 'gf_accounting_settle_rolling', 'gf_accounting_cancel_rolling',
      'gf_accounting_used_rolling', 'gf_accounting_used_local_day', 'gf_accounting_event_count',
      'gf_accounting_snapshot', 'gf_accounting_snapshot_ptr', 'gf_accounting_snapshot_len',
      'gf_accounting_explain_rolling',
      'gf_accounting_ack_persisted', 'gf_accounting_revision', 'gf_accounting_last_error_ptr',
      'gf_accounting_last_error_len', 'gf_activate_accounting', 'gf_tick_accounting',
      'gf_alloc', 'gf_dealloc', 'memory',
    ];
    if (required.some(name => !wasm[name])) throw new Error('WASM module does not include the GhostFlow accounting ABI');
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('accounting config is required');
    const maxIntervals = uint32(config.maxIntervals, 'maxIntervals');
    const maxEvents = uint32(config.maxEvents, 'maxEvents');
    const maxReservations = uint32(config.maxReservations, 'maxReservations');
    const maxRollingWindowMs = unsigned64(config.maxRollingWindowMs, 'maxRollingWindowMs');
    this.wasm = wasm;
    this.handle = wasm.gf_accounting_create(maxIntervals, maxEvents, maxReservations, maxRollingWindowMs);
    if (!this.handle) throw new Error('invalid accounting ledger configuration');
  }

  dispose() {
    if (this.handle) this.wasm.gf_accounting_destroy(this.handle);
    this.handle = 0;
  }

  async initializeEmpty(persist) {
    this.#live();
    this.#check(this.wasm.gf_accounting_initialize_empty(this.handle));
    await this.persistPending(persist);
  }

  restore(snapshot) {
    this.#live();
    if (!(snapshot instanceof Uint8Array)) throw new TypeError('snapshot must be a Uint8Array');
    this.#withBytes(snapshot, (ptr, len) => this.#check(this.wasm.gf_accounting_restore(this.handle, ptr, len)));
  }

  async recordAppliedSegment({ receiptId, resourceId, startMs, endMs, localDay }, persist) {
    this.#live();
    this.#bound('on_time', resourceId);
    identity(receiptId, 'receiptId'); uint32(resourceId, 'resourceId');
    const status = this.#withBytes(receiptId, (ptr) => this.wasm.gf_accounting_record_applied_segment(
      this.handle, ptr, resourceId, unsigned64(startMs, 'startMs'), unsigned64(endMs, 'endMs'), uint32(localDay, 'localDay', { signed: true }),
    ));
    return this.#recordResult(status, persist);
  }

  async recordReservedAppliedSegment({ reservationId, receiptId, resourceId, startMs, endMs, localDay }, persist) {
    this.#live();
    this.#bound('on_time', resourceId);
    identity(reservationId, 'reservationId'); identity(receiptId, 'receiptId'); uint32(resourceId, 'resourceId');
    const status = this.#withTwoIdentities(reservationId, receiptId, (reservationPtr, receiptPtr) =>
      this.wasm.gf_accounting_record_reserved_segment(
        this.handle, reservationPtr, receiptPtr, resourceId, unsigned64(startMs, 'startMs'),
        unsigned64(endMs, 'endMs'), uint32(localDay, 'localDay', { signed: true })));
    return this.#recordResult(status, persist);
  }

  async recordEvent({ eventId, eventType, localDay }, persist) {
    this.#live();
    this.#bound('count_events', eventType);
    identity(eventId, 'eventId'); uint32(eventType, 'eventType');
    const status = this.#withBytes(eventId, (ptr) => this.wasm.gf_accounting_record_event(
      this.handle, ptr, eventType, uint32(localDay, 'localDay', { signed: true }),
    ));
    return this.#recordResult(status, persist);
  }

  async reserveRolling({ reservationId, resourceId, admittedAtMs, windowMs, limitMs, reserveMs }, persist) {
    this.#live();
    this.#bound('on_time', resourceId);
    identity(reservationId, 'reservationId'); uint32(resourceId, 'resourceId');
    this.#boundAdmission(windowMs, limitMs, reserveMs);
    const status = this.#withBytes(reservationId, ptr => this.wasm.gf_accounting_reserve_rolling(
      this.handle, ptr, resourceId, unsigned64(admittedAtMs, 'admittedAtMs'),
      unsigned64(windowMs, 'windowMs'), unsigned64(limitMs, 'limitMs'), unsigned64(reserveMs, 'reserveMs'),
    ));
    if (status === 3) return 'Rejected';
    return this.#durableMutationResult(status, persist, 'accounting reservation failed');
  }

  async settleRolling({ reservationId, appliedReceiptId }, persist) {
    this.#live();
    identity(reservationId, 'reservationId'); identity(appliedReceiptId, 'appliedReceiptId');
    const status = this.#withTwoIdentities(reservationId, appliedReceiptId, (reservationPtr, receiptPtr) =>
      this.wasm.gf_accounting_settle_rolling(this.handle, reservationPtr, receiptPtr));
    return this.#durableMutationResult(status, persist, 'accounting settlement failed');
  }

  async cancelRolling({ reservationId, cancellationEvidenceId }, persist) {
    this.#live();
    identity(reservationId, 'reservationId'); identity(cancellationEvidenceId, 'cancellationEvidenceId');
    const status = this.#withTwoIdentities(reservationId, cancellationEvidenceId, (reservationPtr, evidencePtr) =>
      this.wasm.gf_accounting_cancel_rolling(this.handle, reservationPtr, evidencePtr));
    return this.#durableMutationResult(status, persist, 'accounting cancellation failed');
  }

  /** Captures actual ledger bytes without publishing or acknowledging them. */
  snapshot() {
    this.#live();
    this.#check(this.wasm.gf_accounting_snapshot(this.handle));
    const ptr = this.wasm.gf_accounting_snapshot_ptr(this.handle);
    const len = this.wasm.gf_accounting_snapshot_len(this.handle);
    const snapshot = new Uint8Array(this.wasm.memory.buffer, ptr, len).slice();
    const revision = this.wasm.gf_accounting_revision(this.handle);
    return { bytes: snapshot, revision };
  }

  async persistPending(persist) {
    this.#live();
    if (typeof persist !== 'function') throw new TypeError('persist callback is required');
    const { bytes: snapshot, revision } = this.snapshot();
    if (await persist(snapshot, revision) !== true) throw new Error('accounting snapshot was not durably acknowledged');
    this.#check(this.wasm.gf_accounting_ack_persisted(this.handle, revision));
    return { snapshot, revision };
  }

  usedRolling(resourceId, nowMs, windowMs) {
    this.#bound('on_time', resourceId);
    return this.#query('gf_accounting_used_rolling', [uint32(resourceId, 'resourceId'), unsigned64(nowMs, 'nowMs'), unsigned64(windowMs, 'windowMs')]);
  }

  /** Source-bound, read-only admission explanation. nowMs is the trusted ledger
   * clock; UI animation is deliberately absent. null means Unknown, not zero. */
  explainRolling({ nowMs, windowMs, limitMs, reserveMs } = {}) {
    this.#live();
    if (this.binding?.operation !== 'on_time') throw new TypeError('a source-bound on_time account is required');
    this.#boundAdmission(windowMs, limitMs, reserveMs);
    const args = [nowMs, windowMs, limitMs, reserveMs].map((value, index) =>
      unsigned64(value, ['nowMs', 'windowMs', 'limitMs', 'reserveMs'][index]));
    const output = this.wasm.gf_alloc(48);
    try {
      const status = this.wasm.gf_accounting_explain_rolling(this.handle, this.binding.id, ...args, output);
      if (status === 2) return null;
      if (status !== 1) throw new Error('accounting explanation failed');
      const view = new DataView(this.wasm.memory.buffer);
      const word = index => view.getBigUint64(output + index * 8, true);
      return Object.freeze({ source: this.source, resourceId: this.binding.id, nowMs: args[0],
        windowMs: args[1], limitMs: args[2], reserveMs: args[3], usedMs: word(0), reservedMs: word(1),
        blocked: word(2) === 1n, blockReason: word(2) === 1n ? 'rolling-budget' : null,
        nextReleaseMs: word(3) === 1n ? word(4) : null, ledgerRevision: word(5) });
    } finally { this.wasm.gf_dealloc(output, 48); }
  }

  usedLocalDay(resourceId, localDay) {
    this.#bound('on_time', resourceId);
    return this.#query('gf_accounting_used_local_day', [uint32(resourceId, 'resourceId'), uint32(localDay, 'localDay', { signed: true })]);
  }

  eventCount(eventType, localDay) {
    this.#bound('count_events', eventType);
    return this.#query('gf_accounting_event_count', [uint32(eventType, 'eventType'), uint32(localDay, 'localDay', { signed: true })]);
  }

  activateControl(control, { bootEpoch, terminalCapacity } = {}) {
    const handle = this.#controlHandle(control);
    const capacity = uint32(terminalCapacity, 'terminalCapacity');
    if (capacity === 0) throw new TypeError('terminalCapacity must be positive');
    this.#checkControl(control, this.wasm.gf_activate_accounting(handle,
      unsigned64(bootEpoch, 'bootEpoch'), capacity));
  }

  tickControl(control, { site, account, event, timezone, eventType, localDay,
    monotonicMs, bootEpoch, wallMs, clockTrusted } = {}) {
    const handle = this.#controlHandle(control);
    this.#bound('count_events', eventType);
    const texts = [account, event, timezone].map((value, index) => {
      const label = ['account', 'event', 'timezone'][index];
      if (typeof value !== 'string' || !value) throw new TypeError(`${label} is required`);
      return encoder.encode(value);
    });
    if (localDay !== null && localDay !== undefined) uint32(localDay, 'localDay', { signed: true });
    if (wallMs !== null && wallMs !== undefined) unsigned64(wallMs, 'wallMs');
    if (typeof clockTrusted !== 'boolean') throw new TypeError('clockTrusted must be boolean');
    const result = this.#withBytes(texts[0], (accountPtr, accountLen) =>
      this.#withBytes(texts[1], (eventPtr, eventLen) =>
        this.#withBytes(texts[2], (timezonePtr, timezoneLen) => this.wasm.gf_tick_accounting(
          handle, this.handle, uint32(site, 'site'), accountPtr, accountLen, eventPtr, eventLen,
          timezonePtr, timezoneLen, uint32(eventType, 'eventType'), localDay == null ? 0 : 1,
          localDay ?? 0, unsigned64(monotonicMs, 'monotonicMs'), unsigned64(bootEpoch, 'bootEpoch'),
          wallMs == null ? 0 : 1, wallMs == null ? 0n : unsigned64(wallMs, 'wallMs'), clockTrusted ? 1 : 0))));
    this.#checkControl(control, result);
    return control.trace;
  }

  #bound(operation, id) {
    if (!this.binding) return;
    if (this.binding.operation !== operation) throw new Error('unsupported bound account operation');
    if (this.binding.id !== id) throw new Error(operation === 'on_time' ? 'wrong bound resource ID' : 'wrong bound Event type');
  }

  #boundAdmission(windowMs, limitMs, reserveMs) {
    if (!this.binding) return;
    const rolling = this.binding.limits.filter(limit => limit.basis.kind === 'rolling');
    if (rolling.length !== 1) throw new Error('bound source requires exactly one rolling accounting limit');
    const [limit] = rolling;
    if (limit.operator !== '<=' || BigInt(limit.basis.durationMs) !== unsigned64(windowMs, 'windowMs')
      || BigInt(limit.boundMs) !== unsigned64(limitMs, 'limitMs')
      || BigInt(limit.reserveMs) !== unsigned64(reserveMs, 'reserveMs')) {
      throw new Error('rolling admission does not match the bound source constraint');
    }
  }

  async #recordResult(status, persist) {
    if (status === 0) throw new Error(this.#text('error') || 'accounting record failed');
    if (status === 2) return 'Duplicate';
    if (status !== 1) throw new Error('invalid accounting record status');
    await this.persistPending(persist);
    return 'Inserted';
  }

  async #durableMutationResult(status, persist, fallback) {
    if (status === 0) throw new Error(this.#text('error') || fallback);
    if (status !== 1 && status !== 2) throw new Error('invalid accounting mutation status');
    await this.persistPending(persist);
    return status === 1 ? 'Inserted' : 'Duplicate';
  }

  #query(name, args) {
    this.#live();
    const output = this.wasm.gf_alloc(8);
    try {
      const status = this.wasm[name](this.handle, ...args, output);
      if (status === 2) return null;
      if (status !== 1) throw new Error(this.#text('error') || `accounting query ${name} failed`);
      return new DataView(this.wasm.memory.buffer).getBigUint64(output, true);
    } finally { this.wasm.gf_dealloc(output, 8); }
  }

  #withBytes(bytes, callback) {
    const ptr = this.wasm.gf_alloc(bytes.length);
    try {
      new Uint8Array(this.wasm.memory.buffer, ptr, bytes.length).set(bytes);
      return callback(ptr, bytes.length);
    } finally { this.wasm.gf_dealloc(ptr, bytes.length); }
  }

  #withTwoIdentities(first, second, callback) {
    return this.#withBytes(first, firstPtr => this.#withBytes(second, secondPtr => callback(firstPtr, secondPtr)));
  }

  #controlHandle(control) {
    this.#live();
    if (!control || control.wasm !== this.wasm || !control.handle) {
      throw new TypeError('control must be a live GhostFlow runtime from the same WASM instance');
    }
    return control.handle;
  }

  #checkControl(control, result) {
    if (!result) {
      const ptr = this.wasm.gf_last_error_ptr(control.handle);
      const len = Number(this.wasm.gf_last_error_len(control.handle));
      const message = len ? new TextDecoder().decode(new Uint8Array(this.wasm.memory.buffer, ptr, len)) : '';
      throw new Error(message || 'accounting control operation failed');
    }
  }

  #text(kind) {
    const ptr = this.wasm[`gf_accounting_last_${kind}_ptr`](this.handle);
    const len = this.wasm[`gf_accounting_last_${kind}_len`](this.handle);
    return len ? new TextDecoder().decode(new Uint8Array(this.wasm.memory.buffer, ptr, len)) : '';
  }

  #check(result) { if (!result) throw new Error(this.#text('error') || 'accounting operation failed'); }
  #live() { if (!this.handle) throw new Error('accounting runtime is disposed'); }
}
