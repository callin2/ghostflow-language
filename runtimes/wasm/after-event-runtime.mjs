// Host transport for the native per-identity engine. No scalar signal projection.
import { compileSource } from '../../tools/browser-toolchain.mjs';

const decoder = new TextDecoder();
export const AFTER_EVENT_CAPACITY = 32;

function fields(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !expected.includes(key))
    || expected.some(key => !Object.hasOwn(value, key))) throw new TypeError(`invalid ${label} fields`);
}
function integer(value, label, max = Number.MAX_SAFE_INTEGER, min = 0) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`invalid ${label}`);
  return value;
}
function tag(value) { return integer(value, 'sourceTag', 0xffffffff, 1); }

function validateBinding(binding) {
  fields(binding, ['windowMs', 'eventSourceTag', 'predicateSourceTag'], 'after_event binding');
  integer(binding.windowMs, 'windowMs', Number.MAX_SAFE_INTEGER, 1);
  tag(binding.eventSourceTag); tag(binding.predicateSourceTag);
}

export function encodeAfterEventBatch(batch) {
  fields(batch, ['time', 'starts', 'predicate', 'acknowledgements'], 'after_event batch');
  fields(batch.time, ['epoch', 'nowMs'], 'time');
  for (const name of ['starts', 'acknowledgements']) {
    if (!Array.isArray(batch[name]) || batch[name].length > AFTER_EVENT_CAPACITY) throw new TypeError(`invalid ${name} capacity`);
  }
  const bytes = new Uint8Array(29 + 36 * batch.starts.length + 20 * batch.acknowledgements.length + (batch.predicate === null ? 0 : 14));
  const view = new DataView(bytes.buffer);
  let at = 0;
  const u8 = value => { view.setUint8(at, value); at += 1; };
  const u16 = value => { view.setUint16(at, value, true); at += 2; };
  const u32 = value => { view.setUint32(at, value, true); at += 4; };
  const u64 = (value, label) => { view.setBigUint64(at, BigInt(integer(value, label)), true); at += 8; };
  bytes.set([71, 70, 65, 69]); at = 4; u16(1); u16(0);
  u64(batch.time.epoch, 'time epoch'); u64(batch.time.nowMs, 'nowMs');
  u16(batch.starts.length); u16(batch.acknowledgements.length); u8(batch.predicate === null ? 0 : 1);
  const key = value => { u32(tag(value.sourceTag)); u64(value.sourceEpoch, 'sourceEpoch'); u64(value.id, 'event id'); };
  for (const event of batch.starts) {
    fields(event, ['sourceTag', 'sourceEpoch', 'id', 'timeEpoch', 'atMs'], 'event');
    key(event); u64(event.timeEpoch, 'event timeEpoch'); u64(event.atMs, 'event atMs');
  }
  for (const value of batch.acknowledgements) {
    fields(value, ['sourceTag', 'sourceEpoch', 'id'], 'acknowledgement'); key(value);
  }
  if (batch.predicate !== null) {
    const predicate = batch.predicate;
    fields(predicate, ['sourceTag', 'atMs', 'value', 'quality'], 'predicate');
    if (typeof predicate.value !== 'boolean') throw new TypeError('predicate value must be Bool');
    const quality = ['measured', 'held', 'constructed'].indexOf(predicate.quality);
    if (quality < 0) throw new TypeError('invalid predicate quality');
    u32(tag(predicate.sourceTag)); u64(predicate.atMs, 'predicate atMs'); u8(predicate.value ? 1 : 0); u8(quality);
  }
  return bytes;
}

export class AfterEventRuntime {
  /** Runs one identified evidence site, not the document's control outputs. */
  static async instantiateSource(wasmBytes, document, { filename = 'program.ghost.md', signal } = {}) {
    if (typeof signal !== 'string' || !signal) throw new TypeError('after_event signal name is required');
    const artifact = await compileSource(document, { filename });
    const site = artifact.manifest?.format === 'GhostFlow/temporal-descriptor-v1'
      ? artifact.manifest.control.signals.find(item => item.kind === 'after-event' && item.name === signal)
      : undefined;
    if (!site) throw new Error(`source has no after_event signal ${signal}`);
    const runtime = await this.instantiate(wasmBytes, {
      windowMs: site.windowMs, eventSourceTag: site.event.tag, predicateSourceTag: site.predicate.tag,
    });
    Object.defineProperty(runtime, 'source', { enumerable: true, value: Object.freeze({
      ...artifact.sourceDocument, signal, site: site.site,
      event: site.event.name, predicate: site.predicate.name,
      artifactSha256: artifact.manifest.bytecodeSha256,
    }) });
    return runtime;
  }

  static async instantiate(wasmBytes, binding) {
    validateBinding(binding);
    const { instance } = await WebAssembly.instantiate(wasmBytes);
    return new AfterEventRuntime(instance.exports, binding);
  }

  constructor(wasm, binding) {
    validateBinding(binding);
    Object.defineProperty(this, 'binding', { enumerable: true, value: Object.freeze({ ...binding }) });
    this.wasm = wasm;
    this.handle = wasm.gf_after_event_create(BigInt(binding.windowMs), binding.eventSourceTag, binding.predicateSourceTag);
    if (!this.handle) throw new Error('invalid after_event binding');
  }

  dispose() {
    if (this.handle) this.wasm.gf_after_event_destroy(this.handle);
    this.handle = 0;
  }
  stage(batch) {
    this.#live();
    const bytes = encodeAfterEventBatch(batch);
    const ptr = this.wasm.gf_alloc(bytes.length);
    try {
      new Uint8Array(this.wasm.memory.buffer, ptr, bytes.length).set(bytes);
      this.#check(this.wasm.gf_after_event_stage(this.handle, ptr, bytes.length));
    } finally { this.wasm.gf_dealloc(ptr, bytes.length); }
  }
  commit() { this.#live(); this.#check(this.wasm.gf_after_event_commit(this.handle)); }
  rollback() { this.#live(); this.#check(this.wasm.gf_after_event_rollback(this.handle)); }
  get results() { this.#live(); return JSON.parse(this.#text('results')); }
  #live() { if (!this.handle) throw new Error('after_event runtime is disposed'); }
  #text(field) {
    const ptr = this.wasm[`gf_after_event_${field}_ptr`](this.handle);
    const len = this.wasm[`gf_after_event_${field}_len`](this.handle);
    return decoder.decode(new Uint8Array(this.wasm.memory.buffer, ptr, len));
  }
  #check(result) { if (!result) throw new Error(this.#text('error') || 'after_event operation failed'); }
}
