import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { compileControl } from '../tools/control.mjs';
import { extractLiterate } from '../tools/literate.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const cases = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url))).cases;
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
for (const id of ['REF-03-062', 'REF-03-050']) test(`${id}: executable Result requires an explicit context activation`, async () => {
  const fixture = cases.find(item => item.id === id);
  const { code } = extractLiterate(fixture.source, { filename: fixture.filename });
  if (id === 'REF-03-050') {
    assert.throws(() => compileControl(code), /accounting execution requires verified resource binding/);
  } else {
    assert.equal(compileControl(code).manifest.format, 'GhostFlow/control-v10');
  }
  const artifact = await compileSource(fixture.source, { filename: fixture.filename });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v10');
  assert.equal(new DataView(artifact.bytes.buffer, artifact.bytes.byteOffset, artifact.bytes.byteLength).getUint16(4, true), 11);
  await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact), /context activation profile is required/);
});
