import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { runScenario } from '../tools/ghostsim.mjs';

test('rolling output requests are admitted until the budget is full, then expire', async () => {
  const source = `# Rolling output admission\n\n\`\`\`ghost\ncontrol RollingOutput {\n  resource pump: BoolActuator;\n  event normal_started: Event;\n  account pump_applied = on_time(pump, stage: applied, persistence: durable);\n  account starts = count_events(normal_started, over: local_day("UTC"), persistence: durable);\n  constraints Budget { limit used(pump_applied, rolling(60s)) <= 30s { reserve = 1s; on_unknown = block; } }\n  output ready: Bool; ready <- case starts.count { ok(count) => count >= 0; fault(_) => false; };\n}\n\`\`\`\n`;
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
    assert.equal(rows.length, 8);
    for (const [index, row] of rows.slice(0, 6).entries()) {
      assert.equal(row.admissions.find(item => item.admittedAtMs === index * 5_000)?.status, 'Inserted');
    }
    const seventh = rows[6].admissions.find(item => item.admittedAtMs === 30_000);
    assert.equal(seventh.status, 'Rejected');
    const expired = rows[7].admissions.find(item => item.admittedAtMs === 70_000);
    assert.equal(expired.status, 'Inserted');
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
