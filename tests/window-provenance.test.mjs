import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource, restoreArtifactSourceMap } from '../tools/toolchain.mjs';
import { observeSourceTrace } from '../tools/source-trace.mjs';
import { buildPortablePackage, verifyPortablePackage } from '../tools/portable-package.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { sha256Hex } from '../tools/sha256.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const nativePath = path.join(root, 'target/release/examples/run');
const filename = 'window-provenance.ghost.md';
const source = `# Selected window

\`\`\`ghost
control WindowProvenance {
  input choose_a: Bool;
  sensor a: Temperature;
  sensor b: Temperature;
  signal average_temperature = window_average(if choose_a then a else b,
    over: 2s, quality: measured, max_age: 1s);
  output average: Temperature;
  average <- average_temperature |> recover(0K);
}
\`\`\`
`;

const envelope = compiled => ({
  format: 'GhostFlow/source-map-v1', bytecodeSha256: compiled.manifest.bytecodeSha256,
  sourceDocument: compiled.sourceDocument, nodes: compiled.sourceMap,
  lines: compiled.extractionMap, traceMetadata: compiled.traceMetadata,
});

test('window source trace binds the authored site and every static execution dependency', async () => {
  const compiled = await compileSource(source, { filename });
  const descriptor = compiled.manifest.signals[0];
  const node = compiled.sourceMap.find(entry => entry.kind === 'signal');
  assert.deepEqual(compiled.traceMetadata.windowSites, [{
    site: descriptor.site, slot: 0, nodeId: node.id, name: 'average_temperature', operation: 'average',
    payloadType: 'Temperature', errorType: 'SensorFault', quality: 'measured', overMs: 2000, maxAgeMs: 1000,
    clockInput: '__gf_now_ms', timeEpochInput: '__gf_time_epoch', sources: descriptor.sources,
    origins: descriptor.sources.map(root => ({ tag: root.tag, nodeId: root.tag, kind: 'sensor', name: root.name })),
    source: compiled.traceMetadata.windowSites[0].source,
    extractedSource: compiled.traceMetadata.windowSites[0].extractedSource,
  }]);
  const dependency = compiled.traceMetadata.dependencies.find(entry => entry.target.field === 'windowTrace');
  assert.deepEqual(dependency.target, { field: 'windowTrace', name: 'average_temperature' });
  assert.deepEqual(dependency.reads, [
    { field: 'inputs', name: 'choose_a' },
    { field: 'inputs', name: '__gf_sensor_ok_a' }, { field: 'inputs', name: '__gf_sensor_ok_b' },
    { field: 'inputs', name: '__gf_sensor_value_a' }, { field: 'inputs', name: '__gf_sensor_value_b' },
    { field: 'inputs', name: '__gf_sensor_fault_a' }, { field: 'inputs', name: '__gf_sensor_fault_b' },
    ...descriptor.sources.flatMap(root => ['present', 'epoch', 'id', 'timestamp'].map(part => ({
      field: 'inputs', name: `__gf_sensor_sample_${part}_${root.name}`,
    }))),
    { field: 'inputs', name: '__gf_now_ms' }, { field: 'inputs', name: '__gf_time_epoch' },
  ]);
});

