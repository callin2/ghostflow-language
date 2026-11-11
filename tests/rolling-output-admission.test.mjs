import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { runScenario } from '../tools/ghostsim.mjs';

test('rolling output requests are admitted until the budget is full, then expire', async () => {
  const source = `# Rolling output admission\n\n\`\`\`ghost\ncontrol RollingOutput {\n  resource pump: BoolActuator;\n  event normal_started: Event;\n  account pump_applied = on_time(pump, stage: applied, persistence: durable);\n  account starts = count_events(normal_started, over: local_day("UTC"), persistence: durable);\n  constraints Budget { limit used(pump_applied, rolling(60s)) <= 30s { reserve = 5s; on_unknown = block; } }\n  output ready: Bool; ready <- case starts.count { ok(count) => count >= 0; fault(_) => false; };\n}\n\`\`\`\n`;
  const artifact = await compileSource(source, { filename: 'rolling-output.ghost.md' });
  const directory = mkdtempSync(join(tmpdir(), 'ghostflow-rolling-output-'));
  try {
    const artifactPath = join(directory, 'rolling.gfb');
    writeArtifact(artifact, artifactPath);
    const id = value => value.toString(16).padStart(32, '0');
    const actions = [];
    const contextFacts = atMs => ({ clock: { monotonicMs: atMs, bootEpoch: 1, wallMs: null, uncertaintyMs: null, trusted: false, unknownReason: 'NoClock', sourceRevision: 'clock-v1' }, natural: [], schedules: [], settings: null });
    for (let index = 0; index < 7; index += 1) {
      const atMs = index * 5_000;
      const request = { kind: 'outputRequest', reservationId: id(index + 1), account: 'pump_applied', resourceId: 7, atMs, durationMs: 5_000 };
      actions.push(request);
      if (index === 0) actions.push(request);
      actions.push({ kind: 'scan', atMs, contextFacts: contextFacts(atMs), accountingFacts: { localDay: 1, wallMs: 1_700_000_000_000 + atMs, clockTrusted: true } });
      if (index < 6) actions.push({ kind: 'outputApplied', reservationId: id(index + 1), receiptId: id(100 + index), account: 'pump_applied', resourceId: 7, startMs: atMs, endMs: atMs + 5_000, localDay: 1 });
    }
    for (const [atMs, clockTrusted] of [[62_500, true], [63_000, false]]) {
      actions.push({ kind: 'scan', atMs, contextFacts: contextFacts(atMs),
        accountingFacts: { localDay: 1, wallMs: 1_700_000_000_000 + atMs, clockTrusted } });
    }
    actions.push({ kind: 'outputRequest', reservationId: id(8), account: 'pump_applied', resourceId: 7, atMs: 70_000, durationMs: 5_000 });
    actions.push({ kind: 'scan', atMs: 70_000, contextFacts: contextFacts(70_000), accountingFacts: { localDay: 1, wallMs: 1_700_000_070_000, clockTrusted: true } });
    const scenario = {
      format: 'GhostFlow/scenario-v1', id: 'rolling-output-admission', initialInputs: [], keyBindings: [],
      context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] },
      accounting: { config: { maxIntervals: 16, maxEvents: 8, maxReservations: 16, maxRollingWindowMs: 60_000 }, bootEpoch: 1, terminalCapacity: 8,
        bindings: [{ account: 'pump_applied', evidenceStream: 'pump', resourceId: 7 }, { account: 'starts', evidenceStream: 'normal_started', eventType: 9 }] }, actions,
    };
    const scenarioPath = join(directory, 'scenario.toon'); writeFileSync(scenarioPath, encode(scenario));
    const result = runScenario(artifactPath, scenarioPath, { format: 'json' });
    assert.equal(result.success, true, result.encoded);
    const rows = JSON.parse(result.encoded).scans;
    assert.equal(rows.length, 10);
    for (const [index, row] of rows.slice(0, 6).entries()) {
      assert.equal(row.admissions.find(item => item.admittedAtMs === index * 5_000)?.status, 'Inserted');
    }
    const seventh = rows[6].admissions.find(item => item.admittedAtMs === 30_000);
    assert.equal(seventh.status, 'Rejected');
    const expired = rows[9].admissions.find(item => item.admittedAtMs === 70_000);
    assert.equal(expired.status, 'Inserted');
    const budget = row => {
      const [entry] = row.rollingBudgets;
      assert.equal(entry.account, 'pump_applied');
      assert.equal(entry.stage, 'applied');
      assert.deepEqual([entry.resourceId, entry.windowMs, entry.limitMs, entry.reserveMs], [7, 60_000, 30_000, 5_000]);
      return entry.evidence;
    };
    const atLimit = budget(rows[6]);
    assert.deepEqual([atLimit.usedMs, atLimit.reservedMs, atLimit.blocked, atLimit.blockReason, atLimit.nextReleaseMs],
      ['30000', '0', true, 'rolling-budget', '65000']);
    const partial = budget(rows[7]);
    assert.deepEqual([partial.usedMs, partial.reservedMs, partial.blocked, partial.nextReleaseMs], ['27500', '0', true, '65000']);
    assert.equal(budget(rows[8]), null, 'unknown clock must not present a trusted budget');
    const afterExpiry = budget(rows[9]);
    assert.deepEqual([afterExpiry.usedMs, afterExpiry.reservedMs, afterExpiry.blocked, afterExpiry.blockReason],
      ['20000', '5000', false, null]);
    actions[0] = { ...actions[0], durationMs: 5_001 };
    writeFileSync(scenarioPath, encode(scenario));
    assert.throws(() => runScenario(artifactPath, scenarioPath, { format: 'json' }),
      /exceeds the compiled rolling reserve/);
    actions[0] = actions[1];
    const receiptIndex = actions.findIndex(action => action.kind === 'outputApplied');
    actions[receiptIndex] = { ...actions[receiptIndex], account: 'starts' };
    writeFileSync(scenarioPath, encode(scenario));
    const rejected = runScenario(artifactPath, scenarioPath, { format: 'json' });
    assert.equal(rejected.success, false);
    assert.deepEqual(JSON.parse(rejected.encoded).error, {
      actionIndex: receiptIndex,
      message: 'applied output does not match its reservation account and resource',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
