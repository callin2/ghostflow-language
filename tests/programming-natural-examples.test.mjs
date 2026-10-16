import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const book = fs.readFileSync(path.join(root, 'docs/ProgrammingInGhostflow.md'), 'utf8');
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const executable = name => path.join(root, `target/release/examples/${name}${process.platform === 'win32' ? '.exe' : ''}`);
function example(id) {
  const section = book.indexOf(`### ${id} `);
  assert.notEqual(section, -1, `missing book example ${id}`);
  const start = book.indexOf('```ghost\n', section);
  const end = book.indexOf('\n```', start);
  assert.ok(start > section && end > start, `missing complete source ${id}`);
  return `# ${id}\n\n${book.slice(start, end + 4)}\n`;
}
function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-book-natural-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
async function scalarRuntime(t, artifact) {
  const runtime = await ControlRuntime.instantiate(wasm, artifact);
  t.after(() => runtime.dispose()); return runtime;
}
function nativeScalar(t, artifact, rows) {
  const directory = workspace(t), module = path.join(directory, 'module.gfb'), csv = path.join(directory, 'inputs.csv');
  const fields = Object.keys(rows[0]);
  fs.writeFileSync(module, artifact.bytes);
  fs.writeFileSync(csv, `${fields.join(',')}\n${rows.map(row => fields.map(name => row[name]).join(',')).join('\n')}\n`);
  return execFileSync(executable('run'), [module, csv, '--outcomes'], { encoding: 'utf8', timeout: 20_000 })
    .trim().split('\n').map(JSON.parse);
}

// Explicit bridge for the retained healthy teaching datasets. These are new
// identified Good observations, not automatic production defaults or clock samples.
function healthyObservations(artifact, row, index) {
  const { inputs, ...facts } = row;
  return { ...facts, samples: Object.fromEntries(artifact.manifest.sensors.map(sensor => {
    const name = sensor.name.replace(/^observed_/, '');
    assert.ok(Object.hasOwn(inputs, name), `missing retained observation ${name}`);
    return [sensor.name, { epoch: 1, id: index + 1, timestampMs: row.nowMs,
      value: inputs[name], quality: 'Good' }];
  })) };
}

test('Programming E34 counts accepted true scans exactly in native and WASM', async t => {
  const artifact = await compileSource(example('E34'), { filename: 'E34.ghost.md' });
  const inputs = [...Array(120).fill(true), false, true];
  const runtime = await scalarRuntime(t, artifact);
  const traces = inputs.map((add, index) => runtime.step(healthyObservations(artifact,
    { nowMs: index, inputs: { add } }, index)).vm);
  const native = nativeScalar(t, artifact, traces.map(trace => trace.inputs));
  let count = 0;
  for (const [index, add] of inputs.entries()) {
    if (add) count++;
    assert.equal(traces[index].safe.total, count);
    assert.equal(native[index].trace.safe.total, count);
    assert.equal(traces[index].stateAfter.count, count);
  }
  assert.equal(count, 121);
});

test('Programming E35 offset equality and half-open DateTime boundaries execute in native and WASM', async t => {
  const artifact = await compileSource(example('E35'), { filename: 'E35.ghost.md' });
  const start = Date.parse('2026-09-30T06:30:00+09:00'), end = start + 300_000;
  const instants = [start - 1, start, end - 1, end];
  const runtime = await scalarRuntime(t, artifact);
  const traces = instants.map((now, index) => runtime.step(healthyObservations(artifact,
    { nowMs: index, inputs: { now } }, index)).vm);
  const native = nativeScalar(t, artifact, traces.map(trace => trace.inputs));
  for (const [index, now] of instants.entries()) {
    assert.deepEqual(traces[index].safe, { in_window: index === 1 || index === 2, same_instant: true });
    assert.deepEqual(native[index].trace.safe, traces[index].safe);
  }
});

