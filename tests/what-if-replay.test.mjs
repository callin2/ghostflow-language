import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { prepareWhatIfReplay } from '../runtimes/wasm/what-if-replay.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasmBytes = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const native = path.join(root, `target/release/examples/scan_tape${process.platform === 'win32' ? '.exe' : ''}`);
const source = [
  '# Source-bound missing-input replay', '',
  '<!-- ghostflow:anchor id=GF-INT-REF-06-019 kind=intent status=confirmed origin=user -->',
  'Issue [#304](https://github.com/callin2/ghostflow-language/issues/304) checks that missing sensor records are reported and supplied what-if inputs retain synthetic provenance.', '',
  '```ghost', 'control MissingInputReplay {',
  '  input start: Bool;', '  input moisture: Percent;',
  '  state running: Bool = false;',
  '  // ghostflow:link id=GF-INT-REF-06-019 relation=implements',
  "  running' = case start { ok(requested) => requested && (case moisture { ok(value) => value < 35%; fault(_) => false; }); fault(_) => false; };",
  '  output pump: Bool;',
  '  // ghostflow:link id=GF-INT-REF-06-019 relation=implements',
  "  pump <- running';", '}', '```', '',
].join('\n');
const identity = { timelineId: 'timeline.recorded', instanceId: 'instance.reference', runId: 'run.original',
  sourceRevision: 'source.ref-06-019.input-v2', bindingRevision: 'binding.virtual' };
const sample = (id, value, quality = 'Good') => ({ epoch: 1, id, timestampMs: id * 1000, value, quality });
const first = () => ({ nowMs: 1000, samples: { start: sample(1, true), moisture: sample(1, 40) } });
const next = () => ({ nowMs: 2000, samples: { start: sample(2, true), moisture: sample(2, 40) } });
const request = () => ({ branchId: 'branch.what-if', runId: 'run.ghost' });
const synthetic = (value, quality = 'Good') => ({ offset: 0, kind: 'samples', name: 'moisture',
  value: sample(2, value, quality), provenance: 'synthetic' });

