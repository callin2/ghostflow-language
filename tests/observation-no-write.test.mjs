import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { verifyInteractionSchema } from '../tools/interaction-schema.mjs';
import { prepareCompletedScanSnapshot, joinRuntimeSnapshot } from '../tools/interaction-runtime-snapshot.mjs';
import { validateInteraction } from '../contracts/interaction-v0/validate.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const nativePath = path.join(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`);
const activation = { bootEpoch: 1, terminalCapacity: 8, bindings: [] };
const source = [
  '# Observation does not authorize writes', '',
  '<!-- ghostflow:anchor id=GF-INT-REF-05-020 kind=intent status=confirmed origin=user -->',
  'Issue [#281](https://github.com/callin2/ghostflow-language/issues/281) verifies REF-05-020: state and timer observations remain read-only; output visibility cannot create a settings target.', '',
  '```ghost', 'control ReadOnlyObservation {',
  '  // ghostflow:link id=GF-INT-REF-05-020 relation=implements',
  '  config enabled: Bool = true { access = operator; label = "Enabled"; }',
  '  // ghostflow:link id=GF-INT-REF-05-020 relation=implements',
  '  state running: Bool = false;',
  '  // ghostflow:link id=GF-INT-REF-05-020 relation=implements',
  '  timer age = elapsed(running);',
  '  output pump: Bool;',
  "  running' = case enabled { ok(value) => value; fault(_) => false; };",
  '  // ghostflow:link id=GF-INT-REF-05-020 relation=implements',
  "  pump <- running';", '}', '```', '',
].join('\n');

async function artifact() {
  return compileSource(source, { filename: 'observation-no-write.ghost.md', interactionSourceIdentity: {
    documentId: 'source.ref-05-020', revisionId: 'revision.ref-05-020.1',
  } });
}
function facts(now, settings = null) {
  return { clock: { monotonicMs: now, bootEpoch: 1, wallMs: now, uncertaintyMs: 0,
    trusted: true, unknownReason: null, sourceRevision: 'clock.ref-05-020' },
  natural: [], schedules: [], settings };
}
const checkpoint = runtime => Buffer.from(runtime.contextSnapshot().bytes).toString('hex');
function packet(fingerprint, target, eventId = 'write-request') {
  return { programFingerprint: fingerprint, eventId, baseRevision: 0, position: 2,
    origin: 'operatorEdit', changes: [{ configId: target, result: { ok: true, type: 'Bool', value: false } }] };
}

test('REF-05-020 canonical observation metadata rejects forged write capabilities without mutating completed runtime', async () => {
  const compiled = await artifact();
  const runtime = await ControlRuntime.instantiateFramed(wasm, compiled, { context: activation });
  try {
    const completed = runtime.step({ nowMs: 0, inputs: {}, contextFacts: facts(0) });
    const producer = prepareCompletedScanSnapshot({ compilation: compiled, runId: 'run.ref-05-020' });
    const state = runtime.contextSnapshot().state;
    const before = checkpoint(runtime);
    const request = { completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 }, trace: completed.vm, settingsState: state };
    const snapshot = producer.emit(request);
    assert.deepEqual(joinRuntimeSnapshot(compiled.interactionSchema, snapshot, producer.expected), { status: 'ready', staleReasons: [] });
    const descriptors = compiled.interactionSchema.descriptors;
    assert.deepEqual(descriptors.filter(d => d.kind !== 'setting').map(d => [d.kind, d.name, d.access]), [
      ['state', 'running', ['read']], ['timer', 'age', ['read']],
    ]);
    assert.equal(descriptors.some(d => d.name === 'pump'), false, 'v0 exposes no output edit descriptor');
    assert.deepEqual(compiled.manifest.outputs, [{ name: 'pump', type: 'Bool' }]);
    assert.deepEqual(snapshot.observations.filter(o => o.descriptorId !== 'setting.enabled'), [
      { descriptorId: 'state.running', status: 'ready', value: true },
      { descriptorId: 'timer.age', status: 'ready', value: 0 },
    ]);
    assert.equal(completed.vm.safe.pump, true);

    const mutations = [
      ['write state', schema => { schema.descriptors.find(d => d.kind === 'state').access = ['read', 'write']; }],
      ['execute timer', schema => { schema.descriptors.find(d => d.kind === 'timer').access = ['execute']; }],
      ['invent output', schema => { const d = structuredClone(schema.descriptors.find(d => d.kind === 'state')); d.id = 'output.pump'; d.name = 'pump'; d.kind = 'output'; d.access = ['read', 'write']; schema.descriptors.push(d); }],
      ['reclassify state as setting', schema => { const d = schema.descriptors.find(d => d.kind === 'state'); d.kind = 'setting'; d.access = ['write']; }],
    ];
    for (const [label, mutate] of mutations) {
      const schema = structuredClone(compiled.interactionSchema);
      mutate(schema);
      assert.equal(validateInteraction(schema, snapshot).valid, false, label);
      assert.throws(() => verifyInteractionSchema(compiled, schema), /interaction schema:/, label);
      assert.throws(() => prepareCompletedScanSnapshot({ compilation: compiled, schema, runId: 'run.ref-05-020' }), /interaction schema:/, label);
      const forgedCompilation = { ...compiled, interactionSchema: schema };
      assert.throws(() => prepareCompletedScanSnapshot({ compilation: forgedCompilation, schema, runId: 'run.ref-05-020' }), /interaction schema:/, `${label}: forging both copies cannot bypass canonical reconstruction`);
      assert.equal(checkpoint(runtime), before, label);
      assert.deepEqual(producer.emit(request), snapshot, label);
    }
    assert.equal(checkpoint(runtime), before);
    assert.equal(runtime.step({ nowMs: 1_000, inputs: {}, contextFacts: facts(1_000) }).vm.safe.pump, true);
  } finally { runtime.dispose(); }
});

