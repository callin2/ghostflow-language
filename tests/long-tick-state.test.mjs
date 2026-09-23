import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const root = path.resolve(new URL('../', import.meta.url).pathname);
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const native = path.join(root, 'target/release/examples/run');
const source = `# Long tick state

\`\`\`ghost
control LongTickState {
  input start, stop: Bool;
  config dwell: Duration = 1s;
  type Phase = Idle | One | Two;
  state phase: Phase = Idle;
  timer age = elapsed(phase);
  phase' = case phase {
    Idle => if start then One else Idle;
    One => if age >= dwell then Two else One;
    Two => if stop || age >= dwell then Idle else Two;
  };
  output one, two, idle: Bool;
  output age_value: Duration;
  one <- phase == One;
  two <- phase == Two;
  idle <- phase == Idle;
  age_value <- age;
}
\`\`\`\n`;

test('long logical-time jumps commit one finite state phase per accepted tick on native and WASM', async t => {
  const artifact = await compileSource(source, { filename: 'long-tick-state.ghost.md' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-long-tick-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const modulePath = path.join(dir, 'module.gfb');
  const csvPath = path.join(dir, 'inputs.csv');
  fs.writeFileSync(modulePath, artifact.bytes);
  fs.writeFileSync(csvPath, 'start,stop,__gf_now_ms\ntrue,false,0\nfalse,false,5000\nfalse,false,5000\nfalse,false,10000\nfalse,true,20000\n');
  const outcomes = execFileSync(native, [modulePath, csvPath, '--outcomes'], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
  assert.deepEqual(outcomes.map(row => row.trace.safe), [
    { age_value: 0, idle: true, one: false, two: false },
    { age_value: 5000, idle: false, one: true, two: false },
    { age_value: 0, idle: false, one: false, two: true },
    { age_value: 5000, idle: false, one: false, two: true },
    { age_value: 10000, idle: true, one: false, two: false },
  ]);
  assert.deepEqual(outcomes.map(row => row.trace.stateAfter.phase), [1, 2, 2, 0, 0]);
  const runtime = await GhostFlowRuntime.instantiate(wasm);
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  for (const name of ['one', 'two', 'idle']) runtime.addCapability('actuator', name, 'bool');
  runtime.addCapability('actuator', 'age_value', 'number');
  runtime.activate();
  for (const [index, [nowMs, start, stop, expected]] of [
    [0, true, false, [true, false, false]], [5000, false, false, [false, true, false]],
    [5000, false, false, [false, false, true]], [10000, false, false, [false, false, true]],
    [20000, false, true, [true, false, false]],
  ].entries()) {
    runtime.setBool('start', start); runtime.setBool('stop', stop); runtime.tickAt(nowMs);
    assert.equal(runtime.trace.stateAfter.phase, [1, 2, 2, 0, 0][index]);
    assert.deepEqual(['idle', 'one', 'two'].map(name => runtime.intentBool(name)), expected);
    assert.equal(runtime.intentNumber('age_value'), [0, 5000, 0, 5000, 10000][index]);
  }
});