test('Programming E36 executes explicit Solar fallback, held-clock expiry and recovery deduplication', async t => {
  const artifact = await compileSource(example('E36'), { filename: 'E36.ghost.md' });
  const site = artifact.manifest.schedules[0].site;
  const fallback = 23_400_000;
  const facts = (monotonicMs, trusted, available = false) => ({
    clock: { monotonicMs, bootEpoch: 7, wallMs: trusted ? fallback - 1000 + monotonicMs : 1,
      trusted, uncertaintyMs: 0, sourceRevision: 'book-clock-v1', ...(!trusted ? { unknownReason: 'TrustExpired' } : {}) },
    schedules: [{ site, coverageFromWallMs: 0, coverageToWallMs: 86_400_000,
      rows: [{ sourceDay: 0, scheduledWallMs: available ? fallback + 121_000 : null, available,
        providerRevision: available ? 'solar-v2' : 'solar-v1', contextRevision: 'book-site-v1',
        fallbackWallMs: available ? null : fallback, unavailableReason: available ? null : 2 }] }],
  });
  const rows = [[0, true, false], [1000, false, false], [2000, false, false],
    [120_000, false, false], [122_000, true, true]].map(([nowMs, trusted, available]) => ({
      nowMs, inputs: { enabled: true }, solarFacts: facts(nowMs, trusted, available),
    }));
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { solar: { bootEpoch: 7, terminalCapacity: 16 } });
  t.after(() => runtime.dispose());
  const traces = rows.map((row, index) => runtime.step(healthyObservations(artifact, row, index)).vm);
  assert.deepEqual(traces.map(trace => trace.safe.start), [false, true, false, false, false]);
  assert.equal(traces[1].scheduleTrace[0].observations[0].fallback, true);
  assert.match(JSON.stringify(traces[1].scheduleTrace), /HeldClock/);
  assert.match(JSON.stringify(traces[3].scheduleTrace), /ClockUnknown|TrustExpired/);
  const directory = workspace(t), module = path.join(directory, 'solar.gfb'), tape = path.join(directory, 'solar.json');
  fs.writeFileSync(module, artifact.bytes); fs.writeFileSync(tape, JSON.stringify({ bootEpoch: 7, terminalCapacity: 16,
    scans: rows.map((row, index) => ({ ...row, inputs: traces[index].inputs })) }));
  const native = execFileSync(executable('solar_tape'), [module, tape], { encoding: 'utf8', timeout: 20_000 })
    .trim().split('\n').map(JSON.parse);
  assert.ok(native.every(row => row.accepted));
  assert.deepEqual(native.map(row => row.trace.safe), traces.map(trace => trace.safe));
  assert.deepEqual(native.map(row => row.trace.scheduleTrace), traces.map(trace => trace.scheduleTrace));
});

test('Programming E37 requires a Tide provider and executes cancellation without re-admission', async t => {
  const artifact = await compileSource(example('E37'), { filename: 'E37.ghost.md' });
  await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact), /context activation profile is required/);
  const binding = { kind: 'tide', provider: 'harbor_tides', namespace: 'book-tide', station: 'virtual-harbor',
    bindingRevision: 'book-binding-v1', location: 'virtual-site', timezone: 'UTC', criteria: 'high', maxUncertaintyMs: 0 };
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { context: { bootEpoch: 7, terminalCapacity: 8, bindings: [binding] } });
  t.after(() => runtime.dispose());
  const site = artifact.manifest.schedules[0].site;
  const rows = [[0, false], [1000, false], [2000, true], [3000, false]].map(([nowMs, stop]) => ({
    nowMs, inputs: { allowed: true, stop }, contextFacts: {
      clock: { monotonicMs: nowMs, bootEpoch: 7, wallMs: nowMs, uncertaintyMs: 0, trusted: true,
        unknownReason: null, sourceRevision: 'book-clock-v1' }, natural: [], settings: null,
      schedules: [{ site, coverageStartMs: 0, coverageEndMs: 700_000, calendar: null,
        provider: { binding, providerRevision: 'tide-v1', coverageStartMs: 0, coverageEndMs: 700_000,
          expiresAtMs: 700_001, uncertaintyMs: 0, fault: null, classifications: ['high'] },
        rows: [{ sourceDay: 0, slotKey: 0, minuteOfDay: 0, fold: 0, eventId: 'stable-high-1',
          eventKind: 'high', instantMs: 1_801_000, withdrawn: false,
          providerRevision: 'tide-v1', contextRevision: 'book-site-v1' }] }],
    },
  }));
  const traces = rows.map((row, index) => runtime.step(healthyObservations(artifact, row, index)).vm);
  assert.deepEqual(traces.map(trace => trace.safe.pump), [false, true, false, false]);
  assert.ok(traces[2].contextTrace.some(observation => /Cancel/.test(observation.decision)));
});
