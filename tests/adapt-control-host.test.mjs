import { softwareQualityAbi, softwareQualityObservations } from './helpers/software-quality-observations.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const cases = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url)));
const reference = (Array.isArray(cases) ? cases : cases.cases).find(item => item.id === 'REF-04-035');
assert.ok(reference, 'canonical capability-strategies source must remain available');
const legacyBytes = fs.readFileSync(new URL('./fixtures/history/issue531/adapt-control-host.pre-input.json', import.meta.url));
assert.equal(createHash('sha256').update(legacyBytes).digest('hex'), '2b949df2e75d2fb6adde1155e7985868c2fd013dba6dbd69b45dae79f740c1d5');
const legacy = JSON.parse(legacyBytes);
assert.equal(legacy.source, reference.source, 'original reference source remains byte-identical');
assert.equal(createHash('sha256').update(legacy.source).digest('hex'), legacy.sourceSha256);
const activeSource = "# Capability strategies input revision\n\n```ghost\ncontrol CapabilityStrategies {\n input moisture?: Percent;\n input scheduled: Bool;\n let scheduled_value = scheduled |> recover(false);\n output pump: Bool;\n adapt irrigation_policy {\n  strategy WithMoisture priority 100 match (moisture: sensor<Percent>) {\n   let request = case moisture { ok(value) => scheduled_value && value < 30%; fault(_) => false; };\n   pump <- request;\n  }\n  strategy Baseline priority 0 match always { pump <- scheduled_value; }\n }\n}\n```\n";
const artifact = await compileSource(activeSource, { filename: 'capability-strategies-input-v2.ghost.md' });

