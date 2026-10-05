// Explicit temporal fixture revision: issue531-quality-temporal-v1; predecessor retained in fixtures/history/issue531/temporal.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { compileSource, verifyArtifactSourceMap } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const source = `# Scheduled control\n\n\`\`\`ghost\ncontrol Water {\n  input allow: Bool;\n  schedule morning: Cron {\n    timezone = "Asia/Seoul"; at = cron5\`30 6 * * *\`;\n    dst_missing = skip; dst_repeated = first;\n    basis = pulse; when = allow |> recover(false); clock = trusted_only;\n    gap = skip_after(60s); recovery = baseline; fallback = skip;\n  }\n  output pump: Bool;\n  pump <- morning.due;\n}\n\`\`\`\n`;

test('canonical source emits source-bound executable GFB11 schedule control', async () => {
  const compiled = await compileSource(source, { filename: 'water.ghost.md' });
  assert.equal(compiled.bytes.subarray(0, 4).toString(), 'GFB1');
  assert.equal(compiled.bytes.readUInt16LE(4), 11);
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v10');
  assert.deepEqual(compiled.manifest.outputs.map(item => item.name), ['pump']);
  assert.equal(compiled.manifest.schedules[0].policy.when[0], 'trace-result');
  assert.deepEqual(compiled.manifest.schedules[0].policy.when[2], ['if', 'input.__gf_sensor_ok_allow', 'input.__gf_sensor_value_allow', 'false']);
  await assert.rejects(() => ControlRuntime.instantiate(wasm, compiled), /context activation profile is required/);
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
  await assert.rejects(() => ControlRuntime.instantiate(wasm, {
    ...compiled, manifest: { ...compiled.manifest, bytecodeSha256: '0'.repeat(64) },
  }, { context: { bootEpoch: 7, terminalCapacity: 8, bindings: [] } }), /bytecode SHA-256 does not match manifest/);
});
