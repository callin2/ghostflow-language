import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
      const handle = wasm.gf_rolling_output_open(1, 60_000n, 30_000n, 5_000n, 8, 0n, ptr, length);
      assert.ok(handle);
      return handle;
    } finally {
      if (length) wasm.gf_dealloc(ptr, length);
    }
  };
  let handle = open();
  try {
    assert.equal(wasm.gf_rolling_output_prepare(handle, 0n), 0);
    assert.equal(save(handle), 0n);
    for (let time = 0n; time < 30_000n; time += 5_000n) {
      assert.equal(wasm.gf_rolling_output_prepare(handle, time), 1);
      assert.equal(wasm.gf_rolling_output_prepare(handle, time), 0);
      assert.equal(wasm.gf_rolling_output_finish(handle, true, time, time + 5_000n), 0);
      assert.equal(save(handle), time + 5_000n);
      assert.equal(wasm.gf_rolling_output_finish(handle, true, time, time + 5_000n), 1);
      assert.equal(save(handle), 0n);
    }
    for (const time of [30_000n, 60_000n, 64_999n]) {
      assert.equal(wasm.gf_rolling_output_prepare(handle, time), 2);
      assert.equal(wasm.gf_rolling_output_pending_len(handle), 0);
    }
    assert.equal(wasm.gf_rolling_output_prepare(handle, 65_000n), 1);
    assert.equal(save(handle), 70_000n);
    wasm.gf_rolling_output_close(handle);
    handle = open();
    assert.equal(wasm.gf_rolling_output_ack(handle), 0n);
    assert.equal(wasm.gf_rolling_output_prepare(handle, 80_000n), 3);
    assert.equal(wasm.gf_rolling_output_recover(handle, 80_000n, 139_999n), 2);
    assert.equal(wasm.gf_rolling_output_recover(handle, 80_000n, 140_000n), 1);
    assert.equal(wasm.gf_rolling_output_prepare(handle, 140_000n), 0);
    assert.equal(save(handle), 0n);
    assert.equal(wasm.gf_rolling_output_prepare(handle, 140_000n), 1);
    assert.equal(save(handle), 145_000n);
  } finally {
    wasm.gf_rolling_output_close(handle);
  }
});
