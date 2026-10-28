import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { jsonSha256, SCHEMAS } from '../tools/integration-contract.mjs';
import { InstalledControlHost } from '../runtimes/wasm/installed-control-host.mjs';

const wasm = readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const document = code => `# Change lifecycle\n\n<!-- ghostflow:anchor id=cell-intent kind=intent status=confirmed origin=user -->\nThe cell follows its admitted input and operating setting.\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const child = (revision = 1) => document(`control Cell {
  parameter enabled: Bool = true;
  input start: Bool { sample = 1s; stale_after = 3s; }
  // ghostflow:link id=cell-intent relation=implements
  config allow: Bool = true { access = operator; }
  output on: Bool;
  on <- enabled && (allow |> recover(false)) && (start |> recover(false))${revision === 2 ? ' && true' : ''};
}`);
const source = (definition, revision, enabled) => document(`import Cell from "./cell.ghost.md" revision "${revision}" sha256 "${sha256Hex(definition)}";
control Pair {
  input start: Bool { sample = 1s; stale_after = 4s; }
  output on: Bool;
  instance cell: Cell${enabled === null ? '' : `(enabled = ${enabled})`};
  connect cell.start <- start;
  connect on <- cell.on;
}`);
const compile = (definition, revision, enabled, supplied = [{ filename: 'cell.ghost.md', revision, text: definition }]) =>
  compileSourceSync(source(definition, revision, enabled), { filename: 'pair.ghost.md', sourceClosure: supplied,
    interactionSourceIdentity: { documentId: 'pair', revisionId: revision } });

function installed(revision, endpointId) {
  const boardProfile = { schema: SCHEMAS.profileV2, id: 'board', revision, boardModel: 'REFERENCE-ONLY', endpoints: {
    [endpointId]: { direction: 'input', type: 'Bool', driver: 'fixture', address: `input/${revision}`,
      sensor: { format: SCHEMAS.sensorObservation, canonicalUnit: null, maxInterSampleGapMs: 1000 } },
    relay: { direction: 'output', type: 'Bool', driver: 'fixture', address: 'output/relay',
      activeLevel: 'high', safeLevel: 0 },
  } };
  const profile = { id: 'board', revision, sha256: jsonSha256(boardProfile) };
  const installation = { schema: SCHEMAS.installation, id: 'site', revision, boardProfile: profile,
    bindings: { start: endpointId, on: 'relay' } };
  const release = { schema: SCHEMAS.release,
    toolchain: { version: 'reference', sha256: '1'.repeat(64) },
    runtimeSemanticsVersion: 'reference-host', bytecodeFormat: 'GFB1', protocolVersion: 'reference',
    device: { firmwareSha256: '2'.repeat(64), boardProfile: profile },
    installation: { id: 'site', revision, sha256: jsonSha256(installation) } };
  return { release, boardProfile, installation };
}

const frame = (revision, endpointId, nowMs, id, value) => ({ bindingRevision: revision, nowMs,
  samples: { start: { bindingRevision: revision, endpointId,
    sample: { epoch: 1, id, timestampMs: nowMs, quality: 'Good', value } } },
  contextFacts: { clock: { monotonicMs: nowMs, bootEpoch: 1, wallMs: nowMs,
    uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: 'clock-r1' },
  natural: [], schedules: [], settings: null } });

test('REF-06-007 partial oracle: parameter, setting, dependency and binding use distinct actual owners', async t => {
  const firstDefinition = child();
  const first = compile(firstDefinition, 'cell-r1', 'true');
  const parameterChange = compile(firstDefinition, 'cell-r1', 'false');
  assert.notEqual(parameterChange.sourceDocument.sha256, first.sourceDocument.sha256);
  assert.notEqual(parameterChange.manifest.bytecodeSha256, first.manifest.bytecodeSha256);
  assert.deepEqual(parameterChange.sourceClosure.documents, first.sourceClosure.documents);
  assert.equal(first.manifest.configs.length, 1);
  assert.deepEqual(parameterChange.manifest.configs.map(config => config.name),
    first.manifest.configs.map(config => config.name));

  const secondDefinition = child(2);
  const dependencyChange = compile(secondDefinition, 'cell-r2', 'true');
  assert.notEqual(dependencyChange.sourceDocument.sha256, first.sourceDocument.sha256);
  assert.notEqual(dependencyChange.sourceClosure.documents[0].sha256, first.sourceClosure.documents[0].sha256);
  assert.equal(dependencyChange.sourceClosure.documents[0].revision, 'cell-r2');
  assert.throws(() => compile(secondDefinition, 'cell-r2', 'true',
    [{ filename: 'cell.ghost.md', revision: 'cell-r1', text: secondDefinition }]), /import revision mismatch/);
  assert.throws(() => compile(secondDefinition, 'cell-r2', 'true',
    [{ filename: 'cell.ghost.md', revision: 'cell-r2', text: firstDefinition }]), /digest mismatch/);

  const runtimeDefinition = document(`control Cell {
  input start: Bool { sample = 1s; stale_after = 3s; }
  // ghostflow:link id=cell-intent relation=implements
  config allow: Bool = true { access = operator; }
  output on: Bool;
  on <- (allow |> recover(false)) && (start |> recover(false));
}`);
  const runtimeArtifact = compile(runtimeDefinition, 'cell-runtime-r1', null);
  const host = await InstalledControlHost.instantiate(wasm, runtimeArtifact,
    { runId: 'run-1', ...installed('binding-r1', 'sensor-a'), grants: { cell: [runtimeArtifact.manifest.configs[0].id] },
      context: { bootEpoch: 1, terminalCapacity: 16, bindings: [] } });
  t.after(() => host.dispose());
  const before = host.step(frame('binding-r1', 'sensor-a', 0, 1, true));
  assert.equal(before.vm.safe.on, true);
  const identity = host.snapshot().execution;
  const event = { kind: 'ordinary', eventId: 'allow-off', actor: 'cell', reason: 'operator setting',
    programFingerprint: identity.programFingerprint, sourceSha256: identity.sourceSha256,
    runId: identity.runId, baseRevision: identity.core.state.settingsRevision,
    changes: [{ configId: runtimeArtifact.manifest.configs[0].id,
      result: { ok: true, type: 'Bool', value: false } }] };
  const changed = host.step(frame('binding-r1', 'sensor-a', 1000, 2, true), event);
  assert.equal(changed.vm.safe.on, false);
  assert.equal(changed.execution.snapshot.core.state.settingsRevision, 1);
  assert.equal(changed.identity.runId, before.identity.runId);
  assert.equal(changed.identity.sourceSha256, before.identity.sourceSha256);
  assert.equal(changed.identity.bytecodeSha256, before.identity.bytecodeSha256);
  assert.equal(changed.identity.bindingRevision, before.identity.bindingRevision);
  const afterSetting = host.snapshot();
  assert.throws(() => host.step(frame('binding-r1', 'sensor-a', 2000, 3, true),
    { ...event, eventId: 'stale-event' }), /stale revision/);
  assert.deepEqual(host.snapshot(), afterSetting);

  const replacement = installed('binding-r2', 'sensor-b');
  const incompatible = structuredClone(replacement);
  incompatible.boardProfile.endpoints['sensor-b'].sensor.maxInterSampleGapMs = 4000;
  incompatible.release.device.boardProfile.sha256 = jsonSha256(incompatible.boardProfile);
  incompatible.installation.boardProfile.sha256 = incompatible.release.device.boardProfile.sha256;
  incompatible.release.installation.sha256 = jsonSha256(incompatible.installation);
  await assert.rejects(host.replaceBinding({ runId: 'run-2', ...incompatible }), /sample_gap/);
  assert.deepEqual(host.snapshot(), afterSetting);
  const accepted = await host.replaceBinding({ runId: 'run-2', ...replacement });
  assert.equal(accepted.bindingRevision, 'binding-r2');
  assert.equal(accepted.runId, 'run-2');
  assert.equal(accepted.sourceSha256, before.identity.sourceSha256);
  assert.equal(accepted.bytecodeSha256, before.identity.bytecodeSha256);
  assert.equal(host.snapshot().execution.core.state.settingsRevision, 1);
  assert.equal(host.snapshot().execution.core.state.settings[0].result.value, false);
  assert.throws(() => host.step(frame('binding-r1', 'sensor-a', 0, 1, true)), /stale binding revision/);
  assert.throws(() => host.step(frame('binding-r2', 'sensor-b', 0, 1, true), event), /Program\/source\/run identity/);
  const afterBinding = host.step(frame('binding-r2', 'sensor-b', 0, 1, true));
  assert.equal(afterBinding.vm.safe.on, false, 'a binding-only change retains the accepted ordinary setting');
  assert.equal(afterBinding.provenance.routes.inputs[0].endpointId, 'sensor-b');
  assert.equal(afterBinding.provenance.routes.outputs[0].endpointId, 'relay');
});
