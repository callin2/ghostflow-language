// Explicit temporal fixture revision: issue531-quality-temporal-v1; predecessor retained in fixtures/history/issue531/temporal.
import assert from 'node:assert/strict';
import { softwareQualityObservations, softwareQualityRails } from './helpers/software-quality-observations.mjs';
const ControlRuntime = {
  instantiate: async (...args) => softwareQualityObservations(await BaseControlRuntime.instantiate(...args)),
  instantiateFramed: async (...args) => softwareQualityObservations(await BaseControlRuntime.instantiateFramed(...args)),
};

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ControlRuntime as BaseControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { solarContextEvidence } from "../runtimes/wasm/context-abi.mjs";

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const source = `# Native Solar

\`\`\`ghost
control NativeSolar {
  input allow: Bool;
  schedule dawn: Solar {
    timezone = "UTC";
    latitude = 0.0;
    longitude = 0.0;
    at = sun\`rise\`;
    basis = pulse;
    when = allow |> recover(false);
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output due: Bool;
  due <- dawn.due;
}
\`\`\`
`;

const facts = (site, monotonicMs, wallMs) => ({
  clock: {
    monotonicMs, bootEpoch: 7, wallMs, trusted: true,
    uncertaintyMs: 0, sourceRevision: 'clock-v1',
  },
  schedules: [{
    site, coverageFromWallMs: 0, coverageToWallMs: 2_000,
    rows: [{ sourceDay: 0, scheduledWallMs: 1_000, available: true,
      providerRevision: 'solar-v1', contextRevision: 'site-v1' }],
  }],
});
const secondSolar = source.slice(source.indexOf('  schedule dawn:'), source.indexOf('  output due:'))
  .replace('schedule dawn:', 'schedule spare:');
const legacySource = code => code.replace('  schedule dawn:', `${secondSolar}  schedule dawn:`);
const legacyFacts = (artifact, nowMs, wallMs) => ({
  clock: facts(0, nowMs, wallMs).clock,
  schedules: artifact.manifest.schedules.flatMap(schedule => facts(schedule.site, nowMs, wallMs).schedules),
});

test('ordinary Solar pulse selects the framed context runtime without an operator config', async t => {
  const artifact = await compileSource(source.replace('sun`rise`', 'sun`set + 5min`'),
    { filename: 'ordinary-solar.ghost.md' });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v15');
  assert.equal(Buffer.from(artifact.bytes).readUInt16LE(4), 16);
  assert.deepEqual(artifact.manifest.configs, []);
  const descriptor = artifact.manifest.schedules[0];
  assert.equal(descriptor.offsetMs, 300_000);
  const context = { bootEpoch: 7, terminalCapacity: 8, bindings: [] };
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context });
  t.after(() => runtime.dispose());
  const day = 86_400_000;
  const frames = [[0, 900], [100, 1_000], [200, 900], [300, 1_000],
    [400, null], [500, 1_100], [60_600, day + 1_000], [60_700, day + 1_100]];
  const contextFacts = frames.map(([nowMs, wallMs]) => {
    const packet = facts(descriptor.site, nowMs, wallMs);
    const solar = packet.schedules[0];
    solar.coverageToWallMs = day * 2;
    solar.rows.push({ ...solar.rows[0], sourceDay: 1, scheduledWallMs: day + 1_000 });
    return {
      clock: { ...packet.clock, trusted: wallMs !== null, unknownReason: wallMs === null ? 'ClockUnknown' : null },
      natural: [], schedules: [], settings: null,
      solars: [solarContextEvidence(descriptor, solar)],
    };
  });
  const observed = frames.map(([nowMs], i) => runtime.step({
    nowMs, inputs: { allow: true }, contextFacts: contextFacts[i],
  }).vm);
  assert.deepEqual(observed.map(trace => trace.safe.due), [false, true, false, false, false, false, false, false]);
  assert.match(JSON.stringify(observed[4].contextTrace), /ClockUnknown/);
  assert.match(JSON.stringify(observed[6].contextTrace), /ObservationGap/);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-ordinary-solar-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'ordinary.gfb');
  const tapePath = path.join(directory, 'tape.json');
  fs.writeFileSync(modulePath, artifact.bytes);
  fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-solar-v1', activation: context,
    steps: frames.map(([nowMs], scanId) => ({
      scanId, logicalTimeMs: nowMs, ...contextFacts[scanId],
      inputs: Object.entries(softwareQualityRails(artifact, { allow: true }, scanId + 1, nowMs))
        .map(([name, value]) => ({ name, value })),
    })) }));
  const nativePath = fileURLToPath(new URL('../target/release/examples/context_tape', import.meta.url));
  const native = execFileSync(nativePath + (process.platform === 'win32' ? '.exe' : ''),
    [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 }).trim().split('\n').map(JSON.parse);
  assert.ok(native.every(row => row.accepted));
  assert.deepEqual(native.map(row => row.outcome.trace), observed);
});

