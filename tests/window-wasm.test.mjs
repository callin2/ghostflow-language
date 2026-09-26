import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { encodeTemporalProfile } from '../runtimes/wasm/temporal-profile.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const bytes = compile(parse(tokenize(`(module WindowWasm (version 1)
  (input __gf_now_ms number) (input __gf_time_epoch number)
  (input present bool) (input epoch number) (input id number) (input timestamp number)
  (input value number) (input divisor int)
  (state count int 0)
  (temporal-context __gf_now_ms __gf_time_epoch)
  (temporal-root 11 source present epoch id timestamp)
  (strategy main 0 (device true)
    (window 101 mean average number 1000 500 (roots 11) (source true input.value 3 11 1 11))
    (next count (int-add state.count (int 1)))
    (intent mean (window-read 0 value))
    (intent guard (int-div (int 1) input.divisor))))`)));
const profile = () => ({ timeEpoch: 7, rootDensity: [{ sourceTag: 11, maxObservations: 4, intervalMs: 1000 }], budget: { maxRetainedSamples: 4, maxBytes: 4_000_000 } });

async function create(t, framed) {
  const runtime = await (framed ? FramedGhostFlowRuntime : GhostFlowRuntime).instantiate(wasm);
  t.after(() => runtime.dispose());
  runtime.load(bytes);
  runtime.addCapability('actuator', 'mean', 'number');
  runtime.addCapability('actuator', 'guard', 'int');
  return runtime;
}
function scan(runtime, framed, scanId, time, value, divisor = 1) {
  const values = { __gf_time_epoch: 7, present: true, epoch: 1, id: scanId + 1, timestamp: time, value, divisor };
  if (framed) return runtime.scan({ scanId, logicalTimeMs: time, inputs: Object.entries(values).map(([name, value]) => ({ name, value, type: name === 'divisor' ? 'Int' : typeof value === 'boolean' ? 'Bool' : 'Number' })) }).trace;
  for (const [name, value] of Object.entries(values)) {
    if (name === 'divisor') runtime.setInt(name, value);
    else if (typeof value === 'boolean') runtime.setBool(name, value);
    else runtime.setNumber(name, value);
  }
  runtime.tickAt(time);
  return runtime.trace;
}

for (const framed of [false, true]) {
  test(`${framed ? 'framed' : 'legacy'} WASM temporal activation executes Rust aggregates and rolls back a late fault`, async t => {
    const runtime = await create(t, framed);
    runtime.activateTemporal(profile());
    assert.equal(scan(runtime, framed, 0, 0, 20).safe.mean, 20);
    assert.throws(() => scan(runtime, framed, 1, 100, 90, 0), /integer-division-by-zero/);
    const retry = scan(runtime, framed, 1, 100, 30);
    assert.equal(retry.safe.mean, 25);
    assert.equal(retry.stateAfter.count, 2);
    assert.deepEqual(retry.windowTrace[0].contributors.map(point => point.value), [20, 30]);
    assert.equal(retry.windowTrace[0].admissionRevision, 2);
    assert.throws(() => runtime.activateTemporal(profile()), /already activat|already active/);
    assert.equal(scan(runtime, framed, 2, 200, 40).safe.mean, 30);
  });

  test(`${framed ? 'framed' : 'legacy'} failed temporal activation preserves configuring state and permits retry`, async t => {
    const runtime = await create(t, framed);
    for (const [invalid, message] of [
      [{ ...profile(), budget: { maxRetainedSamples: 3, maxBytes: 4_000_000 } }, 'temporal-budget-exceeded'],
      [{ ...profile(), budget: { maxRetainedSamples: 4, maxBytes: 1 } }, 'temporal-budget-exceeded'],
      [{ ...profile(), rootDensity: [{ sourceTag: 12, maxObservations: 4, intervalMs: 1000 }] }, 'temporal activation root contract mismatch'],
    ]) assert.throws(() => runtime.activateTemporal(invalid), { message });
    runtime.activateTemporal(profile());
    assert.equal(scan(runtime, framed, 0, 0, 12).safe.mean, 12);
  });

  test(`${framed ? 'framed' : 'legacy'} native packet parser rejects malformed profiles before activation`, async t => {
    const runtime = await create(t, framed);
    const native = runtime.wasm;
    const activate = native[framed ? 'gf_frame_activate_temporal' : 'gf_activate_temporal'];
    const valid = encodeTemporalProfile(profile());
    const invoke = packet => {
      const ptr = native.gf_alloc(packet.length);
      try {
        new Uint8Array(native.memory.buffer, ptr, packet.length).set(packet);
        return activate(runtime.handle, ptr, packet.length);
      } finally { native.gf_dealloc(ptr, packet.length); }
    };
    for (let cut = 0; cut < valid.length; cut++) assert.equal(invoke(valid.slice(0, cut)), 0, `cut ${cut}`);
    const malformed = [new Uint8Array(521), Uint8Array.from([...valid, 0])];
    for (const [offset, value] of [[0, 0], [4, 2], [6, 0], [6, 32], [16, 0], [24, 0], [28, 0]]) {
      const packet = valid.slice(); packet[offset] = value; malformed.push(packet);
    }
    for (const packet of malformed) assert.equal(invoke(packet), 0);
    assert.equal(activate(runtime.handle, 0, valid.length), 0);
    assert.equal(activate(runtime.handle, 0, 521), 0);
    assert.equal(activate(0, 0, 0), 0);
    runtime.activateTemporal(profile());
    assert.equal(scan(runtime, framed, 0, 0, 17).safe.mean, 17);
  });
}

test('temporal profile encoder has exact independent binary layout and safe integer limits', () => {
  assert.equal(Buffer.from(encodeTemporalProfile(profile())).toString('hex'), '474654410100010007000000000000000400000000093d000b00000004000000e803000000000000');
  const maximum = { timeEpoch: Number.MAX_SAFE_INTEGER, rootDensity: [{ sourceTag: 0xffff_ffff, maxObservations: 0xffff_ffff, intervalMs: Number.MAX_SAFE_INTEGER }], budget: { maxRetainedSamples: 0xffff_ffff, maxBytes: 0xffff_ffff } };
  const view = new DataView(encodeTemporalProfile(maximum).buffer);
  assert.equal(view.getBigUint64(8, true), BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(view.getUint32(20, true), 0xffff_ffff);
});

const invalidProfiles = [
  ['missing epoch', p => { delete p.timeEpoch; }, TypeError],
  ['unknown profile key', p => { p.extra = 1; }, TypeError],
  ['unknown symbol key', p => { p[Symbol('extra')] = 1; }, TypeError],
  ['unsafe epoch', p => { p.timeEpoch = 2 ** 53; }, RangeError],
  ['negative epoch', p => { p.timeEpoch = -1; }, RangeError],
  ['fractional epoch', p => { p.timeEpoch = 0.5; }, RangeError],
  ['empty roots', p => { p.rootDensity = []; }, RangeError],
  ['excess roots', p => { p.rootDensity = Array.from({ length: 32 }, (_, i) => ({ ...p.rootDensity[0], sourceTag: i + 1 })); }, RangeError],
  ['missing root', p => { delete p.rootDensity[0]; }, TypeError],
  ['duplicate tags', p => { p.rootDensity.push({ ...p.rootDensity[0] }); }, RangeError],
  ['descending tags', p => { p.rootDensity.push({ ...p.rootDensity[0], sourceTag: 1 }); }, RangeError],
  ['zero tag', p => { p.rootDensity[0].sourceTag = 0; }, RangeError],
  ['tag overflow', p => { p.rootDensity[0].sourceTag = 2 ** 32; }, RangeError],
  ['zero density', p => { p.rootDensity[0].maxObservations = 0; }, RangeError],
  ['density overflow', p => { p.rootDensity[0].maxObservations = 2 ** 32; }, RangeError],
  ['zero interval', p => { p.rootDensity[0].intervalMs = 0; }, RangeError],
  ['unsafe interval', p => { p.rootDensity[0].intervalMs = 2 ** 53; }, RangeError],
  ['unknown root key', p => { p.rootDensity[0].extra = 1; }, TypeError],
  ['missing budget key', p => { delete p.budget.maxBytes; }, TypeError],
  ['unknown budget key', p => { p.budget.extra = 1; }, TypeError],
  ['zero budget', p => { p.budget.maxBytes = 0; }, RangeError],
  ['byte budget overflow', p => { p.budget.maxBytes = 2 ** 32; }, RangeError],
  ['sample budget overflow', p => { p.budget.maxRetainedSamples = 2 ** 32; }, RangeError],
];
for (const [label, mutate, ErrorType] of invalidProfiles) test(`temporal profile rejects ${label}`, () => {
  const candidate = profile(); mutate(candidate);
  assert.throws(() => encodeTemporalProfile(candidate), error => error.constructor === ErrorType);
});
