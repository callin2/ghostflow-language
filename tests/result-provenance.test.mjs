import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource, restoreArtifactSourceMap } from '../tools/toolchain.mjs';
import { buildPortablePackage, verifyPortablePackage } from '../tools/portable-package.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { observeSourceTrace } from '../tools/source-trace.mjs';

const source = [
  '# Result source provenance', '', 'Original prose before the first fence.', '', '```ghost',
  'fn unavailable() -> Result<Number, SensorFault> { fault(Stale) }',
  'fn clock() -> Result<Bool, ClockFault> { fault(ClockUnknown) }',
  'fn calendar() -> Result<Bool, CalendarFault> { fault(CalendarMissing) }',
  'fn temporal() -> Result<Bool, TemporalContextFault> { fault(PredictionStale) }',
  '```', '', 'Original explanation between code fences.', '', '```ghost',
  'control Provenance {', '  input choose: Bool;', '  sensor reading: Number;',
  '  output value: Number;', '  output clockReady, calendarReady, temporalReady: Bool;',
  '  value <- (if choose then reading else unavailable()) |> recover(0.0);',
  '  clockReady <- clock() |> recover(false);',
  '  calendarReady <- case calendar() { ok(v) => v; fault(_) => false; };',
  '  temporalReady <- temporal() |> recover(false);',
  '}', '```', '',
].join('\r\n');
const filename = 'result-provenance.ghost.md';
const clone = value => JSON.parse(JSON.stringify(value));
function envelope(compilation) {
  return { format: 'GhostFlow/source-map-v1', bytecodeSha256: compilation.manifest.bytecodeSha256,
    sourceDocument: compilation.sourceDocument, nodes: compilation.sourceMap, lines: compilation.extractionMap,
    traceMetadata: compilation.traceMetadata };
}
const mutations = [
  ['removed site', map => map.traceMetadata.resultSites.pop()],
  ['removed origin', map => map.traceMetadata.resultSites.find(site => site.origins.length > 1).origins.pop()],
  ['forged range', map => map.traceMetadata.resultSites[0].source.line++],
  ['forged extracted range', map => map.traceMetadata.resultSites[0].extractedSource.column++],
  ['forged node', map => map.traceMetadata.resultSites[0].nodeId++],
  ['forged origin', map => map.traceMetadata.resultSites[0].origins[0].nodeId++],
  ['wrong error enum', map => map.traceMetadata.resultSites[0].errorType = 'ClockFault'],
  ['unknown error enum', map => map.traceMetadata.resultSites[0].errorType = 'UserFault'],
  ['non-string error enum', map => map.traceMetadata.resultSites[0].errorType = ['SensorFault']],
  ['removed error enum', map => delete map.traceMetadata.resultSites[0].errorType],
  ['removed site table', map => delete map.traceMetadata.resultSites],
  ['empty site table', map => map.traceMetadata.resultSites = []],
  ['null metadata', map => map.traceMetadata = null],
  ['removed metadata and nodes', map => { delete map.traceMetadata; map.nodes = []; }],
  ['null metadata and nodes', map => { map.traceMetadata = null; map.nodes = []; }],
  ['wrong bytecode digest', map => map.traceMetadata.bytecodeSha256 = '0'.repeat(64)],
];

test('GF-TEST-result-provenance-observe: decoded committed events preserve order and reject forged domains', async () => {
  const compilation = await compileSource(source, { filename });
  const verified = restoreArtifactSourceMap(envelope(compilation), compilation.bytes, { manifest: compilation.manifest });
  const runtime = await ControlRuntime.instantiate(fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url)), compilation);
  try {
    const trace = runtime.step({ nowMs: 0, inputs: { choose: false } }).vm;
    const observed = observeSourceTrace(verified.traceMetadata, trace);
    assert.deepEqual(observed.resultEvents.map(event => event.fault), ['Stale', 'ClockUnknown', 'CalendarMissing', 'PredictionStale']);
    for (const [index, event] of observed.resultEvents.entries()) {
      const site = verified.traceMetadata.resultSites[index];
      assert.deepEqual(event, { ...trace.resultTrace[index], kind: site.kind, source: site.source,
        errorType: site.errorType, fault: observed.resultEvents[index].fault,
        originDescriptor: site.origins.find(origin => origin.tag === event.origin) });
    }
    const repeated = clone(trace); repeated.resultTrace.push(clone(repeated.resultTrace[0]));
    const repeats = observeSourceTrace(verified.traceMetadata, repeated).resultEvents;
    assert.deepEqual(repeats.at(-1), repeats[0]);
    const absent = clone(trace); absent.resultTrace = [];
    assert.deepEqual(observeSourceTrace(verified.traceMetadata, absent).resultEvents, []);
    const good = runtime.step({ nowMs: 1, inputs: { choose: true }, samples: { reading: { epoch: 1, id: 1, timestampMs: 1, quality: 'Good', value: 0 } } }).vm;
    const success = observeSourceTrace(verified.traceMetadata, good).resultEvents[0];
    assert.equal(success.choice, 0); assert.equal(success.origin, 0);
    assert.equal(success.fault, null); assert.equal(success.originDescriptor, null);
    for (const mutate of [
      value => delete value.resultTrace, value => value.resultTrace = {},
      value => value.resultTrace[0].site = 4294967295,
      value => value.resultTrace[0].choice = -1, value => value.resultTrace[0].choice = 0.5,
      value => value.resultTrace[1].choice = 3,
      value => value.resultTrace[0].origin = 0,
      value => value.resultTrace[0].origin = 4294967295,
      value => value.resultTrace[0].origin = 1.5,
      value => value.resultTrace[0].choice = 0,
      value => value.resultTrace[0].extra = true,
    ]) {
      const altered = clone(trace); mutate(altered);
      assert.throws(() => observeSourceTrace(verified.traceMetadata, altered), /result trace/);
    }
  } finally { runtime.dispose(); }
});

