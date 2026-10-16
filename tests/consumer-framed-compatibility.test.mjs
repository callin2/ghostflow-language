import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from '../tools/browser-toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = () => fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const document = code => `# Virtual control\n\nThe GhostFlow source below is the complete reviewed program.\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const compile = (source, filename) => compileSource(source, { filename });
// These fixtures declare their quality policies in source. Acquisition only
// supplies independently observed samples, never host-side fallback values.
const acquired = (nowMs, values) => ({ nowMs, samples: Object.fromEntries(
  Object.entries(values).map(([name, value]) => [name,
    { epoch: 1, id: nowMs + 1, timestampMs: nowMs, quality: 'Good', value }])) });
const restartPolicy = (start, stop) => `
  let start_good = case ${start} { ok(_) => true; fault(_) => false; };
  let stop_good = case ${stop} { ok(_) => true; fault(_) => false; };
  let start_requested = ${start} |> recover(false);
  let stop_requested = ${stop} |> recover(true);
  state restart_blocked: Bool = false;
  restart_blocked' = if !start_good || !stop_good then true
    else if !start_requested then false else restart_blocked;
  running' = !stop_requested && (running || (start_requested && !restart_blocked));`;

test('consumer framed WASM executes named VFD Number I/O and independent Start/Stop oracles', async t => {
  const source = document(`control VfdSpeed {
  input start, stop: Bool;
  input potentiometer_v: Number;
  output run: Bool;
  output speed_v, speed_hz: Number;
  state running: Bool = false;
  ${restartPolicy('start', 'stop')}
  state last_v: Number = 0;
  last_v' = case potentiometer_v { ok(value) => value; fault(_) => last_v; };
  run <- running';
  speed_v <- last_v';
  speed_hz <- last_v' * 5;
}`);
  const artifact = await compile(source, 'consumer-vfd.ghost.md');
  assert.deepEqual(artifact.manifest.inputs, []);
  assert.deepEqual(artifact.manifest.sensors.map(({name, type}) => ({name, type})), [
    { name: 'start', type: 'Bool' }, { name: 'stop', type: 'Bool' },
    { name: 'potentiometer_v', type: 'Number' },
  ]);
  assert.deepEqual(artifact.manifest.outputs, [
    { name: 'run', type: 'Bool' }, { name: 'speed_v', type: 'Number' },
    { name: 'speed_hz', type: 'Number' },
  ]);
  const runtime = await ControlRuntime.instantiateFramed(wasm(), artifact);
  t.after(() => runtime.dispose());
  const frames = [
    [0, false, false, 0, false, 0, 0],
    [1, true, false, 5, true, 5, 25],
    [2, false, false, 10, true, 10, 50],
    [3, true, true, 5, false, 5, 25],
    [4, false, false, 10, false, 10, 50],
    [5, true, false, 0, true, 0, 0],
    [6, false, true, 5, false, 5, 25],
  ];
  for (const [nowMs, start, stop, potentiometer_v, run, speed_v, speed_hz] of frames) {
    const actual = runtime.step(acquired(nowMs, { start, stop, potentiometer_v }));
    assert.deepEqual(actual.frame, { scanId: nowMs, logicalTimeMs: nowMs });
    assert.deepEqual(actual.vm.safe, { run, speed_v, speed_hz });
  }
  const qualityScan = (nowMs, start, stop, faults = {}) => {
    const frame = acquired(nowMs, { start, stop, potentiometer_v: 5 });
    for (const [name, quality] of Object.entries(faults)) frame.samples[name].quality = quality;
    return runtime.step(frame);
  };
  assert.equal(qualityScan(7, true, false).vm.safe.run, true);
  assert.equal(qualityScan(8, false, false, { start: 'Disconnected' }).vm.safe.run, true,
    'START fault blocks new starts but retains existing operation when STOP is healthy');
  assert.equal(qualityScan(9, true, false, { stop: 'Invalid' }).vm.safe.run, false);
  assert.equal(qualityScan(10, true, false).vm.safe.run, false, 'held START cannot restart on recovery');
  assert.equal(qualityScan(11, false, false).vm.safe.run, false);
  assert.equal(qualityScan(12, true, false).vm.safe.run, true);
  const unavailableSpeed = qualityScan(13, false, false, { potentiometer_v: 'Disconnected' });
  assert.equal(unavailableSpeed.sensors.potentiometer_v.quality, 'Disconnected');
  assert.deepEqual(unavailableSpeed.vm.safe, { run: true, speed_v: 5, speed_hz: 25 },
    'fixture-authored last Good observation policy does not synthesize a new zero measurement');
});

