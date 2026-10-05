import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const lessons = [
  ['PC03', 'pc-03-motor-contactor', ['start'], 'motor_contactor'],
  ['PC04', 'pc-04-direction-interlock', ['forward_start', 'reverse_start'], 'forward_contactor'],
];
for (const framed of [false, true]) test(`PC04/${framed ? 'framed' : 'plain'}: reverse START and opposite unavailable request are symmetric`, async () => {
  const filename = 'examples/curriculum/pc-04-direction-interlock.ghost.md';
  const artifact = compileSourceSync(fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8'), { filename });
  for (const quality of ['NotReady', 'Disconnected', 'Stale', 'Invalid']) {
    const runtime = await (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate).call(ControlRuntime, wasm, artifact);
    const step = (id, reverse, faults = {}) => runtime.step({ nowMs: id, samples: Object.fromEntries(Object.entries({
      forward_start: false, reverse_start: reverse, stop_ok: true, overload_ok: true,
    }).map(([name, value]) => [name, { epoch: 1, id, timestampMs: id, quality: faults[name] ?? 'Good', value }])) });
    try {
      step(1, false);
      const blocked = step(2, true, { forward_start: quality });
      assert.equal(blocked.vm.safe.reverse_contactor, false, 'unknown opposite request cannot authorize reverse');
      assert.equal(step(3, true).vm.safe.reverse_contactor, false, 'held reverse cannot rearm');
      step(4, false);
      assert.equal(step(5, true).vm.safe.reverse_contactor, true);
      const active = step(6, true, { reverse_start: quality });
      assert.equal(active.vm.safe.reverse_contactor, true, 'protected active reverse remains running');
      assert.equal(active.sensors.reverse_start.quality, quality);
      assert.equal(step(7, true, { stop_ok: quality }).vm.safe.reverse_contactor, false);
      assert.equal(step(8, true).vm.safe.reverse_contactor, false);
      step(9, false);
      assert.equal(step(10, true).vm.safe.reverse_contactor, true);
    } finally { runtime.dispose(); }
  }
});
for (const framed of [false, true]) test(`PC03/${framed ? 'framed' : 'plain'}: unchanged recorded healthy checkpoints`, async () => {
  const filename = 'examples/curriculum/pc-03-motor-contactor.ghost.md';
  const artifact = compileSourceSync(fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8'), { filename });
  const scenario = JSON.parse(fs.readFileSync(new URL('../examples/curriculum/replay-scenarios.json', import.meta.url), 'utf8')).scenarios.find(entry => entry.id === 'PC-03');
  const runtime = await (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate).call(ControlRuntime, wasm, artifact);
  try {
    for (const [index, frame] of scenario.frames.entries()) {
      const trace = runtime.step({ nowMs: frame.atMs, samples: Object.fromEntries(Object.entries(frame.inputs).map(([name, value]) => [name, { epoch: 1, id: index + 1, timestampMs: frame.atMs, quality: 'Good', value }])) });
      const checkpoint = scenario.checkpoints.find(entry => entry.frame === index);
      if (checkpoint) {
        assert.deepEqual(trace.vm.requested, checkpoint.requested);
        assert.deepEqual(trace.vm.safe, checkpoint.safe);
      }
    }
  } finally { runtime.dispose(); }
});
for (const [id, basename, requests, output] of lessons) for (const framed of [false, true]) {
  const filename = `examples/curriculum/${basename}.ghost.md`;
  const artifact = compileSourceSync(fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8'), { filename });
  for (const quality of ['NotReady', 'Disconnected', 'Stale', 'Invalid']) {
    test(`${id}/${framed ? 'framed' : 'plain'}: ${quality} request blocks arming and protection stops require fresh release`, async () => {
      const runtime = await (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate).call(ControlRuntime, wasm, artifact);
      let nextId = 0;
      const step = (pressed, faults = {}) => {
        const sampleId = ++nextId;
        const values = Object.fromEntries([...requests.map(name => [name, name === requests[0] && pressed]), ['stop_ok', true], ['overload_ok', true]]);
        return runtime.step({ nowMs: sampleId, samples: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { epoch: 1, id: sampleId, timestampMs: sampleId, quality: faults[name] ?? 'Good', value }])) });
      };
      try {
        assert.equal(step(false, { [requests[0]]: quality }).vm.safe[output], false);
        assert.equal(step(true).vm.safe[output], false, 'unavailable release cannot arm');
        step(false);
        assert.equal(step(true).vm.safe[output], true);
        const requestFault = step(true, { [requests[0]]: quality });
        assert.equal(requestFault.sensors[requests[0]].quality, quality);
        assert.equal(requestFault.vm.safe[output], true, 'healthy protection permits active operation');
        for (const protection of ['stop_ok', 'overload_ok']) {
          const fault = step(true, { [protection]: quality });
          assert.equal(fault.sensors[protection].quality, quality);
          assert.equal(fault.vm.safe[output], false);
          step(false, { [protection]: quality });
          assert.equal(step(true).vm.safe[output], false);
          step(false);
          assert.equal(step(true).vm.safe[output], true);
        }
      } finally { runtime.dispose(); }
    });
  }
}
