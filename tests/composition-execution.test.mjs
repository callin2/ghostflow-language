import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/compile-source.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeArtifact, restoreArtifactSourceMap } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

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
