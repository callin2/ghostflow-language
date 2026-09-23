import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileSource } from './helpers/literate-compile.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));

test('debounce observes raw Bool once per committed scan and promotes at the exact duration boundary', async () => {
  const compiled = await compileSource(`control RawDebounce {
    input start: Bool;
    signal stable_start = debounce(start, stable_for: 2s, initial: false);
    output stable: Bool;
    stable <- stable_start;
  }`, { filename: 'raw-debounce.ghost' });
  assert.deepEqual(compiled.manifest.signals, [{
    kind: 'debounce', name: 'stable_start', payloadType: 'Bool', errorType: null,
    sourceMode: 'scan', stableForMs: 2000, initial: false, clockInput: '__gf_now_ms', sources: [],
    states: {
      stable: '__gf_debounce_stable_stable_start',
      candidate: '__gf_debounce_candidate_stable_start',
      candidateActive: '__gf_debounce_candidate_active_stable_start',
      candidateSince: '__gf_debounce_candidate_since_stable_start',
      lastSourceTag: '__gf_debounce_last_source_tag_stable_start',
    },
  }]);
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  try {
    for (const [nowMs, start, stable] of [
      [0, false, false],
      [100, true, false],
      [2099, true, false],
      [2100, true, true],
    ]) {
      const result = runtime.step({ nowMs, inputs: { start } });
      assert.equal(result.vm.safe.stable, stable, `logical time ${nowMs}`);
    }
  } finally { runtime.dispose(); }
});

test('an opposite raw observation at the old candidate threshold cancels instead of promoting', async () => {
  const compiled = await compileSource(`control ThresholdFlip {
    input start: Bool;
    signal stable_start = debounce(start, stable_for: 1s, initial: false);
    output stable: Bool;
    stable <- stable_start;
  }`, { filename: 'threshold-flip.ghost' });
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  try {
    assert.equal(runtime.step({ nowMs: 0, inputs: { start: true } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 1000, inputs: { start: false } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 1001, inputs: { start: true } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 2001, inputs: { start: true } }).vm.safe.stable, true);
  } finally { runtime.dispose(); }
});

test('Result debounce uses fresh physical sample identity, preserves faults, and resets on source epoch changes', async () => {
  const compiled = await compileSource(`control SampleDebounce {
    sensor start: Bool { stale_after = 10s; }
    signal stable_start = debounce(start, stable_for: 2s, initial: false);
    output stable: Bool;
    stable <- stable_start |> recover(false);
  }`, { filename: 'sample-debounce.ghost' });
  const sensor = compiled.manifest.sensors[0];
  assert.deepEqual({
    present: sensor.samplePresentInput, epoch: sensor.sampleEpochInput,
    id: sensor.sampleIdInput, timestamp: sensor.sampleTimestampInput,
  }, {
    present: '__gf_sensor_sample_present_start', epoch: '__gf_sensor_sample_epoch_start',
    id: '__gf_sensor_sample_id_start', timestamp: '__gf_sensor_sample_timestamp_start',
  });
  const sourceTag = compiled.sourceMap.find(node => node.kind === 'sensor').id;
  assert.deepEqual(compiled.manifest.signals[0].sources, [{
    name: 'start', tag: sourceTag,
    states: {
      lastEpoch: `__gf_debounce_source_epoch_stable_start_${sourceTag}`,
      lastId: `__gf_debounce_source_id_stable_start_${sourceTag}`,
    },
  }]);
  assert.equal(compiled.manifest.signals[0].errorType, 'SensorFault');
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  const physical = (epoch, id, timestampMs, value, quality = 'Good') => ({ epoch, id, timestampMs, value, quality });
  try {
    const step = (nowMs, sample) => runtime.step({ nowMs, samples: sample ? { start: sample } : {} });
    assert.equal(step(0, physical(1, 1, 0, false)).vm.safe.stable, false);
    assert.equal(step(100, physical(1, 2, 100, true)).vm.safe.stable, false);
    assert.equal(step(2100, physical(1, 2, 2100, true)).vm.safe.stable, false, 'same epoch/id is not fresh even with a forged timestamp');
    assert.equal(step(2100, physical(1, 3, 2100, true)).vm.safe.stable, true, 'fresh sample promotes at the exact sample-time boundary');
    assert.equal(step(2150).vm.safe.stable, true, 'an absent sample before stale does not reset or advance stable state');

    const fault = step(2200, physical(1, 4, 2200, false, 'Disconnected'));
    assert.equal(fault.vm.safe.stable, false);
    assert.equal(fault.vm.resultTrace.at(-1).choice, 1, 'Disconnected survives debounce into explicit recover');
    assert.equal(fault.vm.stateAfter.__gf_debounce_stable_stable_start, false);
    const repeatedFault = step(2250, physical(1, 4, 2250, true, 'Good'));
    assert.equal(repeatedFault.vm.resultTrace.at(-1).choice, 1, 'a repeated tuple cannot replace the accepted fault identity');
    assert.equal(repeatedFault.vm.stateAfter[compiled.manifest.signals[0].sources[0].states.lastId], 4);

    assert.equal(step(2300, physical(1, 5, 2300, true)).vm.safe.stable, false);
    assert.equal(step(4300, physical(1, 6, 4300, true)).vm.safe.stable, true);
    assert.equal(step(4400, physical(2, 1, 4400, true)).vm.safe.stable, false, 'new epoch resets stable state and continuity');
    assert.equal(step(6400).vm.safe.stable, false, 'empty ticks do not promote a physical candidate');
    assert.equal(step(6400, physical(2, 2, 6400, true)).vm.safe.stable, true);
  } finally { runtime.dispose(); }
});

