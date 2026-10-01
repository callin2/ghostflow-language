import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileControl, ControlCompileError, parseControl } from '../tools/control.mjs';
import { extractLiterate } from '../tools/literate.mjs';
import { compileSource } from './helpers/literate-compile.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

function expectError(source, text, filename = 'bad.ghost') {
  assert.throws(
    () => compileControl(source, { filename }),
    error => error instanceof ControlCompileError && error.message.includes(text),
    `expected diagnostic containing ${JSON.stringify(text)}`,
  );
}

function readString(bytes, state) {
  const length = bytes.readUInt16LE(state.at); state.at += 2;
  const value = bytes.subarray(state.at, state.at + length).toString('utf8'); state.at += length;
  return value;
}

function skipBlob(bytes, state) { const length = bytes.readUInt32LE(state.at); state.at += 4 + length; }

function readBlob(bytes, state) {
  const length = bytes.readUInt32LE(state.at); state.at += 4;
  const value = bytes.subarray(state.at, state.at + length); state.at += length;
  return value;
}

function inspectQuery(bytes) {
  const state = { at: 0 }, stack = [];
  while (state.at < bytes.length) {
    const opcode = bytes.readUInt8(state.at++);
    if (opcode === 1) {
      const kind = readString(bytes, state), name = readString(bytes, state), typeCode = bytes.readUInt8(state.at++);
      const type = typeCode === 1 ? 'bool' : typeCode === 2 ? 'number' : undefined;
      assert.ok(type, 'capability query type is valid');
      stack.push({ kind: 'has', capabilityKind: kind, name, type });
    } else if (opcode === 5) {
      const value = bytes.readUInt8(state.at++);
      assert.ok(value === 0 || value === 1, 'boolean query constant is valid');
      stack.push({ kind: 'const', value: Boolean(value) });
    } else if (opcode === 2 || opcode === 3) {
      const count = bytes.readUInt16LE(state.at); state.at += 2;
      assert.ok(count > 0 && count <= stack.length, 'compound query has its encoded children');
      stack.push({ kind: opcode === 2 ? 'all' : 'any', children: stack.splice(stack.length - count, count) });
    } else if (opcode === 4) {
      assert.ok(stack.length, 'negated query has a child');
      stack.push({ kind: 'not', child: stack.pop() });
    } else {
      assert.fail(`unexpected query opcode ${opcode}`);
    }
  }
  assert.equal(stack.length, 1, 'query has one result');
  return stack[0];
}

// A deliberately small reader: it verifies only the GFB1 envelope fields the
// front-end owns, without duplicating the compiler or runtime verifier.
function inspectModule(bytes, expectedFormat = 3) { bytes = Buffer.from(bytes);
  assert.equal(bytes.subarray(0, 4).toString(), 'GFB1');
  const state = { at: 4 };
  assert.equal(bytes.readUInt16LE(state.at), expectedFormat); state.at += 2;
  const name = readString(bytes, state); state.at += 4;
  const inputs = [];
  for (let count = bytes.readUInt16LE(state.at), i = (state.at += 2, 0); i < count; i++) {
    inputs.push({ name: readString(bytes, state), type: bytes.readUInt8(state.at++) });
  }
  const states = [];
  for (let count = bytes.readUInt16LE(state.at), i = (state.at += 2, 0); i < count; i++) {
    const field = { name: readString(bytes, state), type: bytes.readUInt8(state.at++) };
    state.at += field.type === 1 ? 1 : 8; states.push(field);
  }
  const strategies = bytes.readUInt16LE(state.at); state.at += 2;
  const strategyQueries = [];
  for (let i = 0; i < strategies; i++) {
    readString(bytes, state); state.at += 4; strategyQueries.push(inspectQuery(readBlob(bytes, state)));
    for (let count = bytes.readUInt16LE(state.at), j = (state.at += 2, 0); j < count; j++) { state.at += 2; skipBlob(bytes, state); }
    for (let count = bytes.readUInt16LE(state.at), j = (state.at += 2, 0); j < count; j++) { readString(bytes, state); state.at++; skipBlob(bytes, state); }
  }
  const constraints = [];
  for (let count = bytes.readUInt16LE(state.at), i = (state.at += 2, 0); i < count; i++) {
    const kind = bytes.readUInt8(state.at++), names = [];
    for (let arity = bytes.readUInt16LE(state.at), j = (state.at += 2, 0); j < arity; j++) names.push(readString(bytes, state));
    constraints.push({ kind, names });
  }
  assert.equal(state.at, bytes.length, 'reader consumed complete GFB1 module');
  return { name, inputs, states, strategies, strategyQueries, constraints };
}

