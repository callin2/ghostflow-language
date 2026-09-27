import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource, verifyArtifactSourceMap } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const cases = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url))).cases;
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));

for (const id of ['REF-03-062']) test(`${id}: compile source-bound executable natural conditions`, async () => {
  const fixture = cases.find(entry => entry.id === id);
  const compiled = await compileSource(fixture.source, { filename: fixture.filename });
  assert.equal(compiled.bytes.subarray(0, 4).toString(), 'GFB1');
  assert.equal(compiled.bytes.readUInt16LE(4), 11);
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v10');
  assert.deepEqual(compiled.manifest.naturalConditions.map(item => item.operation), ['tide_is', 'moon_is']);
  await assert.rejects(() => ControlRuntime.instantiate(wasm, compiled), /context activation profile is required/);
  await assert.rejects(() => ControlRuntime.instantiate(wasm, compiled, {
    context: { bootEpoch: 7, terminalCapacity: 8, bindings: [] },
  }), /missing declared provider binding/);
  const envelope = {
    format: 'GhostFlow/source-map-v1', bytecodeSha256: compiled.manifest.bytecodeSha256,
    sourceDocument: compiled.sourceDocument, nodes: compiled.sourceMap,
    lines: compiled.extractionMap, traceMetadata: compiled.traceMetadata ?? null,
    interactionSchema: compiled.interactionSchema ?? null,
    interactionSourceIdentity: compiled.interactionSourceIdentity ?? null,
  };
  verifyArtifactSourceMap(envelope, compiled.bytes, { manifest: compiled.manifest });
  const altered = Buffer.from(compiled.bytes);
  altered[altered.length - 1] ^= 1;
  assert.throws(() => verifyArtifactSourceMap(envelope, altered, { manifest: compiled.manifest }),
    /source map bytecode SHA-256 does not match artifact/);
  assert.throws(() => verifyArtifactSourceMap({ ...envelope,
    sourceDocument: { ...envelope.sourceDocument, sha256: '0'.repeat(64) },
  }, compiled.bytes, { manifest: compiled.manifest }), /source document SHA-256 does not match text/);
});
