import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const compile = code => compileSource(`# Debounce execution\n\n\`\`\`ghost\n${code}\n\`\`\`\n`, { filename: 'debounce-runtime.ghost.md' });
// These fixture values are explicit Good observations of the named acquisition inputs.
// Already captured VM rails pass through unchanged, including physical sample identity.
const frame = (scanId, logicalTimeMs, values) => ({ scanId, logicalTimeMs, inputs: Object.entries(values).flatMap(([name, value]) =>
  ['start', 'divisor', 'pick_a', 'broken'].includes(name)
    ? [{ name: `__gf_sensor_value_${name}`, value }, { name: `__gf_sensor_ok_${name}`, value: true }, { name: `__gf_sensor_fault_${name}`, value: 0 }]
    : [{ name, value }]) });
function native(bytes, tape) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-debounce-'));
  try {
    const modulePath = path.join(directory, 'module.gfb'), tapePath = path.join(directory, 'tape.tsv');
    fs.writeFileSync(modulePath, bytes);
    fs.writeFileSync(tapePath, tape.map(row => [row.scanId, row.logicalTimeMs, ...row.inputs.flatMap(input => [input.name, typeof input.value === 'boolean' ? 'b' : 'n', String(input.value)])].join('\t')).join('\n') + '\n');
    const result = spawnSync(path.join(root, 'target/release/examples/scan_tape' + (process.platform === 'win32' ? '.exe' : '')), [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim().split('\n').map(line => JSON.parse(line));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
async function load(t, artifact, framed) {
  const runtime = await (framed ? FramedGhostFlowRuntime : GhostFlowRuntime).instantiate(wasm);
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  for (const output of artifact.manifest.outputs) runtime.addCapability('actuator', output.name, output.type === 'Bool' ? 'bool' : output.type === 'Int' ? 'int' : 'number');
  runtime.activate();
  return runtime;
}
function legacyStep(runtime, row) {
  for (const { name, value } of row.inputs) typeof value === 'boolean' ? runtime.setBool(name, value) : runtime.setNumber(name, value);
  runtime.tickAt(row.logicalTimeMs);
  return runtime.trace;
}

test('debounce private states commit atomically and replay identically on native and both WASM ABIs', async t => {
  const artifact = await compile(`control AtomicDebounce {
    input start: Bool; input divisor: Number;
    signal stable = debounce(start |> recover(false), stable_for: 2s, initial: false);
    state accepted: Number = 0.0; accepted' = accepted + 1.0;
    output result: Bool; output guard: Int;
    result <- stable; guard <- 1 div int_exact(divisor |> recover(0.0));
  }`);
  const tape = [
    frame(0, 100, { start: true, divisor: 1 }),
    frame(1, 2099, { start: true, divisor: 1 }),
    frame(2, 2100, { start: true, divisor: 0 }),
    frame(2, 2100, { start: true, divisor: 1 }),
    frame(3, 2200, { start: false, divisor: 1 }),
    frame(4, 4200, { start: false, divisor: 1 }),
  ];
  const expected = native(artifact.bytes, tape);
  assert.deepEqual(expected.map(row => row.accepted), [true, true, false, true, true, true]);
  assert.equal(expected[2].error, 'integer-division-by-zero');
  assert.deepEqual(expected[2].outcome, expected[1].outcome);
  assert.deepEqual(expected.filter(row => row.accepted).map(row => row.outcome.trace.safe.result), [false, false, true, true, false]);
  assert.equal(expected[3].outcome.trace.stateAfter.accepted, 3);
  const legacy = await load(t, artifact, false), framed = await load(t, artifact, true);
  for (const [index, row] of tape.entries()) {
    if (index === 2) {
      const before = legacy.trace, count = legacy.journalLength, previous = framed.outcome;
      assert.throws(() => legacyStep(legacy, row), /integer-division-by-zero/);
      assert.deepEqual(legacy.trace, before); assert.equal(legacy.journalLength, count);
      assert.throws(() => framed.scan(row), /integer-division-by-zero/);
      assert.deepEqual(framed.outcome, previous);
    } else {
      assert.deepEqual(legacyStep(legacy, row), expected[index].outcome.trace);
      assert.deepEqual(framed.scan(row), expected[index].outcome);
    }
  }
  legacy.rewind(expected[0].outcome.trace.tick);
  for (const index of [1, 3, 4, 5]) assert.deepEqual(legacyStep(legacy, tape[index]), expected[index].outcome.trace);
  assert.deepEqual(native(artifact.bytes, tape), expected, 'native replay of the same captured frames is deterministic');
});

test('debounce finite Result enum retains physical sample identity, timestamps and faults on native and WASM', async t => {
  const artifact = await compile(`control SampleDebounce {
    type Mode = Off | On;
    fn mode(value: Bool) -> Mode { if value then On else Off }
    input probe: Bool;
    signal stable = debounce(probe |> map(mode), stable_for: 2s, initial: Off);
    output result: Bool;
    result <- case stable { ok(value) => value == On; fault(_) => false; };
  }`);
  const sensor = artifact.manifest.sensors[0], signal = artifact.manifest.signals.find(item => item.name === 'stable');
  assert.deepEqual(signal.members, ['Off', 'On']);
  const make = (scan, now, { present = true, epoch = 1, id = 1, timestamp = 0, ok = true, fault = 0 } = {}) => frame(scan, now, {
    [sensor.valueInput]: true, [sensor.okInput]: ok, [sensor.faultInput]: fault,
    [sensor.samplePresentInput]: present, [sensor.sampleEpochInput]: epoch,
    [sensor.sampleIdInput]: id, [sensor.sampleTimestampInput]: timestamp,
  });
  const tape = [
    make(0, 0), make(1, 2500, { present: false }), make(2, 2500),
    make(3, 2500, { id: 2, timestamp: 2000 }),
    make(4, 2501, { present: false, epoch: 0, id: 0, timestamp: 0 }),
    make(4, 2600, { epoch: 2, id: 1, timestamp: 2600 }),
    make(5, 4599, { epoch: 2, id: 2, timestamp: 4599 }),
    make(6, 4600, { epoch: 2, id: 3, timestamp: 4600 }),
    make(7, 4700, { present: false, ok: false, fault: 0 }),
    make(8, 4800, { epoch: 2, id: 4, timestamp: 4800 }),
    make(9, 6800, { epoch: 2, id: 5, timestamp: 6800 }),
  ].map((row, scanId) => ({ ...row, scanId }));
  const expected = native(artifact.bytes, tape);
  assert.ok(expected.every(row => row.accepted));
  assert.deepEqual(expected.map(row => row.outcome.trace.safe.result), [false, false, false, true, true, false, false, true, false, false, true]);
  assert.deepEqual(expected[4].outcome.trace.stateAfter, expected[3].outcome.trace.stateAfter, 'absent sample placeholder epoch must not reset promoted state');
  assert.deepEqual(expected[2].outcome.trace.stateAfter, expected[0].outcome.trace.stateAfter, 'missing and duplicate physical samples do not advance private state');
  assert.equal(expected[8].outcome.trace.stateAfter[signal.states.stable], 0);
  assert.equal(expected[8].outcome.trace.resultTrace.at(-1).choice, 1);
  assert.equal(expected[8].outcome.trace.resultTrace.at(-1).origin, signal.sources[0].tag);
  const legacy = await load(t, artifact, false), framed = await load(t, artifact, true);
  for (const [index, row] of tape.entries()) {
    assert.deepEqual(legacyStep(legacy, row), expected[index].outcome.trace);
    assert.deepEqual(framed.scan(row), expected[index].outcome);
  }
  legacy.rewind(expected[3].outcome.trace.tick);
  for (let index = 4; index < tape.length; index++) assert.deepEqual(legacyStep(legacy, tape[index]), expected[index].outcome.trace);
});

test('debounce per-root high water survives selection, older samples, faults and rejected scans', async t => {
  const artifact = await compile(`control RootIdentity {
    ${Array.from({ length: 20 }, (_, index) => `let pad${index}: Number = 0.0;`).join('\n')}
    input pick_a: Bool; input divisor: Number;
    input a: Bool; input b: Bool;
    let observed: Result<Bool, SensorFault> = if (pick_a |> recover(false)) then a else b;
    signal stable = debounce(observed, stable_for: 2s, initial: false);
    output result: Bool; output guard: Int;
    result <- case stable { ok(value) => value; fault(_) => false; };
    guard <- 1 div int_exact(divisor |> recover(0.0));
  }`);
  const signal = artifact.manifest.signals.find(item => item.name === 'stable');
  const make = (now, { pick = true, broken = false, divisor = 1, a, b } = {}) => {
    const values = { pick_a: pick, divisor };
    for (const sensor of artifact.manifest.sensors.filter(sensor => ['a', 'b'].includes(sensor.name))) {
      const sample = sensor.name === 'a' ? a : b;
      // New fixture revision injects the selected input's Invalid quality directly.
      // The predecessor injected fault(Invalid) through a separate scalar flag;
      // its exact source is archived. Fault reset/high-water/replay oracles remain.
      const invalid = broken && (sensor.name === 'a') === pick;
      Object.assign(values, {
        [sensor.valueInput]: invalid ? false : true, [sensor.okInput]: !invalid, [sensor.faultInput]: invalid ? 2 : 0,
        [sensor.samplePresentInput]: Boolean(sample), [sensor.sampleEpochInput]: sample?.epoch ?? 0,
        [sensor.sampleIdInput]: sample?.id ?? 0, [sensor.sampleTimestampInput]: sample?.timestamp ?? 0,
      });
    }
    return frame(0, now, values);
  };
  const sample = (id, timestamp, epoch = 0) => ({ id, timestamp, epoch });
  const tape = [
    make(0, { a: sample(0, 0) }),
    make(500, { pick: false, a: sample(10, 500), b: sample(0, 500) }),
    make(2500, { a: sample(5, 2500) }),
    make(4500, { a: sample(10, 4500) }),
    make(5000, { a: sample(11, 5000) }),
    make(6000, { a: sample(5, 6000) }),
    make(6999, { a: sample(12, 6999) }),
    make(7000, { a: sample(13, 7000) }),
    make(7100, { broken: true }),
    make(9200, { a: sample(13, 9200) }),
    make(9300, { a: sample(14, 9300) }),
    make(11300, { a: sample(15, 11300), divisor: 0 }),
    make(11300, { a: sample(15, 11300) }),
    make(11400, { a: sample(0, 11400, Number.MAX_SAFE_INTEGER) }),
    make(13400, { a: sample(Number.MAX_SAFE_INTEGER, 13400, Number.MAX_SAFE_INTEGER) }),
    make(15400, { a: sample(Number.MAX_SAFE_INTEGER - 1, 15400, Number.MAX_SAFE_INTEGER) }),
  ].map((row, index) => ({ ...row, scanId: index > 11 ? index - 1 : index }));
  const expected = native(artifact.bytes, tape);
  assert.deepEqual(expected.map(row => row.accepted), tape.map((_, index) => index !== 11));
  assert.deepEqual(expected.filter(row => row.accepted).map(row => row.outcome.trace.safe.result),
    [false, false, false, false, false, false, false, true, false, false, false, true, false, true, true]);
  const a = signal.sources.find(source => source.name === 'a').states;
  const b = signal.sources.find(source => source.name === 'b').states;
  assert.equal(expected[1].outcome.trace.stateAfter[a.lastId], 10, 'unselected physical root records its high water');
  assert.equal(expected[1].outcome.trace.stateAfter[b.lastId], 0, 'epoch zero and sample zero are valid');
  assert.equal(expected[8].outcome.trace.stateAfter[a.lastId], 13, 'fault preserves physical identity');
  assert.deepEqual(expected[11].outcome, expected[10].outcome, 'rejected scan preserves every root high water');
  assert.equal(expected[12].outcome.trace.stateAfter[a.lastId], 15, 'same sample can commit on retry');
  const legacy = await load(t, artifact, false), framed = await load(t, artifact, true);
  for (const [index, row] of tape.entries()) {
    if (index === 11) {
      const previous = legacy.trace, count = legacy.journalLength;
      assert.throws(() => legacyStep(legacy, row), /integer-division-by-zero/);
      assert.deepEqual(legacy.trace, previous); assert.equal(legacy.journalLength, count);
      assert.throws(() => framed.scan(row), /integer-division-by-zero/);
    } else {
      assert.deepEqual(legacyStep(legacy, row), expected[index].outcome.trace);
      assert.deepEqual(framed.scan(row), expected[index].outcome);
    }
  }
  legacy.rewind(expected[1].outcome.trace.tick);
  for (let index = 2; index < tape.length; index++) if (index !== 11) {
    assert.deepEqual(legacyStep(legacy, tape[index]), expected[index].outcome.trace);
  }
  assert.deepEqual(native(artifact.bytes, tape), expected);
});