const scheduledFilename = 'examples/scheduled-watering.ghost.md';
const scheduled = extractLiterate(fs.readFileSync(new URL('../examples/scheduled-watering.ghost.md', import.meta.url), 'utf8'), { filename: scheduledFilename }).code;
const scheduledResult = compileControl(scheduled, { filename: scheduledFilename });
const scheduledModule = inspectModule(scheduledResult.bytes);

assert.equal(scheduledModule.name, 'ScheduledWatering');
assert.equal(scheduledModule.strategies, 1);
assert.ok(scheduledResult.bytes.length > 100 && scheduledResult.bytes.length < 4096);
assert.deepEqual(scheduledResult.manifest, {
  format: 'GhostFlow/control-v1',
  name: 'ScheduledWatering',
  inputs: [],
  outputs: [
    { name: 'pump', type: 'Bool' },
    { name: 'valve1', type: 'Bool' },
    { name: 'valve2', type: 'Bool' },
  ],
  sensors: [],
  schedules: [{
    name: 'starts', timezone: 'Asia/Seoul', slots: [360, 375, 750, 1125], dueInput: '__gf_schedule_due_starts',
  }],
  timers: [{ name: 'age', state: 'phase', clockInput: '__gf_now_ms' }],
  signals: [],
  configs: [],
});
assert.ok(scheduledModule.inputs.some(field => field.name === '__gf_schedule_due_starts' && field.type === 1));
assert.ok(scheduledModule.inputs.some(field => field.name === '__gf_now_ms' && field.type === 2));
assert.ok(scheduledModule.states.some(field => field.name === '__gf_timer_since_age' && field.type === 2));
assert.ok(scheduledModule.states.some(field => field.name === '__gf_timer_initialized_age' && field.type === 1));
assert.deepEqual(scheduledModule.strategyQueries, [{
  kind: 'all', children: [
    { kind: 'has', capabilityKind: 'actuator', name: 'pump', type: 'bool' },
    { kind: 'has', capabilityKind: 'actuator', name: 'valve1', type: 'bool' },
    { kind: 'has', capabilityKind: 'actuator', name: 'valve2', type: 'bool' },
  ],
}]);
assert.deepEqual(scheduledModule.constraints, [
  { kind: 3, names: ['pump', 'valve1', 'valve2'] },
  { kind: 2, names: ['valve1', 'valve2'] },
]);
assert.ok(scheduledResult.sourceMap.length > 40);
assert.ok(scheduledResult.sourceMap.every(node => node.filename === scheduledFilename && node.line >= 1 && node.column >= 1));