test('debounce supports raw and Result finite enums with canonical ordered member metadata', async () => {
  const raw = await compileSource(`control RawEnumDebounce {
    type Mode = Idle | Run;
    input request: Bool;
    let observed = if request then Run else Idle;
    signal stable_mode = debounce(observed, stable_for: 1s, initial: Idle);
    output running: Bool;
    running <- stable_mode == Run;
  }`, { filename: 'raw-enum-debounce.ghost' });
  assert.deepEqual(raw.manifest.signals[0].members, ['Idle', 'Run']);
  assert.equal(raw.manifest.signals[0].initial, 0);
  const rawRuntime = await ControlRuntime.instantiate(wasm, raw);
  try {
    assert.equal(rawRuntime.step({ nowMs: 0, inputs: { request: true } }).vm.safe.running, false);
    assert.equal(rawRuntime.step({ nowMs: 999, inputs: { request: true } }).vm.safe.running, false);
    assert.equal(rawRuntime.step({ nowMs: 1000, inputs: { request: true } }).vm.safe.running, true);
  } finally { rawRuntime.dispose(); }

  const result = await compileSource(`fn mode(value: Bool) -> Mode { if value then Run else Idle }
  control ResultEnumDebounce {
    type Mode = Idle | Run;
    sensor request: Bool { stale_after = 10s; }
    signal stable_mode = debounce(request |> map(mode), stable_for: 1s, initial: Idle);
    output running: Bool;
    running <- stable_mode |> map(mode_value) |> recover(false);
    fn mode_value(value: Mode) -> Bool { value == Run }
  }`, { filename: 'result-enum-debounce.ghost' });
  assert.deepEqual(result.manifest.signals[0].members, ['Idle', 'Run']);
  assert.equal(result.manifest.signals[0].errorType, 'SensorFault');
  const resultRuntime = await ControlRuntime.instantiate(wasm, result);
  const sample = (id, timestampMs) => ({ epoch: 1, id, timestampMs, value: true, quality: 'Good' });
  try {
    assert.equal(resultRuntime.step({ nowMs: 0, samples: { request: sample(1, 0) } }).vm.safe.running, false);
    assert.equal(resultRuntime.step({ nowMs: 1000, samples: { request: sample(2, 1000) } }).vm.safe.running, true);
  } finally { resultRuntime.dispose(); }
});

