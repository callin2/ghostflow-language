import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileSource } from './helpers/literate-compile.mjs';

const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);
const source = `control RestartHost {
  type RestartReason = PowerOn | Brownout | Watchdog | Software | Unknown;
  input start: Bool;
  input restart_reason: RestartReason;
  input restart_event: Bool;
  output pump: Bool;
  pump <- if restart_event then start else false;
}`;

test('GF-TEST-control-runtime-restart-lifecycle: injects host restart fields and excludes caller overrides', async t => {
  const artifact = await compileSource(source, { filename: 'restart-host.ghost' });
  const runtime = await ControlRuntime.instantiateFramed(fs.readFileSync(wasmPath), artifact,
    { restart: { reasonOrdinal: 2, eventPending: true } });
  t.after(() => runtime.dispose());
  assert.equal(runtime.restartEventPending, true);
  assert.throws(() => runtime.step({ nowMs: 0, inputs: { start: true, restart_event: false, restart_reason: 1 } }), /unknown input/);
  const first = runtime.step({ nowMs: 0, inputs: { start: true } });
  assert.equal(first.vm.inputs.restart_reason, 2);
  assert.equal(first.vm.inputs.restart_event, true);
  assert.equal(runtime.restartEventPending, false);
  const next = runtime.step({ nowMs: 1, inputs: { start: true } });
  assert.equal(next.vm.inputs.restart_reason, 2);
  assert.equal(next.vm.inputs.restart_event, false);
});

test('GF-TEST-control-runtime-restart-lifecycle: requires lifecycle initialization and metadata agreement', async () => {
  const artifact = await compileSource(source, { filename: 'restart-host.ghost' });
  await assert.rejects(ControlRuntime.instantiateFramed(fs.readFileSync(wasmPath), artifact), /restart initialization/);
  const forged = structuredClone(artifact);
  forged.manifest.lifecycle.restartReasonMembers[0].name = 'Forged';
  await assert.rejects(ControlRuntime.instantiateFramed(fs.readFileSync(wasmPath), forged,
    { restart: { reasonOrdinal: 0, eventPending: true } }), /restart reason members/);
});
