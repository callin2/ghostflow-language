import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { jsonSha256 } from '../tools/integration-contract.mjs';
import { ProgramReplacementHost } from '../runtimes/wasm/program-replacement-host.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const document = (body) => `# Replacement fixture\n\n\`\`\`ghost\n${body}\n\`\`\`\n`;
const initial = document(`control Replaceable {
  input enabled: Bool;
  state held: Bool = false;
  held' = enabled |> recover(false);
  output pump: Bool;
  pump <- held';
}`);
const compatible = document(`control Replaceable {
  input enabled: Bool;
  state held: Bool = false;
  state fresh: Int = 7;
  held' = enabled |> recover(false);
  fresh' = fresh + 1;
  output pump: Bool;
  pump <- held';
}`);
const missingPort = document(`control Replaceable {
  input enabled: Bool;
  state held: Bool = false;
  held' = enabled |> recover(false);
  output pump, extra: Bool;
  pump <- held';
  extra <- true;
}`);
const changedStateType = document(`control Replaceable {
  input enabled: Bool;
  state held: Int = 0;
  held' = if (enabled |> recover(false)) then 1 else 0;
  output pump: Bool;
  pump <- held' == 1;
}`);
const compile = (source, name = 'replaceable.ghost.md') => compileSourceSync(source, { filename: name });
function installed({ input = true } = {}) {
  const boardProfile = { schema: 'GhostFlow/board-profile-v1', id: 'reference-board', revision: 'r1',
    boardModel: 'VIRTUAL', endpoints: {
      output: { direction: 'output', type: 'Bool', driver: 'virtual-output', address: 'output/1', activeLevel: 'high', safeLevel: 0 },
      input: { direction: 'input', type: 'Bool', driver: 'virtual-input', address: 'input/1', activeLevel: 'high', safeLevel: 0 },
    } };
  const profile = { id: boardProfile.id, revision: boardProfile.revision, sha256: jsonSha256(boardProfile) };
  const installation = { schema: 'GhostFlow/installation-mapping-v1', id: 'reference-site', revision: 'r1',
    boardProfile: profile, bindings: { pump: 'output', ...(input ? { enabled: 'input' } : {}) } };
  const release = { schema: 'GhostFlow/integration-release-v1',
    toolchain: { version: 'reference-toolchain', sha256: '1'.repeat(64) },
    runtimeSemanticsVersion: 'reference-runtime', bytecodeFormat: 'GFB1', protocolVersion: 'reference-protocol',
    device: { firmwareSha256: '2'.repeat(64), boardProfile: profile },
    installation: { id: installation.id, revision: installation.revision, sha256: jsonSha256(installation) } };
  return { release, boardProfile, installation };
}
const observed = (value, observationId = 'observation-1') => ({ enabled: { ok: true, value,
  source: 'virtual-input', observationId } });
const faulted = () => ({ enabled: { ok: false, fault: 'Disconnected', source: 'virtual-input', observationId: 'fault-1' } });

test('REF-06-020 installation must bind each required logical sensor before activation', async () => {
  await assert.rejects(ProgramReplacementHost.instantiate(wasm, compile(initial), {
    runId: 'run-before', ...installed({ input: false }),
  }), /missing input binding enabled/);
});

test('REF-06-020 rejected candidate preserves previous Program, run and accepted trace', async t => {
  const artifact = compile(initial);
  const host = await ProgramReplacementHost.instantiate(wasm, artifact, { runId: 'run-before', ...installed() });
  t.after(() => host.dispose());
  const first = host.step({ observations: observed(true) });
  assert.equal(first.trace.safe.pump, true);
  const before = host.snapshot();
  assert.throws(() => host.replace({ artifact: compile(missingPort), runId: 'run-rejected' }), /missing_binding/);
  assert.deepEqual(host.snapshot(), before);
  assert.throws(() => host.replace({ artifact: compile(changedStateType), runId: 'run-rejected' }), /state type change requires explicit migration/);
  assert.deepEqual(host.snapshot(), before);
  const next = host.step({ observations: observed(false, 'observation-2') });
  assert.equal(next.trace.stateBefore.held, true);
  assert.equal(next.trace.safe.pump, false);
  assert.equal(next.identity.runId, 'run-before');
});

test('REF-06-022 successful replacement publishes new identities and requires a fresh complete input snapshot', async t => {
  const old = compile(initial), next = compile(compatible);
  const host = await ProgramReplacementHost.instantiate(wasm, old, { runId: 'run-before', ...installed(), historyCapacity: 2 });
  t.after(() => host.dispose());
  const first = host.step({ observations: observed(true) });
  assert.equal(first.trace.stateAfter.held, true);
  const prior = host.snapshot();
  const replaced = host.replace({ artifact: next, runId: 'run-after' });
  assert.equal(replaced.identity.runId, 'run-after');
  assert.equal(replaced.identity.sourceSha256, next.sourceDocument.sha256);
  assert.equal(replaced.identity.artifactSha256, next.manifest.bytecodeSha256);
  assert.notEqual(replaced.identity.sourceSha256, prior.identity.sourceSha256);
  assert.notEqual(replaced.identity.artifactSha256, prior.identity.artifactSha256);
  assert.equal(replaced.latest, null);
  assert.throws(() => host.step({ observations: {} }), /complete input observation snapshot required/);
  const result = host.step({ observations: faulted() });
  assert.equal(result.trace.stateBefore.held, true);
  assert.equal(result.trace.stateAfter.fresh, 8);
  assert.equal(result.trace.safe.pump, false);
  assert.deepEqual(result.observations, faulted());
  assert.equal(result.identity.runId, 'run-after');
  assert.throws(() => host.replace({ artifact: old, runId: 'run-before' }), /new runId required/);
  assert.throws(() => host.replace({ artifact: old, runId: 'run-third' }), /capacity exhausted/);
  result.trace.stateAfter.held = 'forged';
  result.observations.enabled.source = 'forged';
  replaced.runs.length = 0;
  assert.equal(host.snapshot().latest.trace.stateAfter.held, false);
  assert.equal(host.snapshot().latest.observations.enabled.source, 'virtual-input');
  assert.equal(host.snapshot().runs.length, 2);
});