test('forward debounce chains preserve physical lineage and cycles reject', async () => {
  const compiled = await compileSource(`control DebounceChain {
    sensor request: Bool { stale_after = 10s; }
    signal twice = debounce(once, stable_for: 1s, initial: false);
    signal once = debounce(request, stable_for: 1s, initial: false);
    output stable: Bool;
    stable <- twice |> recover(false);
  }`, { filename: 'debounce-chain.ghost' });
  assert.deepEqual(compiled.manifest.signals.map(signal => signal.name), ['once', 'twice']);
  const sourceTag = compiled.sourceMap.find(node => node.kind === 'sensor').id;
  assert.deepEqual(compiled.manifest.signals.map(signal => signal.sources), [
    [{ name: 'request', tag: sourceTag, states: {
      lastEpoch: `__gf_debounce_source_epoch_once_${sourceTag}`,
      lastId: `__gf_debounce_source_id_once_${sourceTag}`,
    } }],
    [{ name: 'request', tag: sourceTag, states: {
      lastEpoch: `__gf_debounce_source_epoch_twice_${sourceTag}`,
      lastId: `__gf_debounce_source_id_twice_${sourceTag}`,
    } }],
  ]);
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  const sample = (id, timestampMs) => ({ epoch: 1, id, timestampMs, value: true, quality: 'Good' });
  try {
    assert.equal(runtime.step({ nowMs: 0, samples: { request: sample(1, 0) } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 1000, samples: { request: sample(2, 1000) } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 1999, samples: { request: sample(3, 1999) } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 2000, samples: { request: sample(4, 2000) } }).vm.safe.stable, true);
  } finally { runtime.dispose(); }
  await assert.rejects(() => compileSource(`control DebounceCycle {
    signal first = debounce(second, stable_for: 1s, initial: false);
    signal second = debounce(first, stable_for: 1s, initial: false);
  }`, { filename: 'debounce-cycle.ghost' }), /cyclic signal dependency/);
});

test('compiler-owned fault enums remain finite debounce payloads after explicit Result case extraction', async () => {
  const compiled = await compileSource(`control FaultEnumDebounce {
    sensor request: Bool;
    let reason = case request { ok(_) => NotReady; fault(value) => value; };
    signal stable_reason = debounce(reason, stable_for: 1s, initial: NotReady);
    output disconnected: Bool;
    disconnected <- stable_reason == Disconnected;
  }`, { filename: 'fault-enum-debounce.ghost' });
  assert.deepEqual(compiled.manifest.signals[0].members, ['Disconnected', 'Stale', 'Invalid', 'NotReady']);
  assert.equal(compiled.manifest.signals[0].payloadType, 'SensorFault');
  assert.equal(compiled.manifest.signals[0].errorType, null);
});

for (const [quality, choice] of [['Disconnected', 1], ['Stale', 2], ['Invalid', 3], ['NotReady', 4]]) {
  test(`debounce preserves ${quality} Result quality and provenance`, async () => {
    const compiled = await compileSource(`control DebounceFault {
      sensor request: Bool;
      signal stable_request = debounce(request, stable_for: 1s, initial: false);
      output stable: Bool;
      stable <- stable_request |> recover(false);
    }`, { filename: `debounce-${quality.toLowerCase()}.ghost` });
    const runtime = await ControlRuntime.instantiate(wasm, compiled);
    try {
      const result = runtime.step({ nowMs: 0, samples: { request: { epoch: 1, id: 1, timestampMs: 0, value: false, quality } } });
      assert.equal(result.vm.safe.stable, false);
      assert.equal(result.vm.resultTrace.at(-1).choice, choice);
      assert.equal(result.vm.resultTrace.at(-1).origin, compiled.sourceMap.find(node => node.kind === 'sensor').id);
    } finally { runtime.dispose(); }
  });
}

