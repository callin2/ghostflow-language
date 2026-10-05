import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { softwareQualityObservations, softwareQualityRails } from './helpers/software-quality-observations.mjs';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const compile = code => compileSource(`# Hold last runtime\n\n\`\`\`ghost\n${code}\n\`\`\`\n`, { filename: 'hold-last-runtime.ghost.md' });
const frame = (artifact, scanId, logicalTimeMs, values) => ({ scanId, logicalTimeMs, inputs: Object.entries(softwareQualityRails(artifact, values, scanId + 1, logicalTimeMs)).map(([name, value]) => ({ name, value })) });

function native(bytes, tape) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-hold-last-'));
  try {
    const modulePath = path.join(directory, 'module.gfb'), tapePath = path.join(directory, 'tape.tsv');
    fs.writeFileSync(modulePath, bytes);
    fs.writeFileSync(tapePath, tape.map(row => [row.scanId, row.logicalTimeMs, ...row.inputs.flatMap(input => [input.name, typeof input.value === 'boolean' ? 'b' : 'n', String(input.value)])].join('\t')).join('\n') + '\n');
    const result = spawnSync(path.join(root, 'target/release/examples/scan_tape'), [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim().split('\n').map(line => JSON.parse(line));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function load(t, artifact, framed) {
  const runtime = await (framed ? FramedGhostFlowRuntime : GhostFlowRuntime).instantiate(wasm);
  t.after(() => runtime.dispose()); runtime.load(artifact.bytes);
  for (const output of artifact.manifest.outputs) runtime.addCapability('actuator', output.name, output.type === 'Bool' ? 'bool' : output.type === 'Int' ? 'int' : 'number');
  runtime.activate(); return runtime;
}
function legacyStep(runtime, row) {
  for (const { name, value } of row.inputs) typeof value === 'boolean' ? runtime.setBool(name, value) : runtime.setNumber(name, value);
  runtime.tickAt(row.logicalTimeMs); return runtime.trace;
}
function sensorValues(sensor, { value = false, ok = false, fault = 3, present = false, epoch = 0, id = 0, timestamp = 0 } = {}) {
  return {
    [sensor.valueInput]: value, [sensor.okInput]: ok, [sensor.faultInput]: fault,
    [sensor.samplePresentInput]: present, [sensor.sampleEpochInput]: epoch,
    [sensor.sampleIdInput]: id, [sensor.sampleTimestampInput]: timestamp,
  };
}

test('hold_last exact TTL, faults, duplicates and rejected ticks agree on native and both WASM ABIs', async t => {
  const artifact = await compile(`control HoldRuntime {
    input divisor: Number; input reading: Bool;
    state retained_divisor: Number = 1.0;
    let scalar_divisor = case divisor { ok(value) => value; fault(_) => retained_divisor; };
    retained_divisor' = scalar_divisor;
    signal usable = hold_last(reading, for_at_most: 2s, quality: measured);
    output held_value: Bool; output guard: Int;
    held_value <- usable |> recover(false); guard <- 1 div int_exact(scalar_divisor);
  }`);
  const sensor = artifact.manifest.sensors.find(item => item.name === 'reading'), signal = artifact.manifest.signals[0], s = signal.states;
  const make = (scanId, now, sample, divisor = 1) => frame(artifact, scanId, now, { divisor, ...sensorValues(sensor, sample) });
  const tape = [
    make(0, 0, {}),
    make(1, 100, { value: true, ok: true, present: true, epoch: 1, id: 1, timestamp: 100 }),
    make(2, 200, { ok: false, fault: 0, present: true, epoch: 1, id: 2, timestamp: 200 }),
    make(3, 2099, { value: true, ok: true, present: true, epoch: 1, id: 1, timestamp: 100 }),
    make(4, 2100, { value: true, ok: true, present: true, epoch: 1, id: 1, timestamp: 100 }),
    make(5, 2200, { value: false, ok: true, present: true, epoch: 1, id: 3, timestamp: 2200 }, 0),
    make(5, 2200, { value: false, ok: true, present: true, epoch: 1, id: 3, timestamp: 2200 }),
  ];
  const expected = native(artifact.bytes, tape);
  assert.deepEqual(expected.map(row => row.accepted), [true, true, true, true, true, false, true]);
  assert.deepEqual(expected.filter(row => row.accepted).map(row => row.outcome.trace.safe.held_value), [false, true, true, true, false, false]);
  assert.equal(expected[1].outcome.trace.stateAfter[s.held], true); assert.equal(expected[1].outcome.trace.stateAfter[s.age], 0);
  assert.equal(expected[2].outcome.trace.stateAfter[s.maskedFaultPresent], true);
  assert.equal(expected[2].outcome.trace.stateAfter[s.maskedFaultCode], 0);
  assert.equal(expected[2].outcome.trace.stateAfter[s.maskedFaultOrigin], signal.sources[0].tag);
  assert.equal(expected[4].outcome.trace.stateAfter[s.available], true); assert.equal(expected[4].outcome.trace.stateAfter[s.held], false);
  assert.equal(expected[4].outcome.trace.stateAfter[s.age], 2000);
  assert.deepEqual(expected[5].outcome, expected[4].outcome, 'rejected tick preserves held record and provenance');
  assert.equal(expected[6].outcome.trace.stateAfter[s.heldId], 3, 'retry commits the same new sample');
  for (const framed of [false, true]) {
    const runtime = await load(t, artifact, framed);
    for (const [index, row] of tape.entries()) {
      if (index === 5) assert.throws(() => framed ? runtime.scan(row) : legacyStep(runtime, row), /integer-division-by-zero/);
      else assert.deepEqual(framed ? runtime.scan(row) : legacyStep(runtime, row), framed ? expected[index].outcome : expected[index].outcome.trace);
    }
  }
  assert.deepEqual(native(artifact.bytes, tape), expected, 'native replay of the captured frames is deterministic');
});

test('hold_last retains another-root faults but invalidates the cached root on epoch replacement', async t => {
  const artifact = await compile(`control HoldRoots {
    input choose_b: Bool; input a: Bool; input b: Bool;
    let chosen: Result<Bool, SensorFault> = case choose_b { ok(choose) => if choose then b else a; fault(reason) => fault(reason); };
    signal usable = hold_last(chosen, for_at_most: 2s, quality: measured);
    output value: Bool; value <- usable |> recover(false);
  }`);
  const [a, b] = ['a', 'b'].map(name => artifact.manifest.sensors.find(item => item.name === name)), signal = artifact.manifest.signals[0], s = signal.states;
  const make = (scanId, now, chooseB, av, bv) => frame(artifact, scanId, now, { choose_b: chooseB, ...sensorValues(a, av), ...sensorValues(b, bv) });
  const good = (epoch, id, timestamp, value) => ({ epoch, id, timestamp, value, ok: true, present: true });
  const fault = (epoch, id, timestamp) => ({ epoch, id, timestamp, fault: 0, ok: false, present: true });
  const tape = [
    make(0, 0, false, good(1, 1, 0, true), {}),
    make(1, 100, true, {}, fault(1, 1, 100)),
    make(2, 200, true, good(2, 1, 200, true), fault(1, 2, 200)),
    make(3, 300, true, {}, good(1, 3, 300, false)),
    make(4, 400, false, fault(2, 2, 400), {}),
  ];
  const expected = native(artifact.bytes, tape);
  assert.deepEqual(expected.map(row => row.outcome.trace.safe.value), [true, true, false, false, false]);
  assert.equal(expected[1].outcome.trace.stateAfter[s.heldSourceTag], signal.sources.find(source => source.name === 'a').tag);
  assert.equal(expected[2].outcome.trace.stateAfter[s.available], false, 'cached a epoch replacement invalidates a while b is selected');
  assert.equal(expected[3].outcome.trace.stateAfter[s.heldSourceTag], signal.sources.find(source => source.name === 'b').tag);
  assert.equal(expected[4].outcome.trace.stateAfter[s.held], true, 'fault from a retains cached b');
  for (const framed of [false, true]) {
    const runtime = await load(t, artifact, framed);
    for (const [index, row] of tape.entries()) assert.deepEqual(framed ? runtime.scan(row) : legacyStep(runtime, row), framed ? expected[index].outcome : expected[index].outcome.trace);
  }
});

test('map cannot launder Held into measured evidence', async () => {
  const artifact = await compile(`control HeldMapQuality {
    fn same(value: Bool) -> Bool { value }
    input reading: Bool;
    signal inner = hold_last(reading, for_at_most: 5s, quality: measured);
    signal mapped = hold_last(inner |> map(same), for_at_most: 5s, quality: measured);
    output inner_ok: Bool; output mapped_ok: Bool;
    inner_ok <- inner |> recover(false); mapped_ok <- mapped |> recover(false);
  }`);
  const sensor = artifact.manifest.sensors.find(item => item.name === 'reading');
  const runtime = await GhostFlowRuntime.instantiate(wasm);
  try {
    runtime.load(artifact.bytes);
    for (const output of artifact.manifest.outputs) runtime.addCapability('actuator', output.name, 'bool');
    runtime.activate();
    for (const [name, value] of Object.entries(sensorValues(sensor, { value: true, ok: true, present: true, epoch: 1, id: 1, timestamp: 0 }))) typeof value === 'boolean' ? runtime.setBool(name, value) : runtime.setNumber(name, value);
    runtime.tickAt(0);
    assert.deepEqual(runtime.trace.safe, { inner_ok: true, mapped_ok: false });
  } finally { runtime.dispose(); }
});

test('and_then preserves incoming Measured or Held quality without constructor laundering', async () => {
  const artifact = await compile(`control HeldAndThenQuality {
    fn authored(value: Bool) -> Result<Bool, SensorFault> { ok(value) }
    input reading: Bool;
    signal direct = hold_last(reading |> and_then(authored), for_at_most: 5s, quality: measured);
    signal inner = hold_last(reading, for_at_most: 5s, quality: measured);
    signal chained = hold_last(inner |> and_then(authored), for_at_most: 5s, quality: measured);
    output direct_ok: Bool; output chained_ok: Bool;
    direct_ok <- direct |> recover(false); chained_ok <- chained |> recover(false);
  }`);
  const sensor = artifact.manifest.sensors.find(item => item.name === 'reading'), runtime = await GhostFlowRuntime.instantiate(wasm);
  try {
    runtime.load(artifact.bytes); runtime.addCapability('actuator', 'direct_ok', 'bool'); runtime.addCapability('actuator', 'chained_ok', 'bool'); runtime.activate();
    for (const [name, value] of Object.entries(sensorValues(sensor, { value: true, ok: true, present: true, epoch: 1, id: 1, timestamp: 0 }))) typeof value === 'boolean' ? runtime.setBool(name, value) : runtime.setNumber(name, value);
    runtime.tickAt(0); assert.deepEqual(runtime.trace.safe, { chained_ok: false, direct_ok: true });
  } finally { runtime.dispose(); }
});

test('if selects Held or Measured quality without branch switches inventing a fresh observation', async () => {
  const artifact = await compile(`control HeldBranchQuality {
    input use_raw: Bool; input reading: Bool;
    signal inner = hold_last(reading, for_at_most: 5s, quality: measured);
    let selected: Result<Bool, SensorFault> = case use_raw { ok(choose) => if choose then reading else inner; fault(reason) => fault(reason); };
    signal outer = hold_last(selected, for_at_most: 5s, quality: measured);
    output value: Bool; value <- outer |> recover(false);
  }`);
  const sensor = artifact.manifest.sensors.find(item => item.name === 'reading'), outer = artifact.manifest.signals.find(signal => signal.name === 'outer');
  const runtime = await GhostFlowRuntime.instantiate(wasm);
  try {
    runtime.load(artifact.bytes); runtime.addCapability('actuator', 'value', 'bool'); runtime.activate();
    const step = (now, useRaw, id) => {
      for (const [name, value] of Object.entries(softwareQualityRails(artifact, { use_raw: useRaw }, id, now))) {
        typeof value === 'boolean' ? runtime.setBool(name, value) : runtime.setNumber(name, value);
      }
      for (const [name, value] of Object.entries(sensorValues(sensor, { value: true, ok: true, present: true, epoch: 1, id, timestamp: now }))) typeof value === 'boolean' ? runtime.setBool(name, value) : runtime.setNumber(name, value);
      runtime.tickAt(now); return runtime.trace;
    };
    assert.equal(step(0, false, 1).safe.value, false, 'Held branch is not measured');
    assert.equal(step(100, true, 1).safe.value, false, 'switching to Measured on a duplicate does not invent freshness');
    assert.equal(step(200, true, 2).safe.value, true, 'fresh Measured branch admits the sample');
    assert.equal(step(300, false, 3).stateAfter[outer.states.heldId], 2, 'fresh Held branch cannot replace measured identity');
    assert.equal(step(400, true, 3).stateAfter[outer.states.heldId], 2, 'switching back on the already observed tuple stays duplicate');
  } finally { runtime.dispose(); }
});

test('debounce preserves Held quality and cannot make it measured', async () => {
  const artifact = await compile(`control HeldDebounceQuality {
    input reading: Bool;
    signal inner = hold_last(reading, for_at_most: 5s, quality: measured);
    signal settled = debounce(inner, stable_for: 1s, initial: false);
    signal outer = hold_last(settled, for_at_most: 5s, quality: measured);
    output inner_ok: Bool; output outer_ok: Bool;
    inner_ok <- inner |> recover(false); outer_ok <- outer |> recover(false);
  }`);
  const sensor = artifact.manifest.sensors.find(item => item.name === 'reading'), runtime = await GhostFlowRuntime.instantiate(wasm);
  try {
    runtime.load(artifact.bytes); runtime.addCapability('actuator', 'inner_ok', 'bool'); runtime.addCapability('actuator', 'outer_ok', 'bool'); runtime.activate();
    for (const [name, value] of Object.entries(sensorValues(sensor, { value: true, ok: true, present: true, epoch: 1, id: 1, timestamp: 0 }))) typeof value === 'boolean' ? runtime.setBool(name, value) : runtime.setNumber(name, value);
    runtime.tickAt(0); assert.deepEqual(runtime.trace.safe, { inner_ok: true, outer_ok: false });
  } finally { runtime.dispose(); }
});

test('future samples never seed a hold or renew an existing cache', async t => {
  const artifact = await compile(`control HoldFuture {
    input reading: Bool; signal usable = hold_last(reading, for_at_most: 2s, quality: measured);
    output value: Bool; value <- usable |> recover(false);
  }`);
  const sensor = artifact.manifest.sensors.find(item => item.name === 'reading'), signal = artifact.manifest.signals[0];
  const tape = [
    frame(artifact, 0, 100, sensorValues(sensor, { value: true, ok: true, present: true, epoch: 1, id: 1, timestamp: 100 })),
    frame(artifact, 1, 200, sensorValues(sensor, { value: false, ok: true, present: true, epoch: 1, id: 2, timestamp: 5000 })),
    frame(artifact, 2, 2099, sensorValues(sensor, {})),
    frame(artifact, 3, 2100, sensorValues(sensor, { value: false, ok: true, present: true, epoch: 1, id: 2, timestamp: 5000 })),
    frame(artifact, 4, 5000, sensorValues(sensor, { value: false, ok: true, present: true, epoch: 1, id: 2, timestamp: 5000 })),
  ];
  const expected = native(artifact.bytes, tape);
  assert.deepEqual(expected.map(row => row.outcome.trace.safe.value), [true, true, true, false, false]);
  assert.equal(expected[1].outcome.trace.stateAfter[signal.states.heldId], 1);
  assert.equal(expected[4].outcome.trace.stateAfter[signal.states.available], true);
  assert.equal(expected[4].outcome.trace.stateAfter[signal.states.held], false);
  for (const framed of [false, true]) {
    const runtime = await load(t, artifact, framed);
    for (const [index, row] of tape.entries()) assert.deepEqual(framed ? runtime.scan(row) : legacyStep(runtime, row), framed ? expected[index].outcome : expected[index].outcome.trace);
  }
});

test('statically Held input still evaluates an authored Result selector fault and rolls back', async () => {
  const artifact = await compile(`control HeldSelectorFault {
    fn guarded(value: Bool) -> Result<Bool, SensorFault> {
      if 1 div (if value then 0 else 1) == 1 then ok(value) else ok(value)
    }
    input reading: Bool;
    signal inner = hold_last(reading, for_at_most: 5s, quality: measured);
    signal outer = hold_last(inner |> and_then(guarded), for_at_most: 5s, quality: measured);
    state accepted: Number = 0.0; accepted' = accepted + 1.0;
    output value: Bool; value <- outer |> recover(false);
  }`);
  const sensor = artifact.manifest.sensors.find(item => item.name === 'reading'), inner = artifact.manifest.signals.find(signal => signal.name === 'inner');
  const runtime = await GhostFlowRuntime.instantiate(wasm);
  try {
    runtime.load(artifact.bytes); runtime.addCapability('actuator', 'value', 'bool'); runtime.activate();
    for (const [name, value] of Object.entries(sensorValues(sensor, { value: true, ok: true, present: true, epoch: 1, id: 1, timestamp: 0 }))) typeof value === 'boolean' ? runtime.setBool(name, value) : runtime.setNumber(name, value);
    assert.throws(() => runtime.tickAt(0), /integer-division-by-zero/);
    assert.equal(runtime.stateNumber('accepted'), 0); assert.equal(runtime.stateNumber(inner.states.heldId), -1);
    for (const [name, value] of Object.entries(sensorValues(sensor, { value: false, ok: true, present: true, epoch: 1, id: 1, timestamp: 0 }))) typeof value === 'boolean' ? runtime.setBool(name, value) : runtime.setNumber(name, value);
    runtime.tickAt(0);
    assert.equal(runtime.trace.safe.value, false); assert.equal(runtime.stateNumber('accepted'), 1);
    assert.equal(runtime.stateNumber(inner.states.heldId), 1, 'the rejected sample commits on retry');
  } finally { runtime.dispose(); }
});

test('hold_last age starts at the original delayed sample timestamp and expires at the exact boundary', async t => {
  const artifact = await compile(`control HoldDelayed {
    input reading: Bool; signal usable = hold_last(reading, for_at_most: 1s, quality: measured);
    output value: Bool; value <- usable |> recover(false);
  }`);
  const sensor = artifact.manifest.sensors.find(item => item.name === 'reading'), states = artifact.manifest.signals[0].states;
  const tape = [
    frame(artifact, 0, 1000, sensorValues(sensor, { value: true, ok: true, present: true, epoch: 1, id: 1, timestamp: 500 })),
    frame(artifact, 1, 1499, sensorValues(sensor, {})),
    frame(artifact, 2, 1500, sensorValues(sensor, {})),
  ];
  const expected = native(artifact.bytes, tape);
  assert.deepEqual(expected.map(row => row.outcome.trace.safe.value), [true, true, false]);
  assert.deepEqual(expected.map(row => row.outcome.trace.stateAfter[states.age]), [500, 999, 1000]);
  for (const framed of [false, true]) {
    const runtime = await load(t, artifact, framed);
    for (const [index, row] of tape.entries()) assert.deepEqual(framed ? runtime.scan(row) : legacyStep(runtime, row), framed ? expected[index].outcome : expected[index].outcome.trace);
  }
});

test('both public hosts roll back partial conditioning, ignore lower IDs, and cold restart NotReady', async () => {
  const artifact = await compile(`control HoldHostAtomic {
    input choose_a: Bool; input a: Bool { stale_after = 10s; } input b: Bool { stale_after = 10s; }
    let selected: Result<Bool, SensorFault> = case choose_a { ok(choose) => if choose then a else b; fault(reason) => fault(reason); };
    signal usable = hold_last(selected, for_at_most: 2s, quality: measured);
    output value: Bool; value <- usable |> recover(false);
  }`);
  const held = artifact.manifest.signals[0].states;
  const sample = (id, timestampMs, value, epoch = 1) => ({ epoch, id, timestampMs, value, quality: 'Good' });
  for (const [label, instantiate] of [['legacy', ControlRuntime.instantiate], ['framed', ControlRuntime.instantiateFramed]]) {
    const runtime = softwareQualityObservations(await instantiate(wasm, artifact));
    try {
      assert.equal(runtime.step({ nowMs: 100, inputs: { choose_a: true }, samples: { a: sample(1, 100, true), b: sample(1, 100, true) } }).vm.safe.value, true, label);
      assert.throws(() => runtime.step({ nowMs: 200, inputs: { choose_a: true }, samples: { a: sample(2, 200, false), b: sample(2, 50, false) } }), /clock moved backward/);
      const retry = runtime.step({ nowMs: 150, inputs: { choose_a: true }, samples: { a: sample(2, 150, true), b: sample(2, 150, true) } });
      assert.equal(retry.vm.safe.value, true, `${label} rolls the first conditioner back before retry`);
      assert.equal(retry.vm.stateAfter[held.heldId], 2);
      const lower = runtime.step({ nowMs: 200, inputs: { choose_a: true }, samples: { a: sample(1, 200, false) } });
      assert.equal(lower.vm.safe.value, true, `${label} uses the authoritative accepted identity and payload`);
      assert.equal(lower.vm.stateAfter[held.heldId], 2);
      assert.deepEqual(runtime.sensors.get('a').conditioner.sampleIdentity(), { epoch: 1, id: 2, timestampMs: 150 });
    } finally { runtime.dispose(); }

    const restarted = softwareQualityObservations(await instantiate(wasm, artifact));
    try {
      const cold = restarted.step({ nowMs: 300, inputs: { choose_a: true }, samples: {} });
      assert.equal(cold.vm.safe.value, false, `${label} cold restart is NotReady`);
      assert.equal(cold.vm.stateAfter[held.available], false);
      assert.equal(cold.vm.resultTrace.at(-1).choice, 4);
    } finally { restarted.dispose(); }
  }
});
