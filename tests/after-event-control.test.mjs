import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileSource } from './helpers/literate-compile.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const source = `# After event control

\`\`\`ghost
control AfterEventControl {
  input divisor: Number;
  event started: Event;
  sensor valve_open: Bool;
  signal opened = after_event(started, valve_open, window: 10s, quality: measured);
  output any_opened, all_opened: Bool;
  output quotient: Number;
  any_opened <- after_event_any(opened) |> recover(false);
  all_opened <- after_event_all(opened) |> recover(false);
  quotient <- 1.0 / divisor;
}
\`\`\`
`;
const sample = (id, timestampMs, value, quality = 'Good') => ({
  epoch: 3, id, timestampMs, value, quality,
});
const start = (id, atMs) => ({ sourceEpoch: 2, id, atMs });
const eventBatch = (starts = [], acknowledgements = []) => ({ started: { starts, acknowledgements } });

test('after_event artifacts require an identified event activation profile', async () => {
  const artifact = await compileSource(source, { filename: 'after-event-control.ghost.md' });
  await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact),
    /afterEvent must be an object/);
});

test('ControlRuntime keeps overlapping identities independent at the half-open boundary', async t => {
  const artifact = await compileSource(source, { filename: 'after-event-control.ghost.md' });
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { afterEvent: { timeEpoch: 7 } });
  t.after(() => runtime.dispose());

  const first = runtime.step({ nowMs: 0, inputs: { divisor: 1 }, events: eventBatch([start(1, 0)]) });
  assert.deepEqual(first.vm.safe, { all_opened: false, any_opened: false, quotient: 1 });
  const second = runtime.step({ nowMs: 5_000, inputs: { divisor: 1 }, events: eventBatch([start(2, 5_000)]) });
  assert.deepEqual(second.vm.safe, { all_opened: false, any_opened: false, quotient: 1 });
  const boundary = runtime.step({
    nowMs: 10_000,
    inputs: { divisor: 1 },
    samples: { valve_open: sample(1, 10_000, true) },
  });
  assert.deepEqual(runtime.afterEvents.get('opened').runtime.results.map(result => [result.event.id, result.status]), [
    [1, 'expired'], [2, 'satisfied'],
  ]);
  assert.deepEqual(boundary.vm.safe, { all_opened: false, any_opened: true, quotient: 1 });
});

test('missing observations remain NotReady and generated Result inputs cannot be spoofed', async t => {
  const artifact = await compileSource(source, { filename: 'after-event-control.ghost.md' });
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { afterEvent: { timeEpoch: 7 } });
  t.after(() => runtime.dispose());
  const pending = runtime.step({ nowMs: 0, inputs: { divisor: 1 }, events: eventBatch([start(1, 0)]) });
  assert.equal(pending.vm.safe.any_opened, false);
  assert.equal(pending.vm.resultTrace.at(-2).choice, 4);
  assert.throws(() => runtime.step({
    nowMs: 1,
    inputs: { divisor: 1, __gf_after_event_any_value_opened: true },
  }), /unknown input __gf_after_event_any_value_opened/);
});

test('an older delivered sample is not interpolated to the current scan', async t => {
  const artifact = await compileSource(source, { filename: 'after-event-control.ghost.md' });
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { afterEvent: { timeEpoch: 7 } });
  t.after(() => runtime.dispose());
  runtime.step({ nowMs: 0, inputs: { divisor: 1 }, events: eventBatch([start(1, 0)]) });
  const stale = runtime.step({
    nowMs: 1,
    inputs: { divisor: 1 },
    samples: { valve_open: sample(1, 0, true) },
  });
  assert.equal(stale.vm.safe.any_opened, false);
  assert.equal(stale.vm.resultTrace.at(-2).choice, 4);
  assert.equal(runtime.afterEvents.get('opened').runtime.results[0].status, 'pending');
  const fresh = runtime.step({
    nowMs: 2,
    inputs: { divisor: 1 },
    samples: { valve_open: sample(2, 2, true) },
  });
  assert.equal(fresh.vm.safe.any_opened, true);
  assert.equal(runtime.afterEvents.get('opened').runtime.results[0].status, 'satisfied');
});

test('a duplicate sample identity cannot satisfy a newly delivered start', async t => {
  const artifact = await compileSource(source, { filename: 'after-event-control.ghost.md' });
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { afterEvent: { timeEpoch: 7 } });
  t.after(() => runtime.dispose());
  runtime.step({
    nowMs: 0,
    inputs: { divisor: 1 },
    samples: { valve_open: sample(1, 0, true) },
    events: eventBatch([start(1, 0)]),
  });
  const duplicate = runtime.step({
    nowMs: 0,
    inputs: { divisor: 1 },
    samples: { valve_open: sample(1, 0, true) },
    events: eventBatch([start(2, 0)], [{ sourceEpoch: 2, id: 1 }]),
  });
  assert.equal(duplicate.vm.safe.any_opened, false);
  assert.equal(runtime.afterEvents.get('opened').runtime.results[0].status, 'pending');
});

test('a predicate source fault persists until a fresh accepted observation recovers it', async t => {
  const artifact = await compileSource(source, { filename: 'after-event-control.ghost.md' });
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { afterEvent: { timeEpoch: 7 } });
  t.after(() => runtime.dispose());
  const faulted = runtime.step({
    nowMs: 0,
    inputs: { divisor: 1 },
    samples: { valve_open: sample(1, 0, false, 'Disconnected') },
    events: eventBatch([start(1, 0)]),
  });
  assert.equal(faulted.vm.resultTrace.at(-2).choice, 1);
  const missing = runtime.step({ nowMs: 1, inputs: { divisor: 1 } });
  assert.equal(missing.vm.resultTrace.at(-2).choice, 1);
  const recovered = runtime.step({
    nowMs: 2,
    inputs: { divisor: 1 },
    samples: { valve_open: sample(2, 2, true) },
  });
  assert.equal(recovered.vm.safe.any_opened, true);
});

test('a rejected VM scan rolls back tracker identity, result, and logical time', async t => {
  const artifact = await compileSource(source, { filename: 'after-event-control.ghost.md' });
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { afterEvent: { timeEpoch: 7 } });
  t.after(() => runtime.dispose());
  const scan = divisor => runtime.step({
    nowMs: 0,
    inputs: { divisor },
    samples: { valve_open: sample(1, 0, true) },
    events: eventBatch([start(1, 0)]),
  });
  assert.throws(() => scan(0), /division by zero/);
  assert.deepEqual(runtime.afterEvents.get('opened').runtime.results, []);
  assert.equal(runtime.lastNowMs, null);
  assert.equal(scan(1).vm.safe.any_opened, true);
});

test('invalid event delivery cannot consume an identity before a valid scan', async t => {
  const artifact = await compileSource(source, { filename: 'after-event-control.ghost.md' });
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { afterEvent: { timeEpoch: 7 } });
  t.after(() => runtime.dispose());
  assert.throws(() => runtime.step({
    nowMs: 1, inputs: { divisor: 1 }, events: eventBatch([start(1, 2)]),
  }), /atMs cannot be in the future/);
  assert.deepEqual(runtime.afterEvents.get('opened').runtime.results, []);
  assert.equal(runtime.lastNowMs, null);
  const committed = runtime.step({
    nowMs: 1, inputs: { divisor: 1 }, samples: { valve_open: sample(1, 1, true) },
    events: eventBatch([start(1, 1)]),
  });
  assert.equal(committed.vm.safe.any_opened, true);
  assert.equal(runtime.lastNowMs, 1);
});
