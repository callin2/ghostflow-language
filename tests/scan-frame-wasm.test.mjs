import { softwareQualityAbi } from './helpers/software-quality-observations.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';
import { compileControl } from '../tools/control.mjs';
import { compileSource } from './helpers/literate-compile.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { observeRuntimeValues } from '../tools/source-trace.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const wasmBytes = fs.readFileSync(wasmPath);
const moduleBytes = compile(parse(tokenize(`(module Frame
  (input __gf_now_ms number) (input enabled bool)
  (strategy run 0 (device true)
    (intent pump input.enabled) (intent permit false))
  (requires pump permit))`)));
const timerModule = await compileSource(`control FrameTimer {
  input enabled: Bool;
  state phase: Bool = false;
  timer age = elapsed(phase);
  phase' = case enabled { ok(observed) => observed; fault(_) => phase; };
  output expired: Bool;
  expired <- age >= 100ms;
}`, { filename: 'frame-timer.ghost' });

async function active() {
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  runtime.load(moduleBytes);
  runtime.activate();
  return runtime;
}

function rawError(runtime) {
  const ptr = runtime.wasm.gf_frame_error_ptr(runtime.handle);
  const len = Number(runtime.wasm.gf_frame_error_len(runtime.handle));
  return ptr && len ? new TextDecoder().decode(new Uint8Array(runtime.wasm.memory.buffer, ptr, len)) : '';
}

function rawScan(runtime, packet, scanId = 0, logicalTimeMs = 0) {
  const bytes = new Uint8Array(packet);
  const ptr = runtime.wasm.gf_alloc(bytes.length);
  try {
    new Uint8Array(runtime.wasm.memory.buffer, ptr, bytes.length).set(bytes);
    const ok = runtime.wasm.gf_frame_scan(runtime.handle, BigInt(scanId), BigInt(logicalTimeMs), ptr, bytes.length);
    return { ok, error: rawError(runtime) };
  } finally {
    runtime.wasm.gf_dealloc(ptr, bytes.length);
  }
}

function packet(inputs) {
  let length = 2;
  const encoded = inputs.map(({ name, type, value }) => {
    const text = new TextEncoder().encode(name);
    length += 2 + text.length + 1 + (type === 1 ? 1 : 8);
    return { text, type, value };
  });
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, encoded.length, true);
  let at = 2;
  for (const item of encoded) {
    view.setUint16(at, item.text.length, true); at += 2;
    bytes.set(item.text, at); at += item.text.length;
    view.setUint8(at, item.type); at += 1;
    if (item.type === 1) view.setUint8(at, item.value);
    else view.setFloat64(at, item.value, true);
    at += item.type === 1 ? 1 : 8;
  }
  return bytes;
}

test('GF-TEST-scan-frame-wasm: configure, activate, and preserve requested/safe trace in one outcome', async t => {
  const runtime = await active();
  t.after(() => runtime.dispose());
  assert.equal(runtime.outcome, null);
  const outcome = runtime.scan({ scanId: 0, logicalTimeMs: 100, inputs: [{ name: 'enabled', value: true }] });
  assert.deepEqual(outcome, JSON.parse(JSON.stringify(outcome)), 'outcome is plain JSON data');
  assert.equal(outcome.format, 'GhostFlow/scan-outcome-v1');
  assert.equal(outcome.scanId, 0);
  assert.equal(outcome.logicalTimeMs, 100);
  assert.equal(outcome.trace.tick, 1, 'legacy tick namespace remains distinct from frame scan ID');
  assert.equal(outcome.trace.inputs.__gf_now_ms, 100);
  assert.equal(outcome.trace.requested.pump, true);
  assert.equal(outcome.trace.safe.pump, false, 'same scan safety result is retained');
  assert.throws(() => runtime.load(moduleBytes), /already active/);
  assert.throws(() => runtime.addCapability('actuator', 'pump', 'bool'), /already active/);
  assert.throws(() => runtime.activate(), /already active/);
});