test('candidate validation and malformed input fail before changing active state', async t => {
  const artifact = compile(initial);
  const host = await ProgramReplacementHost.instantiate(wasm, artifact, { runId: 'run-before', ...installed() });
  t.after(() => host.dispose());
  const first = host.step({ observations: observed(true) });
  const before = host.snapshot();
  const tampered = structuredClone(compile(compatible));
  tampered.bytes[0] ^= 1;
  assert.throws(() => host.replace({ artifact: tampered, runId: 'run-bad' }), /digest mismatch/);
  assert.deepEqual(host.snapshot(), before);
  assert.throws(() => host.step({ observations: { enabled: { ...observed(false).enabled, value: 1 } } }), /input observation type/);
  assert.deepEqual(host.snapshot(), before);
  assert.deepEqual(first.identity, before.latest.identity);
});

test('source, closure and manifest forgery cannot cross the replacement boundary', async t => {
  const host = await ProgramReplacementHost.instantiate(wasm, compile(initial), { runId: 'run-before', ...installed() });
  t.after(() => host.dispose());
  host.step({ observations: observed(true) });
  const before = host.snapshot();
  const changedManifest = structuredClone(compile(compatible));
  changedManifest.manifest.outputs[0].name = 'other';
  assert.throws(() => host.replace({ artifact: changedManifest, runId: 'run-forged-manifest' }), /manifest or bytecode differs/);
  const changedSource = structuredClone(compile(compatible));
  changedSource.sourceDocument.text += '\n';
  assert.throws(() => host.replace({ artifact: changedSource, runId: 'run-forged-source' }), /source or artifact digest mismatch/);
  const changedClosure = structuredClone(compile(compatible));
  changedClosure.sourceClosure = { format: 'GhostFlow/source-closure-v1', documents: [], instances: [] };
  assert.throws(() => host.replace({ artifact: changedClosure, runId: 'run-forged-closure' }), /closure|unsupported Program profile/);
  assert.deepEqual(host.snapshot(), before);
});

test('unsupported temporal and settings profiles reject without changing the active run', async t => {
  const host = await ProgramReplacementHost.instantiate(wasm, compile(initial), { runId: 'run-before', ...installed() });
  t.after(() => host.dispose());
  host.step({ observations: observed(true) });
  const before = host.snapshot();
  const timer = compile(document(`control Replaceable {
    input enabled: Bool;
    state held: Bool = false;
    held' = enabled |> recover(false);
    timer age = elapsed(held);
    output pump: Bool;
    pump <- held';
  }`));
  const settings = compile(document(`control Replaceable {
    input enabled: Bool;
    config duration: Duration = 5s { min = 1s; max = 10s; step = 1s; access = operator; }
    output pump: Bool;
    pump <- (enabled |> recover(false)) && case duration { ok(value) => value > 0s; fault(_) => false; };
  }`));
  for (const [candidate, runId] of [[timer, 'run-timer'], [settings, 'run-settings']]) {
    assert.throws(() => host.replace({ artifact: candidate, runId }), /unsupported Program profile/);
    assert.deepEqual(host.snapshot(), before);
  }
});

test('installation and accepted observations are copied from caller-owned records', async t => {
  const activation = installed(), original = compile(initial);
  const host = await ProgramReplacementHost.instantiate(wasm, original, { runId: 'run-before', ...activation });
  t.after(() => host.dispose());
  activation.installation.bindings.pump = 'missing';
  original.bytes[0] ^= 1;
  const input = observed(true);
  const result = host.step({ observations: input });
  input.enabled.value = false;
  input.enabled.source = 'forged-source';
  assert.equal(result.trace.safe.pump, true);
  assert.equal(host.snapshot().latest.observations.enabled.value, true);
  assert.equal(host.snapshot().latest.observations.enabled.source, 'virtual-input');
  assert.equal(host.replace({ artifact: compile(compatible), runId: 'run-after' }).identity.bindingRevision, 'r1');
});

test('known precommit arithmetic failure keeps the run and permits a complete recovery input', async t => {
  const overflow = compile(document(`control Replaceable {
    input enabled: Bool;
    state count: Int = 2147483646;
    count' = if (enabled |> recover(false)) then count + 1 else count;
    output pump: Bool;
    pump <- enabled |> recover(false);
  }`));
  const host = await ProgramReplacementHost.instantiate(wasm, overflow, { runId: 'run-overflow', ...installed() });
  t.after(() => host.dispose());
  assert.equal(host.step({ observations: observed(true) }).trace.stateAfter.count, 2147483647);
  const before = host.snapshot();
  assert.throws(() => host.step({ observations: observed(true, 'sample-overflow') }), /overflow/);
  assert.deepEqual(host.snapshot(), before);
  const recovered = host.step({ observations: observed(false, 'sample-recovery') });
  assert.equal(recovered.identity.runId, 'run-overflow');
  assert.equal(recovered.trace.stateBefore.count, 2147483647);
  assert.equal(recovered.trace.stateAfter.count, 2147483647);
  assert.equal(recovered.trace.safe.pump, false);
});

test('public constructor cannot bypass artifact and runtime verification', () => {
  assert.throws(() => new ProgramReplacementHost(), /fresh validated activation required/);
});
