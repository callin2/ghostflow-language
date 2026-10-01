import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { compileSource, compileBoundResourceControl, verifyBoundResourceCompilation, observeBoundResourceTrace } from '../tools/browser-toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { BoundResourceControlRuntime, simulateBoundResourceControl } from '../runtimes/wasm/bound-resource-control.mjs';
import { BoundResourceControlRuntime as NodeBoundRuntime } from '../runtimes/node/bound-resource-control.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { prepareCompletedScanSnapshot } from '../tools/interaction-runtime-snapshot.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const filename = 'examples/bound-resource-execution.ghost.md';
const document = fs.readFileSync(path.join(root, filename), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
function compile(source = document, namespace = 'virtual/test') {
  const checked = compileSourceSync(source, { filename });
  const binding = { format: 'GhostFlow/resource-constraints-binding-v1', revision: 'installation-r1',
    sourceDocumentSha256: checked.sourceDocument.sha256, artifactSha256: checked.manifest.bytecodeSha256,
    resources: [
      { name: 'station', resourceId: `${namespace}/loop` },
      { name: 'pump1', resourceId: `${namespace}/pump`, output: 'pump' },
      { name: 'valve1', resourceId: `${namespace}/valve`, output: 'valve' },
    ], modes: [{ group: 'SharedRules', name: 'automatic', input: 'automatic' },
      { group: 'SharedRules', name: 'manual', input: 'manual' }] };
  return { checked, binding, bound: compileBoundResourceControl(checked, binding) };
}
const rows = [
  [true, false, true, false, false, false], // predictive prestart violation: no new output
  [true, false, true, false, false, true], // evidence recovery cannot secretly restart
  [false, false, false, false, false, true], // explicit neutral
  [true, false, true, false, false, true], // fresh automatic admission
  [true, true, true, true, false, true], // rejected newcomer cannot displace incumbent
  [false, true, false, true, false, true], // no hidden queued manual admission
  [false, false, false, false, false, true],
  [false, true, false, true, false, true], // fresh manual admission
  [false, true, false, true, false, false], // ongoing violation: explicit non-OFF safe
  [false, true, false, true, false, true], // held trip
  [false, false, false, false, false, true],
  [true, false, false, false, true, true], // fallback follows same envelope
  [true, false, false, false, true, false], // fallback ongoing violation
  [false, false, false, false, false, true],
  [true, true, true, true, false, true], // simultaneous fresh conflict
];
function frame(bound, values, scanId) {
  return { scanId, logicalTimeMs: scanId,
    inputs: bound.manifest.inputs.map((port, index) => ({ name: port.name, value: values[index] })) };
}
function wasm() { return fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm')); }
function temporary(t, bound) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-bound-resource-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = ['module.gfb', 'activation.gfrb', 'scan.gfrs'].map(name => path.join(dir, name));
  [bound.bytes, bound.resourceBindingActivation, bound.resourceBindingScan].forEach((bytes, index) => fs.writeFileSync(files[index], bytes));
  return files;
}

test('GF-TEST-bound-resource-compile: source-bound finite executable policy rejects incomplete or mismatched contracts', () => {
  const { checked, binding, bound } = compile();
  assert.equal(checked.manifest.executable, false);
  assert.equal(bound.manifest.format, 'GhostFlow/control-v17');
  assert.equal(bound.manifest.executable, true);
  assert.equal(new DataView(bound.bytes.buffer).getUint16(4, true), 17);
  assert.equal(bound.manifest.bytecodeSha256, sha256Hex(bound.bytes));
  assert.deepEqual(compileBoundResourceControl(checked, binding).bytes, bound.bytes);
  const reordered = { ...binding, resources: binding.resources.toReversed().map(entry => Object.fromEntries(Object.entries(entry).toReversed())),
    modes: binding.modes.toReversed() };
  assert.deepEqual(compileBoundResourceControl(checked, reordered).bytes, bound.bytes, 'equivalent mapping order does not change installation identity');
  for (const mutate of [
    value => value.resources.pop(), value => value.modes.pop(), value => { value.artifactSha256 = '0'.repeat(64); },
    value => { value.resources[1].resourceId = value.resources[2].resourceId; },
    value => { value.resources[1].output = 'missing'; }, value => { value.policy = { require: false }; },
  ]) {
    const invalid = clone(binding); mutate(invalid);
    assert.throws(() => compileBoundResourceControl(checked, invalid), /binding/);
  }
  assert.throws(() => compile(document.replace('output pump, valve: Bool;', 'output pump, valve, bypass: Bool;\n  bypass <- manual_request;')), /every output/);
  assert.throws(() => compile(document.replace('input automatic, manual,', 'input extra: Int;\n  input automatic, manual,')), /only a Bool/);
  assert.throws(() => compile(document.replace('  constraints SharedRules for station {', '  constraints Opposite for pump1 { require at safe_output valve1.on == true; safe { pump1 = true; valve1 = true; } }\n  constraints SharedRules for station {')), /incompatible authored safe/);
  assert.throws(() => compile(document.replace('    exclusive at admission { automatic, manual };',
    '    exclusive at admission { automatic, manual };\n    exclusive at admission { automatic, manual };')), /multiple exclusive sets/);
});

test('bound browser compiler retains and verifies exact interaction identity after executable binding', async () => {
  const { binding, checked: original } = compile();
  const identity = { documentId: 'browser-bound-document', revisionId: 'browser-bound-revision' };
  const checked = await compileSource(document, { filename, interactionSourceIdentity: identity });
  assert.deepEqual(checked.bytes, original.bytes, 'interaction identity does not alter checked source bytes');
  const bound = compileBoundResourceControl(checked, binding);
  const verified = verifyBoundResourceCompilation(bound);
  assert.deepEqual(verified.interactionSchema, bound.interactionSchema);
  assert.deepEqual(bound.interactionSourceIdentity, identity);
  assert.equal(bound.interactionSchema.source.sha256, checked.sourceDocument.sha256);
  assert.equal(bound.interactionSchema.module.bytecodeSha256, bound.manifest.bytecodeSha256);
  assert.notEqual(bound.interactionSchema.module.bytecodeSha256, checked.interactionSchema.module.bytecodeSha256);
  assert.deepEqual(bound.manifest.inputs, checked.manifest.control.inputs);
  assert.deepEqual(bound.manifest.outputs, checked.manifest.control.outputs);
  const runtime = await BoundResourceControlRuntime.instantiate(wasm(), bound);
  try {
    const outcome = runtime.scan(frame(bound, rows[3], 0));
    const observer = prepareCompletedScanSnapshot({ compilation: bound, runId: 'browser-bound-run' });
    const snapshot = observer.emit({ completion: { kind: 'completed-scan', scanId: outcome.scanId,
      logicalTimeMs: outcome.logicalTimeMs }, trace: outcome.trace });
    assert.equal(snapshot.source.documentId, identity.documentId);
    assert.equal(snapshot.source.revisionId, identity.revisionId);
    assert.equal(snapshot.module.bytecodeSha256, bound.manifest.bytecodeSha256);
  } finally { runtime.dispose(); }
  const forged = { ...bound, interactionSchema: clone(bound.interactionSchema) };
  forged.interactionSchema.module.bytecodeSha256 = checked.manifest.bytecodeSha256;
  assert.throws(() => verifyBoundResourceCompilation(forged), /metadata differs/);
});

test('portable bound runtime reserves pending writers and shares the concrete Node import registry', async () => {
  const { bound } = compile(document, 'virtual/browser-pending');
  assert.equal(NodeBoundRuntime, BoundResourceControlRuntime);
  const pending = BoundResourceControlRuntime.instantiate(wasm(), bound);
  await assert.rejects(NodeBoundRuntime.instantiate(wasm(), bound), /active writer/);
  const runtime = await pending;
  assert.deepEqual(runtime.scan(frame(bound, rows[3], 0)).trace.safe, { pump: true, valve: true });
  runtime.dispose(); runtime.dispose();
  assert.throws(() => runtime.scan(frame(bound, rows[3], 1)), /disposed/);
  const replacement = await NodeBoundRuntime.instantiate(wasm(), bound);
  try { assert.equal(replacement.scan(frame(bound, rows[3], 0)).scanId, 0); }
  finally { replacement.dispose(); }
});

test('GF-TEST-bound-resource-parity: automatic manual fallback admission violation recovery and trace match native plain framed and simulation', async t => {
  const { bound } = compile();
  const files = temporary(t, bound);
  const executable = path.join(root, 'target/release/examples/resource_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const native = () => execFileSync(executable, [...files, ...rows.map(values => bound.manifest.inputs
    .map((port, index) => `${port.name}=${values[index]}`).join(','))], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
  const expected = native();
  assert.deepEqual(native(), expected);
  assert.deepEqual(expected[0].safe, {}, 'denied start must not dispatch an authored safe vector as new actuation');
  assert.equal(expected[1].safe.pump, undefined, 'recovering evidence is not a new start');
  assert.deepEqual(expected[3].safe, { pump: true, valve: true });
  assert.deepEqual(expected[4].safe, expected[3].safe, 'conflicting newcomer retains incumbent output');
  assert.equal(expected[5].safe.pump, false, 'a rejected newcomer is not a queued start');
  assert.deepEqual(expected[7].safe, { pump: true, valve: true });
  assert.deepEqual(expected[8].safe, { pump: false, valve: true }, 'authored safe is not universal OFF');
  assert.deepEqual(expected[9].safe, expected[8].safe);
  assert.deepEqual(expected[11].safe, { pump: true, valve: true });
  assert.deepEqual(expected[12].safe, { pump: false, valve: true });
  assert.ok(expected.every(trace => Array.isArray(trace.resourceTrace) && trace.resourceTrace.length > 0));
  const observations = observeBoundResourceTrace(bound, expected[8]);
  assert.equal(observations[0].evidence, 'executed');
  assert.equal(observations[0].source.nodeId, bound.manifest.sharedResourceConstraints[0].source.nodeId);
  assert.equal(observations[0].ruleSource.nodeId, bound.manifest.sharedResourceConstraints[0].rules.find(rule => rule.kind === 'require').source.nodeId);
  const tampered = clone(expected[8]); tampered.resourceTrace[0].bindingHash = '0'.repeat(64);
  assert.throws(() => observeBoundResourceTrace(bound, tampered), /identity/);
  assert.throws(() => observeBoundResourceTrace(bound, { ...expected[8], module: 'wrong' }), /identity/);
  for (const change of [
    group => { group.source = { nodeId: 'forged-node', line: 999999, column: 999999 }; },
    group => { group.rules.find(rule => rule.kind === 'require').source.line = 999999; },
  ]) {
    const forged = { ...bound, manifest: clone(bound.manifest) }; change(forged.manifest.sharedResourceConstraints[0]);
    assert.throws(() => observeBoundResourceTrace(forged, expected[8]), /metadata differs/);
    await assert.rejects(BoundResourceControlRuntime.instantiate(wasm(), forged), /metadata differs/);
  }
  for (const Runtime of [GhostFlowRuntime, FramedGhostFlowRuntime]) {
    const runtime = await Runtime.instantiate(wasm());
    try {
      runtime.load(bound.bytes);
      for (const output of bound.manifest.outputs) runtime.addCapability('actuator', output.name, 'bool');
      assert.throws(() => runtime.activate(), /binding/);
      runtime.activateResourceBinding(bound.resourceBindingActivation);
      const actual = rows.map((values, scanId) => {
        if (Runtime === FramedGhostFlowRuntime) return runtime.scanResourceBinding(frame(bound, values, scanId), bound.resourceBindingScan).trace;
        for (const [index, port] of bound.manifest.inputs.entries()) runtime.setBool(port.name, values[index]);
        runtime.tickResourceBinding(bound.resourceBindingScan); return clone(runtime.trace);
      });
      assert.deepEqual(actual, expected);
    } finally { runtime.dispose(); }
  }
  assert.deepEqual((await simulateBoundResourceControl(wasm(), bound, rows.map((values, index) => frame(bound, values, index))))
    .map(outcome => outcome.trace), expected);
  const translated = fs.readFileSync(path.join(root, 'examples/bound-resource-execution.ghost.ko.md'), 'utf8');
  for (const language of ['ghost', 'js']) {
    const pattern = new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```');
    assert.equal(document.match(pattern)[1], translated.match(pattern)[1]);
  }
  const demonstration = execFileSync(process.execPath, ['--input-type=module', '-e', document.match(/```js\n([\s\S]*?)\n```/)[1]], { cwd: root, encoding: 'utf8' })
    .trim().split('\n').map(JSON.parse);
  assert.deepEqual(demonstration.map(trace => trace.safe), [{ pump: true, valve: true }, { pump: false, valve: true },
    { pump: false, valve: true }, { pump: false, valve: true }, { pump: true, valve: true }]);
});

test('GF-TEST-bound-resource-bypass: binding every scan atomic retry source forgery and duplicate writers fail closed', async () => {
  const { bound } = compile(document, 'virtual/bypass');
  const runtime = await FramedGhostFlowRuntime.instantiate(wasm());
  try {
    runtime.load(bound.bytes);
    for (const output of bound.manifest.outputs) runtime.addCapability('actuator', output.name, 'bool');
    const wrong = bound.resourceBindingActivation.slice(); wrong[wrong.length - 1] ^= 1;
    assert.throws(() => runtime.activateResourceBinding(wrong), /binding/);
    runtime.activateResourceBinding(bound.resourceBindingActivation);
    const first = frame(bound, rows[3], 0);
    assert.throws(() => runtime.scan(first), /binding/);
    const stale = bound.resourceBindingScan.slice(); stale[stale.length - 1] ^= 1;
    assert.throws(() => runtime.scanResourceBinding(first, stale), /binding/);
    const invalid = { ...first, inputs: first.inputs.slice(1) };
    assert.throws(() => runtime.scanResourceBinding(invalid, bound.resourceBindingScan), /input/);
    const accepted = runtime.scanResourceBinding(first, bound.resourceBindingScan);
    assert.equal(accepted.scanId, 0); assert.equal(accepted.trace.tick, 1);
    assert.deepEqual(accepted.trace.safe, { pump: true, valve: true });
    assert.throws(() => runtime.scanResourceBinding({ ...first, scanId: 1, logicalTimeMs: 1 }, stale), /binding/);
    assert.equal(runtime.scanResourceBinding({ ...first, scanId: 1, logicalTimeMs: 1 }, bound.resourceBindingScan).trace.tick, 2);
  } finally { runtime.dispose(); }
  const writer = await BoundResourceControlRuntime.instantiate(wasm(), bound);
  try {
    await assert.rejects(BoundResourceControlRuntime.instantiate(wasm(), bound), /active writer/);
    const forged = { ...bound, bytes: bound.bytes.slice() }; forged.bytes[forged.bytes.length - 1] ^= 1;
    await assert.rejects(BoundResourceControlRuntime.instantiate(wasm(), forged), /differs/);
    assert.throws(() => new BoundResourceControlRuntime(), /instantiate/);
  } finally { writer.dispose(); }
  const replacement = await BoundResourceControlRuntime.instantiate(wasm(), bound); replacement.dispose();
  assert.throws(() => replacement.scan(frame(bound, rows[3], 0)), /disposed/);
  const other = compile(document, 'virtual/allocation-failure').bound;
  await assert.rejects(BoundResourceControlRuntime.instantiate(new Uint8Array([0]), other), /WebAssembly|magic|buffer/);
  const afterFailure = await BoundResourceControlRuntime.instantiate(wasm(), other); afterFailure.dispose();
});

test('GF-TEST-bound-resource-overlap: mandatory finite predicates and local safety combine without declaration-order priority', async t => {
  const extra = `  constraints Capacity for pump1 {
    require at safe_output count_on({ valve1 }) >= 1;
    require at safe_output count_on({ valve1 }) <= 1;
    require at safe_output count_on({ valve1 }) > 0;
    require at safe_output count_on({ valve1 }) == 1;
    require at safe_output count_on({}) < 1;
    require at safe_output any_on({}) == false;
    require at safe_output true != false;
    safe { pump1 = false; valve1 = true; }
  }
`;
  const source = document.replace('  constraints SharedRules for station {', `${extra}  constraints SharedRules for station {`);
  const { bound } = compile(source, 'virtual/overlap');
  const files = temporary(t, bound);
  const executable = path.join(root, 'target/release/examples/resource_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const sequence = [rows[3], rows[8], rows[9], rows[10], rows[7]];
  const traces = execFileSync(executable, [...files, ...sequence.map(values => bound.manifest.inputs
    .map((port, index) => `${port.name}=${values[index]}`).join(','))], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
  assert.deepEqual(traces[1].safe, { pump: false, valve: true });
  assert.ok(traces[1].resourceTrace.every(group => group.tripped), 'overlapping groups trip together');
  const outcomes = await simulateBoundResourceControl(wasm(), bound, sequence.map((values, index) => frame(bound, values, index)));
  assert.deepEqual(outcomes.map(outcome => outcome.trace), traces);
  const reversed = source.replace(extra, '').replace('    safe { pump1 = false; valve1 = true; }\n  }\n}',
    `    safe { pump1 = false; valve1 = true; }\n  }\n${extra}}`);
  const reverse = compile(reversed, 'virtual/reverse').bound;
  assert.deepEqual((await simulateBoundResourceControl(wasm(), reverse, sequence.map((values, index) => frame(reverse, values, index))))
    .map(outcome => outcome.trace.safe), traces.map(trace => trace.safe));
  assert.throws(() => compile(document.replace('  constraints SharedRules for station {',
    '  require valve => pump;\n  constraints SharedRules for station {'), 'virtual/local-incompatible'), /safe vector conflicts with mandatory local/);
  const compatible = compile(document.replace('  constraints SharedRules for station {',
    '  require pump => valve;\n  mutex(pump, valve);\n  constraints SharedRules for station {'), 'virtual/local-compatible').bound;
  assert.equal(compatible.manifest.executable, true, 'explicit safe vector satisfies compatible local AND constraints');
});