test('GF-TEST-restart-lifecycle-wasm: initialize before activation and consume event on committed scan', async t => {
  const module = compileControl(`control RestartFrame {
    type RestartReason = PowerOn | Brownout | Watchdog | Software | Unknown;
    input restart_reason: RestartReason;
    input restart_event: Bool;
    output recover: Bool;
    recover <- restart_event;
  }`);
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  t.after(() => runtime.dispose());
  const malformed = new Uint8Array(module.bytes);
  const malformedView = new DataView(malformed.buffer, malformed.byteOffset, malformed.byteLength);
  let descriptorAt = 10 + malformedView.getUint32(6, true);
  descriptorAt += 2 + malformedView.getUint16(descriptorAt, true) + 1;
  descriptorAt += 2;
  malformed[descriptorAt] = 'X'.charCodeAt(0);
  assert.throws(() => runtime.load(malformed), /invalid lifecycle descriptor/);
  runtime.load(module.bytes);
  runtime.addCapability('actuator', 'recover', 'bool');
  runtime.validate();
  runtime.validate();
  assert.throws(() => runtime.scan({ scanId: 0, logicalTimeMs: 0, inputs: [] }), /not active/);
  assert.throws(() => runtime.activate(), /restart lifecycle initialization is required/);
  runtime.initializeRestart(2, true);
  assert.equal(runtime.restartEventPending, true);
  runtime.activate();
  const first = runtime.scan({ scanId: 0, logicalTimeMs: 0, inputs: [] });
  assert.equal(first.trace.inputs.restart_reason, 2);
  assert.equal(first.trace.inputs.restart_event, true);
  assert.equal(runtime.restartEventPending, false);
  const second = runtime.scan({ scanId: 1, logicalTimeMs: 1, inputs: [] });
  assert.equal(second.trace.inputs.restart_reason, 2);
  assert.equal(second.trace.inputs.restart_event, false);
});

test('GF-TEST-scan-frame-wasm: generated timer lowering receives logical frame time', async t => {
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  t.after(() => runtime.dispose());
  runtime.load(timerModule.bytes);
  softwareQualityAbi(runtime, timerModule);
  runtime.addCapability('actuator', 'expired', 'bool');
  runtime.activate();
  const scans = [0, 0, 99, 100, 101].map((logicalTimeMs, scanId) => runtime.scan({
    scanId, logicalTimeMs, inputs: [{ name: 'enabled', value: true }],
  }));
  const [first, repeated, before, expiry, after] = scans;
  assert.equal(first.trace.inputs.__gf_now_ms, 0);
  assert.equal(first.trace.safe.expired, false);
  assert.equal(repeated.trace.safe.expired, false);
  assert.equal(before.trace.safe.expired, false);
  assert.equal(expiry.trace.inputs.__gf_now_ms, 100);
  assert.equal(expiry.trace.safe.expired, true);
  assert.equal(after.trace.safe.expired, true);
  assert.deepEqual(scans.map(outcome => observeRuntimeValues(timerModule.traceMetadata, outcome.trace)
    .values.find(value => value.kind === 'timer' && value.name === 'age').value), [0, 0, 99, 100, 101]);
});

test('GF-TEST-scan-frame-wasm-continuous-true: measures only one uninterrupted true interval', async t => {
  const compiled = await compileSource(`control ContinuousTrueTimer {
    input hot: Bool;
    timer hot_for = continuous_true(hot |> recover(false));
    output expired: Bool;
    expired <- hot_for >= 30ms;
  }`, { filename: 'continuous-true-timer.ghost' });
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  t.after(() => runtime.dispose());
  runtime.load(compiled.bytes);
  softwareQualityAbi(runtime, compiled);
  runtime.addCapability('actuator', 'expired', 'bool');
  runtime.activate();

  const trace = [
    [100, true], [100, true], [129, true], [130, true], [131, true],
    [160, false], [1000, false], [1010, true], [1039, true], [1040, false],
    [1041, true], [1070, true], [1071, true], [1072, true],
  ].map(([logicalTimeMs, hot], scanId) => runtime.scan({
    scanId, logicalTimeMs, inputs: [{ name: 'hot', value: hot }],
  }));

  assert.deepEqual(trace.map(outcome => outcome.trace.safe.expired), [
    false, false, false, true, true, false, false, false, false, false,
    false, false, true, true,
  ]);
  assert.deepEqual(trace.map(outcome => observeRuntimeValues(compiled.traceMetadata, outcome.trace)
    .values.find(value => value.kind === 'timer' && value.name === 'hot_for').value), [
    0, 0, 29, 30, 31, 0, 0, 0, 29, 0, 0, 29, 30, 31,
  ]);
});

