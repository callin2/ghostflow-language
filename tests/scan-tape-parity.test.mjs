import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from './helpers/literate-compile.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { observeRuntimeValues, observeSourceTrace } from '../tools/source-trace.mjs';
import { sensorFaultTimerSource, sensorFaultTimerScans } from './helpers/continuous-timer-vectors.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasmBytes = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const nativePath = path.join(root, 'target/release/examples/scan_tape' + (process.platform === 'win32' ? '.exe' : ''));

function row(scanId, logicalTimeMs, inputs) {
  return { scanId, logicalTimeMs, inputs };
}

test('T01-FAULT: native and framed WASM reset and restart the authored sensor-fault timer identically', async () => {
  // The public sensor conditioner is tested in control-host; this tape supplies
  // its Good/Disconnected Result rails to both executions of the same bytecode.
  const artifact = await compileSource(sensorFaultTimerSource, { filename: 'continuous-sensor-fault.ghost' });
  const sensor = artifact.manifest.sensors.find(item => item.name === 'high');
  const tape = sensorFaultTimerScans.map(({ nowMs, quality }, scanId) => row(scanId, nowMs, [
    { name: sensor.valueInput, value: quality === 'Good' ? 40 : 0 },
    { name: sensor.okInput, value: quality === 'Good' },
    { name: sensor.faultInput, value: 0 }, // SensorFault.Disconnected
  ]));
  const { artifact: compared, native } = await compare(sensorFaultTimerSource, tape, 'continuous-sensor-fault.ghost');
  assert.deepEqual(compared.bytes, artifact.bytes);
  assert.deepEqual(native.map(item => item.accepted), sensorFaultTimerScans.map(() => true));
  assert.deepEqual(native.map(item => item.outcome.trace.safe.ready), sensorFaultTimerScans.map(item => item.ready));
  assert.deepEqual(native.map(item => observeRuntimeValues(artifact.traceMetadata, item.outcome.trace).values
    .find(value => value.kind === 'timer' && value.name === 'hot_for').value), sensorFaultTimerScans.map(item => item.elapsed));
});

function tsv(tape) {
  return `${tape.map(({ scanId, logicalTimeMs, inputs }) => [scanId, logicalTimeMs, ...inputs.flatMap(({ name, value }) => [name, typeof value === 'boolean' ? 'b' : 'n', String(value)])].join('\t')).join('\n')}\n`;
}

