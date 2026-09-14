import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const wasmBytes = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const nativePath = path.join(root, 'target/release/examples/scan_tape');

function row(scanId, logicalTimeMs, inputs) {
  return { scanId, logicalTimeMs, inputs };
}

function tsv(tape) {
  return `${tape.map(({ scanId, logicalTimeMs, inputs }) => [scanId, logicalTimeMs, ...inputs.flatMap(({ name, value }) => [name, typeof value === 'boolean' ? 'b' : 'n', String(value)])].join('\t')).join('\n')}\n`;
}

function nativeRun(bytes, tape) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-scan-tape-'));
  try {
    const modulePath = path.join(directory, 'module.gfb');
    const tapePath = path.join(directory, 'tape.tsv');
    fs.writeFileSync(modulePath, bytes);
    fs.writeFileSync(tapePath, tsv(tape));
    const result = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function wasmRun(artifact, tape) {
  const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
  try {
    runtime.load(artifact.bytes);
    for (const output of artifact.manifest.outputs) runtime.addCapability('actuator', output.name, output.type === 'Bool' ? 'bool' : 'number');
    runtime.activate();
    const observations = [];
    for (const frame of tape) {
      try {
        const outcome = runtime.scan(frame);
        observations.push({ accepted: true, outcome });
      } catch (error) {
        observations.push({ accepted: false, outcome: runtime.outcome, error: String(error.message) });
      }
    }
    return observations;
  } finally {
    runtime.dispose();
  }
}

function assertParity(native, wasm) {
  assert.deepEqual(
    native.map(({ accepted, outcome }) => ({ accepted, outcome })),
    wasm.map(({ accepted, outcome }) => ({ accepted, outcome })),
    'native and public framed WASM must retain the exact complete outcome on every attempt',
  );
}

async function compare(source, tape, filename) {
  const artifact = await compileSource(source, { filename });
  const native = nativeRun(artifact.bytes, tape);
  const wasm = await wasmRun(artifact, tape);
  assertParity(native, wasm);
  assert.deepEqual(nativeRun(artifact.bytes, tape), native, 'a fresh native driver must replay the same compiled tape exactly');
  assert.deepEqual(await wasmRun(artifact, tape), wasm, 'a fresh WASM driver must replay the same compiled tape exactly');
  return { native, wasm };
}

test('GF-TEST-scan-tape-parity: timer boundaries and 32-bit logical time remain exact', async () => {
  const tape = [
    row(0, 0, [{ name: 'enabled', value: true }]),
    row(1, 0, [{ name: 'enabled', value: true }]),
    row(2, 99, [{ name: 'enabled', value: true }]),
    row(3, 100, [{ name: 'enabled', value: true }]),
    row(4, 101, [{ name: 'enabled', value: true }]),
    row(5, 4_294_967_295, [{ name: 'enabled', value: true }]),
    row(6, 4_294_967_296, [{ name: 'enabled', value: true }]),
    row(7, 4_294_967_297, [{ name: 'enabled', value: true }]),
  ];
  const { native } = await compare(`
control TapeTimer {
  input enabled: Bool;
  state active: Bool = false;
  timer age = elapsed(active);
  active' = enabled;
  output expired: Bool;
  expired <- age >= 100ms;
}
`, tape, 'scan-tape-timer.ghost');
  assert.deepEqual(native.map(item => item.accepted), tape.map(() => true));
  assert.deepEqual(native.map(item => item.outcome.trace.safe.expired), [false, false, false, true, true, true, true, true]);
  assert.deepEqual(native.map(item => item.outcome.logicalTimeMs), tape.map(frame => frame.logicalTimeMs));
  assert.deepEqual(native.map(item => item.outcome.trace.inputs.__gf_now_ms), tape.map(frame => frame.logicalTimeMs));
});

test('GF-TEST-scan-tape-parity: self-hold records old and next state transitions', async () => {
  const tape = [
    row(0, 0, [{ name: 'start', value: false }, { name: 'stop', value: false }]),
    row(1, 1, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
    row(2, 2, [{ name: 'start', value: false }, { name: 'stop', value: false }]),
    row(3, 3, [{ name: 'start', value: false }, { name: 'stop', value: true }]),
    row(4, 4, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
  ];
  const { native } = await compare(`
control TapeSelfHold {
  input start, stop: Bool;
  state running: Bool = false;
  running' = !stop && (start || running);
  output pump: Bool;
  pump <- running';
}
`, tape, 'scan-tape-self-hold.ghost');
  assert.deepEqual(native.map(item => item.outcome.trace.safe.pump), [false, true, true, false, true]);
  assert.deepEqual(native.map(item => item.outcome.trace.stateBefore.running), [false, false, true, true, false]);
  assert.deepEqual(native.map(item => item.outcome.trace.stateAfter.running), [false, true, true, false, true]);
});

test('GF-TEST-scan-tape-parity: global constraint preserves requested ON and safe OFF', async () => {
  const { native } = await compare(`
control TapeConstraint {
  input enabled: Bool;
  output pump, permit: Bool;
  pump <- enabled;
  permit <- false;
  require pump => permit;
}
`, [row(0, 0, [{ name: 'enabled', value: true }])], 'scan-tape-constraint.ghost');
  const trace = native[0].outcome.trace;
  assert.equal(trace.requested.pump, true);
  assert.equal(trace.safe.pump, false);
  assert.equal(trace.safetyTrace.constraints[0].kind, 'requires');
  assert.deepEqual(trace.safetyTrace.constraints[0].firstViolation.blocked, ['pump']);
});

test('GF-TEST-scan-tape-parity: rejected envelope attempts retain the prior outcome and corrected retries reuse IDs', async () => {
  const tape = [
    row(0, 0, []),
    row(0, 0, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
    row(1, 1, [{ name: 'start', value: true }, { name: 'start', value: false }]),
    row(1, 1, [{ name: 'start', value: true }, { name: 'stop', value: false }, { name: 'extra', value: false }]),
    row(1, 1, [{ name: 'start', value: true }, { name: 'stop', value: false }, { name: '__gf_now_ms', value: 1 }]),
    row(1, 1, [{ name: 'start', value: 1 }, { name: 'stop', value: false }]),
    row(1, 1, [{ name: 'start', value: true }, { name: 'bad"\\\\', value: false }]),
    row(2, 2, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
    row(Number.MAX_SAFE_INTEGER + 1, 1, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
    row(1, 1, [{ name: 'start', value: false }, { name: 'stop', value: true }]),
    row(2, Number.MAX_SAFE_INTEGER + 1, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
    row(2, 0, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
    row(2, 2, [{ name: 'start', value: true }, { name: 'stop', value: false }]),
  ];
  const { native, wasm } = await compare(`
control TapeReject {
  input start, stop: Bool;
  state running: Bool = false;
  running' = !stop && (start || running);
  output pump: Bool;
  pump <- running';
}
`, tape, 'scan-tape-reject.ghost');
  assert.deepEqual(native.map(item => item.accepted), [false, true, false, false, false, false, false, false, false, true, false, false, true]);
  for (const index of [0, 2, 3, 4, 5, 6, 7, 8]) assert.deepEqual(native[index].outcome, index === 0 ? null : native[1].outcome);
  assert.deepEqual(native[10].outcome, native[9].outcome);
  assert.deepEqual(native[11].outcome, native[9].outcome);
  assert.equal(native[9].outcome.scanId, 1);
  assert.equal(native[12].outcome.scanId, 2);
  assert.equal(native[12].outcome.trace.safe.pump, true);
  assert.match(native[0].error, /complete inputs/);
  assert.match(wasm[4].error, /reserved/);
  assert.equal(native[6].error, 'unknown input bad"\\\\');
  assert.equal(wasm[6].error, 'unknown input bad"\\\\');
  assert.match(wasm[8].error, /safe integer/);
  assert.match(wasm[10].error, /safe integer/);
});

test('GF-TEST-scan-tape-parity: core evaluation rollback permits a same-ID framed retry', async () => {
  const tape = [
    row(0, 10, [{ name: 'divisor', value: 1 }]),
    row(1, 200, [{ name: 'divisor', value: 0 }]),
    row(1, 109, [{ name: 'divisor', value: 2 }]),
    row(2, 110, [{ name: 'divisor', value: 2 }]),
  ];
  const { native } = await compare(`
control TapeRollback {
  input divisor: Number;
  state attempts: Number = 0;
  state active: Bool = false;
  timer age = elapsed(active);
  active' = true;
  attempts' = attempts + 1;
  output pump: Number;
  output expired: Bool;
  pump <- 1 / divisor;
  expired <- age >= 100ms;
}
`, tape, 'scan-tape-rollback.ghost');
  assert.deepEqual(native.map(item => item.accepted), [true, false, true, true]);
  assert.equal(native[0].outcome.trace.safe.pump, 1);
  assert.deepEqual(native[1].outcome, native[0].outcome);
  assert.match(native[1].error, /division by zero/);
  assert.equal(native[2].outcome.scanId, 1);
  assert.equal(native[2].outcome.logicalTimeMs, 109);
  assert.equal(native[0].outcome.trace.stateAfter.attempts, 1);
  assert.equal(native[1].outcome.trace.stateAfter.attempts, 1);
  assert.equal(native[2].outcome.trace.stateBefore.attempts, 1);
  assert.equal(native[2].outcome.trace.stateAfter.attempts, 2);
  assert.equal(native[2].outcome.trace.safe.pump, 0.5);
  assert.deepEqual(native.map(item => item.outcome.trace.safe.expired), [false, false, false, true]);
  assert.equal(native[3].outcome.trace.stateAfter.attempts, 3);
});

test('GF-TEST-scan-tape-parity: malformed TSV is a native transport error, not a rejected scan', async () => {
  const artifact = await compileSource('control TapeTransport { input enabled: Bool; output pump: Bool; pump <- enabled; }', { filename: 'scan-tape-transport.ghost' });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-scan-tape-malformed-'));
  try {
    const modulePath = path.join(directory, 'module.gfb');
    const tapePath = path.join(directory, 'bad.tsv');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(tapePath, '0\t0\tenabled\tb\tmaybe\n');
    const result = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /boolean input/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
