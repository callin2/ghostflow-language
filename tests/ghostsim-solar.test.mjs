import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { solarContextEvidence } from '../runtimes/wasm/context-abi.mjs';

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
  const descriptor = compiled.manifest.schedules[0];
  const facts = (monotonicMs, wallMs) => ({
    clock: { monotonicMs, bootEpoch: 7, wallMs, trusted: true, unknownReason: null, uncertaintyMs: 0, sourceRevision: 'clock-v1' },
    natural: [], schedules: [], settings: null,
    solars: [solarContextEvidence(descriptor, { site: descriptor.site, coverageFromWallMs: 0, coverageToWallMs: 2000,
      rows: [{ sourceDay: 0, scheduledWallMs: 1000, available: true,
        providerRevision: 'solar-v1', contextRevision: 'site-v1' }] })],
  });
  fs.writeFileSync(scenarioPath, encode({
    format: 'GhostFlow/scenario-v1', id: 'REF-03-042', initialInputs: [], keyBindings: [],
    context: { bootEpoch: 7, terminalCapacity: 8, bindings: [] },
    actions: [{ kind: 'scan', atMs: 0, contextFacts: facts(0, 900) },
      { kind: 'scan', atMs: 100, contextFacts: facts(100, 1000) }],
  }) + '\n');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/ghostsim.mjs', import.meta.url)),
    artifact, scenarioPath, '--format', 'json'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.scans.map(row => row.safeVirtualIntent.due), [false, true]);
  assert.equal(output.scans[1].contextTrace.find(row => row.decision === 'Due')?.providerRevision, 'solar-v1');
});

test('REF-03-045 Solar scan keeps distinct schedule facts for both sites', async t => {
  const entry = selected('REF-03-045');
  const compiled = await compileSource(entry.source, { filename: entry.filename });
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v15');
  assert.equal(Buffer.from(compiled.bytes).readUInt16LE(4), 16);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-solar-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'solar.gfb');
  const scenarioPath = path.join(directory, 'solar.toon');
  writeArtifact(compiled, artifact);
  const facts = (monotonicMs, wallMs) => ({
    clock: { monotonicMs, bootEpoch: 7, wallMs, trusted: true, unknownReason: null, uncertaintyMs: 0, sourceRevision: 'clock-v1' },
    natural: [], schedules: [], settings: null,
    solars: compiled.manifest.schedules.map((schedule, index) => solarContextEvidence(schedule, {
      site: schedule.site, coverageFromWallMs: 0, coverageToWallMs: 2000,
      rows: [{ sourceDay: 0, scheduledWallMs: 1000 + index * 100,
        available: true, providerRevision: `solar-${index}`, contextRevision: `site-${index}` }],
    })),
  });
  const context = { bootEpoch: 7, terminalCapacity: 8, bindings: [] };
  const scans = [[0, 900], [100, 1000], [200, 1100]];
  fs.writeFileSync(scenarioPath, encode({
    format: 'GhostFlow/scenario-v1', id: 'REF-03-045', initialInputs: [], keyBindings: [],
    context,
    actions: scans.map(([atMs, wallMs]) => ({ kind: 'scan', atMs, contextFacts: facts(atMs, wallMs) })),
  }) + '\n');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/ghostsim.mjs', import.meta.url)),
    artifact, scenarioPath, '--format', 'json'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.scans.map(row => row.safeVirtualIntent.due), [false, true, true]);
  assert.deepEqual(output.scans.flatMap(scan => scan.contextTrace.filter(row => row.decision === 'Due'))
    .map(row => [row.site, row.providerRevision, row.contextRevision]),
  compiled.manifest.schedules.map((schedule, index) => [schedule.site, `solar-${index}`, `site-${index}`]));
  const tape = path.join(directory, 'tape.json');
  fs.writeFileSync(tape, JSON.stringify({ profile: 'context-solar-v1', activation: context,
    steps: scans.map(([logicalTimeMs, wallMs], scanId) => ({
      scanId, logicalTimeMs, inputs: [], ...facts(logicalTimeMs, wallMs),
    })) }));
  const nativePath = fileURLToPath(new URL('../target/release/examples/context_tape', import.meta.url));
  const native = spawnSync(nativePath + (process.platform === 'win32' ? '.exe' : ''),
    [artifact, tape], { encoding: 'utf8', timeout: 10000 });
  assert.equal(native.status, 0, native.stdout + native.stderr);
  const traces = native.stdout.trim().split('\n').map(line => JSON.parse(line).outcome.trace);
  assert.deepEqual(traces.map(trace => trace.safe), output.scans.map(scan => scan.safeVirtualIntent));
  assert.deepEqual(traces.map(trace => trace.contextTrace), output.scans.map(scan => scan.contextTrace));

});