test('GF-TEST-result-provenance-restore: CRLF and multiple fences preserve canonical sites, ranges and fault enum identities', async () => {
  const compilation = await compileSource(source, { filename });
  const map = envelope(compilation);
  const restored = restoreArtifactSourceMap(map, compilation.bytes, { manifest: compilation.manifest });
  assert.equal(restored.sourceDocument.text, source);
  assert.deepEqual(restored.traceMetadata.resultSites.map(site => site.errorType), ['SensorFault', 'ClockFault', 'CalendarFault', 'TemporalContextFault']);
  for (const site of restored.traceMetadata.resultSites) {
    const node = map.nodes.find(node => node.id === site.nodeId);
    assert.equal(site.source.filename, filename);
    assert.equal(site.source.line, node.line);
    assert.equal(site.source.endLine, node.endLine);
    assert.equal(site.extractedSource.line, node.extracted.line);
    assert.notEqual(site.source.line, site.extractedSource.line);
    assert.match(source.split('\r\n')[site.source.line - 1], site.kind === 'recover' ? /recover\(/ : /case calendar/);
  }
  assert.equal(map.traceMetadata.resultSites[0].origins.length, 2);
  // Canonical package JSON sorts object keys; field insertion order is irrelevant.
  assert.doesNotThrow(() => restoreArtifactSourceMap(JSON.parse(canonicalJson(map)), compilation.bytes, { manifest: compilation.manifest }));
});

test('GF-TEST-result-provenance-tamper: canonical replay rejects removed or forged Result source evidence', async () => {
  const compilation = await compileSource(source, { filename });
  const original = envelope(compilation);
  assert.doesNotThrow(() => restoreArtifactSourceMap(original, compilation.bytes, { manifest: compilation.manifest }));
  for (const [name, mutate] of mutations) {
    const altered = clone(original); mutate(altered);
    assert.throws(() => restoreArtifactSourceMap(altered, compilation.bytes, { manifest: compilation.manifest }), undefined, name);
  }
});

test('GF-TEST-result-provenance-package: signed valid evidence loads; re-signed forged evidence rejects before WASM loader', async () => {
  const compilation = await compileSource(source, { filename });
  const keys = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  const keyId = 'result-provenance-test';
  const identity = { compilerRevision: 'c0bef0e', runtimeSemantics: 'GhostFlow/runtime-semantics-v1', runtimeAbi: 'GhostFlow/framed-scan-abi-v1', bindingRevision: 'result-provenance-v1', requiredCapabilities: [
    { kind: 'input', name: 'choose', type: 'bool' }, { kind: 'sensor', name: 'reading', type: 'number' },
    { kind: 'actuator', name: 'value', type: 'number' }, { kind: 'actuator', name: 'clockReady', type: 'bool' }, { kind: 'actuator', name: 'calendarReady', type: 'bool' },
    { kind: 'actuator', name: 'temporalReady', type: 'bool' },
  ] };
  const packageValue = await buildPortablePackage(compilation, identity, { signers: [{ keyId, privateKey: keys.privateKey }], verifyCompilation: (text, options) => compileSource(text, options) });
  let loads = 0;
  const options = { trustedKeys: [{ keyId, publicKey: keys.publicKey }], revokedKeyIds: [], expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics], supportedRuntimeAbis: [identity.runtimeAbi], supportedManifestFormats: [compilation.manifest.format], availableCapabilities: identity.requiredCapabilities,
    expectedBindingRevision: identity.bindingRevision, verifyBytecode: async bytes => {
      loads++; const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url)));
      try { runtime.load(bytes); return true; } finally { runtime.dispose(); }
    } };
  await verifyPortablePackage(packageValue, options); assert.equal(loads, 1);
  for (const [name, mutate] of mutations) {
    const candidate = clone(packageValue);
    const map = JSON.parse(Buffer.from(candidate.payload.sourceMap.contentBase64, 'base64').toString('utf8'));
    mutate(map);
    const bytes = Buffer.from(canonicalJson(map));
    candidate.payload.sourceMap.contentBase64 = bytes.toString('base64'); candidate.payload.sourceMap.sha256 = sha256Hex(bytes);
    const payload = Buffer.from(canonicalJson(candidate.payload)); candidate.payloadSha256 = sha256Hex(payload);
    candidate.signatures = [{ algorithm: 'Ed25519', keyId, signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', keys.privateKey, payload)).toString('base64') }];
    await assert.rejects(() => verifyPortablePackage(candidate, options), undefined, name);
    assert.equal(loads, 1, `${name} must reject before loader`);
  }
});
