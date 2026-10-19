import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { softwareQualityRails } from './helpers/software-quality-observations.mjs';

const root = new URL('../', import.meta.url);
const compile = code => compileSourceSync(`\`\`\`ghost\n${code}\n\`\`\`\n`, { filename: 'humidity-ratio.ghost.md' });

test('RH ratio accepts constants and dynamic operands without losing nominal inputs', () => {
  const compiled = compile(`control Normalize {
    input humidity, reference: RelativeHumidity;
    output ratio, dry, wet: Number;
    // This explicit fixture revision retains its last ratio when no observation is available.
    state last_ratio: Number = 0;
    last_ratio' = case humidity { ok(h) => case reference { ok(r) => h / r; fault(_) => last_ratio; }; fault(_) => last_ratio; };
    ratio <- last_ratio';
    dry <- 0%RH / 100%RH;
    wet <- 100%RH / 100%RH;
  }`);
  assert.equal(compiled.manifest.sensors[0].type, 'RelativeHumidity');
  assert.equal(compiled.manifest.outputs[0].type, 'Number');
  assert.ok(compiled.bytes.length > 0);
});

test('RH ratio constant zero divisor retains the existing diagnostic', () => {
  assert.throws(() => compile('control Zero { let ratio = 50%RH / 0%RH; }'), /constant division by zero/);
});

test('RH ratio does not permit other humidity arithmetic or erase nominal boundaries', () => {
  for (const expression of ['50%RH + 20%RH', '50%RH - 20%RH', '-(50%RH)',
    '50%RH * 2', '2 * 50%RH', '50%RH / 2', '50%RH / 1kPa',
    '50%RH / 50%', '50%RH / 0.5', '800ppm / 400ppm', '7pH / 7pH']) {
    assert.throws(() => compile(`control RejectedHumidity { let value = ${expression}; }`), /not defined|non-negative/,
      expression);
  }
  assert.throws(() => compile('control Implicit { output humidity: Number; humidity <- 50%RH; }'), /Number/);
});

test('RH ratio native/WASM execution agrees on boundaries, dynamic zero and recovery', async t => {
  const compiled = compile(`control Normalize {
    input humidity, reference: RelativeHumidity;
    output ratio: Number;
    state last_ratio: Number = 0;
    last_ratio' = case humidity { ok(h) => case reference { ok(r) => h / r; fault(_) => last_ratio; }; fault(_) => last_ratio; };
    ratio <- last_ratio';
  }`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'humidity-ratio-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const artifact = path.join(temp, 'ratio.gfb'), csv = path.join(temp, 'inputs.csv');
  fs.writeFileSync(artifact, compiled.bytes);
  const rows = [[0, 1], [1, 1], [0.6, 1], [0.6, 0], [0.4, 1]];
  const acquired = rows.map(([humidity, reference], index) => softwareQualityRails(compiled, { humidity, reference }, index + 1, index));
  const names = Object.keys(acquired[0]);
  fs.writeFileSync(csv, names.join(',') + '\n' + acquired.map(row => names.map(name => row[name]).join(',')).join('\n') + '\n');
  const native = execFileSync(fileURLToPath(new URL('target/release/examples/run', root)), [artifact, csv, '--outcomes'],
    { encoding: 'utf8' }).trim().split('\n').map(line => JSON.parse(line));
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(new URL('target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', root)));
  t.after(() => runtime.dispose());
  runtime.load(compiled.bytes);
  runtime.addCapability('actuator', 'ratio', 'number');
  for (const sensor of compiled.manifest.sensors) runtime.addCapability('sensor', sensor.name, 'number');
  runtime.activate();
  const outcomes = [];
  for (const observation of acquired) {
    runtime.clearInputs();
    for (const [name, value] of Object.entries(observation)) {
      if (typeof value === 'boolean') runtime.setBool(name, value);
      else runtime.setNumber(name, value);
    }
    try { runtime.tick(); outcomes.push({ status: 'OK', trace: runtime.trace }); }
    catch (error) { outcomes.push({ status: 'ERROR', phase: 'tick', error: error.message, journalLength: runtime.journalLength }); }
  }
  assert.deepEqual(outcomes, native);
  assert.deepEqual(outcomes.map(item => item.status), ['OK', 'OK', 'OK', 'ERROR', 'OK']);
  assert.match(outcomes[3].error, /division|zero/i);
  assert.deepEqual(outcomes.filter(item => item.status === 'OK').map(item => item.trace.safe.ratio), [0, 1, 0.6, 0.4]);
});
