import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { StageAccountingControl } from '../runtimes/wasm/stage-accounting-control.mjs';
import { compileSource } from '../tools/compile-source.mjs';
import { compileStageAccountingBinding } from '../tools/stage-accounting-binding.mjs';
import { verifyArtifactSourceMap } from '../tools/toolchain.mjs';
import { softwareQualityObservations, softwareQualityRails } from './helpers/software-quality-observations.mjs';

const root = new URL('../', import.meta.url).pathname;
const wasm = readFileSync(join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const source = '# Stage accounting\n\n```ghost\ncontrol Blocked {\n'
  + 'resource irrigation: BoolActuator;\n'
  + ['requested', 'safe', 'applied', 'confirmed'].map(stage => `account ${stage}_usage = on_time(irrigation, stage: ${stage}, persistence: durable);`).join('\n')
  + '\ninput manual, low_water: Bool; output pump, ready: Bool; pump <- manual |> recover(false);\n'
  + 'ready <- case low_water { ok(value) => !value; fault(_) => false; }; require pump => ready;\n}\n```\n';
const bindings = [{ resource: 'irrigation', output: 'pump' }];
const options = { filename: 'stage-accounting.ghost.md', runId: 'run-a', bindings };
const known = usedMs => ({ kind: 'Known', usedMs: BigInt(usedMs) });
const unknown = reason => ({ kind: 'Unknown', reason });
const query = (account, start = 0, end = 20_000, run = 'run-a') => ({ query: { account: `${account}_usage`, start: String(start), end: String(end), run } });
const normalized = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));
async function create(t, overrides = {}, text = source) {
  const owner = await StageAccountingControl.instantiateSource(wasm, text, { ...options, ...overrides });
  t.after(() => owner.dispose()); return owner;
}
function frame(artifact, scanId, logicalTimeMs, manual = true, low_water = true) {
  return { frame: { scanId, logicalTimeMs, inputs: Object.entries(softwareQualityRails(artifact, { manual, low_water }, scanId + 1, logicalTimeMs)).map(([name, value]) => ({ name, value })) } };
}
function execute(owner, actions) {
  const runtime = owner.control.runtime;
  return actions.map(action => {
    if (action.frame) {
      try { const outcome = runtime.scan(action.frame); return { accepted: true, ...outcome }; }
      catch (error) { return { accepted: false, error: error.message }; }
    }
    if (action.persist) { const snapshot = runtime.stageAccountingSnapshot(); runtime.acknowledgeStageAccounting(snapshot.revision);
      return { snapshot: Buffer.from(snapshot.bytes).toString('hex'), revision: snapshot.revision.toString() }; }
    if (action.gap) { runtime.stageAccountingGap(); return { gap: true }; }
    const { account, run, start, end } = action.query;
    try { return normalized(runtime.stageAccountingQuery(account, run, BigInt(start), BigInt(end))); }
    catch (error) { return { error: error.message }; }
  });
}
function native(t, artifact, activation, actions, restore) {
  const dir = mkdtempSync(join(tmpdir(), 'stage-accounting-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'module.gfb'), artifact.bytes); writeFileSync(join(dir, 'activation.bin'), activation);
  writeFileSync(join(dir, 'tape.json'), JSON.stringify({ actions, restore }));
  return execFileSync(join(root, 'target/release/examples/stage_accounting_tape'), [join(dir, 'module.gfb'), join(dir, 'activation.bin'), join(dir, 'tape.json')], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
}

test('REF-03-021: canonical source drives requested 20s, observed safe zero, and unknown physical evidence', async t => {
  const owner = await create(t); softwareQualityObservations(owner.control);
  owner.step({ nowMs: 0, inputs: { manual: true, low_water: true } });
  owner.step({ nowMs: 20_000, inputs: { manual: true, low_water: true } });
  assert.deepEqual(owner.query('requested_usage', 0n, 20_000n), unknown('PersistencePending'));
  await owner.persist(async () => true);
  assert.deepEqual(owner.query('requested_usage', 0n, 20_000n), known(20_000));
  assert.deepEqual(owner.query('safe_usage', 0n, 20_000n), known(0));
  assert.deepEqual(owner.query('applied_usage', 0n, 20_000n), unknown('NoReceipt'));
  assert.deepEqual(owner.query('confirmed_usage', 0n, 20_000n), unknown('NoFeedback'));
  assert.deepEqual(owner.query('safe_usage', 0n, 20_001n), unknown('CoverageMissing'));
  assert.deepEqual(owner.query('safe_usage', 20_000n, 20_000n), known(0));
  assert.equal(owner.control.lastFrameOutcome.trace.requested.pump, true);
  assert.equal(owner.control.lastFrameOutcome.trace.safe.pump, false);
  const a = owner.artifact;
  verifyArtifactSourceMap({ format: 'GhostFlow/source-map-v1', bytecodeSha256: a.manifest.bytecodeSha256,
    sourceDocument: a.sourceDocument, nodes: a.sourceMap, lines: a.extractionMap, traceMetadata: a.traceMetadata,
    interactionSchema: null, interactionSourceIdentity: null }, a.bytes, { manifest: a.manifest });
});

test('single-stage observation accounts select the actual scalar execution profile', async t => {
  for (const [stage, expected] of [['requested', known(20_000)], ['safe', known(0)],
    ['applied', unknown('NoReceipt')], ['confirmed', unknown('NoFeedback')]]) {
    await t.test(stage, async t => {
      const document = source.split('\n').filter(line => !line.startsWith('account ')
        || line.startsWith(`account ${stage}_usage `)).join('\n');
      const owner = await create(t, {}, document);
      assert.equal(owner.artifact.manifest.format, 'GhostFlow/control-v1');
      softwareQualityObservations(owner.control);
      owner.step({ nowMs: 0, inputs: { manual: true, low_water: true } });
      owner.step({ nowMs: 20_000, inputs: { manual: true, low_water: true } });
      await owner.persist(async () => true);
      assert.deepEqual(owner.query(`${stage}_usage`, 0n, 20_000n), expected);
    });
  }
});

test('native/WASM exact parity includes rejection atomicity, repeated timestamps, clipping, gaps and snapshots', async t => {
  const owner = await create(t), a = owner.artifact;
  const actions = [frame(a, 0, 0), { persist: true }, query('requested', 0, 0), frame(a, 1, 20_000), { persist: true },
    query('requested'), query('safe'), query('confirmed'), frame(a, 1, 20_000), { persist: true },
    frame(a, 2, 19_000), { persist: true }, frame(a, 2, 20_000, false), { persist: true },
    frame(a, 3, 30_000, false), { persist: true }, query('requested', 10_000, 30_000), query('requested', 30_000, 30_001),
    { gap: true }, frame(a, 4, 40_000), frame(a, 5, 45_000), { persist: true }, query('safe', 0, 45_000), query('requested', 40_000, 45_000),
    query('safe', 0, 10, 'wrong-run'), query('safe', 1, 0)];
  const actual = execute(owner, actions);
  const expected = native(t, a, compileStageAccountingBinding(a, options), actions);
  assert.deepEqual(actual, expected);
  assert.equal(actual[4].snapshot, actual[9].snapshot, 'duplicate scan does not mutate ledger');
  assert.equal(actual[9].snapshot, actual[11].snapshot, 'reverse clock does not mutate ledger');
  assert.deepEqual(actual[16], normalized(known(10_000)));
  assert.deepEqual(actual[22], unknown('CoverageMissing'));
});

test('restore binds source, output and stage; fresh run retains historical coverage without reboot bridging', async t => {
  const owner = await create(t), a = owner.artifact;
  execute(owner, [frame(a, 0, 0), frame(a, 1, 20_000)]);
  const { bytes } = await owner.persist(async () => true);
  const restored = await create(t, { runId: 'run-b', snapshot: bytes });
  assert.deepEqual(restored.query('requested_usage', 0n, 20_000n, 'run-a'), known(20_000));
  assert.deepEqual(restored.query('safe_usage', 0n, 20_000n), unknown('CoverageMissing'));
  const actions = [frame(a, 0, 30_000), frame(a, 1, 40_000), { persist: true }, query('requested', 20_000, 40_000, 'run-b'),
    query('requested', 30_000, 40_000, 'run-b'), query('requested', 0, 20_000)];
  const actual = execute(restored, actions);
  assert.deepEqual(actual, native(t, a, compileStageAccountingBinding(a, { ...options, runId: 'run-b' }), actions, Buffer.from(bytes).toString('hex')));
  assert.deepEqual(actual[3], unknown('CoverageMissing'));
  assert.deepEqual(actual[4], normalized(known(10_000)));
  await assert.rejects(create(t, { snapshot: bytes }), /fresh run identity/);
  await assert.rejects(create(t, { runId: 'run-b', snapshot: bytes }, source.replace('# Stage accounting', '# Changed source identity')), /snapshot binding mismatch/);
  await assert.rejects(create(t, { runId: 'run-b', snapshot: bytes, bindings: [{ resource: 'irrigation', output: 'ready' }] }), /snapshot binding mismatch/);
  await assert.rejects(create(t, { runId: 'run-b', snapshot: bytes }, source.replace('stage: requested', 'stage: safe')), /snapshot binding mismatch/);
  const corrupt = bytes.slice(); corrupt[corrupt.length - 1] ^= 1;
  await assert.rejects(create(t, { runId: 'run-b', snapshot: corrupt }), /checksum mismatch/);
});

test('bounded publication failures do not turn committed scans into retryable errors', async t => {
  const owner = await create(t, { maxSegments: 1 }), a = owner.artifact;
  const actions = [frame(a, 0, 0, true), frame(a, 1, 10, false), frame(a, 2, 20, false), { persist: true }, query('requested', 0, 20)];
  const actual = execute(owner, actions);
  assert.deepEqual(actual, native(t, a, compileStageAccountingBinding(a, { ...options, maxSegments: 1 }), actions));
  assert.ok(actual.slice(0, 3).every(row => row.accepted));
  assert.deepEqual(actual.at(-1), unknown('Capacity'));
  const failed = await create(t); execute(failed, [frame(a, 0, 0), frame(a, 1, 20_000)]);
  await assert.rejects(failed.persist(async () => false), /not durably acknowledged/);
  assert.deepEqual(failed.query('safe_usage', 0n, 20_000n), unknown('PersistencePending'));
  await assert.rejects(failed.persist(async () => { execute(failed, [frame(a, 2, 30_000)]); return true; }), /stale.*revision/);
  await failed.persist(async () => true);
  assert.deepEqual(failed.query('requested_usage', 0n, 30_000n), known(30_000));
});

test('binding and exact integer boundaries reject guessed identities and unsafe numbers', async t => {
  const a = await compileSource(source, { filename: options.filename });
  for (const invalid of [undefined, [], [{ resource: 'irrigation', output: 'irrigation' }], [{ resource: 'missing', output: 'pump' }], [...bindings, ...bindings]]) {
    assert.throws(() => compileStageAccountingBinding(a, { ...options, bindings: invalid }), /binding/);
  }
  assert.throws(() => compileStageAccountingBinding(a, { ...options, maxSegments: 4097 }), /maxSegments/);
  const owner = await create(t);
  assert.throws(() => owner.query('safe_usage', 0, 1), /u64 BigInt/);
  assert.throws(() => owner.query('safe_usage', 0n, 1n << 64n), /u64 BigInt/);
  const activation = compileStageAccountingBinding(a, options); activation[4] ^= 1;
  const plain = await import('../runtimes/wasm/control-runtime.mjs');
  const runtime = await plain.ControlRuntime.instantiateFramed(wasm, a); t.after(() => runtime.dispose());
  assert.throws(() => runtime.runtime.activateStageAccounting(activation), /module mismatch/);
  const forged = structuredClone(a); forged.manifest.accounting.bindings[0].evidenceBinding.stage = 'safe';
  assert.throws(() => compileStageAccountingBinding(forged, options), /does not match canonical source/);
  const wrongBytes = structuredClone(a); wrongBytes.bytes[wrongBytes.bytes.length - 1] ^= 1;
  assert.throws(() => compileStageAccountingBinding(wrongBytes, options), /does not match canonical source/);
  const high = Number.MAX_SAFE_INTEGER;
  const actions = [frame(a, 0, 0), frame(a, 1, high), { persist: true }, query('requested', 0, high),
    query('safe', 0, '18446744073709551615')];
  const actual = execute(owner, actions);
  assert.deepEqual(actual, native(t, a, compileStageAccountingBinding(a, options), actions));
  assert.deepEqual(actual[3], normalized(known(BigInt(high))));
  assert.deepEqual(actual[4], unknown('CoverageMissing'));
});

test('stage observation profile rejects control admission and unsupported mixed accounts', async () => {
  for (const addition of [
    'constraints Duty { limit used(requested_usage, rolling(60s)) <= 45s { reserve = 5s; on_unknown = block; } }',
    'event started: Event; account starts = count_events(started, over: local_day("UTC"), persistence: durable);',
  ]) await assert.rejects(compileSource(source.replace('input manual', `${addition}\ninput manual`), { filename: options.filename }), /scan stage accounting requires/);
  await assert.rejects(compileSource(source.replace('BoolActuator', 'Station'), { filename: options.filename }), /scan stage accounting requires/);
  await assert.rejects(compileSource(source.replace('output pump, ready: Bool;', 'output used: Duration; used <- requested_usage; output pump, ready: Bool;'), { filename: options.filename }), /account|reference|identifier/);
});

test('context scans publish the same stage evidence after context and control commit', async t => {
  const contextSource = source.replace('resource irrigation', 'config marker: Bool = true; resource irrigation');
  const owner = await create(t, { runtimeOptions: { context: { bootEpoch: 1, terminalCapacity: 16, bindings: [] } } }, contextSource);
  softwareQualityObservations(owner.control);
  for (const nowMs of [0, 20_000]) owner.step({ nowMs, inputs: { manual: true, low_water: true }, contextFacts: {
    clock: { monotonicMs: nowMs, wallMs: nowMs, bootEpoch: 1, uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: 'clock-v1' },
    natural: [], schedules: [], settings: null,
  } });
  await owner.persist(async () => true);
  assert.deepEqual(owner.query('requested_usage', 0n, 20_000n), known(20_000));
  assert.deepEqual(owner.query('safe_usage', 0n, 20_000n), known(0));
});
