import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileSource, verifyArtifactSourceMap } from '../tools/toolchain.mjs';
import { compileControl } from '../tools/control.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { validateResourceConstraintBinding } from '../runtimes/node/resource-constraints-binding.mjs';

const source = `# Resource policy\n\n\`\`\`ghost\nresource pump1: BoolActuator;\nresource_policy shared_pump for pump1 {\n  lease = session;\n  concurrency = 1;\n  admission = reserve_all;\n  queue = fifo(max: 8, expires_after: 10min, tie: request_id);\n  preempt = never;\n}\n\`\`\`\n`;

test('GF-TEST-resource-constraint-binding: exact source-bound finite logical mapping validates without granting execution', async () => {
  const contract = fs.readFileSync(new URL('../examples/shared-constraint-contract.ghost.md', import.meta.url), 'utf8');
  const translated = fs.readFileSync(new URL('../examples/shared-constraint-contract.ghost.ko.md', import.meta.url), 'utf8');
  for (const language of ['ghost', 'js']) {
    const pattern = new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```');
    assert.equal(contract.match(pattern)[1], translated.match(pattern)[1]);
  }
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', contract.match(/```js\n([\s\S]*?)\n```/)[1]],
    { encoding: 'utf8' }).trim(), 'false', 'the complete example validates mapping without execution');
  const compilation = await compileSource(contract, { filename: 'examples/shared-constraint-contract.ghost.md' });
  const cli = execFileSync(process.execPath, ['tools/ghostc.mjs', '--check', 'examples/shared-constraint-contract.ghost.md'], { encoding: 'utf8' });
  assert.match(cli, /checked control policy descriptor \(not executable control; binding and enforcement required\)/);
  const bindings = () => ({ format: 'GhostFlow/resource-constraints-binding-v1', revision: 'virtual-installation-r1',
    sourceDocumentSha256: compilation.sourceDocument.sha256, artifactSha256: compilation.manifest.bytecodeSha256,
    resources: [{ name: 'station', resourceId: 'virtual/loop' },
      { name: 'pump1', resourceId: 'virtual/pump', output: 'pump' },
      { name: 'valve1', resourceId: 'virtual/valve', output: 'valve' }],
    modes: [{ group: 'SharedRules', name: 'automatic', input: 'automatic' },
      { group: 'SharedRules', name: 'manual', input: 'manual' }],
  });
  const checked = validateResourceConstraintBinding(compilation, bindings());
  assert.equal(checked.executable, false);
  assert.equal(checked.artifactSha256, sha256Hex(compilation.bytes));
  assert.ok(Object.isFrozen(checked.resources[1]));
  assert.deepEqual(checked.resources[1], { name: 'pump1', resourceId: 'virtual/pump', output: 'pump' });
  const rejects = (change, expression) => { const value = bindings(); change(value); assert.throws(() => validateResourceConstraintBinding(compilation, value), expression); };
  rejects(value => value.resources.pop(), /missing resource binding valve1/);
  rejects(value => value.modes.pop(), /missing mode binding SharedRules\/manual/);
  rejects(value => value.resources.push({ ...value.resources[1] }), /duplicate resource binding/);
  rejects(value => value.resources[2].resourceId = value.resources[1].resourceId, /same stable resource/);
  rejects(value => value.resources[2].output = 'pump', /one output port/);
  rejects(value => value.resources[1].output = 'missing', /Bool output port/);
  rejects(value => value.modes[1].input = 'missing', /Bool input port/);
  rejects(value => value.modes[1].input = 'automatic', /must not share/);
  rejects(value => value.modes.push({ ...value.modes[0] }), /duplicate mode binding/);
  rejects(value => value.modes[0].name = 'bypass', /unexpected mode binding/);
  rejects(value => value.resources[0].name = 'bypass', /unexpected resource binding/);
  rejects(value => value.format = 'other', /unsupported binding format/);
  rejects(value => value.revision = '', /binding revision/);
  rejects(value => value.policy = 'ignore constraints', /unsupported fields/);
  rejects(value => value.sourceDocumentSha256 = '0'.repeat(64), /identity mismatch/);
  rejects(value => value.artifactSha256 = '0'.repeat(64), /identity mismatch/);
  assert.throws(() => validateResourceConstraintBinding(compilation, null), /must be an object/);
  assert.throws(() => validateResourceConstraintBinding({ ...compilation, sourceDocument: null }, bindings()), /canonical source/);
  assert.throws(() => validateResourceConstraintBinding({ ...compilation, bytes: new Uint8Array([0]) }, bindings()), /identity mismatch/);
  const forged = structuredClone(compilation);
  forged.sourceDocument.text = forged.sourceDocument.text.replace('pump1 = false', 'pump1 = true');
  forged.sourceDocument.sha256 = sha256Hex(forged.sourceDocument.text);
  forged.manifest.sourceDocumentSha256 = forged.sourceDocument.sha256;
  assert.throws(() => validateResourceConstraintBinding(forged, bindings()), /descriptor differs/);
  assert.throws(() => validateResourceConstraintBinding({ manifest: { format: 'GhostFlow/control-v1' } }, bindings()), /checked control policy/);
});

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