test('canonical restore rejects removed, rebound, or incomplete window provenance', async () => {
  const compiled = await compileSource(source, { filename });
  const mutations = [
    value => { delete value.traceMetadata.windowSites; },
    value => { value.traceMetadata.windowSites[0].site++; },
    value => { value.traceMetadata.windowSites[0].sources[0].tag++; },
    value => { value.traceMetadata.dependencies.find(entry => entry.target.field === 'windowTrace').target.name = 'forged'; },
    value => { value.traceMetadata.dependencies.find(entry => entry.target.field === 'windowTrace').reads.pop(); },
    value => { value.traceMetadata.dependencies.find(entry => entry.target.field === 'requested').reads = []; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(envelope(compiled)); mutate(candidate);
    assert.throws(() => restoreArtifactSourceMap(candidate, compiled.bytes), /window|source trace|dependencies/);
  }
});

test('signed canonical replay rejects re-signed window source-map substitutions before loading', async () => {
  const compiled = await compileSource(source, { filename });
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const keyId = 'window-provenance-key';
  const identity = {
    compilerRevision: 'window-provenance-test', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/framed-scan-abi-v1', bindingRevision: 'window-provenance-v1',
    requiredCapabilities: [
      { kind: 'input', name: 'choose_a', type: 'bool' },
      { kind: 'sensor', name: 'a', type: 'number' }, { kind: 'sensor', name: 'b', type: 'number' },
      { kind: 'actuator', name: 'average', type: 'number' },
    ],
  };
  const signed = await buildPortablePackage(compiled, identity, {
    signers: [{ keyId, privateKey: keys.privateKey }], verifyCompilation: compileSource,
  });
  let loads = 0;
  const options = {
    trustedKeys: [{ keyId, publicKey: keys.publicKey }], revokedKeyIds: [], expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics], supportedRuntimeAbis: [identity.runtimeAbi],
    supportedManifestFormats: [compiled.manifest.format], availableCapabilities: identity.requiredCapabilities,
    expectedBindingRevision: identity.bindingRevision, verifyBytecode: async () => { loads++; return true; },
  };
  await verifyPortablePackage(signed, options); assert.equal(loads, 1);
  for (const mutate of [
    value => { value.traceMetadata.windowSites[0].slot = 1; },
    value => { value.traceMetadata.dependencies.find(entry => entry.target.field === 'requested').reads = []; },
  ]) {
    const candidate = structuredClone(signed);
    const record = candidate.payload.sourceMap;
    const sourceMap = JSON.parse(Buffer.from(record.contentBase64, 'base64').toString('utf8'));
    mutate(sourceMap);
    const bytes = Buffer.from(canonicalJson(sourceMap)); record.contentBase64 = bytes.toString('base64'); record.sha256 = sha256Hex(bytes);
    const payload = Buffer.from(canonicalJson(candidate.payload)); candidate.payloadSha256 = sha256Hex(payload);
    candidate.signatures = [{ algorithm: 'Ed25519', keyId,
      signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', keys.privateKey, payload)).toString('base64') }];
    await assert.rejects(() => verifyPortablePackage(candidate, options), error => error.code === 'source-map-mismatch' && /window/.test(error.cause?.message));
    assert.equal(loads, 1);
  }
});

test('source observation projects owned Rust window evidence without physical-quality spoofing', async t => {
  const compiled = await compileSource(source, { filename });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-window-provenance-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'window.gfb');
  const csvPath = path.join(temporary, 'window.csv');
  fs.writeFileSync(modulePath, compiled.bytes);
  const [a, b] = compiled.manifest.sensors;
  const header = ['choose_a', a.valueInput, a.okInput, a.faultInput, b.valueInput, b.okInput, b.faultInput,
    '__gf_now_ms', '__gf_time_epoch', a.samplePresentInput, a.sampleEpochInput, a.sampleIdInput, a.sampleTimestampInput,
    b.samplePresentInput, b.sampleEpochInput, b.sampleIdInput, b.sampleTimestampInput];
  fs.writeFileSync(csvPath, `${header.join(',')}\ntrue,280,true,0,300,true,0,1000,5,true,1,7,1000,false,0,0,0\n`);
  const roots = compiled.manifest.signals[0].sources;
  const profile = roots.map(root => `${root.tag}:3:1000`).join(',');
  const result = spawnSync(nativePath, [modulePath, csvPath, '--outcomes', '--temporal', '5', '12', '33554432', profile], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const outcome = JSON.parse(result.stdout.trim());
  assert.equal(outcome.status, 'OK', outcome.error);
  const trace = outcome.trace;
  assert.equal(trace.module, compiled.traceMetadata.moduleFingerprint);
  const observed = observeSourceTrace(compiled.traceMetadata, trace);
  assert.equal(observed.windowEvents.length, 1);
  const event = observed.windowEvents[0];
  assert.equal(event.quality, 'Derived');
  assert.equal(event.value, 280);
  assert.deepEqual(event.fault, null);
  assert.equal(event.contributors[0].source.name, 'a');
  assert.equal(event.contributors[0].id, 7);
  assert.equal(event.upstreamFault, null);

  const unavailable = structuredClone(trace);
  unavailable.windowTrace[0] = { ...unavailable.windowTrace[0], value: null, quality: 0, count: 1 };
  const missing = observeSourceTrace(compiled.traceMetadata, unavailable).windowEvents[0];
  assert.equal(missing.quality, null);
  assert.deepEqual(missing.fault, { code: 3, fault: 'NotReady', origin: compiled.manifest.signals[0].site,
    originDescriptor: { kind: 'signal', name: 'average_temperature', nodeId: compiled.manifest.signals[0].site } });
  const forged = structuredClone(trace); forged.windowTrace[0].site++;
  assert.throws(() => observeSourceTrace(compiled.traceMetadata, forged), /window trace/);
  const future = structuredClone(trace); future.windowTrace[0].contributors[0].timestampMs = 1001;
  future.windowTrace[0].first.timestampMs = 1001; future.windowTrace[0].last.timestampMs = 1001;
  assert.throws(() => observeSourceTrace(compiled.traceMetadata, future), /window trace contributor/);
  const outside = structuredClone(trace); outside.windowTrace[0].contributors[0].timestampMs = 0;
  outside.windowTrace[0].first.timestampMs = 0; outside.windowTrace[0].last.timestampMs = 0;
  assert.throws(() => observeSourceTrace(compiled.traceMetadata, outside), /available evidence is missing or stale/);
  const empty = structuredClone(trace); Object.assign(empty.windowTrace[0], { count: 0, first: null, last: null, contributors: [] });
  assert.throws(() => observeSourceTrace(compiled.traceMetadata, empty), /available evidence is missing or stale/);
  const duplicate = structuredClone(trace); duplicate.windowTrace[0].contributors.push(structuredClone(duplicate.windowTrace[0].contributors[0]));
  duplicate.windowTrace[0].count = 2;
  assert.throws(() => observeSourceTrace(compiled.traceMetadata, duplicate), /window trace contributor/);
  const unordered = structuredClone(trace);
  const later = structuredClone(unordered.windowTrace[0].contributors[0]); later.id = 8; later.timestampMs = 900;
  unordered.windowTrace[0].contributors.push(later); unordered.windowTrace[0].last = structuredClone(later); unordered.windowTrace[0].count = 2;
  assert.throws(() => observeSourceTrace(compiled.traceMetadata, unordered), /window trace contributor order/);
});

test('an available rate requires two contributors with distinct observation times', async () => {
  const rateSource = source
    .replace('window_average(if choose_a then a else b,', 'window_rate(if choose_a then a else b,')
    .replace('output average: Temperature;', 'output fast: Bool;')
    .replace('average <- average_temperature |> recover(0K);',
      'fast <- average_temperature |> map(below(rate(delta: 1ΔK, time: 1s))) |> recover(false);');
  const compiled = await compileSource(rateSource, { filename: 'window-rate-provenance.ghost.md' });
  const site = compiled.traceMetadata.windowSites[0];
  const point = { sourceTag: site.sources[0].tag, epoch: 1, id: 1, timestampMs: 1000, value: 280 };
  const trace = {
    module: compiled.traceMetadata.moduleFingerprint,
    safetyTrace: { format: 'GhostFlow/safety-trace-v1', constraints: [] }, resultTrace: [], stateAfter: {},
    windowTrace: [{ site: site.site, payloadType: 'number', operation: 'rate', value: 1, quality: 3,
      count: 1, admissionRevision: 1, timeEpoch: 5, nowMs: 1000, first: point, last: point, contributors: [point], upstreamFault: null }],
  };
  assert.throws(() => observeSourceTrace(compiled.traceMetadata, trace), /two time-distinct contributors/);
  trace.windowTrace[0].value = null; trace.windowTrace[0].quality = 0;
  assert.equal(observeSourceTrace(compiled.traceMetadata, trace).windowEvents[0].quality, null,
    'unavailable one-point evidence remains observable');
});

test('window observation enforces the exact Int machine domain', async () => {
  const intSource = `# Int window\n\n\`\`\`ghost
fn as_int(value: Number) -> Int { int_trunc(value) }
control IntWindow {
  sensor reading: Number;
  signal minimum = window_min(reading |> map(as_int), over: 1s, quality: measured, max_age: 1s);
  output value: Int;
  value <- minimum |> recover(0);
}
\`\`\`\n`;
  const compiled = await compileSource(intSource, { filename: 'window-int-provenance.ghost.md' });
  const site = compiled.traceMetadata.windowSites[0];
  const point = { sourceTag: site.sources[0].tag, epoch: 1, id: 1, timestampMs: 1, value: 2147483648 };
  const trace = {
    module: compiled.traceMetadata.moduleFingerprint,
    safetyTrace: { format: 'GhostFlow/safety-trace-v1', constraints: [] }, resultTrace: [], stateAfter: {},
    windowTrace: [{ site: site.site, payloadType: 'int', operation: 'min', value: 2147483648, quality: 3,
      count: 1, admissionRevision: 1, timeEpoch: 5, nowMs: 1, first: point, last: point, contributors: [point], upstreamFault: null }],
  };
  assert.throws(() => observeSourceTrace(compiled.traceMetadata, trace), /window trace contributor/);
});
