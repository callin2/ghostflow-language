import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const files = ['pc-06-timer-patterns', 'pc-07-tank-hysteresis', 'pc-08-manual-auto', 'pc-09-sequential-water-supply', 'pc-10-fault-alarm-reset'];
const scenarios = JSON.parse(fs.readFileSync(new URL('../examples/curriculum/replay-scenarios.json', import.meta.url), 'utf8')).scenarios;
const artifacts = new Map();
const pc10Defaults = { start_request: false, reset_request: false, stop_ok: true, emergency_stop_ok: true, overload_ok: true, source_water_ok: true, valve_drive_ok: true, open_limit: false, close_limit: true };
function artifact(n) {
  if (!artifacts.has(n)) {
    const filename = `examples/curriculum/${files[n - 6]}.ghost.md`;
    artifacts.set(n, compileSourceSync(fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8'), { filename }));
  }
  return artifacts.get(n);
}
async function withRuntime(n, framed, run) {
  const runtime = await (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate).call(ControlRuntime, wasm, artifact(n));
  let id = 0;
  const step = (nowMs, values, faults = {}) => runtime.step({ nowMs, samples: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { epoch: 1, id: ++id, timestampMs: nowMs, quality: faults[name] ?? 'Good', value }])) });
  try { await run(step); } finally { runtime.dispose(); }
}
for (const framed of [false, true]) {
  test(`PC10/${framed}: healthy ordered sequence and limit at exact timeout`, async () => {
    await withRuntime(10, framed, step => {
      step(0, pc10Defaults);
      assert.equal(step(1, { ...pc10Defaults, start_request: true }).vm.stateAfter.phase, 1);
      const opened = { ...pc10Defaults, start_request: true, open_limit: true, close_limit: false };
      assert.equal(step(10001, opened).vm.stateAfter.phase, 2, 'confirmed open limit wins over exact timeout');
      assert.equal(step(12001, opened).vm.stateAfter.phase, 3);
      assert.equal(step(312001, opened).vm.stateAfter.phase, 4);
      assert.equal(step(312002, opened).vm.stateAfter.phase, 5);
      const finished = step(322002, pc10Defaults);
      assert.equal(finished.vm.stateAfter.phase, 0, 'confirmed close limit wins over exact timeout');
      assert.equal(finished.vm.stateAfter.fault_cause, 0);
      assert.deepEqual(finished.vm.safe, { valve_open_contactor: false, valve_close_contactor: false, pump_contactor: false, alarm: false });
    });
  });
  test(`PC10/${framed}: output projections match next phase for every declared initial phase/cause combination`, async () => {
    const phases = ['Idle', 'Opening', 'Settling', 'Watering', 'PumpStopping', 'Closing', 'FaultPumpStopping', 'FaultClosing', 'Faulted'];
    const causes = ['None', 'EmergencyStop', 'Overload', 'LowSourceWater', 'ValveDriveUnavailable', 'SensorConflict', 'FeedbackLost', 'OpenTimeout', 'CloseTimeout'];
    const filename = 'examples/curriculum/pc-10-fault-alarm-reset.ghost.md';
    const original = fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
    for (const initialPhase of phases) for (const initialCause of causes) {
      // Test-only initial-state variants include combinations not reached by the normal sequence.
      const source = original.replace('state phase: Phase = Idle;', `state phase: Phase = ${initialPhase};`).replace('state fault_cause: FaultCause = None;', `state fault_cause: FaultCause = ${initialCause};`);
      const compiled = compileSourceSync(source, { filename });
      const runtime = await (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate).call(ControlRuntime, wasm, compiled);
      const patterns = [pc10Defaults, { ...pc10Defaults, start_request: true }, { ...pc10Defaults, open_limit: true, close_limit: false }, { ...pc10Defaults, open_limit: true, close_limit: true }, { ...pc10Defaults, emergency_stop_ok: false }, { ...pc10Defaults, reset_request: true }];
      try {
        for (const [index, values] of patterns.entries()) {
          const nowMs = index * 10000;
          const trace = runtime.step({ nowMs, samples: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { epoch: 1, id: index + 1, timestampMs: nowMs, quality: 'Good', value }])) });
          const next = trace.vm.stateAfter.phase;
          assert.deepEqual(trace.vm.requested, { valve_open_contactor: next === 1, valve_close_contactor: next === 5 || next === 7, pump_contactor: next === 3, alarm: next === 6 || next === 7 || next === 8 }, `${initialPhase}/${initialCause}/frame ${index}`);
        }
      } finally { runtime.dispose(); }
    }
  });
  for (const n of [8, 9]) test(`PC${n}/${framed ? 'framed' : 'plain'}: retained healthy checkpoints`, async () => {
    const scenario = scenarios.find(entry => entry.id === `PC-${String(n).padStart(2, '0')}`);
    assert.ok(scenario);
    await withRuntime(n, framed, step => {
      for (const [index, frame] of scenario.frames.entries()) {
        const trace = step(frame.atMs, frame.inputs);
        const checkpoint = scenario.checkpoints.find(entry => entry.frame === index);
        if (checkpoint) { assert.deepEqual(trace.vm.requested, checkpoint.requested); assert.deepEqual(trace.vm.safe, checkpoint.safe); }
      }
    });
  });
  for (const quality of ['NotReady', 'Disconnected', 'Stale', 'Invalid']) {
    test(`PC10/${framed}: ${quality} producer absence invents no physical fault cause`, async () => {
      const inputs = { start_request: false, reset_request: false, stop_ok: true, emergency_stop_ok: true, overload_ok: true, source_water_ok: true, valve_drive_ok: true, open_limit: false, close_limit: true };
      for (const name of Object.keys(inputs)) await withRuntime(10, framed, step => {
        const unavailable = step(0, inputs, { [name]: quality });
        assert.equal(unavailable.vm.stateAfter.fault_cause, 0);
        assert.equal(unavailable.vm.safe.alarm, false);
        assert.equal(unavailable.vm.safe.pump_contactor, false);
        assert.equal(unavailable.vm.safe.valve_open_contactor, false);
        assert.equal(unavailable.vm.safe.valve_close_contactor, false);
      });
    });
    test(`PC10/${framed}: ${quality} feedback at hard deadline is timeout, not inferred switch diagnosis`, async () => {
      await withRuntime(10, framed, step => {
        const inputs = { start_request: false, reset_request: false, stop_ok: true, emergency_stop_ok: true, overload_ok: true, source_water_ok: true, valve_drive_ok: true, open_limit: false, close_limit: true };
        step(0, inputs); assert.equal(step(1, { ...inputs, start_request: true }).vm.safe.valve_open_contactor, true);
        const expired = step(10001, { ...inputs, start_request: true, open_limit: true }, { open_limit: quality });
        assert.equal(expired.vm.stateAfter.fault_cause, 7);
        assert.equal(expired.vm.safe.alarm, true);
        assert.equal(expired.vm.safe.valve_open_contactor, false);
      });
    });
    test(`PC06/${framed}: ${quality} request cannot start delay or bypass hard maximum`, async () => {
      await withRuntime(6, framed, step => {
        const inputs = { on_delay_request: true, off_delay_request: false, limited_request: true, stop_ok: true };
        assert.equal(step(0, inputs).vm.safe.limited_run, true);
        const trace = step(10000, inputs, { on_delay_request: quality, limited_request: quality });
        assert.equal(trace.vm.safe.on_delayed, false);
        assert.equal(trace.vm.safe.limited_run, false);
      });
    });
    test(`PC07/${framed}: ${quality} position neither establishes level nor conflict`, async () => {
      await withRuntime(7, framed, step => {
        assert.equal(step(0, { low_level_reached: false, high_level_reached: false }).vm.safe.fill_pump, true);
        const unavailable = step(1, { low_level_reached: false, high_level_reached: true }, { high_level_reached: quality });
        assert.equal(unavailable.vm.safe.fill_pump, true);
        assert.equal(unavailable.vm.stateAfter.phase, 1);
        assert.equal(step(2, { low_level_reached: false, high_level_reached: true }).vm.stateAfter.phase, 2);
      });
    });
    test(`PC08/${framed}: ${quality} mode cannot authorize a new start`, async () => {
      await withRuntime(8, framed, step => {
        const inputs = { manual_mode_request: true, auto_mode_request: false, manual_start: false, auto_demand: false, stop_ok: true, overload_ok: true };
        step(0, inputs); step(1, inputs);
        assert.equal(step(2, { ...inputs, manual_start: true }, { manual_mode_request: quality }).vm.safe.pump_contactor, false);
      });
    });
    test(`PC09/${framed}: ${quality} feedback cannot establish conflict or cancel watering deadline`, async () => {
      await withRuntime(9, framed, step => {
        const inputs = { start_request: false, open_limit: false, close_limit: true, stop_ok: true, overload_ok: true };
        step(0, inputs); step(1, { ...inputs, start_request: true });
        const open = { ...inputs, start_request: true, open_limit: true, close_limit: false };
        step(2, open); assert.equal(step(2002, open).vm.safe.pump_contactor, true);
        const trace = step(302002, { ...open, close_limit: true }, { close_limit: quality });
        assert.equal(trace.vm.safe.pump_contactor, false);
        assert.equal(trace.vm.stateAfter.phase, 4);
      });
    });
    test(`PC09/${framed}: ${quality} during Closing inhibits command, preserves phase and accepts restored closed feedback`, async () => {
      await withRuntime(9, framed, step => {
        const closed = { start_request: false, open_limit: false, close_limit: true, stop_ok: true, overload_ok: true };
        step(0, closed); step(1, { ...closed, start_request: true });
        const opened = { ...closed, start_request: true, open_limit: true, close_limit: false };
        step(2, opened); step(2002, opened);
        assert.equal(step(302002, opened).vm.stateAfter.phase, 4, 'watering deadline stops the pump');
        assert.equal(step(302003, opened).vm.safe.valve_close_contactor, true);
        const unavailable = step(302004, closed, { close_limit: quality });
        assert.equal(unavailable.vm.stateAfter.phase, 5, 'absence does not return to the open-position phase');
        assert.deepEqual(unavailable.vm.safe, { valve_open_contactor: false, valve_close_contactor: false, pump_contactor: false });
        const stillUnavailable = step(602004, closed, { close_limit: quality });
        assert.equal(stillUnavailable.vm.stateAfter.phase, 5, 'PC09 has no invented close timeout');
        assert.equal(stillUnavailable.vm.safe.valve_close_contactor, false);
        assert.equal(step(602005, opened).vm.safe.valve_close_contactor, true, 'healthy nonconflicting position permits closure to resume');
        step(602006, closed, { open_limit: quality });
        const finished = step(602007, closed);
        assert.equal(finished.vm.stateAfter.phase, 0, 'restored closed position completes without a synthetic FeedbackFault');
        assert.deepEqual(finished.vm.safe, { valve_open_contactor: false, valve_close_contactor: false, pump_contactor: false });
      });
    });
  }
}
