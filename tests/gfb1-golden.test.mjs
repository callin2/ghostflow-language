import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TextEncoder } from 'node:util';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { extractLiterate } from '../tools/literate.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureDirectory = path.join(root, 'tests/fixtures');
const sourceName = 'gfb1-golden-v1.ghost.md';
const artifactName = 'gfb1-golden-v1.gfb';
const metadataName = 'gfb1-golden-v1.json';
const sourcePath = path.join(fixtureDirectory, sourceName);
const artifactPath = path.join(fixtureDirectory, artifactName);
const nativePath = path.join(root, 'target/release/examples/run');
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const fixedSourceSha256 = 'af7e2a824c337ace94e38ff82ef5a1344d75f2374e2581ef390f76f8ce8d92a0';
const fixedGfbSha256 = '2a8ff8e4e26ce6ed7bd92404f0c94ca4d469dbcb672e5ea6e1243c06805a079b';

const sha256 = value => createHash('sha256').update(value).digest('hex');

function compileWithoutBuffer(source) {
  const modulePath = new URL('../tools/gfb1.mjs', import.meta.url);
  const moduleSource = fs.readFileSync(modulePath, 'utf8').replace(
    'export { tokenize, parse, compile, CompileError };',
    'globalThis.__gfb1 = { tokenize, parse, compile, CompileError };',
  );
  const context = vm.createContext({ TextEncoder, Uint8Array, DataView, Map, Set, Array, Object, JSON, Number, String, RegExp, Error });
  vm.runInContext(moduleSource, context, { filename: modulePath.pathname });
  assert.equal(vm.runInContext('typeof Buffer', context), 'undefined');
  const bytes = vm.runInContext(`__gfb1.compile(__gfb1.parse(__gfb1.tokenize(${JSON.stringify(source)})))`, context);
  assert.equal(bytes.constructor.name, 'Uint8Array');
  assert.equal(Buffer.isBuffer(bytes), false);
  return bytes;
}

function mutateUnique(bytes, needle, relativeOffset, value) {
  const at = bytes.indexOf(needle);
  assert.notEqual(at, -1, `golden mutation pattern not found: ${needle.toString('hex')}`);
  assert.equal(bytes.indexOf(needle, at + 1), -1, `golden mutation pattern is not unique: ${needle.toString('hex')}`);
  const changed = Buffer.from(bytes);
  changed[at + relativeOffset] = value;
  return changed;
}

function nativeOutcomes(directory, name, bytes) {
  const modulePath = path.join(directory, `${name}.gfb`);
  const inputPath = path.join(directory, `${name}.csv`);
  fs.writeFileSync(modulePath, bytes);
  fs.writeFileSync(inputPath, 'enabled\ntrue\n');
  const output = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim();
  return output ? output.split('\n').map(line => JSON.parse(line)) : [];
}

async function wasmLoad(bytes, run) {
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  try {
    runtime.load(bytes);
    return run(runtime);
  } finally {
    runtime.dispose();
  }
}

test('GF-TEST-gfb1-golden: literate source recompiles to the fixed tracked bytes in Node and without Buffer', async () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const tracked = fs.readFileSync(artifactPath);
  const metadata = JSON.parse(fs.readFileSync(path.join(fixtureDirectory, metadataName), 'utf8'));
  assert.deepEqual(metadata, {
    format: 'GhostFlow/gfb1-golden-v1',
    source: sourceName,
    sourceSha256: fixedSourceSha256,
    artifact: artifactName,
    gfbSha256: fixedGfbSha256,
  });
  assert.equal(sha256(source), fixedSourceSha256);
  assert.equal(sha256(tracked), fixedGfbSha256);

  const node = await compileSource(source, { filename: sourceName });
  assert.equal(node.sourceDocument.sha256, fixedSourceSha256);
  assert.deepEqual(node.bytes, tracked);
  assert.equal(sha256(node.bytes), fixedGfbSha256);

  const extracted = extractLiterate(source, { filename: sourceName });
  const browser = compileWithoutBuffer(extracted.code);
  assert.deepEqual(Buffer.from(browser), tracked);
  assert.equal(sha256(browser), fixedGfbSha256);
});

test('GF-TEST-gfb1-golden-load: native and release WASM independently accept only the exact valid vector', async t => {
  assert.ok(fs.existsSync(nativePath), 'release native loader is required; run the full language verifier');
  assert.ok(fs.existsSync(wasmPath), 'release WASM loader is required; run the full language verifier');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-gfb1-golden-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const tracked = fs.readFileSync(artifactPath);

  const nativeValid = nativeOutcomes(temporary, 'valid', tracked);
  assert.equal(nativeValid.length, 1);
  assert.equal(nativeValid[0].status, 'OK');
  assert.equal(nativeValid[0].trace.stateAfter.running, true);
  assert.equal(nativeValid[0].trace.safe.pump, false);
  const wasmValid = await wasmLoad(tracked, runtime => {
    runtime.addCapability('actuator', 'pump', 'bool');
    runtime.activate();
    runtime.setBool('enabled', true);
    runtime.tick();
    return runtime.trace;
  });
  assert.equal(wasmValid.stateAfter.running, true);
  assert.equal(wasmValid.safe.pump, false);

  const invalidMagic = Buffer.from(tracked);
  invalidMagic[0] ^= 0x01;
  const unsupportedVersion = Buffer.from(tracked);
  unsupportedVersion.writeUInt16LE(2, 4);
  const queryNeedle = Buffer.concat([Buffer.from([18, 0, 0, 0, 1, 8, 0]), Buffer.from('actuator'), Buffer.from([4, 0]), Buffer.from('pump'), Buffer.from([1])]);
  const expressionNeedle = Buffer.from([4, 0, 0, 0, 3, 0, 0, 10]);
  const cases = [
    ['magic', invalidMagic, /invalid GFB1 magic/],
    ['unsupported-format-version', unsupportedVersion, /unsupported GFB format/],
    ['truncated-empty', tracked.subarray(0, 0), /truncated bytecode/],
    ['truncated-magic', tracked.subarray(0, 4), /truncated bytecode/],
    ['truncated-format-version', tracked.subarray(0, 5), /truncated bytecode/],
    ['truncated-middle', tracked.subarray(0, Math.floor(tracked.length / 2)), /truncated bytecode/],
    ['truncated-final-byte', tracked.subarray(0, tracked.length - 1), /truncated bytecode/],
    ['trailing-one-byte', Buffer.concat([tracked, Buffer.from([0])]), /trailing module bytes/],
    ['trailing-three-bytes', Buffer.concat([tracked, Buffer.from([1, 2, 3])]), /trailing module bytes/],
    ['malformed-query-stack', mutateUnique(tracked, queryNeedle, 4, 4), /query underflow/],
    ['malformed-expression-stack', mutateUnique(tracked, expressionNeedle, 4, 10), /stack underflow/],
  ];

  for (const [name, bytes, expected] of cases) {
    const native = nativeOutcomes(temporary, name, bytes);
    assert.equal(native.length, 1, `${name}: native must emit one fail-closed outcome`);
    assert.equal(native[0].status, 'ERROR', `${name}: native must reject`);
    assert.equal(native[0].phase, 'load', `${name}: native must reject during load`);
    assert.match(native[0].error, expected, `${name}: native error`);

    const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
    try {
      assert.throws(() => runtime.load(bytes), expected, `${name}: WASM must reject during load`);
      assert.throws(() => runtime.activate(), /no module installed/, `${name}: WASM must not activate a fallback module`);
    } finally {
      runtime.dispose();
    }
  }
});
