import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileSource } from './helpers/literate-compile.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const sample = (id, quality, value = 0, timestampMs = id) => ({ epoch: 1, id, timestampMs, quality, value });

test('REF-08-012 default new control run clears warm sensor filter and freshness on plain and framed WASM', async () => {
  const compiled = await compileSource(`control FreshSensorRun {
    input moisture: Percent {
      valid = 0% .. 100%; filter = median(5); stale_after = 3s; recover_after = 3 samples;
    }
    output value: Percent;
    value <- moisture |> recover(0%);
  }`, { filename: 'fresh-sensor-run.ghost' });
  for (const instantiate of [ControlRuntime.instantiate, ControlRuntime.instantiateFramed]) {
    const warm = await instantiate.call(ControlRuntime, wasm, compiled);
    try {
      for (const [id, value] of [[1, 10], [2, 20], [3, 30], [4, 40], [5, 50]]) {
        const nowMs = id * 1000;
        warm.step({ nowMs, samples: { moisture: sample(id, 'Good', value, nowMs) } });
      }
      const retained = warm.step({ nowMs: 5001 });
      assert.equal(retained.sensors.moisture.quality, 'Good');
      assert.equal(retained.vm.safe.value, 30);
      assert.deepEqual(warm.sensors.get('moisture').conditioner.sampleIdentity(),
        { epoch: 1, id: 5, timestampMs: 5000 });
    } finally { warm.dispose(); }

    // The default factory receives only the same executable, with no restored sensor state.
    const fresh = await instantiate.call(ControlRuntime, wasm, compiled);
    try {
      const conditioner = fresh.sensors.get('moisture').conditioner;
      for (const nowMs of [5001, 7999, 8000]) {
        const startup = fresh.step({ nowMs });
        assert.equal(startup.sensors.moisture.quality, 'NotReady');
        assert.equal(startup.sensors.moisture.ok, false);
        assert.equal(conditioner.read(nowMs).value, null);
        assert.equal(startup.vm.safe.value, 0);
        assert.equal(startup.vm.resultTrace.at(-1).choice, 4);
        assert.equal(conditioner.sampleIdentity(), null);
      }
      // Reused source epoch/IDs cannot inherit a previous owner's sample cache or window.
      for (const [id, value] of [[1, 70], [2, 75], [3, 80], [4, 85], [5, 90]]) {
        const nowMs = 9000 + id;
        const reading = fresh.step({ nowMs, samples: { moisture: sample(id, 'Good', value, nowMs) } });
        assert.deepEqual(conditioner.sampleIdentity(), { epoch: 1, id, timestampMs: nowMs });
        if (id < 5) {
          assert.equal(reading.sensors.moisture.quality, 'NotReady');
          assert.equal(reading.sensors.moisture.ok, false);
          assert.equal(conditioner.read(nowMs).value, null);
          assert.equal(reading.vm.safe.value, 0);
          assert.equal(reading.vm.resultTrace.at(-1).choice, 4);
        } else {
          assert.equal(reading.sensors.moisture.quality, 'Good');
          assert.equal(reading.vm.safe.value, 80);
          assert.equal(reading.vm.resultTrace.at(-1).choice, 0);
        }
      }
      assert.equal(fresh.step({ nowMs: 12004 }).sensors.moisture.quality, 'Good');
      const stale = fresh.step({ nowMs: 12005 });
      assert.equal(stale.sensors.moisture.quality, 'Stale');
      assert.equal(stale.sensors.moisture.ok, false);
      assert.equal(conditioner.read(12005).value, null);
      assert.equal(stale.vm.resultTrace.at(-1).choice, 2);
    } finally { fresh.dispose(); }
  }
});

test('Result function parameters, constructors, and exhaustive nested fault cases lower to scalar control flow', async () => {
  const compiled = await compileSource(`fn ready(value: Bool) -> Result<Bool, SensorFault> {
    if value then ok(true) else fault(NotReady)
  }
  fn pass(value: Result<Bool, SensorFault>) -> Result<Bool, SensorFault> { value }
  control ResultFunctions {
    input request: Bool;
    output accepted: Bool;
    accepted <- case pass(request |> and_then(ready)) {
      ok(value) => value;
      fault(reason) => case reason {
        Disconnected => false; Stale => false; Invalid => false; NotReady => false;
      };
    };
  }`, { filename: 'result-functions.ghost' });
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  try {
    const accepted = runtime.step({ nowMs: 0, samples: { request: { epoch: 1, id: 1, timestampMs: 0, quality: 'Good', value: true } } });
    assert.equal(accepted.vm.safe.accepted, true);
    assert.equal(accepted.vm.resultTrace.at(-1).choice, 0);
    const fallback = runtime.step({ nowMs: 1, samples: { request: { epoch: 1, id: 2, timestampMs: 1, quality: 'Good', value: false } } });
    assert.equal(fallback.vm.safe.accepted, false);
    assert.equal(fallback.vm.resultTrace.at(-1).choice, 4);
    assert.ok(fallback.vm.resultTrace.at(-1).origin > 0);
  } finally { runtime.dispose(); }

});

