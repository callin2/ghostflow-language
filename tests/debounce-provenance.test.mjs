import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource, restoreArtifactSourceMap, writeArtifact } from '../tools/toolchain.mjs';
import { buildPortablePackage, verifyPortablePackage } from '../tools/portable-package.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const source = '# Debounced start\n\n```ghost\ncontrol Bounce {\n  input start: Bool;\n  signal stable = debounce(start, stable_for: 2s, initial: false);\n  output enabled: Bool;\n  enabled <- stable;\n}\n```\n';
const roles = ['stable', 'candidate', 'candidateActive', 'candidateSince', 'lastSourceTag'];

test('debounce generated state provenance survives canonical artifact restore', async () => {
  const compiled = await compileSource(source, { filename: 'bounce.ghost.md' });
  const bindings = compiled.traceMetadata.bindings.filter(binding => binding.kind === 'signal');
  assert.equal(bindings.length, roles.length);
  assert.deepEqual(new Set(bindings.map(binding => binding.generated.role)), new Set(roles));
  for (const binding of bindings) {
    assert.equal(binding.generated.declaration, 'stable');
    assert.deepEqual(binding.fields, ['stateBefore', 'stateAfter']);
    assert.equal(binding.source.filename, 'bounce.ghost.md');
    assert.equal(binding.source.line, 6);
    assert.equal(binding.source.column, 3);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-debounce-map-'));
  try {
    const output = path.join(directory, 'bounce.gfb');
    writeArtifact(compiled, output);
    const envelope = JSON.parse(fs.readFileSync(`${output}.map.json`, 'utf8'));
    assert.deepEqual(restoreArtifactSourceMap(envelope, compiled.bytes).traceMetadata, compiled.traceMetadata);
    const missing = structuredClone(envelope);
    missing.traceMetadata.bindings = missing.traceMetadata.bindings.filter(binding => binding.kind !== 'signal');
    assert.throws(() => restoreArtifactSourceMap(missing, compiled.bytes), /debounce|signal.*binding/);
    const renamed = structuredClone(envelope);
    renamed.traceMetadata.bindings.find(binding => binding.kind === 'signal').name += '_forged';
    assert.throws(() => restoreArtifactSourceMap(renamed, compiled.bytes), /debounce|signal.*binding/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('debounce source provenance identifies both physical root histories', async () => {
  const document = ['# Selected sensor', '```ghost', 'control Selected {',
    'input choose: Bool;', 'sensor a: Bool;', 'sensor b: Bool;',
    'signal stable = debounce(if choose then a else b, stable_for: 1s, initial: false);',
    'output enabled: Bool;', 'enabled <- stable |> recover(false);', '}', '```', ''].join('\n');
  const compiled = await compileSource(document, { filename: 'selected.ghost.md' });
  const bindings = compiled.traceMetadata.bindings.filter(binding => binding.kind === 'signal');
  assert.equal(bindings.length, 9);
  for (const root of compiled.manifest.signals[0].sources) {
    for (const [role, field] of [['sourceEpoch', 'lastEpoch'], ['sourceId', 'lastId']]) {
      const binding = bindings.find(entry => entry.generated.role === role && entry.generated.sourceTag === root.tag);
      assert.ok(binding, `${root.name} ${role}`);
      assert.equal(binding.name, root.states[field]);
      assert.deepEqual(binding.generated, { declaration: 'stable', role, sourceTag: root.tag });
      assert.equal(binding.source.line, 7);
    }
  }
});

for (const [kind, signedSource, inputCapability] of [
  ['raw', source, { kind: 'input', name: 'start', type: 'bool' }],
  ['physical', source.replace('input start: Bool;', 'sensor start: Bool;').replace('enabled <- stable;', 'enabled <- stable |> recover(false);'), { kind: 'sensor', name: 'start', type: 'bool' }],
]) test(`signed ${kind} debounce artifacts reject changed descriptors and generated dependencies before loading`, async () => {
  const compiled = await compileSource(signedSource, { filename: 'bounce.ghost.md' });
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const keyId = 'debounce-provenance';
  const identity = {
    compilerRevision: 'c0bef0e', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/framed-scan-abi-v1', bindingRevision: 'debounce-test-v1',
    requiredCapabilities: [inputCapability, { kind: 'actuator', name: 'enabled', type: 'bool' }],
  };
  const signed = await buildPortablePackage(compiled, identity, {
    signers: [{ keyId, privateKey: keys.privateKey }], verifyCompilation: compileSource,
  });
  let loads = 0;
  const options = {
    trustedKeys: [{ keyId, publicKey: keys.publicKey }], revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics], supportedRuntimeAbis: [identity.runtimeAbi],
    supportedManifestFormats: [compiled.manifest.format], availableCapabilities: identity.requiredCapabilities,
    expectedBindingRevision: identity.bindingRevision,
    verifyBytecode: async bytes => {
      loads++;
      const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url)));
      try { runtime.load(bytes); return true; } finally { runtime.dispose(); }
    },
  };
  await verifyPortablePackage(signed, options);
  assert.equal(loads, 1);
  const mutations = [
    ['duration', 'manifest', value => { value.signals[0].stableForMs++; }, /debounce descriptors/],
    ['initial value', 'manifest', value => { value.signals[0].initial = true; }, /debounce descriptors/],
    ['state binding', 'manifest', value => { value.signals[0].states.stable += '_forged'; }, /debounce descriptors/],
    ['missing descriptor', 'manifest', value => { value.signals = []; }, /debounce descriptors/],
    ['missing generated bindings', 'sourceMap', value => { value.traceMetadata.bindings = value.traceMetadata.bindings.filter(binding => binding.kind !== 'signal'); }, /debounce binding/],
    ['forged dependency', 'sourceMap', value => { value.traceMetadata.dependencies.find(entry => entry.target.name.startsWith('__gf_debounce_')).reads = []; }, /debounce dependencies/],
    ['removed trace and nodes', 'sourceMap', value => { value.traceMetadata = null; value.nodes = []; }, /trace metadata is required/],
  ];
  if (kind === 'physical') mutations.push(
    ['missing root history', 'manifest', value => { delete value.signals[0].sources[0].states.lastId; }, /debounce descriptors/],
    ['forged source tag', 'sourceMap', value => { value.traceMetadata.bindings.find(binding => binding.generated?.role === 'sourceId').generated.sourceTag++; }, /debounce binding/],
    ['missing source epoch binding', 'sourceMap', value => { value.traceMetadata.bindings = value.traceMetadata.bindings.filter(binding => binding.generated?.role !== 'sourceEpoch'); }, /debounce binding/],
    ['missing sample identity', 'manifest', value => { delete value.sensors[0].sampleIdInput; }, /sampleIdInput must be __gf_sensor_sample_id_start/, 'manifest-mismatch'],
    ['forged sample time input', 'manifest', value => { value.sensors[0].sampleTimestampInput += '_forged'; }, /sampleTimestampInput must be __gf_sensor_sample_timestamp_start/, 'manifest-mismatch'],
  );
  for (const [label, artifact, mutate, diagnostic, code = 'source-map-mismatch'] of mutations) {
    const candidate = structuredClone(signed);
    const record = candidate.payload[artifact];
    const decoded = JSON.parse(Buffer.from(record.contentBase64, 'base64').toString('utf8'));
    mutate(decoded);
    const bytes = Buffer.from(canonicalJson(decoded));
    record.contentBase64 = bytes.toString('base64'); record.sha256 = sha256Hex(bytes);
    const payload = Buffer.from(canonicalJson(candidate.payload));
    candidate.payloadSha256 = sha256Hex(payload);
    candidate.signatures = [{ algorithm: 'Ed25519', keyId,
      signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', keys.privateKey, payload)).toString('base64') }];
    await assert.rejects(() => verifyPortablePackage(candidate, options), error => {
      assert.equal(error.code, code, label);
      if (code === 'source-map-mismatch') {
        assert.equal(error.message, 'source map trace metadata does not match source and GFB1', label);
        assert.match(error.cause?.message ?? '', diagnostic, label);
      } else assert.match(error.message, diagnostic, label);
      return true;
    });
    assert.equal(loads, 1, `${label} must reject before loading`);
  }
});
