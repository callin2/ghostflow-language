const encoder = new TextEncoder();
const decoder = new TextDecoder();
import { NativeDispatchError } from './native-dispatch.mjs';
import { encodeTemporalProfile } from './temporal-profile.mjs';
import { encodeContextActivation, encodeContextFacts } from './context-abi.mjs';
import { temporalPlanRequest, temporalReplayPlanRequest, temporalReplayRequest } from './temporal-replay.mjs';
const MAX_MODULE_BYTES = 1024 * 1024;
const MAX_CHECKPOINT_BYTES = 4 * 1024 * 1024;
const MAX_PACKET_BYTES = 65_536;
const MAX_INPUTS = 128;
const MAX_NAME_BYTES = 1_024;
const RESERVED_CLOCK = '__gf_now_ms';
const TIME_TYPES = new Set(['Date', 'TimeOfDay', 'DateTime']);
const typedArrayByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const requiredFunctions = Object.freeze([
  'gf_alloc', 'gf_dealloc',
  'gf_frame_create', 'gf_frame_destroy', 'gf_frame_load', 'gf_frame_add_capability', 'gf_frame_activate', 'gf_frame_activate_temporal', 'gf_frame_scan',
  'gf_frame_outcome_ptr', 'gf_frame_outcome_len', 'gf_frame_error_ptr', 'gf_frame_error_len',
  'gf_frame_replay_temporal', 'gf_frame_replay_ptr', 'gf_frame_replay_len',
  'gf_frame_plan_temporal', 'gf_frame_plan_temporal_replay', 'gf_frame_resource_plan_ptr', 'gf_frame_resource_plan_len',
  'gf_frame_activate_context', 'gf_frame_scan_context', 'gf_frame_context_checkpoint',
  'gf_frame_context_checkpoint_ptr', 'gf_frame_context_checkpoint_len',
  'gf_frame_context_state_ptr', 'gf_frame_context_state_len', 'gf_frame_restore_context_checkpoint',
]);

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${label} has unknown or missing fields`);
}

function wellFormed(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function identifier(value, label) {
  if (typeof value !== 'string' || value.length > MAX_NAME_BYTES || !wellFormed(value)) throw new TypeError(`${label} must be well-formed text within ${MAX_NAME_BYTES} UTF-16 code units`);
  const bytes = encoder.encode(value);
  if (!bytes.length || bytes.length > MAX_NAME_BYTES) throw new RangeError(`${label} must contain 1..=${MAX_NAME_BYTES} UTF-8 bytes`);
  return bytes;
}

function safeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
  return value;
}

function encodeFrame(frame) {
  exactObject(frame, ['scanId', 'logicalTimeMs', 'inputs'], 'scan frame');
  const scanIdValue = frame.scanId;
  const logicalTimeValue = frame.logicalTimeMs;
  const inputValues = frame.inputs;
  const scanId = safeInteger(scanIdValue, 'scanId');
  const logicalTimeMs = safeInteger(logicalTimeValue, 'logicalTimeMs');
  if (!Array.isArray(inputValues)) throw new TypeError('inputs must be an array');
  const inputCount = inputValues.length;
  if (!Number.isSafeInteger(inputCount) || inputCount < 0 || inputCount > MAX_INPUTS) throw new RangeError(`inputs must contain a non-negative safe integer count up to ${MAX_INPUTS}`);
  const values = [];
  const names = new Set();
  let length = 2;
  for (let index = 0; index < inputCount; index += 1) {
    if (inputValues.length !== inputCount) throw new RangeError('inputs length changed during capture');
    if (!Object.hasOwn(inputValues, index)) throw new TypeError(`inputs[${index}] must be present`);
    const input = inputValues[index];
    if (inputValues.length !== inputCount) throw new RangeError('inputs length changed during capture');
    const hasType = Object.hasOwn(input, 'type');
    exactObject(input, hasType ? ['name', 'type', 'value'] : ['name', 'value'], 'scan input');
    const inputName = input.name;
    const inputValue = input.value;
    if (inputValues.length !== inputCount) throw new RangeError('inputs length changed during capture');
    const name = identifier(inputName, 'input name');
    if (inputName === RESERVED_CLOCK) throw new TypeError('reserved clock input is host-derived');
    if (names.has(inputName)) throw new TypeError(`duplicate input ${inputName}`);
    names.add(inputName);
    let type, valueLength;
    if (input.type === 'Int') {
      if (!Number.isInteger(inputValue) || inputValue < -2147483648 || inputValue > 2147483647) throw new RangeError(`input ${inputName} must be a signed i32 integer`);
      type = 3; valueLength = 4;
    } else if (input.type !== undefined && !['Bool', 'Number', 'Percent', 'Duration'].includes(input.type) && !TIME_TYPES.has(input.type) && !isQuantityType(input.type)) throw new TypeError(`input ${inputName} has unsupported manifest type ${String(input.type)}`);
    else if (typeof inputValue === 'boolean') { type = 1; valueLength = 1; }
    else if (typeof inputValue === 'number' && Number.isFinite(inputValue)) { type = 2; valueLength = 8; }
    else throw new TypeError(`input ${inputName} must be a boolean or finite number`);
    length += 2 + name.length + 1 + valueLength;
    if (length > MAX_PACKET_BYTES) throw new RangeError(`scan frame exceeds ${MAX_PACKET_BYTES} bytes`);
    values.push({ name, type, value: inputValue });
  }
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, values.length, true);
  let at = 2;
  for (const input of values) {
    view.setUint16(at, input.name.length, true); at += 2;
    bytes.set(input.name, at); at += input.name.length;
    view.setUint8(at, input.type); at += 1;
    if (input.type === 1) view.setUint8(at, input.value ? 1 : 0);
    else if (input.type === 3) view.setInt32(at, input.value, true);
    else view.setFloat64(at, input.value, true);
    at += input.type === 1 ? 1 : input.type === 3 ? 4 : 8;
  }
  return { scanId, logicalTimeMs, bytes };
}

export class FramedGhostFlowRuntime {
  static async instantiate(wasmBytes, imports = {}) {
    const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
    return new FramedGhostFlowRuntime(instance.exports);
  }

  constructor(exports) {
    if (!(exports.memory instanceof WebAssembly.Memory)) throw new Error('WASM artifact does not support framed scan ABI v1: missing memory export');
    for (const name of requiredFunctions) {
      if (typeof exports[name] !== 'function') throw new Error(`WASM artifact does not support framed scan ABI v1: missing ${name}`);
    }
    this.wasm = exports;
    this.handle = exports.gf_frame_create();
    if (!this.handle) throw new Error('Framed GhostFlow runtime allocation failed');
  }

  dispose() {
    if (this.handle) this.wasm.gf_frame_destroy(this.handle);
    this.handle = 0;
  }

  load(moduleBytes) {
    this.#live();
    const bytes = byteBuffer(moduleBytes, 'module bytes', MAX_MODULE_BYTES);
    this.#bytes(bytes, (ptr, len) => this.#check(this.wasm.gf_frame_load(this.handle, ptr, len)));
  }

  addCapability(kind, name, type) {
    this.#live();
    if (!['bool', 'number', 'int'].includes(type)) throw new TypeError('capability type must be bool, number, or int');
    const kindBytes = identifier(kind, 'capability kind');
    const nameBytes = identifier(name, 'capability name');
    this.#bytes(kindBytes, (kindPtr, kindLen) => this.#bytes(nameBytes, (namePtr, nameLen) =>
      this.#check(this.wasm.gf_frame_add_capability(this.handle, kindPtr, kindLen, namePtr, nameLen, { bool: 1, number: 2, int: 3 }[type]))));
  }

  activate() { this.#live(); this.#check(this.wasm.gf_frame_activate(this.handle)); }
  activateTemporal(profile) {
    this.#live();
    this.#bytes(encodeTemporalProfile(profile), (p, n) => this.#check(this.wasm.gf_frame_activate_temporal(this.handle, p, n)));
  }
  activateContext(profile) {
    this.#bytes(encodeContextActivation(profile), (p, n) =>
      this.#check(this.wasm.gf_frame_activate_context(this.handle, p, n)));
  }
  contextSnapshot() {
    this.#live();
    this.#check(this.wasm.gf_frame_context_checkpoint(this.handle));
    const statePtr = this.wasm.gf_frame_context_state_ptr(this.handle);
    const stateLen = Number(this.wasm.gf_frame_context_state_len(this.handle));
    const bytesPtr = this.wasm.gf_frame_context_checkpoint_ptr(this.handle);
    const bytesLen = Number(this.wasm.gf_frame_context_checkpoint_len(this.handle));
    return {
      state: JSON.parse(decoder.decode(new Uint8Array(this.wasm.memory.buffer, statePtr, stateLen))),
      bytes: new Uint8Array(this.wasm.memory.buffer, bytesPtr, bytesLen).slice(),
    };
  }
  restoreContextCheckpoint(bytes) {
    this.#bytes(byteBuffer(bytes, 'context checkpoint', MAX_CHECKPOINT_BYTES), (p, n) =>
      this.#check(this.wasm.gf_frame_restore_context_checkpoint(this.handle, p, n)));
  }

  replayTemporal(options) {
    const request = temporalReplayRequest(options);
    return this.#bytes(request.profile, (p, n) => {
      this.#check(this.wasm.gf_frame_replay_temporal(this.handle, p, n, request.count,
        request.maxPeakTemporalBytes, request.maxJsonBytes));
      return this.replay;
    });
  }

  planTemporal(options) {
    const request = temporalPlanRequest(options);
    return this.#bytes(request.profile, (p, n) => {
      this.#check(this.wasm.gf_frame_plan_temporal(this.handle, p, n, request.maxJsonBytes));
      return this.resourcePlan;
    });
  }

  planTemporalReplay(options) {
    const request = temporalReplayPlanRequest(options);
    return this.#bytes(request.profile, (p, n) => {
      this.#check(this.wasm.gf_frame_plan_temporal_replay(this.handle, p, n, request.count, request.maxJsonBytes));
      return this.resourcePlan;
    });
  }

  scan(frame) {
    this.dispatch(frame);
    try { return this.outcome; }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new NativeDispatchError(message, { cause: error, committed: true });
    }
  }

  dispatch(frame) {
    let committed = false;
    try {
      this.#live();
      const encoded = encodeFrame(frame);
      this.#bytes(encoded.bytes, (ptr, len) => {
        committed = null;
        const ok = this.wasm.gf_frame_scan(this.handle, BigInt(encoded.scanId), BigInt(encoded.logicalTimeMs), ptr, len);
        committed = Boolean(ok);
        if (!ok) {
          throw new Error(this.#lastError() || 'Framed GhostFlow operation failed');
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new NativeDispatchError(message, { cause: error, committed });
    }
  }

  dispatchContext(frame, facts) {
    let committed = false;
    try {
      this.#live();
      const encoded = encodeFrame(frame);
      const context = encodeContextFacts(facts);
      this.#bytes(encoded.bytes, (framePtr, frameLen) =>
        this.#bytes(context, (contextPtr, contextLen) => {
          committed = null;
          const ok = this.wasm.gf_frame_scan_context(this.handle, BigInt(encoded.scanId),
            BigInt(encoded.logicalTimeMs), framePtr, frameLen, contextPtr, contextLen);
          committed = Boolean(ok);
          if (!ok) throw new Error(this.#lastError() || 'Framed GhostFlow context operation failed');
        }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new NativeDispatchError(message, { cause: error, committed });
    }
  }

  get outcome() {
    this.#live();
    const ptr = this.wasm.gf_frame_outcome_ptr(this.handle);
    const len = Number(this.wasm.gf_frame_outcome_len(this.handle));
    return ptr && len ? JSON.parse(decoder.decode(new Uint8Array(this.wasm.memory.buffer, ptr, len))) : null;
  }

  get replay() {
    this.#live();
    const ptr = this.wasm.gf_frame_replay_ptr(this.handle);
    const len = Number(this.wasm.gf_frame_replay_len(this.handle));
    return ptr && len ? JSON.parse(decoder.decode(new Uint8Array(this.wasm.memory.buffer, ptr, len))) : null;
  }

  get resourcePlan() {
    this.#live();
    const ptr = this.wasm.gf_frame_resource_plan_ptr(this.handle);
    const len = Number(this.wasm.gf_frame_resource_plan_len(this.handle));
    return ptr && len ? JSON.parse(decoder.decode(new Uint8Array(this.wasm.memory.buffer, ptr, len))) : null;
  }

  #live() { if (!this.handle) throw new Error('framed runtime is disposed'); }

  #check(ok) { if (!ok) throw new Error(this.#lastError() || 'Framed GhostFlow operation failed'); }

  #lastError() {
    const ptr = this.wasm.gf_frame_error_ptr(this.handle);
    const len = Number(this.wasm.gf_frame_error_len(this.handle));
    return ptr && len ? decoder.decode(new Uint8Array(this.wasm.memory.buffer, ptr, len)) : '';
  }

  #bytes(bytes, callback) {
    this.#live();
    const ptr = this.wasm.gf_alloc(bytes.length);
    if (!ptr) throw new Error('WASM allocation failed');
    try {
      new Uint8Array(this.wasm.memory.buffer, ptr, bytes.length).set(bytes);
      return callback(ptr, bytes.length);
    } finally {
      this.wasm.gf_dealloc(ptr, bytes.length);
    }
  }
}

function byteBuffer(value, label, maximum) {
  if (value instanceof Uint8Array) {
    if (typedArrayByteLength.call(value) > maximum) throw new RangeError(`${label} exceeds ${maximum} bytes`);
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    if (arrayBufferByteLength.call(value) > maximum) throw new RangeError(`${label} exceeds ${maximum} bytes`);
    return new Uint8Array(new Uint8Array(value));
  }
  throw new TypeError(`${label} must be a Uint8Array or ArrayBuffer`);
}
import { isQuantityType } from '../../tools/quantities.mjs';
