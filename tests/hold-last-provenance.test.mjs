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
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { observeSourceTrace } from '../tools/source-trace.mjs';

const source = `# Hold last\n\n\`\`\`ghost\ncontrol HoldLastFixture {
  input temperature: Temperature;
  signal usable_temperature = hold_last(temperature, for_at_most: 2s, quality: measured);
  output ready: Bool;
  ready <- true;
}\n\`\`\`\n`;
const filename = 'hold-last.ghost.md';
const roles = ['available', 'value', 'heldSourceTag', 'heldEpoch', 'heldId', 'heldTimestamp', 'held', 'age', 'maskedFaultPresent', 'maskedFaultCode', 'maskedFaultOrigin'];

test('hold_last compile emits descriptor and generated provenance roles', async () => {
  const compiled = await compileSource(source, { filename });
  const descriptor = compiled.manifest.signals.find(signal => signal.name === 'usable_temperature');
  assert.equal(descriptor.kind, 'hold-last');
  assert.equal(descriptor.sourceMode, 'sample');
  assert.deepEqual(new Set(Object.keys(descriptor.states)), new Set(roles));
  assert.equal(compiled.sourceMap.find(node => node.kind === 'signal')?.signalMode, 'hold_last');
  for (const role of roles) {
    assert.ok(compiled.traceMetadata.bindings.some(binding => binding.generated?.role === role), `missing ${role}`);
  }
  assert.ok(compiled.traceMetadata.bindings.some(binding => binding.generated?.role === 'sourceEpoch'));
  assert.ok(compiled.traceMetadata.bindings.some(binding => binding.generated?.role === 'sourceId'));
});

