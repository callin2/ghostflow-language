import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { buildPortablePackage, verifyPortablePackage } from '../tools/portable-package.mjs';
import { runScenario } from '../tools/ghostsim.mjs';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { atSource } from './helpers/at-source.mjs';

const DAY = 86_400_000;
const planned = Date.UTC(2026, 0, 1, 8);
const activation = { bootEpoch: 1, terminalCapacity: 16, bindings: [] };
const source = atSource({
  declarations: 'input allow: Bool; input cancel: Bool;',
  output: 'output active: Bool; output missed: Bool; alarm <- appointment.due; active <- appointment.PROJECTION; missed <- appointment.missed;',
})
  .replace('appointment: At', 'appointment: Daily')
  .replace(/at = datetime[^;]+;/, 'timezone = "UTC"; at = time`08:00`; dst_missing = skip; dst_repeated = first;');

async function parity(policy, projection, steps, expected, weekdays = false) {
  const input = weekdays ? source.replace('dst_missing', 'on day`mon..fri`; dst_missing') : source;
  const artifact = await compileSource(input.replace('basis = pulse;', policy).replace('PROJECTION', projection),
    { filename: 'daily-window-run.ghost.md' });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v28');
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-daily-'));
  try {
    const frames = steps.map(([mono, delta, allow, cancel = false], scanId) => {
      const inputs = artifact.manifest.sensors.flatMap(sensor => [
        { name: sensor.valueInput, type: 'Bool', value: sensor.name === 'allow' ? allow : cancel },
        { name: sensor.okInput, type: 'Bool', value: true },
        { name: sensor.faultInput, type: 'Number', value: 0 },
      ]);
      const clock = { monotonicMs: mono, bootEpoch: 1, wallMs: delta === null ? null : planned + delta,
        uncertaintyMs: 0, trusted: delta !== null, unknownReason: delta === null ? 'ClockUnknown' : null,
        sourceRevision: 'utc-test' };
      return { scanId, logicalTimeMs: mono, inputs, clock, natural: [], schedules: [], settings: null };
    });
    const artifactPath = path.join(dir, 'daily.gfb');
    writeArtifact(artifact, artifactPath);
    const tapePath = path.join(dir, 'tape.json');
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-periodic-v1', activation, steps: frames }));
    const exe = new URL('../target/release/examples/context_tape', import.meta.url);
    const native = spawnSync(exe.pathname, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10000 });
    assert.equal(native.status, 0, native.stderr || native.error?.message);
    const rows = native.stdout.trim().split('\n').map(JSON.parse);
    const scenarioPath = path.join(dir, 'scenario.toon');
    const actions = frames.flatMap((frame, i) => {
      const [mono, , allow, cancel = false] = steps[i];
      return [
        ...Object.entries({ allow, cancel }).map(([name, value]) => ({
          kind: 'sample', name, epoch: 1, id: i + 1, timestampMs: mono, quality: 'Good', value,
        })),
        { kind: 'scan', atMs: mono, contextFacts: { clock: frame.clock, natural: [], schedules: [], settings: null } },
      ];
    });
    fs.writeFileSync(scenarioPath, encode({ format: 'GhostFlow/scenario-v1', id: 'daily-parity',
      initialInputs: [], keyBindings: [], context: activation, actions }));
    const simulation = runScenario(artifactPath, scenarioPath, { format: 'json' });
    assert.equal(simulation.success, true, simulation.encoded);
    assert.deepEqual(JSON.parse(simulation.encoded).scans.map(s => [
      s.safeVirtualIntent.alarm, s.safeVirtualIntent.active, s.safeVirtualIntent.missed,
    ]), expected);
    const traces = frames.map((frame, i) => {
      const [mono, , allow, cancel = false] = steps[i];
      const samples = Object.fromEntries(Object.entries({ allow, cancel }).map(([name, value]) =>
        [name, { epoch: 1, id: i + 1, timestampMs: mono, quality: 'Good', value }]));
      const contextFacts = { clock: frame.clock, natural: [], schedules: [], settings: null };
      if (i === 1) {
        const site = artifact.manifest.schedules[0].site;
        assert.throws(() => runtime.step({ nowMs: mono, samples, contextFacts: {
          ...contextFacts, schedules: [{
            site, coverageStartMs: 0, coverageEndMs: 253_402_300_799_999,
            provider: null, calendar: null, rows: [],
          }],
        } }), /context facts do not match installed requirements/);
      }
      return runtime.step({ nowMs: mono, samples, contextFacts }).vm;
    });
    assert.deepEqual(traces.map(t => [t.safe.alarm, t.safe.active, t.safe.missed]), expected);
    rows.forEach((row, i) => {
      assert.equal(row.accepted, true);
      assert.deepEqual(row.outcome.trace, traces[i]);
    });
  } finally {
    runtime.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Daily Window follows predicate and admits only once per occurrence', async () => {
  await parity('basis = window(10ms);', 'open', [
    [0, -1, true], [1, 0, false], [2, 1, true], [3, 2, false], [4, 3, true],
    [11, 10, true], [DAY, DAY - 1, true], [DAY + 1, DAY, true],
  ], [
    [false,false,false], [false,false,false], [true,true,false], [false,false,false], [false,true,false],
    [false,false,false], [false,false,false], [true,true,false],
  ]);
});

