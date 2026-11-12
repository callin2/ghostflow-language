import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { solarContextEvidence } from '../runtimes/wasm/context-abi.mjs';
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
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, {
    context: { bootEpoch: 7, terminalCapacity: 8, bindings: [] },
  });
  const scan = (nowMs, wallMs) => {
    const packet = facts(descriptor.site, nowMs, wallMs);
    return runtime.step({ nowMs, contextFacts: {
      clock: { ...packet.clock, unknownReason: null }, natural: [], schedules: [], settings: null,
      solars: [solarContextEvidence(descriptor, packet.schedules[0])],
    } }).vm;
  };
  try {
    const baseline = scan(0, 900);
    assert.equal(baseline.safe.missed_alarm, false);

    const missed = scan(86_470_000, 86_470_900);
    assert.equal(missed.safe.missed_alarm, true);
    assert.equal(missed.stateAfter.missed_scans, 1);
    const records = missed.contextTrace.filter(record => record.occurrenceId);
    assert.equal(records.length, 2);
    assert.ok(records.every(record => record.site === descriptor.site));
    assert.deepEqual(records.map(record => record.decision), ['ObservationGap', 'ObservationGap']);
    assert.equal(new Set(records.map(record => record.occurrenceId)).size, 2);

    const next = scan(86_470_001, 86_470_901);
    assert.equal(next.safe.missed_alarm, false);
    assert.equal(next.stateAfter.missed_scans, 1);
    assert.deepEqual(next.contextTrace.filter(record => record.occurrenceId), []);
  } finally { runtime.dispose(); }
});