test('hold_last source envelope restore preserves canonical source and generated bindings', async () => {
  const compiled = await compileSource(source, { filename });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-hold-last-'));
  try {
    const output = path.join(directory, 'hold-last.gfb');
    writeArtifact(compiled, output);
    const envelope = JSON.parse(fs.readFileSync(`${output}.map.json`, 'utf8'));
    const restored = restoreArtifactSourceMap(envelope, compiled.bytes);
    assert.equal(restored.sourceDocument.text, source);
    assert.deepEqual(restored.traceMetadata.bindings, compiled.traceMetadata.bindings);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('hold_last restore rejects missing and forged generated provenance', async () => {
  const compiled = await compileSource(source, { filename });
  const envelope = {
    format: 'GhostFlow/source-map-v1', bytecodeSha256: compiled.manifest.bytecodeSha256,
    sourceDocument: compiled.sourceDocument, nodes: compiled.sourceMap,
    lines: compiled.extractionMap, traceMetadata: compiled.traceMetadata,
  };
  const missing = structuredClone(envelope);
  missing.traceMetadata.bindings = missing.traceMetadata.bindings.filter(binding => binding.generated?.role !== 'held');
  assert.throws(() => restoreArtifactSourceMap(missing, compiled.bytes), /hold.?last|signal.*binding|generated/);
  const forged = structuredClone(envelope);
  const binding = forged.traceMetadata.bindings.find(entry => entry.generated?.role === 'value');
  binding.name = `${binding.name}_forged`;
  assert.throws(() => restoreArtifactSourceMap(forged, compiled.bytes), /hold.?last|signal.*binding|generated/);
  const forgedSourceTag = structuredClone(envelope);
  const sourceBinding = forgedSourceTag.traceMetadata.bindings.find(entry => entry.generated?.role === 'sourceId');
  sourceBinding.generated.sourceTag += 1;
  assert.throws(() => restoreArtifactSourceMap(forgedSourceTag, compiled.bytes), /hold.?last|signal.*binding|generated/);
});

test('hold_last source observer reports held identity, age, masked fault, and expiry', async () => {
  const compiled = await compileSource(source, { filename });
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  try {
    const sample = { epoch: 1, id: 7, timestampMs: 0, value: 300, quality: 'Good' };
    const descriptor = compiled.manifest.signals[0];
    const tag = descriptor.sources[0].tag;
    const fresh = observeSourceTrace(compiled.traceMetadata, runtime.step({ nowMs: 0, samples: { temperature: sample } }).vm);
    assert.deepEqual(fresh.heldEvents, [{
      name: 'usable_temperature', nodeId: compiled.sourceMap.find(node => node.kind === 'signal').id,
      source: compiled.traceMetadata.bindings.find(binding => binding.generated?.role === 'held').source, quality: 'Held', value: 300,
      sourceTag: tag, epoch: 1, id: 7, timestampMs: 0, ageMs: 0, maskedFault: null,
    }]);
    const faultTrace = runtime.step({ nowMs: 1000, samples: {
      temperature: { ...sample, id: 8, timestampMs: 1000, quality: 'Invalid' },
    } }).vm;
    const fault = observeSourceTrace(compiled.traceMetadata, faultTrace);
    assert.equal(fault.heldEvents[0].quality, 'Held');
    assert.equal(fault.heldEvents[0].value, 300);
    assert.deepEqual({ epoch: fault.heldEvents[0].epoch, id: fault.heldEvents[0].id, timestampMs: fault.heldEvents[0].timestampMs }, { epoch: 1, id: 7, timestampMs: 0 });
    assert.equal(fault.heldEvents[0].ageMs, 1000);
    assert.deepEqual(fault.heldEvents[0].maskedFault, { code: 2, fault: 'Invalid', origin: tag });
    const expired = observeSourceTrace(compiled.traceMetadata, runtime.step({ nowMs: 2000, samples: {
      temperature: { ...sample, id: 9, timestampMs: 2000, quality: 'Invalid' },
    } }).vm);
    assert.deepEqual(expired.heldEvents, []);
    for (const [role, value] of [['heldId', -1], ['age', 0.5], ['maskedFaultOrigin', 0]]) {
      const forged = structuredClone(faultTrace);
      forged.stateAfter[descriptor.states[role]] = value;
      assert.throws(() => observeSourceTrace(compiled.traceMetadata, forged), /hold_last trace/);
    }
  } finally { runtime.dispose(); }
});

test('hold_last host rejects malformed descriptors before activation', async t => {
  const compiled = await compileSource(source, { filename });
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  for (const [label, mutate, diagnostic] of [
    ['quality', item => { item.quality = 'Held'; }, /requires measured SensorFault sample evidence/],
    ['error type', item => { item.errorType = 'ClockFault'; }, /requires measured SensorFault sample evidence/],
    ['zero duration', item => { item.forAtMostMs = 0; }, /forAtMostMs must be a safe integer/],
    ['fractional duration', item => { item.forAtMostMs = 0.5; }, /forAtMostMs must be a safe integer/],
    ['missing state', item => { delete item.states.held; }, /states.held is required/],
    ['forged state', item => { item.states.held += '_forged'; }, /states.held/],
    ['missing source', item => { item.sources = []; }, /sourceMode does not match sources/],
    ['unknown source', item => { item.sources[0].name = 'missing'; }, /unknown sample source/],
    ['unknown role', item => { item.states.extra = '__gf_extra'; }, /unknown key extra/],
  ]) await t.test(label, async () => {
    const artifact = { bytes: compiled.bytes, manifest: structuredClone(compiled.manifest) };
    mutate(artifact.manifest.signals[0]);
    await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact), diagnostic);
  });
});

test('signed hold_last package binds duration, quality, identity and trace to canonical source', async () => {
  const compiled = await compileSource(source, { filename });
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const keyId = 'hold-last-test';
  const identity = {
    compilerRevision: 'c0bef0e', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/framed-scan-abi-v1', bindingRevision: 'hold-last-test-v1',
    requiredCapabilities: [{ kind: 'sensor', name: 'temperature', type: 'number' }, { kind: 'actuator', name: 'ready', type: 'bool' }],
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
  for (const [artifactName, mutate, diagnostic] of [
    ['manifest', value => { value.signals[0].forAtMostMs++; }, /hold-last descriptors/],
    ['manifest', value => { value.signals[0].quality = 'estimated'; }, /hold-last descriptors/],
    ['manifest', value => { value.signals[0].sources[0].tag++; }, /hold-last descriptors/],
    ['manifest', value => { delete value.signals[0].states.held; }, /hold-last descriptors/],
    ['sourceMap', value => { value.traceMetadata.bindings = value.traceMetadata.bindings.filter(binding => binding.generated?.role !== 'held'); }, /binding/],
    ['sourceMap', value => { value.traceMetadata.dependencies.find(entry => entry.target.name.startsWith('__gf_hold_last_')).reads = []; }, /dependencies/],
  ]) {
    const candidate = structuredClone(signed), artifact = candidate.payload[artifactName];
    const decoded = JSON.parse(Buffer.from(artifact.contentBase64, 'base64').toString('utf8'));
    mutate(decoded);
    const bytes = Buffer.from(canonicalJson(decoded));
    artifact.contentBase64 = bytes.toString('base64'); artifact.sha256 = sha256Hex(bytes);
    const payload = Buffer.from(canonicalJson(candidate.payload));
    candidate.payloadSha256 = sha256Hex(payload);
    candidate.signatures = [{ algorithm: 'Ed25519', keyId,
      signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', keys.privateKey, payload)).toString('base64') }];
    await assert.rejects(() => verifyPortablePackage(candidate, options), error => {
      assert.equal(error.code, 'source-map-mismatch');
      assert.match(error.cause?.message ?? '', diagnostic);
      return true;
    });
    assert.equal(loads, 1, 'forged metadata must reject before target bytecode loading');
  }
});
