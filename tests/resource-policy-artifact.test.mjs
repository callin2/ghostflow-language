import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileSource, verifyArtifactSourceMap } from '../tools/toolchain.mjs';
import { compileControl } from '../tools/control.mjs';
import { sha256Hex } from '../tools/sha256.mjs';

const source = `# Resource policy\n\n\`\`\`ghost\nresource pump1: BoolActuator;\nresource_policy shared_pump for pump1 {\n  lease = session;\n  concurrency = 1;\n  admission = reserve_all;\n  queue = fifo(max: 8, expires_after: 10min, tie: request_id);\n  preempt = never;\n}\n\`\`\`\n`;

test('public toolchain emits a source-bound checked resource policy artifact', async () => {
  const compilation = await compileSource(source, { filename: 'policy.ghost.md' });
  const artifact = JSON.parse(Buffer.from(compilation.bytes).toString('utf8'));
  assert.equal(artifact.format, 'GhostFlow/resource-policy-artifact-v1');
  assert.deepEqual(artifact.policy.resourcePolicies, compilation.manifest.resourcePolicies);
  assert.equal(compilation.manifest.format, 'GhostFlow/resource-policy-v1');
  assert.equal(compilation.manifest.bytecodeSha256, sha256Hex(compilation.bytes));
  assert.equal(compilation.traceMetadata ?? null, null);
  const control = source.match(/```ghost\n([\s\S]*?)```/)[1];
  assert.throws(() => compileControl(control), /resource policy execution requires bounded queue/);
  const sourceMap = {
    format: 'GhostFlow/source-map-v1',
    bytecodeSha256: compilation.manifest.bytecodeSha256,
    sourceDocument: compilation.sourceDocument,
    nodes: compilation.sourceMap,
    lines: compilation.extractionMap,
    traceMetadata: null,
    interactionSchema: null,
    interactionSourceIdentity: null,
  };
  verifyArtifactSourceMap(sourceMap, compilation.bytes, { manifest: compilation.manifest });
  assert.throws(() => verifyArtifactSourceMap(sourceMap, compilation.bytes, {
    manifest: { ...compilation.manifest, bytecodeSha256: '0'.repeat(64) },
  }), /manifest bytecode SHA-256/);
});
