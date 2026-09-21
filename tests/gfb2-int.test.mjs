import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = path.join(root, 'tests/fixtures');
const sourceName = 'gfb2-int-golden-v1.ghost.md';
const artifactName = 'gfb2-int-golden-v1.gfb';
const metadataName = 'gfb2-int-golden-v1.json';
const nativePath = path.join(root, 'target/release/examples/run');
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('GF-TEST-gfb2-int-golden: MIN, zero, and MAX compile to fixed exact v2 bytes', async () => {
  const source = fs.readFileSync(path.join(fixtures, sourceName), 'utf8');
  const tracked = fs.readFileSync(path.join(fixtures, artifactName));
  const metadata = JSON.parse(fs.readFileSync(path.join(fixtures, metadataName), 'utf8'));
  const compiled = await compileSource(source, { filename: sourceName });
  assert.equal(new DataView(tracked.buffer, tracked.byteOffset).getUint16(4, true), 2);
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v4');
  assert.deepEqual(compiled.bytes, tracked);
  assert.equal(sha256(source), metadata.sourceSha256);
  assert.equal(sha256(tracked), metadata.gfbSha256);
});

test('GF-TEST-gfb2-int-boundary: native and WASM exchange every i32 boundary exactly', async t => {
  const bytes = fs.readFileSync(path.join(fixtures, artifactName));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-gfb2-int-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'integer.gfb');
  const inputPath = path.join(temporary, 'integer.csv');
  fs.writeFileSync(modulePath, bytes);
  fs.writeFileSync(inputPath, 'selected\n-2147483648\n0\n2147483647\n');
  const native = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(native.map(row => row.trace.safe.selected_out), [-2147483648, 0, 2147483647]);
  assert.deepEqual(native[0].trace.stateAfter, { maximum: 2147483647, minimum: -2147483648, zero: 0 });

  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(bytes);
  for (const name of ['selected_out', 'minimum_out', 'zero_out', 'maximum_out']) runtime.addCapability('actuator', name, 'int');
  runtime.activate();
  const observed = [];
  for (const value of [-2147483648, 0, 2147483647]) {
    runtime.setInt('selected', value);
    runtime.tick();
    observed.push(runtime.intentInt('selected_out'));
  }
  assert.deepEqual(observed, [-2147483648, 0, 2147483647]);
  assert.equal(runtime.stateInt('minimum'), -2147483648);
  assert.equal(runtime.stateInt('maximum'), 2147483647);
  assert.throws(() => runtime.setInt('selected', 1.5), /i32/);
  assert.throws(() => runtime.setInt('selected', 2147483648), /i32/);
});

test('GF-TEST-gfb2-int-rejection: versions and type tags fail closed', async () => {
  const v1 = fs.readFileSync(path.join(fixtures, 'gfb1-golden-v1.gfb'));
  const v2 = fs.readFileSync(path.join(fixtures, artifactName));
  const cases = [];
  const oldAsNew = Buffer.from(v1); oldAsNew.writeUInt16LE(2, 4); cases.push([oldAsNew, /format 2 without Int/]);
  const newAsOld = Buffer.from(v2); newAsOld.writeUInt16LE(1, 4); cases.push([newAsOld, /invalid type/]);
  const unknownVersion = Buffer.from(v2); unknownVersion.writeUInt16LE(3, 4); cases.push([unknownVersion, /unsupported GFB format/]);
  const invalidType = Buffer.from(v2);
  const nameLength = invalidType.readUInt16LE(6);
  const inputTypeOffset = 6 + 2 + nameLength + 4 + 2 + 2 + 'selected'.length;
  invalidType[inputTypeOffset] = 4;
  cases.push([invalidType, /invalid type/]);

  const wasmBytes = fs.readFileSync(wasmPath);
  for (const [bytes, expected] of cases) {
    const runtime = await GhostFlowRuntime.instantiate(wasmBytes);
    try { assert.throws(() => runtime.load(bytes), expected); }
    finally { runtime.dispose(); }
  }
});

test('GF-TEST-framed-v2-int: tag 3 carries signed i32 values without Number inference', async t => {
  const runtime = await FramedGhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(fs.readFileSync(path.join(fixtures, artifactName)));
  for (const name of ['selected_out', 'minimum_out', 'zero_out', 'maximum_out']) runtime.addCapability('actuator', name, 'int');
  runtime.activate();
  for (const [scanId, value] of [-2147483648, 0, 2147483647].entries()) {
    const outcome = runtime.scan({ scanId, logicalTimeMs: scanId, inputs: [{ name: 'selected', type: 'Int', value }] });
    assert.equal(outcome.trace.inputs.selected, value);
    assert.equal(outcome.trace.safe.selected_out, value);
  }
  assert.throws(() => runtime.scan({ scanId: 3, logicalTimeMs: 3, inputs: [{ name: 'selected', type: 'Int', value: 1.5 }] }), /i32/);
  assert.throws(() => runtime.scan({ scanId: 3, logicalTimeMs: 3, inputs: [{ name: 'selected', type: 'Int', value: 2147483648 }] }), /i32/);
});

test('GF-TEST-control-v4-int: manifest-selected legacy and framed hosts preserve Int identity', async t => {
  const source = fs.readFileSync(path.join(fixtures, sourceName), 'utf8');
  const artifact = await compileSource(source, { filename: sourceName });
  const wasm = fs.readFileSync(wasmPath);
  for (const create of [ControlRuntime.instantiate, ControlRuntime.instantiateFramed]) {
    const runtime = await create.call(ControlRuntime, wasm, artifact);
    t.after(() => runtime.dispose());
    const result = runtime.step({ nowMs: 0, inputs: { selected: -2147483648 } });
    assert.equal(result.vm.safe.selected_out, -2147483648);
  }
  const runtime = await ControlRuntime.instantiate(wasm, artifact);
  t.after(() => runtime.dispose());
  assert.throws(() => runtime.step({ nowMs: 0, inputs: { selected: 1.5 } }), /safe integer/);
});
