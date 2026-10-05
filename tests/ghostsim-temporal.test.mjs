import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { encode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { validateScenario } from '../tools/ghostsim.mjs';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(fs.readFileSync(new URL('./reference/cases-input-v1/02-time-control.json', import.meta.url), 'utf8')).cases;
const selected = id => catalog.find(entry => entry.id === id);

test('temporal and capability scenario options reject unrelated controls', () => {
  const manifest = { inputs: [], sensors: [], signals: [], schedules: [] };
  const base = { format: 'GhostFlow/scenario-v1', id: 'plain', initialInputs: [], keyBindings: [], actions: [{ kind: 'scan', atMs: 0 }] };
  const temporal = { timeEpoch: 5, rootDensity: [{ sourceTag: 1, maxObservations: 1, intervalMs: 1000 }], budget: { maxRetainedSamples: 64, maxBytes: 33554432 } };
  assert.throws(() => validateScenario({ ...base, temporal }, manifest), /temporal profile requires a temporal signal/);
  assert.throws(() => validateScenario({ ...base, capabilities: [] }, manifest), /capabilities require an adapt control/);
});

async function run(t, id, temporal, actions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-temporal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const entry = selected(id);
  const artifact = path.join(dir, 'program.gfb');
  const compiled = await compileSource(entry.source, { filename: entry.filename });
  writeArtifact(compiled, artifact);
  const scenario = path.join(dir, 'scenario.toon');
  fs.writeFileSync(scenario, encode({ format: 'GhostFlow/scenario-v1', id, initialInputs: [], keyBindings: [], temporal, actions }) + '\n');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('tools/ghostsim.mjs', root)), artifact, scenario, '--format', 'json'], { encoding: 'utf8', timeout: 10000 });
  return { result, output: JSON.parse(result.stdout), manifest: compiled.manifest };
}

test('REF-04-025 simulator counts only certified true intervals', async t => {
  const compiled = await compileSource(selected('REF-04-025').source, { filename: 'true-for.ghost.md' });
  const sourceTag = compiled.manifest.signals[0].sources[0].tag;
  const temporal = { timeEpoch: 7, rootDensity: [], certifiedBoolRoots: [sourceTag], budget: { maxRetainedSamples: 1, maxBytes: 4_000_000 } };
  const interval = (id, startMs, endMs) => ({ kind: 'interval', name: 'hot', epoch: 11, id, startMs, endMs, value: true, quality: 'Measured' });
  const { result, output } = await run(t, 'REF-04-025', temporal, [
    { kind: 'scan', atMs: 0 }, interval(1, 0, 100000), { kind: 'scan', atMs: 100000 },
    interval(2, 200000, 300000), { kind: 'scan', atMs: 300000 },
    interval(3, 300000, 600000), { kind: 'scan', atMs: 600000 },
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(output.scans.map(row => row.safeVirtualIntent.alarm), [false, false, false, true]);
  assert.deepEqual(output.scans.map(row => row.trueForTrace[0].coveredMs), [0, 100000, 100000, 400000]);
  assert.equal(output.scans[3].trueForTrace[0].certificateId, 3);
});

for (const [id, expected] of [
  ['REF-04-027', [282]],
  ['REF-04-028', [280, 284]],
  ['REF-04-029', [0.04]],
]) {
  test(`${id} simulator evaluates timestamped window observations`, async t => {
    const entry = selected(id);
    const compiled = await compileSource(entry.source, { filename: entry.filename });
    const sourceTag = compiled.manifest.signals[0].sources[0].tag;
    const temporal = {
      timeEpoch: 5,
      rootDensity: [{ sourceTag, maxObservations: 2, intervalMs: 100000 }],
      budget: { maxRetainedSamples: 64, maxBytes: 33554432 },
    };
    const sample = (id, timestampMs, value) => ({
      kind: 'sample', name: 'temperature', epoch: 5, id, timestampMs, value, quality: 'Good',
    });
    const { result, output } = await run(t, id, temporal, [
      sample(1, 1000, 280), { kind: 'scan', atMs: 1000 },
      sample(2, 101000, 284), { kind: 'scan', atMs: 101000 },
    ]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.deepEqual(output.scans[1].windowTrace.map(trace => trace.value), expected);
    assert.deepEqual(output.scans[1].windowTrace.map(trace => trace.count), expected.map(() => 2));
  });
}
