import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const nativePath = path.join(root, 'target/release/examples/scan_adapter' + (process.platform === 'win32' ? '.exe' : ''));
const sourcePath = path.join(root, 'examples/solar-watering.ghost.md');

test('Legacy Solar GFB5 remains rejected by the framed host', async () => {
  assert.ok(fs.existsSync(wasmPath), 'release WASM artifact is required; run npm test');
  const source = fs.readFileSync(sourcePath, 'utf8')
    .replace('  schedule dawn:', '  schedule externalSlots: DailySlots<15min> { timezone = "UTC"; selected = [06:00]; }\n  schedule dawn:');
  const artifact = await compileSource(source, { filename: 'examples/solar-watering.ghost.md' });
  assert.equal(Buffer.from(artifact.bytes).readUInt16LE(4), 5);
  await assert.rejects(() => ControlRuntime.instantiateFramed(fs.readFileSync(wasmPath), artifact,
    { solar: { bootEpoch: 7, terminalCapacity: 8 } }), /framed Solar activation/);
});
