import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const tapePath = path.join(root, 'target/release/examples/scan_tape' + (process.platform === 'win32' ? '.exe' : ''));
const adapterPath = path.join(root, 'target/release/examples/scan_adapter' + (process.platform === 'win32' ? '.exe' : ''));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const source = `# Framed native temporal windows

\`\`\`ghost
control FramedNativeWindows {
  input threshold_time: Duration;
  input temperature: Temperature;
  signal average_temperature = window_average(temperature, over: 1s, quality: measured, max_age: 1s);
  signal minimum_temperature = window_min(temperature, over: 1s, quality: measured, max_age: 1s);
  signal maximum_temperature = window_max(temperature, over: 1s, quality: measured, max_age: 1s);
  signal temperature_rate = window_rate(temperature, over: 1s, quality: measured, max_age: 1s);
  output average, minimum, maximum: Temperature;
  output fast: Bool;
  average <- average_temperature |> recover(0K);
  minimum <- minimum_temperature |> recover(0K);
  maximum <- maximum_temperature |> recover(0K);
  fast <- temperature_rate |> map(below(rate(delta: 1ΔK, time: (threshold_time |> recover(0ms))))) |> recover(false);
}
\`\`\`
`;

const profile = tag => ({
  timeEpoch: 5,
  rootDensity: [{ sourceTag: tag, maxObservations: 3, intervalMs: 1000 }],
  budget: { maxRetainedSamples: 12, maxBytes: 33554432 },
});
const profileArgs = tag => ['--temporal', '5', '12', '33554432', `${tag}:3:1000`];

async function fixture(t) {
  const artifact = await compileSource(source, { filename: 'window-framed-native.ghost.md' });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-window-framed-native-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'window.gfb');
  fs.writeFileSync(modulePath, artifact.bytes);
  const sensor = artifact.manifest.sensors.find(item => item.name === 'temperature');
  const thresholdInput = artifact.manifest.sensors.find(item => item.name === 'threshold_time');
  const tag = artifact.manifest.signals[0].sources[0].tag;
  const inputs = ({ threshold, present, id, timestamp, value = 284 }) => [
    { name: thresholdInput.valueInput, value: threshold },
    { name: thresholdInput.okInput, value: true },
    { name: thresholdInput.faultInput, value: 0 },
    { name: sensor.valueInput, value },
    { name: sensor.okInput, value: true },
    { name: sensor.faultInput, value: 0 },
    { name: '__gf_time_epoch', value: 5 },
    { name: sensor.samplePresentInput, value: present },
    { name: sensor.sampleEpochInput, value: 1 },
    { name: sensor.sampleIdInput, value: id },
    { name: sensor.sampleTimestampInput, value: timestamp },
  ];
  return { artifact, directory, modulePath, tag, inputs };
}

