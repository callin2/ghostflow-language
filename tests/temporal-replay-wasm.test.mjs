import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const source = `# Temporal replay

\`\`\`ghost
control TemporalReplay {
  input divisor: Number;
  state retained_divisor: Number = 1.0;
  let scalar_divisor = case divisor { ok(value) => value; fault(_) => retained_divisor; };
  retained_divisor' = scalar_divisor;
  input probe: Number;
  signal inner = window_average(probe, over: 2ms, quality: measured, max_age: 2ms);
  signal outer = window_average(inner, over: 10ms, quality: measured, max_age: 10ms);
  output outer_value, ratio: Number;
  outer_value <- outer |> recover(-1.0);
  ratio <- 1.0 / scalar_divisor;
}
\`\`\`
`;
const clone = value => structuredClone(value);
const request = (profile, count, changes = {}) => ({
  count, profile, maxPeakTemporalBytes: 256 * 1024 * 1024, maxJsonBytes: 64 * 1024 * 1024, ...changes,
});

function generatedInputs(sensor, divisorSensor, { divisor, nowMs, id, value, present }) {
  return {
    [divisorSensor.valueInput]: divisor,
    [divisorSensor.okInput]: true,
    [divisorSensor.faultInput]: 0,
    [sensor.valueInput]: value,
    [sensor.okInput]: true,
    [sensor.faultInput]: 0,
    __gf_time_epoch: 5,
    [sensor.samplePresentInput]: present,
    [sensor.sampleEpochInput]: 5,
    [sensor.sampleIdInput]: id,
    [sensor.sampleTimestampInput]: nowMs,
  };
}

function frameInputs(values) {
  return Object.entries(values).map(([name, value]) => ({ name, value }));
}

async function harness(t, framed) {
  const artifact = await compileSource(source, { filename: 'temporal-replay.ghost.md' });
  const Runtime = framed ? FramedGhostFlowRuntime : GhostFlowRuntime;
  const runtime = await Runtime.instantiate(wasm);
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  runtime.addCapability('sensor', 'probe', 'number');
  runtime.addCapability('sensor', 'divisor', 'number');
  runtime.addCapability('actuator', 'outer_value', 'number');
  runtime.addCapability('actuator', 'ratio', 'number');
  const sourceTag = artifact.manifest.signals[0].sources[0].tag;
  const profile = {
    timeEpoch: 5,
    rootDensity: [{ sourceTag, maxObservations: 1, intervalMs: 1 }],
    budget: { maxRetainedSamples: 100, maxBytes: 64 * 1024 * 1024 },
  };
  runtime.activateTemporal(profile);
  const sensor = artifact.manifest.sensors.find(item => item.name === 'probe');
  const divisorSensor = artifact.manifest.sensors.find(item => item.name === 'divisor');
  const step = ({ scanId, nowMs, id, value, divisor = 1, present = true }) => {
    const values = generatedInputs(sensor, divisorSensor, { divisor, nowMs, id, value, present });
    if (framed) return runtime.scan({ scanId, logicalTimeMs: nowMs, inputs: frameInputs(values) });
    runtime.setNumber('__gf_now_ms', nowMs);
    for (const [name, input] of Object.entries(values)) {
      if (typeof input === 'boolean') runtime.setBool(name, input);
      else runtime.setNumber(name, input);
    }
    runtime.tick();
    return runtime.trace;
  };
  return { artifact, runtime, profile, sensor, divisorSensor, step };
}