function nativeRun(bytes, tape) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-scan-tape-'));
  try {
    const modulePath = path.join(directory, 'module.gfb');
    const tapePath = path.join(directory, 'tape.tsv');
    fs.writeFileSync(modulePath, bytes);
    fs.writeFileSync(tapePath, tsv(tape));
    const result = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function wasmRun(artifact, tape) {
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  try {
    runtime.load(artifact.bytes);
    for (const output of artifact.manifest.outputs) runtime.addCapability('actuator', output.name, output.type === 'Bool' ? 'bool' : 'number');
    runtime.activate();
    const observations = [];
    for (const frame of tape) {
      try {
        const outcome = runtime.scan(frame);
        observations.push({ accepted: true, outcome });
      } catch (error) {
        observations.push({ accepted: false, outcome: runtime.outcome, error: String(error.message) });
      }
    }
    return observations;
  } finally {
    runtime.dispose();
  }
}

function assertParity(native, wasm) {
  assert.deepEqual(
    native.map(({ accepted, outcome }) => ({ accepted, outcome })),
    wasm.map(({ accepted, outcome }) => ({ accepted, outcome })),
    'native and public framed WASM must retain the exact complete outcome on every attempt',
  );
}

async function compare(source, tape, filename) {
  const artifact = await compileSource(source, { filename });
  const native = nativeRun(artifact.bytes, tape);
  const wasm = await wasmRun(artifact, tape);
  assertParity(native, wasm);
  assert.deepEqual(nativeRun(artifact.bytes, tape), native, 'a fresh native driver must replay the same compiled tape exactly');
  assert.deepEqual(await wasmRun(artifact, tape), wasm, 'a fresh WASM driver must replay the same compiled tape exactly');
  return { artifact, native, wasm };
}

test('REF core Percent and Duration source units retain exact native and WASM values', async () => {
  const { artifact, native } = await compare(`
control TypedUnits {
  input gate: Bool;
  output ready: Bool;
  output duration_ms: Duration;
  output duty_pct: Percent;
  let duration = 5min;
  let duty = 100%;
  ready <- gate && duration == 300000ms && duty == 100%;
  duration_ms <- duration;
  duty_pct <- duty;
}
`, [row(0, 0, [{ name: 'gate', value: false }]), row(1, 1, [{ name: 'gate', value: true }])], 'typed-units.ghost');
  assert.deepEqual(artifact.manifest.configs, []);
  assert.deepEqual(native.map(item => item.outcome.trace.safe.ready), [false, true]);
  assert.deepEqual(native.map(item => item.outcome.trace.safe.duration_ms), [300_000, 300_000]);
  assert.deepEqual(native.map(item => item.outcome.trace.safe.duty_pct), [100, 100]);
});

test('REF-01-067: non-finite Number result faults atomically on native and WASM', async () => {
  const { native } = await compare(`
control FiniteNumber {
  input value: Number;
  state accepted: Number = 0.0;
  accepted' = value * 2.0;
  output result: Number;
  result <- accepted';
}
`, [
    row(0, 0, [{ name: 'value', value: Number.MAX_VALUE }]),
    row(0, 0, [{ name: 'value', value: 1.0 }]),
  ], 'finite-number.ghost');
  assert.deepEqual(native.map(item => item.accepted), [false, true]);
  assert.match(native[0].error, /non-finite arithmetic result/);
  assert.equal(native[1].outcome.trace.stateBefore.accepted, 0);
  assert.equal(native[1].outcome.trace.stateAfter.accepted, 2);
  assert.equal(native[1].outcome.trace.safe.result, 2);
});

test('REF-03-009: plain core scans preserve equal and exact large logical times on native and WASM', async () => {
  const times = [0, 0, 4_294_967_295, 4_294_967_296, Number.MAX_SAFE_INTEGER];
  const { native } = await compare(`
control CoreClock {
  input start: Bool;
  state running: Bool = false;
  running' = running || start;
  output pump: Bool;
  pump <- running';
}
`, times.map((logicalTimeMs, scanId) => row(scanId, logicalTimeMs,
    [{ name: 'start', value: scanId === 0 }])), 'core-clock.ghost');
  assert.deepEqual(native.map(item => item.outcome.logicalTimeMs), times);
  assert.deepEqual(native.map(item => item.outcome.trace.stateAfter.running), times.map(() => true));
});

test('REF core blocked constraint commits state while preserving requested and safe intents', async () => {
  const { native } = await compare(`
control BlockedCommit {
  input request, permit: Bool;
  state count: Int = 0;
  count' = count + 1;
  output pump, allowed: Bool;
  pump <- request;
  allowed <- permit;
  require pump => allowed;
}
`, [
    row(0, 0, [{ name: 'request', value: true }, { name: 'permit', value: false }]),
    row(1, 1, [{ name: 'request', value: false }, { name: 'permit', value: true }]),
  ], 'blocked-commit.ghost');
  assert.deepEqual(native.map(item => item.accepted), [true, true]);
  assert.deepEqual(native.map(item => item.outcome.trace.stateAfter.count), [1, 2]);
  assert.deepEqual([native[0].outcome.trace.requested.pump, native[0].outcome.trace.safe.pump], [true, false]);
  assert.deepEqual(native[0].outcome.trace.safetyTrace.constraints[0].firstViolation.blocked, ['pump']);
});

test('REF-00-008: low-water constraint retains the requested pump and its blocking reason', async () => {
  const { artifact, native } = await compare(`
control LowWater {
  input request, low_water: Bool;
  output pump, water_ok: Bool;
  pump <- request;
  water_ok <- !low_water;
  require pump => water_ok;
}
`, [row(0, 0, [{ name: 'request', value: true }, { name: 'low_water', value: true }])], 'low-water.ghost');
  const trace = native[0].outcome.trace;
  assert.deepEqual([trace.requested.pump, trace.safe.pump], [true, false]);
  assert.equal(trace.inputs.low_water, true);
  assert.equal(trace.safetyTrace.constraints[0].kind, 'requires');
  assert.deepEqual(trace.safetyTrace.constraints[0].firstViolation.blocked, ['pump']);
  assert.ok(artifact.traceMetadata.dependencies.some(entry => entry.target.field === 'requested'
    && entry.target.name === 'water_ok' && entry.reads.some(read => read.field === 'inputs' && read.name === 'low_water')));
});

test('REF-00-004: fixed start-stop tape gives identical state and intent in independent runtimes', async () => {
  const { native } = await compare(`
control ReplayStartStop {
  input start, stop: Bool;
  state running: Bool = false;
  running' = !stop && (start || running);
  output pump: Bool;
  pump <- running';
}
`, [
    row(0, 0, [{ name: 'start', value: false }, { name: 'stop', value: false }]),
    row(1, 100, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
    row(2, 200, [{ name: 'start', value: false }, { name: 'stop', value: true }]),
  ], 'replay-start-stop.ghost');
  assert.deepEqual(native.map(item => item.outcome.trace.stateAfter.running), [false, true, false]);
  assert.deepEqual(native.map(item => item.outcome.trace.requested.pump), [false, true, false]);
  assert.deepEqual(native.map(item => item.outcome.trace.safe.pump), [false, true, false]);
});

test('REF-01-093: let is recomputed from each tick input', async () => {
  const { native } = await compare(`
control LetEachTick {
  input request: Bool;
  let current = request;
  output pump: Bool;
  pump <- current;
}
`, [
    row(0, 0, [{ name: 'request', value: true }]),
    row(1, 1, [{ name: 'request', value: false }]),
  ], 'let-each-tick.ghost');
  assert.deepEqual(native.map(item => item.outcome.trace.requested.pump), [true, false]);
});

test('REF-01-094: simultaneous swap is independent of next-definition source order', async () => {
  for (const transitions of [
    "left' = if swap then right else left; right' = if swap then left else right;",
    "right' = if swap then left else right; left' = if swap then right else left;",
  ]) {
    const { native } = await compare(`
control Swap {
  input swap: Bool;
  state left: Bool = true;
  state right: Bool = false;
  ${transitions}
  output left_out, right_out: Bool;
  left_out <- left';
  right_out <- right';
}
`, [row(0, 0, [{ name: 'swap', value: true }])], 'swap.ghost');
    assert.deepEqual(native[0].outcome.trace.stateAfter, { left: false, right: true });
    assert.deepEqual(native[0].outcome.trace.requested, { left_out: false, right_out: true });
  }
});

test('REF-07-006: multiplication by zero keeps a faulting operand and its dependency', async () => {
  const { artifact, native } = await compare(`
control FaultingProduct {
  input divisor: Number;
  output result: Number;
  result <- (1.0 / divisor) * 0.0;
}
`, [
    row(0, 0, [{ name: 'divisor', value: 0 }]),
    row(0, 0, [{ name: 'divisor', value: 1 }]),
  ], 'faulting-product.ghost');
  assert.deepEqual(native.map(item => item.accepted), [false, true]);
  assert.match(native[0].error, /division by zero/);
  assert.equal(native[1].outcome.trace.safe.result, 0);
  assert.ok(artifact.traceMetadata.dependencies.some(entry => entry.target.field === 'requested'
    && entry.target.name === 'result' && entry.reads.some(read => read.field === 'inputs' && read.name === 'divisor')));
});

test('REF-03-014: one phase transition, rejected stop rollback, and waiting safety agree on native and WASM', async () => {
  const source = `control AtomicPhase {
  input stop, advance, permit: Bool;
  input divisor: Number;
  sensor healthy: Bool;
  let safe_healthy = case healthy { ok(value) => value; fault(_) => false; };
  type Phase = Open | Middle | Final | Idle;
  state phase: Phase = Open;
  timer age = elapsed(phase);
  phase' = case phase {
    Open => if stop || !safe_healthy then Idle else if age >= 2s then Middle else Open;
    Middle => if stop || !safe_healthy then Idle else if advance then Final else Middle;
    Final => if stop || !safe_healthy then Idle else Final;
    Idle => Idle;
  };
  output pump, allowed: Bool;
  output quotient: Number;
  pump <- phase' != Idle;
  allowed <- permit;
  quotient <- 1.0 / divisor;
  require pump => allowed;
}`;
  const compiled = await compileSource(source, { filename: 'atomic-phase.ghost' });
  const sensor = compiled.manifest.sensors.find(item => item.name === 'healthy');
  const inputs = (stop, permit, good = true, divisor = 1) => [
    { name: 'stop', value: stop }, { name: 'advance', value: true }, { name: 'permit', value: permit },
    { name: sensor.valueInput, value: true }, { name: sensor.okInput, value: good },
    { name: sensor.faultInput, value: 0 }, // SensorFault.Disconnected
    { name: 'divisor', value: divisor },
  ];
  for (const interruptedBy of ['stop', 'fault']) {
    const { artifact, native, wasm } = await compare(source, [
      row(0, 100, inputs(false, true)),
      row(1, 1100, inputs(false, false)),
      row(2, 2100, inputs(false, true)),
      row(3, 2200, inputs(true, false, false, 0)), // core arithmetic fault rolls back the attempted transition
      row(3, 2150, inputs(interruptedBy === 'stop', false, interruptedBy !== 'fault')),
    ], 'atomic-phase.ghost');
    assert.deepEqual(artifact.bytes, compiled.bytes);
    for (const outcomes of [native, wasm]) {
      assert.deepEqual(outcomes.map(item => item.accepted), [true, true, true, false, true]);
      assert.deepEqual(outcomes.map(item => item.outcome.trace.stateAfter.phase), [0, 0, 1, 1, 3]);
      assert.deepEqual(outcomes[3].outcome, outcomes[2].outcome, 'rejected stop/fault cannot change phase, timer or outcome');
      assert.match(outcomes[3].error, /division by zero/);
      assert.deepEqual(outcomes[4].outcome.trace.stateBefore, outcomes[2].outcome.trace.stateAfter,
        'accepted retry must observe every committed phase and internal timer state before the failed attempt');
      assert.equal(outcomes[4].outcome.logicalTimeMs, 2150, 'rejected future timestamp must not advance the clock');
      const ages = outcomes.map(item => observeRuntimeValues(artifact.traceMetadata, item.outcome.trace).values
        .find(value => value.kind === 'timer' && value.name === 'age').value);
      assert.deepEqual(ages, [0, 1000, 0, 0, 0]);
      const waiting = outcomes[1].outcome.trace;
      assert.deepEqual([waiting.requested.pump, waiting.safe.pump], [true, false]);
      assert.deepEqual(waiting.safetyTrace.constraints[0].firstViolation.blocked, ['pump']);
      assert.deepEqual([outcomes[4].outcome.trace.requested.pump, outcomes[4].outcome.trace.safe.pump,
        outcomes[4].outcome.trace.requested.allowed], [false, false, false]);
      if (interruptedBy === 'fault') {
        assert.ok(observeSourceTrace(artifact.traceMetadata, outcomes[4].outcome.trace).resultEvents
          .some(event => event.kind === 'case' && event.errorType === 'SensorFault' && event.fault === 'Disconnected'));
      }
    }
  }
});

test('REF-03-017: independently enabled timers preserve separate starts and explicit sensor fault handling on native and WASM', async () => {
  const source = `control IndependentFaultTimers {
  input enabled_a, enabled_b: Bool;
  sensor high: Bool;
  let safe_high = case high { ok(value) => value; fault(_) => false; };
  timer a_for = continuous_true(enabled_a && safe_high);
  timer b_for = continuous_true(enabled_b && safe_high);
  output a_age_ms, b_age_ms: Duration;
  a_age_ms <- a_for;
  b_age_ms <- b_for;
}`;
  const filename = 'reference-independent-fault-timers.ghost';
  const artifact = await compileSource(source, { filename });
  const sensor = artifact.manifest.sensors.find(item => item.name === 'high');
  // Both timers use the same sensor Bool. Their distinct starts come from
  // explicit authored enable predicates, not an implicit activation API.
  const tape = [[100, true, false, true], [120, true, true, true], [140, true, true, true],
    [150, true, true, false], [200, true, true, true], [220, true, true, true]]
    .map(([logicalTimeMs, enabledA, enabledB, good], scanId) => row(scanId, logicalTimeMs, [
      { name: 'enabled_a', value: enabledA }, { name: 'enabled_b', value: enabledB },
      { name: sensor.valueInput, value: true }, { name: sensor.okInput, value: good },
      { name: sensor.faultInput, value: 0 }, // SensorFault.Disconnected, including a true raw payload.
    ]));
  const { artifact: compared, native, wasm } = await compare(source, tape, filename);
  assert.deepEqual(compared.bytes, artifact.bytes);
  const expected = [{ a_for: 0, b_for: 0 }, { a_for: 20, b_for: 0 }, { a_for: 40, b_for: 20 },
    { a_for: 0, b_for: 0 }, { a_for: 0, b_for: 0 }, { a_for: 20, b_for: 20 }];
  for (const outcomes of [native, wasm]) {
    assert.deepEqual(outcomes.map(item => item.accepted), tape.map(() => true));
    assert.deepEqual(outcomes.map(item => ({ a_for: item.outcome.trace.safe.a_age_ms,
      b_for: item.outcome.trace.safe.b_age_ms })), expected);
    assert.deepEqual(outcomes.map(item => Object.fromEntries(observeRuntimeValues(artifact.traceMetadata,
      item.outcome.trace).values.filter(value => value.kind === 'timer').map(value => [value.name, value.value]))), expected);
    const since = name => artifact.traceMetadata.bindings.find(binding => binding.kind === 'timer'
      && binding.generated.declaration === name && binding.generated.role === 'since').name;
    assert.notEqual(since('a_for'), since('b_for'));
    assert.equal(outcomes[2].outcome.trace.stateAfter[since('a_for')], 100);
    assert.equal(outcomes[2].outcome.trace.stateAfter[since('b_for')], 120);
    const fault = observeSourceTrace(artifact.traceMetadata, outcomes[3].outcome.trace).resultEvents;
    assert.ok(fault.some(event => event.kind === 'case' && event.errorType === 'SensorFault'
      && event.fault === 'Disconnected'), 'the authored false branch retains the sensor fault');
  }
});

test('REF-03-017: continuous true rejects an implicit Result Bool input', async () => {
  await assert.rejects(compileSource(`control ImplicitFaultTimer {
  sensor high: Bool;
  timer active_for = continuous_true(high);
  output age_ms: Duration;
  age_ms <- active_for;
}`, { filename: 'reference-implicit-fault-timer.ghost' }), /continuous_true argument must be Bool/);
});

test('REF-03-016: continuous true preserves equal timestamps and resets before a new interval on native and WASM', async () => {
  const trace = [[100, true], [100, true], [140, true], [160, false], [200, true], [230, true]];
  const { artifact, native, wasm } = await compare(`
control ContinuousReference {
  input c: Bool;
  timer active_for = continuous_true(c);
  output age_ms: Duration;
  age_ms <- active_for;
}
`, trace.map(([logicalTimeMs, c], scanId) => row(scanId, logicalTimeMs, [{ name: 'c', value: c }])),
  'reference-continuous-true.ghost');
  assert.deepEqual(artifact.manifest.timers, [{ name: 'active_for', mode: 'continuous-true', clockInput: '__gf_now_ms' }]);
  const expected = [0, 0, 40, 0, 0, 30];
  for (const outcomes of [native, wasm]) {
    assert.deepEqual(outcomes.map(item => item.accepted), trace.map(() => true));
    assert.deepEqual(outcomes.map(item => item.outcome.trace.safe.age_ms), expected);
    const timers = outcomes.map(item => observeRuntimeValues(artifact.traceMetadata, item.outcome.trace).values
      .find(value => value.kind === 'timer' && value.name === 'active_for'));
    assert.deepEqual(timers.map(timer => ({ valueType: timer.valueType, unit: timer.unit, value: timer.value })),
      expected.map(value => ({ valueType: 'Duration', unit: 'ms', value })));
  }
});

test('REF-01-103: phase age starts at zero on a nonzero clock and restarts on committed change', async () => {
  const filename = 'contracts/interaction-v0/examples/enum-phase-age.ghost.md';
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  const { artifact, native, wasm } = await compare(source, [
    row(0, 100, [{ name: 'advance', value: false }]),
    row(1, 175, [{ name: 'advance', value: true }]),
    row(2, 230, [{ name: 'advance', value: true }]),
    row(3, 300, [{ name: 'advance', value: false }]),
  ], filename);
  assert.deepEqual(artifact.manifest.timers, [{ name: 'age', state: 'phase', clockInput: '__gf_now_ms' }]);
  for (const outcomes of [native, wasm]) {
    assert.deepEqual(outcomes.map(item => item.accepted), [true, true, true, true]);
    assert.deepEqual(outcomes.map(item => item.outcome.trace.stateAfter.phase), [0, 1, 1, 0]);
    const timers = outcomes.map(item => observeRuntimeValues(artifact.traceMetadata, item.outcome.trace).values
      .find(value => value.kind === 'timer' && value.name === 'age'));
    assert.deepEqual(timers.map(timer => ({ valueType: timer.valueType, unit: timer.unit, value: timer.value })), [
      { valueType: 'Duration', unit: 'ms', value: 0 },
      { valueType: 'Duration', unit: 'ms', value: 0 },
      { valueType: 'Duration', unit: 'ms', value: 55 },
      { valueType: 'Duration', unit: 'ms', value: 0 },
    ]);
  }
});

test('REF-03-013: elapsed restarts at both Bool changes in completed native and WASM scans', async () => {
  const tape = [
    row(0, 0, [{ name: 'request', value: false }]),
    row(1, 100, [{ name: 'request', value: true }]),
    row(2, 250, [{ name: 'request', value: true }]),
    row(3, 300, [{ name: 'request', value: false }]),
  ];
  const { artifact, native, wasm } = await compare(`
control ElapsedReference {
  input request: Bool;
  state running: Bool = false;
  timer age = elapsed(running);
  running' = request;
  output pump: Bool;
  pump <- running';
}
`, tape, 'reference-elapsed-bool.ghost');
  assert.deepEqual(artifact.manifest.timers, [{ name: 'age', state: 'running', clockInput: '__gf_now_ms' }]);
  for (const outcomes of [native, wasm]) {
    assert.deepEqual(outcomes.map(item => item.accepted), [true, true, true, true]);
    assert.deepEqual(outcomes.map(item => item.outcome.trace.stateAfter.running), [false, true, true, false]);
    // This is the authored timer observation after the state change commits,
    // rather than a control expression evaluated against the previous state.
    const timers = outcomes.map(item => observeRuntimeValues(artifact.traceMetadata, item.outcome.trace).values
      .find(value => value.kind === 'timer' && value.name === 'age'));
    assert.deepEqual(timers.map(timer => ({ valueType: timer.valueType, unit: timer.unit, value: timer.value })), [
      { valueType: 'Duration', unit: 'ms', value: 0 },
      { valueType: 'Duration', unit: 'ms', value: 0 },
      { valueType: 'Duration', unit: 'ms', value: 150 },
      { valueType: 'Duration', unit: 'ms', value: 0 },
    ]);
  }
});

test('GF-TEST-scan-tape-parity: timer boundaries and 32-bit logical time remain exact', async () => {
  const tape = [
    row(0, 0, [{ name: 'enabled', value: true }]),
    row(1, 0, [{ name: 'enabled', value: true }]),
    row(2, 99, [{ name: 'enabled', value: true }]),
    row(3, 100, [{ name: 'enabled', value: true }]),
    row(4, 101, [{ name: 'enabled', value: true }]),
    row(5, 4_294_967_295, [{ name: 'enabled', value: true }]),
    row(6, 4_294_967_296, [{ name: 'enabled', value: true }]),
    row(7, 4_294_967_297, [{ name: 'enabled', value: true }]),
  ];
  const { native } = await compare(`
control TapeTimer {
  input enabled: Bool;
  state active: Bool = false;
  timer age = elapsed(active);
  active' = enabled;
  output expired: Bool;
  expired <- age >= 100ms;
}
`, tape, 'scan-tape-timer.ghost');
  assert.deepEqual(native.map(item => item.accepted), tape.map(() => true));
  assert.deepEqual(native.map(item => item.outcome.trace.safe.expired), [false, false, false, true, true, true, true, true]);
  assert.deepEqual(native.map(item => item.outcome.logicalTimeMs), tape.map(frame => frame.logicalTimeMs));
  assert.deepEqual(native.map(item => item.outcome.trace.inputs.__gf_now_ms), tape.map(frame => frame.logicalTimeMs));
});

test('GF-TEST-scan-tape-parity: self-hold records old and next state transitions', async () => {
  const tape = [
    row(0, 0, [{ name: 'start', value: false }, { name: 'stop', value: false }]),
    row(1, 1, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
    row(2, 2, [{ name: 'start', value: false }, { name: 'stop', value: false }]),
    row(3, 3, [{ name: 'start', value: false }, { name: 'stop', value: true }]),
    row(4, 4, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
  ];
  const { native } = await compare(`
control TapeSelfHold {
  input start, stop: Bool;
  state running: Bool = false;
  running' = !stop && (start || running);
  output pump: Bool;
  pump <- running';
}
`, tape, 'scan-tape-self-hold.ghost');
  assert.deepEqual(native.map(item => item.outcome.trace.safe.pump), [false, true, true, false, true]);
  assert.deepEqual(native.map(item => item.outcome.trace.stateBefore.running), [false, false, true, true, false]);
  assert.deepEqual(native.map(item => item.outcome.trace.stateAfter.running), [false, true, true, false, true]);
});

test('GF-TEST-scan-tape-parity: global constraint preserves requested ON and safe OFF', async () => {
  const { native } = await compare(`
control TapeConstraint {
  input enabled: Bool;
  output pump, permit: Bool;
  pump <- enabled;
  permit <- false;
  require pump => permit;
}
`, [row(0, 0, [{ name: 'enabled', value: true }])], 'scan-tape-constraint.ghost');
  const trace = native[0].outcome.trace;
  assert.equal(trace.requested.pump, true);
  assert.equal(trace.safe.pump, false);
  assert.equal(trace.safetyTrace.constraints[0].kind, 'requires');
  assert.deepEqual(trace.safetyTrace.constraints[0].firstViolation.blocked, ['pump']);
});

test('GF-TEST-scan-tape-parity: rejected envelope attempts retain the prior outcome and corrected retries reuse IDs', async () => {
  const tape = [
    row(0, 0, []),
    row(0, 0, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
    row(1, 1, [{ name: 'start', value: true }, { name: 'start', value: false }]),
    row(1, 1, [{ name: 'start', value: true }, { name: 'stop', value: false }, { name: 'extra', value: false }]),
    row(1, 1, [{ name: 'start', value: true }, { name: 'stop', value: false }, { name: '__gf_now_ms', value: 1 }]),
    row(1, 1, [{ name: 'start', value: 1 }, { name: 'stop', value: false }]),
    row(1, 1, [{ name: 'start', value: true }, { name: 'bad"\\\\', value: false }]),
    row(2, 2, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
    row(Number.MAX_SAFE_INTEGER + 1, 1, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
    row(1, 1, [{ name: 'start', value: false }, { name: 'stop', value: true }]),
    row(2, Number.MAX_SAFE_INTEGER + 1, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
    row(2, 0, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
    row(2, 2, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
  ];
  const { native, wasm } = await compare(`
control TapeReject {
  input start, stop: Bool;
  state running: Bool = false;
  running' = !stop && (start || running);
  output pump: Bool;
  pump <- running';
}
`, tape, 'scan-tape-reject.ghost');
  assert.deepEqual(native.map(item => item.accepted), [false, true, false, false, false, false, false, false, false, true, false, false, true]);
  for (const index of [0, 2, 3, 4, 5, 6, 7, 8]) assert.deepEqual(native[index].outcome, index === 0 ? null : native[1].outcome);
  assert.deepEqual(native[10].outcome, native[9].outcome);
  assert.deepEqual(native[11].outcome, native[9].outcome);
  assert.equal(native[9].outcome.scanId, 1);
  assert.equal(native[12].outcome.scanId, 2);
  assert.equal(native[12].outcome.trace.safe.pump, true);
  assert.match(native[0].error, /complete inputs/);
  assert.match(wasm[4].error, /reserved/);
  assert.equal(native[6].error, 'unknown input bad"\\\\');
  assert.equal(wasm[6].error, 'unknown input bad"\\\\');
  assert.match(wasm[8].error, /safe integer/);
  assert.match(wasm[10].error, /safe integer/);
});

test('GF-TEST-scan-tape-parity: core evaluation rollback permits a same-ID framed retry', async () => {
  const tape = [
    row(0, 10, [{ name: 'divisor', value: 1 }]),
    row(1, 200, [{ name: 'divisor', value: 0 }]),
    row(1, 109, [{ name: 'divisor', value: 2 }]),
    row(2, 110, [{ name: 'divisor', value: 2 }]),
  ];
  const { native } = await compare(`
control TapeRollback {
  input divisor: Number;
  state attempts: Number = 0;
  state active: Bool = false;
  timer age = elapsed(active);
  active' = true;
  attempts' = attempts + 1;
  output pump: Number;
  output expired: Bool;
  pump <- 1 / divisor;
  expired <- age >= 100ms;
}
`, tape, 'scan-tape-rollback.ghost');
  assert.deepEqual(native.map(item => item.accepted), [true, false, true, true]);
  assert.equal(native[0].outcome.trace.safe.pump, 1);
  assert.deepEqual(native[1].outcome, native[0].outcome);
  assert.match(native[1].error, /division by zero/);
  assert.equal(native[2].outcome.scanId, 1);
  assert.equal(native[2].outcome.logicalTimeMs, 109);
  assert.equal(native[0].outcome.trace.stateAfter.attempts, 1);
  assert.equal(native[1].outcome.trace.stateAfter.attempts, 1);
  assert.equal(native[2].outcome.trace.stateBefore.attempts, 1);
  assert.equal(native[2].outcome.trace.stateAfter.attempts, 2);
  assert.equal(native[2].outcome.trace.safe.pump, 0.5);
  assert.deepEqual(native.map(item => item.outcome.trace.safe.expired), [false, false, false, true]);
  assert.equal(native[3].outcome.trace.stateAfter.attempts, 3);
});

test('GF-TEST-scan-tape-parity: malformed TSV is a native transport error, not a rejected scan', async () => {
  const artifact = await compileSource('control TapeTransport { input enabled: Bool; output pump: Bool; pump <- enabled; }', { filename: 'scan-tape-transport.ghost' });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-scan-tape-malformed-'));
  try {
    const modulePath = path.join(directory, 'module.gfb');
    const tapePath = path.join(directory, 'bad.tsv');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(tapePath, '0\t0\tenabled\tb\tmaybe\n');
    const result = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /boolean input/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
