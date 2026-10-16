import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { NativeDispatchError } from '../runtimes/wasm/native-dispatch.mjs';
import { compileSource } from './helpers/literate-compile.mjs';

// Producer observations exist only where the test supplies a value.
const good = (nowMs, values) => Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { epoch: 1, id: nowMs + 1, timestampMs: nowMs, quality: 'Good', value }]));

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const sample = (id, value, quality = 'Good', timestampMs = id) => ({ epoch: 1, id, timestampMs, value, quality });

test('host and native window fixture migrations retain pinned source history', () => {
  for (const [filename, sha256] of [
    ['control-host-before-input-531.json', '4f5730582a702299596e3af16cb94681e5b41149cb3dbdd13ed81353cc47f4a7'],
    ['window-native-before-input-531.json', '9d90b6f3276d530d576198bad8272a72f882d60b3ea1211f76fe38c266b82796'],
  ]) {
    const bytes = fs.readFileSync(new URL(`./fixtures/history/${filename}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256);
    const snapshot = JSON.parse(bytes);
    assert.equal(snapshot.revision, 'c8a5d37ac09230a9011291a3ae3b053d1bc22773');
    for (const source of snapshot.sources) assert.equal(createHash('sha256').update(gunzipSync(Buffer.from(source.contentBase64, 'base64'))).digest('hex'), source.sha256);
  }
});

test('legacy rejected ticks roll back every sensor filter and accepted identity', async t => {
  const artifact = await compileSource(`control AtomicFilters {
    input divisor: Number;
    input middle: Number { filter = median(3); stale_after = 10s; }
    input average: Number { filter = ema(alpha: 0.5); stale_after = 10s; }
    output middle_value, average_value, quotient: Number;
    middle_value <- case middle { ok(value) => value; fault(_) => -1.0; };
    average_value <- case average { ok(value) => value; fault(_) => -1.0; };
    quotient <- 1.0 / (divisor |> recover(0.0));
  }`, { filename: 'atomic-filters.ghost' });
  const runtime = await ControlRuntime.instantiate(wasm, artifact);
  t.after(() => runtime.dispose());

  runtime.step({ nowMs: 1, samples: { ...good(1, { divisor: 1 }), middle: sample(1, 10), average: sample(1, 10) } });
  runtime.step({ nowMs: 2, samples: { ...good(2, { divisor: 1 }), middle: sample(2, 20) } });
  assert.throws(() => runtime.step({ nowMs: 3, samples: { ...good(3, { divisor: 0 }),
    middle: sample(3, 999), average: sample(3, 20),
  } }), /division by zero/);
  assert.deepEqual(runtime.sensors.get('middle').conditioner.sampleIdentity(), { epoch: 1, id: 2, timestampMs: 2 });
  assert.deepEqual(runtime.sensors.get('average').conditioner.sampleIdentity(), { epoch: 1, id: 1, timestampMs: 1 });

  const retry = runtime.step({ nowMs: 4, samples: { ...good(4, { divisor: 1 }),
    middle: sample(4, 30), average: sample(4, 30),
  } });
  assert.equal(retry.sensors.middle.value, 20, 'median excludes the rejected 999 sample');
  assert.equal(retry.sensors.average.value, 20, 'EMA recurrence starts from the last committed value');
});

test('legacy rejected ticks roll back duplicate hysteresis conditioner state', async t => {
  const artifact = await compileSource(`control AtomicHysteresis {
    input divisor: Number;
    input moisture: Number { filter = median(1); stale_after = 10s; }
    signal dry = hysteresis(moisture, on_below: 30.0, off_above: 35.0, initial: false);
    output dry_value: Bool;
    output quotient: Number;
    dry_value <- dry |> recover(false);
    quotient <- 1.0 / (divisor |> recover(0.0));
  }`, { filename: 'atomic-hysteresis.ghost' });
  const runtime = await ControlRuntime.instantiate(wasm, artifact);
  t.after(() => runtime.dispose());

  assert.equal(runtime.step({ nowMs: 1, samples: { ...good(1, { divisor: 1 }), moisture: sample(1, 20) } }).vm.safe.dry_value, true);
  assert.throws(() => runtime.step({ nowMs: 2, samples: { ...good(2, { divisor: 0 }), moisture: sample(2, 40) } }), /division by zero/);
  assert.deepEqual(runtime.signals.get('dry').conditioner.sampleIdentity(), { epoch: 1, id: 1, timestampMs: 1 });
  assert.equal(runtime.step({ nowMs: 3, samples: { ...good(3, { divisor: 1 }), moisture: sample(3, 33) } }).vm.safe.dry_value, true,
    'the between-threshold reading retains the last committed hysteresis state');
});

test('framed known core rejection rolls back recovery and permits the same frame ID retry', async t => {
  const artifact = await compileSource(`control AtomicFramedRecovery {
    input divisor: Number;
    input level: Number { filter = median(1); recover_after = 2 samples; stale_after = 10s; }
    output ready: Bool;
    output quotient: Number;
    ready <- case level { ok(_) => true; fault(_) => false; };
    quotient <- 1.0 / (divisor |> recover(0.0));
  }`, { filename: 'atomic-framed-recovery.ghost' });
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact);
  t.after(() => runtime.dispose());

  assert.equal(runtime.step({ nowMs: 1, samples: { ...good(1, { divisor: 1 }), level: sample(1, 10) } }).sensors.level.quality, 'NotReady');
  assert.equal(runtime.step({ nowMs: 2, samples: { ...good(2, { divisor: 1 }), level: sample(2, 20) } }).sensors.level.quality, 'Good');
  runtime.step({ nowMs: 3, samples: { ...good(3, { divisor: 1 }), level: sample(3, 0, 'Invalid') } });
  const committed = structuredClone(runtime.lastFrameOutcome);

  assert.throws(() => runtime.step({ nowMs: 4, samples: { ...good(4, { divisor: 0 }), level: sample(4, 30) } }), /division by zero/);
  assert.equal(runtime.lastNowMs, 3);
  assert.deepEqual(runtime.lastFrameOutcome, committed);
  assert.deepEqual(runtime.sensors.get('level').conditioner.sampleIdentity(), { epoch: 1, id: 3, timestampMs: 3 });

  const retry = runtime.step({ nowMs: 5, samples: { ...good(5, { divisor: 1 }), level: sample(5, 40) } });
  assert.deepEqual(retry.frame, { scanId: 3, logicalTimeMs: 5 });
  assert.equal(retry.sensors.level.quality, 'NotReady');
  const recovered = runtime.step({ nowMs: 6, samples: { ...good(6, { divisor: 1 }), level: sample(6, 50) } });
  assert.equal(recovered.sensors.level.quality, 'Good');
});

for (const [mode, instantiate] of [
  ['legacy', ControlRuntime.instantiate],
  ['framed', ControlRuntime.instantiateFramed],
]) test(`${mode} late conditioner failure rolls back every earlier conditioner and permits retry`, async t => {
  const artifact = await compileSource(`control AtomicPartialConditioning {
    input first: Number { filter = median(1); stale_after = 10s; }
    input second: Number { filter = median(1); stale_after = 10s; }
    output ready: Bool;
    ready <- case first { ok(_) => true; fault(_) => false; };
  }`, { filename: `atomic-partial-${mode}.ghost` });
  const runtime = await instantiate.call(ControlRuntime, wasm, artifact);
  t.after(() => runtime.dispose());
  const at = (id, timestampMs, value) => ({ epoch: 1, id, timestampMs, value, quality: 'Good' });

  const committed = runtime.step({ nowMs: 100, samples: { first: at(1, 100, 10), second: at(1, 100, 20) } });
  const outcome = mode === 'framed' ? structuredClone(runtime.lastFrameOutcome) : null;
  assert.throws(() => runtime.step({ nowMs: 200, samples: {
    first: at(2, 200, 30), second: at(2, 50, 40),
  } }), /backward|before/);
  assert.equal(runtime.lastNowMs, 100);
  assert.deepEqual(runtime.sensors.get('first').conditioner.sampleIdentity(), { epoch: 1, id: 1, timestampMs: 100 });
  assert.deepEqual(runtime.sensors.get('second').conditioner.sampleIdentity(), { epoch: 1, id: 1, timestampMs: 100 });
  if (mode === 'framed') assert.deepEqual(runtime.lastFrameOutcome, outcome);

  const retry = runtime.step({ nowMs: 150, samples: { first: at(2, 150, 30), second: at(2, 150, 40) } });
  assert.equal(retry.sensors.first.value, 30);
  assert.equal(retry.sensors.second.value, 40);
  if (mode === 'framed') assert.deepEqual(retry.frame, { scanId: committed.frame.scanId + 1, logicalTimeMs: 150 });
});

for (const [mode, instantiate, property] of [
  ['legacy', ControlRuntime.instantiate, 'trace'],
  ['framed', ControlRuntime.instantiateFramed, 'outcome'],
]) test(`${mode} postcommit decode failure preserves accepted conditioner state and terminates the host`, async t => {
  const artifact = await compileSource(`control AtomicPostcommit {
    input level: Number { filter = median(1); stale_after = 10s; }
    output ready: Bool;
    ready <- case level { ok(_) => true; fault(_) => false; };
  }`, { filename: `atomic-postcommit-${mode}.ghost` });
  const runtime = await instantiate.call(ControlRuntime, wasm, artifact);
  t.after(() => runtime.dispose());
  runtime.step({ nowMs: 1, samples: { level: sample(1, 10) } });
  const prototypeGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(runtime.runtime), property).get.bind(runtime.runtime);
  let failDecode = true;
  Object.defineProperty(runtime.runtime, property, { configurable: true, get() {
    if (failDecode) { failDecode = false; throw new NativeDispatchError('injected postcommit decode failure', { committed: false }); }
    return prototypeGetter();
  } });

  assert.throws(() => runtime.step({ nowMs: 2, samples: { level: sample(2, 20) } }), /injected postcommit decode failure/);
  assert.equal(runtime.lastNowMs, 2);
  assert.deepEqual(runtime.sensors.get('level').conditioner.sampleIdentity(), { epoch: 1, id: 2, timestampMs: 2 });
  if (mode === 'framed') assert.deepEqual(
    { scanId: runtime.lastFrameOutcome.scanId, logicalTimeMs: runtime.lastFrameOutcome.logicalTimeMs },
    { scanId: 1, logicalTimeMs: 2 },
  );
  assert.throws(() => runtime.step({ nowMs: 3, samples: { level: sample(3, 30) } }), /faulted/);
});

test('framed known prepare rejection rolls back conditioning and reuses the frame identity', async t => {
  const artifact = await compileSource(`control AtomicPrepareFailure {
    input level: Number { filter = median(1); stale_after = 10s; }
    output ready: Bool;
    ready <- case level { ok(_) => true; fault(_) => false; };
  }`, { filename: 'atomic-prepare-failure.ghost' });
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact);
  t.after(() => runtime.dispose());
  runtime.step({ nowMs: 1, samples: { level: sample(1, 10) } });
  const dispatch = runtime.runtime.dispatch.bind(runtime.runtime);
  let reject = true;
  runtime.runtime.dispatch = frame => {
    if (reject) { reject = false; throw new NativeDispatchError('injected prepare rejection', { committed: false }); }
    return dispatch(frame);
  };

  assert.throws(() => runtime.step({ nowMs: 2, samples: { level: sample(2, 20) } }), /injected prepare rejection/);
  assert.equal(runtime.lastNowMs, 1);
  assert.deepEqual(runtime.sensors.get('level').conditioner.sampleIdentity(), { epoch: 1, id: 1, timestampMs: 1 });
  const retry = runtime.step({ nowMs: 2, samples: { level: sample(2, 20) } });
  assert.deepEqual(retry.frame, { scanId: 1, logicalTimeMs: 2 });
});

test('framed committed dispatch cleanup failure finalizes conditioning and accepted frame bookkeeping before terminating', async t => {
  const artifact = await compileSource(`control AtomicCommittedFailure {
    input level: Number { filter = median(1); stale_after = 10s; }
    output ready: Bool;
    ready <- case level { ok(_) => true; fault(_) => false; };
  }`, { filename: 'atomic-committed-failure.ghost' });
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact);
  t.after(() => runtime.dispose());
  runtime.step({ nowMs: 1, samples: { level: sample(1, 10) } });
  let dispatchedFrame;
  runtime.runtime.dispatch = frame => {
    dispatchedFrame = frame;
    throw new NativeDispatchError('injected positive cleanup failure', { committed: true });
  };

  assert.throws(() => runtime.step({ nowMs: 2, samples: { level: sample(2, 20) } }), /injected positive cleanup failure/);
  assert.deepEqual({ scanId: dispatchedFrame.scanId, logicalTimeMs: dispatchedFrame.logicalTimeMs }, { scanId: 1, logicalTimeMs: 2 });
  assert.equal(runtime.lastNowMs, 2);
  assert.deepEqual(runtime.sensors.get('level').conditioner.sampleIdentity(), { epoch: 1, id: 2, timestampMs: 2 });
  assert.throws(() => runtime.step({ nowMs: 3, samples: { level: sample(3, 30) } }), /faulted/);
});
