import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/compile-source.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeArtifact, restoreArtifactSourceMap } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

const doc = code => `# Original intent\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const relay = doc('control Relay { input start: Bool; output pump: Bool; pump <- start; }');
const pin = (text = relay) => `import Relay from "./relay.ghost.md" revision "r1" sha256 "${sha256Hex(text)}";`;
const root = body => doc(`${pin()} control Farm { input start: Bool; output pump: Bool; ${body} }`);
const closure = [{ filename: 'relay.ghost.md', revision: 'r1', text: relay }];

test('public compiler executes pinned Relay connections with exact source closure', async () => {
  const source = root('instance east: Relay; connect east.start <- start; connect pump <- east.pump;');
  const actual = await compileSource(source, { filename: 'farm.ghost.md', sourceClosure: closure });
  const expected = await compileSource(doc('control Farm { input start: Bool; output pump: Bool; pump <- start; }'), { filename: 'farm.ghost.md' });
  assert.deepEqual(actual.bytes, expected.bytes);
  assert.equal(actual.sourceDocument.text, source);
  assert.equal(actual.sourceClosure.documents[0].text, relay);
  assert.ok(actual.sourceMap.some(node => node.filename === 'relay.ghost.md' && node.instance === 'east'));
});

const compileChild = (child, body) => compileSource(doc(`${pin(child)} control Farm { ${body} }`), {
  filename: 'farm.ghost.md', sourceClosure: [{ filename: 'relay.ghost.md', revision: 'r1', text: child }],
});
for (const [label, childBody, rootBody, reason] of [
  ['missing required input', 'input start: Bool; output pump: Bool; pump <- start;', 'output pump: Bool; instance east: Relay; connect pump <- east.pump;', /missing required input east.start/],
  ['port direction', 'input start: Bool; output pump: Bool; pump <- start;', 'input start: Bool; instance east: Relay; connect east.pump <- start;', /unknown input port east.pump/],
  ['port type', 'input start: Int; output pump: Bool; pump <- true;', 'input start: Bool; instance east: Relay; connect east.start <- start;', /port type mismatch/],
  ['unused output expression type', 'output pump: Bool; pump <- 1;', 'instance east: Relay;', /output.*type|composition output.*type/],
  ['port cycle', 'input start: Bool; output pump: Bool; pump <- start;', 'instance east: Relay; connect east.start <- east.pump;', /combinational port cycle/],
  ['unknown argument', 'output pump: Bool; pump <- true;', 'instance east: Relay(missing = true);', /unknown instance argument missing/],
  ['nonconstant argument', 'parameter enabled: Bool = true; output pump: Bool; pump <- enabled;', 'input start: Bool; instance east: Relay(enabled = start);', /parameter default.*constant/],
]) test(`composition rejects ${label}`, async () => {
  await assert.rejects(() => compileChild(doc(`control Relay { ${childBody} }`), rootBody), reason);
});

test('persisted artifact verifies the full imported text and instance provenance', async t => {
  const actual = await compileSource(root('instance east: Relay; connect east.start <- start; connect pump <- east.pump;'), { filename: 'farm.ghost.md', sourceClosure: closure });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-composition-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'farm.gfb');
  writeArtifact(actual, output);
  const map = JSON.parse(fs.readFileSync(`${output}.map.json`, 'utf8'));
  assert.deepEqual(restoreArtifactSourceMap(map, actual.bytes).sourceClosure, actual.sourceClosure);
  const tampered = structuredClone(map);
  tampered.sourceClosure.documents[0].text += '\nTampered prose';
  assert.throws(() => restoreArtifactSourceMap(tampered, actual.bytes), /digest mismatch/);
  const badNode = structuredClone(map);
  badNode.nodes.find(node => node.instance === 'east').instance = 'west';
  assert.throws(() => restoreArtifactSourceMap(badNode, actual.bytes), /sourceMap.*canonical source/);
});

test('two instances retain independent state in the Rust runtime', async t => {
  const child = doc("control Relay { input start: Bool; output pump: Bool; state held: Bool = false; held' = held || start; pump <- held'; }");
  const actual = await compileChild(child, 'input a, b: Bool; output x, y: Bool; instance east: Relay; instance west: Relay; connect east.start <- a; connect west.start <- b; connect x <- east.pump; connect y <- west.pump;');
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await ControlRuntime.instantiate(wasm, actual);
  t.after(() => runtime.dispose());
  assert.deepEqual(runtime.step({ nowMs: 0, inputs: { a: true, b: false } }).vm.safe, { x: true, y: false });
  assert.deepEqual(runtime.step({ nowMs: 1, inputs: { a: false, b: true } }).vm.safe, { x: true, y: true });
});

test('transitive closure resolves relative documents and validates every pin', async () => {
  const wrapper = doc(`${pin()} control Wrapper { input start: Bool; output pump: Bool; instance inner: Relay; connect inner.start <- start; connect pump <- inner.pump; }`);
  const source = doc(`import Wrapper from "./lib/wrapper.ghost.md" revision "w1" sha256 "${sha256Hex(wrapper)}"; control Farm { input start: Bool; output pump: Bool; instance outer: Wrapper; connect outer.start <- start; connect pump <- outer.pump; }`);
  const documents = [{ filename: 'lib/wrapper.ghost.md', revision: 'w1', text: wrapper }, { ...closure[0], filename: 'lib/relay.ghost.md' }];
  const copy = structuredClone(documents);
  const actual = await compileSource(source, { filename: 'farm.ghost.md', sourceClosure: documents });
  assert.deepEqual(documents, copy);
  assert.equal(actual.sourceClosure.documents.length, 2);
  assert.ok(actual.sourceClosure.instances.some(entry => entry.instance === 'outer.inner'));
  await assert.rejects(() => compileSource(source, { filename: 'farm.ghost.md', sourceClosure: documents.slice(0, 1) }), /missing imported document/);
  await assert.rejects(() => compileSource(source, { filename: 'farm.ghost.md', sourceClosure: [documents[0], { ...documents[1], revision: 'wrong' }] }), /revision mismatch/);
});

test('cross-instance next-state feedback is rejected', async () => {
  const child = doc("control Relay { input start: Bool; output pump: Bool; state held: Bool = false; held' = start; pump <- held'; }");
  await assert.rejects(() => compileChild(child, 'input start: Bool; instance east: Relay; instance west: Relay; connect east.start <- start; connect west.start <- east.pump;'), /next state|next-state/);
});

const sensorChild = (filter = 'median(1)', recovery = 1) => doc(`
fn adjust(air: Number) -> Number { air + 1 }
control Child {
 sensor air: Number { sample = 1s; filter = ${filter}; stale_after = 3s; recover_after = ${recovery} samples; }
 output value: Number; output valid: Bool;
 value <- case air { ok(value) => adjust(value); fault(_) => 0; };
 valid <- case air { ok(_) => true; fault(_) => false; };
}`);
async function sensorComposition(a = sensorChild(), b = sensorChild('median(3)'), optional = false) {
 const documents = [a, b].map((text, i) => ({ filename: `${i}.ghost.md`, revision: 'r1', text }));
 const headers = documents.map((d, i) => `import Child${i} from "./${d.filename}" revision "r1" sha256 "${sha256Hex(d.text)}";`).join('\n');
 const source = doc(`${headers} control Farm {
 sensor air${optional ? '?' : ''}: Number { sample = 1s; }
 output a, b: Number; output a_valid, b_valid: Bool;
 instance first: Child0; instance second: Child1;
 connect first.air <- air; connect second.air <- air;
 connect a <- first.value; connect b <- second.value;
 connect a_valid <- first.valid; connect b_valid <- second.valid;
 }`);
 return { artifact: await compileSource(source, { filename: 'farm.ghost.md', sourceClosure: documents }), source, documents };
}

test('sensor composition exposes root ports and retains private independent conditioners and lexical functions', async t => {
 const { artifact } = await sensorComposition();
 assert.deepEqual(artifact.manifest.sensors.map(s => s.name), ['air']);
 assert.equal(artifact.manifest.sensorInstances.length, 2);
 assert.deepEqual(artifact.manifest.sensorInstances.map(s => s.sourceSensor), ['air', 'air']);
 const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
 const runtime = await ControlRuntime.instantiateFramed(wasm, artifact);
 t.after(() => runtime.dispose());
 const packet = (id, value, quality = 'Good') => ({ air: { epoch: 1, id, timestampMs: id * 1000, quality, value } });
 assert.equal(runtime.step({ nowMs: 1000, samples: packet(1, 10) }).vm.safe.a, 11);
 runtime.step({ nowMs: 2000, samples: packet(2, 10) });
 const filtered = runtime.step({ nowMs: 3000, samples: packet(3, 100) }).vm.safe;
 assert.equal(filtered.a, 101);
 assert.equal(filtered.b, 11);
 const privateName = artifact.manifest.sensorInstances[0].name;
 assert.throws(() => runtime.step({ nowMs: 4000, samples: { [privateName]: packet(4, 20).air } }), /unknown sensor/);
 const fault = runtime.step({ nowMs: 4000, samples: packet(4, 0, 'Disconnected') }).vm.safe;
 assert.equal(fault.a_valid, false); assert.equal(fault.b_valid, false);
 const recovery = runtime.step({ nowMs: 5000, samples: packet(5, 20) }).vm.safe;
 assert.equal(recovery.a_valid, true);
 runtime.step({ nowMs: 6000, samples: packet(6, 20) });
 assert.equal(runtime.step({ nowMs: 7000, samples: packet(7, 20) }).vm.safe.b_valid, true);
 const stale = runtime.step({ nowMs: 10001 }).vm.safe;
 assert.equal(stale.a_valid, false); assert.equal(stale.b_valid, false);
});

test('sensor composition rejects missing, duplicate, scalar, type and sample-contract suppliers', async () => {
 const { source, documents } = await sensorComposition();
 const compile = text => compileSource(text, { filename: 'farm.ghost.md', sourceClosure: documents });
 for (const [text, reason] of [
  [source.replace('connect first.air <- air;', ''), /missing required input first.air/],
  [source.replace('connect first.air <- air;', 'connect first.air <- air; connect first.air <- air;'), /duplicate supplier/],
  [source.replace('sensor air: Number { sample = 1s; }', 'input air: Number;'), /sensor connection requires/],
  [source.replace('sensor air: Number', 'sensor air: Temperature'), /port type mismatch/],
  [source.replace('sample = 1s;', 'sample = 2s;'), /sensor sample contract mismatch/],
  [source.replace('sensor air:', 'sensor air?:'), /sensor sample contract mismatch/],
 ]) await assert.rejects(() => compile(text), reason);
 const equivalentInterval = await compile(source.replace('sample = 1s;', 'sample = 1000ms;'));
 assert.equal(equivalentInterval.manifest.sensors[0].sampleMs, 1000);
});

test('sensor artifact restoration verifies closure and private binding metadata', async t => {
 const { artifact } = await sensorComposition();
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sensor-composition-map-'));
 t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
 const output = path.join(directory, 'sensor.gfb'); writeArtifact(artifact, output);
 const map = JSON.parse(fs.readFileSync(`${output}.map.json`, 'utf8'));
 assert.deepEqual(restoreArtifactSourceMap(map, artifact.bytes).sourceClosure, artifact.sourceClosure);
 const changed = structuredClone(artifact.manifest);
 changed.sensorInstances[0].sourceSensor = 'missing';
 assert.throws(() => restoreArtifactSourceMap(map, artifact.bytes, { manifest: changed }), /manifest.*canonical source/);
 const prose = structuredClone(map); prose.sourceClosure.documents[0].text += '\nChanged prose';
 assert.throws(() => restoreArtifactSourceMap(prose, artifact.bytes), /digest mismatch/);
});

test('sensor composition rolls all conditioner state back when the VM rejects a scan', async t => {
 const { artifact } = await sensorComposition(sensorChild().replace('air + 1', '1 / air'), sensorChild().replace('air + 1', '1 / air'));
 const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
 const runtime = await ControlRuntime.instantiateFramed(wasm, artifact); t.after(() => runtime.dispose());
 const packet = value => ({ air: { epoch: 1, id: 1, timestampMs: 1000, quality: 'Good', value } });
 assert.throws(() => runtime.step({ nowMs: 1000, samples: packet(0) }), /division|zero/i);
 const retried = runtime.step({ nowMs: 1000, samples: packet(10) });
 assert.equal(retried.frame.scanId, 0);
 assert.equal(retried.vm.safe.a, 0.1); assert.equal(retried.vm.safe.b, 0.1);
});

test('composed conditioned frames have identical native and WASM VM outcomes', async t => {
 const { artifact } = await sensorComposition();
 const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
 const runtime = await ControlRuntime.instantiateFramed(wasm, artifact); t.after(() => runtime.dispose());
 const frames = [], outcomes = [], dispatch = runtime.runtime.dispatch.bind(runtime.runtime);
 runtime.runtime.dispatch = frame => { frames.push(structuredClone(frame)); dispatch(frame); outcomes.push(runtime.runtime.outcome); };
 for (const [id, value] of [[1, 10], [2, 10], [3, 100]]) runtime.step({ nowMs: id * 1000, samples: { air: { epoch: 1, id, timestampMs: id * 1000, quality: 'Good', value } } });
 runtime.step({ nowMs: 6001 });
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'composed-sensor-parity-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
 const modulePath = path.join(directory, 'program.gfb'), inputPath = path.join(directory, 'frames.tsv');
 fs.writeFileSync(modulePath, artifact.bytes);
 fs.writeFileSync(inputPath, frames.map(f => [f.scanId, f.logicalTimeMs,
  ...f.inputs.flatMap(i => [i.name, i.type === 'Bool' ? 'b' : 'n', i.value])].join('\t')).join('\n') + '\n');
 const result = spawnSync(new URL('../target/release/examples/scan_tape', import.meta.url).pathname, [modulePath, inputPath], { encoding: 'utf8', timeout: 10_000 });
 assert.equal(result.status, 0, result.error?.message ?? result.stderr);
 const nativeRows = result.stdout.trim().split('\n').map(JSON.parse);
 assert.ok(nativeRows.every(row => row.accepted));
 assert.deepEqual(nativeRows.map(row => row.outcome), outcomes);
});

test('private optional sensor capabilities inherit installed root presence without exposing private ports', async t => {
 // Optional reads still require an adapt strategy, which composition deliberately
 // does not support. Constant outputs isolate the host capability inheritance.
 const child = sensorChild().replace('sensor air:', 'sensor air?:')
  .replace('case air { ok(value) => adjust(value); fault(_) => 0; }', '0')
  .replace('case air { ok(_) => true; fault(_) => false; }', 'false');
 const { artifact } = await sensorComposition(child, child, true);
 const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
 const original = FramedGhostFlowRuntime.prototype.addCapability, calls = [];
 t.mock.method(FramedGhostFlowRuntime.prototype, 'addCapability', function(...args) { calls.push(args); return original.apply(this, args); });
 const absent = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: [] }); t.after(() => absent.dispose());
 assert.deepEqual(calls.filter(([kind]) => kind === 'sensor'), []);
 assert.throws(() => absent.step({ nowMs: 1000, samples: { air: { epoch: 1, id: 1, timestampMs: 1000, quality: 'Good', value: 10 } } }), /absent sensor capability/);
 calls.length = 0;
 const present = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: [{ kind: 'sensor', name: 'air', type: 'Number' }] }); t.after(() => present.dispose());
 assert.deepEqual(calls.filter(([kind]) => kind === 'sensor').map(([, name]) => name), ['air', ...artifact.manifest.sensorInstances.map(s => s.name)]);
 assert.doesNotThrow(() => present.step({ nowMs: 1000, samples: { air: { epoch: 1, id: 1, timestampMs: 1000, quality: 'Good', value: 10 } } }));
});