test('REF-04-036: duplicate actuator keys reject and comma-AND requires both pump and valve in actual host activation', async t => {
  const original = (Array.isArray(cases) ? cases : cases.cases).find(item => item.id === 'REF-04-036');
  assert.ok(original, 'original host Reference case must remain available');
  assert.equal(original.status, 'specified');
  assert.equal(original.scope, 'host');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/241');
  const source = `# Actuator profile AND

\`\`\`ghost
control ProfileAND {
  input scheduled: Bool;
  output pump, valve: Bool;
  adapt policy {
    strategy Both priority 10 match (pump: actuator<Bool>, valve: actuator<Bool>) {
      pump <- scheduled |> recover(false);
      valve <- scheduled |> recover(false);
    }
  }
}
\`\`\`
`;
  const compiled = await compileSource(source, { filename: 'actuator-profile-and.ghost.md' });
  // Inspect the accepted candidate's small GFB1 query, because both output
  // bindings also require presence and must not mask an OR in comma lowering.
  const bytes = Buffer.from(compiled.bytes);
  let at = 6;
  const text = () => { const size = bytes.readUInt16LE(at); at += 2; const value = bytes.toString('utf8', at, at + size); at += size; return value; };
  assert.equal(bytes.readUInt16LE(4), 3);
  assert.equal(text(), 'ProfileAND'); at += 4; // Module flags.
  assert.equal(bytes.readUInt16LE(at), 3); at += 2;
  const railTypes = [];
  for (let index = 0; index < 3; index++) railTypes.push([text(), bytes[at++]]);
  assert.deepEqual(railTypes, [[compiled.manifest.sensors[0].valueInput, 1], [compiled.manifest.sensors[0].okInput, 1], [compiled.manifest.sensors[0].faultInput, 2]]);
  assert.equal(bytes.readUInt16LE(at), 0); at += 2; // No state.
  assert.equal(bytes.readUInt16LE(at), 1); at += 2;
  assert.equal(text(), 'Both'); at += 4; // Priority.
  const queryEnd = at + 4 + bytes.readUInt32LE(at); at += 4;
  const query = [];
  while (at < queryEnd) {
    const opcode = bytes[at++];
    if (opcode === 1) query.push({ kind: text(), name: text(), type: bytes[at++] });
    else {
      assert.equal(opcode, 2, 'the capability query combines requirements with AND, never OR');
      const arity = bytes.readUInt16LE(at); at += 2;
      assert.ok(arity > 0 && arity <= query.length);
      query.push({ all: query.splice(query.length - arity, arity) });
    }
  }
  assert.equal(at, queryEnd);
  assert.equal(query.length, 1);
  assert.ok(Array.isArray(query[0].all));
  // Repeated output/match predicates are equivalent; the semantic requirement
  // is the conjunction of these actuator keys, not their encoding count.
  assert.deepEqual([...new Set(query[0].all.map(cap => `${cap.kind}:${cap.name}:${cap.type}`))].sort(),
    ['actuator:pump:1', 'actuator:valve:1']);
  const hash = value => createHash('sha256').update(value).digest('hex');
  const wire = value => JSON.parse(JSON.stringify(value));
  const identity = { sourceSha256: hash(source), bytecodeSha256: hash(compiled.bytes),
    manifestSha256: hash(JSON.stringify(compiled.manifest)), module: compiled.traceMetadata.moduleFingerprint };
  assert.equal(identity.bytecodeSha256, compiled.manifest.bytecodeSha256);
  const pump = { kind: 'actuator', name: 'pump', type: 'bool' };
  const valve = { kind: 'actuator', name: 'valve', type: 'bool' };
  const profiles = [
    { capabilities: [pump, pump], error: /duplicate capability/ },
    { capabilities: [pump, { ...pump, type: 'number' }], error: /duplicate capability/ },
    { capabilities: [pump], error: /no device strategy matches capabilities/ },
    { capabilities: [valve], error: /no device strategy matches capabilities/ },
    { capabilities: [pump, { ...valve, type: 'number' }], error: /no device strategy matches capabilities/ },
    { capabilities: [pump, valve] },
  ];
  const captures = [];
  for (const Owner of [GhostFlowRuntime, FramedGhostFlowRuntime]) {
    const records = [];
    for (const { capabilities, error } of profiles) {
      const runtime = await Owner.instantiate(wasm);
      t.after(() => runtime.dispose());
      runtime.load(compiled.bytes);
      softwareQualityAbi(runtime, compiled);
      const activation = wire({ capabilities, sha256: hash(JSON.stringify(capabilities)) });
      const activate = () => {
        for (const cap of activation.capabilities) runtime.addCapability(cap.kind, cap.name, cap.type);
        runtime.activate();
      };
      if (error) {
        let rejected;
        assert.throws(activate, cause => { rejected = cause.message; return error.test(rejected); });
        if (Owner === FramedGhostFlowRuntime) assert.equal(runtime.outcome, null, 'rejected profile publishes no scan');
        else assert.equal(runtime.journalLength, 0, 'rejected profile commits no tick');
        records.push({ identity, activation, rejected });
        continue;
      }
      activate();
      const traces = [];
      for (const [scanId, scheduled] of [true, false].entries()) {
        const snapshot = { scanId, logicalTimeMs: scanId, inputs: [{ name: 'scheduled', value: scheduled }] };
        let trace;
        if (Owner === FramedGhostFlowRuntime) trace = runtime.scan(snapshot).trace;
        else { runtime.setBool('scheduled', scheduled); runtime.tickAt(scanId); trace = runtime.trace; }
        assert.equal(trace.module, identity.module);
        assert.equal(trace.strategy, 'Both');
        assert.equal(trace.inputs[compiled.manifest.sensors.find(sensor => sensor.name === 'scheduled').valueInput], scheduled);
        assert.deepEqual(trace.requested, { pump: scheduled, valve: scheduled });
        assert.deepEqual(trace.safe, trace.requested);
        traces.push(wire({ snapshot, trace }));
      }
      records.push({ identity, activation, traces });
    }
    captures.push(records);
  }
  assert.deepEqual(captures[0], captures[1], 'plain and framed Rust owners agree on captured profile admission and execution');
});

