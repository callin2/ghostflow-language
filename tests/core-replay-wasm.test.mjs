import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const root = path.resolve(new URL('../', import.meta.url).pathname);
const wasmBytes = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const nativePath = path.join(root, 'target/release/examples/scan_tape');
const source = `# Core replay proof

This fixed canonical document has no settings events. Its actuator bindings are
pump: Bool, permit: Bool, and ratio: Number.

\`\`\`ghost
control CoreReplay {
  input start, stop, low_water: Bool;
  input divisor: Number;
  state running: Bool = false;
  running' = !stop && (start || running);
  output pump, permit: Bool;
  output ratio: Number;
  pump <- running';
  permit <- !low_water;
  ratio <- 1.0 / divisor;
  require pump => permit;
}
\`\`\`
`;

test('REF-06-017: retained plain-core replay matches fixed native and WASM execution context', async t => {
  const artifact = await compileSource(source, { filename: 'core-replay.ghost.md' });
  const context = Object.freeze({
    sourceRevision: artifact.sourceDocument.sha256,
    settingsEvents: [],
    bindings: [['pump', 'bool'], ['permit', 'bool'], ['ratio', 'number']],
  });
  assert.equal(context.sourceRevision, artifact.sourceDocument.sha256);
  const tape = Array.from({ length: 1025 }, (_, scanId) => ({
    scanId, logicalTimeMs: scanId * 100,
    inputs: { start: scanId === 0, stop: scanId === 1024, low_water: scanId === 1023, divisor: 1 },
  }));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-core-replay-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'module.gfb');
  const tapePath = path.join(directory, 'tape.tsv');
  fs.writeFileSync(modulePath, artifact.bytes);
  fs.writeFileSync(tapePath, `${tape.map(frame => [frame.scanId, frame.logicalTimeMs,
    ...Object.entries(frame.inputs).flatMap(([name, value]) => [name, typeof value === 'boolean' ? 'b' : 'n', String(value)]),
  ].join('\t')).join('\n')}\n`);
  const nativeRun = spawnSync(nativePath, [modulePath, tapePath], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(nativeRun.status, 0, nativeRun.stderr || nativeRun.stdout);
  const native = nativeRun.stdout.trim().split('\n').map(line => JSON.parse(line).outcome.trace);
  const runtime = await GhostFlowRuntime.instantiate(wasmBytes);
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  for (const [name, type] of context.bindings) runtime.addCapability('actuator', name, type);
  runtime.activate();
  assert.equal(runtime.replay, null);
  const wasm = [];
  for (const frame of tape) {
    for (const [name, value] of Object.entries(frame.inputs)) {
      if (typeof value === 'boolean') runtime.setBool(name, value);
      else runtime.setNumber(name, value);
    }
    runtime.tickAt(frame.logicalTimeMs);
    wasm.push(runtime.trace);
  }
  assert.deepEqual(wasm, native);
  assert.deepEqual(wasm.map(record => record.tick), tape.map((_, index) => index + 1));
  assert.equal(wasm[1023].requested.pump, true);
  assert.equal(wasm[1023].safe.pump, false);
  assert.equal(wasm[1024].stateAfter.running, false);

  const live = runtime.trace;
  runtime.setBool('start', true);
  runtime.setBool('stop', false);
  runtime.setBool('low_water', false);
  runtime.setNumber('divisor', 0);
  assert.throws(() => runtime.tickAt(102_500), /division by zero/);
  assert.deepEqual(runtime.trace, live);
  assert.equal(runtime.journalLength, 1024);

  const replay = runtime.replayCore({ count: 1024, maxJsonBytes: 8 * 1024 * 1024 });
  assert.equal(replay.checkpointTick, 1);
  assert.deepEqual(replay.records, native.slice(1));
  assert.deepEqual(runtime.trace, live);
  assert.equal(runtime.journalLength, 1024);
  for (const request of [
    { count: 0, maxJsonBytes: 8 * 1024 * 1024 },
    { count: 1025, maxJsonBytes: 8 * 1024 * 1024 },
    { count: 1024, maxJsonBytes: 1 },
  ]) {
    assert.throws(() => runtime.replayCore(request));
    assert.deepEqual(runtime.replay, replay);
    assert.deepEqual(runtime.trace, live);
  }
  runtime.setNumber('divisor', 1);
  runtime.tickAt(102_500);
  assert.equal(runtime.trace.tick, 1026, 'replay did not consume the pending retry inputs');
  assert.equal(runtime.trace.stateAfter.running, true);
  assert.equal(runtime.trace.safe.pump, true);
});