test('legacy and framed hosts produce the same debounce state and generated sample inputs', async () => {
  const compiled = await compileSource(`control DebounceParity {
    sensor request: Bool { stale_after = 10s; }
    signal stable_request = debounce(request, stable_for: 1s, initial: false);
    output stable: Bool;
    stable <- stable_request |> recover(false);
  }`, { filename: 'debounce-parity.ghost' });
  const legacy = await ControlRuntime.instantiate(wasm, compiled);
  const framed = await ControlRuntime.instantiateFramed(wasm, compiled);
  const frames = [
    { nowMs: 0, samples: { request: { epoch: 1, id: 1, timestampMs: 0, value: true, quality: 'Good' } } },
    { nowMs: 999, samples: {} },
    { nowMs: 1000, samples: { request: { epoch: 1, id: 2, timestampMs: 1000, value: true, quality: 'Good' } } },
  ];
  try {
    for (const frame of frames) {
      const expected = legacy.step(frame);
      const actual = framed.step(frame);
      assert.deepEqual(actual.vm.inputs, expected.vm.inputs);
      assert.deepEqual(actual.vm.stateAfter, expected.vm.stateAfter);
      assert.deepEqual(actual.vm.safe, expected.vm.safe);
      assert.deepEqual(actual.vm.resultTrace, expected.vm.resultTrace);
    }
  } finally { legacy.dispose(); framed.dispose(); }
});

test('switching physical Result roots resets continuity even without a fresh sample', async () => {
  const compiled = await compileSource(`control RootSwitchDebounce {
    input choose_a: Bool;
    sensor source_a: Bool { stale_after = 10s; }
    sensor source_b: Bool { stale_after = 10s; }
    let selected = if choose_a then source_a else source_b;
    signal stable_selected = debounce(selected, stable_for: 1s, initial: false);
    output stable: Bool;
    stable <- stable_selected |> recover(false);
  }`, { filename: 'root-switch-debounce.ghost' });
  assert.deepEqual(compiled.manifest.signals[0].sources.map(source => source.name), ['source_a', 'source_b']);
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  const sample = (id, timestampMs, value) => ({ epoch: 1, id, timestampMs, value, quality: 'Good' });
  try {
    assert.equal(runtime.step({ nowMs: 0, inputs: { choose_a: false }, samples: {
      source_a: sample(1, 0, false), source_b: sample(1, 0, true),
    } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 500, inputs: { choose_a: true } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 1000, inputs: { choose_a: false } }).vm.safe.stable, false, 'returning to the old root cannot reuse its candidate start');
    assert.equal(runtime.step({ nowMs: 1500, inputs: { choose_a: false }, samples: { source_b: sample(2, 1500, true) } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 2500, inputs: { choose_a: false }, samples: { source_b: sample(3, 2500, true) } }).vm.safe.stable, true);
  } finally { runtime.dispose(); }
});

test('all physical roots retain independent high-water identities across selection changes', async () => {
  const compiled = await compileSource(`control EpochZeroRoots {
    input choose_a: Bool;
    sensor source_a: Bool { stale_after = 10s; }
    sensor source_b: Bool { stale_after = 10s; }
    let selected = if choose_a then source_a else source_b;
    signal stable_selected = debounce(selected, stable_for: 1s, initial: false);
    output stable: Bool;
    stable <- stable_selected |> recover(false);
  }`, { filename: 'epoch-zero-roots.ghost' });
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  const sample = (id, timestampMs) => ({ epoch: 0, id, timestampMs, value: true, quality: 'Good' });
  try {
    assert.equal(runtime.step({ nowMs: 0, inputs: { choose_a: true }, samples: {
      source_a: sample(0, 0), source_b: sample(0, 0),
    } }).vm.safe.stable, false);
    const selectedWithoutSample = runtime.step({ nowMs: 100, inputs: { choose_a: false } });
    assert.equal(selectedWithoutSample.vm.safe.stable, false);
    assert.equal(selectedWithoutSample.vm.stateAfter.__gf_debounce_last_source_tag_stable_selected,
      compiled.manifest.signals[0].sources.find(source => source.name === 'source_b').tag,
      'the selected root changes even when no new sample is present');
    assert.equal(runtime.step({ nowMs: 200, inputs: { choose_a: false }, samples: { source_b: sample(0, 200) } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 1200, inputs: { choose_a: false }, samples: { source_b: sample(1, 1200) } }).vm.safe.stable, false,
      'the unselected B id-zero sample was already consumed into its own high-water state');
    assert.equal(runtime.step({ nowMs: 2200, inputs: { choose_a: false }, samples: { source_b: sample(2, 2200) } }).vm.safe.stable, true);
    assert.equal(runtime.step({ nowMs: 2300, inputs: { choose_a: true }, samples: { source_b: sample(3, 2300) } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 2400, inputs: { choose_a: true }, samples: { source_a: sample(0, 2400) } }).vm.safe.stable, false,
      'switching back cannot reuse the old A id-zero identity');
    assert.equal(runtime.step({ nowMs: 2500, inputs: { choose_a: true }, samples: { source_a: sample(1, 2500) } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 3500, inputs: { choose_a: true }, samples: { source_a: sample(2, 3500) } }).vm.safe.stable, true);
  } finally { runtime.dispose(); }
});

