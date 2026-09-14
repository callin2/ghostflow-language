import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { SolarSchedule } from '../runtimes/wasm/schedule.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const nativePath = path.join(root, 'target/release/examples/scan_adapter');
const sourcePath = path.join(root, 'examples/solar-watering.ghost.md');

test('GF-TEST-solar-scanframe-native-wasm: actual Solar GFB replays one calendar tape across framed targets', async t => {
  assert.ok(fs.existsSync(wasmPath), 'release WASM artifact is required; run npm test');
  assert.ok(fs.existsSync(nativePath), 'release native ScanFrame adapter is required; run npm test');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const artifact = await compileSource(source, { filename: 'examples/solar-watering.ghost.md' });
  const noon = Date.parse('2026-09-14T12:00:00+09:00');
  const inputs = Object.fromEntries(artifact.manifest.inputs.map(item => [item.name, false]));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-solar-scanframe-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'solar-scanframe.gfb');
  fs.writeFileSync(modulePath, artifact.bytes);

  for (const [target, output] of [['dawn', 'RO2'], ['dusk', 'RO4']]) {
    const hosts = Object.fromEntries(artifact.manifest.schedules.map(item => [item.name, new SolarSchedule(item)]));
    const event = hosts[target].preview(noon).scheduledWallMs;
    const calendar = [];
    const step = (nowMs, wallMs, trusted, label) => {
      const solar = Object.fromEntries(Object.entries(hosts).map(([name, host]) => [name, host.poll({ nowMs, wallMs, trusted })]));
      const due = Object.fromEntries(Object.entries(solar).map(([name, result]) => [name, result.due]));
      calendar.push({ nowMs, due, solar, label });
    };
    step(0, event - 1_000, true, `${target}-baseline`);
    step(1_000, event, true, `${target}-pulse`);
    step(2_000, event + 1_000, false, `${target}-untrusted-timer`);
    step(301_000, event + 2_000, false, `${target}-untrusted-expiry`);
    step(302_000, event + 3_000, true, `${target}-recovery-baseline`);
    step(303_000, event + 2_000, true, `${target}-rollback`);
    assert.deepEqual(calendar.map(row => row.due), [
      { dawn: false, dusk: false }, { dawn: target === 'dawn', dusk: target === 'dusk' },
      { dawn: false, dusk: false }, { dawn: false, dusk: false },
      { dawn: false, dusk: false }, { dawn: false, dusk: false },
    ], target);
    assert.equal(calendar[2].solar[target].reason, 'UntrustedClock', target);
    assert.equal(calendar[3].solar[target].reason, 'UntrustedClock', target);
    assert.equal(calendar[4].solar[target].reason, 'ClockRecoveryBaseline', target);
    assert.equal(calendar[5].solar[target].reason, 'AlreadyObserved', target);

    const wasm = await ControlRuntime.instantiateFramed(fs.readFileSync(wasmPath), artifact, { acceptSolar: true });
    const wasmRows = [];
    try {
      for (const row of calendar) wasmRows.push(wasm.step({ nowMs: row.nowMs, inputs, due: row.due }));
    } finally {
      wasm.dispose();
    }
    assert.deepEqual(wasmRows.map(row => row.vm.safe.RO1), [false, true, true, false, false, false], target);
    assert.deepEqual(wasmRows.map(row => row.vm.safe[output]), [false, true, true, false, false, false], target);

    const tapePath = path.join(temporary, `solar-scanframe-${target}.csv`);
    const columns = Object.keys(wasmRows[0].vm.inputs).filter(name => name !== '__gf_now_ms').sort();
    const tape = ['scan_id,logical_time_ms,' + columns.join(','), ...wasmRows.map((row, index) =>
      [index, calendar[index].nowMs, ...columns.map(name => row.vm.inputs[name])].join(','))];
    fs.writeFileSync(tapePath, tape.join('\n') + '\n');
    const nativeRows = execFileSync(nativePath, [modulePath, tapePath], { encoding: 'utf8' })
      .trim().split('\n').map(JSON.parse);
    assert.deepEqual(nativeRows.map(row => row.trace), wasmRows.map(row => row.vm), target);
    assert.deepEqual(nativeRows.map(row => [row.scanId, row.logicalTimeMs]), calendar.map((row, scanId) => [scanId, row.nowMs]), target);
  }
});
