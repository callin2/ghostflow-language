import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource, verifyArtifactSourceMap } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const cases = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url))).cases;
for (const id of ['REF-04-026', 'REF-03-062']) test(`${id}: compile a checked temporal descriptor without claiming executable control`, async () => {
  const fixture = cases.find(entry => entry.id === id);
  const compiled = await compileSource(fixture.source, { filename: fixture.filename });
  const artifact = JSON.parse(compiled.bytes.toString('utf8'));
  assert.equal(artifact.format, 'GhostFlow/temporal-descriptor-artifact-v1');
  assert.equal(artifact.executable, false);
  assert.equal(compiled.manifest.executable, false);
  assert.equal(compiled.manifest.sourceDocumentSha256, compiled.sourceDocument.sha256);
  assert.equal(artifact.controlSource.includes('output '), true);
  const descriptor = compiled.manifest.control;
  if (id === 'REF-04-026') {
    assert.equal(descriptor.signals[0].kind, 'after-event');
    assert.equal(descriptor.signals[0].windowMs, 10_000);
    assert.equal(descriptor.signals[0].event.name, 'started');
    assert.deepEqual(compiled.manifest.requiredRuntimeContracts, ['identified-event-delivery', 'per-identity-result-projection']);
  } else {
    assert.deepEqual(descriptor.naturalConditions.map(item => item.operation), ['tide_is', 'moon_is']);
    assert.deepEqual(compiled.manifest.requiredRuntimeContracts, ['natural-provider-observations']);
  }
  await assert.rejects(() => ControlRuntime.instantiate(new Uint8Array(), compiled), /manifest.*(unknown key|unsupported)/);
  const envelope = {
    format: 'GhostFlow/source-map-v1', bytecodeSha256: compiled.manifest.bytecodeSha256,
    sourceDocument: compiled.sourceDocument, nodes: compiled.sourceMap,
    lines: compiled.extractionMap, traceMetadata: null,
    interactionSchema: null, interactionSourceIdentity: null,
  };
  verifyArtifactSourceMap(envelope, compiled.bytes, { manifest: compiled.manifest });
  assert.throws(() => verifyArtifactSourceMap(envelope, compiled.bytes, {
    manifest: { ...compiled.manifest, executable: true },
  }), /temporal descriptor manifest does not match canonical source/);
  assert.throws(() => verifyArtifactSourceMap(envelope, compiled.bytes, {
    manifest: { ...compiled.manifest, sourceDocumentSha256: '0'.repeat(64) },
  }), /temporal descriptor source identity/);
  assert.throws(() => verifyArtifactSourceMap(envelope, compiled.bytes, {
    manifest: { ...compiled.manifest, control: { ...descriptor, outputs: [] } },
  }), /temporal descriptor manifest does not match canonical source/);
});
