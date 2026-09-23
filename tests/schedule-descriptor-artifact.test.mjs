import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileSource, verifyArtifactSourceMap } from '../tools/toolchain.mjs';
import { compileControl } from '../tools/control.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const source = `# Scheduled control\n\n\`\`\`ghost\ncontrol Water {\n  input allow: Bool;\n  schedule morning: Daily {\n    timezone = "Asia/Seoul"; at = time\`06:30\`;\n    dst_missing = skip; dst_repeated = first;\n    basis = pulse; when = allow; clock = trusted_only;\n    gap = skip_after(60s); recovery = baseline; fallback = skip;\n  }\n  output pump: Bool;\n  pump <- morning.due;\n}\n\`\`\`\n`;

test('canonical source emits a source-bound non-executable schedule descriptor', async () => {
  const compiled = await compileSource(source, { filename: 'water.ghost.md' });
  const artifact = JSON.parse(compiled.bytes.toString('utf8'));
  assert.equal(artifact.format, 'GhostFlow/schedule-descriptor-artifact-v1');
  assert.equal(artifact.executable, false);
  assert.equal(artifact.controlSource.includes('pump <- morning.due;'), true);
  assert.deepEqual(artifact.manifest, { format: compiled.manifest.format, control: compiled.manifest.control });
  assert.equal(compiled.manifest.sourceDocumentSha256, compiled.sourceDocument.sha256);
  assert.deepEqual(compiled.manifest.control.outputs.map(item => item.name), ['pump']);
  assert.equal(compiled.manifest.control.schedules[0].policy.when, 'input.allow');
  assert.throws(() => compileControl(artifact.controlSource), /policy execution requires verified occurrence provider/);
  await assert.rejects(() => ControlRuntime.instantiate(new Uint8Array(), compiled), /manifest.*(unknown key|unsupported)/);
  const envelope = {
    format: 'GhostFlow/source-map-v1', bytecodeSha256: compiled.manifest.bytecodeSha256,
    sourceDocument: compiled.sourceDocument, nodes: compiled.sourceMap,
    lines: compiled.extractionMap, traceMetadata: null,
    interactionSchema: null, interactionSourceIdentity: null,
  };
  verifyArtifactSourceMap(envelope, compiled.bytes, { manifest: compiled.manifest });
  assert.throws(() => verifyArtifactSourceMap(envelope, compiled.bytes, {
    manifest: { ...compiled.manifest, control: { ...compiled.manifest.control, outputs: [] } },
  }), /schedule descriptor manifest does not match canonical source/);
  assert.throws(() => verifyArtifactSourceMap(envelope, compiled.bytes, {
    manifest: { ...compiled.manifest, sourceDocumentSha256: '0'.repeat(64) },
  }), /schedule descriptor source identity/);
});