const sensorProgram = `
control MoistureDemand {
  input start, stop: Bool;
  input scale: Number;
  sensor moisture?: Percent {
    sample = 1s;
    valid = 0% .. 100%;
    filter = median(5);
    stale_after = 3s;
    recover_after = 3 samples;
  }
  signal dry = hysteresis(moisture,
    on_below: 30%, off_above: 35%, initial: false);
  fn latch(start: Bool, stop: Bool, previous: Bool) -> Bool {
    !stop && (start || previous);
  }
  let wait = 2s;
  let dry_ok = case dry { ok(value) => value; fault(_) => false; };
  state running: Bool = false;
  state amount: Number = 0;
  running' = latch(start, stop, running) && dry_ok;
  amount' = if running then amount + scale else amount;
  output pump, valve: Bool;
  output requested: Number;
  pump <- running';
  valve <- running';
  requested <- amount';
  require pump => (valve);
}
`;
const sensorResult = compileControl(sensorProgram, { filename: 'moisture.ghost' });
const sensorModule = inspectModule(sensorResult.bytes);
assert.deepEqual(sensorResult.manifest.inputs, [
  { name: 'start', type: 'Bool' }, { name: 'stop', type: 'Bool' }, { name: 'scale', type: 'Number' },
]);
assert.deepEqual(sensorResult.manifest.sensors, [{
  name: 'moisture', type: 'Percent', sampleMs: 1000, validMin: 0, validMax: 100,
  filter: 'median', window: 5, staleMs: 3000, recoverSamples: 3,
  valueInput: '__gf_sensor_value_moisture', okInput: '__gf_sensor_ok_moisture', faultInput: '__gf_sensor_fault_moisture', optional: true,
}]);
assert.deepEqual(sensorResult.manifest.signals, [{
  name: 'dry', sensor: 'moisture', onBelow: 30, offAbove: 35, initial: false,
  valueInput: '__gf_signal_value_dry', okInput: '__gf_signal_ok_dry', faultInput: '__gf_signal_fault_dry',
}]);
assert.ok(sensorModule.inputs.some(field => field.name === '__gf_sensor_value_moisture'));
assert.ok(sensorModule.inputs.some(field => field.name === '__gf_sensor_ok_moisture'));
assert.ok(sensorModule.inputs.some(field => field.name === '__gf_signal_value_dry'));
assert.ok(sensorModule.inputs.some(field => field.name === '__gf_signal_ok_dry'));
assert.equal(sensorModule.inputs.find(field => field.name === '__gf_signal_value_dry').type, 1, 'hysteresis value is Bool');
assert.deepEqual(sensorModule.constraints, [{ kind: 1, names: ['pump', 'valve'] }]);

const tutorialMoisture = compileControl(
  extractLiterate(fs.readFileSync(new URL('../examples/tutorial/03-moisture.ghost.md', import.meta.url), 'utf8'), { filename: 'examples/tutorial/03-moisture.ghost.md' }).code,
  { filename: 'examples/tutorial/03-moisture.ghost.md' },
);
const tutorialMoistureModule = inspectModule(tutorialMoisture.bytes);
assert.equal(tutorialMoisture.manifest.signals[0].name, 'dry');
assert.equal(tutorialMoistureModule.inputs.find(field => field.name === '__gf_signal_value_dry').type, 1);

const topLevelFunction = compileControl(`
fn hold(start: Bool, blocked: Bool, previous: Bool) -> Bool {
  !blocked && (start || previous)
}

control WateringDemand {
  input start, stop: Bool;
  sensor low_water: Bool;
  output pump, valve: Bool;
  state watering: Bool = false;
  let water_ok = case low_water { ok(low) => !low; fault(_) => false; };
  let blocked = stop || !water_ok;
  watering' = hold(start, blocked, watering);
  valve <- watering';
  pump <- watering';
  require pump => valve;
}
`, { filename: 'language-top-level-fn.ghost' });
assert.equal(inspectModule(topLevelFunction.bytes).name, 'WateringDemand');

const forwardDefinitions = compileControl(`
control ForwardDefinitions {
  output pump: Bool;
  pump <- hold(enabled, delayed);
  let delayed = permit;
  fn hold(value: Bool, gate: Bool) -> Bool { value && gate }
  input enabled: Bool;
  let permit = enabled;
}
`, { filename: 'forward.ghost' });
assert.deepEqual(inspectModule(forwardDefinitions.bytes).inputs, [{ name: 'enabled', type: 1 }]);