test('GF-TEST-scan-frame-wasm-continuous-true-rejection: rejected time rollback does not reset the interval', async t => {
  // REF-03-009: the 1000→999 attempt must preserve both Idle and timer state.
  const compiled = await compileSource(`control ContinuousTrueRollback {
    input hot: Bool;
    state idle: Bool = true;
    idle' = case hot { ok(observed) => if observed then idle else false; fault(_) => idle; };
    timer hot_for = continuous_true(hot |> recover(false));
    output expired: Bool;
    expired <- hot_for >= 50ms;
  }`, { filename: 'continuous-true-rollback.ghost' });
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  t.after(() => runtime.dispose());
  runtime.load(compiled.bytes);
  softwareQualityAbi(runtime, compiled);
  runtime.addCapability('actuator', 'expired', 'bool');
  runtime.activate();

  const committed = runtime.scan({
    scanId: 0, logicalTimeMs: 1000, inputs: [{ name: 'hot', value: true }],
  });
  assert.equal(committed.trace.safe.expired, false);
  assert.equal(committed.trace.stateAfter.idle, true);
  for (const logicalTimeMs of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => runtime.scan({
      scanId: 1, logicalTimeMs, inputs: [{ name: 'hot', value: false }],
    }), /logicalTimeMs must be a non-negative safe integer/);
    assert.deepEqual(runtime.outcome, committed, 'invalid clock values cannot publish state or output');
  }
  assert.throws(() => runtime.scan({
    scanId: 1, logicalTimeMs: 999, inputs: [{ name: 'hot', value: false }],
  }), /logical time moved backwards/);
  assert.deepEqual(runtime.outcome, committed);
  const recovered = runtime.scan({
    scanId: 1, logicalTimeMs: 1050, inputs: [{ name: 'hot', value: true }],
  });
  assert.equal(recovered.trace.safe.expired, true);
  assert.equal(recovered.trace.stateAfter.idle, true);
  assert.equal(observeRuntimeValues(compiled.traceMetadata, recovered.trace)
    .values.find(value => value.kind === 'timer' && value.name === 'hot_for').value, 50);
});

test('GF-TEST-scan-frame-wasm-continuous-true-instances: timers keep independent intervals and resets', async t => {
  const compiled = await compileSource(`control ContinuousTrueInstances {
    input hot_a, hot_b: Bool;
    timer a_for = continuous_true(hot_a |> recover(false));
    timer b_for = continuous_true(hot_b |> recover(false));
    output a_ready, b_ready: Bool;
    a_ready <- a_for >= 20ms;
    b_ready <- b_for >= 20ms;
  }`, { filename: 'continuous-true-instances.ghost' });
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  t.after(() => runtime.dispose());
  runtime.load(compiled.bytes);
  softwareQualityAbi(runtime, compiled);
  runtime.addCapability('actuator', 'a_ready', 'bool');
  runtime.addCapability('actuator', 'b_ready', 'bool');
  runtime.activate();

  const outcomes = [
    [100, true, false], [110, true, true], [120, true, true], [130, false, true],
  ].map(([logicalTimeMs, hotA, hotB], scanId) => runtime.scan({
    scanId, logicalTimeMs, inputs: [{ name: 'hot_a', value: hotA }, { name: 'hot_b', value: hotB }],
  }));
  assert.deepEqual(outcomes.map(outcome => [outcome.trace.safe.a_ready, outcome.trace.safe.b_ready]), [
    [false, false], [false, false], [true, false], [false, true],
  ]);
  assert.deepEqual(outcomes.map(outcome => Object.fromEntries(observeRuntimeValues(compiled.traceMetadata, outcome.trace)
    .values.filter(value => value.kind === 'timer').map(value => [value.name, value.value]))), [
    { a_for: 0, b_for: 0 }, { a_for: 10, b_for: 0 },
    { a_for: 20, b_for: 10 }, { a_for: 0, b_for: 20 },
  ]);
});

