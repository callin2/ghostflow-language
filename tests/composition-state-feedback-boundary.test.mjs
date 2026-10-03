import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { compileSource } from '../tools/compile-source.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { observeSourceTrace } from '../tools/source-trace.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

const doc = code => `# REF-06-001 state feedback boundary\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const nativePath = fileURLToPath(new URL('../target/release/examples/scan_tape' + (process.platform === 'win32' ? '.exe' : ''), import.meta.url));
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));

const latch = doc(`control Latch {
  input peer_previous, trigger: Bool;
  state held: Bool = false;
  state accepted: Int = 0;
  held' = trigger || peer_previous;
  accepted' = if trigger || peer_previous then accepted + 1 else accepted;
  output previous, active: Bool;
  output count: Int;
  previous <- held;
  active <- held';
  count <- accepted';
}`);
const pin = (alias, filename, text) => `import ${alias} from "./${filename}" revision "r1" sha256 "${sha256Hex(text)}";`;

async function compileFeedback(reversed = false) {
  const imports = [pin('Latch', 'latch.ghost.md', latch)];
  const declarations = ['instance A: Latch;', 'instance B: Latch;'];
  const connections = [
    'connect A.trigger <- seed_a;', 'connect B.trigger <- seed_b;',
    'connect A.peer_previous <- B.previous;', 'connect B.peer_previous <- A.previous;',
    'connect a_active <- A.active;', 'connect b_active <- B.active;',
    'connect a_previous <- A.previous;', 'connect b_previous <- B.previous;',
    'connect a_count <- A.count;', 'connect b_count <- B.count;',
  ];
  const source = doc(`${imports.join('\n')}
control FeedbackPair {
  input seed_a, seed_b: Bool;
  output a_active, b_active, a_previous, b_previous: Bool;
  output a_count, b_count: Int;
  ${(reversed ? [...declarations].reverse() : declarations).join('\n')}
  ${(reversed ? [...connections].reverse() : connections).join('\n')}
}`);
  return compileSource(source, { filename: 'feedback-pair.ghost.md', sourceClosure: [{ filename: 'latch.ghost.md', revision: 'r1', text: latch }] });
}

async function executeArtifact(artifact, snapshots) {
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact);
  const frames = [], outcomes = [], dispatch = runtime.runtime.dispatch.bind(runtime.runtime);
  runtime.runtime.dispatch = frame => {
    frames.push(structuredClone(frame));
    dispatch(frame);
    outcomes.push(structuredClone(runtime.runtime.outcome));
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-ref-06-001-'));
  try {
    snapshots.forEach((inputs, nowMs) => runtime.step({ nowMs, inputs }));
    const modulePath = path.join(directory, 'feedback.gfb'), tapePath = path.join(directory, 'frames.tsv');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(tapePath, frames.map(frame => [frame.scanId, frame.logicalTimeMs,
      ...frame.inputs.flatMap(input => [input.name, input.type === 'Bool' ? 'b' : 'n', input.value])].join('\t')).join('\n') + '\n');
    const native = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(native.status, 0, native.error?.message ?? native.stderr);
    const rows = native.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, snapshots.length);
    assert.ok(rows.every(row => row.accepted));
    const nativeOutcomes = rows.map(row => row.outcome);
    assert.deepEqual(nativeOutcomes, outcomes, 'native scan_tape receipts equal full framed WASM outcomes');

    const replay = await FramedGhostFlowRuntime.instantiate(wasm);
    try {
      replay.load(artifact.bytes);
      for (const output of artifact.manifest.outputs) replay.addCapability('actuator', output.name, output.type.toLowerCase());
      replay.activate();
      assert.deepEqual(frames.map(frame => structuredClone(replay.scan(frame))), outcomes, 'direct framed WASM scan replay matches runtime dispatch outcomes');
    } finally {
      replay.dispose();
    }

    return outcomes.map(outcome => {
      const observed = observeSourceTrace(artifact.traceMetadata, outcome.trace);
      const states = {};
      for (const binding of artifact.traceMetadata.bindings.filter(binding => binding.kind === 'state')) {
        const node = artifact.sourceMap.find(node => node.id === binding.nodeId);
        const local = ['held', 'accepted'].find(name => binding.name.endsWith(`_${name}`));
        assert.ok(node?.instance && local, `unexpected state binding ${binding.name}`);
        const entry = observed.bindings.find(item => item.nodeId === binding.nodeId);
        const before = entry.observations.find(item => item.field === 'stateBefore');
        const after = entry.observations.find(item => item.field === 'stateAfter');
        assert.ok(before && after, `${node.instance}.${local} has before/after evidence`);
        states[`${node.instance}.${local}`] = { before: before.value, after: after.value };
      }
      return { requested: outcome.trace.requested, safe: outcome.trace.safe, states };
    });
  } finally {
    runtime.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('REF-06-001 accepts two-way cross-instance feedback only through previous committed state with deterministic tick lag', async () => {
  const snapshots = [
    { seed_a: false, seed_b: false },
    { seed_a: true, seed_b: false },
    { seed_a: false, seed_b: false },
    { seed_a: false, seed_b: false },
  ];
  let baseline;
  for (const reversed of [false, true]) {
    const artifact = await compileFeedback(reversed);
    assert.deepEqual(artifact.sourceClosure.instances.map(item => item.instance).sort(), ['A', 'B']);
    const observations = await executeArtifact(artifact, snapshots);
    assert.deepEqual(observations.map(row => row.requested), [
      { a_active: false, b_active: false, a_previous: false, b_previous: false, a_count: 0, b_count: 0 },
      { a_active: true, b_active: false, a_previous: false, b_previous: false, a_count: 1, b_count: 0 },
      { a_active: false, b_active: true, a_previous: true, b_previous: false, a_count: 1, b_count: 1 },
      { a_active: true, b_active: false, a_previous: false, b_previous: true, a_count: 2, b_count: 1 },
    ]);
    assert.deepEqual(observations.map(row => row.safe), observations.map(row => row.requested));
    assert.deepEqual(observations.map(row => row.states['A.held'].after), [false, true, false, true]);
    assert.deepEqual(observations.map(row => row.states['B.held'].after), [false, false, true, false]);
    assert.deepEqual(observations.map(row => row.states['A.accepted'].after), [0, 1, 1, 2]);
    assert.deepEqual(observations.map(row => row.states['B.accepted'].after), [0, 0, 1, 1]);
    if (baseline) assert.deepEqual(observations, baseline, 'identity-keyed state/output observations are independent of declaration and connection order');
    baseline = observations;
  }
});

test('REF-06-001 rejects identical endpoints linked by same-tick combinational expressions', async () => {
  const wire = doc('control Wire { input start: Bool; output result: Bool; result <- start; }');
  const source = doc(`${pin('Wire', 'wire.ghost.md', wire)}
