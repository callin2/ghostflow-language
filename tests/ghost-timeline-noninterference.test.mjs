import { softwareQualityRails } from './helpers/software-quality-observations.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createGhostTimeline } from '../runtimes/node/ghost-timeline.mjs';
import { FileLedger } from '../runtimes/node/ledger.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const source = fs.readFileSync(path.join(root, 'tests/fixtures/issue-90-settings-periodic.ghost.md'), 'utf8')
  .replace('control LiveSettingsPeriodic {', 'control LiveSettingsPeriodic {\n  input manual: Bool;\n  resource pump: BoolActuator;\n  account applied = on_time(pump, stage: applied, persistence: durable);')
  .replace("active <- running';", "active <- running' || (manual |> recover(false));");
const origin = { timelineId: 'live.timeline', instanceId: 'live.instance', runId: 'live.run', sourceRevision: 'source.303.1', bindingRevision: 'binding.303.1' };
const activation = { bootEpoch: 1, terminalCapacity: 16, bindings: [] };
const periodicSite = (await compileSource(source, { filename: 'live-timeline.ghost.md' })).manifest.schedules[0].site;
const anchor = Date.parse('2026-10-01T00:00:00Z'), hour = 3_600_000;
const frame = (ms, manual = false) => ({ nowMs: ms, samples: { manual: { epoch: 1, id: ms + 1, timestampMs: ms, quality: 'Good', value: manual } }, contextFacts: {
  clock: { monotonicMs: ms, wallMs: anchor + ms, bootEpoch: 1, uncertaintyMs: 0,
    trusted: true, unknownReason: null, sourceRevision: 'clock.303.1' }, natural: [], schedules: [{ site: periodicSite,
      coverageStartMs: anchor + ms - 1, coverageEndMs: anchor + ms + 1, provider: null, calendar: null, rows: [] }], settings: null,
} });
const config = { maxIntervals: 16, maxEvents: 8, maxReservations: 8, maxRollingWindowMs: 7_200_000n };
async function fixture(t, extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-live-timeline-'));
  const storage = new FileLedger(path.join(directory, 'ledger.json')), sink = [];
  const options = { wasmBytes: wasm, document: source, filename: 'live-timeline.ghost.md', identity: origin,
    context: activation, accounting: { account: 'applied', resourceId: 7, config, storage }, output: 'active',
    effectSink: receipt => { sink.push(structuredClone(receipt)); }, initializeEmpty: true, ...extra };
  const timeline = await createGhostTimeline(options);
  t.after(() => { timeline.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { timeline, storage, directory, sink, options };
}
function native(artifact, frames, directory, profile = 'context-settings-periodic-v1') {
  const module = path.join(directory, 'module.gfb'), tape = path.join(directory, 'tape.json');
  fs.writeFileSync(module, artifact.bytes);
  fs.writeFileSync(tape, JSON.stringify({ profile, activation, steps: frames.map(f => ({
    scanId: frames.indexOf(f), logicalTimeMs: f.nowMs,
    inputs: Object.entries(softwareQualityRails(artifact, {manual: f.samples.manual.value})).map(([name, value]) => ({ name, type: typeof value === 'boolean' ? 'Bool' : 'Number', value })), ...f.contextFacts,
  })) }));
  const execution = spawnSync(path.join(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`),
    [module, tape], { encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  const rows = execution.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.length, frames.length);
  return rows.map(row => { assert.equal(row.accepted, true); return { outcome: row.outcome, context: row.settings, checkpoint: row.checkpoint }; });
}

test('REF-06-018 actual live occurrence and durable ledger remain unchanged through ghost execution and rewind', async t => {
  const original = JSON.parse(fs.readFileSync(path.join(root, 'tests/reference/cases/03-settings-boundaries.json'), 'utf8')).cases.find(c => c.id === 'REF-06-018');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/303');
  assert.equal(original.scope, 'host'); assert.equal(original.status, 'specified');
  const { timeline, storage, directory, sink } = await fixture(t);
  const prefix = [frame(0), frame(hour)];
  const rows = prefix.map(f => timeline.append(f));
  assert.deepEqual(sink.map(row => row.intent), [false, true], 'the connected live route dispatches actual safe output');
  assert.deepEqual(rows, native(timeline.compilation, prefix, directory));
  assert.throws(() => native(timeline.compilation, prefix, directory, 'context-settings-v1'), /settings tape cannot supply schedules/);
  const live = timeline.observe();
  assert.equal(live.binding.target, 'pump'); assert.equal(live.binding.stage, 'applied');
  assert.equal(live.sourceSha256, live.binding.sha256); assert.equal(live.artifactSha256, live.binding.artifactSha256);
  const admissions = live.live.outcome.trace.contextTrace.filter(row => row.site === periodicSite && row.decision === 'Due');
  assert.equal(admissions.length, 1, 'the actual core admitted one periodic occurrence');
  assert.equal(admissions[0].plannedWallMs, anchor + hour);
  assert.ok(admissions[0].occurrenceId);
  const receiptId = new Uint8Array(16).fill(1);
  await timeline.recordApplied({ receiptId, resourceId: 7, startMs: BigInt(hour + 2000), endMs: BigInt(hour + 5000), localDay: 1 });
  assert.equal(timeline.usedRolling(BigInt(hour + 11 * 60_000), 7_200_000n), 3000n, 'actual applied receipt, not the requested ten-minute timer');
  const before = timeline.observe(), file = fs.readFileSync(storage.filename), persisted = await storage.read(), sinkBefore = structuredClone(sink);
  assert.deepEqual(before.persisted, new Uint8Array(persisted));
  assert.deepEqual(before.ledger.bytes, before.persisted, 'actual in-memory Rust snapshot matches acknowledged storage');
  const branch = await timeline.branch({ branchId: 'ghost.1', runId: 'ghost.run.1' }); t.after(() => branch.dispose());
  const baseline = branch.observe();
  const changed = frame(hour + 11 * 60_000, true);
  const result = await branch.step(changed, { provenance: 'synthetic' });
  assert.equal(result.outcome.trace.safe.active, true);
  assert.deepEqual(result, { ...native(timeline.compilation, [...prefix, changed], directory).at(-1), provenance: 'synthetic', physicalEffects: false });
  assert.notDeepEqual(branch.observe(), baseline, 'the branch actually executed different core state');
  assert.deepEqual(await branch.rewind(), baseline);
  assert.deepEqual(await branch.rewind(), baseline);
  assert.deepEqual(timeline.observe(), before); assert.deepEqual(fs.readFileSync(storage.filename), file);
  assert.deepEqual(await storage.read(), persisted); assert.deepEqual(sink, sinkBefore);
  assert.equal(timeline.usedRolling(BigInt(hour + 11 * 60_000), 7_200_000n), 3000n);
  const ordinary = timeline.append(frame(hour + 11 * 60_000));
  assert.equal(sink.at(-1).intent, false, 'original live timer continues and turns off independently');
  assert.deepEqual(ordinary, native(timeline.compilation, [...prefix, frame(hour + 11 * 60_000)], directory).at(-1));
  assert.ok(!ordinary.outcome.trace.contextTrace.some(row => row.decision === 'Due'), 'ghost rewind cannot readmit the original occurrence');
  assert.deepEqual(fs.readFileSync(storage.filename), file, 'live intent alone still cannot become applied usage');
  const next = timeline.append(frame(2 * hour));
  assert.equal(sink.at(-1).intent, true, 'next real occurrence still admits normally');
  assert.deepEqual(next, native(timeline.compilation, [...prefix, frame(hour + 11 * 60_000), frame(2 * hour)], directory).at(-1));
  const nextAdmission = next.outcome.trace.contextTrace.find(row => row.decision === 'Due');
  assert.ok(nextAdmission); assert.notEqual(nextAdmission.occurrenceId, admissions[0].occurrenceId);
});

test('REF-06-018 rejected ghost requests and immutable caller copies preserve original owners and reusable branch baseline', async t => {
  const { timeline, storage, sink } = await fixture(t);
  const supplied = frame(0); timeline.append(supplied); timeline.append(frame(hour));
  supplied.samples.manual.value = true; supplied.contextFacts.clock.wallMs = 0;
  const before = timeline.observe(), file = fs.readFileSync(storage.filename), calls = structuredClone(sink);
  const badIdentity = { branchId: origin.timelineId, runId: 'other' };
  await assert.rejects(timeline.branch(badIdentity), /separate identities/);
  const branch = await timeline.branch({ branchId: 'ghost.reject', runId: 'ghost.reject.run' }); t.after(() => branch.dispose());
  const baseline = branch.observe();
  await assert.rejects(branch.step({ nowMs: hour + 1, samples: frame(hour + 1, true).samples }, { provenance: 'synthetic' }), /recorded context facts/);
  await assert.rejects(branch.step(frame(hour + 1), {}), /explicit.*provenance/);
  await assert.rejects(branch.step(frame(hour + 1), { provenance: 'recorded' }), /captured actual timeline/);
  const invalid = frame(hour + 1); invalid.samples.manual.value = 'wrong';
  await assert.rejects(branch.step(invalid, { provenance: 'synthetic' }), /Bool|boolean|type/i);
  assert.deepEqual(branch.observe(), baseline);
  const instantiate = WebAssembly.instantiate;
  try {
    WebAssembly.instantiate = async () => { throw new Error('injected branch engine allocation failure'); };
    await assert.rejects(branch.rewind(), /injected branch engine allocation failure/);
  } finally { WebAssembly.instantiate = instantiate; }
  assert.deepEqual(branch.observe(), baseline, 'failed rewind preserves the previously committed branch runtime');
  assert.deepEqual(await branch.rewind(), baseline);
  const exported = timeline.observe(); exported.frames[0].samples.manual.value = true; exported.persisted.fill(0); exported.live.context.settings.splice(0);
  const changed = frame(hour + 11 * 60_000, true), pending = branch.step(changed, { provenance: 'synthetic' });
  changed.samples.manual.value = false;
  const result = await pending;
  assert.equal(result.outcome.trace.safe.active, true, 'branch captures its frame before awaiting core creation');
  assert.deepEqual(timeline.observe(), before); assert.deepEqual(fs.readFileSync(storage.filename), file); assert.deepEqual(sink, calls);
  const recorded = await timeline.branch({ branchId: 'ghost.recorded', runId: 'ghost.recorded.run', at: 1 }); t.after(() => recorded.dispose());
  const replay = await recorded.step(frame(hour), { provenance: 'recorded' });
  assert.deepEqual(replay.outcome, before.receipts[1].outcome);
  assert.deepEqual(recorded.observe().provenance, ['recorded']);
  await assert.rejects(timeline.recordApplied({ receiptId() {} }), /clone|function/i);
  assert.deepEqual(timeline.observe(), before, 'uncapturable applied arguments do not leave the owner busy');
});

test('REF-06-018 source bound durable timeline rejects missing corrupt persistence and invalid live bindings', async t => {
  const { timeline, storage, options, directory, sink } = await fixture(t);
  timeline.append(frame(0));
  const receiptId = new Uint8Array(16).fill(2);
  await timeline.recordApplied({ receiptId, resourceId: 7, startMs: 10n, endMs: 20n, localDay: 1 });
  const restart = await createGhostTimeline({ ...options, initializeEmpty: false }); t.after(() => restart.dispose());
  assert.equal(restart.usedRolling(30n, 60_000n), 10n, 'actual FileLedger bytes restore the source-bound Rust owner');
  assert.equal(restart.observe().frames.length, 0, 'usage restart does not pretend to restore a live decision timeline');
  const missing = new FileLedger(path.join(directory, 'missing.json'));
  await assert.rejects(createGhostTimeline({ ...options, accounting: { ...options.accounting, storage: missing }, initializeEmpty: false }), /missing durable ledger/);
  await assert.rejects(createGhostTimeline({ ...options, output: 'not-a-port' }), /compiled Bool output/);
  await assert.rejects(createGhostTimeline({ ...options, accounting: { ...options.accounting, account: 'missing' } }), /no accounting account/);
  const unsupported = new FileLedger(path.join(directory, 'unsupported.json'));
  const beforeUnsupported = timeline.observe(), callsBeforeUnsupported = structuredClone(sink);
  const budget = source.replace('account applied = on_time(pump, stage: applied, persistence: durable);',
    'account applied = on_time(pump, stage: applied, persistence: durable);\n'
    + 'constraints Budget { limit used(applied, rolling(60s)) <= 30s { reserve = 5s; on_unknown = block; } }');
  await assert.rejects(createGhostTimeline({ ...options, document: budget,
    accounting: { ...options.accounting, storage: unsupported } }), /does not support accounting-dependent decisions/);
  const counted = source.replace('account applied = on_time(pump, stage: applied, persistence: durable);',
    'account applied = on_time(pump, stage: applied, persistence: durable);\n'
    + 'event starts: Event; account count = count_events(starts, over: local_day("UTC"), persistence: durable);');
  await assert.rejects(createGhostTimeline({ ...options, document: counted,
    accounting: { ...options.accounting, storage: unsupported } }), /does not support accounting-dependent decisions/);
  assert.equal(await unsupported.read(), null, 'unsupported decision profiles never initialize persistence');
  assert.deepEqual(timeline.observe(), beforeUnsupported, 'profile rejection preserves existing owners');
  assert.deepEqual(sink, callsBeforeUnsupported, 'unsupported profiles never dispatch intent');
  await assert.rejects(timeline.recordApplied({ receiptId, resourceId: 8, startMs: 10n, endMs: 20n, localDay: 1 }), /wrong bound resource ID/);
  fs.writeFileSync(missing.filename, '{"format":"GhostFlow/ledger-file-v1","sha256":"' + '0'.repeat(64) + '","bytes":"0102"}');
  await assert.rejects(createGhostTimeline({ ...options, accounting: { ...options.accounting, storage: missing }, initializeEmpty: false }), /checksum mismatch/);
});

for (const quality of ['NotReady', 'Disconnected', 'Stale', 'Invalid']) {
  test(`issue 531 timeline preserves explicit ${quality}, clock-only aging and immutable quality replay`, async t => {
    const conditioned = source.replace('input manual: Bool;', 'input manual: Bool { sample = 1ms; stale_after = 2ms; }');
    const { timeline, storage, sink } = await fixture(t, { document: conditioned });
    const site = timeline.compilation.manifest.schedules[0].site;
    const qualityFrame = (ms, manual = false) => { const packet = frame(ms, manual); packet.contextFacts.schedules[0].site = site; return packet; };
    const clockOnly = ms => { const packet = qualityFrame(ms); delete packet.samples; return packet; };
    const initial = timeline.append(clockOnly(0));
    assert.equal(initial.outcome.trace.safe.active, false);
    assert.ok(initial.outcome.trace.resultTrace.some(event => event.choice === 4), 'no first observation remains NotReady');
    const supplied = qualityFrame(1, true);
    assert.equal(timeline.append(supplied).outcome.trace.safe.active, true);
    supplied.samples.manual.value = false;
    assert.equal(timeline.observe().frames[1].samples.manual.value, true, 'capture retains the actual supplied observation');
    const aged = timeline.append(clockOnly(4));
    assert.equal(aged.outcome.trace.safe.active, false);
    assert.ok(aged.outcome.trace.resultTrace.some(event => event.choice === 2), 'clock progress does not manufacture fresh Good');
    const unavailable = qualityFrame(5);
    unavailable.samples.manual.quality = quality;
    unavailable.samples.manual.value = true; // Producer payload remains typed; unavailable quality prevents its use.
    const fault = timeline.append(unavailable);
    assert.equal(fault.outcome.trace.safe.active, false, 'only the fixture-authored recovery chooses its output');
    assert.ok(fault.outcome.trace.resultTrace.some(event => event.choice === ['Disconnected', 'Stale', 'Invalid', 'NotReady'].indexOf(quality) + 1));
    const restored = timeline.append(qualityFrame(6, false));
    assert.equal(restored.outcome.trace.safe.active, false, 'healthy false is a successful observation');
    assert.ok(restored.outcome.trace.resultTrace.every(event => event.choice === 0));
    assert.equal(timeline.append(qualityFrame(7, true)).outcome.trace.safe.active, true);

    const before = timeline.observe(), bytes = fs.readFileSync(storage.filename), calls = structuredClone(sink);
    const branch = await timeline.branch({ branchId: `quality.${quality}`, runId: `quality.run.${quality}`, at: 2 });
    t.after(() => branch.dispose());
    const baseline = branch.observe();
    const tampered = clockOnly(4); tampered.samples = qualityFrame(4, true).samples;
    await assert.rejects(branch.step(tampered, { provenance: 'recorded' }), /captured actual timeline/);
    for (const packet of [
      { ...qualityFrame(4), inputs: { manual: true } },
      { ...qualityFrame(4), samples: { unexpected: qualityFrame(4).samples.manual } },
      { ...qualityFrame(4), samples: { manual: { ...qualityFrame(4).samples.manual, quality: 'invented' } } },
      { ...qualityFrame(4), samples: { manual: { ...qualityFrame(4).samples.manual, value: 'wrong' } } },
    ]) {
      await assert.rejects(branch.step(packet, { provenance: 'synthetic' }), /unknown|quality|Bool|boolean|type/i);
      assert.deepEqual(branch.observe(), baseline);
    }
    for (const packet of [clockOnly(4), unavailable, qualityFrame(6, false), qualityFrame(7, true)]) {
      if (packet.samples) {
        const changedQuality = structuredClone(packet);
        changedQuality.samples.manual.quality = packet.samples.manual.quality === 'Good' ? 'Invalid' : 'Good';
        const previous = branch.observe();
        await assert.rejects(branch.step(changedQuality, { provenance: 'recorded' }), /captured actual timeline/);
        assert.deepEqual(branch.observe(), previous, 'recorded identity includes producer quality');
      }
      const replay = await branch.step(packet, { provenance: 'recorded' });
      const actual = before.receipts[before.frames.findIndex(record => record.nowMs === packet.nowMs)];
      assert.deepEqual(replay, { ...actual, provenance: 'recorded', physicalEffects: false });
    }
    assert.deepEqual(await branch.rewind(), baseline);
    assert.deepEqual(timeline.observe(), before);
    assert.deepEqual(fs.readFileSync(storage.filename), bytes);
    assert.deepEqual(sink, calls);
  });
}
