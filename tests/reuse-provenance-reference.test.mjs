import { softwareQualityObservations } from './helpers/software-quality-observations.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { observeSourceTrace } from '../tools/source-trace.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { prepareWhatIfReplay } from '../runtimes/wasm/what-if-replay.mjs';
import { buildPortablePackage, verifyPortablePackage } from '../tools/portable-package.mjs';

const doc = code => `# Reusable behavior provenance\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const leaf = doc(`control Latch {
 input start, stop: Bool;
 state held: Bool = false;
 state count: Bool = false;
 held' = !(stop |> recover(false)) && ((start |> recover(false)) || held);
 count' = (start |> recover(false)) || count;
 output active: Bool;
 output accepted: Bool;
 active <- held';
 accepted <- count';
}`);
const pin = (alias, filename, revision, text) => `import ${alias} from "./${filename}" revision "${revision}" sha256 "${sha256Hex(text)}";`;
const behavior = doc(`${pin('Latch', 'latch.ghost.md', 'latch-input-v1', leaf)}
control Behavior {
 input start, stop: Bool;
 output active: Bool;
 output accepted: Bool;
 instance latch: Latch;
 connect latch.start <- start;
 connect latch.stop <- stop;
 connect active <- latch.active;
 connect accepted <- latch.accepted;
}`);
const source = doc(`${pin('Behavior', 'behavior.ghost.md', 'behavior-input-v1', behavior)}
control Farm {
 input east_start, east_stop, west_start, west_stop: Bool;
 output east_pump, west_pump: Bool;
 output east_count, west_count: Bool;
 instance east: Behavior;
 instance west: Behavior;
 connect east.start <- east_start;
 connect east.stop <- east_stop;
 connect west.start <- west_start;
 connect west.stop <- west_stop;
 connect east_pump <- east.active;
 connect west_pump <- west.active;
 connect east_count <- east.accepted;
 connect west_count <- west.accepted;
}`);
const closure = [
 { filename: 'behavior.ghost.md', revision: 'behavior-input-v1', text: behavior },
 { filename: 'latch.ghost.md', revision: 'latch-input-v1', text: leaf },
];
const wasmBytes = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const native = fileURLToPath(new URL(`../target/release/examples/scan_tape${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
const inputs = (east_start, east_stop, west_start, west_stop) => ({ east_start, east_stop, west_start, west_stop });
const records = [
 { nowMs: 1000, inputs: inputs(true, false, false, false) },
 { nowMs: 2000, inputs: inputs(false, false, true, false) },
 { nowMs: 3000, inputs: inputs(false, true, false, false) },
 { nowMs: 4000, inputs: inputs(false, false, false, true) },
].map((frame, index) => ({ nowMs: frame.nowMs, samples: Object.fromEntries(Object.entries(frame.inputs).map(([name, value]) => [name, { epoch: 1, id: index + 1, timestampMs: frame.nowMs, quality: 'Good', value }])) }));
const identity = { timelineId: 'recorded.farm', instanceId: 'farm.logical', runId: 'run.recorded', sourceRevision: 'farm-input-v1', bindingRevision: 'virtual-logical-ports-r1' };
const compiled = () => compileSource(source, { filename: 'farm.ghost.md', sourceClosure: closure });

function nativeOutcomes(artifact, frames) {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-ref-06-025-'));
 try {
  const modulePath = path.join(dir, 'program.gfb'), tape = path.join(dir, 'frames.tsv');
  fs.writeFileSync(modulePath, artifact.bytes);
  fs.writeFileSync(tape, frames.map(frame => [frame.scanId, frame.logicalTimeMs,
   ...frame.inputs.flatMap(input => [input.name, input.type === 'Bool' ? 'b' : 'n', input.value])].join('\t')).join('\n') + '\n');
  const run = spawnSync(native, [modulePath, tape], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.error?.message ?? run.stderr);
  const rows = run.stdout.trim().split('\n').map(JSON.parse);
  assert.ok(rows.every(row => row.accepted));
  return rows.map(row => row.outcome);
 } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function execution(artifact, tape) {
 const runtime = softwareQualityObservations(await ControlRuntime.instantiateFramed(wasmBytes, artifact));
 const frames = [], outcomes = [];
 const dispatch = runtime.runtime.dispatch.bind(runtime.runtime);
 runtime.runtime.dispatch = frame => { frames.push(structuredClone(frame)); dispatch(frame); outcomes.push(structuredClone(runtime.runtime.outcome)); };
 try {
  const results = tape.map(record => structuredClone(runtime.step(record)));
  assert.deepEqual(nativeOutcomes(artifact, frames), outcomes, 'complete native admission outcomes equal framed WASM outcomes');
  assert.deepEqual(nativeOutcomes(artifact, frames), outcomes, 'fresh native replay preserves every outcome field');
  return { results, outcomes };
 } finally { runtime.dispose(); }
}

test('REF-06-025 exact transitive definition closure preserves separate instance state and logical-port provenance in native and WASM', async () => {
 const artifact = await compiled();
 for (const document of closure) {
  const actual = artifact.sourceClosure.documents.find(item => item.filename === document.filename);
  assert.ok(actual, document.filename);
  assert.equal(actual.sha256, sha256Hex(document.text));
  assert.equal(actual.revision, document.revision);
  assert.equal(actual.text, document.text);
 }
 assert.ok(artifact.sourceClosure.instances.some(item => item.instance === 'east.latch'));
 assert.ok(artifact.sourceClosure.instances.some(item => item.instance === 'west.latch'));
 assert.deepEqual(artifact.manifest.outputs.map(item => [item.name, item.type]), [
  ['east_pump', 'Bool'], ['west_pump', 'Bool'], ['east_count', 'Bool'], ['west_count', 'Bool'],
 ]);
 const { outcomes } = await execution(artifact, records);
 assert.deepEqual(outcomes.map(item => item.trace.requested), [
  { east_pump: true, west_pump: false, east_count: true, west_count: false },
  { east_pump: true, west_pump: true, east_count: true, west_count: true },
  { east_pump: false, west_pump: true, east_count: true, west_count: true },
  { east_pump: false, west_pump: false, east_count: true, west_count: true },
 ]);
 for (const outcome of outcomes) {
  assert.deepEqual(outcome.trace.safe, outcome.trace.requested);
  const observed = observeSourceTrace(artifact.traceMetadata, outcome.trace);
  for (const instance of ['east.latch', 'west.latch']) {
   const bindings = artifact.traceMetadata.bindings.filter(binding => binding.kind === 'state' && artifact.sourceMap.find(node => node.id === binding.nodeId)?.instance === instance);
   assert.equal(bindings.length, 2);
   for (const binding of bindings) {
    const entry = observed.bindings.find(item => item.nodeId === binding.nodeId);
    assert.ok(entry.observations.some(item => item.field === 'stateBefore'));
    assert.ok(entry.observations.some(item => item.field === 'stateAfter'));
   }
  }
 }
});

test('REF-06-025 effect-free what-if replay retains closure and branch identity without changing live reused instances', async () => {
 const artifact = await compiled();
 const prefix = records.slice(0, 1), future = records.slice(1);
 const baseline = await execution(artifact, records);
 const replay = await prepareWhatIfReplay({ wasmBytes, compilation: artifact, identity, prefix, future });
 assert.equal(replay.checkpoint.sourceClosureSha256, sha256Hex(canonicalJson(artifact.sourceClosure)));
 const live = softwareQualityObservations(await ControlRuntime.instantiateFramed(wasmBytes, artifact));
 try {
  assert.deepEqual(live.step(prefix[0]), baseline.results[0]);
  const before = structuredClone(live.lastFrameOutcome);
  const request = { branchId: 'branch.east-stop', runId: 'run.ghost', synthetic: [
   { offset: 0, kind: 'samples', name: 'east_stop', value: { ...future[0].samples.east_stop, value: true }, provenance: 'synthetic' },
  ] };
  const receipt = await replay.branch(request);
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.physicalEffects, false);
  assert.deepEqual(receipt.origin, identity);
  assert.equal(receipt.branchId, request.branchId);
  assert.equal(receipt.runId, request.runId);
  assert.deepEqual(receipt.frames.map(frame => frame.original), baseline.results.slice(1));
  const candidateRecords = structuredClone(records); candidateRecords[1].samples.east_stop.value = true;
  const candidate = await execution(artifact, candidateRecords);
  assert.deepEqual(receipt.frames.map(frame => frame.candidate), candidate.results.slice(1));
  assert.equal(receipt.frames[0].original.vm.safe.east_pump, true);
  assert.equal(receipt.frames[0].candidate.vm.safe.east_pump, false);
  assert.equal(receipt.frames[0].candidate.vm.safe.west_pump, true);
  assert.deepEqual(live.lastFrameOutcome, before);
  assert.deepEqual(future.map(record => structuredClone(live.step(record))), baseline.results.slice(1));
  assert.deepEqual(await replay.branch(request), receipt, 'repeated branch starts from the same source-bound prefix');
  assert.ok(receipt.provenance.some(item => item.name === 'east_stop' && item.provenance === 'synthetic'));
 } finally { live.dispose(); }
});

test('REF-06-025 changed transitive documents and incomplete provenance reject before replay execution', async () => {
 await assert.rejects(() => compileSource(source, { filename: 'farm.ghost.md', sourceClosure: [closure[0], { ...closure[1], text: leaf.replace('false;', 'true;') }] }), /digest|sha256|hash/);
 await assert.rejects(() => compileSource(source, { filename: 'farm.ghost.md', sourceClosure: [closure[0]] }), /missing|supplied|closure|resolve/i);
 const artifact = await compiled();
 const tampered = structuredClone(artifact); tampered.sourceClosure.documents.find(item => item.filename === 'latch.ghost.md').text += '\n';
 await assert.rejects(() => prepareWhatIfReplay({ wasmBytes, compilation: tampered, identity, prefix: records.slice(0, 1), future: records.slice(1) }), /source|closure|identity|hash|digest/i);
});

test('REF-06-025 signed reusable package retains exact closure and logical capability bindings before effect-free execution', async () => {
 const artifact = await compiled();
 // Ephemeral test key: no credentials, installation identity or hardware binding.
 const key = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
 const packageIdentity = {
  compilerRevision: '8ed7960ec529576f0aa91a43e2ef9c076c37c27d',
  runtimeSemantics: 'GhostFlow/runtime-semantics-v1', runtimeAbi: 'GhostFlow/framed-scan-abi-v1',
  bindingRevision: identity.bindingRevision,
  requiredCapabilities: [...artifact.manifest.sensors.map(port => ({ kind: 'sensor', name: port.name, type: 'bool' })),
   ...artifact.manifest.outputs.map(port => ({ kind: 'actuator', name: port.name, type: 'bool' }))],
 };
 const packaged = await buildPortablePackage(artifact, packageIdentity, {
  signers: [{ keyId: 'ephemeral-reference-test', privateKey: key.privateKey }],
  verifyCompilation: (text, { filename }) => compileSource(text, { filename, sourceClosure: closure }),
 });
 let bytecodeChecks = 0;
 const options = {
  trustedKeys: [{ keyId: 'ephemeral-reference-test', publicKey: key.publicKey }], revokedKeyIds: [],
  expectedCompilerRevision: packageIdentity.compilerRevision,
  supportedRuntimeSemantics: [packageIdentity.runtimeSemantics], supportedRuntimeAbis: [packageIdentity.runtimeAbi],
  supportedManifestFormats: [artifact.manifest.format], availableCapabilities: packageIdentity.requiredCapabilities,
  expectedBindingRevision: identity.bindingRevision,
  verifyBytecode: bytes => { bytecodeChecks++; assert.deepEqual(bytes, new Uint8Array(artifact.bytes)); return true; },
 };
 const verified = await verifyPortablePackage(packaged, options);
 assert.equal(bytecodeChecks, 1);
 assert.deepEqual(verified.sourceMap.sourceClosure, artifact.sourceClosure);
 assert.deepEqual(verified.manifest, artifact.manifest);
 assert.equal(verified.identity.bindingRevision, identity.bindingRevision);
 await assert.rejects(() => verifyPortablePackage(packaged, { ...options, expectedBindingRevision: 'different-logical-binding' }), /binding revision/i);
 assert.equal(bytecodeChecks, 1, 'binding mismatch rejects before bytecode validation or activation');
 const tampered = structuredClone(packaged); tampered.payload.sourceMap.contentBase64 = Buffer.from('{}').toString('base64');
 await assert.rejects(() => verifyPortablePackage(tampered, options), /digest|sha256/i);
 assert.equal(bytecodeChecks, 1);
 const resigned = structuredClone(packaged);
 const map = JSON.parse(Buffer.from(resigned.payload.sourceMap.contentBase64, 'base64'));
 map.sourceClosure.instances[0].instance = 'forged-instance';
 const mapText = canonicalJson(map);
 resigned.payload.sourceMap.contentBase64 = Buffer.from(mapText).toString('base64');
 resigned.payload.sourceMap.sha256 = sha256Hex(mapText);
 const payloadText = canonicalJson(resigned.payload);
 resigned.payloadSha256 = sha256Hex(payloadText);
 resigned.signatures[0].signatureBase64 = Buffer.from(await crypto.subtle.sign('Ed25519', key.privateKey, new TextEncoder().encode(payloadText))).toString('base64');
 await assert.rejects(() => verifyPortablePackage(resigned, options), /source closure/i);
 assert.equal(bytecodeChecks, 1, 'a valid signature cannot authorize forged instance provenance');
 const restored = { bytes: verified.bytecode.copy(), manifest: verified.manifest,
  sourceDocument: verified.sourceMap.sourceDocument, sourceClosure: verified.sourceMap.sourceClosure,
  sourceMap: verified.sourceMap.nodes, extractionMap: verified.sourceMap.lines,
  traceMetadata: verified.sourceMap.traceMetadata };
 const replay = await prepareWhatIfReplay({ wasmBytes, compilation: restored, identity, prefix: records.slice(0, 1), future: records.slice(1) });
 const receipt = await replay.branch({ branchId: 'branch.verified-package', runId: 'run.verified-ghost' });
 assert.equal(receipt.physicalEffects, false);
 assert.equal(receipt.checkpoint.sourceClosureSha256, sha256Hex(canonicalJson(artifact.sourceClosure)));
 assert.deepEqual(receipt.frames.map(frame => frame.candidate), (await execution(artifact, records)).results.slice(1));
});
