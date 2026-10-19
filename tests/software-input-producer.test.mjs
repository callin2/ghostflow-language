import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { SoftwareInputProducer } from '../tools/software-input-producer.mjs';
import { validateScenario } from '../tools/ghostsim.mjs';

const artifact = await compileSource('```ghost\ncontrol SoftwareObservation { input button: Bool { stale_after = 10ms; } input amount: Number; output on: Bool; on <- button |> recover(false); }\n```\n', { filename: 'software-observation.ghost.md' });
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));

test('software observations preserve healthy false/zero and clock-only scans expire the actual observation', async t => {
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact);
  t.after(() => runtime.dispose());
  const producer = new SoftwareInputProducer(artifact.manifest);
  assert.equal(runtime.step({ nowMs: 0 }).sensors.button.quality, 'NotReady');
  const first = producer.stage({ button: false, amount: 0 }, 1);
  const accepted = runtime.step({ nowMs: 1, inputs: first.inputs, samples: first.samples });
  first.commit();
  assert.equal(accepted.sensors.button.ok, true);
  assert.equal(accepted.sensors.button.value, false);
  assert.equal(accepted.sensors.amount.ok, true);
  assert.equal(accepted.sensors.amount.value, 0);
  const clock = producer.stage({}, 12);
  assert.deepEqual(clock.samples, {});
  assert.equal(runtime.step({ nowMs: 12, samples: clock.samples }).sensors.button.quality, 'Stale');
});

test('a malformed software observation rejects atomically and retry retains its producer identity', async t => {
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact);
  t.after(() => runtime.dispose());
  const producer = new SoftwareInputProducer(artifact.manifest);
  const bad = producer.stage({ button: 'false' }, 0);
  assert.throws(() => runtime.step({ nowMs: 0, samples: bad.samples }), /boolean|Bool|bool/);
  const good = producer.stage({ button: false }, 0);
  assert.equal(good.samples.button.id, bad.samples.button.id);
  assert.equal(runtime.step({ nowMs: 0, samples: good.samples }).sensors.button.ok, true);
  good.commit();
  assert.equal(producer.stage({ button: false }, 1).samples.button.id, 2);
});

test('scenario admission rejects mixed producer channels across separate scans without inventing metadata', () => {
  const scenario = {
    format: 'GhostFlow/scenario-v1', id: 'mixed', initialInputs: [{ name: 'button', type: 'Bool', value: false }],
    keyBindings: [], actions: [{ kind: 'scan', atMs: 0 },
      { kind: 'sample', name: 'button', epoch: 1, id: 1, timestampMs: 1, value: true, quality: 'Good' },
      { kind: 'scan', atMs: 1 }],
  };
  assert.throws(() => validateScenario(scenario, artifact.manifest), /multiple acquisition producers/);
  assert.equal(validateScenario({ ...scenario, initialInputs: [], actions: [{ kind: 'scan', atMs: 0 }] }, artifact.manifest), 1);
});
