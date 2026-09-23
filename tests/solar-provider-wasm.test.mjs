import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { encodeSolarFacts } from '../runtimes/wasm/solar-abi.mjs';

const moduleBytes = () => compile(parse(tokenize(`(module SolarProvider
  (input __gf_now_ms number) (input __gf_time_epoch number)
  (input divisor number)
  (temporal-context __gf_now_ms __gf_time_epoch)
  (strategy main 0 (device true)
    (solar-pulse 201 dawn Asia/Seoul 37.5 127 rise 0 pulse trusted_only 1000 baseline skip true)
    (intent due (schedule-read 0 due))
    (intent quotient (div 1 input.divisor))))`)));
const snapshot = (mono, wall) => ({ clock: {
  monotonicMs: mono, bootEpoch: 7, wallMs: wall, trusted: true,
  uncertaintyMs: 0, sourceRevision: 'clock-v1',
}, schedules: [{ site: 201, coverageFromWallMs: 0, coverageToWallMs: 200000000,
  rows: [{ sourceDay: 0, scheduledWallMs: 1000, available: true,
    providerRevision: 'sun-v1', contextRevision: 'site-v1' }] }] });

test('Solar provider packet rejects host due, unsafe clocks, oversized facts and revisions', () => {
  assert.throws(() => encodeSolarFacts({ ...snapshot(0, 900), due: true }), /unexpected/);
  const unsafe = snapshot(0, 900); unsafe.clock.monotonicMs = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => encodeSolarFacts(unsafe), /monotonicMs/);
  const oversized = snapshot(0, 900); oversized.schedules[0].rows[0].providerRevision = 'x'.repeat(129);
  assert.throws(() => encodeSolarFacts(oversized), /providerRevision/);
  const empty = snapshot(0, 900); empty.schedules = [];
  assert.throws(() => encodeSolarFacts(empty), /schedules/);
});

test('GFB5 WASM provider facts execute native admission, rollback and duplicate suppression', async () => {
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await GhostFlowRuntime.instantiate(wasm);
  try {
    runtime.load(moduleBytes());
    runtime.activateSolar({ bootEpoch: 7, terminalCapacity: 8 });
    const step = (mono, wall, divisor = 1) => {
      runtime.setNumber('__gf_now_ms', mono); runtime.setNumber('__gf_time_epoch', 7);
      runtime.setNumber('divisor', divisor); runtime.tickSolar(snapshot(mono, wall));
      return runtime.trace;
    };
    assert.equal(step(0, 900).safe.due, false);
    assert.throws(() => step(100, 1000, 0), error => error.committed === false);
    const admitted = step(100, 1000);
    assert.equal(admitted.safe.due, true);
    assert.equal(admitted.scheduleTrace[0].observations[0].providerRevision, 'sun-v1');
    assert.equal(step(200, 1100).safe.due, false);
    assert.throws(() => runtime.tick(), /binding|solar|schedule/);
  } finally { runtime.dispose(); }
});

test('raw Solar WASM ABI rejects malformed packets before advancing the runtime', async () => {
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url)));
  try {
    runtime.load(moduleBytes()); runtime.activateSolar({ bootEpoch: 7, terminalCapacity: 8 });
    runtime.setNumber('__gf_now_ms', 0); runtime.setNumber('__gf_time_epoch', 7); runtime.setNumber('divisor', 1);
    const packet = encodeSolarFacts(snapshot(0, 900));
    const raw = bytes => {
      const pointer = runtime.wasm.gf_alloc(bytes.length);
      try {
        new Uint8Array(runtime.wasm.memory.buffer, pointer, bytes.length).set(bytes);
        return runtime.wasm.gf_tick_solar(runtime.handle, pointer, bytes.length);
      } finally { runtime.wasm.gf_dealloc(pointer, bytes.length); }
    };
    for (let length = 0; length < packet.length; length++) assert.equal(raw(packet.slice(0, length)), 0, `truncation ${length}`);
    const trailing = new Uint8Array(packet.length + 1); trailing.set(packet);
    assert.equal(raw(trailing), 0);
    const badFlag = packet.slice(); badFlag[24] = 2; assert.equal(raw(badFlag), 0);
    const wrongVersion = packet.slice(); wrongVersion[4] = 2; assert.equal(raw(wrongVersion), 0);
    const unsafeClock = packet.slice(); new DataView(unsafeClock.buffer).setBigUint64(8, 9007199254740992n, true);
    assert.equal(raw(unsafeClock), 0);
    assert.equal(runtime.wasm.gf_tick_solar(runtime.handle, 0, 65537), 0);
    assert.equal(runtime.trace, null);
    assert.equal(raw(packet), 1);
    assert.equal(runtime.trace.safe.due, false);
  } finally { runtime.dispose(); }
});

test('Solar WASM Unknown clock and recovery baseline never produce catchup due', async () => {
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url)));
  try {
    runtime.load(moduleBytes()); runtime.activateSolar({ bootEpoch: 7, terminalCapacity: 8 });
    const step = packet => {
      runtime.setNumber('__gf_now_ms', packet.clock.monotonicMs);
      runtime.setNumber('__gf_time_epoch', 7); runtime.setNumber('divisor', 1);
      runtime.tickSolar(packet); return runtime.trace.safe.due;
    };
    assert.equal(step(snapshot(0, 900)), false);
    const unknown = snapshot(100, 1000);
    Object.assign(unknown.clock, { trusted: false, unknownReason: 'Offline', wallMs: null });
    assert.equal(step(unknown), false);
    assert.equal(step(snapshot(200, 1100)), false);
    assert.equal(step(snapshot(300, 1200)), false);
  } finally { runtime.dispose(); }
});
