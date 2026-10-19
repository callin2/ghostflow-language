import { softwareQualityObservations } from './helpers/software-quality-observations.mjs';
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
  held' = (trigger |> recover(false)) || (peer_previous |> recover(false));
  accepted' = if (trigger |> recover(false)) || (peer_previous |> recover(false)) then accepted + 1 else accepted;
  output previous, active: Bool;
  output count: Int;
  previous <- held;
  active <- held';
  count <- accepted';
}`);
const pin = (alias, filename, text) => `import ${alias} from "./${filename}" revision "input-v1" sha256 "${sha256Hex(text)}";`;

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
  return compileSource(source, { filename: 'feedback-pair.ghost.md', sourceClosure: [{ filename: 'latch.ghost.md', revision: 'input-v1', text: latch }] });
}

async function executeArtifact(artifact, snapshots) {
  const runtime = softwareQualityObservations(await ControlRuntime.instantiateFramed(wasm, artifact));
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
  const wire = doc('control Wire { input start: Bool; output result: Bool; result <- start |> recover(false); }');
  const source = doc(`${pin('Wire', 'wire.ghost.md', wire)}
control Cycle {
  instance A: Wire;
  instance B: Wire;
  connect A.start <- B.result;
  connect B.start <- A.result;
}`);
  await assert.rejects(() => compileSource(source, { filename: 'cycle.ghost.md', sourceClosure: [{ filename: 'wire.ghost.md', revision: 'input-v1', text: wire }] }), /combinational port cycle/);
});

test('REF-06-001 rejects next-state cross feedback across instances', async () => {
  const next = doc(`control NextPort {
    input peer: Bool;
    state held: Bool = false;
    held' = peer |> recover(false);
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
  await assert.rejects(() => compileSource(source, { filename: 'next-cycle.ghost.md', sourceClosure: [{ filename: 'next.ghost.md', revision: 'input-v1', text: next }] }), /next state|next-state/);
});

test('REF-06-001 import back-edge rejects before its invalid pin and preserves syntax type revision failures', async () => {
  // Forward pins match exact supplied documents. Only the closing edge has
  // the deliberately invalid circular pin, which must not hide the cycle.
  const b = doc(`import A from "./a.ghost.md" revision "input-v1" sha256 "${'0'.repeat(64)}"; control B { instance a: A; output out: Bool; connect out <- a.out; }`);
  const a = doc(`${pin('B', 'b.ghost.md', b)} control A { instance b: B; output out: Bool; connect out <- b.out; }`);
  const root = doc(`${pin('A', 'a.ghost.md', a)} control Root { instance a: A; output out: Bool; connect out <- a.out; }`);
  await assert.rejects(() => compileSource(root, { filename: 'root.ghost.md', sourceClosure: [
    { filename: 'a.ghost.md', revision: 'input-v1', text: a }, { filename: 'b.ghost.md', revision: 'input-v1', text: b },
  ] }), /executable import cycle/);
  await assert.rejects(() => compileSource(doc('control Broken { input start Bool; }'), { filename: 'broken.ghost.md' }), /Expected|parse/i);
  const booler = doc('control Booler { input start: Bool; output out: Bool; out <- start |> recover(false); }');
  await assert.rejects(() => compileSource(doc(`${pin('Booler', 'booler.ghost.md', booler)} control TypeBad { input start: Int; instance b: Booler; connect b.start <- start; }`), {
    filename: 'type-bad.ghost.md', sourceClosure: [{ filename: 'booler.ghost.md', revision: 'input-v1', text: booler }],
  }), /port type mismatch/);
  await assert.rejects(() => compileSource(doc(`${pin('Booler', 'booler.ghost.md', booler).replace('revision "input-v1"', 'revision "wrong"')} control RevBad { instance b: Booler; output out: Bool; connect out <- b.out; }`), {
    filename: 'rev-bad.ghost.md', sourceClosure: [{ filename: 'booler.ghost.md', revision: 'input-v1', text: booler }],
  }), /revision mismatch/);
});

