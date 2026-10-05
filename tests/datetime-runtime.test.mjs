// Explicit temporal fixture revision: issue531-quality-temporal-v1; predecessor retained in fixtures/history/issue531/temporal.
import assert from 'node:assert/strict';
import { softwareQualityObservations, softwareQualityRails } from './helpers/software-quality-observations.mjs';
const ControlRuntime = {
  instantiate: async (...args) => softwareQualityObservations(await BaseControlRuntime.instantiate(...args)),
  instantiateFramed: async (...args) => softwareQualityObservations(await BaseControlRuntime.instantiateFramed(...args)),
};

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { ControlRuntime as BaseControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileSource } from './helpers/literate-compile.mjs';

const nativePath = fileURLToPath(new URL('../target/release/examples/run', import.meta.url));
const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);
const MAX = 253402300799999;
const gfb = source => Buffer.from(compile(parse(tokenize(source))));
function native(t, bytes, header, rows) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-datetime-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'datetime.gfb'), inputPath = path.join(directory, 'inputs.csv');
  fs.writeFileSync(modulePath, bytes); fs.writeFileSync(inputPath, `${header}\n${rows.join('\n')}\n`);
  return execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim().split('\n').map(line => JSON.parse(line));
}
async function runtimeFor(t, bytes) {
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(bytes); runtime.addCapability('actuator', 'result', 'number'); runtime.activate();
  return runtime;
}

test('GF-TEST-datetime-guard: epoch bounds and fractional faults preserve atomic native/WASM commits', async t => {
  const bytes = gfb('(module DateTimeGuard (input value number) (state accepted number 0) (strategy run 0 (device true) (next accepted (add state.accepted 1)) (intent result (check-datetime input.value))))');
  assert.equal(bytes.readUInt16LE(4), 3);
  const values = [0, 1, MAX, -1, 0.5, MAX + 1, Number.MAX_SAFE_INTEGER, 42];
  const outcomes = native(t, bytes, 'value', values);
  const runtime = await runtimeFor(t, bytes);
  let accepted = 0, previous;
  for (const [index, value] of values.entries()) {
    runtime.setNumber('value', value);
    if ([0, 1, MAX, 42].includes(value)) {
      runtime.tick(); accepted++; previous = value;
      assert.equal(outcomes[index].trace.safe.result, value);
      assert.equal(outcomes[index].trace.stateAfter.accepted, accepted);
    } else {
      assert.deepEqual(outcomes[index], { status: 'ERROR', phase: 'tick', error: 'datetime-out-of-range', journalLength: accepted });
      assert.throws(() => runtime.tick(), /datetime-out-of-range/);
    }
    assert.equal(runtime.intentNumber('result'), previous);
    assert.equal(runtime.stateNumber('accepted'), accepted);
    assert.equal(runtime.journalLength, accepted);
  }
});

test('GF-TEST-datetime-guard-intermediate: checked shifts reject before cancellation and skip unselected faults', async t => {
  const bytes = gfb(`(module DateTimeShift (input guard bool) (input value number) (input offset number)
    (strategy run 0 (device true) (intent result
      (if input.guard (check-datetime (sub (check-datetime (add input.value input.offset)) input.offset)) 7))))`);
  const rows = [[false, MAX, 1], [true, MAX, 1], [true, MAX, 0]];
  const outcomes = native(t, bytes, 'guard,value,offset', rows.map(row => row.join(',')));
  assert.equal(outcomes[0].trace.safe.result, 7);
  assert.equal(outcomes[1].error, 'datetime-out-of-range');
  assert.equal(outcomes[2].trace.safe.result, MAX);
  const runtime = await runtimeFor(t, bytes);
  for (const [guard, value, offset] of rows) {
    runtime.setBool('guard', guard); runtime.setNumber('value', value); runtime.setNumber('offset', offset);
    if (guard && offset) assert.throws(() => runtime.tick(), /datetime-out-of-range/);
    else { runtime.tick(); assert.equal(runtime.intentNumber('result'), guard ? MAX : 7); }
  }
});

