import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileSource } from './helpers/literate-compile.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

const wasmPath = new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url);
const source = `control RestartHost {
  type RestartReason = PowerOn | Brownout | Watchdog | Software | Unknown;
  input start: Bool;
  input restart_reason: RestartReason;
  input restart_event: Bool;
  output pump: Bool;
  pump <- if restart_event then (start |> recover(false)) else false;
}`;

test('lifecycle candidate rejects historical GFB19 wrapper and malformed GFB21 bytes', async t => {
  const artifact = await compileSource(source, { filename: 'restart-host.ghost' });
  const wasm = fs.readFileSync(wasmPath);
  const runtime = await FramedGhostFlowRuntime.instantiate(wasm);
  t.after(() => runtime.dispose());
  const valid = Buffer.from(artifact.bytes);
  assert.equal(valid.readUInt16LE(4), 21);
  const oldWrapper = Buffer.from(valid);
  oldWrapper.writeUInt16LE(19, 4);
  assert.throws(() => runtime.load(oldWrapper));
  assert.throws(() => runtime.load(valid.subarray(0, 9)), /truncated/);
  assert.throws(() => runtime.load(Buffer.concat([valid, Buffer.from([0])])), /trailing/);
  const oversized = Buffer.from(valid);
  oversized.writeUInt32LE(0xffffffff, 6);
  assert.throws(() => runtime.load(oversized), /byte limit/);
  const nested = Buffer.from(valid);
  nested.writeUInt16LE(21, 14);
  assert.throws(() => runtime.load(nested), /nested/);
  const invalidDescriptor = Buffer.from(valid);
  invalidDescriptor[10 + valid.readUInt32LE(6) + 2] = 0x78;
  assert.throws(() => runtime.load(invalidDescriptor), /invalid lifecycle descriptor/);
  runtime.load(valid);
});

test('GF-TEST-control-runtime-restart-lifecycle: injects host restart fields and excludes caller overrides', async t => {
  const artifact = await compileSource(source, { filename: 'restart-host.ghost' });
  const runtime = await ControlRuntime.instantiateFramed(fs.readFileSync(wasmPath), artifact,
    { restart: { reasonOrdinal: 2, eventPending: true } });
  t.after(() => runtime.dispose());
  assert.equal(runtime.restartEventPending, true);
  assert.throws(() => runtime.step({ nowMs: 0, inputs: { start: true, restart_event: false, restart_reason: 1 } }), /unknown input/);
  const first = runtime.step({ nowMs: 0, samples: { start: { epoch: 1, id: 1, timestampMs: 0, quality: 'Good', value: true } } });
  assert.equal(first.vm.inputs.restart_reason, 2);
  assert.equal(first.vm.inputs.restart_event, true);
  assert.equal(runtime.restartEventPending, false);
  const next = runtime.step({ nowMs: 1, samples: { start: { epoch: 1, id: 2, timestampMs: 1, quality: 'Good', value: true } } });
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

test('provisional lifecycle framing composes with canonical GFB19 Range start', async t => {
  const artifact = await compileSource(`control RestartRange {
    type RestartReason = PowerOn | Brownout | Watchdog | Software | Unknown;
    input restart_reason: RestartReason;
    input restart_event: Bool;
    config start: TimeOfDay = time\`08:00\` {
      min = time\`08:00\`; max = time\`08:30\`; step = 1min; access = operator;
    }
    schedule watering: Daily {
      timezone = "UTC"; at = start; dst_missing = skip; dst_repeated = first;
      basis = range(10min); when = true; cancel_when = false;
      clock = trusted_only; gap = skip_after(60s); recovery = baseline; fallback = skip;
    }
    output pump: Bool;
    pump <- watering.active && restart_event;
  }`, { filename: 'restart-range.ghost' });
  const bytes = Buffer.from(artifact.bytes);
  assert.equal(bytes.readUInt16LE(4), 21);
  assert.equal(bytes.readUInt16LE(14), 19);
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v19');
  const runtime = await ControlRuntime.instantiateFramed(fs.readFileSync(wasmPath), artifact, {
    context: { bootEpoch: 1, terminalCapacity: 64, bindings: [] },
    restart: { reasonOrdinal: 4, eventPending: true },
  });
  t.after(() => runtime.dispose());
  const site = artifact.manifest.schedules[0].site;
  const step = nowMs => runtime.step({ nowMs, inputs: {}, contextFacts: {
    clock: { monotonicMs: nowMs, bootEpoch: 1,
      wallMs: Date.UTC(2026, 0, 1, 8) + nowMs, uncertaintyMs: 0,
      trusted: true, unknownReason: null, sourceRevision: 'restart-range-v1' },
    natural: [], schedules: [{ site, coverageStartMs: 0, coverageEndMs: 253402300799999,
      provider: null, calendar: null, rows: [] }], settings: null,
  } });
  assert.equal(step(0).vm.inputs.restart_event, true);
  assert.equal(step(1).vm.inputs.restart_event, false);
  assert.equal(runtime.restartEventPending, false);
});