function native(executable, args) {
  return spawnSync(executable, args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
}

function tapeRow(scanId, logicalTimeMs, inputs) {
  return [scanId, logicalTimeMs, ...inputs.flatMap(input => [input.name, typeof input.value === 'boolean' ? 'b' : 'n', input.value])].join('\t');
}

test('REF-04-032 preloaded future samples stay excluded and no-checkpoint restart is NotReady on native and WASM bounded windows', async t => {
  const { artifact, directory, modulePath, tag, inputs } = await fixture(t);
  // The whole tape, including t=20, is loaded before either portable owner runs.
  // Deliberately present that observation at t=10: admission must reject it,
  // retaining the committed window and allowing the same scan ID to retry.
  const at = (present, id, timestamp, value = 284) => inputs({ threshold: 1000, present, id, timestamp, value });
  const frames = [
    { scanId: 0, logicalTimeMs: 0, inputs: at(true, 1, 0, 280) },
    { scanId: 1, logicalTimeMs: 10, inputs: at(true, 2, 20) },
    { scanId: 1, logicalTimeMs: 10, inputs: at(false, 2, 20) },
    { scanId: 2, logicalTimeMs: 20, inputs: at(true, 2, 20) },
    { scanId: 3, logicalTimeMs: 19, inputs: at(false, 2, 20) },
    { scanId: 3, logicalTimeMs: 2000, inputs: at(false, 2, 20) },
  ];
  const executeNative = tape => {
    const inputPath = path.join(directory, 'reference-window-bounds.tsv');
    fs.writeFileSync(inputPath, `${tape.map(frame => tapeRow(frame.scanId, frame.logicalTimeMs, frame.inputs)).join('\n')}\n`);
    const result = native(tapePath, [modulePath, inputPath, ...profileArgs(tag)]);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().split('\n').map(JSON.parse);
  };
  const runtime = await FramedGhostFlowRuntime.instantiate(wasm);
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  for (const output of artifact.manifest.outputs) runtime.addCapability('actuator', output.name, output.type === 'Bool' ? 'bool' : 'number');
  const boundedProfile = profile(tag);
  const planned = runtime.planTemporal({ profile: boundedProfile, maxJsonBytes: 65536 });
  assert.equal(planned.retainedSamples, 12, 'four statically planned windows each retain at most three observations');
  assert.equal(planned.fitsBudget, true);
  runtime.activateTemporal(boundedProfile);
  const wasmRows = frames.map(frame => {
    try { return { accepted: true, outcome: runtime.scan(frame) }; }
    catch (error) { return { accepted: false, outcome: runtime.outcome, error: error.message }; }
  });
  const nativeRows = executeNative(frames);
  assert.deepEqual(nativeRows.map(({ accepted, outcome }) => ({ accepted, outcome })),
    wasmRows.map(({ accepted, outcome }) => ({ accepted, outcome })), 'same canonical bytecode exposes the entire same trace on both targets');
  assert.deepEqual(nativeRows.map(row => row.accepted), [true, false, true, true, false, true]);
  assert.match(nativeRows[1].error, /future/);
  assert.deepEqual(nativeRows[1].outcome, nativeRows[0].outcome);
  assert.deepEqual(nativeRows[2].outcome.trace.windowTrace.map(row => row.contributors.map(point => point.id)), [[1], [1], [1], [1]]);
  assert.deepEqual(nativeRows[2].outcome.trace.safe, { average: 280, minimum: 280, maximum: 280, fast: false });
  assert.deepEqual(nativeRows[3].outcome.trace.windowTrace.map(row => row.count), [2, 2, 2, 2]);
  assert.deepEqual(nativeRows[3].outcome.trace.safe, { average: 282, minimum: 280, maximum: 284, fast: false });
  assert.match(nativeRows[4].error, /backward|monotonic/);
  assert.deepEqual(nativeRows[4].outcome, nativeRows[3].outcome);
  assert.ok(nativeRows[5].outcome.trace.windowTrace.every(row => row.value === null && row.count === 0), 'missed scans cannot invent observations or retain expired evidence');
  const live = structuredClone(runtime.outcome);
  const replayRequest = { profile: boundedProfile, count: 4, maxPeakTemporalBytes: 268435456, maxJsonBytes: 67108864 };
  const replay = runtime.replayTemporal(replayRequest);
  assert.deepEqual(replay.records, wasmRows.filter(row => row.accepted).map(row => row.outcome));
  for (const count of [Infinity, 5]) {
    assert.throws(() => runtime.replayTemporal({ ...replayRequest, count }), /positive u32|count|retained|checkpoint/i);
    assert.deepEqual(runtime.replay, replay);
    assert.deepEqual(runtime.outcome, live, 'unbounded or unavailable history never clamps or mutates execution');
  }
  assert.deepEqual(runtime.planTemporal({ profile: boundedProfile, maxJsonBytes: 65536 }), planned, 'elapsed sparse time does not expand statically bounded storage');
  // No checkpoint is supplied. A genuinely fresh owner follows the established
  // default startup policy; this is not foreign checkpoint restoration.
  const fresh = [{ scanId: 0, logicalTimeMs: 10, inputs: at(false, 2, 20) }];
  const freshNative = executeNative(fresh);
  const restarted = await FramedGhostFlowRuntime.instantiate(wasm);
  t.after(() => restarted.dispose());
  restarted.load(artifact.bytes);
  for (const output of artifact.manifest.outputs) restarted.addCapability('actuator', output.name, output.type === 'Bool' ? 'bool' : 'number');
  restarted.activateTemporal(boundedProfile);
  assert.deepEqual(freshNative[0].outcome, restarted.scan(fresh[0]));
  assert.ok(freshNative[0].outcome.trace.windowTrace.every(row => row.value === null && row.quality === 0 && row.count === 0));
  assert.equal(freshNative[0].outcome.trace.resultTrace.length, 4);
  assert.ok(freshNative[0].outcome.trace.resultTrace.every(row => row.choice === 4 && row.origin !== 0), 'explicit recovery keeps the original unavailable-window Result origin');
});

test('framed native adapters require one complete explicit temporal profile', async t => {
  const { directory, modulePath, tag, inputs } = await fixture(t);
  const csvPath = path.join(directory, 'frames.csv');
  const tapeInputPath = path.join(directory, 'frames.tsv');
  const values = inputs({ threshold: 1000, present: true, id: 1, timestamp: 1000, value: 280 });
  fs.writeFileSync(csvPath, `scan_id,logical_time_ms,${values.map(input => input.name).join(',')}\n0,1000,${values.map(input => input.value).join(',')}\n`);
  fs.writeFileSync(tapeInputPath, `${tapeRow(0, 1000, values)}\n`);
  for (const [executable, inputPath, usage] of [
    [adapterPath, csvPath, /usage: scan_adapter/],
    [tapePath, tapeInputPath, /usage: scan_tape/],
  ]) {
    for (const suffix of [
      ['--bogus'],
      ['--temporal', '5', '12', '33554432'],
      [...profileArgs(tag), ...profileArgs(tag)],
      ['--temporal', 'five', '12', '33554432', `${tag}:3:1000`],
      ['--temporal', '5', '12', '33554432', `${tag}:3`],
      ['--temporal', '5', '12', '33554432', `${tag}:3:1000,${tag}:3:1000`],
    ]) {
      const result = native(executable, [modulePath, inputPath, ...suffix]);
      assert.notEqual(result.status, 0, `${path.basename(executable)} ${suffix.join(' ')}`);
      assert.match(result.stderr, usage);
    }
    const missing = native(executable, [modulePath, inputPath]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /temporal activation requires runtime bindings/);
    const bounded = native(executable, [modulePath, inputPath, '--temporal', '5', '11', '33554432', `${tag}:3:1000`]);
    assert.notEqual(bounded.status, 0);
    assert.match(bounded.stderr, /temporal-budget-exceeded/);
  }
});

test('scan_tape evaluates all window operations and rolls back a late rate fault for same-frame retry', async t => {
  const { directory, modulePath, tag, inputs } = await fixture(t);
  const inputPath = path.join(directory, 'window.tsv');
  const frames = [
    [0, 1000, inputs({ threshold: 1000, present: true, id: 1, timestamp: 1000, value: 280 })],
    [1, 1400, inputs({ threshold: 0, present: true, id: 2, timestamp: 1400 })],
    [1, 1400, inputs({ threshold: 1000, present: true, id: 2, timestamp: 1400 })],
    [2, 2000, inputs({ threshold: 1000, present: false, id: 2, timestamp: 1400 })],
  ];
  fs.writeFileSync(inputPath, `${frames.map(frame => tapeRow(...frame)).join('\n')}\n`);
  const result = native(tapePath, [modulePath, inputPath, ...profileArgs(tag)]);
  assert.equal(result.status, 0, result.stderr);
  const rows = result.stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row => row.accepted), [true, false, true, true]);
  assert.equal(rows[1].error, 'division by zero');
  assert.deepEqual(rows[1].outcome, rows[0].outcome, 'rejected evaluation retains the prior framed outcome');
  assert.deepEqual(rows.filter(row => row.accepted).map(row => [row.outcome.scanId, row.outcome.trace.tick, row.outcome.trace.safe]), [
    [0, 1, { average: 280, minimum: 280, maximum: 280, fast: false }],
    [1, 2, { average: 282, minimum: 280, maximum: 284, fast: false }],
    [2, 3, { average: 284, minimum: 284, maximum: 284, fast: false }],
  ]);
  assert.deepEqual(rows[2].outcome.trace.windowTrace.map(entry => [entry.operation, entry.value, entry.count, entry.admissionRevision]), [
    ['average', 282, 2, 2], ['min', 280, 2, 2], ['max', 284, 2, 2], ['rate', 10, 2, 2],
  ]);
});

