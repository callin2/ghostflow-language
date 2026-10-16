import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { compileSource } from '../tools/toolchain.mjs';
import { restoreArtifactSourceMap, verifyArtifactSourceMap } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const source = '# Coverage malformed\n\n```ghost\ncontrol CoverageMalformed {\n  input enabled: Bool;\n  output active: Bool;\n  active <- case enabled { ok(value) => value; fault(_) => false; };\n}\n```\n';
const clone = value => structuredClone(value);

test('runtime rejects malformed manifest domains before loading WASM', async () => {
  const artifact = await compileSource(source, { filename: 'coverage-malformed.input-v1.ghost.md' });
  const mutations = [
    ['format', manifest => { manifest.format = 'GhostFlow/nope'; }, /unsupported manifest format/],
    ['digest', manifest => { manifest.bytecodeSha256 = '0'.repeat(64); }, /bytecode SHA-256/],
    ['inputs', manifest => { manifest.inputs = {}; }, /manifest.inputs must be an array/],
    ['input item', manifest => { manifest.inputs = [null]; }, /must be an object/],
    ['input key', manifest => { manifest.inputs = [{ name: 'enabled', type: 'Bool', extra: true }]; }, /unknown key/],
    ['duplicate input', manifest => { manifest.inputs = [{ name: 'enabled', type: 'Bool' }, { name: 'enabled', type: 'Bool' }]; }, /duplicate input/],
    ['output type', manifest => { manifest.outputs[0].type = 'Nope'; }, /unsupported type/],
    ['schedules', manifest => { manifest.schedules = [null]; }, /must be an object/],
    ['timers', manifest => { manifest.timers = [null]; }, /must be an object/],
    ['signals', manifest => { manifest.signals = [null]; }, /must be an object/],
    ['configs', manifest => { manifest.configs = {}; }, /manifest.configs must be an array/],
    ['too many names', manifest => { manifest.inputs = Array.from({ length: 129 }, (_, i) => ({ name: `x${i}`, type: 'Bool' })); }, /exceeds 128/],
  ];
  for (const [label, mutate, diagnostic] of mutations) {
    const manifest = clone(artifact.manifest); mutate(manifest);
    await assert.rejects(ControlRuntime.instantiate(wasm, { ...artifact, manifest }), diagnostic, label);
  }
});

test('source-map verifier rejects malformed envelope fields before replay', async () => {
  const artifact = await compileSource(source, { filename: 'coverage-malformed.input-v1.ghost.md' });
  const envelope = {
    format: 'GhostFlow/source-map-v1', bytecodeSha256: artifact.manifest.bytecodeSha256,
    sourceDocument: artifact.sourceDocument, nodes: artifact.sourceMap, lines: artifact.extractionMap,
    traceMetadata: artifact.traceMetadata,
  };
  const mutations = [
    ['null map', () => null],
    ['format', map => { map.format = 'bad'; }],
    ['nodes', map => { map.nodes = {}; }],
    ['lines', map => { map.lines = {}; }],
    ['digest', map => { map.bytecodeSha256 = '0'.repeat(64); }],
    ['document', map => { map.sourceDocument = null; }],
    ['document format', map => { map.sourceDocument.format = 'bad'; }],
    ['document filename', map => { map.sourceDocument.filename = ''; }],
    ['document text', map => { map.sourceDocument.text = '\ud800'; }],
    ['document digest', map => { map.sourceDocument.sha256 = '0'.repeat(64); }],
    ['trace', map => { map.traceMetadata = {}; }],
  ];
  for (const [label, mutate] of mutations) {
    const map = clone(envelope); const changed = mutate(map);
    assert.throws(() => verifyArtifactSourceMap(changed === undefined ? map : changed, artifact.bytes), undefined, label);
  }
  assert.doesNotThrow(() => restoreArtifactSourceMap(envelope, artifact.bytes));
});

// These are independent coverage-only fixtures, not historical source rewrites.
test('coverage input revisions retain independently pinned pre-migration fixtures', () => {
  const bytes = fs.readFileSync(new URL('./fixtures/history/issue531/coverage-only-fixtures.pre-input.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '524659b91a19046aaf7a707f557abb93752aa51c60876616e5cbfe3c8ecb7b8b');
  const archive = JSON.parse(bytes);
  assert.equal(archive.files.length, 4);
  for (const row of archive.files) assert.equal(createHash('sha256').update(row.text).digest('hex'), row.sha256, row.path);
});

// New canonical source syntax does not invalidate historical scalar artifacts.
test('historical GFB1 scalar input remains typed through plain and framed host admission', async () => {
  const bytes = fs.readFileSync(new URL('./fixtures/gfb1-golden-v1.gfb', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'aa579db225ebdd9fed2e8f29815b5ba5cceed22fd1164c01aaf8d8e6455640dc');
  const manifest = { format: 'GhostFlow/control-v1', name: 'gfb1_golden',
    bytecodeSha256: createHash('sha256').update(bytes).digest('hex'),
    inputs: [{ name: 'enabled', type: 'Bool' }], outputs: [{ name: 'pump', type: 'Bool' }],
    sensors: [], schedules: [], timers: [], signals: [], configs: [] };
  for (const instantiate of [ControlRuntime.instantiate, ControlRuntime.instantiateFramed]) {
    const runtime = await instantiate.call(ControlRuntime, wasm, { bytes, manifest });
    try {
      for (const [nowMs, enabled] of [[0, false], [1, true]]) {
        const result = runtime.step({ nowMs, inputs: { enabled } });
        assert.deepEqual(result.vm.safe, { pump: !enabled });
        assert.equal(result.vm.stateAfter.running, enabled);
        assert.deepEqual(result.sensors, {});
      }
      assert.throws(() => runtime.step({ nowMs: 2, inputs: { enabled: 0 } }), /boolean/);
      assert.throws(() => runtime.step({ nowMs: 2 }), /missing input enabled/);
      assert.equal(runtime.step({ nowMs: 2, inputs: { enabled: false } }).vm.stateAfter.running, false);
    } finally { runtime.dispose(); }
  }
});