for (const framed of [false, true]) test(`${framed ? 'framed' : 'legacy'} temporal replay preserves nested evidence, rollback and retained-prefix identity`, async t => {
  const { runtime, profile, sensor, divisorSensor, step } = await harness(t, framed);
  assert.equal(runtime.replay, null);
  const accepted = [
    clone(step({ scanId: 0, nowMs: 0, id: 1, value: 0 })),
    clone(step({ scanId: 1, nowMs: 1, id: 2, value: 10 })),
  ];
  const beforeFault = clone(framed ? runtime.outcome : runtime.trace);
  const journalBeforeFault = framed ? null : runtime.journalLength;
  assert.throws(() => step({ scanId: 2, nowMs: 2, id: 3, value: 20, divisor: 0 }), /division by zero/);
  assert.deepEqual(framed ? runtime.outcome : runtime.trace, beforeFault);
  if (!framed) assert.equal(runtime.journalLength, journalBeforeFault);
  const committed = step({ scanId: 2, nowMs: 2, id: 3, value: 20 });
  accepted.push(clone(committed));
  const committedTrace = framed ? committed.trace : committed;
  assert.equal(committedTrace.safe.outer_value, 20 / 3);

  if (!framed) {
    // Replay must not consume the already latched next-tick inputs.
    const values = generatedInputs(sensor, divisorSensor, { divisor: 2, nowMs: 3, id: 3, value: 20, present: false });
    runtime.setNumber('__gf_now_ms', 3);
    for (const [name, value] of Object.entries(values)) {
      if (typeof value === 'boolean') runtime.setBool(name, value); else runtime.setNumber(name, value);
    }
  }
  const liveBeforeReplay = clone(framed ? runtime.outcome : runtime.trace);
  const journalBeforeReplay = framed ? null : runtime.journalLength;
  const replay = runtime.replayTemporal(request(profile, 3));
  assert.deepEqual(runtime.replay, replay);
  assert.deepEqual(framed ? runtime.outcome : runtime.trace, liveBeforeReplay);
  if (!framed) assert.equal(runtime.journalLength, journalBeforeReplay);
  assert.equal(replay.format, 'GhostFlow/temporal-replay-v1');
  assert.equal(replay.mode, framed ? 'framed' : 'legacy');
  assert.equal(replay.checkpointTick, 0);
  assert.equal(replay.records.length, 3);
  assert.deepEqual(replay.records, accepted, 'replay reproduces every retained trace/outcome exactly');
  const replayTrace = record => framed ? record.trace : record;
  const last = replayTrace(replay.records[2]);
  assert.equal(last.safe.outer_value, 20 / 3);
  assert.equal(last.windowTrace[1].count, 3);
  assert.equal(last.windowTrace[1].admissionRevision, 3);
  assert.equal(last.windowTrace[1].proof.filter(point => point.kind === 'physical' && point.id === 3).length, 1);
  if (framed) assert.deepEqual(replay.records.map(record => [record.scanId, record.logicalTimeMs]), [[0, 0], [1, 1], [2, 2]]);

  for (const [label, invalid, diagnostic] of [
    ['count beyond retained prefix', request(profile, 4), /count|retained|checkpoint/i],
    ['incompatible profile', request({ ...profile, timeEpoch: 6 }, 3), /incompatible|epoch|binding/i],
    ['insufficient replay peak', request(profile, 3, { maxPeakTemporalBytes: 1 }), /budget/i],
    ['insufficient JSON budget', request(profile, 3, { maxJsonBytes: 1 }), /json|budget/i],
  ]) await t.test(label, () => {
    assert.throws(() => runtime.replayTemporal(invalid), diagnostic);
    assert.deepEqual(runtime.replay, replay, 'rejected replay preserves the prior successful replay');
    assert.deepEqual(framed ? runtime.outcome : runtime.trace, liveBeforeReplay, 'replay rejection preserves live outcome');
  });

  const fourth = framed
    ? step({ scanId: 3, nowMs: 3, id: 3, value: 20, divisor: 2, present: false })
    : (runtime.tick(), runtime.trace);
  assert.equal((framed ? fourth.trace : fourth).safe.ratio, 0.5);
  for (let index = 4; index <= 1024; index += 1) {
    step({ scanId: index, nowMs: index, id: 3, value: 20, present: false });
  }
  const oldest = runtime.replayTemporal(request(profile, 2));
  assert.equal(oldest.checkpointTick, 1);
  assert.deepEqual(oldest.records.map(record => replayTrace(record).tick), [2, 3], 'count selects the oldest retained prefix');
  assert.deepEqual(oldest.records, accepted.slice(1), 'rollover checkpoint retains the exact earlier evidence records');
  if (framed) assert.deepEqual(oldest.records.map(record => record.scanId), [1, 2]);
  const retained = runtime.replayTemporal(request(profile, 1024));
  assert.equal(retained.checkpointTick, 1);
  assert.equal(retained.records.length, 1024);
  assert.equal(replayTrace(retained.records[0]).tick, 2);
  assert.equal(replayTrace(retained.records.at(-1)).tick, 1025);
  if (framed) assert.deepEqual([retained.records[0].scanId, retained.records.at(-1).scanId], [1, 1024]);
  assert.throws(() => runtime.replayTemporal(request(profile, 1025)), /count|retained|checkpoint/i);
  assert.deepEqual(runtime.replay, retained, 'count is rejected rather than clamped and preserves the prior replay');
});

test('temporal replay request rejects non-exact fields and non-positive-u32 limits before native dispatch', async t => {
  const { runtime, profile } = await harness(t, false);
  const base = request(profile, 1);
  for (const [label, mutate, diagnostic] of [
    ['missing count', value => { delete value.count; }, /unknown or missing fields/],
    ['unexpected field', value => { value.extra = true; }, /unknown or missing fields/],
    ['zero count', value => { value.count = 0; }, /count must be a positive u32/],
    ['negative count', value => { value.count = -1; }, /count must be a positive u32/],
    ['fractional count', value => { value.count = 1.5; }, /count must be a positive u32/],
    ['NaN count', value => { value.count = Number.NaN; }, /count must be a positive u32/],
    ['infinite count', value => { value.count = Number.POSITIVE_INFINITY; }, /count must be a positive u32/],
    ['count overflow', value => { value.count = 0x1_0000_0000; }, /count must be a positive u32/],
    ['zero peak budget', value => { value.maxPeakTemporalBytes = 0; }, /maxPeakTemporalBytes must be a positive u32/],
    ['fractional peak budget', value => { value.maxPeakTemporalBytes = 1.5; }, /maxPeakTemporalBytes must be a positive u32/],
    ['NaN peak budget', value => { value.maxPeakTemporalBytes = Number.NaN; }, /maxPeakTemporalBytes must be a positive u32/],
    ['negative JSON budget', value => { value.maxJsonBytes = -1; }, /maxJsonBytes must be a positive u32/],
    ['infinite JSON budget', value => { value.maxJsonBytes = Number.POSITIVE_INFINITY; }, /maxJsonBytes must be a positive u32/],
    ['JSON budget overflow', value => { value.maxJsonBytes = 0x1_0000_0000; }, /maxJsonBytes must be a positive u32/],
    ['symbol field', value => { value[Symbol('extra')] = true; }, /unknown or missing fields/],
    ['invalid profile', value => { value.profile.rootDensity[0].intervalMs = 0; }, /intervalMs must be an integer/],
  ]) await t.test(label, () => {
    const value = clone(base); mutate(value);
    assert.throws(() => runtime.replayTemporal(value), diagnostic);
    assert.equal(runtime.replay, null);
  });
});
