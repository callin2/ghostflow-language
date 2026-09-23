import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const cases = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url)));
const reference = (Array.isArray(cases) ? cases : cases.cases).find(item => item.id === 'REF-04-035');
const artifact = await compileSource(reference.source, { filename: reference.filename });

test('REF-04-035 explicit absent sensor selects Baseline', async () => {
  const host = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: [] });
  try {
    assert.equal(host.step({ nowMs: 0, inputs: { scheduled: true } }).vm.requested.pump, true);
    assert.equal(host.step({ nowMs: 1, inputs: { scheduled: false } }).vm.requested.pump, false);
  } finally { host.dispose(); }
});

const moisture = { kind: 'sensor', name: 'moisture', type: 'Percent' };
const sample = (id, quality, value) => ({ epoch: 1, id, timestampMs: id, quality, value });

test('REF-04-035 present sensor uses moisture strategy and faults never select Baseline', async () => {
  const host = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: [moisture] });
  try {
    const step = (nowMs, samples = {}) => host.step({ nowMs, inputs: { scheduled: true }, samples }).vm.requested.pump;
    assert.equal(step(0), false, 'present sensor without sample is NotReady, not Baseline');
    assert.equal(step(1, { moisture: sample(1, 'Good', 20) }), true);
    assert.equal(step(2, { moisture: sample(2, 'Good', 40) }), false);
    assert.equal(step(3, { moisture: sample(3, 'Disconnected', 20) }), false);
  } finally { host.dispose(); }
});

test('absent optional capability rejects samples instead of inventing presence', async () => {
  const host = await ControlRuntime.instantiateFramed(wasm, artifact, { capabilities: [] });
  try {
    assert.throws(() => host.step({ nowMs: 1, inputs: { scheduled: true }, samples: { moisture: sample(1, 'Good', 20) } }), /absent sensor capability moisture/);
  } finally { host.dispose(); }
});
