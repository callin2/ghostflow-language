import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { compileContinuousControlPolicyArtifact } from '../tools/control.mjs';
import { extractLiterate } from '../tools/literate.mjs';
import { compileBoundResourceControl, verifyBoundResourceCompilation, observeBoundResourceTrace } from '../tools/bound-resource-control.mjs';
import { BoundResourceControlRuntime } from '../runtimes/wasm/bound-resource-control.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { softwareQualityRails } from './helpers/software-quality-observations.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.env.CARGO_TARGET_DIR ?? path.join(root, 'target');
const wasm = () => fs.readFileSync(path.join(target, 'wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const literalSource = `# Source-bound ventilation requests

The requests and the wind ceiling are evaluated from one scan. The authored 0%
fallback belongs to this software example and is not a physical safety claim.

\`\`\`ghost
control Vent {
  resource vent: ContinuousActuator<Percent>;
  output vent_target: Percent;
  let temperature_demand = 70%;
  let humidity_demand = 40%;
  let wind_limit = 20%;
  resource_policy P for vent {
    select = max;
    requests { temperature = temperature_demand; humidity = humidity_demand; }
    ceilings { wind = wind_limit; }
    safe = 0%;
    on_unknown = safe;
    output = vent_target;
  }
}
\`\`\`
`;
const dynamicSource = literalSource.replace('let temperature_demand = 70%;', 'input temperature_demand: Percent;')
  .replace('let humidity_demand = 40%;', 'input humidity_demand: Percent;')
  .replace('let wind_limit = 20%;', 'input wind_limit: Percent;')
  .replace('output vent_target: Percent;', "output vent_target: Percent;\n  state completed: Int = 0;\n  completed' = completed + 1;");

function compile(source = literalSource, namespace = 'continuous/test') {
  const descriptor = compileSourceSync(source, { filename: 'continuous.ghost.md' });
  const binding = { format: 'GhostFlow/resource-constraints-binding-v2', revision: 'installation-r1', runId: 'run-1',
    sourceDocumentSha256: descriptor.sourceDocument.sha256, artifactSha256: descriptor.manifest.bytecodeSha256,
    resources: [{ name: 'vent', resourceId: `${namespace}/vent`, output: 'vent_target', type: 'Percent' }] };
  return { descriptor, binding, bound: compileBoundResourceControl(descriptor, binding) };
}
function frames(bound, rows) {
  return rows.map((values, scanId) => ({ scanId, logicalTimeMs: scanId,
    inputs: Object.entries(softwareQualityRails(bound, values, scanId + 1, scanId)).map(([name, value]) => ({ name, value })) }));
}
function fault(bound, frame, name, reason) {
  const sensor = bound.manifest.sensors.find(sensor => sensor.name === name);
  return { ...frame, inputs: frame.inputs.map(input => ({ ...input,
    value: input.name === sensor.okInput ? false : input.name === sensor.faultInput ? reason : input.value })) };
}
function native(t, bound, tape) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-continuous-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const files = ['module.gfb', 'activation.gfrb', 'scan.gfrs'].map(name => path.join(directory, name));
  [bound.bytes, bound.resourceBindingActivation, bound.resourceBindingScan].forEach((bytes, index) => fs.writeFileSync(files[index], bytes));
  const output = execFileSync(path.join(target, 'release/examples/resource_tape'), [...files,
    ...tape.map(frame => frame.inputs.map(input => `${input.name}=${input.value}`).join(','))], { encoding: 'utf8' });
  return output.trim().split('\n').map(row => JSON.parse(row));
}
async function portable(bound, tape) {
  const runtime = await BoundResourceControlRuntime.instantiate(wasm(), bound);
  try { return tape.map(frame => runtime.scan(frame).trace); }
  finally { runtime.dispose(); }
}

test('GF-TEST-continuous-resource-compile: canonical policy is typed, sole-writer and bound to source identities', () => {
  const { descriptor, binding, bound } = compile();
  assert.equal(descriptor.manifest.executable, false);
  assert.equal(bound.manifest.format, 'GhostFlow/control-v25');
  assert.deepEqual(verifyBoundResourceCompilation(bound).bytes, bound.bytes);
  const policy = bound.manifest.continuousResourcePolicies[0];
  assert.equal(literalSource.split('\n')[policy.source.line - 1].trim(), 'resource_policy P for vent {');
  for (const source of [
    literalSource.replace('select = max;', 'select = exclusive;'),
    literalSource.replace('select = max;', 'select = highest_authority;'),
    literalSource.replace('on_unknown = safe;', 'on_unknown = ignore;'),
    literalSource.replace('let humidity_demand = 40%;', 'let humidity_demand = 40;'),
    literalSource.replace('output = vent_target;', 'output = missing;'),
    literalSource.replace('let wind_limit', 'vent_target <- 80%;\n  let wind_limit'),
    literalSource.replace('ContinuousActuator<Percent>', 'ContinuousActuator<Number>'),
    literalSource.replace('output vent_target: Percent;', 'output vent_target: Percent; objective bypass {}'),
    literalSource.replace('requests { temperature = temperature_demand; humidity = humidity_demand; }', 'requests {}'),
    literalSource.replace('humidity = humidity_demand;', 'temperature = humidity_demand;'),
  ]) assert.throws(() => compile(source), /continuous|Percent|duplicate output|duplicate request/);
  for (const mutation of [value => { value.runId = ''; }, value => { value.sourceDocumentSha256 = '0'.repeat(64); },
    value => { value.resources[0].type = 'Bool'; }, value => { value.resources[0].output = 'other'; }, value => { value.policy = {}; }]) {
    const invalid = structuredClone(binding); mutation(invalid);
    assert.throws(() => compileBoundResourceControl(descriptor, invalid), /binding/);
  }
  const revised = compile(literalSource.replace('70%', '60%')).bound;
  assert.notEqual(revised.manifest.sourceDocumentSha256, bound.manifest.sourceDocumentSha256);
  assert.throws(() => compileBoundResourceControl(compile(literalSource.replace('70%', '60%')).descriptor, binding), /identity mismatch/);
  const code = extractLiterate(literalSource, { filename: 'continuous.ghost.md' }).code;
  assert.throws(() => compileContinuousControlPolicyArtifact(code, { filename: 'continuous.ghost.md' }), /policy envelope/);
  assert.throws(() => compileContinuousControlPolicyArtifact(code, { filename: 'continuous.ghost.md', envelope: bytes => bytes }), /guarded GFB25 envelope/);
  const oversized = literalSource.replace('temperature = temperature_demand; humidity = humidity_demand;',
    Array.from({ length: 17 }, (_, index) => `request${index} = 40%;`).join(' '));
  assert.throws(() => compile(oversized), /1\.\.16/);
});

test('GF-TEST-continuous-resource-parity: canonical 70/40 selects 70 and wind ceiling clamps to 20 in native and WASM owner', async t => {
  const { bound } = compile();
  const tape = frames(bound, [{}]);
  const nativeTrace = native(t, bound, tape);
  const wasmTrace = await portable(bound, tape);
  assert.deepEqual(wasmTrace, nativeTrace);
  const decision = wasmTrace[0].continuousResourceTrace[0];
  assert.deepEqual(wasmTrace[0].requested, { vent_target: 70 });
  assert.deepEqual(wasmTrace[0].safe, { vent_target: 20 });
  assert.equal(decision.selected, 70); assert.equal(decision.clamp, 20); assert.equal(decision.final, 20);
  assert.equal(decision.conditionsKnown, true); assert.equal(decision.fallback, false);
  assert.equal(decision.runId, 'run-1'); assert.equal(decision.tick, 1);
  assert.deepEqual(decision.requests.map(entry => [entry.name, entry.value]), [['temperature', 70], ['humidity', 40]]);
  assert.equal(observeBoundResourceTrace(bound, wasmTrace[0])[0].evidence, 'executed');
  const tampered = structuredClone(wasmTrace[0]); tampered.continuousResourceTrace[0].requests[0].identity = 'forged';
  assert.throws(() => observeBoundResourceTrace(bound, tampered), /identity mismatch/);
});

test('GF-TEST-continuous-resource-dynamic: snapshot requests, min/max ties and fault reasons agree in native and WASM', async t => {
  const { bound } = compile(dynamicSource.replace('safe = 0%;', 'safe = 60%;'));
  const tape = frames(bound, [
    { temperature_demand: 70, humidity_demand: 40, wind_limit: 20 },
    { temperature_demand: 30, humidity_demand: 80, wind_limit: 90 },
    { temperature_demand: 50, humidity_demand: 50, wind_limit: 90 },
    { temperature_demand: 70, humidity_demand: 40, wind_limit: 20 },
    { temperature_demand: 70, humidity_demand: 40, wind_limit: 20 },
  ]);
  tape[3] = fault(bound, tape[3], 'temperature_demand', 1);
  tape[4] = fault(bound, tape[4], 'wind_limit', 0);
  const actual = await portable(bound, tape);
  assert.deepEqual(actual, native(t, bound, tape));
  assert.deepEqual(actual.map(trace => trace.safe.vent_target), [20, 80, 50, 20, 60]);
  const decisions = actual.map(trace => trace.continuousResourceTrace[0]);
  assert.equal(decisions[2].ties.length, 2);
  assert.equal(decisions[2].selectedRequest, decisions[2].requests[0].identity);
  assert.equal(decisions[3].selected, null); assert.equal(decisions[3].requests[0].reason, 'Stale');
  assert.equal(decisions[3].candidate, 60); assert.equal(decisions[3].clamp, 20);
  assert.equal(decisions[4].selected, 70); assert.equal(decisions[4].ceilings[0].reason, 'Disconnected');
  assert.equal(decisions[4].conditionsKnown, false); assert.equal(decisions[4].clamp, null);
  const minimum = compile(dynamicSource.replace('select = max;', 'select = min;'), 'continuous/min').bound;
  const minTape = frames(minimum, [{ temperature_demand: 70, humidity_demand: 40, wind_limit: 90 }]);
  const minTrace = await portable(minimum, minTape);
  assert.deepEqual(minTrace, native(t, minimum, minTape));
  assert.equal(minTrace[0].safe.vent_target, 40);
  const previousState = compile(literalSource.replace('let temperature_demand = 70%;',
    "state temperature_demand: Percent = 50%;\n  temperature_demand' = temperature_demand + 10%;")
    .replace('ceilings { wind = wind_limit; }', 'ceilings {}'), 'continuous/state').bound;
  const stateTape = frames(previousState, [{}, {}]);
  const stateTrace = await portable(previousState, stateTape);
  assert.deepEqual(stateTrace, native(t, previousState, stateTape));
  assert.deepEqual(stateTrace.map(trace => trace.safe.vent_target), [50, 60]);
  assert.deepEqual(stateTrace.map(trace => trace.stateAfter.temperature_demand), [60, 70]);
});

test('GF-TEST-continuous-resource-atomic: failed scans, invalid packets and duplicate writers preserve committed state', async () => {
  const { bound } = compile(dynamicSource, 'continuous/atomic');
  const runtime = await FramedGhostFlowRuntime.instantiate(wasm());
  const competing = new FramedGhostFlowRuntime(runtime.wasm);
  try {
    for (const instance of [runtime, competing]) { instance.load(bound.bytes); instance.addCapability('actuator', 'vent_target', 'number'); }
    const badActivation = bound.resourceBindingActivation.slice(); badActivation[badActivation.length - 1] ^= 1;
    assert.throws(() => runtime.activateResourceBinding(badActivation), /binding mismatch/);
    runtime.activateResourceBinding(bound.resourceBindingActivation);
    assert.throws(() => competing.activateResourceBinding(bound.resourceBindingActivation), /writer already active/);
    const [first, next] = frames(bound, [
      { temperature_demand: 70, humidity_demand: 40, wind_limit: 20 },
      { temperature_demand: 80, humidity_demand: 40, wind_limit: 30 },
    ]);
    const committed = runtime.scanResourceBinding(first, bound.resourceBindingScan);
    assert.equal(committed.trace.stateAfter.completed, 1);
    const badScan = bound.resourceBindingScan.slice(); badScan[badScan.length - 1] ^= 1;
    assert.throws(() => runtime.scanResourceBinding(next, badScan), /binding mismatch/);
    const outOfRange = structuredClone(next);
    outOfRange.inputs.find(input => input.name === bound.manifest.sensors[0].valueInput).value = 101;
    assert.throws(() => runtime.scanResourceBinding(outOfRange, bound.resourceBindingScan), /Percent|percent/);
    const invalidFault = fault(bound, next, 'wind_limit', 99);
    assert.throws(() => runtime.scanResourceBinding(invalidFault, bound.resourceBindingScan), /SensorFault|fault/);
    const nonfinite = structuredClone(next); nonfinite.inputs[0].value = Infinity;
    assert.throws(() => runtime.scanResourceBinding(nonfinite, bound.resourceBindingScan), /finite/);
    const retried = runtime.scanResourceBinding(next, bound.resourceBindingScan);
    assert.equal(retried.trace.tick, 2); assert.equal(retried.trace.stateBefore.completed, 1); assert.equal(retried.trace.stateAfter.completed, 2);
    assert.equal(retried.trace.safe.vent_target, 30);
  } finally { runtime.dispose(); competing.dispose(); }
});

test('GF-TEST-continuous-resource-ceilings: known limits clamp unknown fallback and tied requests retain source order', async t => {
  const source = dynamicSource.replace("state completed: Int = 0;\n  completed' = completed + 1;", '')
    .replace('safe = 0%;', 'safe = 60%;').replace('wind = wind_limit;', 'wind = wind_limit; fixed = 15%;');
  const { bound } = compile(source, 'continuous/ceilings');
  const tape = frames(bound, [{ temperature_demand: 70, humidity_demand: 40, wind_limit: 20 }]);
  tape[0] = fault(bound, tape[0], 'wind_limit', 3);
  const actual = await portable(bound, tape);
  assert.deepEqual(actual, native(t, bound, tape));
  const decision = actual[0].continuousResourceTrace[0];
  assert.equal(decision.conditionsKnown, false); assert.equal(decision.candidate, 60); assert.equal(decision.final, 15);
  assert.equal(decision.ceilings[0].reason, 'NotReady'); assert.equal(decision.ceilings[1].value, 15);
  const reversed = compile(literalSource.replace('70%', '40%').replace('temperature = temperature_demand; humidity = humidity_demand;',
    'humidity = humidity_demand; temperature = temperature_demand;'), 'continuous/reversed').bound;
  const reversedTape = frames(reversed, [{}]);
  const reversedTrace = await portable(reversed, reversedTape);
  assert.deepEqual(reversedTrace, native(t, reversed, reversedTape));
  const tied = reversedTrace[0].continuousResourceTrace[0];
  assert.equal(tied.requests[0].name, 'humidity'); assert.equal(tied.selectedRequest, tied.requests[0].identity);
  assert.equal(tied.ties.length, 2); assert.equal(tied.final, 20);
});

test('GF-TEST-continuous-resource-malformed: native and WASM loaders reject invalid typed plans before activation', async t => {
  const { bound } = compile();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-continuous-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const files = ['module.gfb', 'activation.gfrb', 'scan.gfrs'].map(name => path.join(directory, name));
  fs.writeFileSync(files[1], bound.resourceBindingActivation); fs.writeFileSync(files[2], bound.resourceBindingScan);
  const view = new DataView(bound.bytes.buffer, bound.bytes.byteOffset);
  let offset = 10 + view.getUint32(6, true);
  const text = () => { const at = offset + 2; offset = at + view.getUint16(offset, true); return at; };
  const blob = () => { const at = offset + 4; offset = at + view.getUint32(offset, true); return at; };
  const sourceAt = text(); text(); const activationAt = blob();
  offset += 2 + 4; text(); text(); text();
  const selectionAt = offset++, safeAt = offset; offset += 8;
  offset += 2; const firstNodeAt = offset; offset += 4; text();
  const okAt = blob(); const valueAt = blob(); blob(); blob();
  const secondNodeAt = offset;
  const cases = [
    [bytes => { bytes[sourceAt] = bytes[sourceAt] === 48 ? 49 : 48; }, /binding source mismatch/],
    [bytes => { bytes[activationAt + bound.resourceBindingActivation.length - 1] = 1; }, /typed continuous resource binding/],
    [bytes => { bytes[selectionAt] = 2; }, /unsupported continuous selection/],
    [bytes => { new DataView(bytes.buffer).setFloat64(safeAt, NaN, true); }, /non-finite|finite|Percent/],
    [bytes => { bytes.set(bytes.slice(firstNodeAt, firstNodeAt + 4), secondNodeAt); }, /duplicate continuous request identity/],
    [bytes => { bytes[okAt] = 60; }, /Percent guard|stack underflow/],
    [bytes => { new DataView(bytes.buffer).setFloat64(valueAt + 1, Infinity, true); }, /non-finite|finite/],
    [bytes => { bytes[14] = 11; }, /scalar GFB base/],
  ];
  const runtime = await FramedGhostFlowRuntime.instantiate(wasm());
  try {
    for (const [mutate, expected] of cases) {
      const bytes = bound.bytes.slice(); mutate(bytes); fs.writeFileSync(files[0], bytes);
      const nativeResult = spawnSync(path.join(target, 'release/examples/resource_tape'), [...files, ''], { encoding: 'utf8' });
      assert.notEqual(nativeResult.status, 0); assert.equal(nativeResult.stdout, ''); assert.match(nativeResult.stderr, expected);
      assert.throws(() => runtime.load(bytes), expected);
    }
  } finally { runtime.dispose(); }
});