test('issue 531 internal computed Result connections preserve authored fault handling without acquisition provenance', async t => {
  const producer = doc(`control Producer {
    input observed: Bool;
    output value: Bool;
    value <- case observed { ok(value) => value; fault(_) => true; };
  }`);
  const consumer = doc(`control Consumer {
    input previous: Bool;
    output value: Bool;
    value <- case previous { ok(value) => !value; fault(_) => true; };
  }`);
  const source = doc(`${pin('Producer', 'producer.ghost.md', producer)}
    ${pin('Consumer', 'consumer.ghost.md', consumer)}
    control Pipeline {
      input observed: Bool;
      instance producer: Producer;
      instance middle: Consumer;
      instance consumer: Consumer;
      output value: Bool;
      connect producer.observed <- observed;
      connect middle.previous <- producer.value;
      connect consumer.previous <- middle.value;
      connect value <- consumer.value;
    }`);
  const artifact = await compileSource(source, { filename: 'computed-pipeline.ghost.md', sourceClosure: [
    { filename: 'producer.ghost.md', revision: 'input-v1', text: producer },
    { filename: 'consumer.ghost.md', revision: 'input-v1', text: consumer },
  ] });
  assert.deepEqual(artifact.manifest.sensors.map(item => item.name), ['observed']);
  assert.deepEqual(artifact.manifest.sensorInstances.map(item => [item.instance, item.port, item.sourceSensor]), [['producer', 'observed', 'observed']]);
  const internalSites = artifact.traceMetadata.resultSites.filter(site => artifact.sourceMap.find(node => node.id === site.nodeId)?.instance !== 'producer');
  assert.equal(internalSites.length, 2);
  assert.ok(internalSites.every(site => site.origins.length === 0), 'computed values have no acquisition or fault origin');
  const packets = [
    { nowMs: 0 },
    ...['Good', 'Good', 'Disconnected', 'Stale', 'Invalid', 'NotReady'].map((quality, index) => ({
      nowMs: index + 1, samples: { observed: { epoch: 1, id: index + 1, timestampMs: index + 1, quality, value: index === 0 ? false : true } },
    })),
  ];
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact);
  t.after(() => runtime.dispose());
  const frames = [], outcomes = [], dispatch = runtime.runtime.dispatch.bind(runtime.runtime);
  runtime.runtime.dispatch = frame => { frames.push(structuredClone(frame)); dispatch(frame); outcomes.push(structuredClone(runtime.runtime.outcome)); };
  const results = packets.map(packet => runtime.step(packet));
  assert.deepEqual(results.map(result => result.vm.safe.value), [true, false, true, true, true, true, true], 'upstream fixture-authored fault branch is lifted as its actual scalar result');
  for (const result of results) {
    assert.ok(!Object.keys(result.vm.inputs).some(name => /middle|consumer/.test(name)), 'internal inputs introduce no value, quality or sample rails');
    const observed = observeSourceTrace(artifact.traceMetadata, result.vm);
    for (const site of internalSites) {
      const events = observed.resultEvents.filter(event => event.site === site.site);
      assert.ok(events.length > 0);
      assert.ok(events.every(event => event.choice === 0 && event.origin === 0 && event.originDescriptor === null));
    }
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-computed-result-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'pipeline.gfb'), tapePath = path.join(directory, 'frames.tsv');
  fs.writeFileSync(modulePath, artifact.bytes);
  fs.writeFileSync(tapePath, frames.map(frame => [frame.scanId, frame.logicalTimeMs,
    ...frame.inputs.flatMap(input => [input.name, input.type === 'Bool' ? 'b' : 'n', input.value])].join('\t')).join('\n') + '\n');
  const native = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10000 });
  assert.equal(native.status, 0, native.error?.message ?? native.stderr);
  const rows = native.stdout.trim().split('\n').map(JSON.parse);
  assert.ok(rows.every(row => row.accepted));
  assert.deepEqual(rows.map(row => row.outcome), outcomes, 'native and WASM preserve all computed Result and upstream fault evidence');
});

