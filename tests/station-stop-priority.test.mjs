import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileConstraints } from '../tools/constraints.mjs';
import { extractLiterate } from '../tools/literate.mjs';
import { bindStationPolicy } from '../runtimes/wasm/policy.mjs';
import { GhostFlowStation } from '../runtimes/wasm/station.mjs';

const source = readFileSync(new URL('../examples/station-rules.ghost.md', import.meta.url), 'utf8');
const artifact = compileConstraints(extractLiterate(source, { filename: 'station-rules.ghost.md' }).code, {
  filename: 'station-rules.ghost.md',
});
const policy = bindStationPolicy(artifact, {
  station: { id: 'station', config: { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 1_000, maxStartBudgetMs: 800 } },
  pump: { id: 'pump1' },
  settings: { id: 'settings' },
  schedules: { starts: { id: 'starts', timezone: 'Asia/Seoul' } },
  modeAliases: { Auto: 'Auto', Manual: 'Manual', Configure: 'Configure' },
  activityAliases: { automatic: 'Auto', manual: 'Manual', configuring: 'Configure' },
});

const wasmBytes = readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));

test('same-tick Stop precedes Start, invalidates its occurrence, and gates mode entry on stop evidence', async () => {
  const station = await GhostFlowStation.instantiate(wasmBytes, policy.stationConfig);
  try {
    station.synchronizeDay({ day: 20_000, nowMs: 0n, nextDayDeadlineMs: 10_000n });
    station.enter({ requestId: 1n, ...station.claim, mode: 'Auto' });

    // Both requests were formed from the same tick snapshot. Stop is arbitrated first.
    const sameTickClaim = station.claim;
    const directive = station.requestStop({
      requestId: 2n,
      ...sameTickClaim,
      skippedOccurrenceIds: [501n],
    });
    assert.deepEqual(directive, { forceSafeOutputs: true, reason: 'StopRequested' });
    assert.equal(station.stopping, true);
    assert.throws(() => station.prepareStart({
      requestId: 3n,
      ...sameTickClaim,
      sessionId: 77n,
      ownerId: 88n,
      mode: 'Auto',
      valves: 1n,
      budgetMs: 100n,
      occurrenceId: 501n,
      nowMs: 1n,
    }), /stale station claim|stop generation/i);

    assert.throws(() => station.enter({ requestId: 4n, ...station.claim, mode: 'Manual' }), /not stopped/i);
    station.confirmStopped({ proof: 'Commanded', nowMs: 1n });
    station.enter({ requestId: 5n, ...station.claim, mode: 'Manual' });
    assert.equal(station.mode, 'Manual');

    // The schedule occurrence skipped by the stop remains terminal after the barrier clears.
    assert.throws(() => station.prepareStart({
      requestId: 6n,
      ...station.claim,
      sessionId: 78n,
      ownerId: 88n,
      mode: 'Manual',
      valves: 1n,
      budgetMs: 100n,
      occurrenceId: 501n,
      nowMs: 2n,
    }), /occurrence id was already accepted or terminal/);
  } finally {
    station.dispose();
  }
});