test('GF-TEST-scan-frame-wasm-continuous-true-dependencies: forward references resolve and timer cycles reject', async () => {
  const forward = await compileSource(`control ContinuousTrueForward {
    input hot: Bool;
    timer qualified = continuous_true(raw >= 5ms);
    timer raw = continuous_true(hot |> recover(false));
    output ready: Bool;
    ready <- qualified >= 1ms;
  }`, { filename: 'continuous-true-forward.ghost' });
  assert.deepEqual(forward.manifest.timers.map(timer => timer.name), ['qualified', 'raw']);

  await assert.rejects(() => compileSource(`control ContinuousTrueCycle {
    timer first = continuous_true(second >= 1ms);
    timer second = continuous_true(first >= 1ms);
    output ready: Bool;
    ready <- false;
  }`, { filename: 'continuous-true-cycle.ghost' }), /cyclic timer definition involving/);
  await assert.rejects(() => compileSource(`control ContinuousTrueLetCycle {
    let condition = active_for >= 1ms;
    timer active_for = continuous_true(condition);
    output ready: Bool;
    ready <- false;
  }`, { filename: 'continuous-true-let-cycle.ghost' }), /cyclic timer definition involving/);
});

// Reference §2.7 and §3.3: declaration order cannot change the dependency graph's meaning.
for (const [order, declarations] of [
  ['forward', 'timer qualified = continuous_true(condition); let condition = raw >= 5ms; timer raw = continuous_true(hot |> recover(false));'],
  ['reverse', 'timer raw = continuous_true(hot |> recover(false)); let condition = raw >= 5ms; timer qualified = continuous_true(condition);'],
]) {
  test(`continuous timer/let ${order} declarations execute the same expected intervals`, async t => {
    const compiled = await compileSource(`control TimerOrder {
      input hot: Bool;
      ${declarations}
      output ready: Bool;
      ready <- qualified >= 1ms;
    }`);
    const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
    t.after(() => runtime.dispose());
    runtime.load(compiled.bytes);
  softwareQualityAbi(runtime, compiled);
    runtime.addCapability('actuator', 'ready', 'bool');
    runtime.activate();
    const observations = [[0, true], [4, true], [5, true], [6, true], [7, false], [100, true], [105, true], [106, true]]
      .map(([logicalTimeMs, hot], scanId) => {
        const outcome = runtime.scan({ scanId, logicalTimeMs, inputs: [{ name: 'hot', value: hot }] });
        const timers = Object.fromEntries(observeRuntimeValues(compiled.traceMetadata, outcome.trace).values
          .filter(value => value.kind === 'timer').map(value => [value.name, value.value]));
        return [timers.raw, timers.qualified, outcome.trace.safe.ready];
      });
    assert.deepEqual(observations, [
      [0, 0, false], [4, 0, false], [5, 0, false], [6, 1, true],
      [0, 0, false], [0, 0, false], [5, 0, false], [6, 1, true],
    ]);
  });
}

test('GF-TEST-scan-frame-wasm-continuous-true-state: unprimed state condition uses the accepted pre-transition snapshot', async t => {
  const compiled = await compileSource(`control ContinuousTrueStateSnapshot {
    input enabled: Bool;
    state active: Bool = false;
    timer active_for = continuous_true(active);
    active' = case enabled { ok(observed) => observed; fault(_) => active; };
    output expired: Bool;
    expired <- active_for >= 50ms;
  }`, { filename: 'continuous-true-state-snapshot.ghost' });
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  t.after(() => runtime.dispose());
  runtime.load(compiled.bytes);
  softwareQualityAbi(runtime, compiled);
  runtime.addCapability('actuator', 'expired', 'bool');
  runtime.activate();

  const expired = [[100, true], [150, true], [200, true], [250, false], [300, false]]
    .map(([logicalTimeMs, enabled], scanId) => runtime.scan({
      scanId, logicalTimeMs, inputs: [{ name: 'enabled', value: enabled }],
    }).trace.safe.expired);
  assert.deepEqual(expired, [false, false, true, true, false]);
});

test('GF-TEST-scan-frame-wasm-continuous-true-manifest: consumer accepts the exact mode and rejects mixed or unknown descriptors', async () => {
  const compiled = await compileSource(`control ContinuousTrueManifest {
    input hot: Bool;
    timer hot_for = continuous_true(hot |> recover(false));
    output ready: Bool;
    ready <- hot_for >= 1ms;
  }`, { filename: 'continuous-true-manifest.ghost' });
  const runtime = await ControlRuntime.instantiateFramed(wasmBytes, compiled);
  runtime.dispose();
  const withTimer = timer => ({
    ...compiled,
    manifest: { ...compiled.manifest, timers: [timer] },
  });
  const descriptor = compiled.manifest.timers[0];
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasmBytes, withTimer({
    ...descriptor, state: 'forged',
  })), /unknown key state/);
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasmBytes, withTimer({
    ...descriptor, mode: 'continuous',
  })), /unsupported mode/);
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasmBytes, withTimer({
    ...descriptor, extra: true,
  })), /unknown key extra/);
});