test('issue 531 computed ports reject optional acquisition, conditioning and unhandled Result values', async () => {
  const producer = doc('control Producer { output value: Number; value <- 0; }');
  for (const declaration of [
    'input previous?: Number;',
    'input previous: Number { sample = 1ms; }',
    'input previous: Number { valid = 0 .. 10; }',
    'input previous: Number { filter = median(1); }',
    'input previous: Number { stale_after = 2ms; }',
    'input previous: Number { recover_after = 2 samples; }',
  ]) {
    const consumer = doc(`control Consumer { ${declaration} output value: Number; value <- previous |> recover(9); }`);
    const source = doc(`${pin('Producer', 'producer.ghost.md', producer)} ${pin('Consumer', 'consumer.ghost.md', consumer)}
      control Pipeline { instance producer: Producer; instance consumer: Consumer; connect consumer.previous <- producer.value; }`);
    await assert.rejects(() => compileSource(source, { filename: 'computed-options.ghost.md', sourceClosure: [
      { filename: 'producer.ghost.md', revision: 'input-v1', text: producer },
      { filename: 'consumer.ghost.md', revision: 'input-v1', text: consumer },
    ] }), /computed input.*cannot declare optional acquisition or conditioning options/);
  }
  const consumer = doc('control Consumer { input previous: Number; output value: Number; value <- previous; }');
  const source = doc(`${pin('Producer', 'producer.ghost.md', producer)} ${pin('Consumer', 'consumer.ghost.md', consumer)}
    control Pipeline { instance producer: Producer; instance consumer: Consumer; connect consumer.previous <- producer.value; }`);
  await assert.rejects(() => compileSource(source, { filename: 'computed-unhandled.ghost.md', sourceClosure: [
    { filename: 'producer.ghost.md', revision: 'input-v1', text: producer },
    { filename: 'consumer.ghost.md', revision: 'input-v1', text: consumer },
  ] }), /output.*must be Number|composition output expression type mismatch/);
  await assert.rejects(() => compileSource(doc('control Direct { input value: Number; output result: Number; connect result <- value; }'), { filename: 'unhandled-root.ghost.md', sourceClosure: [] }), /root output connect source must be an instance output/);
  await assert.rejects(() => compileSource(doc('control Direct { input value: Number; output result: Number; result <- value; }'), { filename: 'unhandled-root.ghost.md' }), /output result must be Number/);
  for (const [body, diagnostic] of [
    ['fn captured() -> Number { previous |> recover(9) } output value: Number; value <- captured();', /cannot capture global/],
    ['parameter captured: Number = previous |> recover(9); output value: Number; value <- captured;', /parameter default must be a constant/],
  ]) {
    const definition = doc(`control Consumer { input previous: Number; ${body} }`);
    const source = doc(`${pin('Producer', 'producer.ghost.md', producer)} ${pin('Consumer', 'consumer.ghost.md', definition)}
      control Pipeline { instance producer: Producer; instance consumer: Consumer; connect consumer.previous <- producer.value; }`);
    await assert.rejects(() => compileSource(source, { filename: 'computed-capture.ghost.md', sourceClosure: [
      { filename: 'producer.ghost.md', revision: 'input-v1', text: producer },
      { filename: 'consumer.ghost.md', revision: 'input-v1', text: definition },
    ] }), diagnostic);
  }
});

for (const [type, zero, nonzero] of [['Number', '0', '3'], ['Int', '0', '2147483647'], ['Pressure', '0bar', '3bar']]) {
  test(`issue 531 computed ${type} carries zero as an actual scalar without input samples`, async t => {
    const producer = doc(`control Producer { output value: ${type}; value <- ${zero}; }`);
    const consumer = doc(`control Consumer { input previous: ${type}; output zero: Bool;
      zero <- case previous { ok(value) => value == ${zero}; fault(_) => false; }; }`);
    const build = (definition = producer) => compileSource(doc(`${pin('Producer', 'producer.ghost.md', definition)} ${pin('Consumer', 'consumer.ghost.md', consumer)}
      control Pipeline { instance producer: Producer; instance consumer: Consumer; output zero: Bool;
        connect consumer.previous <- producer.value; connect zero <- consumer.zero; }`), {
      filename: 'computed-scalar.ghost.md', sourceClosure: [
        { filename: 'producer.ghost.md', revision: 'input-v1', text: definition },
        { filename: 'consumer.ghost.md', revision: 'input-v1', text: consumer },
      ],
    });
    for (const [definition, expected] of [[producer, true], [producer.replace(`value <- ${zero};`, `value <- ${nonzero};`), false]]) {
      const artifact = await build(definition);
      assert.deepEqual(artifact.manifest.sensors, []);
      assert.equal(Object.hasOwn(artifact.manifest, 'sensorInstances'), false);
      assert.deepEqual(artifact.manifest.inputs, []);
      const runtime = await ControlRuntime.instantiateFramed(wasm, artifact);
      try {
        const result = runtime.step({ nowMs: 0 });
        assert.equal(result.vm.safe.zero, expected);
        assert.deepEqual(result.vm.inputs, {});
        assert.ok(result.vm.resultTrace.every(event => event.choice === 0 && event.origin === 0));
      } finally { runtime.dispose(); }
    }
  });
}
