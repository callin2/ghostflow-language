import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { compileSource } from '../tools/compile-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
execFileSync('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-wasm',
  '--target', 'wasm32-unknown-unknown', '--release'], { cwd: root, stdio: 'inherit' });
const wasmBytes = readFileSync(wasmPath);
const cases = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8')).cases;

async function artifact(id) {
  const fixture = cases.find(entry => entry.id === id);
  return compileSource(fixture.source, { filename: fixture.filename });
}

async function runtimeFor(compiled) {
  const runtime = await GhostFlowRuntime.instantiate(wasmBytes);
  runtime.load(compiled.bytes);
  for (const output of compiled.manifest.outputs) {
    runtime.addCapability('actuator', output.name,
      output.type === 'Bool' ? 'bool' : output.type === 'Int' ? 'int' : 'number');
  }
  return runtime;
}

const binding = (kind, provider, timezone, criteria) => ({
  kind, provider, namespace: `${provider}-namespace`, station: `${provider}-station`,
  bindingRevision: `${provider}-binding-v1`, location: `${provider}-location`,
  timezone, criteria, maxUncertaintyMs: 0,
});
const clock = (monotonicMs, wallMs) => ({
  monotonicMs, bootEpoch: 7, wallMs, uncertaintyMs: 0, trusted: true,
  unknownReason: null, sourceRevision: 'clock-boundary-v1',
});
const facts = (monotonicMs, wallMs, schedules = [], natural = []) => ({
  clock: clock(monotonicMs, wallMs), natural, schedules, settings: null,
});
function tickContext(runtime, packet) {
  runtime.setNumber('__gf_now_ms', packet.clock.monotonicMs);
  runtime.setNumber('__gf_time_epoch', packet.clock.bootEpoch);
  runtime.tickContext(packet);
}
const observation = (providerBinding, classifications) => ({
  binding: providerBinding, providerRevision: `${providerBinding.provider}-provider-v1`,
  coverageStartMs: 0, coverageEndMs: 2_000, expiresAtMs: 2_001,
  uncertaintyMs: 0, fault: null, classifications,
});

function rawContextTick(runtime, bytes) {
  const { wasm, handle } = runtime;
  const ptr = wasm.gf_alloc(bytes.length);
  try {
    new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
    return wasm.gf_tick_context(handle, ptr, bytes.length);
  } finally {
    wasm.gf_dealloc(ptr, bytes.length);
  }
}

function checkpoint(runtime) {
  assert.equal(runtime.wasm.gf_context_checkpoint(runtime.handle), 1);
  const ptr = runtime.wasm.gf_context_checkpoint_ptr(runtime.handle);
  const len = Number(runtime.wasm.gf_context_checkpoint_len(runtime.handle));
  assert.ok(len > 0);
  return new Uint8Array(runtime.wasm.memory.buffer, ptr, len).slice();
}

function restore(runtime, bytes) {
  const ptr = runtime.wasm.gf_alloc(bytes.length);
  try {
    new Uint8Array(runtime.wasm.memory.buffer, ptr, bytes.length).set(bytes);
    assert.equal(runtime.wasm.gf_restore_context_checkpoint(runtime.handle, ptr, bytes.length), 1);
  } finally {
    runtime.wasm.gf_dealloc(ptr, bytes.length);
  }
}

test('GFB10 natural Result inputs reject caller spoofing', async () => {
  const compiled = await artifact('REF-03-062');
  const runtime = await runtimeFor(compiled);
  const protectedInput = compiled.manifest.naturalConditions[0].projectionInputs.ok;
  assert.throws(() => runtime.setBool(protectedInput, true), /Rust provider projections are not caller inputs/);
  runtime.dispose();
});

test('wrong GFCA binding and malformed GFSF4 are atomic', async () => {
  const compiled = await artifact('REF-03-062');
  const runtime = await runtimeFor(compiled);
  const tide = binding('tide', 'harbor_tides', 'Asia/Seoul', 'neap');
  const moon = binding('moon', 'moon', 'UTC', 'full');
  assert.throws(() => runtime.activateContext({
    bootEpoch: 7, terminalCapacity: 8,
    bindings: [{ ...tide, kind: 'moon' }, moon],
  }), /provider kind or timezone binding mismatch/);

  runtime.activateContext({ bootEpoch: 7, terminalCapacity: 8, bindings: [tide, moon] });
  assert.equal(runtime.journalLength, 0);
  assert.equal(rawContextTick(runtime, Uint8Array.of(0x47, 0x46, 0x53)), 0);
  assert.equal(runtime.journalLength, 0);

  tickContext(runtime, facts(1_000, 1_000, [], [
    observation(tide, ['neap']), observation(moon, ['full']),
  ]));
  assert.equal(runtime.trace.tick, 1);
  assert.equal(runtime.trace.requested.allowed, true);
  runtime.dispose();
});

test('Periodic and TimeSlots checkpoints preserve terminal occurrence dedupe', async () => {
  const fixtures = [
    {
      id: 'REF-03-036', site: 14, output: 'due', planned: 1_790_812_800_000,
      rows: [],
    },
    {
      id: 'REF-03-057', site: 16, output: 'due', planned: Date.UTC(2026, 8, 24, 21),
      rows: [{
        sourceDay: Date.UTC(2026, 8, 25) / 86_400_000, slotKey: 1, minuteOfDay: 360,
        fold: 0, eventId: '', eventKind: 'civil', instantMs: Date.UTC(2026, 8, 24, 21),
        withdrawn: false, providerRevision: 'civil-provider-v1', contextRevision: 'civil-context-v1',
      }],
    },
  ];
  for (const fixture of fixtures) {
    const compiled = await artifact(fixture.id);
    const evidence = [{
      site: fixture.site, coverageStartMs: fixture.planned - 2,
      coverageEndMs: fixture.planned + 1, provider: null, calendar: null, rows: fixture.rows,
    }];
    const original = await runtimeFor(compiled);
    original.activateContext({ bootEpoch: 7, terminalCapacity: 8, bindings: [] });
    tickContext(original, facts(0, fixture.planned - 1, evidence));
    tickContext(original, facts(1, fixture.planned, evidence));
    assert.equal(original.trace.requested[fixture.output], true, `${fixture.id} initial crossing`);
    const saved = checkpoint(original);

    const restored = await runtimeFor(compiled);
    restored.activateContext({ bootEpoch: 7, terminalCapacity: 8, bindings: [] });
    restore(restored, saved);
    tickContext(restored, facts(0, fixture.planned - 1, evidence));
    tickContext(restored, facts(1, fixture.planned, evidence));
    assert.equal(restored.trace.requested[fixture.output], false, `${fixture.id} restored dedupe`);
    original.dispose();
    restored.dispose();
  }
});