test('Result generic equality and contextual shared fault members are strict', async () => {
  await assert.rejects(() => compileSource(`fn wrong(value: Result<Bool, ClockFault>) -> Result<Bool, CalendarFault> { value }
control WrongResult {}`, { filename: 'wrong-result.ghost' }), /Result|CalendarFault|ClockFault|returns/);
  await assert.rejects(() => compileSource(`control AmbiguousFault { let reason = ClockUnknown; }`, { filename: 'ambiguous-fault.ghost' }), /ambiguous|fault type/);
  await assert.rejects(() => compileSource(`control StoredResult { state bad: Result<Bool, SensorFault> = ok(true); }`, { filename: 'stored-result.ghost' }), /scalar|state|Result/);
});

test('Result case branches retain expected Result and shared fault enum context', async () => {
  await assert.doesNotReject(() => compileSource(`fn pass(value: Result<Bool, SensorFault>) -> Result<Bool, SensorFault> {
    case value { ok(payload) => ok(payload); fault(reason) => fault(reason); }
  }
  fn clock(value: Result<Bool, CalendarFault>) -> CalendarFault {
    case value { ok(_) => ClockUnknown; fault(reason) => reason; }
  }
  control ContextualResult {}`, { filename: 'contextual-result.ghost' }));
});

test('fault enum members cannot be shadowed by parameters, lets, or Result bindings', async () => {
  await assert.doesNotReject(() => compileSource('control OrdinaryEnum { type Mine = Fresh | Used; }', { filename: 'ordinary-enum.ghost' }));
  for (const [name, code] of [
    ['parameter', 'fn bad(Stale: Bool) -> Bool { Stale } control Bad {}'],
    ['let', 'control Bad { let Stale = false; }'],
    ['case binding', 'control Bad { input value: Bool; let x = case value { ok(Stale) => Stale; fault(_) => false; }; }'],
    ['enum declaration', 'control Bad { type Mine = Stale; }'],
  ]) await assert.rejects(() => compileSource(code, { filename: `shadow-${name}.ghost` }), /reserved fault member/);
});

test('enum case selection preserves every transient Result field', async () => {
  const compiled = await compileSource(`fn ready(value: Bool) -> Result<Bool, SensorFault> {
    if value then ok(true) else fault(Stale)
  }
  control EnumResult {
    type Mode = A | B;
    fn choose(mode: Mode) -> Result<Bool, SensorFault> {
      case mode { A => ready(true); B => ready(false); }
    }
    output value: Bool;
    value <- case choose(B) { ok(payload) => payload; fault(_) => false; };
  }`, { filename: 'enum-result.ghost' });
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  try { assert.equal(runtime.step({ nowMs: 0 }).vm.safe.value, false); }
  finally { runtime.dispose(); }
});

test('pure function and Result callback scopes cannot capture caller parameters with enum names', async () => {
  const compiled = await compileSource(`control LexicalScopes {
    type Mode = A | B;
    fn fixed(value: Bool) -> Mode { A }
    fn ordinary(A: Mode) -> Mode { fixed(true) }
    fn callback(value: Number) -> Mode { A }
    fn transformed(A: Mode, result: Result<Number, SensorFault>) -> Mode {
      result |> map(callback) |> recover(A)
    }
    output ordinary_changed, callback_changed: Bool;
    ordinary_changed <- ordinary(B) == B;
    callback_changed <- transformed(B, ok(1.0)) == B;
  }`, { filename: 'lexical-scopes.ghost' });
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  try {
    const safe = runtime.step({ nowMs: 0 }).vm.safe;
    assert.equal(safe.ordinary_changed, false);
    assert.equal(safe.callback_changed, false);
  } finally { runtime.dispose(); }
});

test('named static Result transform aliases compose and cycles or scalar aliases reject', async () => {
  const compiled = await compileSource(`control NamedTransform {
    input moisture: Percent;
    let is_dry = map(below(35%)) >> recover(false);
    output dry: Bool;
    dry <- moisture |> is_dry;
  }`, { filename: 'named-transform.ghost' });
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  try {
    assert.equal(runtime.step({ nowMs: 0, samples: { moisture: sample(0, 'Good', 30) } }).vm.safe.dry, true);
  } finally { runtime.dispose(); }
  await assert.rejects(() => compileSource(`control CyclicTransform {
    input moisture: Percent; let first = second; let second = first; output dry: Bool; dry <- moisture |> first;
  }`, { filename: 'cyclic-transform.ghost' }), /cyclic let/);
  await assert.rejects(() => compileSource(`control ScalarAlias {
    input moisture: Percent; let threshold = 35%; output dry: Bool; dry <- moisture |> threshold;
  }`, { filename: 'scalar-transform.ghost' }), /not a static Result transform/);
});

