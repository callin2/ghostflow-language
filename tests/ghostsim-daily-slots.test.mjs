import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./reference/cases-input-v1/02-time-control.json', import.meta.url)))
  .cases.find(entry => entry.id === 'REF-03-032');
const cli = fileURLToPath(new URL('../tools/ghostsim.mjs', import.meta.url));
const scheduledWallMs = Date.UTC(2026, 8, 23, 15); // declared 00:00 in Asia/Seoul

function facts(site, monotonicMs, wallMs) {
  return {
    clock: { monotonicMs, bootEpoch: 7, wallMs, trusted: true, uncertaintyMs: 0, sourceRevision: 'clock-v1' },
    schedules: [{ kind: 'daily-slots', site, coverageFromWallMs: scheduledWallMs - 1, coverageToWallMs: scheduledWallMs,
      rows: [{ sourceDay: 20_720, slotKey: 1, minuteOfDay: 0, fold: 0, scheduledWallMs, available: true,
        providerRevision: 'iana-v1', contextRevision: 'tzdb-v1' }] }],
  };
}

test('REF-03-032 runs unchanged through ghostsim with provider facts and Rust admission', async t => {
  const compiled = await compileSource(fixture.source, { filename: fixture.filename });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-daily-slots-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'daily-slots.gfb');
  const scenario = path.join(directory, 'scenario.toon');
  writeArtifact(compiled, artifact);
  const site = compiled.manifest.schedules[0].site;
  fs.writeFileSync(scenario, encode({
    format: 'GhostFlow/scenario-v1', id: fixture.id, initialInputs: [], keyBindings: [],
    schedule: { bootEpoch: 7, terminalCapacity: 8 },
    actions: [{ kind: 'scan', atMs: 0, scheduleFacts: facts(site, 0, scheduledWallMs - 1) },
      { kind: 'scan', atMs: 1, scheduleFacts: facts(site, 1, scheduledWallMs) }],
  }) + '\n');
  const result = spawnSync(process.execPath, [cli, artifact, scenario, '--format', 'json'],
    { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.scans.map(row => row.safeVirtualIntent.due), [false, true]);
  assert.equal(output.scans[1].scheduleTrace[0].observations[0].minuteOfDay, 0);
});