test('GF-TEST-scan-frame-wasm: frame properties are latched once before packet allocation', async t => {
  const runtime = await active();
  t.after(() => runtime.dispose());
  const reads = { scanId: 0, logicalTimeMs: 0, inputs: 0, name: 0, value: 0 };
  const outcome = runtime.scan({
    get scanId() { reads.scanId += 1; return 0; },
    get logicalTimeMs() { reads.logicalTimeMs += 1; return 1; },
    get inputs() {
      reads.inputs += 1;
      return [{
        get name() { reads.name += 1; return 'enabled'; },
        get value() { reads.value += 1; return true; },
      }];
    },
  });
  assert.equal(outcome.scanId, 0);
  assert.deepEqual(reads, { scanId: 1, logicalTimeMs: 1, inputs: 1, name: 1, value: 1 });
});

test('GF-TEST-scan-frame-wasm: indexed input capture ignores iterators and rejects growth before a scan', async t => {
  const runtime = await active();
  t.after(() => runtime.dispose());
  const committed = runtime.scan({ scanId: 0, logicalTimeMs: 0, inputs: [{ name: 'enabled', value: false }] });
  let iteratorReads = 0;
  const dense = [{ name: 'enabled', value: true }];
  Object.defineProperty(dense, Symbol.iterator, {
    value() { iteratorReads += 1; throw new Error('iterator must not be used'); },
  });
  const indexed = runtime.scan({ scanId: 1, logicalTimeMs: 1, inputs: dense });
  assert.equal(iteratorReads, 0);
  assert.equal(indexed.trace.inputs.enabled, true);

  const growing = [];
  Object.defineProperty(growing, '0', {
    enumerable: true,
    configurable: true,
    get() {
      growing.push({ name: 'enabled', value: false });
      return { name: 'enabled', value: false };
    },
  });
  growing.length = 1;
  assert.throws(() => runtime.scan({ scanId: 2, logicalTimeMs: 2, inputs: growing }), /length changed/);
  assert.deepEqual(runtime.outcome, indexed, 'capture rejection cannot invoke or replace the WASM scan');
  const retry = runtime.scan({ scanId: 2, logicalTimeMs: 2, inputs: [{ name: 'enabled', value: false }] });
  assert.equal(retry.scanId, 2);
  assert.notDeepEqual(committed, indexed);
});

test('GF-TEST-scan-frame-wasm: rejected frames preserve outcome and recover at the same expected ID', async t => {
  const runtime = await active();
  t.after(() => runtime.dispose());
  const committed = runtime.scan({ scanId: 0, logicalTimeMs: 100, inputs: [{ name: 'enabled', value: true }] });
  const invalid = [
    { scanId: 1, logicalTimeMs: 100, inputs: [] },
    { scanId: 1, logicalTimeMs: 100, inputs: [{ name: 'enabled', value: true }, { name: 'enabled', value: false }] },
    { scanId: 1, logicalTimeMs: 100, inputs: [{ name: '__gf_now_ms', value: 100 }] },
    { scanId: 1, logicalTimeMs: 100, inputs: [{ name: 'enabled', value: 1 }] },
    { scanId: 1, logicalTimeMs: 100, inputs: [{ name: 'unknown', value: true }] },
    { scanId: Number.MAX_SAFE_INTEGER + 1, logicalTimeMs: 100, inputs: [{ name: 'enabled', value: true }] },
    { scanId: 1, logicalTimeMs: Number.MAX_SAFE_INTEGER + 1, inputs: [{ name: 'enabled', value: true }] },
    { scanId: 1, logicalTimeMs: -1, inputs: [{ name: 'enabled', value: true }] },
  ];
  for (const frame of invalid) {
    assert.throws(() => runtime.scan(frame));
    assert.deepEqual(runtime.outcome, committed, 'a rejection cannot replace the committed outcome');
  }
  assert.throws(() => runtime.scan({ scanId: 1, logicalTimeMs: 99, inputs: [{ name: 'enabled', value: false }] }), /backwards/);
  assert.deepEqual(runtime.outcome, committed);
  const next = runtime.scan({ scanId: 1, logicalTimeMs: 100, inputs: [{ name: 'enabled', value: false }] });
  assert.equal(next.scanId, 1);
  assert.equal(next.trace.safe.pump, false);
});

