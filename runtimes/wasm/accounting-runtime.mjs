// Host transport for the bounded caller-validated Rust accounting ledger.
import { compileSource } from '../../tools/browser-toolchain.mjs';

const U64_MAX = 0xffff_ffff_ffff_ffffn;

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
    const descriptor = artifact.manifest?.format === 'GhostFlow/accounting-v1'
      ? artifact.manifest.control.accounts.find(item => item.name === account)
      : undefined;
    if (!descriptor) throw new Error(`source has no accounting account ${account}`);
    if (descriptor.persistence !== 'durable') throw new Error('unsupported accounting persistence');
    let binding;
    if (descriptor.operation === 'on_time') {
      if (descriptor.stage !== 'applied') throw new Error('unsupported accounting stage');
      if (resourceId === undefined || eventType !== undefined) throw new TypeError('resourceId is required for an on_time account');
      binding = { operation: 'on_time', id: uint32(resourceId, 'resourceId') };
    } else if (descriptor.operation === 'count_events' && descriptor.over === 'local_day') {
      if (eventType === undefined || resourceId !== undefined) throw new TypeError('eventType is required for a count_events account');
      binding = { operation: 'count_events', id: uint32(eventType, 'eventType') };
    } else throw new Error('unsupported accounting operation or basis');
    const runtime = await this.instantiate(wasmBytes, config);
    Object.defineProperty(runtime, 'binding', { enumerable: true, value: Object.freeze(binding) });
    Object.defineProperty(runtime, 'source', { enumerable: true, value: Object.freeze({
      ...artifact.sourceDocument, account, target: descriptor.resourceOrEvent, stage: descriptor.stage,
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
      'gf_accounting_restore', 'gf_accounting_record_applied_segment', 'gf_accounting_record_event',
      'gf_accounting_used_rolling', 'gf_accounting_used_local_day', 'gf_accounting_event_count',
      'gf_accounting_snapshot', 'gf_accounting_snapshot_ptr', 'gf_accounting_snapshot_len',
      'gf_accounting_ack_persisted', 'gf_accounting_revision', 'gf_accounting_last_error_ptr',
      'gf_accounting_last_error_len', 'gf_alloc', 'gf_dealloc', 'memory',
    ];
    if (required.some(name => !wasm[name])) throw new Error('WASM module does not include the GhostFlow accounting ABI');
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('accounting config is required');
    const maxIntervals = uint32(config.maxIntervals, 'maxIntervals');
    const maxEvents = uint32(config.maxEvents, 'maxEvents');
    const maxRollingWindowMs = unsigned64(config.maxRollingWindowMs, 'maxRollingWindowMs');
    this.wasm = wasm;
    this.handle = wasm.gf_accounting_create(maxIntervals, maxEvents, maxRollingWindowMs);
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

  async recordEvent({ eventId, eventType, localDay }, persist) {
    this.#live();
    this.#bound('count_events', eventType);
    identity(eventId, 'eventId'); uint32(eventType, 'eventType');
    const status = this.#withBytes(eventId, (ptr) => this.wasm.gf_accounting_record_event(
      this.handle, ptr, eventType, uint32(localDay, 'localDay', { signed: true }),
    ));
    return this.#recordResult(status, persist);
  }

  async persistPending(persist) {
    this.#live();
    if (typeof persist !== 'function') throw new TypeError('persist callback is required');
    this.#check(this.wasm.gf_accounting_snapshot(this.handle));
    const ptr = this.wasm.gf_accounting_snapshot_ptr(this.handle);
    const len = this.wasm.gf_accounting_snapshot_len(this.handle);
    const snapshot = new Uint8Array(this.wasm.memory.buffer, ptr, len).slice();
    const revision = this.wasm.gf_accounting_revision(this.handle);
    if (await persist(snapshot, revision) !== true) throw new Error('accounting snapshot was not durably acknowledged');
    this.#check(this.wasm.gf_accounting_ack_persisted(this.handle, revision));
    return { snapshot, revision };
  }

  usedRolling(resourceId, nowMs, windowMs) {
    this.#bound('on_time', resourceId);
    return this.#query('gf_accounting_used_rolling', [uint32(resourceId, 'resourceId'), unsigned64(nowMs, 'nowMs'), unsigned64(windowMs, 'windowMs')]);
  }

  usedLocalDay(resourceId, localDay) {
    this.#bound('on_time', resourceId);
    return this.#query('gf_accounting_used_local_day', [uint32(resourceId, 'resourceId'), uint32(localDay, 'localDay', { signed: true })]);
  }

  eventCount(eventType, localDay) {
    this.#bound('count_events', eventType);
    return this.#query('gf_accounting_event_count', [uint32(eventType, 'eventType'), uint32(localDay, 'localDay', { signed: true })]);
  }

  #bound(operation, id) {
    if (!this.binding) return;
    if (this.binding.operation !== operation) throw new Error('unsupported bound account operation');
    if (this.binding.id !== id) throw new Error(operation === 'on_time' ? 'wrong bound resource ID' : 'wrong bound Event type');
  }

  async #recordResult(status, persist) {
    if (status === 0) throw new Error(this.#text('error') || 'accounting record failed');
    if (status === 2) return 'Duplicate';
    if (status !== 1) throw new Error('invalid accounting record status');
    await this.persistPending(persist);
    return 'Inserted';
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

  #text(kind) {
    const ptr = this.wasm[`gf_accounting_last_${kind}_ptr`](this.handle);
    const len = this.wasm[`gf_accounting_last_${kind}_len`](this.handle);
    return len ? new TextDecoder().decode(new Uint8Array(this.wasm.memory.buffer, ptr, len)) : '';
  }

  #check(result) { if (!result) throw new Error(this.#text('error') || 'accounting operation failed'); }
  #live() { if (!this.handle) throw new Error('accounting runtime is disposed'); }
}
