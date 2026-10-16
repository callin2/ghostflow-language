import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { compileSource } from '../tools/compile-source.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { writeArtifact, restoreArtifactSourceMap } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const document = code => `# Exact import intent\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const pin = (alias, locator, revision, text) => `import ${alias} from "${locator}" revision "${revision}" sha256 "${sha256Hex(text)}";`;
// The prior leaf-r7/middle-r4 source is historical intent, not a fallback.
const historicalLeaf = document('control Leaf { input start: Bool; output pump: Bool; pump <- start; }');
const leaf = document('control Leaf { input start: Bool; output pump: Bool; pump <- start |> recover(false); }');
const middle = document(`${pin('Leaf', './leaf.ghost.md', 'leaf-input-r1', leaf)}
control Middle { input start: Bool; output pump: Bool; instance inner: Leaf;
connect inner.start <- start; connect pump <- inner.pump; }`);
const source = document(`${pin('Middle', './lib/middle.ghost.md', 'middle-input-r1', middle)}
control Farm { input start: Bool; output pump: Bool; instance outer: Middle;
connect outer.start <- start; connect pump <- outer.pump; }`);
const documents = [
  { filename: 'lib/middle.ghost.md', revision: 'middle-input-r1', text: middle },
  { filename: 'lib/leaf.ghost.md', revision: 'leaf-input-r1', text: leaf },
];
const compile = (text = source, closure = documents) => compileSource(text, { filename: 'farm.ghost.md', sourceClosure: closure });

test('REF-06-011 exact transitive revision and digest closure survives artifact replay and native framed WASM execution', async t => {
  const owned = structuredClone(documents), before = structuredClone(owned);
  const artifact = await compile(source, owned);
  assert.deepEqual(owned, before, 'closure resolution must not rewrite caller sources or revisions');
  assert.deepEqual(artifact.sourceClosure.documents, [...documents].sort((a,b) => a.filename.localeCompare(b.filename))
    .map(item => ({ ...item, sha256: sha256Hex(item.text) })));
  assert.deepEqual([...artifact.sourceClosure.instances].sort((a,b) => a.instance.localeCompare(b.instance)), [
    { instance: 'outer', filename: 'lib/middle.ghost.md', definition: 'Middle' },
    { instance: 'outer.inner', filename: 'lib/leaf.ghost.md', definition: 'Leaf' },
  ]);
  assert.equal(artifact.sourceDocument.text, source);
  assert.notEqual(sha256Hex(leaf), sha256Hex(historicalLeaf), 'quality policy produces an explicit new source revision');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-pinned-closure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'farm.gfb'), tapePath = path.join(directory, 'frames.tsv');
  writeArtifact(artifact, modulePath);
  const map = JSON.parse(fs.readFileSync(`${modulePath}.map.json`, 'utf8'));
  assert.deepEqual(restoreArtifactSourceMap(map, artifact.bytes, { manifest: artifact.manifest }).sourceClosure, artifact.sourceClosure);
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact);
  t.after(() => runtime.dispose());
  const frames = [], outcomes = [], dispatch = runtime.runtime.dispatch.bind(runtime.runtime);
  runtime.runtime.dispatch = frame => { frames.push(structuredClone(frame)); dispatch(frame); outcomes.push(structuredClone(runtime.runtime.outcome)); };
  for (const [nowMs, start] of [[0,false], [1,true], [2,false]]) runtime.step({ nowMs,
    samples: { start: { epoch: 1, id: nowMs + 1, timestampMs: nowMs, quality: 'Good', value: start } } });
  fs.writeFileSync(tapePath, frames.map(frame => [frame.scanId, frame.logicalTimeMs,
    ...frame.inputs.flatMap(input => [input.name, input.type === 'Bool' ? 'b' : 'n', input.value])].join('\t')).join('\n') + '\n');
  const nativePath = fileURLToPath(new URL('../target/release/examples/scan_tape' + (process.platform === 'win32' ? '.exe' : ''), import.meta.url));
  const native = spawnSync(nativePath, [modulePath,tapePath], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(native.status, 0, native.error?.message ?? native.stderr);
  const rows = native.stdout.trim().split('\n').map(JSON.parse);
  assert.ok(rows.every(row => row.accepted));
  assert.deepEqual(rows.map(row => row.outcome), outcomes, 'same pinned bytecode must produce complete native/WASM outcome parity');
  assert.deepEqual(outcomes.map(row => row.trace.safe), [{pump:false},{pump:true},{pump:false}]);
  for (const [field, change] of [
    ['revision', item => { item.revision = 'leaf-r8'; }],
    ['text', item => { item.text += '\nChanged authored rationale'; }],
    ['digest', item => { item.sha256 = '0'.repeat(64); }],
  ]) {
    const forged = structuredClone(map);
    change(forged.sourceClosure.documents.find(item => item.filename === 'lib/leaf.ghost.md'));
    assert.throws(() => restoreArtifactSourceMap(forged, artifact.bytes), /revision mismatch|digest mismatch|does not match canonical source/, field);
  }
});

