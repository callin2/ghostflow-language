import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const source = `# Temporal resource plan

\`\`\`ghost
control TemporalResourcePlan {
  sensor probe: Number;
  signal inner = window_average(probe, over: 2ms, quality: measured, max_age: 2ms);
  signal outer = window_average(inner, over: 10ms, quality: measured, max_age: 10ms);
  output value: Number;
  value <- outer |> recover(-1.0);
}
\`\`\`
`;
const MAX_JSON_BYTES = 1024 * 1024;

// Independently reviewed wasm32 type widths from the target compiler layout.
// This oracle applies the public storage geometry to this fixed two-window source;
// it does not read a successful plan or search for an accepted budget.
const WIDTH = Object.freeze({
  Window: 416, WindowCheckpoint: 232, RootDensity: 16, RootState: 56, Observation: 40,
  EvidenceWindow: 936, EvidenceCheckpoint: 512, EvidencePoint: 64, ProofNode: 72,
  TemporalRuntime: 120, TemporalPlan: 64, WindowPlan: 32, Slot: 952, Snapshot: 48,
  WindowTrace: 224, Value: 16, ResultTraceEvent: 12, RootInput: 40, Vec: 12, ScanOutcome: 200,
});

function windowGeometry(overMs, upstream = [], prior = []) {
  const horizon = overMs + Math.max(0, ...upstream.map(index => prior[index].horizon));
  const physicalCapacity = overMs; // one observation per 1ms interval
  const capacity = horizon;
  const proofPerEntry = Math.max(0, ...upstream.map(index =>
    1 + prior[index].capacity * Math.max(1, prior[index].proofPerEntry)));
  const proofNodes = capacity * proofPerEntry;
  const physicalBank = WIDTH.RootState + physicalCapacity * WIDTH.Observation + 8;
  const physicalEngine = WIDTH.Window + WIDTH.RootDensity + 2 * physicalBank;
  const physicalCheckpoint = WIDTH.WindowCheckpoint + WIDTH.RootDensity + physicalBank;
  const evidenceBank = capacity * WIDTH.EvidencePoint + proofNodes * WIDTH.ProofNode + upstream.length * 8;
  return {
    horizon, capacity, proofPerEntry, proofNodes,
    engine: WIDTH.EvidenceWindow + physicalEngine - WIDTH.Window + upstream.length * 4 + 2 * evidenceBank,
    checkpoint: WIDTH.EvidenceCheckpoint + physicalCheckpoint - WIDTH.WindowCheckpoint + upstream.length * 4 + evidenceBank,
    scratch: WIDTH.RootDensity + upstream.length * 4,
  };
}

function temporalBytes(journalCapacity) {
  const windows = [];
  windows.push(windowGeometry(2, [], windows));
  windows.push(windowGeometry(10, [0], windows));
  const count = windows.length;
  const retainedSamples = windows.reduce((total, window) => total + window.capacity, 0);
  const proofNodes = windows.reduce((total, window) => total + window.proofNodes, 0);
  const checkpoints = journalCapacity + 1;
  const bytes = WIDTH.TemporalRuntime + WIDTH.TemporalPlan + count * WIDTH.WindowPlan
    + Buffer.byteLength('control')
    + count * (WIDTH.Slot + 8 * WIDTH.Value)
    + checkpoints * WIDTH.Snapshot
    + WIDTH.RootDensity
    + checkpoints * (WIDTH.Vec + WIDTH.ResultTraceEvent) // one recover trace marker
    + windows.reduce((total, window) => total + window.engine - WIDTH.EvidenceWindow
      + WIDTH.RootInput + checkpoints * window.checkpoint, 0)
    + Math.max(...windows.map(window => window.scratch))
    + checkpoints * (WIDTH.Vec + count * WIDTH.WindowTrace
      + retainedSamples * WIDTH.EvidencePoint + proofNodes * WIDTH.ProofNode);
  return { retainedSamples, bytes };
}

