import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const filename = 'examples/curriculum/pc-05-limit-feedback.ghost.md';
const artifact = compileSourceSync(fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8'), { filename });
// Phase tags retain the original source declaration order.
const phase = { Stopped: 0, Closed: 1, SensorConflict: 7 };
for (const framed of [false, true]) {
  const instantiate = () => (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate).call(ControlRuntime, wasm, artifact);
  test(`PC05/${framed ? 'framed' : 'plain'}: original healthy replay checkpoints remain`, async () => {
    const scenario = JSON.parse(fs.readFileSync(new URL('../examples/curriculum/replay-scenarios.json', import.meta.url), 'utf8')).scenarios.find(entry => entry.id === 'PC-05');
    const runtime = await instantiate();
    try {
      for (const [index, frame] of scenario.frames.entries()) {
        const trace = runtime.step({ nowMs: frame.atMs, samples: Object.fromEntries(Object.entries(frame.inputs).map(([name, value]) => [name, { epoch: 1, id: index + 1, timestampMs: frame.atMs, quality: 'Good', value }])) });
        const checkpoint = scenario.checkpoints.find(entry => entry.frame === index);
        if (checkpoint) { assert.deepEqual(trace.vm.requested, checkpoint.requested); assert.deepEqual(trace.vm.safe, checkpoint.safe); }
      }
    } finally { runtime.dispose(); }
  });
  for (const quality of ['NotReady', 'Disconnected', 'Stale', 'Invalid']) for (const unavailable of ['open_limit', 'close_limit', 'stop_ok', 'overload_ok']) {
    test(`PC05/${framed ? 'framed' : 'plain'}: producer ${quality} ${unavailable} is unavailable rather than false position/conflict`, async () => {
      const runtime = await instantiate();
      let id = 0;
      const step = (values, faults = {}) => {
        const sampleId = ++id;
        const inputs = { open_request: false, close_request: false, open_limit: false, close_limit: true, stop_ok: true, overload_ok: true, ...values };
        return runtime.step({ nowMs: sampleId, samples: Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, { epoch: 1, id: sampleId, timestampMs: sampleId, quality: faults[name] ?? 'Good', value }])) });
      };
      try {
        assert.equal(step({}).vm.stateAfter.phase, phase.Closed);
        assert.equal(step({ open_request: true }).vm.safe.valve_open_contactor, true);
        const fault = step({ open_limit: true, close_limit: true }, { [unavailable]: quality });
        assert.equal(fault.sensors[unavailable].quality, quality);
        assert.equal(fault.vm.stateAfter.phase, phase.Stopped);
        assert.deepEqual(fault.vm.safe, { valve_open_contactor: false, valve_close_contactor: false });
        assert.equal(step({ open_limit: true, close_limit: true }).vm.stateAfter.phase, phase.SensorConflict, 'only actual healthy asserted limits conflict');
        assert.equal(step({ open_limit: false, close_limit: false }).vm.stateAfter.phase, phase.Stopped, 'healthy false is a known between-limits observation');
      } finally { runtime.dispose(); }
    });
  }
  for (const quality of ['NotReady', 'Disconnected', 'Stale', 'Invalid']) for (const request of ['open_request', 'close_request']) {
    test(`PC05/${framed ? 'framed' : 'plain'}: ${quality} ${request} cannot create or rearm a request`, async () => {
      const runtime = await instantiate();
      let id = 0;
      const step = (pressed, unavailable = false) => {
        const sampleId = ++id;
        const inputs = { open_request: false, close_request: false, open_limit: false, close_limit: false, stop_ok: true, overload_ok: true, [request]: pressed };
        return runtime.step({ nowMs: sampleId, samples: Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, { epoch: 1, id: sampleId, timestampMs: sampleId, quality: unavailable && name === request ? quality : 'Good', value }])) });
      };
      const output = request === 'open_request' ? 'valve_open_contactor' : 'valve_close_contactor';
      try {
        step(false, true);
        assert.equal(step(true).vm.safe[output], false, 'unavailable request release cannot arm');
        step(false);
        assert.equal(step(true).vm.safe[output], true);
        assert.equal(step(true, true).vm.safe[output], true, 'healthy position and protection permit an already requested move');
      } finally { runtime.dispose(); }
    });
  }
}
