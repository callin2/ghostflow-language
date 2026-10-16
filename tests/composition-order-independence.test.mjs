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

const doc = code => `# REF-06-013 composition order\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const cell = doc(`control Cell {
  input trigger, stop: Bool;
  state held: Bool = false;
  state pulses: Int = 0;
  held' = !(stop |> recover(false)) && (held || (trigger |> recover(false)));
  pulses' = if (trigger |> recover(false)) && !held then pulses + 1 else pulses;
  output active, previous: Bool;
  output total: Int;
  active <- held';
  previous <- held;
  total <- pulses';
}`);
const follower = doc(`control Follower {
  input previous: Bool;
  state seen: Bool = false;
  seen' = previous |> recover(false);
  output active: Bool;
  active <- seen';
}`);
const pin = (alias, filename, text) => `import ${alias} from "./${filename}" revision "input-v1" sha256 "${sha256Hex(text)}";`;
const closure = [
  { filename: 'cell.ghost.md', revision: 'input-v1', text: cell },
  { filename: 'follower.ghost.md', revision: 'input-v1', text: follower },
];
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const nativePath = fileURLToPath(new URL('../target/release/examples/scan_tape' + (process.platform === 'win32' ? '.exe' : ''), import.meta.url));

async function compile(ordered, supplied = closure) {
  const source = doc(ordered);
  const artifact = await compileSource(source, { filename: 'order.ghost.md', sourceClosure: supplied });
  assert.equal(artifact.sourceDocument.text, source);
  assert.equal(artifact.sourceDocument.sha256, sha256Hex(source));
  for (const document of artifact.sourceClosure.documents) {
    const original = supplied.find(item => item.filename === document.filename);
    assert.ok(original);
    assert.equal(document.text, original.text);
    assert.equal(document.sha256, sha256Hex(original.text));
    assert.equal(document.revision, original.revision);
  }
  return artifact;
}

async function execute(artifact, snapshots) {
  const runtime = softwareQualityObservations(await ControlRuntime.instantiateFramed(wasm, artifact));
  const frames = [], outcomes = [], dispatch = runtime.runtime.dispatch.bind(runtime.runtime);
  runtime.runtime.dispatch = frame => {
    frames.push(structuredClone(frame));
    dispatch(frame);
    outcomes.push(structuredClone(runtime.runtime.outcome));
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-composition-order-'));
  try {
    snapshots.forEach((inputs, nowMs) => runtime.step({ nowMs, inputs }));
    const modulePath = path.join(directory, 'order.gfb'), tapePath = path.join(directory, 'frames.tsv');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(tapePath, frames.map(frame => [frame.scanId, frame.logicalTimeMs,
      ...frame.inputs.flatMap(input => [input.name, input.type === 'Bool' ? 'b' : 'n', input.value])].join('\t')).join('\n') + '\n');
    const native = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(native.status, 0, native.error?.message ?? native.stderr);
    const rows = native.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, snapshots.length, 'each supplied snapshot requires a native receipt');
    assert.ok(rows.every(row => row.accepted));
    assert.deepEqual(rows.map(row => row.outcome), outcomes, 'complete native/WASM framed outcomes for this exact artifact');
    return outcomes.map(outcome => {
      const observed = observeSourceTrace(artifact.traceMetadata, outcome.trace);
      const before = {}, after = {};
      for (const binding of artifact.traceMetadata.bindings.filter(binding => binding.kind === 'state')) {
        const node = artifact.sourceMap.find(node => node.id === binding.nodeId);
        assert.ok(node?.instance, 'every private state retains its owning instance');
        const local = ['held', 'pulses', 'seen'].find(name => binding.name.endsWith(`_${name}`));
        assert.ok(local, `unexpected private state ${binding.name}`);
        const value = observed.bindings.find(item => item.nodeId === binding.nodeId);
        for (const [field, target] of [['stateBefore', before], ['stateAfter', after]]) {
          const observation = value.observations.find(item => item.field === field);
          assert.ok(observation, `${node.instance}.${local} has ${field} evidence`);
          target[`${node.instance}.${local}`] = observation.value;
        }
      }
      return { before, after, requested: outcome.trace.requested, safe: outcome.trace.safe };
    });
  } finally {
    runtime.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('REF-06-013 reversing instance and connection declarations preserves private state and requested safe outputs on native and WASM', async () => {
  const declarations = ['instance east: Cell;', 'instance west: Cell;'];
  const connections = [
    'connect east.trigger <- east_trigger;', 'connect west.trigger <- west_trigger;',
    'connect east.stop <- east_stop;', 'connect west.stop <- west_stop;',
    'connect east_on <- east.active;', 'connect west_on <- west.active;',
    'connect east_count <- east.total;', 'connect west_count <- west.total;',
  ];
  const snapshots = [
    [false, false, false, false], [true, false, false, false],
    [false, true, false, false], [true, false, true, false], [true, false, false, true],
  ].map(([east_trigger, west_trigger, east_stop, west_stop]) => ({ east_trigger, west_trigger, east_stop, west_stop }));
  let baseline;
  for (const reversed of [false, true]) {
    const ordered = `${pin('Cell', 'cell.ghost.md', cell)}\ncontrol Pair {
      input east_trigger, west_trigger, east_stop, west_stop: Bool;
      output east_on, west_on: Bool;
      output east_count, west_count: Int;
      ${(reversed ? [...declarations].reverse() : declarations).join('\n')}
      ${(reversed ? [...connections].reverse() : connections).join('\n')}
    }`;
    const observations = await execute(await compile(ordered), snapshots);
    assert.deepEqual(observations.map(row => row.after), [
      { 'east.held': false, 'east.pulses': 0, 'west.held': false, 'west.pulses': 0 },
      { 'east.held': true, 'east.pulses': 1, 'west.held': false, 'west.pulses': 0 },
      { 'east.held': true, 'east.pulses': 1, 'west.held': true, 'west.pulses': 1 },
      { 'east.held': false, 'east.pulses': 1, 'west.held': true, 'west.pulses': 1 },
      { 'east.held': true, 'east.pulses': 2, 'west.held': false, 'west.pulses': 1 },
    ]);
    assert.deepEqual(observations.map(row => row.requested), [
      { east_on: false, west_on: false, east_count: 0, west_count: 0 },
      { east_on: true, west_on: false, east_count: 1, west_count: 0 },
      { east_on: true, west_on: true, east_count: 1, west_count: 1 },
      { east_on: false, west_on: true, east_count: 1, west_count: 1 },
      { east_on: true, west_on: false, east_count: 2, west_count: 1 },
    ]);
    assert.deepEqual(observations.map(row => row.safe), observations.map(row => row.requested));
    if (baseline) assert.deepEqual(observations, baseline, 'identity-keyed previous/next state and output results do not depend on declaration order');
    baseline = observations;
  }
});

test('REF-06-013 reversed import closure and dependency traversal preserve previous-snapshot cross-instance reads on native and WASM', async () => {
  const imports = [pin('Cell', 'cell.ghost.md', cell), pin('Follower', 'follower.ghost.md', follower)];
  const declarations = ['instance producer: Cell;', 'instance consumer: Follower;'];
  const connections = ['connect producer.trigger <- trigger;', 'connect producer.stop <- stop;',
    'connect consumer.previous <- producer.previous;', 'connect producer_on <- producer.active;', 'connect consumer_on <- consumer.active;'];
  const snapshots = [{ trigger: true, stop: false }, { trigger: false, stop: false },
    { trigger: false, stop: true }, { trigger: false, stop: false }];
  let baseline;
  for (const reversed of [false, true]) {
    const ordered = `${(reversed ? [...imports].reverse() : imports).join('\n')}\ncontrol Pipeline {
      input trigger, stop: Bool;
      output producer_on, consumer_on: Bool;
      ${(reversed ? [...declarations].reverse() : declarations).join('\n')}
      ${(reversed ? [...connections].reverse() : connections).join('\n')}
    }`;
    const artifact = await compile(ordered, reversed ? [...closure].reverse() : closure);
    const observations = await execute(artifact, snapshots);
    assert.deepEqual(observations.map(row => row.after['consumer.seen']), [false, true, true, false], 'consumer reads producer committed old state, regardless of lexical/traversal order');
    assert.deepEqual(observations.map(row => row.requested), [
      { producer_on: true, consumer_on: false }, { producer_on: true, consumer_on: true },
      { producer_on: false, consumer_on: true }, { producer_on: false, consumer_on: false },
    ]);
    assert.deepEqual(observations.map(row => row.safe), observations.map(row => row.requested));
    if (baseline) assert.deepEqual(observations, baseline);
    baseline = observations;
  }
});

test('REF-06-013 declaration order cannot authorize combinational cycles or transitive same-tick next-state reads', async () => {
  const wire = doc('control Wire { input start: Bool; output result: Bool; result <- start |> recover(false); }');
  for (const reversed of [false, true]) {
    const declarations = ['instance east: Wire;', 'instance west: Wire;'];
    const connections = ['connect east.start <- west.result;', 'connect west.start <- east.result;'];
    const source = doc(`${pin('Wire', 'wire.ghost.md', wire)}\ncontrol Cycle {
      ${(reversed ? [...declarations].reverse() : declarations).join('\n')}
      ${(reversed ? [...connections].reverse() : connections).join('\n')}
    }`);
    await assert.rejects(() => compileSource(source, { filename: 'cycle.ghost.md',
      sourceClosure: [{ filename: 'wire.ghost.md', revision: 'input-v1', text: wire }] }), /combinational port cycle/);
    const invalid = doc(`${pin('Cell', 'cell.ghost.md', cell)}\n${pin('Follower', 'follower.ghost.md', follower)}\ncontrol NextRead {
      input trigger, stop: Bool;
      ${(reversed ? ['instance consumer: Follower;', 'instance producer: Cell;'] : ['instance producer: Cell;', 'instance consumer: Follower;']).join('\n')}
      connect producer.trigger <- trigger;
      connect producer.stop <- stop;
      connect consumer.previous <- producer.active;
    }`);
    await assert.rejects(() => compileSource(invalid, { filename: 'next-read.ghost.md', sourceClosure: reversed ? [...closure].reverse() : closure }), /next state|next-state/);
  }
});