test('REF-04-035 explicit absent sensor selects Baseline', async () => {
  const host = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: [] });
  softwareQualityObservations(host);
  try {
    assert.equal(host.step({ nowMs: 0, inputs: { scheduled: true } }).vm.requested.pump, true);
    assert.equal(host.step({ nowMs: 1, inputs: { scheduled: false } }).vm.requested.pump, false);
  } finally { host.dispose(); }
});

const moisture = { kind: 'sensor', name: 'moisture', type: 'Percent' };
const sample = (id, quality, value) => ({ epoch: 1, id, timestampMs: id, quality, value });

test('REF-04-035 present sensor uses moisture strategy and faults never select Baseline', async () => {
  const host = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: [moisture] });
  softwareQualityObservations(host);
  try {
    const step = (nowMs, samples = {}) => host.step({ nowMs, inputs: { scheduled: true }, samples }).vm.requested.pump;
    assert.equal(step(0), false, 'present sensor without sample is NotReady, not Baseline');
    assert.equal(step(1, { moisture: sample(1, 'Good', 20) }), true);
    assert.equal(step(2, { moisture: sample(2, 'Good', 40) }), false);
    assert.equal(step(3, { moisture: sample(3, 'Disconnected', 20) }), false);
  } finally { host.dispose(); }
});

test('absent optional capability rejects samples instead of inventing presence', async () => {
  const host = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: [] });
  softwareQualityObservations(host);
  try {
    assert.throws(() => host.step({ nowMs: 1, inputs: { scheduled: true }, samples: { moisture: sample(1, 'Good', 20) } }), /absent sensor capability moisture/);
  } finally { host.dispose(); }
});

