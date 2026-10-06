import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { createLiveSession } from '../tools/ghostsim-live.mjs';

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-live-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'timer.gfb');
  writeArtifact(await compileSource(`\`\`\`ghost
control Live {
  input enabled: Bool;
  state count: Int = 0;
  count' = count + 1;
  state active: Bool = false;
  active' = enabled |> recover(false);
  timer age = elapsed(active);
  output expired, pump, permit: Bool;
  expired <- age >= 2000ms;
  pump <- enabled |> recover(false);
  permit <- false;
  require pump => permit;
}
\`\`\`\n`, { filename: 'live.ghost.md' }), artifact);
  return artifact;
}
const inputs = [{ name: 'enabled', type: 'Bool', value: true }];

test('live scans start at zero, advance timers, and retain state beyond 256 scans', async t => {
  const session = await createLiveSession(await fixture(t));
  t.after(() => session.dispose());
  const scans = [0, 1999, 2000].map(time => session.scan(time, inputs));
  assert.deepEqual(scans.map(row => row.scanId), [0, 1, 2]);
  assert.deepEqual(scans.map(row => row.safeVirtualIntent.expired), [false, false, true]);
  assert.equal(scans[0].requestedVirtualIntent.pump, true);
  assert.equal(scans[0].safeVirtualIntent.pump, false);
  let last;
  for (let id = 3; id < 300; id++) last = session.scan(2000 + id, inputs);
  assert.equal(last.scanId, 299);
  assert.equal(last.stateBefore.count, 299);
  assert.equal(last.stateAfter.count, 300);
  assert.equal(last.safeVirtualIntent.expired, true);
  assert.throws(() => session.scan(0, inputs), /backwards/);
  const clockOnly = session.scan(2300, []);
  assert.equal(clockOnly.scanId, 300);
  assert.equal(clockOnly.stateAfter.count, 301);
  assert.equal(clockOnly.inputs.__gf_sensor_value_enabled, last.inputs.__gf_sensor_value_enabled,
    'clock-only scans retain the last observation instead of supplying a synthetic value');
  assert.throws(() => session.scan(2300, [{ ...inputs[0], type: 'Number', value: 1 }]), /type mismatch/);
  assert.equal(session.scan(2300, inputs).scanId, 301);
  session.dispose();
  assert.throws(() => session.scan(2301, inputs), /disposed/);
});

test('live artifact identity is verified before runtime creation or activation', async t => {
  const artifact = await fixture(t);
  const bytes = fs.readFileSync(artifact);
  bytes[bytes.length - 1] ^= 1;
  fs.writeFileSync(artifact, bytes);
  let calls = 0;
  t.mock.method(FramedGhostFlowRuntime, 'instantiate', async () => { calls++; throw new Error('must not instantiate'); });
  await assert.rejects(createLiveSession(artifact), /hash|SHA|digest|bytecode/i);
  assert.equal(calls, 0);
});