test('an unselected root advances its high-water and later lower IDs cannot start continuity', async () => {
  const compiled = await compileSource(`control UnselectedHighWater {
    input choose_a: Bool;
    sensor source_a: Bool { stale_after = 10s; }
    sensor source_b: Bool { stale_after = 10s; }
    let selected = if choose_a then source_a else source_b;
    signal stable_selected = debounce(selected, stable_for: 1s, initial: false);
    output stable: Bool;
    stable <- stable_selected |> recover(false);
  }`, { filename: 'unselected-high-water.ghost' });
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  const sample = (id, timestampMs, value = true) => ({ epoch: 1, id, timestampMs, value, quality: 'Good' });
  const sourceA = compiled.manifest.signals[0].sources.find(source => source.name === 'source_a');
  try {
    runtime.step({ nowMs: 0, inputs: { choose_a: false }, samples: {
      source_a: sample(1, 0), source_b: sample(1, 0, false),
    } });
    const advanced = runtime.step({ nowMs: 100, inputs: { choose_a: false }, samples: { source_a: sample(10, 100) } });
    assert.equal(advanced.vm.stateAfter[sourceA.states.lastId], 10, 'unselected roots still commit authoritative high-water identity');
    const older = runtime.step({ nowMs: 200, inputs: { choose_a: true }, samples: { source_a: sample(5, 200, false) } });
    assert.equal(older.vm.safe.stable, false);
    assert.equal(older.vm.stateAfter[sourceA.states.lastId], 10, 'a lower same-epoch ID is not fresh');
    assert.equal(runtime.step({ nowMs: 300, inputs: { choose_a: true }, samples: { source_a: sample(11, 300) } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 1300, inputs: { choose_a: true }, samples: { source_a: sample(12, 1300) } }).vm.safe.stable, true);
  } finally { runtime.dispose(); }
});

test('a rejected VM tick rolls back conditioner identity and debounce high-water together', async () => {
  const compiled = await compileSource(`control RejectedPhysicalDebounce {
    input divisor: Number;
    sensor request: Bool { stale_after = 10s; }
    signal stable_request = debounce(request, stable_for: 1s, initial: false);
    output stable: Bool;
    output quotient: Number;
    stable <- stable_request |> recover(false);
    quotient <- 1.0 / divisor;
  }`, { filename: 'rejected-physical-debounce.ghost' });
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  const sample = (id, timestampMs, value) => ({ epoch: 1, id, timestampMs, value, quality: 'Good' });
  const source = compiled.manifest.signals[0].sources[0];
  try {
    runtime.step({ nowMs: 0, inputs: { divisor: 1 }, samples: { request: sample(1, 0, false) } });
    assert.throws(() => runtime.step({ nowMs: 100, inputs: { divisor: 0 }, samples: { request: sample(10, 100, true) } }), /division by zero|division-by-zero/);
    assert.equal(runtime.runtime.trace.stateAfter[source.states.lastId], 1, 'the rejected core tick does not commit debounce high-water state');
    assert.deepEqual(runtime.sensors.get('request').conditioner.sampleIdentity(), { epoch: 1, id: 1, timestampMs: 0 });
    const retry = runtime.step({ nowMs: 200, inputs: { divisor: 1 }, samples: { request: sample(5, 200, false) } });
    assert.equal(retry.vm.stateAfter[source.states.lastId], 5);
    assert.equal(retry.vm.stateAfter.__gf_debounce_candidate_stable_request, false);
    assert.equal(runtime.step({ nowMs: 1100, inputs: { divisor: 1 }, samples: { request: sample(11, 1100, true) } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 2100, inputs: { divisor: 1 }, samples: { request: sample(12, 2100, true) } }).vm.safe.stable, true);
  } finally { runtime.dispose(); }
});