test('REF-04-034: activated absence and installed Disconnected retain profile identity and selected strategy in actual host snapshots', async t => {
  const original = (Array.isArray(cases) ? cases : cases.cases).find(item => item.id === 'REF-04-034');
  assert.ok(original, 'original host Reference case must remain available');
  assert.equal(original.status, 'specified');
  assert.equal(original.scope, 'host');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/240');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const wire = value => JSON.parse(JSON.stringify(value));
  const identity = {
    sourceSha256: hash(activeSource),
    bytecodeSha256: hash(artifact.bytes),
    manifestSha256: hash(JSON.stringify(artifact.manifest)),
    module: artifact.traceMetadata.moduleFingerprint,
  };
  assert.equal(identity.bytecodeSha256, artifact.manifest.bytecodeSha256);
  const sensorOrigin = artifact.sourceMap.find(node => node.kind === 'sensor')?.id;
  assert.ok(Number.isInteger(sensorOrigin), 'fault Result must retain canonical sensor origin');
  const profiles = { A: [], B: [moisture] };
  const captures = [];
  for (const instantiate of [ControlRuntime.instantiate, ControlRuntime.instantiateFramed]) {
    const callerA = wire(profiles.A);
    const callerB = wire(profiles.B);
    const absent = await instantiate(wasm, artifact, { capabilities: callerA });
    const installed = await instantiate(wasm, artifact, { capabilities: callerB });
    softwareQualityObservations(absent); softwareQualityObservations(installed);
    t.after(() => { absent.dispose(); installed.dispose(); });
    // Installation facts are captured at activation, not reread from a mutable
    // caller array or inferred from each scan's sensor quality.
    callerA.push(wire(moisture));
    callerB.length = 0;
    const capture = (host, profile, snapshot) => wire({
      identity,
      activation: { capabilities: profiles[profile], sha256: hash(JSON.stringify(profiles[profile])) },
      snapshot,
      outcome: host.step(snapshot),
    });
    const missing = capture(absent, 'A', { nowMs: 1, inputs: { scheduled: true } });
    const disconnected = capture(installed, 'B', {
      nowMs: 1, inputs: { scheduled: true }, samples: { moisture: sample(1, 'Disconnected', 20) },
    });
    const recovered = capture(installed, 'B', {
      nowMs: 2, inputs: { scheduled: true }, samples: { moisture: sample(2, 'Good', 20) },
    });
    const faultAgain = capture(installed, 'B', {
      nowMs: 3, inputs: { scheduled: true }, samples: { moisture: sample(3, 'Disconnected', 20) },
    });
    for (const record of [missing, disconnected, recovered, faultAgain]) {
      assert.deepEqual(record.identity, identity);
      assert.equal(record.outcome.vm.module, identity.module);
      assert.equal(record.outcome.vm.inputs[artifact.manifest.sensors.find(sensor => sensor.name === 'scheduled').valueInput], record.snapshot.inputs.scheduled);
      assert.equal(record.activation.sha256, hash(JSON.stringify(record.activation.capabilities)));
    }
    assert.notEqual(missing.activation.sha256, disconnected.activation.sha256);
    assert.deepEqual(missing.activation.capabilities, []);
    assert.equal(missing.outcome.vm.strategy, 'Baseline');
    assert.deepEqual(missing.outcome.vm.requested, { pump: true });
    assert.ok(missing.outcome.vm.resultTrace.every(entry => entry.choice === 0), 'healthy scheduled projection is not an optional moisture fault');
    for (const record of [disconnected, faultAgain]) {
      assert.deepEqual(record.activation.capabilities, [moisture]);
      assert.equal(record.snapshot.samples.moisture.quality, 'Disconnected');
      assert.equal(record.outcome.vm.strategy, 'WithMoisture');
      assert.deepEqual(record.outcome.sensors.moisture, { ok: false, value: 0, quality: 'Disconnected' });
      assert.deepEqual(record.outcome.vm.requested, { pump: false });
      assert.deepEqual(record.outcome.vm.safe, { pump: false });
      assert.deepEqual(record.outcome.vm.resultTrace.filter(entry => entry.origin === sensorOrigin).map(({ choice, origin }) => ({ choice, origin })),
        [{ choice: 1, origin: sensorOrigin }]);
    }
    assert.equal(recovered.outcome.vm.strategy, 'WithMoisture');
    assert.deepEqual(recovered.outcome.sensors.moisture, { ok: true, value: 20, quality: 'Good' });
    assert.deepEqual(recovered.outcome.vm.requested, { pump: true });
    assert.equal(recovered.outcome.vm.resultTrace.length, 2);
    assert.ok(recovered.outcome.vm.resultTrace.every(entry => entry.choice === 0 && entry.origin === 0));
    assert.throws(() => absent.step({ nowMs: 2, inputs: { scheduled: true },
      samples: { moisture: sample(2, 'Good', 20) } }), /absent sensor capability moisture/);
    const stillAbsent = capture(absent, 'A', { nowMs: 2, inputs: { scheduled: false } });
    assert.equal(stillAbsent.outcome.vm.strategy, 'Baseline');
    assert.deepEqual(stillAbsent.outcome.vm.requested, { pump: false });
    captures.push([missing, disconnected, recovered, faultAgain, stillAbsent].map(record => ({
      ...record, outcome: { vm: record.outcome.vm, sensors: record.outcome.sensors, signals: record.outcome.signals },
    })));
  }
  assert.deepEqual(captures[0], captures[1], 'plain and framed hosts execute identical captured inputs and traces');
});