test('ControlRuntime executes compiled Solar from provider facts and rejects host due injection', async () => {
  const artifact = await compileSource(legacySource(source), { filename: 'native-solar.ghost.md' });
  const descriptor = artifact.manifest.schedules[1];
  assert.equal(new DataView(artifact.bytes.buffer, artifact.bytes.byteOffset).getUint16(4, true), 5);
  assert.equal(Object.hasOwn(descriptor, 'dueInput'), false);

  await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact), /solar activation/i);
  const runtime = await ControlRuntime.instantiate(wasm, artifact, {
    solar: { bootEpoch: 7, terminalCapacity: 8 },
  });
  try {
    assert.throws(() => runtime.step({ nowMs: 0, inputs: { allow: true }, due: { dawn: true },
      solarFacts: legacyFacts(artifact, 0, 900) }), /due\.dawn cannot supply a runtime-owned due value/);
    assert.throws(() => runtime.step({ nowMs: 0, inputs: { allow: true } }), /solar facts/i);
    assert.equal(runtime.step({ nowMs: 0, inputs: { allow: true },
      solarFacts: legacyFacts(artifact, 0, 900) }).vm.safe.due, false);
    const admitted = runtime.step({ nowMs: 100, inputs: { allow: true },
      solarFacts: legacyFacts(artifact, 100, 1_000) }).vm;
    assert.equal(admitted.safe.due, true);
    assert.equal(admitted.scheduleTrace[1].observations[0].providerRevision, 'solar-v1');
  } finally { runtime.dispose(); }
});

test('ControlRuntime validates strict Solar policy metadata before activation', async () => {
  const artifact = await compileSource(legacySource(source), { filename: 'native-solar.ghost.md' });
  const corrupt = mutate => {
    const manifest = structuredClone(artifact.manifest);
    mutate(manifest.schedules[0]);
    return ControlRuntime.instantiate(wasm, { ...artifact, manifest }, {
      solar: { bootEpoch: 7, terminalCapacity: 8 },
    });
  };
  await assert.rejects(() => corrupt(schedule => { schedule.dueInput = '__gf_schedule_due_dawn'; }), /unknown key|dueInput/);
  await assert.rejects(() => corrupt(schedule => { schedule.policy.gapMs = 0; }), /gap/);
  await assert.rejects(() => corrupt(schedule => { schedule.policy.when = false; }), /when/);
  await assert.rejects(() => corrupt(schedule => { schedule.site = 0; }), /site/);
});

test('framed context Solar preserves a pulse-triggered timed output', async () => {
  const timedSource = source.replace('output due: Bool;', `state active: Bool = false;
  timer elapsedActive = elapsed(active);
  active' = if active then elapsedActive < 5min else dawn.due;
  output due: Bool;
  output running: Bool;
  running <- active';`);
  const legacy = await compileSource(legacySource(timedSource), { filename: 'solar-timed.ghost.md' });
  const context = await compileSource(timedSource, { filename: 'solar-timed.ghost.md' });
  assert.equal(context.manifest.format, 'GhostFlow/control-v15');
  assert.deepEqual(context.manifest.schedules[0].configIds, []);
  const original = await ControlRuntime.instantiate(wasm, legacy, {
    solar: { bootEpoch: 7, terminalCapacity: 8 },
  });
  const framed = await ControlRuntime.instantiateFramed(wasm, context, {
    context: { bootEpoch: 7, terminalCapacity: 8, bindings: [] },
  });
  const tape = [[0, 900], [100, 1_000], [200, 1_100], [300_099, 301_000], [300_100, 301_001]];
  const capture = trace => [trace.safe.due, trace.safe.running];
  try {
    const originalOutputs = [];
    const framedOutputs = [];
    for (const [nowMs, wallMs] of tape) {
      const legacyPacket = legacyFacts(legacy, nowMs, wallMs);
      for (const schedule of legacyPacket.schedules) schedule.coverageToWallMs = 86_400_000;
      const contextFacts = facts(context.manifest.schedules[0].site, nowMs, wallMs);
      contextFacts.schedules[0].coverageToWallMs = 86_400_000;
      originalOutputs.push(capture(original.step({ nowMs, inputs: { allow: true }, solarFacts: legacyPacket }).vm));
      framedOutputs.push(capture(framed.step({ nowMs, inputs: { allow: true }, contextFacts: {
        clock: { ...contextFacts.clock, unknownReason: null },
        natural: [], schedules: [], settings: null,
        solars: [solarContextEvidence(context.manifest.schedules[0], contextFacts.schedules[0])],
      } }).vm));
    }
    assert.deepEqual(originalOutputs, [[false, false], [true, true], [false, true], [false, true], [false, false]]);
    assert.deepEqual(framedOutputs, originalOutputs);
  } finally {
    original.dispose();
    framed.dispose();
  }
});
