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
const fixture = catalog.find(entry => entry.id === 'REF-03-024');
const cli = fileURLToPath(new URL('../tools/ghostsim.mjs', import.meta.url));
const scheduledWallMs = Date.UTC(2026, 8, 23, 21, 30); // 2026-09-24 06:30 Asia/Seoul

async function prepared(t, source = fixture.source) {
  const compiled = await compileSource(source, { filename: fixture.filename });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-daily-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'daily.gfb');
  const scenario = path.join(directory, 'daily.toon');
  writeArtifact(compiled, artifact);
  return { artifact, compiled, scenario };
}

test('weekday Daily CLI honors a scheduled local weekday and rejects a weekend pulse', async t => {
  const source = fixture.source.replace(/at = time`[^\x60]+`;/, 'at = time\x6006:30\x60;\n    on = day\x60mon..fri\x60;');
  const { artifact, compiled, scenario } = await prepared(t, source);
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v27');
  const site = compiled.manifest.schedules[0].site;
  for (const [date, eligible] of [['2026-11-09', true], ['2026-11-14', false]]) {
    const wall = Date.parse(`${date}T06:30:00+09:00`);
    const sourceDay = Date.parse(`${date}T00:00:00Z`) / 86_400_000;
    const packet = monotonicMs => ({
      clock: { monotonicMs, bootEpoch: 7, wallMs: wall - 1 + monotonicMs, trusted: true, uncertaintyMs: 0, sourceRevision: 'clock-v1' },
      schedules: [{ kind: 'daily', site, coverageFromWallMs: wall - 1, coverageToWallMs: wall,
        rows: [{ sourceDay, fold: 0, scheduledWallMs: wall, available: true,
          providerRevision: 'iana-v1', contextRevision: 'tzdb-v1' }] }],
    });
    fs.writeFileSync(scenario, encode({
      format: 'GhostFlow/scenario-v1', id: 'weekday-daily', initialInputs: [], keyBindings: [],
      schedule: { bootEpoch: 7, terminalCapacity: 8 },
      actions: [0, 1].map(atMs => ({ kind: 'scan', atMs, scheduleFacts: packet(atMs) })),
    }) + '\n');
    const result = spawnSync(process.execPath, [cli, artifact, scenario, '--format', 'json'], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).scans.map(row => row.safeVirtualIntent.due), [false, eligible], date);
  }
});

function facts(site, monotonicMs, wallMs) {
  return {
    clock: { monotonicMs, bootEpoch: 7, wallMs, trusted: true, uncertaintyMs: 0, sourceRevision: 'clock-v1' },
    schedules: [{ kind: 'daily', site, coverageFromWallMs: scheduledWallMs - 1, coverageToWallMs: scheduledWallMs,
      rows: [{ sourceDay: 20_720, fold: 0, scheduledWallMs, available: true,
        providerRevision: 'iana-v1', contextRevision: 'tzdb-v1' }] }],
  };
}

test('REF-03-024 Daily executes unchanged source through schedule facts and Rust admission', async t => {
  const { artifact, compiled, scenario } = await prepared(t);
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v7');
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
  assert.equal(output.scans[1].scheduleTrace[0].observations[0].providerRevision, 'iana-v1');
});

test('Daily scenario requires exact schedule facts and rejects caller supplied due', async t => {
  const { artifact, compiled, scenario } = await prepared(t);
  const site = compiled.manifest.schedules[0].site;
  for (const [id, action, diagnostic] of [
    ['missing', { kind: 'scan', atMs: 0 }, /requires provider facts/],
    ['kind', { kind: 'scan', atMs: 0, scheduleFacts: { ...facts(site, 0, scheduledWallMs - 1),
      schedules: [{ ...facts(site, 0, scheduledWallMs - 1).schedules[0], kind: 'solar' }] } }, /kind/],
    ['spoof', { kind: 'scan', atMs: 0, due: { morning: true }, scheduleFacts: facts(site, 0, scheduledWallMs - 1) }, /unknown field due|cannot supply/],
  ]) {
    fs.writeFileSync(scenario, encode({
      format: 'GhostFlow/scenario-v1', id, initialInputs: [], keyBindings: [],
      schedule: { bootEpoch: 7, terminalCapacity: 8 }, actions: [action],
    }) + '\n');
    const result = spawnSync(process.execPath, [cli, artifact, scenario, '--format', 'json'],
      { encoding: 'utf8', timeout: 10_000 });
    assert.notEqual(result.status, 0, `${id}: ${result.stdout}`);
    assert.match(JSON.parse(result.stdout).error.message, diagnostic, id);
  }
});
