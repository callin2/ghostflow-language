import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { restoreArtifactSourceMap, verifyArtifactSourceMap } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const source = '# Coverage malformed\n\n```ghost\ncontrol CoverageMalformed {\n  input enabled: Bool;\n  output active: Bool;\n  active <- enabled;\n}\n```\n';
const clone = value => structuredClone(value);

test('runtime rejects malformed manifest domains before loading WASM', async () => {
  const artifact = await compileSource(source, { filename: 'coverage-malformed.ghost.md' });
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
  const artifact = await compileSource(source, { filename: 'coverage-malformed.ghost.md' });
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