const noSensor = compileControl(`
control Basic {
  input enable: Bool;
  output pump: Bool;
  pump <- enable;
}
`, { filename: 'basic.ghost' });
assert.equal(noSensor.manifest.sensors.length, 0);
assert.equal(noSensor.manifest.schedules.length, 0);
assert.equal(noSensor.manifest.timers.length, 0);
assert.deepEqual(inspectModule(noSensor.bytes, 1).inputs, [{ name: 'enable', type: 1 }]);

// The raw runtime must reject an output-bearing module before the host declares
// its actuator. ControlRuntime is intentionally the virtual convenience host
// that derives and installs that same capability from the checked manifest.
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const rawRuntime = await GhostFlowRuntime.instantiate(wasm);
try {
  rawRuntime.load(noSensor.bytes);
  assert.throws(() => rawRuntime.activate(), /no device strategy matches capabilities/);
  rawRuntime.addCapability('actuator', 'pump', 'bool');
  rawRuntime.activate();
} finally { rawRuntime.dispose(); }
const adaptiveProgram = await compileSource('control Adaptive { sensor moisture?: Percent; output pump: Bool; adapt policy { strategy Wet priority 10 match (moisture: sensor<Percent>) { pump <- case moisture { ok(value) => value < 30%; fault(_) => false; }; } strategy Baseline priority 0 match always { pump <- false; } } }');
await assert.rejects(ControlRuntime.instantiate(wasm, adaptiveProgram), /adapt strategy activation requires a capability-aware host/);
const virtualRuntime = await ControlRuntime.instantiate(wasm, await compileSource(`
control Basic {
  input enable: Bool;
  output pump: Bool;
  pump <- enable;
}
`, { filename: 'basic-host.ghost' }));
try {
  assert.equal(virtualRuntime.step({ nowMs: 0, inputs: { enable: true } }).vm.safe.pump, true);
} finally { virtualRuntime.dispose(); }

const outputless = compileControl(`
control StateOnly {
  state enabled: Bool = false;
  enabled' = !enabled;
}
`, { filename: 'state-only.ghost' });
assert.deepEqual(inspectModule(outputless.bytes, 1).strategyQueries, [{ kind: 'const', value: true }]);

expectError(`
control OutputInitializer {
  output pump: Bool = false;
  pump <- false;
}
`, 'output declarations are type-only');

expectError(`
control MissingOutputConnection {
  output pump: Bool;
}
`, 'output pump requires exactly one connection');

expectError(`
control DuplicateOutputConnection {
  output pump: Bool;
  pump <- false;
  pump <- true;
}
`, 'duplicate output connection pump');

expectError(`
control OutputConnectionTypeMismatch {
  output requested: Number;
  requested <- true;
}
`, 'output requested must be Number');

const constantOutput = compileControl(`
control ConstantOutput {
  output pump: Bool;
  pump <- false;
}
`, { filename: 'constant-output.ghost' });
assert.deepEqual(constantOutput.manifest.outputs, [{ name: 'pump', type: 'Bool' }]);

const parsed = parseControl('control Parsed { output pump: Bool; pump <- false; }', { filename: 'parsed.ghost' });
assert.equal(parsed.name, 'Parsed');
assert.ok(parsed.sourceNodes.some(node => node.kind === 'connection'));

expectError(`
control MissingCase {
  type Phase = Idle | Open;
  state phase: Phase = Idle;
  phase' = case phase { Idle => Idle; };
  output pump: Bool;
}
`, 'must be exhaustive');

expectError(`
control UnitMix {
  state duration: Duration = 1s;
  duration' = duration + 20%;
  output pump: Bool;
}
`, 'does not implicitly mix Duration and Percent');

expectError(`
control NextOutsideOutput {
  state first: Bool = false;
  state second: Bool = false;
  second' = first';
  output pump: Bool;
}
`, 'allowed only in output expressions');

expectError(`
control Unknown {
  output pump: Bool;
  pump <- missing;
}
`, 'bad.ghost:4:11: unknown identifier missing');