test('Result pipeline precedence leaves DailySlots generic terminators intact', async () => {
  await assert.doesNotReject(() => compileSource(`control ScheduleWithResultPrecedence {
    schedule starts: DailySlots<15min> { timezone = "UTC"; selected = [06:00]; }
    output due: Bool;
    due <- starts.due;
  }`, { filename: 'schedule-result-precedence.ghost' }));
});

test('REF-00-007 normal zero and fault fallback zero retain distinct result trace evidence', async () => {
  const compiled = await compileSource(`control ZeroProvenance {
    input reading: Number;
    output value: Number;
    value <- reading |> recover(0.0);
  }`, { filename: 'zero-provenance.ghost' });
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  try {
    const good = runtime.step({ nowMs: 0, samples: { reading: sample(0, 'Good') } });
    assert.equal(good.vm.safe.value, 0);
    assert.equal(good.sensors.reading.quality, 'Good');
    assert.deepEqual(good.vm.resultTrace.map(({ choice, origin }) => ({ choice, origin })), [{ choice: 0, origin: 0 }]);
    const fault = runtime.step({ nowMs: 1, samples: { reading: sample(1, 'Disconnected') } });
    assert.equal(fault.vm.safe.value, 0);
    assert.equal(fault.sensors.reading.quality, 'Disconnected');
    assert.deepEqual(fault.vm.resultTrace.map(({ choice, origin }) => ({ choice, origin })), [{ choice: 1, origin: compiled.sourceMap.find(node => node.kind === 'sensor').id }]);
  } finally { runtime.dispose(); }
  const framed = await ControlRuntime.instantiateFramed(wasm, compiled);
  try {
    const fault = framed.step({ nowMs: 0, samples: { reading: sample(0, 'Disconnected') } });
    assert.equal(fault.vm.safe.value, 0);
    assert.equal(fault.vm.resultTrace[0].choice, 1);
    assert.equal(fault.sensors.reading.quality, 'Disconnected');
  } finally { framed.dispose(); }
});

test('legacy and framed Result hosts reject missing or forged sensor fault bindings', async () => {
  const compiled = await compileSource(`control ResultBindings {
    input reading: Number;
    signal low = hysteresis(reading, on_below: 1.0, off_above: 2.0, initial: false);
    output value: Bool;
    value <- low |> recover(false);
  }`, { filename: 'result-bindings.ghost' });
  const missingSensor = structuredClone(compiled);
  delete missingSensor.manifest.sensors[0].faultInput;
  await assert.rejects(() => ControlRuntime.instantiate(wasm, missingSensor), /faultInput/);
  const forgedSignal = structuredClone(compiled);
  forgedSignal.manifest.signals[0].faultInput = '__gf_signal_fault_other';
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasm, forgedSignal), /faultInput/);
});

test('REF-01-075 optional sensor absence and installed fault identities remain distinct on framed WASM', async () => {
  const compiled = await compileSource(`control OptionalMoisture {
    input moisture?: Percent;
    output installed, healthy: Bool;
    output reason: Int;
    adapt moisture_policy {
      strategy Installed priority 10 match (moisture: sensor<Percent>) {
        installed <- true;
        healthy <- case moisture { ok(_) => true; fault(_) => false; };
        reason <- case moisture {
          ok(_) => 0;
          fault(f) => case f { Disconnected => 1; Stale => 2; Invalid => 3; NotReady => 4; };
        };
      }
      strategy Absent priority 0 match always {
        installed <- false;
        healthy <- false;
        reason <- -1;
      }
    }
  }`, { filename: 'optional-moisture.ghost' });
  assert.equal(compiled.manifest.sensors[0].optional, true);
  const capability = { kind: 'sensor', name: 'moisture', type: 'Percent' };
  const absent = await ControlRuntime.instantiateFramed(wasm, compiled, { capabilities: [] });
  try {
    const outcome = absent.step({ nowMs: 0 });
    assert.equal(outcome.vm.strategy, 'Absent');
    assert.deepEqual(outcome.vm.safe, { healthy: false, installed: false, reason: -1 });
    assert.deepEqual(outcome.vm.resultTrace, [], 'absent strategy does not invent a Result fallback');
    assert.equal(outcome.sensors.moisture.quality, 'NotReady'); // unpopulated placeholder, not presence evidence
    assert.throws(() => absent.step({ nowMs: 1, samples: { moisture: sample(1, 'Good') } }),
      /absent sensor capability moisture/);
    assert.deepEqual(absent.runtime.outcome.trace, outcome.vm);
  } finally { absent.dispose(); }
  for (const [quality, reason] of [['Good', 0], ['Disconnected', 1], ['Stale', 2], ['Invalid', 3], ['NotReady', 4]]) {
    const runtime = await ControlRuntime.instantiateFramed(wasm, compiled, { capabilities: [capability] });
    try {
      const outcome = runtime.step({ nowMs: 0, samples: { moisture: sample(0, quality) } });
      assert.equal(outcome.vm.strategy, 'Installed', 'installed fault cannot select the absence strategy');
      assert.equal(outcome.sensors.moisture.quality, quality);
      assert.deepEqual(outcome.vm.safe, { healthy: quality === 'Good', installed: true, reason });
      assert.ok(outcome.vm.resultTrace.some(event => event.choice === reason
        && event.origin === (quality === 'Good' ? 0 : compiled.sourceMap.find(node => node.kind === 'sensor').id)));
    } finally { runtime.dispose(); }
  }
});

