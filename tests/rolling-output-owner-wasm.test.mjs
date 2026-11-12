import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { RollingOutputRuntime } from '../runtimes/wasm/rolling-output-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { compileSource } from '../tools/compile-source.mjs';
import { softwareQualityRails } from './helpers/software-quality-observations.mjs';

const binary = readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));

test('WASM does not grant a watering deadline before saving the reservation', async () => {
  const { instance: { exports: wasm } } = await WebAssembly.instantiate(binary);
  let checkpoint;
  const save = handle => {
    const ptr = wasm.gf_rolling_output_pending_ptr(handle);
    const len = wasm.gf_rolling_output_pending_len(handle);
    assert.ok(len > 0);
    checkpoint = new Uint8Array(wasm.memory.buffer, ptr, len).slice();
    return wasm.gf_rolling_output_ack(handle);
  };
  const open = () => {
    const length = checkpoint?.length ?? 0;
    const ptr = length ? wasm.gf_alloc(length) : 0;
    try {
      if (length) new Uint8Array(wasm.memory.buffer, ptr, length).set(checkpoint);
      const handle = wasm.gf_rolling_output_open(1, 60_000n, 30_000n, 5_000n, 8, 1n, 0n, ptr, length);
      assert.ok(handle);
      return handle;
    } finally {
      if (length) wasm.gf_dealloc(ptr, length);
    }
  };
  let handle = open();
  const explanation = time => {
    const ptr = wasm.gf_alloc(40);
    try {
      const status = wasm.gf_rolling_output_explain(handle, time, ptr);
      if (status === 2) return null;
      assert.equal(status, 1);
      return [...new BigUint64Array(wasm.memory.buffer, ptr, 5)];
    } finally {
      wasm.gf_dealloc(ptr, 40);
    }
  };
  try {
    assert.equal(wasm.gf_rolling_output_prepare(handle, 0n, 0n), 0);
    assert.equal(save(handle), 0n);
    for (let time = 0n; time < 30_000n; time += 5_000n) {
      assert.equal(wasm.gf_rolling_output_prepare(handle, time, 0n), 1);
      assert.equal(wasm.gf_rolling_output_prepare(handle, time, 0n), 0);
      assert.equal(explanation(time), null);
      assert.equal(wasm.gf_rolling_output_finish(handle, true, time, time + 5_000n), 0);
      assert.equal(save(handle), time + 5_000n);
      assert.equal(wasm.gf_rolling_output_finish(handle, true, time, time + 5_000n), 1);
      assert.equal(save(handle), 0n);
    }
    assert.deepEqual(explanation(30_000n), [30_000n, 0n, 1n, 1n, 60_001n]);
    assert.deepEqual(explanation(62_500n), [27_500n, 0n, 0n, 0n, 0n]);
    for (const time of [30_000n, 60_000n]) {
      assert.equal(wasm.gf_rolling_output_prepare(handle, time, 0n), 2);
      assert.equal(wasm.gf_rolling_output_pending_len(handle), 0);
    }
    assert.equal(wasm.gf_rolling_output_prepare(handle, 60_001n, 1n), 4);
    assert.equal(wasm.gf_rolling_output_prepare(handle, 60_002n, 1n), 1);
    assert.equal(save(handle), 60_004n);
    assert.deepEqual(explanation(60_002n), [29_998n, 2n, 1n, 0n, 0n]);
    wasm.gf_rolling_output_close(handle);
    handle = open();
    assert.equal(wasm.gf_rolling_output_ack(handle), 0n);
    assert.equal(wasm.gf_rolling_output_prepare(handle, 80_000n, 0n), 3);
    assert.equal(wasm.gf_rolling_output_recover(handle, 80_000n, 139_999n), 2);
    assert.equal(wasm.gf_rolling_output_recover(handle, 80_000n, 140_000n), 1);
    assert.equal(wasm.gf_rolling_output_prepare(handle, 140_000n, 0n), 0);
    assert.equal(save(handle), 0n);
    assert.equal(wasm.gf_rolling_output_prepare(handle, 140_000n, 0n), 1);
    assert.equal(save(handle), 145_000n);
  } finally {
    wasm.gf_rolling_output_close(handle);
  }
});

