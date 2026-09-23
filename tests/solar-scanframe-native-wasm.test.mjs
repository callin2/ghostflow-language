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

test('Solar GFB5 fails closed on framed hosts until the provider-fact frame ABI exists', async () => {
  assert.ok(fs.existsSync(wasmPath), 'release WASM artifact is required; run npm test');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const artifact = await compileSource(source, { filename: 'examples/solar-watering.ghost.md' });
  await assert.rejects(() => ControlRuntime.instantiateFramed(fs.readFileSync(wasmPath), artifact,
    { solar: { bootEpoch: 7, terminalCapacity: 8 } }), /framed Solar activation/);
});
