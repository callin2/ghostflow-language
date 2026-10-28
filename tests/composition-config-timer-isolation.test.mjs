import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/compile-source.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { observeRuntimeValues, observeSourceTrace } from '../tools/source-trace.mjs';
import { restoreArtifactSourceMap, writeArtifact } from '../tools/toolchain.mjs';
import { TemporarySettingsHost } from '../runtimes/wasm/temporary-settings-host.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { softwareQualityRails } from './helpers/software-quality-observations.mjs';
import { dailySlotsRange } from './helpers/range-source.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const document = code => `# Independent cells\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const cell = document(`control Cell {
  input start: Bool;
  config duration: Duration = 5s { min = 1s; max = 10s; step = 1s; access = operator; }
  state running: Bool = false;
  timer age = elapsed(running);
  running' = running || (start |> recover(false));
  output on: Bool;
  on <- running' && age < (duration |> recover(0s));
}`);
const revision = 'cell-r1';
const importLine = `import Cell from "./cell.ghost.md" revision "${revision}" sha256 "${sha256Hex(cell)}";`;
const source = document(`${importLine}
control Pair {
  input east_start, west_start: Bool;
  output east_on, west_on: Bool;
  instance east: Cell;
  instance west: Cell;
  connect east.start <- east_start;
  connect west.start <- west_start;
  connect east_on <- east.on;
  connect west_on <- west.on;
}`);
const closure = [{ filename: 'cell.ghost.md', revision, text: cell }];
const compile = (text = source, documents = closure, options = {}) => compileSource(text, {
  filename: 'pair.ghost.md', sourceClosure: documents, ...options,
});
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const context = { bootEpoch: 1, terminalCapacity: 16, bindings: [] };
const packet = (nowMs, id, east_start, west_start) => ({
  nowMs,
  samples: Object.fromEntries(Object.entries({ east_start, west_start }).map(([name, value]) => [name, {
    epoch: 1, id, timestampMs: nowMs, quality: 'Good', value,
  }])),
  contextFacts: {
    clock: { monotonicMs: nowMs, bootEpoch: 1, wallMs: 1_700_000_000_000 + nowMs,
      uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: 'cell-clock-r1' },
    natural: [], schedules: [], settings: null,
  },
});
const settingEvent = (host, eventId, actor, configId, value, kind = 'ordinary') => {
  const snapshot = host.snapshot();
  return { kind, eventId, actor, reason: 'change one cell duration',
    programFingerprint: snapshot.programFingerprint, sourceSha256: snapshot.sourceSha256,
    runId: snapshot.runId, baseRevision: snapshot.core.state.settingsRevision,
    changes: [{ configId, result: { ok: true, type: 'Duration', value } }],
    ...(kind === 'temporary' ? { lifetime: { kind: 'Run' } } : {}),
  };
};
const nativeInputs = (artifact, values, id, nowMs) => {
  const rails = softwareQualityRails(artifact, values, id, nowMs);
  for (const sensor of artifact.manifest.sensorInstances) {
    rails[sensor.valueInput] = values[sensor.sourceSensor];
    rails[sensor.okInput] = true;
    rails[sensor.faultInput] = 0;
  }
  return Object.entries(rails).map(([name, value]) => ({ name, value }));
};

test('REF-06-002 compiles two private config IDs and timers from one exact definition', async t => {
  const artifact = await compile();
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v10');
  assert.deepEqual(artifact.sourceClosure.instances.map(entry => entry.instance), ['east', 'west']);
  assert.deepEqual(artifact.manifest.configs.map(item => item.name),
    ['instance_4_east_duration', 'instance_4_west_duration']);
  assert.notEqual(artifact.manifest.configs[0].id, artifact.manifest.configs[1].id);
  assert.deepEqual(artifact.manifest.configs.map(item => artifact.sourceMap.find(node => node.id === item.id)?.instance),
    ['east', 'west']);
  assert.deepEqual(artifact.manifest.timers.map(item => [item.name, item.state]), [
    ['instance_4_east_age', 'instance_4_east_running'],
    ['instance_4_west_age', 'instance_4_west_running'],
  ]);
  for (const kind of ['config', 'timer']) {
    const nodes = artifact.sourceMap.filter(node => node.kind === kind);
    assert.deepEqual(nodes.map(node => [node.instance, node.filename]),
      [['east', 'cell.ghost.md'], ['west', 'cell.ghost.md']]);
    assert.equal(nodes[0].definitionNodeId, nodes[1].definitionNodeId);
    assert.notEqual(nodes[0].id, nodes[1].id);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'composed-cell-artifact-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'pair.gfb');
  writeArtifact(artifact, modulePath);
  const restored = restoreArtifactSourceMap(JSON.parse(fs.readFileSync(`${modulePath}.map.json`)), artifact.bytes, {
    manifest: artifact.manifest,
  });
  assert.deepEqual(restored.sourceClosure, artifact.sourceClosure);
  assert.deepEqual(restored.sourceMap, artifact.sourceMap);
});

test('REF-06-002 live east setting and state change leave west setting and timer independent on native and WASM', async t => {
  const artifact = await compile();
  const [eastId, westId] = artifact.manifest.configs.map(item => item.id);
  const host = await TemporarySettingsHost.instantiate(wasm, artifact, {
    runId: 'pair-run-1', grants: { east: [eastId], west: [westId] }, context,
  });
  t.after(() => host.dispose());
  const steps = [];
  const step = (nowMs, id, east, west, event = null) => {
    const frame = packet(nowMs, id, east, west);
    const result = host.step(frame, event);
    assert.equal(result.accepted, true);
    steps.push({ frame, result, values: { east_start: east, west_start: west } });
    return result;
  };
  step(0, 1, true, false);
  step(1000, 2, false, true);
  const before = host.snapshot();
  assert.throws(() => host.step(packet(2000, 3, false, false),
    settingEvent(host, 'cross-target', 'east', westId, 1000)), /setting permission/);
  assert.deepEqual(host.snapshot(), before);
  assert.throws(() => host.step(packet(2000, 3, false, false),
    settingEvent(host, 'invalid-duration', 'east', eastId, 11000, 'temporary')), /setting range/);
  assert.deepEqual(host.snapshot(), before);
  const changed = step(2000, 3, false, false,
    settingEvent(host, 'east-one-second', 'east', eastId, 1000));
  step(3000, 4, false, false);
  assert.deepEqual(steps.map(item => item.result.outcome.vm.safe), [
    { east_on: true, west_on: false },
    { east_on: true, west_on: true },
    { east_on: false, west_on: true },
    { east_on: false, west_on: true },
  ]);
  assert.deepEqual(steps.map(item => [
    item.result.outcome.vm.stateAfter.instance_4_east_running,
    item.result.outcome.vm.stateAfter.instance_4_west_running,
  ]), [[true, false], [true, true], [true, true], [true, true]]);
  assert.equal(changed.snapshot.core.state.settingsRevision, 1);
  const [east, west] = changed.snapshot.core.state.settings;
  assert.deepEqual([east.id, east.result.value, east.emissionRevision, west.id, west.result.value, west.emissionRevision],
    [eastId, 1000, 1, westId, 5000, 0]);
  const timers = steps.map(item => observeRuntimeValues(artifact.traceMetadata, item.result.outcome.vm).values
    .filter(value => value.kind === 'timer').map(value => [value.name, value.value]));
  assert.deepEqual(timers[1], [['instance_4_east_age', 1000], ['instance_4_west_age', 0]]);
  assert.deepEqual(timers[2], [['instance_4_east_age', 2000], ['instance_4_west_age', 1000]]);
  const timerNodes = artifact.sourceMap.filter(node => node.kind === 'timer');
  const observed = observeSourceTrace(artifact.traceMetadata, changed.outcome.vm);
  for (const node of timerNodes) {
    const bindings = observed.bindings.filter(binding => binding.nodeId === node.id);
    assert.equal(bindings.length, 2);
    assert.ok(bindings.every(binding => binding.source.filename === 'cell.ghost.md'));
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'composed-cell-native-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'pair.gfb');
  const tapePath = path.join(directory, 'tape.json');
  fs.writeFileSync(modulePath, artifact.bytes);
  fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-v1', activation: context,
    steps: steps.map(({ frame, result, values }) => ({
      scanId: result.outcome.frame.scanId, logicalTimeMs: frame.nowMs,
      inputs: nativeInputs(artifact, values, frame.samples.east_start.id, frame.nowMs),
      ...frame.contextFacts, settings: result.coreEvent,
    })),
  }));
  const runner = path.join(root, 'target/release/examples/context_tape');
  const run = () => execFileSync(runner, [modulePath, tapePath], { encoding: 'utf8', timeout: 10000 })
    .trim().split('\n').map(JSON.parse);
  const native = run();
  assert.deepEqual(run(), native);
  assert.equal(native.length, steps.length);
  for (const [index, row] of native.entries()) {
    assert.equal(row.accepted, true, JSON.stringify(row));
    assert.deepEqual(row.outcome.trace, steps[index].result.outcome.vm);
    assert.deepEqual(row.settings, steps[index].result.snapshot.core.state);
  }
});

test('REF-06-002 rejects broken closure and unsupported composed interaction descriptors', async () => {
  await assert.rejects(() => compile(source, [{ ...closure[0], revision: 'wrong' }]), /import revision mismatch/);
  await assert.rejects(() => compile(source, [{ ...closure[0], text: `${cell}tampered` }]), /digest mismatch/);
  await assert.rejects(() => compile(source, closure, {
    interactionSourceIdentity: { documentId: 'pair', revisionId: 'pair-r1' },
  }), /interaction schema does not support imported behavior instances/);
  const rewired = structuredClone(await compile());
  rewired.manifest.sensorInstances[0].sourceSensor = 'west_start';
  await assert.rejects(() => TemporarySettingsHost.instantiate(wasm, rewired, {
    runId: 'rewired-run', grants: {}, context,
  }), /source\/manifest identity/);
});

test('direct framed activation pins composed sensor routing to the source closure', async t => {
  const artifact = await compile();
  const honest = await ControlRuntime.instantiateFramed(wasm, artifact, { context });
  t.after(() => honest.dispose());
  assert.deepEqual(honest.step(packet(0, 1, true, false)).vm.safe,
    { east_on: true, west_on: false });
  const rewired = structuredClone(artifact);
  rewired.manifest.sensorInstances[0].sourceSensor = 'west_start';
  assert.equal(sha256Hex(rewired.bytes), artifact.manifest.bytecodeSha256);
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasm, rewired, { context }),
    /composition manifest does not match canonical source/);
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasm, {
    bytes: artifact.bytes, manifest: artifact.manifest,
  }, { context }), /context source-bound activation requires.*source document/);
  const stripped = structuredClone(artifact.manifest);
  delete stripped.sensorInstances;
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasm, {
    bytes: artifact.bytes, manifest: stripped,
  }, { context }), /context source-bound activation requires.*source document/);
  stripped.format = 'GhostFlow/control-v1';
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasm, {
    bytes: artifact.bytes, manifest: stripped,
  }, { context }), /manifest|context source-bound activation requires/);
  delete stripped.format;
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasm, {
    bytes: artifact.bytes, manifest: stripped,
  }, { context }), /manifest|format|context source-bound activation requires/);
});

test('standalone control-v10/GFB12 Range also requires exact source at direct activation', async () => {
  const artifact = await compileSource(dailySlotsRange({ selected: '[08:00]', duration: '10min' }),
    { filename: 'standalone-range.ghost.md' });
  assert.equal(new DataView(artifact.bytes.buffer, artifact.bytes.byteOffset).getUint16(4, true), 12);
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v10');
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasm,
    { bytes: artifact.bytes, manifest: artifact.manifest }, { context }),
  /context source-bound activation requires.*source document/);
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context });
  runtime.dispose();
});

test('composed context settings reject unsupported conditioned instance inputs before activation', async () => {
  const filtered = document(`control Filtered {
    input reading: Number { sample = 1s; filter = median(3); }
    config threshold: Number = 2 { min = 0; max = 10; step = 1; access = operator; }
    output high: Bool;
    high <- case reading { ok(value) => value > (threshold |> recover(0)); fault(_) => false; };
  }`);
  const composition = document(`import Filtered from "./filtered.ghost.md" revision "r1" sha256 "${sha256Hex(filtered)}";
    control Pair {
      input reading: Number { sample = 1s; }
      output high: Bool;
      instance east: Filtered;
      connect east.reading <- reading;
      connect high <- east.high;
    }`);
  const artifact = await compile(composition, [{ filename: 'filtered.ghost.md', revision: 'r1', text: filtered }]);
  await assert.rejects(() => TemporarySettingsHost.instantiate(wasm, artifact, {
    runId: 'filtered-run', grants: {}, context,
  }), /context PID sensor filtering is not supported/);
});
