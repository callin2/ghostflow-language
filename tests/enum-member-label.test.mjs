import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource as compileNode, restoreArtifactSourceMap, writeArtifact } from '../tools/toolchain.mjs';
import { compileSource as compileBrowser } from '../tools/browser-toolchain.mjs';
import { interactionSchemaSha256, validateInteraction } from '../contracts/interaction-v0/validate.mjs';
import { sha256Hex } from '../tools/sha256.mjs';

const filename = 'contracts/interaction-v0/examples/enum-phase-age.ghost.md';
const source = fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
const options = { filename, interactionSourceIdentity: { documentId: 'source.enum-label', revisionId: 'revision.enum-label' } };
const labeled = metadata => source.replace('Idle | Running', `Idle ${metadata} | Running`);

test('enum member labels survive Node/browser public compilation without changing control bytes', async () => {
  const plain = await compileNode(source, options);
  const text = '대기 "준비" \\ 😀';
  const annotated = labeled(`{ label = ${JSON.stringify(text)}; }`);
  for (const compile of [compileNode, compileBrowser]) {
    const result = await compile(annotated, options);
    assert.deepEqual(result.interactionSchema.descriptors[0].sourceType.enumMembers,
      [{ name: 'Idle', value: 0, displayLabel: text }, { name: 'Running', value: 1 }]);
    assert.deepEqual([...result.bytes], [...plain.bytes]);
    assert.equal(result.traceMetadata.moduleFingerprint, plain.traceMetadata.moduleFingerprint);
    assert.notEqual(result.sourceDocument.sha256, plain.sourceDocument.sha256);
    assert.notEqual(interactionSchemaSha256(result.interactionSchema), interactionSchemaSha256(plain.interactionSchema));
    const changed = await compile(labeled('{ label = "휴식"; }'), options);
    assert.deepEqual(changed.bytes, result.bytes);
    assert.notEqual(interactionSchemaSha256(changed.interactionSchema), interactionSchemaSha256(result.interactionSchema));
  }
});

test('enum display labels restore from canonical artifacts and reject metadata tampering', async () => {
  const result = await compileNode(labeled('{ label = "대기"; }'), options);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-enum-label-'));
  try {
    const artifact = path.join(temporary, 'phase.gfb');
    writeArtifact(result, artifact);
    const envelope = JSON.parse(fs.readFileSync(`${artifact}.map.json`, 'utf8'));
    assert.deepEqual(restoreArtifactSourceMap(envelope, result.bytes).interactionSchema, result.interactionSchema);
    envelope.interactionSchema.descriptors[0].sourceType.enumMembers[0].displayLabel = '휴식';
    assert.throws(() => restoreArtifactSourceMap(envelope, result.bytes), /schema does not match compiler/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

for (const [metadata, message] of [
  ['{ label = ""; }', /enum member label must be a non-empty string/],
  ['{ label = "  "; }', /enum member label must be a non-empty string/],
  ['{ label = 1; }', /enum member label must be a string/],
  ['{ label = "대기"; label = "휴식"; }', /duplicate enum member option label/],
  ['{ color = "red"; }', /unsupported enum member option color/],
]) test(`enum member label diagnostic: ${metadata}`, async () => {
  await assert.rejects(() => compileNode(labeled(metadata), options), error => {
    assert.match(error.message, message);
    assert.ok(error.diagnosticEnvelope?.diagnostics?.length > 0);
    return true;
  });
});

test('enum member display labels are validated and participate in snapshot identity', async () => {
  const result = await compileNode(labeled('{ label = "대기"; }'), options);
  const schema = result.interactionSchema;
  const snapshot = { format: 'GhostFlow/runtime-snapshot-v0', version: '0.1',
    schema: { format: schema.format, version: schema.version, sha256: interactionSchemaSha256(schema) },
    module: schema.module, source: schema.source, runId: 'run.enum-label',
    completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 },
    observations: schema.descriptors.map(entry => ({ descriptorId: entry.id, status: 'ready', value: 0 })) };
  assert.equal(validateInteraction(schema, snapshot).valid, true);
  const edited = structuredClone(schema);
  edited.descriptors[0].sourceType.enumMembers[0].displayLabel = '휴식';
  assert.equal(validateInteraction(edited, snapshot).valid, false);
  for (const label of ['', '  ', 1, null]) {
    const invalid = structuredClone(schema);
    invalid.descriptors[0].sourceType.enumMembers[0].displayLabel = label;
    assert.ok(validateInteraction(invalid, snapshot).errors.some(error => error.code === 'enum_member_label'));
  }
});

test('member labels remain unsupported in imported enum composition', async () => {
  const imported = '# Relay\n\n```ghost\ncontrol Relay { type Phase = Idle { label = "대기"; } | Running; output pump: Bool; pump <- true; }\n```\n';
  const root = '# Farm\n\n```ghost\nimport Relay from "./relay.ghost.md" revision "r1" sha256 "' + sha256Hex(imported)
    + '";\ncontrol Farm { output pump: Bool; instance east: Relay; connect pump <- east.pump; }\n```\n';
  await assert.rejects(() => compileNode(root, { filename: 'farm.ghost.md',
    sourceClosure: [{ filename: 'relay.ghost.md', revision: 'r1', sha256: sha256Hex(imported), text: imported }] }),
  /composition of enum requires its instance contract/);
});