const LIVE_ORACLE = temporalBytes(1024);
const REPLAY_ORACLE = temporalBytes(3);
const LEGACY_REPLAY_PEAK = LIVE_ORACLE.bytes + REPLAY_ORACLE.bytes + 3 * 24;
// Independent wasm32 compiler probing measures ScanOutcomeV1 at 200 bytes:
// the resource trace Vec adds 12 bytes and absorbs 4 bytes of prior padding.
const FRAMED_REPLAY_PEAK = LEGACY_REPLAY_PEAK + 3 * WIDTH.ScanOutcome;

function profile(sourceTag, changes = {}) {
  return {
    timeEpoch: 5,
    rootDensity: [{ sourceTag, maxObservations: 1, intervalMs: 1 }],
    budget: { maxRetainedSamples: 100, maxBytes: 64 * 1024 * 1024 },
    ...changes,
  };
}

async function harness(t, framed) {
  const artifact = await compileSource(source, { filename: 'temporal-resource-plan.ghost.md' });
  const Runtime = framed ? FramedGhostFlowRuntime : GhostFlowRuntime;
  const runtime = await Runtime.instantiate(wasm);
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  runtime.addCapability('sensor', 'probe', 'number');
  runtime.addCapability('actuator', 'value', 'number');
  const sensor = artifact.manifest.sensors[0];
  const sourceTag = artifact.manifest.signals[0].sources[0].tag;
  return { runtime, sensor, temporalProfile: profile(sourceTag) };
}

function setLegacyInputs(runtime, sensor, nowMs, id, value) {
  runtime.setNumber('__gf_now_ms', nowMs);
  runtime.setNumber('__gf_time_epoch', 5);
  runtime.setNumber(sensor.valueInput, value);
  runtime.setBool(sensor.okInput, true);
  runtime.setNumber(sensor.faultInput, 0);
  runtime.setBool(sensor.samplePresentInput, true);
  runtime.setNumber(sensor.sampleEpochInput, 5);
  runtime.setNumber(sensor.sampleIdInput, id);
  runtime.setNumber(sensor.sampleTimestampInput, nowMs);
}

function frameInputs(sensor, nowMs, id, value) {
  return [
    { name: sensor.valueInput, value },
    { name: sensor.okInput, value: true },
    { name: sensor.faultInput, value: 0 },
    { name: '__gf_time_epoch', value: 5 },
    { name: sensor.samplePresentInput, value: true },
    { name: sensor.sampleEpochInput, value: 5 },
    { name: sensor.sampleIdInput, value: id },
    { name: sensor.sampleTimestampInput, value: nowMs },
  ];
}

for (const framed of [false, true]) test(`${framed ? 'framed' : 'legacy'} static temporal plans are available before activation and preserve the live handle`, async t => {
  const { runtime, temporalProfile } = await harness(t, framed);
  assert.equal(runtime.resourcePlan, null);
  if (!framed) assert.equal(runtime.journalLength, 0);
  else assert.equal(runtime.outcome, null);

  const insufficient = structuredClone(temporalProfile);
  insufficient.budget = { maxRetainedSamples: 1, maxBytes: 1 };
  const planned = runtime.planTemporal({ profile: insufficient, maxJsonBytes: MAX_JSON_BYTES });
  assert.deepEqual(runtime.resourcePlan, planned);
  assert.equal(planned.format, 'GhostFlow/temporal-resources-v1');
  assert.match(planned.module, /^[0-9a-f]{16}$/);
  assert.equal(planned.strategy, 'control');
  assert.equal(planned.targetPointerBytes, 4);
  assert.equal(planned.journalCapacity, 1024);
  assert.equal(planned.windowCount, 2);
  assert.ok(planned.retainedSamples > 1);
  assert.ok(planned.accountedTemporalBytes > 1);
  assert.equal(planned.fitsBudget, false);
  if (!framed) assert.equal(runtime.journalLength, 0);
  else assert.equal(runtime.outcome, null);
});