test('consumer framed WASM also executes unrelated named Number and Boolean cabinet programs', async t => {
  const temperature = await compile(document(`control Temperature {
  input enabled: Bool;
  input temperature_c: Number;
  output fan: Bool;
  output observed_c: Number;
  state observed: Number = 0;
  observed' = case temperature_c { ok(value) => value; fault(_) => observed; };
  fan <- (enabled |> recover(false)) && case temperature_c { ok(value) => value > 30; fault(_) => false; };
  observed_c <- observed';
}`), 'consumer-temperature.ghost.md');
  const temperatureRuntime = await ControlRuntime.instantiateFramed(wasm(), temperature);
  t.after(() => temperatureRuntime.dispose());
  for (const [nowMs, enabled, temperature_c, fan] of [
    [0, false, 25, false], [1, true, 35, true], [2, false, 40, false],
  ]) {
    const actual = temperatureRuntime.step(acquired(nowMs, { enabled, temperature_c }));
    assert.deepEqual(actual.vm.safe, { fan, observed_c: temperature_c });
  }
  const failedTemperature = acquired(3, { enabled: true, temperature_c: 0 });
  failedTemperature.samples.temperature_c.quality = 'Invalid';
  assert.deepEqual(temperatureRuntime.step(failedTemperature).vm.safe, { fan: false, observed_c: 40 });

  const cabinet = await compile(document(`control Cabinet {
  input DI1, DI2, DI3, DI4, DI5, DI6, DI7, DI8: Bool;
  output RO1, RO2, RO3, RO4, RO5, RO6, RO7, RO8: Bool;
  state running: Bool = false;
  ${restartPolicy('DI1', 'DI2')}
  RO1 <- running';
  RO2 <- false; RO3 <- false; RO4 <- false; RO5 <- false;
  RO6 <- false; RO7 <- false; RO8 <- false;
}`), 'consumer-cabinet.ghost.md');
  const cabinetRuntime = await ControlRuntime.instantiateFramed(wasm(), cabinet);
  t.after(() => cabinetRuntime.dispose());
  const zero = Object.fromEntries(Array.from({ length: 8 }, (_, at) => [`DI${at + 1}`, false]));
  for (const [nowMs, DI1, DI2, run] of [
    [0, false, false, false], [1, true, false, true],
    [2, true, true, false], [3, false, false, false],
  ]) {
    const actual = cabinetRuntime.step(acquired(nowMs, { ...zero, DI1, DI2 }));
    assert.deepEqual(actual.vm.safe, { RO1: run, RO2: false, RO3: false, RO4: false,
      RO5: false, RO6: false, RO7: false, RO8: false });
  }
});

