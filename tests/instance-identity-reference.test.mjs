import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { observeSourceTrace } from '../tools/source-trace.mjs';
import { activateInstanceTraceProjection } from '../tools/instance-trace-projection.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const doc = code => `# REF-06-003 instance identity\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const relay = doc(`control Relay {
  input start, stop: Bool;
  state held: Bool = false;
  state ever: Bool = false;
  held' = !stop && (start || held);
  ever' = start || ever;
  output active, accepted: Bool;
  active <- held';
  accepted <- ever';
}`);
const pin = (alias, locator, revision = 'relay-r1', text = relay) =>
  `import ${alias} from "${locator}" revision "${revision}" sha256 "${sha256Hex(text)}";`;
const wasmBytes = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const nativePath = fileURLToPath(new URL(`../target/release/examples/scan_tape${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
const records = [
  { nowMs: 0, inputs: { east_start: true, east_stop: false, west_start: false, west_stop: false } },
  { nowMs: 1000, inputs: { east_start: false, east_stop: false, west_start: true, west_stop: false } },
  { nowMs: 2500, inputs: { east_start: false, east_stop: true, west_start: false, west_stop: false } },
  { nowMs: 4000, inputs: { east_start: false, east_stop: false, west_start: false, west_stop: true } },
];

function source({ locator, reversed = false, eastName = 'east', westName = 'west' }) {
  const declarations = [`instance ${eastName}: Relay;`, `instance ${westName}: Relay;`];
  const connections = [
    `connect ${eastName}.start <- east_start;`, `connect ${eastName}.stop <- east_stop;`,
    `connect ${westName}.start <- west_start;`, `connect ${westName}.stop <- west_stop;`,
    `connect east_pump <- ${eastName}.active;`, `connect west_pump <- ${westName}.active;`,
    `connect east_seen <- ${eastName}.accepted;`, `connect west_seen <- ${westName}.accepted;`,
  ];
  return doc(`${pin('Relay', locator)}\ncontrol Farm {
    input east_start, east_stop, west_start, west_stop: Bool;
    output east_pump, west_pump, east_seen, west_seen: Bool;
    ${(reversed ? [...declarations].reverse() : declarations).join('\n    ')}
    ${(reversed ? [...connections].reverse() : connections).join('\n    ')}
  }`);
}

async function compileVariant({ filename, locator, closureFilename, reversed = false, eastName = 'east', westName = 'west' }) {
  const compiled = await compileSource(source({ locator, reversed, eastName, westName }), {
    filename,
    sourceClosure: [{ filename: closureFilename, revision: 'relay-r1', text: relay }],
  });
  assert.equal(compiled.sourceClosure.documents.length, 1);
  assert.equal(compiled.sourceClosure.documents[0].text, relay);
  assert.equal(compiled.sourceClosure.documents[0].sha256, sha256Hex(relay));
  assert.equal(compiled.sourceClosure.documents[0].revision, 'relay-r1');
  return compiled;
}

function runNative(artifact, frames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-ref-06-003-'));
  try {
    const modulePath = path.join(dir, 'program.gfb');
    const tapePath = path.join(dir, 'frames.tsv');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(tapePath, frames.map(frame => [frame.scanId, frame.logicalTimeMs,
      ...frame.inputs.flatMap(input => [input.name, input.type === 'Bool' ? 'b' : 'n', input.value])].join('\t')).join('\n') + '\n');
    const result = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    const rows = result.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, frames.length);
    assert.ok(rows.every(row => row.accepted));
    return rows.map(row => row.outcome);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function execute(artifact, owner = null) {
  const runtime = await ControlRuntime.instantiateFramed(wasmBytes, artifact);
  const frames = [], outcomes = [];
  const dispatch = runtime.runtime.dispatch.bind(runtime.runtime);
  runtime.runtime.dispatch = frame => { frames.push(structuredClone(frame)); dispatch(frame); outcomes.push(structuredClone(runtime.runtime.outcome)); };
  try {
    for (const record of records) runtime.step(record);
    assert.deepEqual(runNative(artifact, frames), outcomes, 'complete native scan_tape outcomes equal framed WASM outcomes for this exact artifact');
    assert.deepEqual(runNative(artifact, frames), outcomes, 'fresh native replay preserves every outcome field for this exact artifact');
    return outcomes.map(outcome => {
      const observed = observeSourceTrace(artifact.traceMetadata, outcome.trace);
      const states = {};
      for (const binding of artifact.traceMetadata.bindings.filter(binding => binding.kind === 'state')) {
        const node = artifact.sourceMap.find(item => item.id === binding.nodeId);
        assert.ok(node?.instance, 'state trace node retains production-emitted owning instance');
        const local = ['held', 'ever'].find(name => binding.name.endsWith(`_${name}`));
        assert.ok(local, `unexpected state binding ${binding.name}`);
        const entry = observed.bindings.find(item => item.nodeId === binding.nodeId);
        const before = entry.observations.find(item => item.field === 'stateBefore');
        const after = entry.observations.find(item => item.field === 'stateAfter');
        states[`${node.instance}.${local}`] = { before: before.value, after: after.value };
      }
      const projection = owner?.projectTrace(outcome.trace);
      return { states, requested: outcome.trace.requested, safe: outcome.trace.safe, ...(projection ? { projection } : {}) };
    });
  } finally {
    runtime.dispose();
  }
}


function semanticInstanceIds(artifact) {
  return artifact.sourceClosure.instances.map(item => item.instance).sort();
}

function semanticSourceProvenance(artifact) {
  return artifact.sourceClosure.documents.map(({ filename, revision, sha256 }) => ({ filename, revision, sha256 }));
}

test('REF-06-003 display names, file locations, and declaration order do not rename authored instance identities', async () => {
  const baseline = await compileVariant({ filename: 'farm.ghost.md', locator: './defs/relay.ghost.md', closureFilename: 'defs/relay.ghost.md' });
  const moved = await compileVariant({ filename: 'relocated/farm.ghost.md', locator: '../vendor/display/relay.ghost.md', closureFilename: 'vendor/display/relay.ghost.md', reversed: true });
  assert.deepEqual(semanticInstanceIds(baseline), ['east', 'west']);
  assert.deepEqual(semanticInstanceIds(moved), ['east', 'west']);
  assert.notDeepEqual(semanticSourceProvenance(baseline), semanticSourceProvenance(moved), 'exact source provenance records locator/location differences instead of claiming every artifact is identical');
  const baselineOwner = await activateInstanceTraceProjection(baseline, { presentationRevision: 'panel-a', labels: { east: 'East bed pump', west: 'West bed pump' } });
  const movedOwner = await activateInstanceTraceProjection(moved, { presentationRevision: 'panel-b', labels: { east: 'Greenhouse A', west: 'Greenhouse B' } });
  assert.deepEqual(baselineOwner.activation.presentations, [
    { instanceId: 'east', displayName: 'East bed pump', presentationRevision: 'panel-a' },
    { instanceId: 'west', displayName: 'West bed pump', presentationRevision: 'panel-a' },
  ]);
  assert.deepEqual(movedOwner.activation.presentations, [
    { instanceId: 'east', displayName: 'Greenhouse A', presentationRevision: 'panel-b' },
    { instanceId: 'west', displayName: 'Greenhouse B', presentationRevision: 'panel-b' },
  ]);
  const baselineTrace = await execute(baseline, baselineOwner);
  const movedTrace = await execute(moved, movedOwner);
  assert.deepEqual(baselineTrace.map(row => row.projection.entries.map(entry => ({ key: entry.key, instanceId: entry.instanceId, kind: entry.kind, observations: entry.observations }))),
    movedTrace.map(row => row.projection.entries.map(entry => ({ key: entry.key, instanceId: entry.instanceId, kind: entry.kind, observations: entry.observations }))),
    'production projection keeps identity-keyed trace observations stable under display/path/order changes');
  const stripProjection = trace => trace.map(({ projection, ...row }) => row);
  assert.deepEqual(stripProjection(baselineTrace), stripProjection(movedTrace), 'identity-keyed results and state traces stay the same under locator/display/order changes');
  assert.deepEqual(baselineTrace.map(row => row.requested), [
    { east_pump: true, west_pump: false, east_seen: true, west_seen: false },
    { east_pump: true, west_pump: true, east_seen: true, west_seen: true },
    { east_pump: false, west_pump: true, east_seen: true, west_seen: true },
    { east_pump: false, west_pump: false, east_seen: true, west_seen: true },
  ]);
  assert.deepEqual(baselineTrace.map(row => row.safe), baselineTrace.map(row => row.requested));
});

test('REF-06-003 semantic instance ID changes do not alias old identity and bad pins or presentation reject', async () => {
  const baseline = await compileVariant({ filename: 'farm.ghost.md', locator: './defs/relay.ghost.md', closureFilename: 'defs/relay.ghost.md' });
  const renamed = await compileVariant({ filename: 'farm.ghost.md', locator: './defs/relay.ghost.md', closureFilename: 'defs/relay.ghost.md', eastName: 'north', westName: 'south' });
  assert.deepEqual(semanticInstanceIds(baseline), ['east', 'west']);
  assert.deepEqual(semanticInstanceIds(renamed), ['north', 'south']);
  const renamedTrace = await execute(renamed);
  assert.ok(Object.keys(renamedTrace[0].states).every(key => key.startsWith('north.') || key.startsWith('south.')));
  assert.ok(!Object.keys(renamedTrace[0].states).some(key => key.startsWith('east.') || key.startsWith('west.')), 'changed authored instance IDs do not alias old identity-keyed traces');
  await assert.rejects(() => activateInstanceTraceProjection(baseline, { presentationRevision: 'bad', labels: { east: 'East only' } }), /presentation labels/);
  await assert.rejects(() => activateInstanceTraceProjection(baseline, { presentationRevision: 'bad', labels: { east: 'East', west: '' } }), /non-empty/);
  await assert.rejects(() => activateInstanceTraceProjection(baseline, { presentationRevision: 'bad', labels: { east: 'East', west: 'Bad\nLabel' } }), /control characters/);
  const wrongDigest = doc(`${pin('Relay', './defs/relay.ghost.md').replace(sha256Hex(relay), '0'.repeat(64))}\ncontrol Farm { instance east: Relay; }`);
  await assert.rejects(() => compileSource(wrongDigest, { filename: 'farm.ghost.md', sourceClosure: [{ filename: 'defs/relay.ghost.md', revision: 'relay-r1', text: relay }] }), /sha256|digest|hash/i);
  const wrongRevision = doc(`${pin('Relay', './defs/relay.ghost.md', 'relay-r2')}\ncontrol Farm { instance east: Relay; }`);
  await assert.rejects(() => compileSource(wrongRevision, { filename: 'farm.ghost.md', sourceClosure: [{ filename: 'defs/relay.ghost.md', revision: 'relay-r1', text: relay }] }), /revision/i);
  await assert.rejects(() => compileSource(source({ locator: './defs/relay.ghost.md' }), { filename: 'farm.ghost.md', sourceClosure: [] }), /missing|sourceClosure|dependency|import/i);
});
