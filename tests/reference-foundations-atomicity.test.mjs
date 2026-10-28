import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from './helpers/literate-compile.mjs';
import { pidSaturationSource } from './helpers/pid-saturation-input-vectors.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const activation = { bootEpoch: 1, terminalCapacity: 16, bindings: [] };
const facts = (nowMs, settings = null) => ({
  clock: { monotonicMs: nowMs, bootEpoch: 1, wallMs: null, uncertaintyMs: null,
    trusted: false, unknownReason: 'atomicity test uses only monotonic time', sourceRevision: null },
  natural: [], schedules: [], settings,
});
const reading = (id, timestampMs, value) => ({ epoch: 1, id, timestampMs, value, quality: 'Good' });
const change = (configId, type, value) => ({ configId, result: { ok: true, type, value } });
const event = (programFingerprint, eventId, baseRevision, position, changes) => ({
  programFingerprint, eventId, baseRevision, position, origin: 'operatorEdit', changes,
});

async function execute(t, artifact, attempts) {
  const legacy = (artifact.manifest.objectives?.length ?? 0) > 0;
  const instantiate = legacy ? ControlRuntime.instantiate : ControlRuntime.instantiateFramed;
  const runtime = await instantiate.call(ControlRuntime, wasm, artifact, { context: activation });
  t.after(() => runtime.dispose());
  const frames = [];
  if (legacy) {
    const inputs = new Map();
    for (const method of ['setBool', 'setNumber', 'setInt']) {
      const set = runtime.runtime[method].bind(runtime.runtime);
      runtime.runtime[method] = (name, value) => { inputs.set(name, value); return set(name, value); };
    }
    const tick = runtime.runtime.tickContext.bind(runtime.runtime);
    let scanId = 0;
    runtime.runtime.tickContext = contextFacts => {
      frames.push({ scanId, logicalTimeMs: contextFacts.clock.monotonicMs,
        inputs: [...inputs].filter(([name]) => !['__gf_now_ms', '__gf_time_epoch'].includes(name)).map(([name, value]) => ({ name, value })),
        ...structuredClone(contextFacts) });
      const result = tick(contextFacts);
      scanId++;
      return result;
    };
  } else {
    const dispatch = runtime.runtime.dispatchContext.bind(runtime.runtime);
    runtime.runtime.dispatchContext = (frame, contextFacts) => {
      frames.push({ ...structuredClone(frame), ...structuredClone(contextFacts) });
      return dispatch(frame, contextFacts);
    };
  }
  const fingerprint = runtime.contextSnapshot().state.programFingerprint;
  const ids = Object.fromEntries(artifact.manifest.configs.map(config => [config.name, config.id]));
  const rows = [];
  let outcome = null;
  for (const attempt of attempts) {
    const request = attempt({ fingerprint, ids });
    let accepted = true, error = null, result = null;
    try { result = runtime.step(request); }
    catch (failure) { accepted = false; error = failure.message; }
    if (accepted) outcome = legacy ? { format: 'GhostFlow/scan-outcome-v1', scanId: frames.at(-1).scanId,
      logicalTimeMs: request.nowMs, trace: result.vm } : runtime.lastFrameOutcome;
    const snapshot = runtime.contextSnapshot();
    rows.push({ accepted, error, result, outcome: structuredClone(outcome),
      settings: snapshot.state, checkpoint: Buffer.from(snapshot.bytes).toString('hex'),
      lastNowMs: runtime.lastNowMs,
      identities: Object.fromEntries([...runtime.sensors].map(([name, sensor]) => [name, sensor.conditioner.sampleIdentity()])),
    });
  }
  assert.equal(frames.length, attempts.length, 'each attempt reached the actual Rust scan boundary');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-foundations-atomicity-'));
  try {
    const modulePath = path.join(directory, 'module.gfb');
    const tapePath = path.join(directory, 'tape.json');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-v1', activation, steps: frames }));
    const native = spawnSync(path.join(root, 'target/release/examples/context_tape'), [modulePath, tapePath],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(native.status, 0, native.stderr || native.stdout);
    const nativeRows = native.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(nativeRows.length, rows.length);
    rows.forEach((row, index) => {
      const other = nativeRows[index];
      assert.equal(other.accepted, row.accepted, `native/WASM acceptance ${index}`);
      assert.deepEqual(other.accepted ? other.outcome : other.lastOutcome, row.outcome, `native/WASM outcome ${index}`);
      assert.deepEqual(other.settings, row.settings, `native/WASM settings ${index}`);
      assert.equal(other.checkpoint, row.checkpoint, `native/WASM checkpoint ${index}`);
    });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  return rows;
}

function unchanged(before, rejected) {
  assert.equal(rejected.accepted, false);
  assert.deepEqual(rejected.outcome, before.outcome);
  assert.deepEqual(rejected.settings, before.settings);
  assert.equal(rejected.checkpoint, before.checkpoint);
  assert.equal(rejected.lastNowMs, before.lastNowMs);
  assert.deepEqual(rejected.identities, before.identities);
}

test('REF-04-065 compiler rejects mixed quantities, implicit Result arithmetic and unbounded temporal horizons', async () => {
  const invalid = [
    [`control MixedQuantity {
      input pressure: Pressure; input flow: FlowRate;
      output value: Pressure;
      value <- (pressure |> recover(1Pa)) + (flow |> recover(1L/min));
    }`, /\+ is not defined for Pressure and FlowRate/],
    [`control ImplicitResult {
      input pressure: Pressure;
      output value: Pressure;
      value <- pressure + 1Pa;
    }`, /Result|unwrap|case/],
    [`control ResultTruthiness {
      input enabled: Bool;
      output value: Bool;
      value <- if enabled then true else false;
    }`, /Result|Bool/],
    [`control MissingHorizon {
      input pressure: Pressure;
      signal average = window_average(pressure, quality: measured, max_age: 1s);
    }`, /over|required/],
    [`control DynamicHorizon {
      input pressure: Pressure; input horizon: Duration;
      signal average = window_average(pressure, over: horizon |> recover(1s), quality: measured, max_age: 1s);
    }`, /constant Duration/],
    [`control UnboundedFilter {
      input pressure: Pressure { filter = moving_average(0); }
    }`, /window|1.*31|positive/],
  ];
  for (const [source, diagnostic] of invalid) await assert.rejects(compileSource(source), diagnostic);
  const valid = await compileSource(`control BoundedPressure {
    input pressure: Pressure { filter = moving_average(3); }
    signal average = window_average(pressure, over: 1s, quality: measured, max_age: 1s);
    output value: Pressure;
    value <- average |> recover(1Pa);
  }`);
  assert.equal(valid.manifest.sensors[0].window, 3);
  assert.equal(valid.manifest.signals[0].overMs, 1000);
});

test('REF-04-065 native WASM failed scalar tick preserves sensor, state, settings and same-identity retry', async t => {
  const artifact = await compileSource(`control AtomicScalar {
    input level: Number;
    input divisor: Number;
    config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; }
    state count: Int = 0;
    count' = count + 1;
    output average, quotient: Number;
    output duration_ms: Duration;
    average <- level |> recover(-1.0);
    quotient <- 1.0 / (divisor |> recover(0.0));
    duration_ms <- duration |> recover(0ms);
  }`);
  const baseline = () => ({ nowMs: 0, samples: { level: reading(1, 0, 10), divisor: reading(1, 0, 1) }, contextFacts: facts(0) });
  const retry = ({ fingerprint, ids }) => ({ nowMs: 10, samples: { level: reading(2, 10, 30), divisor: reading(2, 10, 1) },
    contextFacts: facts(10, event(fingerprint, 'scalar-retry', 0, 2, [change(ids.duration, 'Duration', 600_000)])) });
  const rows = await execute(t, artifact, [baseline, context => ({ ...retry(context),
    samples: { level: reading(2, 10, 999), divisor: reading(2, 10, 0) } }), retry]);
  assert.deepEqual(rows[0].identities.level, { epoch: 1, id: 1, timestampMs: 0 });
  unchanged(rows[0], rows[1]);
  assert.match(rows[1].error, /division by zero/);
  assert.equal(rows[2].result.vm.safe.average, 30);
  assert.equal(rows[2].result.vm.stateAfter.count, 2);
  assert.equal(rows[2].settings.settingsRevision, 1);
  assert.equal(rows[2].result.vm.safe.duration_ms, 600_000);
  const clean = await execute(t, artifact, [baseline, retry]);
  assert.deepEqual(rows[2].outcome, clean[1].outcome);
  assert.equal(rows[2].checkpoint, clean[1].checkpoint);
});

test('REF-04-065 native WASM PID failure preserves controller, sensor and pending settings candidate', async t => {
  const artifact = await compileSource(pidSaturationSource);
  const baseline = () => ({ nowMs: 0, samples: { inside_temperature: reading(1, 0, 303.15) }, contextFacts: facts(0) });
  const proposal = ({ fingerprint, ids }, nowMs, value) => ({ nowMs,
    samples: { inside_temperature: reading(2, nowMs, value) },
    contextFacts: facts(nowMs, event(fingerprint, 'pid-retry', 0, 2, [change(ids.target_temperature, 'Temperature', 299.15)])),
  });
  const retry = context => proposal(context, 10_000, 303.15);
  const rows = await execute(t, artifact, [baseline, context => proposal(context, Number.MAX_SAFE_INTEGER, 333.15), retry]);
  assert.deepEqual(rows[0].identities.inside_temperature, { epoch: 1, id: 1, timestampMs: 0 });
  unchanged(rows[0], rows[1]);
  assert.match(rows[1].error, /PID deadline is out of range/);
  assert.equal(rows[2].result.sensors.inside_temperature.value, 303.15);
  assert.equal(rows[2].settings.settingsRevision, 1);
  assert.equal(rows[0].result.vm.safe['roof_vent.position'], 92);
  assert.equal(rows[2].result.vm.safe['roof_vent.position'], 94.5);
  const clean = await execute(t, artifact, [baseline, retry]);
  assert.deepEqual(rows[2].outcome, clean[1].outcome);
  assert.equal(rows[2].checkpoint, clean[1].checkpoint);
});

test('REF-05-013 current contract atomically emits SettingsInvalid for every target once on native WASM', async t => {
  const artifact = await compileSource(`control AtomicSettings {
    config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; }
    config duty: Percent = 50% { min = 0%; max = 100%; step = 1%; access = operator; }
    config unrelated: Bool = true { access = operator; }
    output duration_ms: Duration; output duty_value: Percent; output untouched: Bool;
    duration_ms <- duration |> recover(0ms);
    duty_value <- duty |> recover(0%);
    untouched <- unrelated |> recover(false);
  }`);
  const invalid = ({ fingerprint, ids }) => ({ nowMs: 1, contextFacts: facts(1,
    event(fingerprint, 'invalid-pair', 0, 2, [change(ids.duration, 'Duration', 600_000), change(ids.duty, 'Percent', 110)])) });
  const rows = await execute(t, artifact, [() => ({ nowMs: 0, contextFacts: facts(0) }), invalid, invalid,
    ({ fingerprint, ids }) => ({ nowMs: 2, contextFacts: facts(2,
      event(fingerprint, 'valid-pair', 1, 3, [change(ids.duration, 'Duration', 600_000), change(ids.duty, 'Percent', 60)])) }),
  ]);
  assert.deepEqual(rows.map(row => row.accepted), [true, true, false, true]);
  const before = Object.fromEntries(rows[0].settings.settings.map(setting => [setting.name, setting]));
  const faulted = Object.fromEntries(rows[1].settings.settings.map(setting => [setting.name, setting]));
  assert.deepEqual(before.duration.result, { ok: true, value: 300_000 });
  assert.deepEqual(before.duty.result, { ok: true, value: 50 });
  for (const name of ['duration', 'duty']) {
    assert.deepEqual(faulted[name].result, { ok: false, fault: 'SettingsInvalid' });
    assert.equal(faulted[name].emissionRevision, 1);
    assert.equal(faulted[name].applicationPosition, 2);
  }
  assert.equal(rows[1].settings.settingsRevision, 1);
  assert.deepEqual(faulted.unrelated, before.unrelated);
  assert.deepEqual(rows[1].result.vm.safe, { duration_ms: 0, duty_value: 0, untouched: true });
  assert.ok(rows[1].outcome.trace.contextTrace.some(observation => observation.decision === 'SettingsPayloadInvalid'
    && observation.contextRevision === 'duty'));
  unchanged(rows[1], rows[2]);
  assert.equal(rows[3].settings.settingsRevision, 2);
  assert.deepEqual(rows[3].result.vm.safe, { duration_ms: 600_000, duty_value: 60, untouched: true });
  const recovered = Object.fromEntries(rows[3].settings.settings.map(setting => [setting.name, setting]));
  for (const name of ['duration', 'duty']) {
    assert.equal(recovered[name].emissionRevision, 2);
    assert.equal(recovered[name].applicationPosition, 3);
  }
  assert.deepEqual(recovered.unrelated, before.unrelated);
});
