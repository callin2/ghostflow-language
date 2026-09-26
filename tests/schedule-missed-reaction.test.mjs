import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const source = `# Missed schedule reaction

\`\`\`ghost
control MissedReaction {
  schedule morning: Solar {
    timezone = "UTC";
    latitude = 0.0;
    longitude = 0.0;
    at = sun\`rise\`;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  state missed_scans: Int = 0;
  missed_scans' = if morning.missed then missed_scans + 1 else missed_scans;
  output missed_alarm: Bool;
  missed_alarm <- morning.missed;
}
\`\`\`
`;

const facts = (site, monotonicMs, wallMs) => ({
  clock: {
    monotonicMs, bootEpoch: 7, wallMs, trusted: true,
    uncertaintyMs: 0, sourceRevision: 'clock-v1',
  },
  schedules: [{
    site, coverageFromWallMs: 0, coverageToWallMs: 86_500_000,
    rows: [
      { sourceDay: 0, scheduledWallMs: 1_000, available: true,
        providerRevision: 'solar-v1', contextRevision: 'site-v1' },
      { sourceDay: 1, scheduledWallMs: 86_402_000, available: true,
        providerRevision: 'solar-v1', contextRevision: 'site-v1' },
    ],
  }],
});

test('an accepted observation gap emits one missed pulse and one stable record per terminal occurrence', async () => {
  const artifact = await compileSource(source, { filename: 'schedule-missed-reaction.ghost.md' });
  const descriptor = artifact.manifest.schedules[0];
  const runtime = await ControlRuntime.instantiate(wasm, artifact, {
    solar: { bootEpoch: 7, terminalCapacity: 8 },
  });
  try {
    const baseline = runtime.step({ nowMs: 0, solarFacts: facts(descriptor.site, 0, 900) }).vm;
    assert.equal(baseline.safe.missed_alarm, false);

    const missed = runtime.step({ nowMs: 86_470_000,
      solarFacts: facts(descriptor.site, 86_470_000, 86_470_900) }).vm;
    assert.equal(missed.safe.missed_alarm, true);
    assert.equal(missed.stateAfter.missed_scans, 1);
    const trace = missed.scheduleTrace[0];
    assert.equal(trace.site, descriptor.site);
    const records = trace.observations;
    assert.equal(records.length, 2);
    assert.deepEqual(records.map(record => record.decision), ['ObservationGap', 'ObservationGap']);
    assert.equal(new Set(records.map(record => record.occurrenceId)).size, 2);

    const next = runtime.step({ nowMs: 86_470_001,
      solarFacts: facts(descriptor.site, 86_470_001, 86_470_901) }).vm;
    assert.equal(next.safe.missed_alarm, false);
    assert.equal(next.stateAfter.missed_scans, 1);
    assert.deepEqual(next.scheduleTrace[0].observations, []);
  } finally { runtime.dispose(); }
});