for (const framed of [false, true]) test(`${framed ? 'framed' : 'legacy'} exact wasm32 sample and byte plans match activation boundaries`, async t => {
  const { runtime, temporalProfile } = await harness(t, framed);
  const exact = structuredClone(temporalProfile);
  exact.budget = { maxRetainedSamples: LIVE_ORACLE.retainedSamples, maxBytes: LIVE_ORACLE.bytes };
  const report = runtime.planTemporal({ profile: exact, maxJsonBytes: MAX_JSON_BYTES });
  assert.equal(report.retainedSamples, LIVE_ORACLE.retainedSamples);
  assert.equal(report.accountedTemporalBytes, LIVE_ORACLE.bytes);
  assert.equal(report.fitsBudget, true);

  const tooFewSamples = structuredClone(exact);
  tooFewSamples.budget.maxRetainedSamples -= 1;
  assert.equal(runtime.planTemporal({ profile: tooFewSamples, maxJsonBytes: MAX_JSON_BYTES }).fitsBudget, false);
  assert.throws(() => runtime.activateTemporal(tooFewSamples), /temporal-budget-exceeded/);

  const oneByteShort = structuredClone(exact);
  oneByteShort.budget.maxBytes -= 1;
  assert.equal(runtime.planTemporal({ profile: oneByteShort, maxJsonBytes: MAX_JSON_BYTES }).fitsBudget, false);
  assert.throws(() => runtime.activateTemporal(oneByteShort), /temporal-budget-exceeded/);
  runtime.activateTemporal(exact);
});

test('temporal plan requests reject non-exact fields and invalid bounds before native dispatch', async t => {
  const { runtime, temporalProfile } = await harness(t, false);
  const valid = { profile: temporalProfile, maxJsonBytes: MAX_JSON_BYTES };
  for (const [label, mutate, diagnostic] of [
    ['missing profile', value => { delete value.profile; }, /temporal plan request has unknown or missing fields/],
    ['unexpected field', value => { value.extra = true; }, /temporal plan request has unknown or missing fields/],
    ['symbol field', value => { value[Symbol('extra')] = true; }, /temporal plan request has unknown or missing fields/],
    ['zero JSON budget', value => { value.maxJsonBytes = 0; }, /maxJsonBytes must be a positive u32/],
    ['fractional JSON budget', value => { value.maxJsonBytes = 1.5; }, /maxJsonBytes must be a positive u32/],
    ['NaN JSON budget', value => { value.maxJsonBytes = Number.NaN; }, /maxJsonBytes must be a positive u32/],
    ['infinite JSON budget', value => { value.maxJsonBytes = Infinity; }, /maxJsonBytes must be a positive u32/],
    ['overflow JSON budget', value => { value.maxJsonBytes = 0x1_0000_0000; }, /maxJsonBytes must be a positive u32/],
    ['invalid profile', value => { value.profile.rootDensity[0].intervalMs = 0; }, /intervalMs must be an integer/],
  ]) await t.test(label, () => {
    const request = structuredClone(valid); mutate(request);
    assert.throws(() => runtime.planTemporal(request), diagnostic);
    assert.equal(runtime.resourcePlan, null);
  });
  for (const [label, count] of [['zero', 0], ['negative', -1], ['fractional', 1.5], ['NaN', NaN], ['infinite', Infinity], ['overflow', 0x1_0000_0000]]) {
    await t.test(`${label} replay count`, () => {
      assert.throws(() => runtime.planTemporalReplay({ count, profile: temporalProfile, maxJsonBytes: MAX_JSON_BYTES }), /count must be a positive u32/);
      assert.equal(runtime.resourcePlan, null);
    });
  }
});