const source = [
  '# Rolling watering',
  '',
  '```ghost',
  'control Water {',
  '  input manual: Bool;',
  '  resource irrigation: BoolActuator;',
  '  account watering = on_time(irrigation, stage: applied, persistence: durable, output: valve);',
  '  constraints Budget { limit used(watering, rolling(60s)) <= 30s { reserve = 5s; on_unknown = block; } }',
  '  output valve: Bool;',
  '  valve <- manual |> recover(false);',
  '}',
  '```',
].join('\n');

test('an authored policy binds to the installed output and cannot authorize ON on a failed commit', async () => {
  let checkpoint = null;
  let nextCommit;
  const store = {
    read: async () => checkpoint,
    commit: async (bytes, expected) => {
      if (nextCommit && !await nextCommit) return false;
      if (expected === null ? checkpoint !== null : !checkpoint || !Buffer.from(expected).equals(checkpoint)) return false;
      checkpoint = bytes;
      return true;
    },
  };
  const binding = { resource: 'irrigation', output: 'valve', resourceId: 7 };
  let nowMs = 0;
  const options = { bootEpoch: 1, clock: () => nowMs, binding, maxIntervals: 8, store };
  await assert.rejects(RollingOutputRuntime.open(binary, source, {
    ...options, binding: { ...binding, output: 'other' },
  }), /verified Bool resource and output/);
  const runtime = await RollingOutputRuntime.open(binary, source, options);
  try {
    for (let now = 0; now < 30_000; now += 5_000) {
      nowMs = now;
      assert.deepEqual(await runtime.requestOn(), { status: 'allowed', deadlineMs: now + 5_000 });
      await runtime.recordOff(now, now + 5_000);
    }
    nowMs = 60_000;
    assert.deepEqual(await runtime.requestOn(), { status: 'budget-exceeded' });
    assert.deepEqual(runtime.explain(60_000), {
      usedMs: 30_000n, reservedMs: 0n, blocked: true, nextReleaseMs: 60_001n,
    });
    nowMs = 60_001;
    assert.deepEqual(await runtime.requestOn(1), { status: 'stop-margin' });
    let rejectCommit;
    nextCommit = new Promise(resolve => { rejectCommit = resolve; });
    nowMs = 65_000;
    const pending = runtime.requestOn();
    await assert.rejects(runtime.requestOn(), /unavailable while saving/);
    rejectCommit(false);
    await assert.rejects(pending, /not committed/);
    assert.deepEqual(await runtime.requestOn(), { status: 'unavailable' });
  } finally {
    runtime.dispose();
  }
  nextCommit = undefined;
  const recovered = await RollingOutputRuntime.open(binary, source, options);
  const duplicate = await RollingOutputRuntime.open(binary, source, options);
  try {
    assert.deepEqual(await recovered.requestOn(), { status: 'allowed', deadlineMs: 70_000 });
    await assert.rejects(duplicate.requestOn(), /not committed/);
  } finally {
    recovered.dispose();
    duplicate.dispose();
  }
});


test('a checkpoint acknowledged at the ON deadline never authorizes an output', async () => {
  let checkpoint = null;
  let nowMs = 0;
  let delayMs = 0;
  const store = {
    read: async () => checkpoint,
    commit: async bytes => {
      nowMs += delayMs;
      delayMs = 0;
      checkpoint = bytes;
      return true;
    },
  };
  const options = { bootEpoch: 1, clock: () => nowMs, maxIntervals: 8, store,
    binding: { resource: 'irrigation', output: 'valve', resourceId: 7 } };
  const runtime = await RollingOutputRuntime.open(binary, source, options);
  try {
    delayMs = 5_000;
    assert.deepEqual(await runtime.requestOn(), { status: 'deadline-expired' });
    assert.deepEqual(runtime.explain(nowMs), {
      usedMs: 0n, reservedMs: 0n, blocked: false, nextReleaseMs: null,
    });
  } finally {
    runtime.dispose();
  }
  const reopened = await RollingOutputRuntime.open(binary, source, options);
  try {
    assert.deepEqual(await reopened.requestOn(), { status: 'allowed', deadlineMs: 10_000 });
  } finally {
    reopened.dispose();
  }
});