test('REF-06-011 missing or floating transitive pins and revision or digest mismatches reject at their authored dependency', async () => {
  for (const [label, closure, pattern] of [
    ['missing leaf', documents.slice(0,1), /missing imported document .*leaf/],
    ['transitive revision', [documents[0], {...documents[1], revision:'leaf-r8'}], /import revision mismatch .*leaf/],
    ['transitive digest', [documents[0], {...documents[1], text: leaf + '\nChanged rationale'}], /import sha256 digest mismatch .*leaf/],
  ]) await assert.rejects(() => compile(source, closure), error => {
    assert.equal(error.diagnosticEnvelope.diagnostics[0].code, 'GF_IMPORT', label);
    assert.equal(error.filename, 'lib/middle.ghost.md', label);
    assert.equal(error.diagnosticEnvelope.requestSource.sha256, sha256Hex(source), label);
    assert.match(error.message, pattern, label);
    return true;
  });
  for (const [label, edit, pattern] of [
    ['missing revision', text => text.replace('revision "leaf-input-r1" ', ''), /requires an immutable revision/],
    ['floating revision', text => text.replace('"leaf-input-r1"', '"latest"'), /revision cannot be latest/],
    ['missing digest', text => text.replace(`sha256 "${sha256Hex(leaf)}"`, ''), /requires a SHA-256 digest/],
  ]) {
    const changed = edit(middle);
    const changedRoot = source.replace(sha256Hex(middle), sha256Hex(changed));
    await assert.rejects(() => compile(changedRoot, [{...documents[0], text:changed},documents[1]]), error => {
      assert.equal(error.filename, 'lib/middle.ghost.md', label);
      assert.match(error.message, pattern, label);
      return true;
    });
  }
});

test('REF-06-011 executable transitive import back edges reject as cycles before their circular digest mismatch', async () => {
  // A content-pinned cycle cannot have independently constructible mutually
  // consistent hashes. Its closing edge is nevertheless an explicit cycle,
  // and must be diagnosed before treating that edge as a mere stale digest.
  const b = document(`import A from "./a.ghost.md" revision "a-r1" sha256 "${'0'.repeat(64)}"; control B { output result: Bool; result <- true; }`);
  const a = document(`${pin('B','./b.ghost.md','b-r1',b)} control A { output result: Bool; result <- true; }`);
  const root = document(`${pin('A','./lib/a.ghost.md','a-r1',a)} control Farm { output result: Bool; result <- true; }`);
  await assert.rejects(() => compile(root,[{filename:'lib/a.ghost.md',revision:'a-r1',text:a},{filename:'lib/b.ghost.md',revision:'b-r1',text:b}]), error => {
    assert.equal(error.filename, 'lib/b.ghost.md');
    assert.equal(error.diagnosticEnvelope.diagnostics[0].code, 'GF_IMPORT');
    assert.match(error.message, /executable import cycle at \.\/a\.ghost\.md/);
    return true;
  });
});
