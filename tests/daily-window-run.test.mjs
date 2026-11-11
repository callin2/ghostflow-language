import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { atSource } from './helpers/at-source.mjs';

const DAY = 86_400_000;
const planned = Date.UTC(2026, 0, 1, 8);
const activation = { bootEpoch: 1, terminalCapacity: 16, bindings: [] };
const source = atSource({
  declarations: 'input allow: Bool; input cancel: Bool;',
  output: 'output active: Bool; output missed: Bool; alarm <- appointment.due; active <- appointment.PROJECTION; missed <- appointment.missed;',
})
  .replace('appointment: At', 'appointment: Daily')
  .replace(/at = datetime[^;]+;/, 'timezone = "UTC"; at = time`08:00`; dst_missing = skip; dst_repeated = first;');

async function parity(policy, projection, steps, expected) {
  const artifact = await compileSource(source.replace('basis = pulse;', policy).replace('PROJECTION', projection),
    { filename: 'daily-window-run.ghost.md' });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v28');
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-daily-'));
  try {
    const frames = steps.map(([mono, delta, allow, cancel = false], scanId) => {
      const inputs = artifact.manifest.sensors.flatMap(sensor => [
        { name: sensor.valueInput, type: 'Bool', value: sensor.name === 'allow' ? allow : cancel },
        { name: sensor.okInput, type: 'Bool', value: true },
        { name: sensor.faultInput, type: 'Number', value: 0 },
      ]);
      const clock = { monotonicMs: mono, bootEpoch: 1, wallMs: delta === null ? null : planned + delta,
        uncertaintyMs: 0, trusted: delta !== null, unknownReason: delta === null ? 'ClockUnknown' : null,
        sourceRevision: 'utc-test' };
      return { scanId, logicalTimeMs: mono, inputs, clock, natural: [], schedules: [], settings: null };
    });
    const artifactPath = path.join(dir, 'daily.gfb');
    writeArtifact(artifact, artifactPath);
    const tapePath = path.join(dir, 'tape.json');
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-periodic-v1', activation, steps: frames }));
    const exe = new URL('../target/release/examples/context_tape', import.meta.url);
    const native = spawnSync(exe.pathname, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10000 });
    assert.equal(native.status, 0, native.stderr || native.error?.message);
    const rows = native.stdout.trim().split('\n').map(JSON.parse);
    const traces = frames.map((frame, i) => {
      const [mono, , allow, cancel = false] = steps[i];
      const samples = Object.fromEntries(Object.entries({ allow, cancel }).map(([name, value]) =>
        [name, { epoch: 1, id: i + 1, timestampMs: mono, quality: 'Good', value }]));
      return runtime.step({ nowMs: mono, samples, contextFacts: { clock: frame.clock, natural: [], schedules: [], settings: null } }).vm;
    });
    assert.deepEqual(traces.map(t => [t.safe.alarm, t.safe.active, t.safe.missed]), expected);
    rows.forEach((row, i) => {
      assert.equal(row.accepted, true);
      assert.deepEqual(row.outcome.trace, traces[i]);
    });
  } finally {
    runtime.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Daily Window follows predicate and admits only once per occurrence', async () => {
  await parity('basis = window(10ms);', 'open', [
    [0, -1, true], [1, 0, false], [2, 1, true], [3, 2, false], [4, 3, true],
    [11, 10, true], [DAY, DAY - 1, true], [DAY + 1, DAY, true],
  ], [
    [false,false,false], [false,false,false], [true,true,false], [false,false,false], [false,true,false],
    [false,false,false], [false,false,false], [true,true,false],
  ]);
});

test('Daily Run ends on monotonic deadline or cancellation and never rearms', async () => {
  await parity('basis = run(10ms, on_time); cancel_when = (cancel |> recover(false));', 'active', [
    [0, -1, true], [1, 0, true], [2, null, true], [3, 5, false], [11, 12, true],
    [DAY, DAY - 1, true], [DAY + 1, DAY, true], [DAY + 2, DAY + 1, true, true],
    [DAY + 3, DAY + 2, true],
  ], [
    [false,false,false], [true,true,false], [false,true,false], [false,true,false], [false,false,false],
    [false,false,false], [true,true,false], [false,false,false], [false,false,false],
  ]);
});