test('GF-TEST-datetime-guard-loader: unsupported profile, operand and stack shapes reject before activation', async t => {
  const bytes = gfb('(module DateTimeVerifier (strategy run 0 (device true) (intent result (check-datetime 1))))');
  const expression = Buffer.alloc(10); expression[0] = 2; expression.writeDoubleLE(1, 1); expression[9] = 55;
  const at = bytes.indexOf(expression); assert.notEqual(at, -1);
  const replace = (code, version = 3) => {
    const prefix = Buffer.from(bytes.subarray(0, at)); prefix.writeUInt16LE(version, 4); prefix.writeUInt32LE(code.length, at - 4);
    return Buffer.concat([prefix, Buffer.from(code), bytes.subarray(at + expression.length)]);
  };
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  for (const [invalid, expected] of [
    [replace(expression, 1), /DateTime guard requires GFB format 3/],
    [replace(expression, 2), /DateTime guard requires GFB format 3/],
    [replace([1, 1, 55]), /DateTime guard expects Number/],
    [replace([55]), /stack underflow/],
  ]) {
    const [outcome] = native(t, invalid, 'unused', ['0']);
    assert.equal(outcome.phase, 'load'); assert.match(outcome.error, expected);
    assert.throws(() => runtime.load(invalid), expected);
  }
  assert.throws(() => gfb('(module Invalid (strategy run 0 (device true) (intent result (check-datetime true))))'), /check-datetime expects one Number operand/);
});

test('GF-TEST-datetime-calendar-monotonic: public DateTime shifts and wall corrections preserve elapsed time and atomic native/WASM state', async t => {
  const artifact = await compileSource(`control CalendarAndElapsed {
    input observed_wall: DateTime;
    input observed_offset: Duration;
    state previous_wall: DateTime = datetime\`1970-01-01T00:00:00Z\`;
    state previous_offset: Duration = 0ms;
    let wall = case observed_wall { ok(value) => value; fault(_) => previous_wall; };
    let offset = case observed_offset { ok(value) => value; fault(_) => previous_offset; };
    previous_wall' = wall;
    previous_offset' = offset;
    state running: Bool = false;
    state accepted: Int = 0;
    timer age = elapsed(running);
    running' = true;
    accepted' = accepted + 1;
    output after, before: DateTime;
    output elapsed_ms: Duration;
    output same_instant: Bool;
    after <- wall + offset;
    before <- wall - offset;
    elapsed_ms <- age;
    same_instant <- wall == datetime\`2026-01-02T00:00:00Z\`
      && wall == datetime\`2026-01-02T09:00:00+09:00\`;
  }`, { filename: 'calendar-and-elapsed.ghost' });
  const midnight = Date.UTC(2026, 0, 2);
  const attempts = [
    { mono: 0, wall: midnight - 1, offset: 1, elapsed: 0 },
    { mono: 10, wall: midnight, offset: 1, elapsed: 10 },
    { mono: 20, wall: midnight - 3_600_000, offset: 1, elapsed: 20 },
    { mono: 30, wall: midnight + 3_600_000, offset: 1, elapsed: 30 },
    { mono: 40, wall: MAX, offset: 1, error: 'datetime-out-of-range' },
    { mono: 40, wall: 0, offset: 1, error: 'datetime-out-of-range' },
    { mono: 40, wall: 0, offset: 0, elapsed: 40 },
    { mono: 50, wall: MAX, offset: 0, elapsed: 50 },
  ];
  const packets = attempts.map(({ mono, wall, offset }, index) => ({ ...softwareQualityRails(artifact, { observed_wall: wall, observed_offset: offset }, index + 1, mono), __gf_now_ms: mono }));
  const columns = Object.keys(packets[0]);
  const outcomes = native(t, artifact.bytes, columns.join(','), packets.map(packet => columns.map(name => packet[name]).join(',')));
  const runtime = await ControlRuntime.instantiateFramed(fs.readFileSync(wasmPath), artifact);
  t.after(() => runtime.dispose());
  let committed, accepted = 0;
  attempts.forEach(({ mono, wall, offset, elapsed, error }, index) => {
    if (error) {
      assert.equal(outcomes[index].error, error);
      assert.equal(outcomes[index].journalLength, accepted);
      assert.throws(() => runtime.step({ nowMs: mono, inputs: { observed_wall: wall, observed_offset: offset } }), new RegExp(error));
      assert.deepEqual(runtime.lastFrameOutcome, committed,
        'failed shift preserves frame, state, outputs and elapsed reference');
      return;
    }
    const result = runtime.step({ nowMs: mono, inputs: { observed_wall: wall, observed_offset: offset } });
    accepted++;
    assert.deepEqual(result.vm.safe, {
      after: wall + offset, before: wall - offset, elapsed_ms: elapsed,
      same_instant: wall === midnight,
    });
    assert.deepEqual(outcomes[index].trace.safe, result.vm.safe, `native/WASM attempt ${index}`);
    assert.deepEqual(outcomes[index].trace.stateAfter, result.vm.stateAfter);
    assert.equal(result.vm.stateAfter.accepted, accepted);
    committed = structuredClone(runtime.lastFrameOutcome);
  });
});
