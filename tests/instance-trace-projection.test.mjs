import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { activateInstanceTraceProjection } from '../tools/instance-trace-projection.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import fs from 'node:fs';

const wasmBytes = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const doc = code => `# REF-06-003 projection\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const relay = doc(`control Relay {
  input start: Bool;
  state held: Bool = false;
  held' = start || held;
  output active: Bool;
  active <- held';
}`);
const source = doc(`import Relay from "./relay.ghost.md" revision "relay-r1" sha256 "${sha256Hex(relay)}";
control Farm {
  input east_start, west_start: Bool;
  output east_pump, west_pump: Bool;
  instance east: Relay;
  instance west: Relay;
  connect east.start <- east_start;
  connect west.start <- west_start;
  connect east_pump <- east.active;
  connect west_pump <- west.active;
}`);

async function artifact() {
  return compileSource(source, { filename: 'farm.ghost.md', sourceClosure: [{ filename: 'relay.ghost.md', revision: 'relay-r1', text: relay }] });
}

async function oneTrace(compiled) {
  const runtime = await ControlRuntime.instantiateFramed(wasmBytes, compiled);
  try {
    runtime.step({ nowMs: 0, inputs: { east_start: true, west_start: false } });
    return structuredClone(runtime.runtime.outcome.trace);
  } finally {
    runtime.dispose();
  }
}

function mutate(value, edit) {
  const copy = structuredClone(value);
  edit(copy);
  return copy;
}

test('REF-06-003 production projection activation owns source, closure, manifest and trace identity', async () => {
  const compiled = await artifact();
  const owner = await activateInstanceTraceProjection(compiled, { presentationRevision: 'panel-r1', labels: { east: 'East pump', west: 'West pump' } });
  assert.deepEqual(owner.activation.instanceIds, ['east', 'west']);
  const trace = await oneTrace(compiled);
  const projected = owner.projectTrace(trace);
  assert.equal(projected.format, 'GhostFlow/instance-trace-projection-v1');
  assert.equal(projected.sourceDocumentSha256, compiled.sourceDocument.sha256);
  assert.equal(projected.bytecodeSha256, compiled.manifest.bytecodeSha256);
  assert.ok(projected.entries.some(entry => entry.key === 'east.held' && entry.displayName === 'East pump'));
  assert.ok(projected.entries.some(entry => entry.key === 'west.held' && entry.displayName === 'West pump'));
  assert.throws(() => { owner.activation.instanceIds.push('mutated'); }, /object is not extensible|read only|Cannot add/);
  assert.deepEqual(owner.activation.instanceIds, ['east', 'west'], 'caller cannot mutate owned activation identity');
  compiled.sourceMap[0].line = 999;
  assert.deepEqual(owner.projectTrace(trace), projected, 'activation owns caller artifact metadata');
  await assert.rejects(() => activateInstanceTraceProjection(compiled, {presentationRevision: 'tampered-map', labels: {east: 'East', west: 'West'}}), /source map provenance/);

  await assert.rejects(() => activateInstanceTraceProjection(mutate(compiled, a => { a.sourceDocument.text += ' '; }), { presentationRevision: 'x', labels: { east: 'East', west: 'West' } }), /source document content hash|compiled bytecode provenance/);
  await assert.rejects(() => activateInstanceTraceProjection(mutate(compiled, a => { a.sourceClosure.documents[0].text += ' '; }), { presentationRevision: 'x', labels: { east: 'East', west: 'West' } }), /source closure document .*content hash|compiled bytecode provenance/);
  await assert.rejects(() => activateInstanceTraceProjection(mutate(compiled, a => { a.manifest.outputs[0].name = 'forged'; }), { presentationRevision: 'x', labels: { east: 'East', west: 'West' } }), /manifest provenance mismatch/);
  await assert.rejects(() => activateInstanceTraceProjection(mutate(compiled, a => { a.traceMetadata.bindings[0].nodeId = 999999; }), { presentationRevision: 'x', labels: { east: 'East', west: 'West' } }), /source trace metadata provenance mismatch/);
});

test('REF-06-003 projection rejects malformed labels, unknown trace identities and supports fresh replay', async () => {
  const compiled = await artifact();
  await assert.rejects(() => activateInstanceTraceProjection(compiled, { presentationRevision: 'x', labels: { east: 'East' } }), /presentation labels/);
  await assert.rejects(() => activateInstanceTraceProjection(compiled, { presentationRevision: 'x', labels: { east: 'East', west: 'Bad\nLabel' } }), /control characters/);
  await assert.rejects(() => activateInstanceTraceProjection(compiled, { presentationRevision: 'x', labels: { east: 'East', west: ' ' } }), /non-empty/);
  await assert.rejects(() => activateInstanceTraceProjection(compiled, { sourceRevision: 'wrong-source-field', labels: { east: 'East', west: 'West' } }), /metadata/);
  await assert.rejects(() => activateInstanceTraceProjection(mutate(compiled, a => { a.sourceClosure.instances[0].instance = 'ghost'; }), { presentationRevision: 'x', labels: { ghost: 'Ghost', west: 'West' } }), /source closure provenance mismatch|compiled bytecode provenance|source closure instance identity/);

  const owner = await activateInstanceTraceProjection(compiled, { presentationRevision: 'panel-r2', labels: { east: 'East', west: 'West' } });
  const trace = await oneTrace(compiled);
  assert.throws(() => owner.projectTrace({ ...trace, module: '0000000000000000' }), /trace identity/);
  assert.deepEqual(owner.projectTrace(trace), owner.projectTrace(structuredClone(trace)), 'complete fresh projection replay is deterministic');
  const presentation = {presentationRevision: 'panel-owned', labels: {east: 'East', west: 'West'}};
  const activation = activateInstanceTraceProjection(compiled, presentation);
  presentation.labels.east = 'mutated';presentation.presentationRevision = 'changed';
  const owned = await activation;
  assert.equal(owned.activation.presentations[0].displayName, 'East');assert.equal(owned.activation.presentationRevision, 'panel-owned');
  const fresh = await activateInstanceTraceProjection(await artifact(), {presentationRevision: 'panel-owned', labels: {east: 'East', west: 'West'}});
  assert.deepEqual(fresh.projectTrace(trace), owned.projectTrace(trace), 'complete newly activated projection replay');
});

test('REF-06-003 adjacent and multiline authored states retain distinct public symbols without private slot or node-order identity', async () => {
  const definition = doc("control Relay { input start: Bool; state first: Bool = false; state\n second: Bool = true; first' = start; second' = !start; output active: Bool; active <- first'; }");
  const root = source.replace(sha256Hex(relay), sha256Hex(definition));
  const compiled = await compileSource(root, {filename: 'farm.ghost.md', sourceClosure: [{filename: 'relay.ghost.md', revision: 'relay-r1', text: definition}]});
  const owner = await activateInstanceTraceProjection(compiled, {presentationRevision: 'panel-adjacent', labels: {east: 'East', west: 'West'}});
  const projected = owner.projectTrace(await oneTrace(compiled));
  assert.deepEqual(projected.entries.filter(e => e.kind === 'state').map(e => e.key).sort(), ['east.first', 'east.second', 'west.first', 'west.second']);
  assert.ok(projected.entries.every(e => !e.key.includes('instance_') && !e.key.includes('__gf_') && !e.key.includes('#')));
});
