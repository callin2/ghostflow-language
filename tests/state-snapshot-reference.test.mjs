import { softwareQualityRails } from './helpers/software-quality-observations.mjs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const nativePath = path.join(root, 'target/release/examples/run' + (process.platform === 'win32' ? '.exe' : ''));
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const header = '# State snapshot reference\n\n' + String.fromCharCode(96, 96, 96) + 'ghost\n';
const footer = String.fromCharCode(96, 96, 96) + '\n';
const variants = [
  ['left then right', `state left: Bool = true;
  state right: Bool = false;
  let derived = swap |> recover(false);
  let live = derived;
  left' = if (swap |> recover(false)) then right else left;
  right' = if (swap |> recover(false)) then left else right;`],
  ['right then left', `state left: Bool = true;
  state right: Bool = false;
  let live = derived;
  let derived = swap |> recover(false);
  right' = if (swap |> recover(false)) then left else right;
  left' = if (swap |> recover(false)) then right else left;`],
];
const inputs = [true, false, true];
const expectedStates = [
  { left: false, right: true },
  { left: false, right: true },
  { left: true, right: false },
];
const expected = [
  { old_left: true, new_left: false, live_value: true },
  { old_left: false, new_left: false, live_value: false },
  { old_left: false, new_left: true, live_value: true },
];

for (const [label, body] of variants) {
  test(`REF-01-093/094 state snapshot ${label}`, async t => {
    const source = `${header}control SnapshotReference {
  input swap: Bool;
  output old_left, new_left, live_value: Bool;
  ${body}
  old_left <- left;
  new_left <- left';
  live_value <- live;
}
${footer}`;
    const artifact = await compileSource(source, { filename: `state-snapshot-${label}.ghost.md` });
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-state-snapshot-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const modulePath = path.join(temporary, 'snapshot.gfb');
    const inputPath = path.join(temporary, 'snapshot.csv');
    fs.writeFileSync(modulePath, artifact.bytes);
    const railRows = inputs.map(swap => softwareQualityRails(artifact, { swap }));
    const railNames = Object.keys(railRows[0]);
    fs.writeFileSync(inputPath, `${railNames.join(',')}\n${railRows.map(row => railNames.map(name => row[name]).join(',')).join('\n')}\n`);
    const native = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
    const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
    t.after(() => runtime.dispose());
    runtime.load(artifact.bytes);
    for (const name of ['old_left', 'new_left', 'live_value']) runtime.addCapability('actuator', name, 'bool');
    runtime.activate();
    for (const [index, swap] of inputs.entries()) {
      await t.test(`tick ${index + 1}`, () => {
        assert.equal(native[index].status, 'OK');
        assert.deepEqual(native[index].trace.stateAfter, expectedStates[index]);
        const actualNative = native[index].trace.safe;
        assert.deepEqual({ old_left: actualNative.old_left, new_left: actualNative.new_left, live_value: actualNative.live_value }, expected[index]);
        for (const [name, value] of Object.entries(railRows[index])) typeof value === 'boolean' ? runtime.setBool(name, value) : runtime.setNumber(name, value);
        runtime.tick();
        assert.deepEqual(runtime.trace.stateAfter, expectedStates[index]);
        assert.deepEqual({ old_left: runtime.intentBool('old_left'), new_left: runtime.intentBool('new_left'), live_value: runtime.intentBool('live_value') }, expected[index]);
      });
    }
  });
}