test('Daily Run ends on monotonic deadline or cancellation and never rearms', async () => {
  await parity('basis = run(10ms, on_time); cancel_when = (cancel |> recover(false));', 'active', [
    [0, -1, true], [1, 0, true], [2, null, true], [3, 5, false], [11, 12, true],
    [DAY, DAY - 1, true], [DAY + 1, DAY, true], [DAY + 2, DAY + 1, true, true],
    [DAY + 3, DAY + 2, true],
  ], [
    [false,false,false], [true,true,false], [false,true,false], [false,true,false], [false,false,false],
    [false,false,false], [true,true,false], [false,false,false], [false,false,false],
  ]);
});

test('Daily Window cannot admit after a gap or unknown clock in the occurrence', async () => {
  await parity('basis = window(10ms);', 'open', [
    [0, -1, true], [60_001, 1, true], [60_002, 2, true], [60_003, null, true],
    [60_004, 4, true], [60_005, 5, true],
  ], [
    [false,false,false], [false,false,true], [false,true,false], [false,false,false],
    [false,false,false], [false,true,false],
  ]);
});

test('signed GFB28 selects the context ABI and passes source replay', async () => {
  const artifact = await compileSource(source.replace('dst_missing', 'on day`mon..fri`; dst_missing')
    .replace('basis = pulse;', 'basis = window(10ms);')
    .replace('PROJECTION', 'open'), { filename: 'daily-package.ghost.md' });
  const keyId = 'daily-fixture';
  const privateKey = await crypto.subtle.importKey('pkcs8', Buffer.from(
    '302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'),
    'Ed25519', false, ['sign']);
  const publicKey = await crypto.subtle.importKey('raw', Buffer.from(
    'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex'),
    'Ed25519', false, ['verify']);
  const identity = {
    compilerRevision: 'daily-test', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/context-scan-abi-v5', bindingRevision: 'virtual-daily-v1',
    requiredCapabilities: [
      ...artifact.manifest.outputs.map(({ name }) => ({ kind: 'actuator', name, type: 'bool' })),
      ...artifact.manifest.sensors.map(({ name }) => ({ kind: 'sensor', name, type: 'bool' })),
    ],
  };
  const candidate = await buildPortablePackage(artifact, identity, {
    signers: [{ keyId, privateKey }], verifyCompilation: compileSource,
  });
  assert.equal(candidate.payload.bytecode.version, '28');
  const verified = await verifyPortablePackage(candidate, {
    trustedKeys: [{ keyId, publicKey }], revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision, expectedBindingRevision: identity.bindingRevision,
    supportedRuntimeAbis: [identity.runtimeAbi], supportedRuntimeSemantics: [identity.runtimeSemantics],
    supportedManifestFormats: ['GhostFlow/control-v28'], availableCapabilities: identity.requiredCapabilities,
    verifyBytecode: async (bytes, { manifest }) => {
      const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
      const runtime = await ControlRuntime.instantiateFramed(wasm, { bytes, manifest }, { context: activation });
      runtime.dispose();
      return true;
    },
  });
  assert.equal(verified.manifest.format, 'GhostFlow/control-v28');
});

test('UTC Daily Window and Run admit Friday and Monday and skip weekend crossings', async () => {
  const steps = Array.from({ length: 4 }, (_, i) => i + 1).flatMap(day =>
    [[day * DAY, day * DAY - 1, true], [day * DAY + 1, day * DAY, true]]);
  const expected = [
    [false,false,false], [true,true,false],
    [false,false,false], [false,false,false],
    [false,false,false], [false,false,false],
    [false,false,false], [true,true,false],
  ];
  await parity('basis = window(10ms);', 'open', steps, expected, true);
  await parity('basis = run(10ms, on_time); cancel_when = false;', 'active', steps, expected, true);
});