test('GF-TEST-scan-frame-wasm: ABI decoder rejects malformed packets before mutating a committed scan', async t => {
  const runtime = await active();
  t.after(() => runtime.dispose());
  const committed = runtime.scan({ scanId: 0, logicalTimeMs: 1, inputs: [{ name: 'enabled', value: true }] });
  const cases = [
    [new Uint8Array([1, 0]), /truncated/],
    [new Uint8Array([0, 0, 0]), /trailing/],
    [new Uint8Array([1, 0, 1, 0, 97, 4]), /type/],
    [new Uint8Array([1, 0, 1, 0, 97, 1, 2]), /exactly/],
    [new Uint8Array([1, 0, 1, 0, 0xff, 1, 1]), /UTF-8/],
    [new Uint8Array([129, 0]), /exceeds.*inputs/],
    [packet([{ name: 'enabled', type: 1, value: 1 }, { name: 'enabled', type: 1, value: 0 }]), /duplicate/],
    [packet([{ name: '__gf_now_ms', type: 2, value: 1 }]), /reserved/],
    [packet([{ name: 'x'.repeat(1_025), type: 1, value: 1 }]), /1024/],
    [new Uint8Array(65_537), /exceeds/],
  ];
  const nonFinite = packet([{ name: 'enabled', type: 2, value: 0 }]);
  new DataView(nonFinite.buffer).setFloat64(nonFinite.length - 8, Number.NaN, true);
  cases.push([nonFinite, /finite/]);
  for (const [bytes, expected] of cases) {
    const result = rawScan(runtime, bytes, 1, 2);
    assert.equal(result.ok, 0);
    assert.match(result.error, expected);
    assert.deepEqual(runtime.outcome, committed);
  }
  for (const [scanId, logicalTimeMs] of [[Number.MAX_SAFE_INTEGER + 1, 2], [1, Number.MAX_SAFE_INTEGER + 1]]) {
    const result = rawScan(runtime, packet([{ name: 'enabled', type: 1, value: 0 }]), scanId, logicalTimeMs);
    assert.equal(result.ok, 0);
    assert.match(result.error, /exact number range/);
    assert.deepEqual(runtime.outcome, committed);
  }
  assert.equal(runtime.wasm.gf_frame_scan(runtime.handle, 1n, 2n, 0, 0), 0);
  assert.match(rawError(runtime), /pointer is null/);
  assert.equal(runtime.wasm.gf_frame_scan(0, 1n, 2n, 0, 0), 0);
  assert.deepEqual(runtime.outcome, committed);
  const next = runtime.scan({ scanId: 1, logicalTimeMs: 2, inputs: [{ name: 'enabled', value: false }] });
  assert.equal(next.scanId, 1);
});

test('GF-TEST-scan-frame-wasm: activation failure preserves configuration and wrapper lifecycle is bounded', async t => {
  const capabilityModule = compile(parse(tokenize(`(module Capability
    (strategy run 0 (device (has actuator pump bool)) (intent pump true)))`)));
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  t.after(() => runtime.dispose());
  runtime.load(capabilityModule);
  assert.throws(() => runtime.activate(), /no device strategy/);
  runtime.addCapability('actuator', 'pump', 'bool');
  runtime.activate();
  assert.equal(runtime.scan({ scanId: 0, logicalTimeMs: 0, inputs: [] }).trace.safe.pump, true);
  runtime.dispose();
  runtime.dispose();
  assert.throws(() => runtime.activate(), /disposed/);
  assert.throws(() => runtime.load(moduleBytes), /disposed/);
  assert.throws(() => runtime.addCapability('actuator', 'pump', 'bool'), /disposed/);
  assert.throws(() => runtime.scan({ scanId: 0, logicalTimeMs: 0, inputs: [] }), /disposed/);
  assert.throws(() => runtime.outcome, /disposed/);
  await assert.rejects(() => FramedGhostFlowRuntime.instantiate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])), /framed scan ABI v1: missing/);
});