test('REF-01-075 optional syntax does not implicitly unwrap or default a sensor Result', async () => {
  await assert.rejects(() => compileSource(`control ImplicitOptional {
    input moisture?: Percent;
    output pump: Bool;
    pump <- moisture < 30%;
  }`, { filename: 'implicit-optional.ghost' }), /optional sensor moisture may only be read inside a strategy that matches it/);
  await assert.rejects(() => compileSource(`control ImplicitOptionalResult {
    input moisture?: Percent;
    output pump: Bool;
    adapt moisture_policy {
      strategy Installed priority 10 match (moisture: sensor<Percent>) { pump <- moisture < 30%; }
      strategy Absent priority 0 match always { pump <- false; }
    }
  }`, { filename: 'implicit-optional-result.ghost' }), /Result|ordered|compare|Percent/);
});

test('REF-04-003 all SensorFault reasons survive explicit fallback', async () => {
  const compiled = await compileSource(`control FaultReasons {
    input reading: Number { stale_after = 3s; }
    output value: Number;
    value <- reading |> recover(0.0);
  }`, { filename: 'fault-reasons.ghost' });
  const scenarios = [
    ['Disconnected', { nowMs: 0, samples: { reading: sample(0, 'Disconnected') } }, 1],
    ['Invalid', { nowMs: 0, samples: { reading: sample(0, 'Invalid') } }, 3],
    ['NotReady', { nowMs: 0 }, 4],
  ];
  for (const [quality, frame, choice] of scenarios) {
    const runtime = await ControlRuntime.instantiate(wasm, compiled);
    try {
      const outcome = runtime.step(frame);
      assert.equal(outcome.sensors.reading.quality, quality);
      assert.equal(outcome.vm.resultTrace[0].choice, choice);
    } finally { runtime.dispose(); }
  }
  const staleRuntime = await ControlRuntime.instantiate(wasm, compiled);
  try {
    staleRuntime.step({ nowMs: 0, samples: { reading: sample(0, 'Good') } });
    const stale = staleRuntime.step({ nowMs: 3001 });
    assert.equal(stale.sensors.reading.quality, 'Stale');
    assert.equal(stale.vm.resultTrace[0].choice, 2);
  } finally { staleRuntime.dispose(); }
});

test('REF-04-005 map uses each current tick payload and faulted and_then callbacks stay unselected', async () => {
  const mapped = await compileSource(`control CurrentMap {
    input reading: Number;
    output below: Bool;
    below <- reading |> map(below(30.0)) |> recover(false);
  }`, { filename: 'current-map.ghost' });
  const mapRuntime = await ControlRuntime.instantiate(wasm, mapped);
  try {
    for (const [id, value, expected] of [[0, 20, true], [1, 40, false], [2, 20, true]]) {
      assert.equal(mapRuntime.step({ nowMs: id, samples: { reading: sample(id, 'Good', value) } }).vm.safe.below, expected);
    }
  } finally { mapRuntime.dispose(); }

  const skipped = await compileSource(`fn classify(value: Number) -> Result<Bool, SensorFault> {
    if 7.0 / value > 0.0 then ok(true) else ok(false)
  }
  control SkipFaultingCallback {
    input reading: Number;
    state committed: Bool = true;
    committed' = reading |> and_then(classify) |> recover(false);
    output value: Bool;
    value <- committed';
  }`, { filename: 'skip-faulting-callback.ghost' });
  const skipRuntime = await ControlRuntime.instantiate(wasm, skipped);
  try {
    assert.equal(skipRuntime.step({ nowMs: 0, samples: { reading: sample(0, 'Disconnected') } }).vm.stateAfter.committed, false);
    assert.throws(() => skipRuntime.step({ nowMs: 1, samples: { reading: sample(1, 'Good', 0) } }), /division by zero|division-by-zero/);
    assert.equal(skipRuntime.runtime.trace.stateAfter.committed, false);
  } finally { skipRuntime.dispose(); }
});
