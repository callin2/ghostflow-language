// Explicit temporal fixture revision: issue531-quality-temporal-v1; predecessor retained in fixtures/history/issue531/temporal.
import assert from 'node:assert/strict';
import { softwareQualityObservations, softwareQualityRails } from './helpers/software-quality-observations.mjs';
const ControlRuntime = {
  instantiate: async (...args) => softwareQualityObservations(await BaseControlRuntime.instantiate(...args)),
  instantiateFramed: async (...args) => softwareQualityObservations(await BaseControlRuntime.instantiateFramed(...args)),
};

import fs from 'node:fs';
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

test('ControlRuntime executes compiled Solar from provider facts and rejects host due injection', async () => {
  const artifact = await compileSource(source, { filename: 'native-solar.ghost.md' });
  const descriptor = artifact.manifest.schedules[0];
  assert.equal(new DataView(artifact.bytes.buffer, artifact.bytes.byteOffset).getUint16(4, true), 5);
  assert.equal(Object.hasOwn(descriptor, 'dueInput'), false);

  await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact), /solar activation/i);
  const runtime = await ControlRuntime.instantiate(wasm, artifact, {
    solar: { bootEpoch: 7, terminalCapacity: 8 },
  });
  try {
    assert.throws(() => runtime.step({ nowMs: 0, inputs: { allow: true }, due: { dawn: true },
      solarFacts: facts(descriptor.site, 0, 900) }), /due\.dawn cannot supply a runtime-owned due value/);
    assert.throws(() => runtime.step({ nowMs: 0, inputs: { allow: true } }), /solar facts/i);
    assert.equal(runtime.step({ nowMs: 0, inputs: { allow: true },
      solarFacts: facts(descriptor.site, 0, 900) }).vm.safe.due, false);
    const admitted = runtime.step({ nowMs: 100, inputs: { allow: true },
      solarFacts: facts(descriptor.site, 100, 1_000) }).vm;
    assert.equal(admitted.safe.due, true);
    assert.equal(admitted.scheduleTrace[0].observations[0].providerRevision, 'solar-v1');
  } finally { runtime.dispose(); }
});

test('ControlRuntime validates strict Solar policy metadata before activation', async () => {
  const artifact = await compileSource(source, { filename: 'native-solar.ghost.md' });
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
  const legacy = await compileSource(timedSource, { filename: 'solar-timed.ghost.md' });
  const context = await compileSource(timedSource.replace('input allow: Bool;',
    'input allow: Bool;\n  config unused: Bool = true { access = operator; }'), { filename: 'solar-timed.ghost.md' });
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
      const legacyFacts = facts(legacy.manifest.schedules[0].site, nowMs, wallMs);
      legacyFacts.schedules[0].coverageToWallMs = 86_400_000;
      const contextFacts = facts(context.manifest.schedules[0].site, nowMs, wallMs);
      contextFacts.schedules[0].coverageToWallMs = 86_400_000;
      originalOutputs.push(capture(original.step({ nowMs, inputs: { allow: true }, solarFacts: legacyFacts }).vm));
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