test('consumer framed settings atomically apply Bool, Number, Percent and Duration without restarting', async t => {
  const source = document(`control LiveSettings {
  input start, stop: Bool;
  config enabled: Bool = true { access = operator; }
  config gain: Number = 1 { min = 0; max = 10; step = 1; access = operator; }
  config level: Percent = 20% { min = 0%; max = 100%; step = 10%; access = operator; }
  config duration: Duration = 5s { min = 1s; max = 10s; step = 1s; access = operator; }
  config untouched: Bool = false { access = operator; }
  state running: Bool = false;
  timer age = elapsed(running);
  ${restartPolicy('start', 'stop')}
  output run, permitted: Bool;
  output gain_value: Number;
  run <- running' && case enabled { ok(value) => value; fault(_) => false; }
    && case duration { ok(value) => age < value; fault(_) => false; };
  permitted <- case level { ok(value) => value >= 30%; fault(_) => false; };
  gain_value <- case gain { ok(value) => value; fault(_) => 0; };
}`);
  const artifact = await compile(source, 'consumer-settings.ghost.md');
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v10');
  assert.deepEqual(artifact.manifest.configs.map(item => [item.name, item.type]), [
    ['enabled', 'Bool'], ['gain', 'Number'], ['level', 'Percent'],
    ['duration', 'Duration'], ['untouched', 'Bool'],
  ]);
  const runtime = await ControlRuntime.instantiateFramed(wasm(), artifact,
    { context: { bootEpoch: 11, terminalCapacity: 8, bindings: [] } });
  t.after(() => runtime.dispose());
  const initial = runtime.contextSnapshot();
  const fingerprint = initial.state.programFingerprint;
  const ids = Object.fromEntries(artifact.manifest.configs.map(item => [item.name, item.id]));
  const change = (name, type, value) => ({ configId: ids[name], result: { ok: true, type, value } });
  const packet = (eventId, baseRevision, position, changes) => ({
    programFingerprint: fingerprint, eventId, baseRevision, position,
    origin: 'operatorEdit', changes,
  });
  const facts = (nowMs, settings = null) => ({
    clock: { monotonicMs: nowMs, bootEpoch: 11, wallMs: nowMs, uncertaintyMs: 0,
      trusted: true, unknownReason: null, sourceRevision: 'consumer-clock-v1' },
    natural: [], schedules: [], settings,
  });
  const scan = (nowMs, start, stop, settings = null) => runtime.step({
    ...acquired(nowMs, { start, stop }), contextFacts: facts(nowMs, settings),
  });
  const first = scan(0, true, false);
  assert.deepEqual(first.frame, { scanId: 0, logicalTimeMs: 0 });
  assert.deepEqual(first.vm.safe, { run: true, permitted: false, gain_value: 1 });
  const setup = scan(1, false, false, packet('untouched-on', 0, 2,
    [change('untouched', 'Bool', true)]));
  assert.deepEqual(setup.frame, { scanId: 1, logicalTimeMs: 1 });
  const before = runtime.contextSnapshot();
  assert.deepEqual(before.state.settings.find(item => item.name === 'untouched').result,
    { ok: true, value: true });
  const valid = packet('all-types', 1, 3, [
    change('enabled', 'Bool', true), change('gain', 'Number', 3),
    change('level', 'Percent', 40), change('duration', 'Duration', 2_000),
  ]);
  const edited = scan(1_000, false, false, valid);
  assert.deepEqual(edited.frame, { scanId: 2, logicalTimeMs: 1_000 });
  assert.deepEqual(edited.vm.safe, { run: true, permitted: true, gain_value: 3 });
  assert.equal(runtime.contextSnapshot().state.settingsRevision, 2);
  assert.equal(runtime.contextSnapshot().state.settings.find(item => item.name === 'untouched').result.value, true);
  assert.equal(runtime.manifest.bytecodeSha256, artifact.manifest.bytecodeSha256);
  assert.equal(artifact.sourceDocument.text, source);

  assert.throws(() => scan(1_500, false, false,
    packet('stale', 1, 4, [change('gain', 'Number', 4)])), /stale|settings transaction/i);
  assert.equal(runtime.contextSnapshot().state.settingsRevision, 2);
  assert.equal(runtime.lastFrameOutcome.scanId, 2);

  const invalid = scan(1_500, false, false, packet('invalid-aggregate', 2, 4, [
    change('enabled', 'Bool', false), change('gain', 'Number', 11),
    change('level', 'Percent', 50), change('duration', 'Duration', 3_000),
  ]));
  assert.deepEqual(invalid.frame, { scanId: 3, logicalTimeMs: 1_500 });
  assert.deepEqual(invalid.vm.safe, { run: false, permitted: false, gain_value: 0 });
  const faulted = runtime.contextSnapshot();
  assert.equal(faulted.state.settingsRevision, 3);
  for (const name of ['enabled', 'gain', 'level', 'duration']) {
    assert.deepEqual(faulted.state.settings.find(item => item.name === name).result,
      { ok: false, fault: 'SettingsInvalid' });
  }
  assert.deepEqual(faulted.state.settings.find(item => item.name === 'untouched').result,
    before.state.settings.find(item => item.name === 'untouched').result);
  assert.equal(invalid.vm.stateAfter.running, true, 'a settings fault does not reset program state');

  const recovered = scan(2_000, false, false, packet('recover', 3, 5, [
    change('enabled', 'Bool', true), change('gain', 'Number', 4),
    change('level', 'Percent', 50), change('duration', 'Duration', 3_000),
  ]));
  assert.deepEqual(recovered.frame, { scanId: 4, logicalTimeMs: 2_000 });
  assert.deepEqual(recovered.vm.safe, { run: true, permitted: true, gain_value: 4 });
  assert.equal(recovered.vm.stateAfter.running, true);
  assert.equal(runtime.contextSnapshot().state.settingsRevision, 4);

  const deadline = scan(3_000, false, false);
  assert.deepEqual(deadline.frame, { scanId: 5, logicalTimeMs: 3_000 });
  assert.equal(deadline.vm.safe.run, false,
    'elapsed timer retains its original start across settings success, fault and recovery');
  assert.equal(runtime.contextSnapshot().state.programFingerprint, fingerprint);
});
