import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { AfterEventRuntime, encodeAfterEventBatch } from '../runtimes/wasm/after-event-runtime.mjs';
const wasm = () => fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const event = (id, atMs) => ({ sourceTag: 11, sourceEpoch: 2, id, timeEpoch: 7, atMs });
const key = id => ({ sourceTag: 11, sourceEpoch: 2, id });
const batch = (nowMs, starts = [], predicate = null, acknowledgements = []) => ({
  time: { epoch: 7, nowMs }, starts, predicate, acknowledgements,
});
const predicate = (atMs, quality = 'measured') => ({ sourceTag: 22, atMs, value: true, quality });
const create = () => AfterEventRuntime.instantiate(wasm(), { windowMs: 10, eventSourceTag: 11, predicateSourceTag: 22 });

test('canonical source binds event identity and predicate without choosing a scalar result', async () => {
  const filename = 'after-event-evidence.ghost.md';
  const source = fs.readFileSync(new URL(`./fixtures/${filename}`, import.meta.url), 'utf8');
  const runtime = await AfterEventRuntime.instantiateSource(wasm(), source, { filename, signal: 'opened' });
  try {
    const { eventSourceTag, predicateSourceTag, windowMs } = runtime.binding;
    assert.equal(windowMs, 10_000);
    const start = (id, atMs) => ({ sourceTag: eventSourceTag, sourceEpoch: 2, id, timeEpoch: 7, atMs });
    runtime.stage(batch(0, [start(1, 0)])); runtime.commit();
    runtime.stage(batch(5_000, [start(2, 5_000)])); runtime.commit();
    runtime.stage(batch(10_000, [], { sourceTag: predicateSourceTag, atMs: 10_000, value: true, quality: 'measured' }));
    runtime.rollback();
    assert.deepEqual(runtime.results.map(result => result.status), ['pending', 'pending']);
    runtime.stage(batch(10_000, [], { sourceTag: predicateSourceTag, atMs: 10_000, value: true, quality: 'measured' }));
    runtime.commit();
    assert.deepEqual(runtime.results.map(result => [result.event.id, result.status]), [[1, 'expired'], [2, 'satisfied']]);
    assert.equal(runtime.source.signal, 'opened');
    assert.equal(runtime.source.filename, filename);
    assert.equal(runtime.source.text, source);
    assert.equal(runtime.source.event, 'started');
    assert.equal(runtime.source.predicate, 'valve_open');
    assert.deepEqual(runtime.source.projections, ['any']);
    assert.match(runtime.source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(Object.isFrozen(runtime.binding), true);
    assert.equal(Object.isFrozen(runtime.source), true);
    assert.throws(() => { runtime.binding.eventSourceTag = 999; }, TypeError);
    assert.throws(() => runtime.stage(batch(10_001, [{ ...start(3, 10_001), sourceTag: eventSourceTag + 1 }])), /event.*binding/);
    assert.equal(runtime.results.length, 2);
  } finally { runtime.dispose(); }
});

test('source binding requires an explicit existing after_event site and canonical literate source', async () => {
  const filename = 'after-event-evidence.ghost.md';
  const source = fs.readFileSync(new URL(`./fixtures/${filename}`, import.meta.url), 'utf8');
  await assert.rejects(() => AfterEventRuntime.instantiateSource(wasm(), source), /signal name is required/);
  for (const signal of ['missing', 'valve_open']) {
    await assert.rejects(() => AfterEventRuntime.instantiateSource(wasm(), source, { filename, signal }), /no after_event signal/);
  }
  await assert.rejects(() => AfterEventRuntime.instantiateSource(wasm(), source, { filename: 'raw.ghost', signal: 'opened' }), /canonical.*ghost.md/);
  const twoSites = source.replace('  output confirmed:', '  signal second = after_event(started, valve_open, window: 1s, quality: measured);\n  output confirmed:');
  const runtime = await AfterEventRuntime.instantiateSource(wasm(), twoSites, { filename, signal: 'second' });
  try {
    assert.equal(runtime.binding.windowMs, 1_000);
    assert.equal(runtime.source.signal, 'second');
  } finally { runtime.dispose(); }
  await assert.rejects(() => AfterEventRuntime.instantiateSource(wasm(), '# Empty\n', { filename, signal: 'opened' }));
});

test('native after_event WASM tracks overlapping identities and preserves half-open boundaries', async () => {
  const runtime = await create();
  try {
    runtime.stage(batch(0, [event(1, 0)]));
    assert.deepEqual(runtime.results, []);
    runtime.commit();
    runtime.stage(batch(5, [event(2, 5)])); runtime.commit();
    runtime.stage(batch(10, [], predicate(10))); runtime.commit();
    assert.deepEqual(runtime.results.map(({ event, status, satisfiedAtMs }) => [event.id, status, satisfiedAtMs]), [
      [1, 'expired', undefined], [2, 'satisfied', 10],
    ]);
    runtime.stage(batch(11, [], null, [key(1)])); runtime.rollback();
    assert.equal(runtime.results.length, 2);
    runtime.stage(batch(11, [], null, [key(1)])); runtime.commit();
    assert.deepEqual(runtime.results.map(result => result.event.id), [2]);
  } finally { runtime.dispose(); }
});

test('after_event_any aggregates the retained overlapping identity snapshot', async () => {
  const runtime = await create();
  try {
    assert.deepEqual(runtime.any(), { ok: false, fault: 'NotReady' });
    runtime.stage(batch(0, [event(1, 0)])); runtime.commit();
    assert.deepEqual(runtime.any(), { ok: false, fault: 'NotReady' });
    runtime.stage(batch(5, [event(2, 5)])); runtime.commit();
    runtime.stage(batch(10, [], predicate(10))); runtime.commit();
    assert.deepEqual(runtime.results.map(result => result.status), ['expired', 'satisfied']);
    assert.deepEqual(runtime.any(), { ok: true, value: true });
    assert.deepEqual(runtime.all(), { ok: true, value: false });
    runtime.stage(batch(11, [], null, [key(2)])); runtime.commit();
    assert.deepEqual(runtime.any(), { ok: true, value: false });
    assert.deepEqual(runtime.all(), { ok: true, value: false });
  } finally { runtime.dispose(); }
});

test('native projections expose staged results without committing tracker state', async () => {
  const runtime = await create();
  try {
    runtime.stage(batch(0, [event(1, 0)], predicate(0)));
    assert.deepEqual(runtime.stagedAny(), { ok: true, value: true });
    assert.deepEqual(runtime.stagedAll(), { ok: true, value: true });
    assert.deepEqual(runtime.any(), { ok: false, fault: 'NotReady' });
    runtime.rollback();
    assert.deepEqual(runtime.any(), { ok: false, fault: 'NotReady' });
  } finally { runtime.dispose(); }
});

test('native after_event WASM does not accept Held evidence or consume a failed batch', async () => {
  const runtime = await create();
  try {
    runtime.stage(batch(0, [event(1, 0)], predicate(0, 'held'))); runtime.commit();
    assert.equal(runtime.results[0].status, 'pending');
    assert.throws(() => runtime.stage(batch(1, [event(2, 1)], { ...predicate(1), sourceTag: 23 })), /predicate.*binding/);
    assert.equal(runtime.results.length, 1);
    runtime.stage(batch(1, [event(2, 1)], predicate(1))); runtime.commit();
    assert.deepEqual(runtime.results.map(result => result.status), ['satisfied', 'satisfied']);
    const before = runtime.results;
    assert.throws(() => runtime.stage(batch(2, [event(3, 2), { ...event(4, 2), sourceTag: 12 }])), /event.*binding/);
    assert.deepEqual(runtime.results, before);
  } finally { runtime.dispose(); }
  assert.throws(() => runtime.results, /disposed/);
});

test('raw after_event ABI rejects malformed packets before staging native state', async () => {
  const runtime = await create();
  const raw = bytes => {
    const pointer = runtime.wasm.gf_alloc(bytes.length);
    try {
      new Uint8Array(runtime.wasm.memory.buffer, pointer, bytes.length).set(bytes);
      return runtime.wasm.gf_after_event_stage(runtime.handle, pointer, bytes.length);
    } finally { runtime.wasm.gf_dealloc(pointer, bytes.length); }
  };
  try {
    const packet = encodeAfterEventBatch(batch(0, [event(1, 0)], predicate(0)));
    for (let length = 0; length < packet.length; length++) assert.equal(raw(packet.slice(0, length)), 0, `truncation ${length}`);
    const trailing = new Uint8Array(packet.length + 1); trailing.set(packet); assert.equal(raw(trailing), 0);
    for (const [offset, value] of [[4, 2], [6, 1], [24, 33], [28, 2], [packet.length - 2, 2], [packet.length - 1, 3]]) {
      const invalid = packet.slice(); invalid[offset] = value; assert.equal(raw(invalid), 0, `invalid byte ${offset}`);
    }
    const unsafe = packet.slice(); new DataView(unsafe.buffer).setBigUint64(8, 9007199254740992n, true);
    assert.equal(raw(unsafe), 0);
    assert.equal(runtime.wasm.gf_after_event_stage(runtime.handle, 0, 2049), 0);
    assert.deepEqual(runtime.results, []);
    assert.throws(() => runtime.commit(), /NotStaged/);
    assert.equal(raw(packet), 1);
    assert.equal(raw(packet), 0, 'second stage must not replace pending transaction');
    assert.equal(raw(trailing), 0);
    runtime.commit();
    assert.equal(runtime.results[0].status, 'satisfied');
  } finally { runtime.dispose(); }
});

test('native capacity failure rolls back expiry and acknowledgement releases only terminal identities', async () => {
  const runtime = await create();
  try {
    runtime.stage(batch(0, Array.from({ length: 32 }, (_, i) => event(i + 1, 0)))); runtime.commit();
    assert.equal(runtime.results.length, 32);
    assert.throws(() => runtime.stage(batch(10, [event(33, 10)])), /CapacityExceeded/);
    assert.ok(runtime.results.every(result => result.status === 'pending'));
    assert.throws(() => runtime.stage(batch(5, [], null, [key(1)])), /InvalidIdentity/);
    runtime.stage(batch(10, [event(33, 10)], null, [key(1)])); runtime.commit();
    assert.equal(runtime.results.length, 32);
    assert.equal(runtime.results.find(result => result.event.id === 33).status, 'pending');
    assert.equal(runtime.results.filter(result => result.status === 'expired').length, 31);
    assert.throws(() => runtime.stage({ ...batch(11), time: { epoch: 8, nowMs: 11 } }), /IdentityMismatch/);
    assert.throws(() => runtime.stage(batch(9)), /ClockBackward/);
  } finally { runtime.dispose(); }
});

test('host transport rejects unbounded values, unknown fields, and untyped evidence', async () => {
  for (const invalid of [
    { ...batch(0), due: true },
    { ...batch(Number.MAX_SAFE_INTEGER + 1) },
    batch(0, Array.from({ length: 33 }, (_, i) => event(i, 0))),
    batch(0, [], { ...predicate(0), value: 1 }),
    batch(0, [], { ...predicate(0), quality: 'good' }),
    batch(0, [{ ...event(1, 0), sourceTag: 0 }]),
  ]) assert.throws(() => encodeAfterEventBatch(invalid));
  await assert.rejects(() => AfterEventRuntime.instantiate(wasm(), { windowMs: 0, eventSourceTag: 11, predicateSourceTag: 22 }), /windowMs/);
});
