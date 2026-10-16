import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = () => fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const compile = body => compileSourceSync(`# Input preparation regression\n\n\`\`\`ghost\n${body}\n\`\`\`\n`, { filename: 'input-preparation-v1.ghost.md' });
const observation = (id, timestampMs, value, quality = 'Good', epoch = 1) => ({ epoch, id, timestampMs, value, quality });

for (const framed of [false, true]) {
  const mode = framed ? 'framed WASM' : 'plain WASM';
  const instantiate = artifact => (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate).call(ControlRuntime, wasm(), artifact);

  test(`${mode}: recover_after counts fresh observations at startup, faults, epochs and reboot`, async () => {
    const artifact = compile(`control Prepared {
      input button: Bool { stale_after = 10ms; recover_after = 3 samples; }
      input reading: Number { stale_after = 10ms; recover_after = 3 samples; }
      output button_ok, number_ok, button_value: Bool;
      output number_value: Number;
      button_ok <- case button { ok(value) => true; fault(_) => false; };
      number_ok <- case reading { ok(value) => true; fault(_) => false; };
      button_value <- button |> recover(true);
      number_value <- reading |> recover(-1.0);
    }`);
    const runtime = await instantiate(artifact);
    const step = (nowMs, packet) => runtime.step({ nowMs, ...(packet ? { samples: {
      button: { ...packet, value: false }, reading: { ...packet, value: 0 },
    } } : {}) });
    const expect = (result, quality) => {
      for (const name of ['button', 'reading']) assert.equal(result.sensors[name].quality, quality);
      assert.deepEqual(result.vm.safe, { button_ok: quality === 'Good', number_ok: quality === 'Good',
        button_value: quality !== 'Good', number_value: quality === 'Good' ? 0 : -1 });
    };
    try {
      expect(step(0), 'NotReady');
      expect(step(1, observation(1, 1, 0)), 'NotReady');
      expect(step(2, observation(1, 1, 0)), 'NotReady'); // Duplicate cannot count.
      expect(step(3), 'NotReady'); // A clock scan cannot count.
      expect(step(4, observation(2, 4, 0)), 'NotReady');
      expect(step(5, observation(3, 5, 0)), 'Good'); // Third Good is usable.
      for (const [index, quality] of ['Disconnected', 'Invalid', 'NotReady', 'Stale'].entries()) {
        const at = 6 + index * 4, base = 4 + index * 4;
        expect(step(at, observation(base, at, 0, quality)), quality);
        expect(step(at + 1, observation(base + 1, at + 1, 0)), 'NotReady');
        expect(step(at + 2, observation(base + 2, at + 2, 0)), 'NotReady');
        expect(step(at + 3, observation(base + 3, at + 3, 0)), 'Good');
      }
      expect(step(31), 'Stale');
      expect(step(32, observation(20, 32, 0)), 'NotReady');
      expect(step(33, observation(21, 33, 0)), 'NotReady');
      expect(step(34, observation(22, 34, 0)), 'Good');
      expect(step(35, observation(1, 35, 0, 'Good', 2)), 'NotReady');
      expect(step(36, observation(2, 36, 0, 'Good', 2)), 'NotReady');
      expect(step(37, observation(3, 37, 0, 'Good', 2)), 'Good');
      expect(step(38, observation(4, 38, 0, 'Disconnected', 2)), 'Disconnected');
      expect(step(39, observation(5, 39, 0, 'Good', 2)), 'NotReady');
      expect(step(40, observation(6, 40, 0, 'Invalid', 2)), 'Invalid'); // Break partial recovery.
      expect(step(41, observation(7, 41, 0, 'Good', 2)), 'NotReady');
      expect(step(42, observation(8, 42, 0, 'Good', 2)), 'NotReady');
      expect(step(43, observation(9, 43, 0, 'Good', 2)), 'Good');
    } finally { runtime.dispose(); }
    const rebooted = await instantiate(artifact);
    try {
      for (let id = 1; id <= 3; id++) {
        const result = rebooted.step({ nowMs: id, samples: { button: observation(id, id, false), reading: observation(id, id, 0) } });
        expect(result, id === 3 ? 'Good' : 'NotReady');
      }
    } finally { rebooted.dispose(); }
  });

  test(`${mode}: filter and recovery readiness use the larger fresh-sample threshold`, async () => {
    for (const [window, threshold] of [[1, 1], [3, 2], [3, 5]]) {
      const artifact = compile(`control Filtered { input reading: Number { filter = median(${window}); recover_after = ${threshold} samples; }
        output value: Number; value <- reading |> recover(-1.0); }`);
      const runtime = await instantiate(artifact);
      try {
        const required = Math.max(window, threshold);
        for (let id = 1; id <= required; id++) {
          const result = runtime.step({ nowMs: id, samples: { reading: observation(id, id, 0) } });
          assert.equal(result.sensors.reading.quality, id === required ? 'Good' : 'NotReady');
          assert.equal(result.vm.safe.value, id === required ? 0 : -1);
        }
      } finally { runtime.dispose(); }
    }
  });

  test(`${mode}: existing debounce can withhold input for two minutes of conditioned Good observations`, async t => {
    for (const recoverSamples of [1, 3]) {
      const artifact = compile(`fn observed(value: Number) -> Bool { true }
        control TimedPreparation {
          input reading: Number { stale_after = 3min; recover_after = ${recoverSamples} samples; }
          signal ready = debounce(reading |> map(observed), stable_for: 2min, initial: false);
          let prepared: Result<Number, SensorFault> = case ready {
            ok(value) => if value then reading else fault(NotReady);
            fault(_) => reading;
          };
          output usable: Bool; output value: Number;
          usable <- case prepared { ok(value) => true; fault(_) => false; };
          value <- prepared |> recover(-1.0);
        }`);
      const runtime = await instantiate(artifact), frames = [], traces = [];
      if (framed) {
        const dispatch = runtime.runtime.dispatch.bind(runtime.runtime);
        runtime.runtime.dispatch = frame => { const outcome = dispatch(frame); frames.push(structuredClone(frame)); return outcome; };
      }
      const run = (nowMs, packet, quality, usable) => {
        const result = runtime.step({ nowMs, ...(packet ? { samples: { reading: packet } } : {}) });
        assert.equal(result.sensors.reading.quality, quality);
        assert.deepEqual(result.vm.safe, { usable, value: usable ? 0 : -1 });
        traces.push(result.vm);
        return result;
      };
      try {
        if (recoverSamples === 3) {
          run(0, observation(1, 0, 0), 'NotReady', false);
          run(1000, observation(2, 1000, 0), 'NotReady', false);
          run(2000, observation(3, 2000, 0), 'Good', false);
          run(120000, observation(4, 120000, 0), 'Good', false);
          // The two-minute interval starts at the first CONDITIONED Good at 2s.
          run(122000, observation(5, 122000, 0), 'Good', true);
        } else {
          run(0, observation(1, 0, 0), 'Good', false);
          run(119999, null, 'Good', false);
          run(120000, observation(1, 0, 0), 'Good', false);
          // Neither elapsed host time nor a duplicate promotes preparation.
          run(120001, observation(2, 120001, 0), 'Good', true);
          const disconnected = run(130000, observation(3, 130000, 0, 'Disconnected'), 'Disconnected', false);
          const origin = artifact.sourceMap.find(node => node.kind === 'sensor').id;
          assert.ok(disconnected.vm.resultTrace.some(entry => entry.choice === 1 && entry.origin === origin),
            'returning the original input Result retains its fault origin');
          run(140000, observation(4, 140000, 0), 'Good', false);
          run(259999, null, 'Good', false);
          run(260000, observation(5, 260000, 0), 'Good', true);
          run(270000, observation(1, 270000, 0, 'Good', 2), 'Good', false);
          run(390000, observation(2, 390000, 0, 'Good', 2), 'Good', true);
          run(400000, observation(3, 400000, 0, 'Good', 2), 'Good', true);
          run(580000, null, 'Stale', false);
          run(580001, observation(4, 580001, 0, 'Good', 2), 'Good', false);
          run(700001, observation(5, 700001, 0, 'Good', 2), 'Good', true);
        }
      } finally { runtime.dispose(); }
      if (framed) {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'input-two-minute-'));
        t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
        const module = path.join(directory, 'prepared.gfb'), tape = path.join(directory, 'frames.tsv');
        fs.writeFileSync(module, artifact.bytes);
        fs.writeFileSync(tape, frames.map(frame => [frame.scanId, frame.logicalTimeMs,
          ...frame.inputs.flatMap(input => [input.name, input.type === 'Bool' ? 'b' : 'n', input.value])].join('\t')).join('\n') + '\n');
        const runner = fileURLToPath(new URL(`../target/release/examples/scan_tape${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
        const native = execFileSync(runner, [module, tape], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
        assert.ok(native.every(row => row.accepted));
        assert.deepEqual(native.map(row => row.outcome.trace), traces);
      }
    }
  });

  test(`${mode}: timed readiness tolerates changing values and restarts after actual staleness`, async t => {
    for (const [recoverSamples, window] of [[1, 1], [3, 1], [1, 3]]) {
      const required = Math.max(recoverSamples, window);
      const artifact = compile(`fn observed(value: Number) -> Bool { true }
        control VaryingPreparation {
          input reading: Number { stale_after = 3min; recover_after = ${recoverSamples} samples; filter = median(${window}); }
          signal ready = debounce(reading |> map(observed), stable_for: 2min, initial: false);
          let prepared: Result<Number, SensorFault> = case ready {
            ok(value) => if value then reading else fault(NotReady); fault(_) => reading;
          };
          output usable: Bool; output value: Number;
          usable <- case prepared { ok(value) => true; fault(_) => false; };
          value <- prepared |> recover(-999.0);
        }`);
      const runtime = await instantiate(artifact), frames = [], traces = [];
      if (framed) {
        const dispatch = runtime.runtime.dispatch.bind(runtime.runtime);
        runtime.runtime.dispatch = frame => { const outcome = dispatch(frame); frames.push(structuredClone(frame)); return outcome; };
      }
      let id = 0, lastPacket;
      const run = (at, packet, quality, usable) => {
        const result = runtime.step({ nowMs: at, ...(packet ? { samples: { reading: packet } } : {}) });
        assert.equal(result.sensors.reading.quality, quality);
        assert.equal(result.vm.safe.usable, usable);
        assert.equal(result.vm.safe.value, usable ? result.sensors.reading.value : -999);
        traces.push(result.vm);
      };
      const fresh = (at, value, quality, usable) => {
        lastPacket = observation(++id, at, value);
        run(at, lastPacket, quality, usable);
      };
      try {
        for (let n = 0; n < required; n++) fresh(n * 1000, n % 2 ? -100 : 100, n + 1 === required ? 'Good' : 'NotReady', false);
        const start = (required - 1) * 1000;
        for (const [offset, value] of [[30000, -75], [60000, 50], [90000, -25], [119999, 125]]) fresh(start + offset, value, 'Good', false);
        run(start + 120000, null, 'Good', false);
        run(start + 120000, lastPacket, 'Good', false);
        fresh(start + 120001, -150, 'Good', true);
        const last = start + 120001;
        // Omission is not an immediate disconnect: freshness is the declared boundary.
        run(last + 179999, null, 'Good', true);
        run(last + 180000, null, 'Stale', false);
        const resumed = last + 180001;
        for (let n = 0; n < required; n++) fresh(resumed + n * 1000, n % 2 ? 200 : -200, n + 1 === required ? 'Good' : 'NotReady', false);
        const restarted = resumed + (required - 1) * 1000;
        fresh(restarted + 60000, 275, 'Good', false);
        fresh(restarted + 119999, -350, 'Good', false);
        fresh(restarted + 120000, 425, 'Good', true);
      } finally { runtime.dispose(); }
      if (framed) {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'input-varying-preparation-'));
        t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
        const module = path.join(directory, 'prepared.gfb'), tape = path.join(directory, 'frames.tsv');
        fs.writeFileSync(module, artifact.bytes);
        fs.writeFileSync(tape, frames.map(frame => [frame.scanId, frame.logicalTimeMs,
          ...frame.inputs.flatMap(input => [input.name, input.type === 'Bool' ? 'b' : 'n', input.value])].join('\t')).join('\n') + '\n');
        const runner = fileURLToPath(new URL(`../target/release/examples/scan_tape${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
        const native = execFileSync(runner, [module, tape], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
        assert.ok(native.every(row => row.accepted));
        assert.deepEqual(native.map(row => row.outcome.trace), traces);
      }
    }
  });

  test(`${mode}: map and and_then preserve faults without evaluating scalar arithmetic`, async t => {
    const artifact = compile(`fn quotient(value: Number) -> Number { 1.0 / value }
      fn checked(value: Number) -> Result<Number, SensorFault> { if value < 0.0 then fault(Invalid) else ok(1.0 / value) }
      fn positive(value: Number) -> Bool { value > 0.0 }
      fn identity(value: Bool) -> Bool { value }
      control Rails { input reading: Number; input button: Bool;
        output mapped, chained: Number; output healthy_button, predicate: Bool;
        mapped <- reading |> map(quotient) |> recover(-7.0);
        chained <- reading |> and_then(checked) |> recover(-9.0);
        healthy_button <- button |> map(identity) |> recover(true);
        predicate <- reading |> map(positive) |> recover(true);
      }`);
    const runtime = await instantiate(artifact), frames = [], results = [];
    if (framed) {
      const scan = runtime.runtime.dispatch.bind(runtime.runtime);
      runtime.runtime.dispatch = frame => { const result = scan(frame); frames.push(structuredClone(frame)); return result; };
    }
    const step = (id, quality, value) => runtime.step({ nowMs: id, samples: {
      reading: observation(id, id, value, quality), button: observation(id, id, false),
    } });
    try {
      for (const [index, quality] of ['NotReady', 'Disconnected', 'Stale', 'Invalid'].entries()) {
        const result = step(index + 1, quality, 0);
        assert.equal(result.sensors.reading.quality, quality);
        assert.deepEqual(result.vm.safe, { mapped: -7, chained: -9, healthy_button: false, predicate: true });
        results.push(result.vm);
      }
      const good = step(5, 'Good', 2);
      assert.deepEqual(good.vm.safe, { mapped: 0.5, chained: 0.5, healthy_button: false, predicate: true });
      results.push(good.vm);
      const rejectedByFunction = step(6, 'Good', -2);
      assert.deepEqual(rejectedByFunction.vm.safe, { mapped: -0.5, chained: -9, healthy_button: false, predicate: false });
      results.push(rejectedByFunction.vm);
      const committed = runtime.runtime.trace ?? runtime.runtime.outcome;
      assert.throws(() => step(7, 'Good', 0), /division by zero/);
      assert.deepEqual(runtime.runtime.trace ?? runtime.runtime.outcome, committed);
    } finally { runtime.dispose(); }
    if (framed) {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'input-recovery-rop-'));
      t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
      const module = path.join(directory, 'rails.gfb'), tape = path.join(directory, 'frames.tsv');
      fs.writeFileSync(module, artifact.bytes);
      fs.writeFileSync(tape, frames.map(frame => [frame.scanId, frame.logicalTimeMs,
        ...frame.inputs.flatMap(input => [input.name, input.type === 'Bool' ? 'b' : 'n', input.value])].join('\t')).join('\n') + '\n');
      const runner = new URL(`../target/release/examples/scan_tape${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url);
      const native = execFileSync(fileURLToPath(runner), [module, tape], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
      assert.ok(native.every(row => row.accepted));
      assert.deepEqual(native.map(row => row.outcome.trace), results);
    }
  });
}