test('REF-05-020 actual native and WASM settings requests cannot address observed state timer or output', async () => {
  const compiled = await artifact();
  const configId = compiled.manifest.configs[0].id;
  const targets = compiled.sourceMap.filter(node => ['state', 'timer', 'output'].includes(node.kind));
  assert.ok(targets.some(node => node.kind === 'state'));
  assert.ok(targets.some(node => node.kind === 'timer'));
  assert.ok(targets.some(node => node.kind === 'output'));
  for (const target of targets) {
    assert.notEqual(target.id, configId, 'authored non-config identity is distinct from the setting');
    const runtime = await ControlRuntime.instantiateFramed(wasm, compiled, { context: activation });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-observation-no-write-'));
    try {
      const initial = runtime.step({ nowMs: 0, inputs: {}, contextFacts: facts(0) });
      const before = checkpoint(runtime), stateBefore = runtime.contextSnapshot().state;
      const settings = packet(stateBefore.programFingerprint, target.id, `cannot-write-${target.kind}-${target.id}`);
      assert.throws(() => runtime.step({ nowMs: 1_000, inputs: {}, contextFacts: facts(1_000, settings) }), /unknown settings stream target/i);
      assert.equal(checkpoint(runtime), before, target.kind);
      assert.deepEqual(runtime.contextSnapshot().state, stateBefore, target.kind);

      const resumed = runtime.step({ nowMs: 1_000, inputs: {}, contextFacts: facts(1_000) });
      const control = await ControlRuntime.instantiateFramed(wasm, compiled, { context: activation });
      try {
        control.step({ nowMs: 0, inputs: {}, contextFacts: facts(0) });
        const unchanged = control.step({ nowMs: 1_000, inputs: {}, contextFacts: facts(1_000) });
        assert.deepEqual(resumed.vm, unchanged.vm, 'rejected write leaves state, timer and requested/safe outputs identical to a no-request execution');
        assert.equal(checkpoint(runtime), checkpoint(control));
      } finally { control.dispose(); }
      const resumedCheckpoint = checkpoint(runtime), resumedSettings = runtime.contextSnapshot().state;
      const allowed = { ...packet(stateBefore.programFingerprint, configId, `allowed-config-${target.id}`), position: 3 };
      const after = runtime.step({ nowMs: 2_000, inputs: {}, contextFacts: facts(2_000, allowed) });
      const frames = [
        { scanId: 0, logicalTimeMs: 0, inputs: [], ...facts(0) },
        { scanId: 1, logicalTimeMs: 1_000, inputs: [], ...facts(1_000, settings) },
        { scanId: 1, logicalTimeMs: 1_000, inputs: [], ...facts(1_000) },
        { scanId: 2, logicalTimeMs: 2_000, inputs: [], ...facts(2_000, allowed) },
      ];
      const modulePath = path.join(directory, 'module.gfb'), tapePath = path.join(directory, 'tape.json');
      fs.writeFileSync(modulePath, compiled.bytes);
      fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-civil-v1', activation, steps: frames }));
      const native = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
      assert.equal(native.status, 0, native.stderr || native.stdout);
      const rows = native.stdout.trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(rows.map(row => row.accepted), [true, false, true, true]);
      assert.deepEqual(rows[0].outcome.trace, initial.vm);
      assert.equal(rows[0].checkpoint, before);
      assert.match(rows[1].error, /unknown settings stream target/i);
      assert.equal(rows[1].checkpoint, before);
      assert.deepEqual(rows[1].settings, stateBefore);
      assert.deepEqual(rows[2].outcome.trace, resumed.vm);
      assert.equal(rows[2].checkpoint, resumedCheckpoint);
      assert.deepEqual(rows[2].settings, resumedSettings);
      assert.equal(rows[2].outcome.trace.safe.pump, true);
      assert.deepEqual(rows[3].outcome.trace, after.vm);
      assert.equal(rows[3].checkpoint, checkpoint(runtime));
      assert.deepEqual(rows[3].settings, runtime.contextSnapshot().state);
      assert.equal(after.vm.safe.pump, false, 'a declared operator config remains editable');
      assert.equal(rows[3].settings.settingsRevision, 1);
    } finally {
      runtime.dispose();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});
