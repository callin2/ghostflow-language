import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';

const catalog = JSON.parse(fs.readFileSync(new URL('./reference/cases-input-v1/02-time-control.json', import.meta.url))).cases;
const selected = id => catalog.find(entry => entry.id === id);

test('REF-03-042 Solar scan requires provider facts and admits the crossing', async t => {
  const entry = selected('REF-03-042');
  const compiled = await compileSource(entry.source, { filename: entry.filename });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-solar-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'solar.gfb');
  const scenarioPath = path.join(directory, 'solar.toon');
  writeArtifact(compiled, artifact);
  const site = compiled.manifest.schedules[0].site;
  const facts = (monotonicMs, wallMs) => ({
    clock: { monotonicMs, bootEpoch: 7, wallMs, trusted: true, uncertaintyMs: 0, sourceRevision: 'clock-v1' },
    schedules: [{ site, coverageFromWallMs: 0, coverageToWallMs: 2000,
      rows: [{ sourceDay: 0, scheduledWallMs: 1000, available: true,
        providerRevision: 'solar-v1', contextRevision: 'site-v1' }] }],
  });
  fs.writeFileSync(scenarioPath, encode({
    format: 'GhostFlow/scenario-v1', id: 'REF-03-042', initialInputs: [], keyBindings: [],
    solar: { bootEpoch: 7, terminalCapacity: 8 },
    actions: [{ kind: 'scan', atMs: 0, solarFacts: facts(0, 900) },
      { kind: 'scan', atMs: 100, solarFacts: facts(100, 1000) }],
  }) + '\n');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/ghostsim.mjs', import.meta.url)),
    artifact, scenarioPath, '--format', 'json'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.scans.map(row => row.safeVirtualIntent.due), [false, true]);
  assert.equal(output.scans[1].scheduleTrace[0].observations[0].providerRevision, 'solar-v1');
});

test('REF-03-045 Solar scan keeps distinct schedule facts for both sites', async t => {
  const entry = selected('REF-03-045');
  const compiled = await compileSource(entry.source, { filename: entry.filename });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-solar-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'solar.gfb');
  const scenarioPath = path.join(directory, 'solar.toon');
  writeArtifact(compiled, artifact);
  const facts = (monotonicMs, wallMs) => ({
    clock: { monotonicMs, bootEpoch: 7, wallMs, trusted: true, uncertaintyMs: 0, sourceRevision: 'clock-v1' },
    schedules: compiled.manifest.schedules.map((schedule, index) => ({
      site: schedule.site, coverageFromWallMs: 0, coverageToWallMs: 2000,
      rows: [{ sourceDay: 0, scheduledWallMs: index === 0 ? 1000 : null,
        available: index === 0, providerRevision: 'solar-v1', contextRevision: 'site-v1' }],
    })),
  });
  fs.writeFileSync(scenarioPath, encode({
    format: 'GhostFlow/scenario-v1', id: 'REF-03-045', initialInputs: [], keyBindings: [],
    solar: { bootEpoch: 7, terminalCapacity: 8 },
    actions: [{ kind: 'scan', atMs: 0, solarFacts: facts(0, 900) },
      { kind: 'scan', atMs: 100, solarFacts: facts(100, 1000) }],
  }) + '\n');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/ghostsim.mjs', import.meta.url)),
    artifact, scenarioPath, '--format', 'json'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.scans.map(row => row.safeVirtualIntent.due), [false, true]);
  assert.equal(output.scans[1].scheduleTrace.length, 2);
});
