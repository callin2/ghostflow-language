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
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureDirectory = path.join(root, 'tests/fixtures');
const sourceName = 'gfb1-golden-v1.ghost.md';
const artifactName = 'gfb1-golden-v1.gfb';
const metadataName = 'gfb1-golden-v1.json';
const sourcePath = path.join(fixtureDirectory, sourceName);
const artifactPath = path.join(fixtureDirectory, artifactName);
const nativePath = path.join(root, 'target/release/examples/run' + (process.platform === 'win32' ? '.exe' : ''));
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const fixedSourceSha256 = 'e5bd49cf3b7705d0ac6e4a4867a488b7f47c6d6873fb3c94ea6fb7faefc5ceee';
const fixedGfbSha256 = 'aa579db225ebdd9fed2e8f29815b5ba5cceed22fd1164c01aaf8d8e6455640dc';

const sha256 = value => createHash('sha256').update(value).digest('hex');

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

test('GF-TEST-gfb1-golden: historical source and byte identities remain fixed while canonical plain access rejects', async () => {
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

  await assert.rejects(() => compileSource(source, { filename: sourceName }), /next state running must be Bool/);
});

test('GF-TEST-gfb1-input-golden: explicit new quality source has independent bytes and typed recovery parity', async t => {
  const name = 'gfb1-golden-input-v1';
  const source = fs.readFileSync(path.join(fixtureDirectory, `${name}.ghost.md`), 'utf8');
  const tracked = fs.readFileSync(path.join(fixtureDirectory, `${name}.gfb`));
  const metadata = JSON.parse(fs.readFileSync(path.join(fixtureDirectory, `${name}.json`), 'utf8'));
  assert.deepEqual(metadata, {
    format: 'GhostFlow/input-quality-golden-v1', source: `${name}.ghost.md`,
    sourceSha256: '9ab0ca2ccb83cb8a3d962fa88320e4980e8aafafabf27c012253ce84a4c99f48',
    artifact: `${name}.gfb`, gfbSha256: '7828f5b8ac5b373e1c548a21ccc0c2f75c65ddda5f36e0794b9658280dd45588',
    gfbFormat: 3, sourceRevision: 'canonical-input-quality-v1',
  });
  assert.equal(sha256(source), '9ab0ca2ccb83cb8a3d962fa88320e4980e8aafafabf27c012253ce84a4c99f48');
  assert.equal(sha256(tracked), '7828f5b8ac5b373e1c548a21ccc0c2f75c65ddda5f36e0794b9658280dd45588');
  assert.equal(metadata.sourceSha256, sha256(source));
  assert.equal(metadata.gfbSha256, sha256(tracked));
  assert.equal(metadata.sourceRevision, 'canonical-input-quality-v1');
  const artifact = await compileSource(source, { filename: `${name}.ghost.md` });
  assert.deepEqual(artifact.bytes, tracked);
  assert.equal(artifact.manifest.sensors[0].type, 'Bool');
  assert.deepEqual(artifact.manifest.inputs, []);
  const frames = [[false, 'Good', false], [true, 'Good', true],
    [false, 'Disconnected', true], [false, 'Good', false]];
  const outcomes = [];
  for (const create of [ControlRuntime.instantiate, ControlRuntime.instantiateFramed]) {
    const host = await create.call(ControlRuntime, fs.readFileSync(wasmPath), artifact);
    t.after(() => host.dispose());
    const traces = frames.map(([value, quality, expected], index) => {
      const trace = host.step({ nowMs: index, samples: { enabled: {
        epoch: 1, id: index + 1, timestampMs: index, value, quality,
      } } }).vm;
      assert.equal(trace.stateAfter.running, expected);
      assert.equal(trace.safe.pump, !expected);
      assert.equal(trace.inputs.__gf_sensor_ok_enabled, quality === 'Good');
      return trace;
    });
    outcomes.push(traces);
  }
  assert.deepEqual(outcomes[0].map(trace => trace.safe), outcomes[1].map(trace => trace.safe));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-input-golden-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const module = path.join(temporary, 'quality.gfb'), csv = path.join(temporary, 'quality.csv');
  const fields = Object.keys(outcomes[0][0].inputs);
  fs.writeFileSync(module, tracked);
  fs.writeFileSync(csv, `${fields.join(',')}\n${outcomes[0].map(trace => fields.map(field => trace.inputs[field]).join(',')).join('\n')}\n`);
  const native = execFileSync(nativePath, [module, csv, '--outcomes'], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
  assert.deepEqual(native.map(row => row.trace.safe), outcomes[0].map(trace => trace.safe));
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
  const queryNeedle = Buffer.concat([Buffer.from([21, 0, 0, 0, 1, 8, 0]), Buffer.from('actuator'), Buffer.from([4, 0]), Buffer.from('pump'), Buffer.from([1])]);
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