control Cycle {
  instance A: Wire;
  instance B: Wire;
  connect A.start <- B.result;
  connect B.start <- A.result;
}`);
  await assert.rejects(() => compileSource(source, { filename: 'cycle.ghost.md', sourceClosure: [{ filename: 'wire.ghost.md', revision: 'r1', text: wire }] }), /combinational port cycle/);
});

test('REF-06-001 rejects next-state cross feedback across instances', async () => {
  const next = doc(`control NextPort {
    input peer: Bool;
    state held: Bool = false;
    held' = peer;
    output current, next_value: Bool;
    current <- held;
    next_value <- held';
  }`);
  const source = doc(`${pin('NextPort', 'next.ghost.md', next)}
control NextCycle {
  instance A: NextPort;
  instance B: NextPort;
  connect A.peer <- B.next_value;
  connect B.peer <- A.current;
}`);
  await assert.rejects(() => compileSource(source, { filename: 'next-cycle.ghost.md', sourceClosure: [{ filename: 'next.ghost.md', revision: 'r1', text: next }] }), /next state|next-state/);
});

test('REF-06-001 import back-edge rejects before its invalid pin and preserves syntax type revision failures', async () => {
  // Forward pins match exact supplied documents. Only the closing edge has
  // the deliberately invalid circular pin, which must not hide the cycle.
  const b = doc(`import A from "./a.ghost.md" revision "r1" sha256 "${'0'.repeat(64)}"; control B { instance a: A; output out: Bool; connect out <- a.out; }`);
  const a = doc(`${pin('B', 'b.ghost.md', b)} control A { instance b: B; output out: Bool; connect out <- b.out; }`);
  const root = doc(`${pin('A', 'a.ghost.md', a)} control Root { instance a: A; output out: Bool; connect out <- a.out; }`);
  await assert.rejects(() => compileSource(root, { filename: 'root.ghost.md', sourceClosure: [
    { filename: 'a.ghost.md', revision: 'r1', text: a }, { filename: 'b.ghost.md', revision: 'r1', text: b },
  ] }), /executable import cycle/);
  await assert.rejects(() => compileSource(doc('control Broken { input start Bool; }'), { filename: 'broken.ghost.md' }), /Expected|parse/i);
  const booler = doc('control Booler { input start: Bool; output out: Bool; out <- start; }');
  await assert.rejects(() => compileSource(doc(`${pin('Booler', 'booler.ghost.md', booler)} control TypeBad { input start: Int; instance b: Booler; connect b.start <- start; }`), {
    filename: 'type-bad.ghost.md', sourceClosure: [{ filename: 'booler.ghost.md', revision: 'r1', text: booler }],
  }), /port type mismatch/);
  await assert.rejects(() => compileSource(doc(`${pin('Booler', 'booler.ghost.md', booler).replace('revision "r1"', 'revision "wrong"')} control RevBad { instance b: Booler; output out: Bool; connect out <- b.out; }`), {
    filename: 'rev-bad.ghost.md', sourceClosure: [{ filename: 'booler.ghost.md', revision: 'r1', text: booler }],
  }), /revision mismatch/);
});