test('GF-TEST-scan-frame-wasm: module and capability ABI lengths reject before raw slicing', async t => {
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  t.after(() => runtime.dispose());
  assert.equal(runtime.wasm.gf_frame_load(runtime.handle, 0, 0), 0);
  assert.match(rawError(runtime), /module pointer is null/);
  const ptr = runtime.wasm.gf_alloc(1);
  try {
    new Uint8Array(runtime.wasm.memory.buffer, ptr, 1)[0] = 0;
    assert.equal(runtime.wasm.gf_frame_load(runtime.handle, ptr, 1_048_577), 0);
    assert.match(rawError(runtime), /module exceeds/);
    assert.equal(runtime.wasm.gf_frame_add_capability(runtime.handle, ptr, 1_025, ptr, 1, 1), 0);
    assert.match(rawError(runtime), /capability kind.*1024/);
  } finally {
    runtime.wasm.gf_dealloc(ptr, 1);
  }
});

test('GF-TEST-scan-frame-wasm: wrapper rejects non-buffer and oversized module inputs before allocation', async t => {
  let allocations = 0;
  let scans = 0;
  const memory = new WebAssembly.Memory({ initial: 1 });
  const functions = Object.fromEntries([
    'gf_dealloc', 'gf_frame_destroy', 'gf_frame_load', 'gf_frame_add_capability', 'gf_frame_initialize_restart', 'gf_frame_restart_event_pending', 'gf_frame_validate', 'gf_frame_activate', 'gf_frame_activate_temporal',
    'gf_frame_outcome_ptr', 'gf_frame_outcome_len', 'gf_frame_error_ptr', 'gf_frame_error_len',
    'gf_frame_replay_temporal', 'gf_frame_replay_ptr', 'gf_frame_replay_len',
    'gf_frame_plan_temporal', 'gf_frame_plan_temporal_replay', 'gf_frame_resource_plan_ptr', 'gf_frame_resource_plan_len',
    'gf_frame_activate_context', 'gf_frame_scan_context', 'gf_frame_context_checkpoint',
    'gf_frame_activate_schedules', 'gf_frame_scan_schedules',
    'gf_frame_context_checkpoint_ptr', 'gf_frame_context_checkpoint_len',
    'gf_frame_context_state_ptr', 'gf_frame_context_state_len', 'gf_frame_restore_context_checkpoint',
  ].map(name => [name, () => 1]));
  const runtime = new FramedGhostFlowRuntime({ memory, gf_alloc: () => { allocations += 1; return 1; }, gf_frame_create: () => 1, gf_frame_scan: () => { scans += 1; return 1; }, ...functions });
  t.after(() => runtime.dispose());
  assert.throws(() => runtime.load(65_537), /Uint8Array or ArrayBuffer/);
  assert.throws(() => runtime.load(new Uint8Array(1_048_577)), /exceeds/);
  const shadowedView = new Uint8Array(2 * 1_024 * 1_024);
  Object.defineProperty(shadowedView, 'byteLength', { value: 1 });
  assert.throws(() => runtime.load(shadowedView), /exceeds/);
  const shadowedBuffer = new ArrayBuffer(2 * 1_024 * 1_024);
  Object.defineProperty(shadowedBuffer, 'byteLength', { value: 1 });
  assert.throws(() => runtime.load(shadowedBuffer), /exceeds/);
  assert.equal(allocations, 0);
  for (const count of [-1, Number.NaN, 1.5, 129]) {
    const inputs = new Proxy([], {
      get(target, key, receiver) {
        return key === 'length' ? count : Reflect.get(target, key, receiver);
      },
    });
    assert.throws(() => runtime.scan({ scanId: 0, logicalTimeMs: 0, inputs }), /non-negative safe integer count/);
  }
  assert.equal(allocations, 0);
  assert.equal(scans, 0);
  assert.throws(() => new FramedGhostFlowRuntime({ ...runtime.wasm, memory: {} }), /memory export/);
  assert.throws(() => new FramedGhostFlowRuntime({ ...runtime.wasm, gf_frame_scan: 1 }), /missing gf_frame_scan/);
});