test('scan_adapter matches the absolute framed WASM outcomes under the same temporal epoch and frames', async t => {
  const { artifact, directory, modulePath, tag, inputs } = await fixture(t);
  const frames = [
    { scanId: 0, logicalTimeMs: 1000, inputs: inputs({ threshold: 1000, present: true, id: 1, timestamp: 1000, value: 280 }) },
    { scanId: 1, logicalTimeMs: 1400, inputs: inputs({ threshold: 1000, present: true, id: 2, timestamp: 1400 }) },
    { scanId: 2, logicalTimeMs: 2000, inputs: inputs({ threshold: 1000, present: false, id: 2, timestamp: 1400 }) },
  ];
  const inputPath = path.join(directory, 'window.csv');
  fs.writeFileSync(inputPath, [
    ['scan_id', 'logical_time_ms', ...frames[0].inputs.map(input => input.name)].join(','),
    ...frames.map(frame => [frame.scanId, frame.logicalTimeMs, ...frame.inputs.map(input => input.value)].join(',')),
  ].join('\n') + '\n');
  const result = native(adapterPath, [modulePath, inputPath, ...profileArgs(tag)]);
  assert.equal(result.status, 0, result.stderr);
  const nativeRows = result.stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(nativeRows.map(row => row.trace.safe), [
    { average: 280, minimum: 280, maximum: 280, fast: false },
    { average: 282, minimum: 280, maximum: 284, fast: false },
    { average: 284, minimum: 284, maximum: 284, fast: false },
  ]);
  const runtime = await FramedGhostFlowRuntime.instantiate(wasm);
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  for (const output of artifact.manifest.outputs) runtime.addCapability('actuator', output.name, output.type === 'Bool' ? 'bool' : 'number');
  runtime.activateTemporal(profile(tag));
  const wasmRows = frames.map(frame => runtime.scan(frame));
  assert.deepEqual(nativeRows, wasmRows.map(({ scanId, logicalTimeMs, trace }) => ({ scanId, logicalTimeMs, trace })),
    'native and WASM framed adapters must expose identical owned outcome fields');
});