test('REF-04-038: equal winning priorities reject both declaration orders in actual host activation', async t => {
  const original = (Array.isArray(cases) ? cases : cases.cases).find(item => item.id === 'REF-04-038');
  assert.ok(original, 'original strategy ambiguity Reference case must remain available');
  assert.equal(original.status, 'specified');
  assert.equal(original.scope, 'host');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/242');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const wire = value => JSON.parse(JSON.stringify(value));
  const strategies = {
    A: 'strategy A priority 10 match (pump: actuator<Bool>) { pump <- false; }',
    B: 'strategy B priority 10 match (pump: actuator<Bool>) { pump <- true; }',
    C: 'strategy C priority 11 match (pump: actuator<Bool>) { pump <- enabled |> recover(false); }',
  };
  const candidates = [];
  for (const order of ['AB', 'BA', 'ABC', 'CAB', 'BCA']) {
    const source = `# Unique winning strategy\n\n\`\`\`ghost\ncontrol PrioritySelection {\n  input enabled: Bool;\n  output pump: Bool;\n  adapt policy {\n    ${[...order].map(name => strategies[name]).join('\n    ')}\n  }\n}\n\`\`\`\n`;
    const compiled = await compileSource(source, { filename: `strategy-priority-${order}.ghost.md` });
    const identity = { sourceSha256: hash(source), bytecodeSha256: hash(compiled.bytes),
      manifestSha256: hash(JSON.stringify(compiled.manifest)), module: compiled.traceMetadata.moduleFingerprint };
    assert.equal(identity.bytecodeSha256, compiled.manifest.bytecodeSha256);
    candidates.push({ order, compiled, identity });
  }
  assert.notEqual(candidates[0].identity.sourceSha256, candidates[1].identity.sourceSha256);
  const captures = [];
  for (const Owner of [GhostFlowRuntime, FramedGhostFlowRuntime]) {
    const records = [];
    for (const { order, compiled, identity } of candidates) {
      for (const capabilities of [[], [{ kind: 'actuator', name: 'pump', type: 'bool' }]]) {
        const runtime = await Owner.instantiate(wasm);
        t.after(() => runtime.dispose());
        runtime.load(compiled.bytes);
      softwareQualityAbi(runtime, compiled);
        const activation = wire({ capabilities, sha256: hash(JSON.stringify(capabilities)) });
        for (const cap of activation.capabilities) runtime.addCapability(cap.kind, cap.name, cap.type);
        const snapshot = { scanId: 0, logicalTimeMs: 0, inputs: [{ name: 'enabled', value: true }] };
        const scan = () => {
          if (Owner === FramedGhostFlowRuntime) return runtime.scan(snapshot).trace;
          runtime.setBool('enabled', true); runtime.tickAt(0); return runtime.trace;
        };
        const expectedError = capabilities.length === 0 ? 'no device strategy matches capabilities'
          : order.includes('C') ? null : 'ambiguous winning device strategies';
        if (expectedError) {
          let rejected;
          assert.throws(() => runtime.activate(), cause => {
            rejected = cause.message; return rejected === expectedError;
          });
          // Loading or failed selection never grants an executable strategy.
          let scanRejected;
          assert.throws(scan, cause => {
            scanRejected = cause.message;
            return scanRejected === (Owner === FramedGhostFlowRuntime ? 'framed runtime is not active' : 'runtime is not active');
          });
          if (Owner === FramedGhostFlowRuntime) assert.equal(runtime.outcome, null);
          else assert.equal(runtime.journalLength, 0);
          records.push({ order, identity, activation, rejected, snapshot, scanRejected });
          continue;
        }
        runtime.activate();
        const traces = [];
        for (const [scanId, enabled] of [true, false].entries()) {
          let trace;
          const input = { scanId, logicalTimeMs: scanId, inputs: [{ name: 'enabled', value: enabled }] };
          if (Owner === FramedGhostFlowRuntime) trace = runtime.scan(input).trace;
          else { runtime.setBool('enabled', enabled); runtime.tickAt(scanId); trace = runtime.trace; }
          assert.equal(trace.module, identity.module);
          assert.equal(trace.strategy, 'C', 'a unique higher priority wins despite lower ties and declaration order');
          assert.equal(trace.inputs[compiled.manifest.sensors.find(sensor => sensor.name === 'enabled').valueInput], enabled);
          assert.deepEqual(trace.requested, { pump: enabled });
          assert.deepEqual(trace.safe, trace.requested);
          traces.push(wire({ snapshot: input, trace }));
        }
        records.push({ order, identity, activation, traces });
      }
    }
    captures.push(records);
  }
  const comparable = records => records.map(({ scanRejected, ...record }) => record);
  assert.deepEqual(comparable(captures[0]), comparable(captures[1]),
    'plain and framed owners agree on captured activation errors and selected execution');
});
