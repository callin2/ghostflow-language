#!/usr/bin/env node
// Executable tutorial; every output in this file is virtual.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileSource, writeArtifact } from './toolchain.mjs';
import { extractLiterate } from './literate.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { DailySlots } from '../runtimes/wasm/schedule.mjs';
import { runStationDemo } from './station-demo.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const build = path.join(root, 'build/tutorial');
const wasmFile = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const native = path.join(root, 'target/debug/examples/run');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120_000 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr}\n${result.stdout}`, { cause: result.error });
  return result.stdout;
}
if (!process.argv.includes('--no-build')) {
  run('cargo', ['build', '-p', 'ghostflow-core', '--example', 'run']);
  run('cargo', ['build', '-p', 'ghostflow-wasm', '--target', 'wasm32-unknown-unknown', '--release']);
}
fs.mkdirSync(build, { recursive: true });
const wasm = fs.readFileSync(wasmFile);
const evidence = { format: 'GhostFlow/tutorial-evidence-v1', generatedAt: new Date().toISOString(), platform: `${os.platform()}/${os.arch()}`, virtualOnly: true, hardware: 'deferred-by-user', scenarios: [] };

async function artifact(name) {
  const filename = `examples/tutorial/${name}.ghost.md`;
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  const compiled = await compileSource(source, { filename });
  const output = path.join(build, `${name}.gfb`);
  writeArtifact(compiled, output);
  return { ...compiled, filename, source, output };
}

// The native runner consumes exactly the VM input snapshot recorded by the WASM
// host (including generated sensor/clock ports); the core execution must agree.
function nativeParity(compiled, traces) {
  const columns = Object.keys(traces[0].vm.inputs).sort();
  const csv = [columns.join(','), ...traces.map(row => columns.map(key => row.vm.inputs[key]).join(','))].join('\n') + '\n';
  const file = `${compiled.output}.inputs.csv`;
  fs.writeFileSync(file, csv);
  const nativeRows = run(native, [compiled.output, file]).trim().split('\n').map(JSON.parse);
  assert.deepEqual(nativeRows, traces.map(row => row.vm), 'native and WASM VM traces must match exactly');
  fs.writeFileSync(`${compiled.output}.trace.json`, JSON.stringify(traces, null, 2) + '\n');
  return { name: compiled.manifest.name, bytecodeBytes: compiled.bytes.length, bytecodeSha256: compiled.manifest.bytecodeSha256, ticks: traces.length, nativeWasmParity: true, source: compiled.filename, trace: path.relative(root, `${compiled.output}.trace.json`) };
}

const latch = await artifact('01-latch');
const markdown = fs.readFileSync(path.join(root, 'examples/tutorial/01-latch.ghost.md'), 'utf8');
assert.equal(latch.source, markdown);
assert.ok(extractLiterate(markdown, { filename: 'examples/tutorial/01-latch.ghost.md' }).code.length > 0);
assert.deepEqual((await compileSource(markdown, { filename: 'examples/tutorial/01-latch.ghost.md' })).bytes, latch.bytes);
const latchRuntime = await ControlRuntime.instantiate(wasm, latch);
const latchRows = [[true, false], [false, false], [true, true], [false, false], [true, false]]
  .map(([start, stop], nowMs) => latchRuntime.step({ nowMs, inputs: { start, stop } }));
assert.deepEqual(latchRows.map(row => row.vm.safe.pump), [true, true, false, false, true]);
evidence.scenarios.push({ ...nativeParity(latch, latchRows), literateIdentical: true, checks: ['latch', 'stop-wins', 'pump-requires-valve'] });
latchRuntime.dispose();

const watering = await artifact('02-watering');
const wateringRuntime = await ControlRuntime.instantiate(wasm, watering);
const scheduler = new DailySlots(watering.manifest.schedules[0]);
const six = Date.parse('2026-09-05T06:00:00+09:00');
assert.equal(scheduler.poll({ nowMs: 0, wallMs: six - 1000 }).due, false);
const occurrence = scheduler.poll({ nowMs: 1000, wallMs: six });
assert.equal(occurrence.due, true);
const times = [0, 1000, 3000, 303000, 305000, 307000, 309000, 609000, 611000];
const wateringRows = times.map(nowMs => wateringRuntime.step({ nowMs, due: { starts: nowMs === 1000 && occurrence.due } }));
assert.deepEqual(wateringRows.map(row => row.vm.stateAfter.phase), [0, 1, 2, 3, 4, 5, 6, 7, 0]);
assert.deepEqual(wateringRows.map(row => row.vm.safe.pump), [false, false, true, false, false, false, true, false, false]);
for (const row of wateringRows) {
  const { pump, valve1, valve2 } = row.vm.safe;
  assert.ok(!pump || valve1 || valve2); assert.ok(!(valve1 && valve2));
}
evidence.scenarios.push({ ...nativeParity(watering, wateringRows), occurrence: occurrence.occurrence, timesMs: times, checks: ['15-minute-slot', 'sequential-valves', 'elapsed-timer', 'final-safe-output'] });
wateringRuntime.dispose();

const moisture = await artifact('03-moisture');
const moistureRuntime = await ControlRuntime.instantiate(wasm, moisture);
const moistureRows = [];
function moistureStep(nowMs, value, start = false, quality = 'Good') {
  const samples = value === undefined ? {} : { moisture: { epoch: 1, id: nowMs + 1, timestampMs: nowMs, value, quality } };
  const result = moistureRuntime.step({ nowMs, inputs: { start, stop: false }, samples });
  moistureRows.push(result); return result;
}
[28, 29, 90, 28, 29].forEach((value, index) => moistureStep(index * 1000, value, index === 4));
assert.deepEqual(moistureRows.map(row => row.vm.safe.pump), [false, false, false, false, true]);
assert.equal(moistureRows[4].sensors.moisture.value, 29);
assert.equal(moistureStep(5000, 29, false, 'Disconnected').vm.safe.pump, false);
for (let tick = 6; tick <= 10; tick++) assert.equal(moistureStep(tick * 1000, 29).vm.safe.pump, false, 'recovery cannot recreate a lost start');
assert.equal(moistureStep(11000, 29, true).vm.safe.pump, true);
assert.equal(moistureStep(15000).vm.safe.pump, false);
assert.equal(moistureRows.at(-1).sensors.moisture.quality, 'Stale');
evidence.scenarios.push({ ...nativeParity(moisture, moistureRows), checks: ['median-noise', 'NotReady', 'hysteresis', 'Disconnected-safe', 'recovery-no-restart', 'Stale-safe'] });
moistureRuntime.dispose();

const extraValves = await artifact('04-extra-valves');
const shared = await runStationDemo({ wasm, first: watering, second: extraValves, root, build });
evidence.scenarios.push({ ...nativeParity(extraValves, shared.secondRows), checks: ['added-control', 'two-new-valves', 'shared-pump-binding'] });
evidence.scenarios.push(shared.result);

// Replay is a new isolated virtual runtime, never a command to the original.
const replay = await ControlRuntime.instantiate(wasm, latch);
const replayRows = [[true, false], [false, false], [true, true], [false, false], [true, false]]
  .map(([start, stop], nowMs) => replay.step({ nowMs, inputs: { start, stop } }));
assert.deepEqual(replayRows, latchRows);
replay.dispose();
evidence.scenarios.push({ name: 'GhostReplay', ticks: replayRows.length, checks: ['isolated-runtime', 'deterministic-trace', 'no-physical-driver'] });

fs.writeFileSync(path.join(build, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