expectError(`
control Recursive {
  fn loop(value: Bool) -> Bool { loop(value) }
  output pump: Bool;
  pump <- loop(true);
}
`, 'recursive fn loop is not supported');

expectError(`
control MutualRecursive {
  fn first(value: Bool) -> Bool { second(value) }
  fn second(value: Bool) -> Bool { first(value) }
  output pump: Bool;
  pump <- first(true);
}
`, 'recursive fn first is not supported');

expectError(`
control CapturedInput {
  input enabled: Bool;
  fn hidden() -> Bool { enabled }
  output pump: Bool;
}
`, 'fn hidden cannot capture global enabled');

expectError(`
control CapturedState {
  state held: Bool = false;
  fn hidden() -> Bool { held }
  output pump: Bool;
}
`, 'fn hidden cannot capture global held');

expectError(`
control LetCycle {
  let first = second;
  let second = first;
  output pump: Bool;
  pump <- first;
}
`, 'cyclic let definition involving first');

const repeatedDup = `${'dup('.repeat(13)}true${')'.repeat(13)}`;
expectError(`
control Expansion {
  fn dup(value: Bool) -> Bool { value && value }
  output pump: Bool;
  pump <- ${repeatedDup};
}
`, 'function expansion exceeds 4096 node budget');

expectError(`
control Duplicate {
  input start: Bool;
  state start: Bool = false;
  output pump: Bool;
}
`, 'duplicate name start');

expectError(`
control Reserved {
  input __gf_now_ms: Number;
  output pump: Bool;
}
`, 'uses reserved __gf_ prefix');

expectError(`
control Unsupported {
  adapt Policy { strategy }
  output pump: Bool;
}
`, 'expected strategy name');

expectError(`
control StrategyPriorityOverflow {
  output pump: Bool;
  adapt policy { strategy Baseline priority 2147483648 match always { pump <- false; } }
}
`, 'strategy priority must be in -2147483648..2147483647');

expectError(`
control OptionalSensorOutsideMatch {
  sensor moisture?: Percent;
  output pump: Bool;
  adapt policy {
    strategy Baseline priority 0 match always {
      pump <- case moisture { ok(value) => value < 30%; fault(_) => false; };
    }
  }
}
`, 'optional sensor moisture may only be read inside a strategy that matches it');

expectError(`
control Constraints {
  constraints Shared { }
  output pump: Bool;
}
`, 'local constraints block requires at least one rule');

expectError(`
control BadSlots {
  schedule starts: DailySlots<15min> {
    timezone = "Asia/Seoul";
    selected = [06:07, 06:00];
  }
  output pump: Bool;
}
`, 'requires a unique 15-minute HH:MM slot');

expectError(`
control BadSensor {
  sensor moisture: Percent { filter = median(4); }
  output pump: Bool;
}
`, 'median window must be an odd integer');

expectError(`
control RecoverBudget {
  sensor moisture: Percent { recover_after = 32 samples; }
  output pump: Bool;
}
`, 'recover_after must be an integer from 1 to 31 samples');

expectError(`
control PercentRange {
  config target: Percent = 101%;
  output pump: Bool;
}
`, 'Percent literal must be between 0% and 100%');

expectError(`
control NegativePercent {
  config target: Percent = -1%;
  output pump: Bool;
}
`, 'Percent constant must be between 0% and 100%');

expectError(`
control NegativeDuration {
  config wait: Duration = -1s;
  output pump: Bool;
}
`, 'Duration constant must be a non-negative integer number of milliseconds');

expectError(`
control FractionalDuration {
  config wait: Duration = 1.5s;
  output pump: Bool;
}
`, 'Duration literal must use a whole-number unit quantity');

const manyInputs = Array.from({ length: 129 }, (_, index) => `input input${index}: Bool;`).join('\n');
expectError(`control Budget { ${manyInputs} output pump: Bool; pump <- false; }`, 'input budget exceeded');

console.log(`control tests passed (${scheduledResult.bytes.length} byte scheduled control, ${sensorResult.bytes.length} byte sensor control)`);