async function compiled() { return compileSource(source, { filename: 'missing-input-replay.ghost.md' }); }
async function prepare(compilation, prefix, future) {
  return prepareWhatIfReplay({ wasmBytes, compilation, identity, prefix, future });
}
function assertNative(compilation, results) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-what-if-'));
  try {
    const module = path.join(directory, 'program.gfb'), tape = path.join(directory, 'tape.tsv');
    fs.writeFileSync(module, compilation.bytes);
    fs.writeFileSync(tape, results.map(result => {
      const fields = Object.entries(result.vm.inputs).filter(([name]) => name !== '__gf_now_ms')
        .flatMap(([name, value]) => [name, typeof value === 'boolean' ? 'b' : 'n', String(value)]);
      return [result.frame.scanId, result.frame.logicalTimeMs, ...fields].join('\t') + '\n';
    }).join(''));
    const execution = spawnSync(native, [module, tape], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    assert.equal(execution.status, 0, execution.stderr || execution.stdout);
    const outcomes = execution.stdout.trim().split('\n').map(line => JSON.parse(line).outcome);
    assert.deepEqual(outcomes.map(outcome => outcome.trace), results.map(result => result.vm),
      'canonical bytecode and reference-conditioned sensor inputs produce identical full native/WASM traces');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('REF-06-019 what-if reports missing recorded sensors instead of inventing or holding an old value', async () => {
  const compilation = await compiled(), prefix = [first()];
  const future = [{ nowMs: 2000, samples: { start: sample(2, true) } }];
  const retained = structuredClone({ compilation, prefix, future, identity });
  const replay = await prepare(compilation, prefix, future);
  const live = await ControlRuntime.instantiateFramed(wasmBytes, compilation);
  try {
    const baseline = live.step(prefix[0]);
    const before = structuredClone(live.lastFrameOutcome);
    const missing = await replay.branch(request());
    assert.equal(missing.status, 'missing-input');
    assert.deepEqual(missing.missing, [{ offset: 0, logicalTimeMs: 2000, kind: 'samples', name: 'moisture' }]);
    assert.deepEqual(missing.frames, []);
    assert.equal(missing.physicalEffects, false);
    assert.deepEqual(live.lastFrameOutcome, before);
    const supplied = [synthetic(20)];
    const receipt = await replay.branch({ ...request(), synthetic: supplied });
    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.frames[0].original, null, 'absent original inputs cannot produce a fabricated original outcome');
    assert.equal(receipt.frames[0].candidate.vm.safe.pump, true);
    assert.deepEqual(receipt.provenance, [
      { offset: 0, logicalTimeMs: 2000, kind: 'samples', name: 'start', provenance: 'recorded' },
      { offset: 0, logicalTimeMs: 2000, kind: 'samples', name: 'moisture', provenance: 'synthetic' },
    ]);
    assertNative(compilation, [baseline, receipt.frames[0].candidate]);
    assert.deepEqual(await replay.branch(request()), missing, 'a completed branch does not fill missing original records');
    receipt.checkpoint.identity.runId = 'tampered';
    receipt.frames[0].candidate.vm.safe.pump = false;
    replay.checkpoint.frameCount = 99;
    const repeated = await replay.branch({ ...request(), synthetic: supplied });
    assert.equal(repeated.checkpoint.frameCount, 1);
    assert.equal(repeated.checkpoint.identity.runId, identity.runId);
    assert.equal(repeated.frames[0].candidate.vm.safe.pump, true);
    assert.deepEqual(live.lastFrameOutcome, before);
    const continuation = live.step(next());
    assert.equal(continuation.vm.safe.pump, false);
    assertNative(compilation, [baseline, continuation]);
    assert.deepEqual(structuredClone({ compilation, prefix, future, identity }), retained);
  } finally { live.dispose(); }
});

test('REF-06-019 recorded and synthetic ghost branches compare actual state, faults and safe outputs at logical ticks', async () => {
  const compilation = await compiled(), prefix = [first()], future = [next()];
  const replay = await prepare(compilation, prefix, future);
  const baselineRuntime = await ControlRuntime.instantiateFramed(wasmBytes, compilation);
  try {
    const baseline = baselineRuntime.step(prefix[0]);
    const unchanged = await replay.branch(request());
    assert.deepEqual(unchanged.frames[0].candidate, unchanged.frames[0].original);
    assert.ok(unchanged.provenance.every(entry => entry.provenance === 'recorded'));
    const altered = await replay.branch({ ...request(), synthetic: [synthetic(20)] });
    assert.equal(altered.frames[0].logicalTimeMs, altered.frames[0].candidate.frame.logicalTimeMs);
    assert.equal(altered.frames[0].original.vm.stateAfter.running, false);
    assert.equal(altered.frames[0].candidate.vm.stateAfter.running, true);
    assert.equal(altered.frames[0].candidate.vm.requested.pump, true);
    assertNative(compilation, [baseline, altered.frames[0].candidate]);
    const faulted = await replay.branch({ ...request(), synthetic: [synthetic(20, 'Disconnected')] });
    assert.equal(faulted.frames[0].candidate.sensors.moisture.ok, false);
    assert.equal(faulted.frames[0].candidate.vm.safe.pump, false);
    assertNative(compilation, [baseline, faulted.frames[0].candidate]);
    assert.deepEqual(await replay.branch(request()), unchanged);
  } finally { baselineRuntime.dispose(); }
});

test('REF-06-019 source tampering, malformed virtual inputs and incomplete checkpoints fail without changing replay history', async () => {
  const compilation = await compiled(), prefix = [first()], future = [next()];
  const replay = await prepare(compilation, prefix, future);
  const original = await replay.branch(request());
  await assert.rejects(replay.branch({ ...request(), synthetic: [{ ...synthetic(20), provenance: 'recorded' }] }), /synthetic provenance/);
  await assert.rejects(replay.branch({ ...request(), synthetic: [synthetic(20), synthetic(25)] }), /duplicate/);
  await assert.rejects(replay.branch({ ...request(), synthetic: [{ ...synthetic(20), name: 'unknown' }] }), /required branch input/);
  await assert.rejects(replay.branch({ ...request(), runId: identity.runId }), /separate identities/);
  await assert.rejects(replay.branch({ ...request(), synthetic: [synthetic('not a Percent')] }));
  const tampered = structuredClone(compilation); tampered.bytes[0] ^= 1;
  await assert.rejects(prepare(tampered, prefix, future), /bytecode|artifact|GFB|magic/i);
  const wrongManifest = structuredClone(compilation); wrongManifest.manifest.sensors = [];
  await assert.rejects(prepare(wrongManifest, prefix, future), /manifest|source|compiled/i);
  await assert.rejects(prepare(compilation, [{ ...first(), samples: {} }], future), /checkpoint prefix/);
  await assert.rejects(prepare(compilation, prefix, [{ ...next(), nowMs: 1000 }]), /times must increase/);
  await assert.rejects(prepare(compilation, [], Array(257).fill(next())), /at most 256/);
  const missingBoth = await prepare(compilation, prefix, [{ nowMs: 2000 }]);
  assert.deepEqual((await missingBoth.branch(request())).missing.map(gap => `${gap.kind}.${gap.name}`), ['samples.start', 'samples.moisture']);
  assert.deepEqual(await replay.branch(request()), original);
});

test('REF-06-019 preparation captures recordings before async compilation and never promotes later caller samples to recorded evidence', async () => {
  const compilation = await compiled(), prefix = [first()];
  const future = [{ nowMs: 2000, samples: { start: sample(2, true) } }];
  const origin = structuredClone(identity);
  const pending = prepareWhatIfReplay({ wasmBytes, compilation, identity: origin, prefix, future });
  future[0].samples.moisture = sample(2, 20);
  prefix[0].samples.moisture.value = 20;
  origin.runId = 'run.mutated-after-call';
  const replay = await pending;
  const missing = await replay.branch(request());
  assert.equal(missing.status, 'missing-input');
  assert.equal(missing.origin.runId, identity.runId);
  assert.deepEqual(missing.missing, [{ offset: 0, logicalTimeMs: 2000, kind: 'samples', name: 'moisture' }]);
  const supplied = await replay.branch({ ...request(), synthetic: [synthetic(20)] });
  assert.equal(supplied.frames[0].candidate.vm.stateBefore.running, false, 'baseline retains the captured wet sample');
  assert.equal(supplied.frames[0].candidate.vm.safe.pump, true);
  assert.equal(supplied.provenance.find(entry => entry.kind === 'samples' && entry.name === 'moisture').provenance, 'synthetic');
  assert.equal((await replay.branch(request())).status, 'missing-input');
});
