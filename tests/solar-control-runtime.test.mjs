import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileSource } from '../tools/toolchain.mjs';

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
    when = allow;
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
      solarFacts: facts(descriptor.site, 0, 900) }), /due.*Solar|Solar.*due/);
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