test('a fresh boot needs a full verified OFF window before the saved limit can resume', async () => {
  let checkpoint = null;
  let nowMs = 1_000_000;
  const store = {
    read: async () => checkpoint,
    commit: async (bytes, expected) => {
      if (expected === null ? checkpoint !== null : !checkpoint || !Buffer.from(expected).equals(checkpoint)) return false;
      checkpoint = bytes;
      return true;
    },
  };
  const options = { bootEpoch: 1, clock: () => nowMs, maxIntervals: 8, store,
    binding: { resource: 'irrigation', output: 'valve', resourceId: 7 } };
  const original = await RollingOutputRuntime.open(binary, source, options);
  try {
    assert.deepEqual(await original.requestOn(), { status: 'allowed', deadlineMs: 1_005_000 });
  } finally {
    original.dispose();
  }
  nowMs = 0;
  const restarted = await RollingOutputRuntime.open(binary, source, { ...options, bootEpoch: 2 });
  try {
    assert.deepEqual(await restarted.requestOn(), { status: 'unavailable' });
    assert.equal(restarted.explain(nowMs), null);
    nowMs = 60_999;
    assert.equal(await restarted.recoverAfterConfirmedOff(1000, nowMs), false);
    nowMs += 1;
    assert.equal(await restarted.recoverAfterConfirmedOff(1000, nowMs), true);
    assert.deepEqual(await restarted.requestOn(), { status: 'allowed', deadlineMs: 66_000 });
  } finally {
    restarted.dispose();
  }
});


test('same-boot late OFF requires a new complete OFF window and checkpoint', async () => {
  let checkpoint = null;
  let nowMs = 0;
  const runtime = await RollingOutputRuntime.open(binary, source, {
    bootEpoch: 1, clock: () => nowMs,
    binding: { resource: 'irrigation', output: 'valve', resourceId: 7 }, maxIntervals: 8,
    store: {
      read: async () => checkpoint,
      commit: async bytes => { checkpoint = bytes; return true; },
    },
  });
  try {
    assert.deepEqual(await runtime.requestOn(), { status: 'allowed', deadlineMs: 5000 });
    await assert.rejects(runtime.recordOff(0, 5001), /could not settle/);
    nowMs = 65000;
    assert.equal(await runtime.recoverAfterConfirmedOff(5001, nowMs), false);
    assert.deepEqual(await runtime.requestOn(), { status: 'unavailable' });
    nowMs = 65001;
    assert.equal(await runtime.recoverAfterConfirmedOff(5001, nowMs), true);
    assert.deepEqual(await runtime.requestOn(), { status: 'allowed', deadlineMs: 70001 });
  } finally { runtime.dispose(); }
});


test('mandatory GFB29 evaluates safe proposals only through a bound rolling owner', async () => {
  const artifact = await compileSource(source);
  const generic = await FramedGhostFlowRuntime.instantiate(binary);
  try {
    assert.throws(() => generic.load(artifact.bytes), /unsupported GFB format/);
  } finally {
    generic.dispose();
  }
  let checkpoint = null;
  const owner = await RollingOutputRuntime.open(binary, source, {
    bootEpoch: 1, clock: () => 0,
    binding: { resource: 'irrigation', output: 'valve', resourceId: 7 }, maxIntervals: 8,
    store: {
      read: async () => checkpoint,
      commit: async bytes => { checkpoint = bytes; return true; },
    },
  });
  const runtime = owner.createProposalRuntime([{ kind: 'actuator', name: 'valve', type: 'bool' }]);
  try {
    const inputs = Object.entries(softwareQualityRails(artifact, { manual: true }, 1, 0))
      .map(([name, value]) => ({ name, value }));
    const result = runtime.scan({ scanId: 0, logicalTimeMs: 0, inputs });
    assert.equal(result.trace.safe.valve, true);
    assert.deepEqual(owner.explain(0), { usedMs: 0n, reservedMs: 0n, blocked: false, nextReleaseMs: null });
    assert.deepEqual(await owner.requestOn(1), { status: 'allowed', deadlineMs: 5000 });
    assert.equal(owner.explain(0).reservedMs, 5000n);
  } finally {
    runtime.dispose();
    owner.dispose();
  }
});