for (const framed of [false, true]) test(`${framed ? 'framed' : 'legacy'} replay planning preserves live execution and prior replay and plan buffers`, async t => {
  const { runtime, sensor, temporalProfile } = await harness(t, framed);
  temporalProfile.budget = { maxRetainedSamples: LIVE_ORACLE.retainedSamples, maxBytes: LIVE_ORACLE.bytes };
  runtime.activateTemporal(temporalProfile);
  for (let index = 0; index < 3; index += 1) {
    if (framed) runtime.scan({ scanId: index, logicalTimeMs: index, inputs: frameInputs(sensor, index, index + 1, index * 10) });
    else { setLegacyInputs(runtime, sensor, index, index + 1, index * 10); runtime.tick(); }
  }
  const live = structuredClone(framed ? runtime.outcome : runtime.trace);
  const activationPlan = runtime.planTemporal({ profile: temporalProfile, maxJsonBytes: MAX_JSON_BYTES });
  const replayPlan = runtime.planTemporalReplay({ count: 3, profile: temporalProfile, maxJsonBytes: MAX_JSON_BYTES });
  assert.deepEqual(runtime.resourcePlan, replayPlan);
  assert.equal(replayPlan.format, 'GhostFlow/temporal-replay-resources-v1');
  assert.equal(replayPlan.module, activationPlan.module);
  assert.equal(replayPlan.strategy, activationPlan.strategy);
  assert.equal(replayPlan.targetPointerBytes, 4);
  assert.equal(replayPlan.eligibleCount, 3);
  assert.equal(replayPlan.count, 3);
  assert.equal(replayPlan.liveBytes, activationPlan.accountedTemporalBytes);
  assert.equal(replayPlan.ghostBytes, REPLAY_ORACLE.bytes);
  assert.equal(replayPlan.returnHeaderBytes, 3 * 24);
  assert.equal(replayPlan.frameHeaderBytes, framed ? 3 * WIDTH.ScanOutcome : 0);
  const replayPeak = framed ? FRAMED_REPLAY_PEAK : LEGACY_REPLAY_PEAK;
  assert.equal(replayPlan.requiredPeakTemporalBytes, replayPeak);
  assert.equal(replayPlan.ghostFitsBudget, true);
  assert.deepEqual(framed ? runtime.outcome : runtime.trace, live);

  assert.throws(() => runtime.replayTemporal({ count: 3, profile: temporalProfile,
    maxPeakTemporalBytes: replayPeak - 1, maxJsonBytes: MAX_JSON_BYTES }), /temporal-budget-exceeded/);
  assert.equal(runtime.replay, null);
  assert.deepEqual(runtime.resourcePlan, replayPlan);
  const replay = runtime.replayTemporal({ count: 3, profile: temporalProfile,
    maxPeakTemporalBytes: replayPeak, maxJsonBytes: MAX_JSON_BYTES });
  assert.deepEqual(runtime.replay, replay);
  assert.deepEqual(framed ? runtime.outcome : runtime.trace, live);

  assert.throws(() => runtime.planTemporalReplay({ count: 4, profile: temporalProfile, maxJsonBytes: MAX_JSON_BYTES }), /count|retained|checkpoint/i);
  assert.deepEqual(runtime.resourcePlan, replayPlan);
  assert.deepEqual(framed ? runtime.outcome : runtime.trace, live);
  assert.deepEqual(runtime.replay, replay);

  const incompatible = structuredClone(temporalProfile);
  incompatible.timeEpoch += 1;
  assert.throws(() => runtime.planTemporalReplay({ count: 3, profile: incompatible, maxJsonBytes: MAX_JSON_BYTES }), /incompatible|epoch|binding/i);
  assert.deepEqual(runtime.resourcePlan, replayPlan);
  assert.deepEqual(framed ? runtime.outcome : runtime.trace, live);
  assert.deepEqual(runtime.replay, replay);

  assert.throws(() => runtime.planTemporal({ profile: temporalProfile, maxJsonBytes: 1 }), /json|budget/i);
  assert.deepEqual(runtime.resourcePlan, replayPlan);
  assert.deepEqual(framed ? runtime.outcome : runtime.trace, live);
  assert.deepEqual(runtime.replay, replay);
});