test('a rejected scan does not commit raw debounce candidate state', async () => {
  const compiled = await compileSource(`control AtomicDebounce {
    input request: Bool;
    input divisor: Number;
    signal stable_request = debounce(request, stable_for: 1s, initial: false);
    output stable: Bool;
    output quotient: Number;
    stable <- stable_request;
    quotient <- 1.0 / divisor;
  }`, { filename: 'atomic-debounce.ghost' });
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  try {
    runtime.step({ nowMs: 0, inputs: { request: false, divisor: 1 } });
    assert.throws(() => runtime.step({ nowMs: 100, inputs: { request: true, divisor: 0 } }), /division by zero|division-by-zero/);
    assert.equal(runtime.runtime.trace.stateAfter.__gf_debounce_candidate_active_stable_request, false);
    assert.equal(runtime.step({ nowMs: 1100, inputs: { request: true, divisor: 1 } }).vm.safe.stable, false);
    assert.equal(runtime.step({ nowMs: 2100, inputs: { request: true, divisor: 1 } }).vm.safe.stable, true);
  } finally { runtime.dispose(); }
});

for (const [label, source, message] of [
  ['zero duration', 'input value: Bool; signal stable = debounce(value, stable_for: 0ms, initial: false);', /positive constant Duration/],
  ['dynamic duration', 'input value: Bool; input delay: Duration; signal stable = debounce(value, stable_for: delay, initial: false);', /positive constant Duration/],
  ['wrong source type', 'input value: Number; signal stable = debounce(value, stable_for: 1s, initial: 0.0);', /Bool or a named finite enum/],
  ['wrong initial type', 'input value: Bool; signal stable = debounce(value, stable_for: 1s, initial: 0.0);', /initial must be a constant Bool/],
  ['missing named argument', 'input value: Bool; signal stable = debounce(value, stable_for: 1s);', /debounce requires/],
  ['unexpected named argument', 'input value: Bool; signal stable = debounce(value, stable_for: 1s, initial: false, extra: true);', /debounce requires/],
]) test(`debounce rejects ${label}`, async () => {
  await assert.rejects(() => compileSource(`control InvalidDebounce { ${source} }`, { filename: `invalid-debounce-${label.replaceAll(' ', '-')}.ghost` }), message);
});

test('hosts strictly reject incomplete or forged debounce manifest metadata', async () => {
  const compiled = await compileSource(`control DebounceManifest {
    sensor request: Bool;
    signal stable_request = debounce(request, stable_for: 1s, initial: false);
    output stable: Bool;
    stable <- stable_request |> recover(false);
  }`, { filename: 'debounce-manifest.ghost' });
  const altered = mutation => { const copy = structuredClone(compiled); mutation(copy.manifest); return copy; };
  await assert.rejects(() => ControlRuntime.instantiate(wasm, altered(manifest => { delete manifest.sensors[0].sampleEpochInput; })), /sample metadata inputs.*together/);
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasm, altered(manifest => { manifest.signals[0].states.stable = '__gf_debounce_stable_other'; })), /states\.stable/);
  await assert.rejects(() => ControlRuntime.instantiate(wasm, altered(manifest => { delete manifest.signals[0].sources[0].states.lastId; })), /sources\[0\]\.states\.lastId is required/);
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasm, altered(manifest => {
    const source = manifest.signals[0].sources[0];
    const tag = source.tag + 1;
    manifest.signals[0].sources.push({
      name: source.name, tag,
      states: {
        lastEpoch: `__gf_debounce_source_epoch_stable_request_${tag}`,
        lastId: `__gf_debounce_source_id_stable_request_${tag}`,
      },
    });
  })), /duplicate signal stable_request sample source request/);
  await assert.rejects(() => ControlRuntime.instantiate(wasm, altered(manifest => { manifest.signals[0].sourceMode = 'scan'; })), /sourceMode.*sources/);
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasm, altered(manifest => { manifest.signals[0].errorType = 'MadeUpFault'; })), /errorType/);
});
