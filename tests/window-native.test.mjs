import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const nativePath = path.join(root, 'target/release/examples/run');
const usage = 'usage: run <module.gfb> <inputs.csv> [--outcomes] [--temporal EPOCH MAX_SAMPLES MAX_BYTES TAG:MAX_OBSERVATIONS:INTERVAL_MS[,..]] (virtual outputs only)';
const source = `# Native temporal windows

\`\`\`ghost
control NativeWindows {
  input threshold_time: Duration;
  sensor temperature: Temperature;
  signal average_temperature = window_average(temperature, over: 1s, quality: measured, max_age: 1s);
  signal minimum_temperature = window_min(temperature, over: 1s, quality: measured, max_age: 1s);
  signal maximum_temperature = window_max(temperature, over: 1s, quality: measured, max_age: 1s);
  signal temperature_rate = window_rate(temperature, over: 1s, quality: measured, max_age: 1s);
  output average, minimum, maximum: Temperature;
  output fast: Bool;
  average <- average_temperature |> recover(0K);
  minimum <- minimum_temperature |> recover(0K);
  maximum <- maximum_temperature |> recover(0K);
  fast <- temperature_rate |> map(below(rate(delta: 1ΔK, time: threshold_time))) |> recover(false);
}
\`\`\`
`;

async function fixture(t) {
  const artifact = await compileSource(source, { filename: 'window-native.ghost.md' });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-window-native-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'window.gfb');
  const inputPath = path.join(temporary, 'window.csv');
  fs.writeFileSync(modulePath, artifact.bytes);
  const sensor = artifact.manifest.sensors[0];
  const rootTag = artifact.manifest.signals[0].sources[0].tag;
  const header = ['threshold_time', sensor.valueInput, sensor.okInput, sensor.faultInput, '__gf_now_ms', '__gf_time_epoch',
    sensor.samplePresentInput, sensor.sampleEpochInput, sensor.sampleIdInput, sensor.sampleTimestampInput];
  const row = (threshold, now, present, id, timestamp, value = 284) =>
    [threshold, value, true, 0, now, 5, present, 1, id, timestamp].join(',');
  fs.writeFileSync(inputPath, `${header.join(',')}\n${[
    row(1000, 1000, true, 1, 1000, 280),
    row(0, 1400, true, 2, 1400),
    row(1000, 1400, true, 2, 1400),
    row(1000, 2000, false, 2, 1400),
  ].join('\n')}\n`);
  return { artifact, modulePath, inputPath, rootTag };
}

function run(args) {
  return spawnSync(nativePath, args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
}

test('native runner requires a complete, unique, typed temporal profile', async t => {
  const { modulePath, inputPath, rootTag } = await fixture(t);
  const invalid = [
    [modulePath, inputPath, '--bogus'],
    [modulePath, inputPath, '--outcomes', '--outcomes'],
    [modulePath, inputPath, '--temporal', '5', '12', '33554432'],
    [modulePath, inputPath, '--temporal', '5', '12', '33554432', `${rootTag}:3:1000`, '--temporal', '5', '12', '33554432', `${rootTag}:3:1000`],
    [modulePath, inputPath, '--temporal', 'five', '12', '33554432', `${rootTag}:3:1000`],
    [modulePath, inputPath, '--temporal', '5', '12', '33554432', `${rootTag}:3`],
    [modulePath, inputPath, '--temporal', '5', '12', '33554432', `${rootTag}:3:1000,${rootTag}:3:1000`],
  ];
  for (const args of invalid) {
    const result = run(args);
    assert.notEqual(result.status, 0, args.join(' '));
    assert.match(result.stderr, new RegExp(usage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('native runner reports missing temporal activation and a bound below required capacity', async t => {
  const { modulePath, inputPath, rootTag } = await fixture(t);
  const missing = run([modulePath, inputPath, '--outcomes']);
  assert.equal(missing.status, 0);
  assert.deepEqual(JSON.parse(missing.stdout.trim()), {
    status: 'ERROR', phase: 'activate', error: 'temporal activation requires runtime bindings', journalLength: 0,
  });
  const bounded = run([modulePath, inputPath, '--outcomes', '--temporal', '5', '11', '33554432', `${rootTag}:3:1000`]);
  assert.equal(bounded.status, 0);
  assert.deepEqual(JSON.parse(bounded.stdout.trim()), {
    status: 'ERROR', phase: 'activate', error: 'temporal-budget-exceeded', journalLength: 0,
  });
});

test('native temporal windows commit observations atomically and expose exact Rust evidence', async t => {
  const { artifact, modulePath, inputPath, rootTag } = await fixture(t);
  const result = run([modulePath, inputPath, '--outcomes', '--temporal', '5', '12', '33554432', `${rootTag}:3:1000`]);
  assert.equal(result.status, 0, result.stderr);
  const rows = result.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1], { status: 'ERROR', phase: 'tick', error: 'division by zero', journalLength: 1 });
  assert.deepEqual(rows.filter(row => row.status === 'OK').map(row => [row.trace.tick, row.trace.safe]), [
    [1, { average: 280, minimum: 280, maximum: 280, fast: false }],
    [2, { average: 282, minimum: 280, maximum: 284, fast: false }],
    [3, { average: 284, minimum: 284, maximum: 284, fast: false }],
  ]);
  const sites = Object.fromEntries(artifact.manifest.signals.map(signal => [signal.operation, signal.site]));
  const point = (id, timestampMs, value) => ({ sourceTag: rootTag, epoch: 1, id, timestampMs, value });
  const trace = ({ operation, value, count, revision, nowMs, points }) => ({
    site: sites[operation], payloadType: 'number', operation, value, quality: value === null ? 0 : 3,
    count, admissionRevision: revision, timeEpoch: 5, nowMs,
    first: points[0] ?? null, last: points.at(-1) ?? null, contributors: points, upstreamFault: null,
  });
  const p1 = point(1, 1000, 280), p2 = point(2, 1400, 284);
  assert.deepEqual(rows[0].trace.windowTrace, [
    trace({ operation: 'average', value: 280, count: 1, revision: 1, nowMs: 1000, points: [p1] }),
    trace({ operation: 'min', value: 280, count: 1, revision: 1, nowMs: 1000, points: [p1] }),
    trace({ operation: 'max', value: 280, count: 1, revision: 1, nowMs: 1000, points: [p1] }),
    trace({ operation: 'rate', value: null, count: 1, revision: 1, nowMs: 1000, points: [p1] }),
  ]);
  assert.deepEqual(rows[2].trace.windowTrace, [
    trace({ operation: 'average', value: 282, count: 2, revision: 2, nowMs: 1400, points: [p1, p2] }),
    trace({ operation: 'min', value: 280, count: 2, revision: 2, nowMs: 1400, points: [p1, p2] }),
    trace({ operation: 'max', value: 284, count: 2, revision: 2, nowMs: 1400, points: [p1, p2] }),
    trace({ operation: 'rate', value: 10, count: 2, revision: 2, nowMs: 1400, points: [p1, p2] }),
  ]);
  assert.deepEqual(rows[3].trace.windowTrace, [
    trace({ operation: 'average', value: 284, count: 1, revision: 2, nowMs: 2000, points: [p2] }),
    trace({ operation: 'min', value: 284, count: 1, revision: 2, nowMs: 2000, points: [p2] }),
    trace({ operation: 'max', value: 284, count: 1, revision: 2, nowMs: 2000, points: [p2] }),
    trace({ operation: 'rate', value: null, count: 1, revision: 2, nowMs: 2000, points: [p2] }),
  ]);
});
