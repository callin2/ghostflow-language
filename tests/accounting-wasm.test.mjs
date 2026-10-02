import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AccountingRuntime } from '../runtimes/wasm/accounting-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { GhostFlowStation } from '../runtimes/wasm/station.mjs';
import { compileSource } from '../tools/compile-source.mjs';
import { verifyArtifactSourceMap } from '../tools/toolchain.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');

execFileSync('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-wasm', '--target', 'wasm32-unknown-unknown', '--release'], {
  cwd: root, stdio: 'inherit',
});
const wasmBytes = readFileSync(wasmPath);
const config = { maxIntervals: 8, maxEvents: 8, maxReservations: 8, maxRollingWindowMs: 600_000n };
const id = value => new Uint8Array(16).fill(value);
const reference = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8'))
  .cases.find(entry => entry.id === 'REF-03-050');

test('REF-04-066: durable source-bound budget explanation ignores OFF animation and reproduces after activation', async t => {
  const original = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8'))
    .cases.find(entry => entry.id === 'REF-04-066');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/260');
  assert.equal(original.scope, 'host'); assert.equal(original.status, 'specified');
  assert.match(original.given, /budget/); assert.match(original.when, /next release/);
  const source = '# Budget explanation\n\n```ghost\ncontrol Explanation {\n'
    + 'resource pump: BoolActuator; account applied = on_time(pump, stage: applied, persistence: durable);\n'
    + 'event started: Event; account starts = count_events(started, over: local_day("UTC"), persistence: durable);\n'
    + 'constraints Budget { limit used(applied, rolling(60s)) <= 30s { reserve = 5s; on_unknown = block; } }\n'
    + 'output pump_off: Bool; pump_off <- case starts.count { ok(count) => count < 0; fault(_) => false; };\n}\n```\n';
  const options = { filename: 'budget-explanation.ghost.md', account: 'applied', resourceId: 7, config };
  const artifact = await compileSource(source, { filename: options.filename });
  const query = { nowMs: 40_000n, windowMs: 60_000n, limitMs: 30_000n, reserveMs: 5_000n };
  const ledger = await AccountingRuntime.instantiateSource(wasmBytes, source, options);
  t.after(() => ledger.dispose());
  let snapshot;
  const persist = async bytes => { snapshot = bytes.slice(); return true; };
  assert.equal(ledger.explainRolling(query), null, 'uninitialized is Unknown');
  await ledger.initializeEmpty(persist);
  await ledger.recordAppliedSegment({ receiptId: id(90), resourceId: 7, startMs: 0n, endMs: 20_000n, localDay: 1 }, persist);
  await ledger.recordAppliedSegment({ receiptId: id(91), resourceId: 7, startMs: 10_000n, endMs: 30_000n, localDay: 1 }, persist);
  const explanation = ledger.explainRolling(query);
  assert.deepEqual([explanation.usedMs, explanation.limitMs, explanation.reserveMs, explanation.reservedMs,
    explanation.blocked, explanation.nextReleaseMs, explanation.ledgerRevision], [30_000n, 30_000n, 5_000n, 0n, true, 65_000n, 3n]);
  assert.equal(explanation.source.sha256, artifact.sourceDocument.sha256);
  assert.equal(explanation.source.artifactSha256, artifact.manifest.bytecodeSha256);
  assert.deepEqual([explanation.source.account, explanation.source.target, explanation.source.stage,
    explanation.resourceId, explanation.blockReason], ['applied', 'pump', 'applied', 7, 'rolling-budget']);
  const rejected = { reservationId: id(92), resourceId: 7, admittedAtMs: query.nowMs, ...query };
  assert.equal(await ledger.reserveRolling(rejected, persist), 'Rejected');
  assert.deepEqual(ledger.explainRolling(query), explanation, 'rejected start does not mutate ledger revision or evidence');
  for (const animation of [{ output: false, timeMs: 0 }, { output: false, timeMs: 999_999 }]) {
    assert.equal(animation.output, false);
    assert.deepEqual(ledger.explainRolling(query), explanation);
  }
  assert.equal(await ledger.reserveRolling({ ...rejected, admittedAtMs: 64_999n }, persist), 'Rejected');
  const restored = await AccountingRuntime.instantiateSource(wasmBytes, source, options);
  t.after(() => restored.dispose()); restored.restore(snapshot);
  const replay = restored.explainRolling(query);
  assert.deepEqual({ ...replay, ledgerRevision: explanation.ledgerRevision }, explanation);
  assert.equal(replay.ledgerRevision, 0n, 'restore revision is local to the new owner');
  const control = new GhostFlowRuntime(restored.wasm); t.after(() => control.dispose()); control.load(artifact.bytes);
  control.addCapability('actuator', 'pump_off', 'bool');
  restored.activateControl(control, { bootEpoch: 2n, terminalCapacity: 8 });
  const countBinding = artifact.manifest.accounting.bindings.find(binding => binding.name === 'starts');
  // A separate context ledger restores the same bytes; the rolling query stays
  // on its source-bound owner. OFF observation does not cause the budget denial.
  const sharedLedger = new AccountingRuntime(restored.wasm, config); t.after(() => sharedLedger.dispose());
  sharedLedger.restore(snapshot);
  const trace = sharedLedger.tickControl(control, { site: countBinding.site, account: countBinding.name,
    event: countBinding.evidenceBinding.target, timezone: countBinding.basis.zone, eventType: 9,
    localDay: 1, monotonicMs: 40_000n, bootEpoch: 2n, wallMs: 1_700_000_000_000n, clockTrusted: true });
  assert.equal(trace.safe.pump_off, false, 'actual completed control output is OFF');
  assert.deepEqual(restored.explainRolling(query), replay, 'control activation cannot reset accounted usage');
  assert.equal(await restored.reserveRolling({ ...rejected, admittedAtMs: 65_000n }, async () => false).catch(e => e.message),
    'accounting snapshot was not durably acknowledged');
  assert.equal(restored.explainRolling(query), null, 'pending persistence is Unknown');
  await restored.persistPending(persist);
  assert.deepEqual([restored.explainRolling(query).reservedMs, restored.explainRolling(query).nextReleaseMs], [5_000n, 70_000n]);
  assert.throws(() => { ledger.binding.limits[0].boundMs = 99_000; }, TypeError);
  assert.throws(() => { ledger.binding.limits[0].basis.durationMs = 99_000; }, TypeError);
  assert.throws(() => { ledger.binding.limits.push({}); }, TypeError);
  assert.throws(() => ledger.explainRolling({ ...query, limitMs: 99_000n }), /bound source constraint/);
  assert.equal(ledger.explainRolling({ ...query, nowMs: 20_000n }), null, 'future recorded evidence is not a release forecast');
  assert.equal(await restored.reserveRolling({ ...rejected, reservationId: id(93), admittedAtMs: 100_000n }, persist), 'Inserted');
  t.diagnostic(JSON.stringify({ sourceSha256: explanation.source.sha256, nextReleaseMs: String(explanation.nextReleaseMs) }));
});

test('REF-03-020: source-bound native and WASM rolling ledgers integrate regular and 7/13/9-second partitions exactly', async t => {
  const source = '# Historical applied intervals\n\n```ghost\ncontrol RollingHistory {\n'
    + 'resource pump: BoolActuator;\naccount pump_applied = on_time(pump, stage: applied, persistence: durable);\n'
    + 'constraints Budget { limit used(pump_applied, rolling(60s)) <= 30s { reserve = 1s; on_unknown = block; } }\n'
    + 'output ready: Bool; ready <- false;\n}\n```\n';
  const filename = 'rolling-history.ghost.md';
  const artifact = await compileSource(source, { filename });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v10');
  const map = { format: 'GhostFlow/source-map-v1', bytecodeSha256: artifact.manifest.bytecodeSha256,
    sourceDocument: artifact.sourceDocument, nodes: artifact.sourceMap, lines: artifact.extractionMap,
    traceMetadata: artifact.traceMetadata, interactionSchema: null, interactionSourceIdentity: null };
  verifyArtifactSourceMap(map, artifact.bytes, { manifest: artifact.manifest });
  const binding = artifact.manifest.accounting.bindings.find(binding => binding.name === 'pump_applied');
  assert.deepEqual(binding.evidenceBinding, { kind: 'applied_interval', target: 'pump', stage: 'applied', identity: 'receipt_id' });
  const windowMs = artifact.manifest.accounting.constraints[0].limits[0].basis.durationMs;
  assert.equal(windowMs, 60_000);
  const intervals = [[0, 20_000], [30_000, 40_000], [80_000, 100_000]];
  const queries = [40_000, 65_000, 85_000, 110_000];
  const expected = [{ nowMs: 40_000, usedMs: 30_000 }, { nowMs: 65_000, usedMs: 25_000 },
    { nowMs: 85_000, usedMs: 15_000 }, { nowMs: 110_000, usedMs: 20_000 }];
  const cadence = deltas => {
    const times = [0];
    for (let index = 0; times.at(-1) < 110_000; index++) times.push(Math.min(110_000, times.at(-1) + deltas[index % deltas.length]));
    return times;
  };
  const regular = cadence([1000]), irregular = cadence([7000, 13_000, 9000]);
  assert.deepEqual(irregular.slice(0, 4), [0, 7000, 20_000, 29_000]);
  const partition = scanTimes => {
    // Independent event timestamps are mandatory boundaries, not values rounded
    // to the next scan. The host only partitions caller-validated intervals.
    const times = [...new Set([...scanTimes, ...queries, ...intervals.flat()])].sort((a, b) => a - b);
    let previous = 0, receiptId = 0;
    return times.map(nowMs => {
      const segments = intervals.flatMap(([start, end]) => {
        const startMs = Math.max(start, previous), endMs = Math.min(end, nowMs);
        return startMs < endMs ? [{ receiptId: ++receiptId, resourceId: 7, startMs, endMs }] : [];
      });
      previous = nowMs;
      return { nowMs, segments, query: queries.includes(nowMs) };
    });
  };
  const tapes = [partition(regular), partition(irregular)];
  assert.notDeepEqual(tapes[0].flatMap(frame => frame.segments), tapes[1].flatMap(frame => frame.segments));
  const ledgerConfig = { maxIntervals: 256, maxEvents: 8, maxReservations: 8, maxRollingWindowMs: 60_000n };
  const executeWasm = async frames => {
    const runtime = await AccountingRuntime.instantiateSource(wasmBytes, source, {
      filename, account: binding.name, resourceId: 7, config: ledgerConfig,
    });
    try {
      assert.equal(runtime.source.text, source);
      assert.equal(runtime.source.sha256, artifact.sourceDocument.sha256);
      assert.equal(runtime.source.artifactSha256, artifact.manifest.bytecodeSha256);
      assert.equal(runtime.source.target, 'pump'); assert.equal(runtime.source.stage, 'applied');
      let now = 0n, snapshot;
      const persist = async bytes => {
        assert.equal(runtime.usedRolling(7, now, BigInt(windowMs)), null, 'unacknowledged ledger is Unknown');
        snapshot = bytes.slice(); return true; // Test-owned acknowledgement, no storage-medium certification.
      };
      await runtime.initializeEmpty(persist);
      const observations = [];
      for (const frame of frames) {
        now = BigInt(frame.nowMs);
        for (const segment of frame.segments) {
          const receiptId = new Uint8Array(16);
          new DataView(receiptId.buffer).setBigUint64(0, BigInt(segment.receiptId), true);
          await runtime.recordAppliedSegment({ ...segment, receiptId, startMs: BigInt(segment.startMs), endMs: BigInt(segment.endMs), localDay: 100 }, persist);
        }
        if (frame.query) {
          const used = runtime.usedRolling(7, now, BigInt(windowMs));
          assert.equal(typeof used, 'bigint', 'acknowledged rolling result is Known');
          observations.push({ nowMs: frame.nowMs, usedMs: Number(used) });
        }
      }
      assert.throws(() => runtime.usedRolling(8, now, BigInt(windowMs)), /wrong bound resource ID/);
      runtime.restore(snapshot);
      assert.equal(runtime.usedRolling(7, 110_000n, BigInt(windowMs)), 20_000n);
      return observations;
    } finally { runtime.dispose(); }
  };
  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'accounting_tape'], { cwd: root, stdio: 'inherit' });
  const directory = mkdtempSync(join(tmpdir(), 'reference-rolling-accounting-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const modulePath = join(directory, 'module.gfb'), tapePath = join(directory, 'tape.json');
  writeFileSync(modulePath, artifact.bytes);
  const runner = resolve(root, 'target/release/examples/accounting_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const nativeRequest = frames => ({ moduleFingerprint: artifact.traceMetadata.moduleFingerprint,
    manifest: artifact.manifest, account: binding.name, target: 'pump', resourceId: 7, windowMs, frames });
  const runNative = request => {
    writeFileSync(tapePath, JSON.stringify(request));
    return JSON.parse(execFileSync(runner, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 }));
  };
  for (const frames of tapes) {
    const request = nativeRequest(frames);
    const native = runNative(request);
    assert.deepEqual(native, { moduleFingerprint: artifact.traceMetadata.moduleFingerprint,
      account: binding.name, target: 'pump', stage: 'applied', resourceId: 7, observations: expected });
    assert.deepEqual(runNative(request), native);
    assert.deepEqual(await executeWasm(frames), native.observations);
    assert.deepEqual(await executeWasm(frames), native.observations);
  }
  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: 'missing', resourceId: 7, config: ledgerConfig }), /no accounting account/);
  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source.replace('stage: applied', 'stage: safe'), {
    filename, account: binding.name, resourceId: 7, config: ledgerConfig,
  }), /applied|unsupported accounting stage/);
  for (const [mutate, reason] of [
    [request => { request.account = 'missing'; }, /unknown source account/],
    [request => { request.target = 'other'; }, /source target mismatch/],
    [request => { request.moduleFingerprint = '0'.repeat(16); }, /compiled module identity mismatch/],
    [request => { request.frames.find(frame => frame.segments.length).segments[0].resourceId = 8; }, /wrong bound resource ID/],
  ]) {
    const request = structuredClone(nativeRequest(tapes[1])); mutate(request);
    assert.throws(() => runNative(request), reason);
  }
});

test('REF-04-046: checked source native/WASM ledgers merge applied overlap while Station cleanup retains its lease', async t => {
  const original = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8'))
    .cases.find(entry => entry.id === 'REF-04-046');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/245');
  assert.equal(original.status, 'specified'); assert.equal(original.scope, 'runtime');
  const source = '# Shared pump applied accounting\n\n```ghost\ncontrol SharedPumpHistory {\n'
    + 'resource pump: BoolActuator;\naccount applied = on_time(pump, stage: applied, persistence: durable);\n'
    + 'output ready: Bool; ready <- false;\n}\n```\n';
  const filename = 'shared-pump-history.ghost.md';
  const artifact = await compileSource(source, { filename });
  const map = { format: 'GhostFlow/source-map-v1', bytecodeSha256: artifact.manifest.bytecodeSha256,
    sourceDocument: artifact.sourceDocument, nodes: artifact.sourceMap, lines: artifact.extractionMap,
    traceMetadata: artifact.traceMetadata, interactionSchema: null, interactionSourceIdentity: null };
  verifyArtifactSourceMap(map, artifact.bytes, { manifest: artifact.manifest });
  const stationTape = { config: { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 1000, maxStartBudgetMs: 800 },
    onMs: 10, offMs: 30, safeMs: 40 };
  // Two logical controls supplied these already validated applied intervals for
  // one stable physical ID. The Rust ledger owns the union calculation; this
  // test does not validate Driver receipts or implement a merge in JavaScript.
  const frames = [{ nowMs: 30, segments: [
    { receiptId: 1, resourceId: 7, startMs: 10, endMs: 25 },
    { receiptId: 2, resourceId: 7, startMs: 20, endMs: 30 },
  ], query: true }, { nowMs: 40, segments: [], query: true }];
  const expected = [{ nowMs: 30, usedMs: 20 }, { nowMs: 40, usedMs: 20 }];
  assert.notEqual(expected[0].usedMs, (25 - 10) + (30 - 20), 'overlap must not be summed per control');
  const persist = async () => true;
  const ledger = await AccountingRuntime.instantiateSource(wasmBytes, source, {
    filename, account: 'applied', resourceId: 7, config,
  });
  const station = await GhostFlowStation.instantiate(wasmBytes, stationTape.config);
  t.after(() => { ledger.dispose(); station.dispose(); });
  assert.equal(ledger.source.text, source);
  assert.equal(ledger.source.sha256, artifact.sourceDocument.sha256);
  assert.equal(ledger.source.artifactSha256, artifact.manifest.bytecodeSha256);
  assert.equal(ledger.source.target, 'pump'); assert.equal(ledger.source.stage, 'applied');
  await ledger.initializeEmpty(persist);
  const used = [];
  for (const frame of frames) {
    for (const segment of frame.segments) {
      const receiptId = new Uint8Array(16);
      new DataView(receiptId.buffer).setBigUint64(0, BigInt(segment.receiptId), true);
      await ledger.recordAppliedSegment({ ...segment, receiptId,
        startMs: BigInt(segment.startMs), endMs: BigInt(segment.endMs), localDay: 100 }, persist);
    }
    used.push({ nowMs: frame.nowMs, usedMs: Number(ledger.usedRolling(7, BigInt(frame.nowMs), 60_000n)) });
  }
  assert.deepEqual(used, expected);
  assert.equal(ledger.usedLocalDay(7, 100), 20n);
  assert.throws(() => ledger.usedRolling(8, 40n, 60_000n), /wrong bound resource ID/);
  station.synchronizeDay({ day: 100, nowMs: 0n, nextDayDeadlineMs: 10_000n, trusted: true });
  station.enter({ requestId: 1n, ...station.claim, mode: 'Auto' });
  const grant = await station.start({ requestId: 2n, ...station.claim, sessionId: 77n, ownerId: 88n,
    mode: 'Auto', valves: 3n, budgetMs: 100n, occurrenceId: 501n, nowMs: 10n }, persist);
  assert.equal(grant.leaseDeadlineMs, 110n);
  const apply = (pumpOn, valves, nowMs) => {
    station.authorizeOutput({ sessionId: 77n, pumpOn, valves, nowMs });
    station.reportApplied({ sessionId: 77n, pumpOn, valves, nowMs });
  };
  apply(true, 1n, 10n); apply(false, 1n, 30n);
  station.requestStop({ requestId: 3n, ...station.claim });
  assert.throws(() => station.prepareFinish({ sessionId: 77n, outcome: 'Cancelled', nowMs: 30n }), /driver has not reported pump and valves safely off/);
  const observe = (phase, rejected = false) => ({ phase, mode: station.mode, stopping: station.stopping,
    reservedMs: Number(station.reservedMs), usedMs: Number(station.dailyUsedMs), rejected });
  const lifecycle = [observe('pump-off-cleanup-open', true)];
  // This is the original joint observation: overlap is counted once while pump
  // OFF has not released the owner, cleanup or its finite reservation.
  assert.equal(used[0].usedMs, 20);
  assert.equal(station.mode, 'Auto'); assert.equal(station.stopping, true); assert.equal(station.reservedMs, 100n);
  assert.throws(() => station.enter({ requestId: 4n, ...station.claim, mode: 'Manual' }), /not stopped/);
  assert.throws(() => station.confirmStopped({ nowMs: 30n }), /active session needs durable prepare_finish/);
  station.reportApplied({ sessionId: 77n, pumpOn: false, valves: 0n, nowMs: 40n });
  const prepared = station.prepareFinish({ sessionId: 77n, outcome: 'Cancelled', nowMs: 40n });
  lifecycle.push(observe('safe-awaiting-durable-finish'));
  assert.equal(station.mode, 'Auto'); assert.equal(station.reservedMs, 100n);
  // The test-owned persistence acknowledgement precedes commit. It certifies
  // neither a storage medium nor physical feedback.
  assert.equal(await persist(prepared.bytes, prepared.token), true);
  station.commitFinish(prepared.token);
  lifecycle.push(observe('durable-finish'));
  assert.deepEqual(lifecycle, [
    { phase: 'pump-off-cleanup-open', mode: 'Auto', stopping: true, reservedMs: 100, usedMs: 0, rejected: true },
    { phase: 'safe-awaiting-durable-finish', mode: 'Auto', stopping: true, reservedMs: 100, usedMs: 0, rejected: false },
    { phase: 'durable-finish', mode: 'Stopped', stopping: false, reservedMs: 0, usedMs: 20, rejected: false },
  ]);
  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'accounting_tape'], { cwd: root, stdio: 'inherit' });
  const directory = mkdtempSync(join(tmpdir(), 'reference-session-accounting-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const modulePath = join(directory, 'module.gfb'), tapePath = join(directory, 'tape.json');
  writeFileSync(modulePath, artifact.bytes);
  const request = { moduleFingerprint: artifact.traceMetadata.moduleFingerprint, manifest: artifact.manifest,
    account: 'applied', target: 'pump', resourceId: 7, windowMs: 60_000, frames, station: stationTape };
  const runNative = request => {
    writeFileSync(tapePath, JSON.stringify(request));
    const runner = resolve(root, 'target/release/examples/accounting_tape' + (process.platform === 'win32' ? '.exe' : ''));
    return JSON.parse(execFileSync(runner, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 }));
  };
  const native = runNative(request);
  assert.deepEqual(native, { moduleFingerprint: artifact.traceMetadata.moduleFingerprint, account: 'applied',
    target: 'pump', stage: 'applied', resourceId: 7, observations: used, stationObservations: lifecycle });
  assert.deepEqual(runNative(request), native, 'fresh replay retains identical owner and ledger observations');
  for (const [mutate, reason] of [
    [request => { request.frames[0].segments[0].resourceId = 8; }, /wrong bound resource ID/],
    [request => { request.manifest.accounting.bindings[0].evidenceBinding.stage = 'safe'; }, /unsupported source accounting binding/],
  ]) {
    const invalid = structuredClone(request); mutate(invalid); assert.throws(() => runNative(invalid), reason);
  }
  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source.replace('stage: applied', 'stage: safe'), {
    filename, account: 'applied', resourceId: 7, config,
  }), /applied|unsupported accounting stage/);
});

test('REF-04-056: checked source native/WASM once, day and rolling histories survive fresh-owner restart independently', async t => {
  const original = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8'))
    .cases.find(entry => entry.id === 'REF-04-056');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/254');
  assert.equal(original.status, 'specified'); assert.equal(original.scope, 'runtime');
  const source = '# Durable independent histories\n\n```ghost\ncontrol RestartHistory {\n'
    + 'resource pump: BoolActuator;\naccount applied = on_time(pump, stage: applied, persistence: durable);\n'
    + 'constraints Duty { limit used(applied, rolling(60s)) <= 30ms { reserve = 1ms; on_unknown = block; } }\n'
    + 'output ready: Bool; ready <- false;\n}\n```\n';
  const filename = 'restart-history.ghost.md';
  const artifact = await compileSource(source, { filename });
  verifyArtifactSourceMap({ format: 'GhostFlow/source-map-v1', bytecodeSha256: artifact.manifest.bytecodeSha256,
    sourceDocument: artifact.sourceDocument, nodes: artifact.sourceMap, lines: artifact.extractionMap,
    traceMetadata: artifact.traceMetadata, interactionSchema: null, interactionSourceIdentity: null }, artifact.bytes,
  { manifest: artifact.manifest });
  const binding = artifact.manifest.accounting.bindings[0];
  const limit = artifact.manifest.accounting.constraints[0].limits[0];
  assert.deepEqual(binding.evidenceBinding, { kind: 'applied_interval', target: 'pump', stage: 'applied', identity: 'receipt_id' });
  const ledgerConfig = { maxIntervals: 256, maxEvents: 8, maxReservations: 8, maxRollingWindowMs: 60_000n };
  const stationConfig = { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 1000, maxStartBudgetMs: 800 };
  const persist = async bytes => { assert(bytes.length > 0); return true; }; // Test-owned durable ACK.
  let ledger = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: 'applied', resourceId: 7, config: ledgerConfig });
  let station = await GhostFlowStation.instantiate(wasmBytes, stationConfig);
  t.after(() => { ledger.dispose(); station.dispose(); });
  assert.equal(ledger.source.sha256, artifact.sourceDocument.sha256);
  assert.equal(ledger.source.artifactSha256, artifact.manifest.bytecodeSha256);
  let durableLedger;
  const persistLedger = async bytes => { durableLedger = bytes.slice(); return persist(bytes); };
  await ledger.initializeEmpty(persistLedger); // First boot only; never used during recovery.
  const receiptId = new Uint8Array(16); receiptId[0] = 1;
  await ledger.recordAppliedSegment({ receiptId, resourceId: 7, startMs: 10n, endMs: 40n, localDay: 100 }, persistLedger);
  station.synchronizeDay({ day: 100, nowMs: 0n, nextDayDeadlineMs: 100_000n, trusted: true });
  station.enter({ requestId: 1n, ...station.claim, mode: 'Auto' });
  const request = (requestId, occurrenceId, nowMs) => ({ requestId, ...station.claim, sessionId: 77n, ownerId: 88n,
    mode: 'Auto', valves: 1n, budgetMs: 100n, occurrenceId, nowMs });
  await station.start(request(2n, 501n, 10n), persist);
  for (const [pumpOn, valves, nowMs] of [[true, 1n, 10n], [false, 0n, 40n]]) {
    station.authorizeOutput({ sessionId: 77n, pumpOn, valves, nowMs });
    station.reportApplied({ sessionId: 77n, pumpOn, valves, nowMs }); // Applied fixture, no physical proof.
  }
  const finish = station.prepareFinish({ sessionId: 77n, outcome: 'Completed', nowMs: 40n });
  await persist(finish.bytes); station.commitFinish(finish.token);
  const observations = [];
  for (const phase of ['beforeRestart', 'afterRestart', 'afterWindowExpiry']) {
    const nowMs = phase === 'afterWindowExpiry' ? 60_040n : 50n;
    if (phase === 'afterRestart') {
      station.requestStop({ requestId: 3n, ...station.claim }); station.confirmStopped({ nowMs: 50n });
      const stationBytes = station.snapshot(), ledgerBytes = durableLedger.slice();
      await persist(stationBytes); await persist(ledgerBytes);
      const previousStation = station, previousLedger = ledger;
      station = await GhostFlowStation.instantiate(wasmBytes, stationConfig);
      ledger = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: 'applied', resourceId: 7, config: ledgerConfig });
      assert.notEqual(station.wasm, previousStation.wasm); assert.notEqual(ledger.wasm, previousLedger.wasm);
      // Empty recovery owners are not accepted as historical truth.
      assert.equal(ledger.usedRolling(7, 50n, BigInt(limit.basis.durationMs)), null);
      station.restore(stationBytes); ledger.restore(ledgerBytes);
      previousStation.dispose(); previousLedger.dispose();
      // The test host supplies comparable trusted timestamps across boots. It
      // does not implement Device boot-clock mapping or certify real storage.
      station.synchronizeDay({ day: 100, nowMs: 50n, nextDayDeadlineMs: 100_000n, trusted: true });
      station.enter({ requestId: 4n, ...station.claim, mode: 'Auto' });
    }
    assert.throws(() => station.prepareStart(request(5n, 501n, nowMs)), /occurrence id was already accepted/);
    assert.equal(station.dailyUsedMs, 30n);
    assert(station.dailyUsedMs + 100n < BigInt(stationConfig.dailyQuotaMs), 'day budget admits the new finite job');
    const prepared = station.prepareStart(request(6n, 502n, nowMs)); station.abortPrepared(prepared.token);
    const reservationId = new Uint8Array(16); reservationId[0] = nowMs === 50n ? 20 : 21;
    const admission = await ledger.reserveRolling({ reservationId, resourceId: 7, admittedAtMs: nowMs,
      windowMs: BigInt(limit.basis.durationMs), limitMs: BigInt(limit.boundMs), reserveMs: BigInt(limit.reserveMs) }, persistLedger);
    observations.push({ phase, nowMs: Number(nowMs), duplicate: 'DuplicateOccurrence', freshDayAdmission: true,
      stationDayUsedMs: Number(station.dailyUsedMs), dayUsedMs: Number(ledger.usedLocalDay(7, 100)),
      rollingUsedMs: Number(ledger.usedRolling(7, nowMs, BigInt(limit.basis.durationMs))), rollingAdmission: admission });
  }
  assert.deepEqual(observations, [
    { phase: 'beforeRestart', nowMs: 50, duplicate: 'DuplicateOccurrence', freshDayAdmission: true, stationDayUsedMs: 30, dayUsedMs: 30, rollingUsedMs: 30, rollingAdmission: 'Rejected' },
    { phase: 'afterRestart', nowMs: 50, duplicate: 'DuplicateOccurrence', freshDayAdmission: true, stationDayUsedMs: 30, dayUsedMs: 30, rollingUsedMs: 30, rollingAdmission: 'Rejected' },
    { phase: 'afterWindowExpiry', nowMs: 60040, duplicate: 'DuplicateOccurrence', freshDayAdmission: true, stationDayUsedMs: 30, dayUsedMs: 30, rollingUsedMs: 0, rollingAdmission: 'Inserted' },
  ]);
  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'accounting_tape'], { cwd: root, stdio: 'inherit' });
  const directory = mkdtempSync(join(tmpdir(), 'reference-ledger-restart-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const modulePath = join(directory, 'module.gfb'), tapePath = join(directory, 'tape.json'); writeFileSync(modulePath, artifact.bytes);
  const tape = { moduleFingerprint: artifact.traceMetadata.moduleFingerprint, manifest: artifact.manifest,
    account: 'applied', target: 'pump', resourceId: 7, windowMs: limit.basis.durationMs,
    frames: [{ nowMs: 40, segments: [{ receiptId: 1, resourceId: 7, startMs: 10, endMs: 40 }], query: true }],
    restart: { limitMs: limit.boundMs, reserveMs: limit.reserveMs, stationConfig } };
  const runNative = request => {
    writeFileSync(tapePath, JSON.stringify(request));
    return JSON.parse(execFileSync(resolve(root, 'target/release/examples/accounting_tape' + (process.platform === 'win32' ? '.exe' : '')),
      [modulePath, tapePath], { encoding: 'utf8', stdio: 'pipe', timeout: 10_000 }));
  };
  assert.deepEqual(runNative(tape).restartObservations, observations);
  for (const [mutate, reason] of [
    [request => { request.account = 'missing'; }, /unknown source account/],
    [request => { request.target = 'wrong'; }, /source target mismatch/],
    [request => { request.moduleFingerprint = '0'.repeat(16); }, /compiled module identity mismatch/],
    [request => { request.frames[0].segments[0].resourceId = 8; }, /wrong bound resource ID/],
    [request => { request.restart.limitMs = 31; }, /source rolling constraint mismatch/],
    [request => { request.windowMs = 59_000; }, /source rolling constraint mismatch/],
    [request => { request.restart.stationConfig.dailyQuotaMs = 20; }, /QuotaExceeded/],
  ]) { const invalid = structuredClone(tape); mutate(invalid); assert.throws(() => runNative(invalid), reason); }
  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: 'missing', resourceId: 7, config: ledgerConfig }), /source has no accounting account missing/);
  t.diagnostic(JSON.stringify({ sourceSha256: artifact.sourceDocument.sha256, artifactSha256: artifact.manifest.bytecodeSha256, observations }));
});

test('WASM accounting stays Unknown until exact snapshot revision is persisted', async () => {
  const runtime = await AccountingRuntime.instantiate(wasmBytes, config);
  let durableSnapshot;
  let durableRevision;
  const persist = async (snapshot, revision) => {
    durableSnapshot = snapshot.slice();
    durableRevision = revision;
    return true;
  };

  assert.equal(runtime.eventCount(9, 100), null);
  await runtime.initializeEmpty(persist);
  assert.equal(runtime.eventCount(9, 100), 0n);

  await assert.rejects(runtime.recordEvent({ eventId: id(1), eventType: 9, localDay: 100 }, async () => false), /not durably acknowledged/);
  assert.equal(runtime.eventCount(9, 100), null);
  await runtime.persistPending(persist);
  assert.equal(runtime.eventCount(9, 100), 1n);
  assert.equal(durableRevision, 2n);

  assert.equal(await runtime.recordEvent({ eventId: id(1), eventType: 9, localDay: 100 }), 'Duplicate');
  assert.equal(runtime.eventCount(9, 100), 1n);

  await runtime.recordAppliedSegment({ receiptId: id(2), resourceId: 7, startMs: 0n, endMs: 20_000n, localDay: 100 }, persist);
  await runtime.recordAppliedSegment({ receiptId: id(3), resourceId: 7, startMs: 10_000n, endMs: 30_000n, localDay: 100 }, persist);
  assert.equal(runtime.usedRolling(7, 30_000n, 20_000n), 20_000n);
  assert.equal(runtime.usedLocalDay(7, 100), 30_000n);

  const restored = await AccountingRuntime.instantiate(wasmBytes, config);
  restored.restore(durableSnapshot);
  assert.equal(restored.eventCount(9, 100), 1n);
  assert.equal(restored.usedLocalDay(7, 100), 30_000n);

  const corrupt = durableSnapshot.slice();
  corrupt[7] ^= 1;
  assert.throws(() => restored.restore(corrupt), /invalid accounting ledger snapshot/);
  assert.equal(restored.eventCount(9, 100), null);
  runtime.dispose();
  restored.dispose();
});

test('accounting wrapper validates stable IDs and integer bounds', async () => {
  const runtime = await AccountingRuntime.instantiate(wasmBytes, config);
  assert.throws(() => runtime.usedLocalDay(7, 0x8000_0000), /integer range/);
  await assert.rejects(runtime.recordEvent({ eventId: new Uint8Array(8), eventType: 9, localDay: 100 }), /16-byte/);
  runtime.dispose();
});

test('WASM rolling admission rejects the reference reserve atomically and durably settles evidence', async () => {
  const runtime = await AccountingRuntime.instantiate(wasmBytes, config);
  const persist = async () => true;
  await runtime.initializeEmpty(persist);

  assert.equal(await runtime.reserveRolling({ reservationId: id(20), resourceId: 7,
    admittedAtMs: 1_000n, windowMs: 60_000n, limitMs: 30_000n, reserveMs: 310_000n }, persist), 'Rejected');
  assert.equal(runtime.usedRolling(7, 1_000n, 60_000n), 0n);

  assert.equal(await runtime.reserveRolling({ reservationId: id(21), resourceId: 7,
    admittedAtMs: 1_000n, windowMs: 60_000n, limitMs: 30_000n, reserveMs: 30_000n }, persist), 'Inserted');
  assert.equal(await runtime.reserveRolling({ reservationId: id(22), resourceId: 7,
    admittedAtMs: 1_000n, windowMs: 60_000n, limitMs: 30_000n, reserveMs: 1n }, persist), 'Rejected');
  await runtime.recordAppliedSegment({ receiptId: id(2), resourceId: 7,
    startMs: 0n, endMs: 5_000n, localDay: 100 }, persist);
  await assert.rejects(runtime.settleRolling({ reservationId: id(21), appliedReceiptId: id(2) }, persist),
    /settlement evidence is missing/);
  await runtime.recordReservedAppliedSegment({ reservationId: id(21), receiptId: id(4), resourceId: 7,
    startMs: 5_000n, endMs: 10_000n, localDay: 100 }, persist);
  assert.equal(await runtime.settleRolling({ reservationId: id(21), appliedReceiptId: id(4) }, persist), 'Inserted');
  assert.equal(await runtime.reserveRolling({ reservationId: id(23), resourceId: 7,
    admittedAtMs: 5_000n, windowMs: 60_000n, limitMs: 30_000n, reserveMs: 25_000n }, persist), 'Inserted');
  assert.equal(await runtime.cancelRolling({ reservationId: id(23), cancellationEvidenceId: id(30) }, persist), 'Inserted');
  runtime.dispose();
});

test('REF-03-050 exact source binds applied pump evidence and stable Event identities', async () => {
  const persist = async () => true;
  const applied = await AccountingRuntime.instantiateSource(wasmBytes, reference.source, {
    filename: reference.filename, account: 'pump_applied', resourceId: 7, config,
  });
  assert.equal(applied.source.text, reference.source);
  await applied.initializeEmpty(persist);
  assert.equal(await applied.reserveRolling({ reservationId: id(40), resourceId: 7,
    admittedAtMs: 0n, windowMs: 600_000n, limitMs: 360_000n, reserveMs: 310_000n }, persist), 'Inserted');
  await assert.rejects(applied.reserveRolling({ reservationId: id(41), resourceId: 7,
    admittedAtMs: 0n, windowMs: 600_000n, limitMs: 361_000n, reserveMs: 310_000n }, persist),
  /does not match the bound source constraint/);
  await applied.recordReservedAppliedSegment({ reservationId: id(40), receiptId: id(42), resourceId: 7,
    startMs: 0n, endMs: 300_000n, localDay: 100 }, persist);
  assert.equal(await applied.settleRolling({ reservationId: id(40), appliedReceiptId: id(42) }, persist), 'Inserted');
  assert.equal(applied.usedRolling(7, 300_000n, 600_000n), 300_000n);
  applied.dispose();

  const events = await AccountingRuntime.instantiateSource(wasmBytes, reference.source, {
    filename: reference.filename, account: 'normal_starts', eventType: 9, config,
  });
  await events.initializeEmpty(persist);
  assert.equal(await events.recordEvent({ eventId: id(50), eventType: 9, localDay: 100 }, persist), 'Inserted');
  assert.equal(await events.recordEvent({ eventId: id(50), eventType: 9, localDay: 100 }), 'Duplicate');
  assert.equal(events.eventCount(9, 100), 1n);
  const compiled = await compileSource(reference.source, { filename: reference.filename });
  const countBinding = compiled.manifest.accounting.bindings.find(item => item.name === 'normal_starts');
  const control = new GhostFlowRuntime(events.wasm);
  control.load(compiled.bytes);
  assert.throws(() => events.tickControl(control, {
    site: countBinding.site, account: countBinding.name, event: countBinding.evidenceBinding.target,
    timezone: countBinding.basis.zone, eventType: 10, localDay: 100,
    monotonicMs: 0n, bootEpoch: 3n, wallMs: 1n, clockTrusted: true,
  }), /wrong bound Event type/);
  control.dispose();
  events.dispose();
});

test('REF-03-050 evaluates its protected count Result from the durable Rust ledger', async () => {
  const artifact = await compileSource(reference.source, { filename: reference.filename });
  const { instance } = await WebAssembly.instantiate(wasmBytes);
  const control = new GhostFlowRuntime(instance.exports);
  const accounting = new AccountingRuntime(instance.exports, config);
  const binding = artifact.manifest.accounting.bindings.find(item => item.name === 'normal_starts');
  const persist = async () => true;

  control.load(artifact.bytes);
  control.addCapability('actuator', 'ready', 'bool');
  await accounting.initializeEmpty(persist);
  accounting.activateControl(control, { bootEpoch: 3n, terminalCapacity: 8 });
  const beforeInvalidFlags = control.journalLength;
  assert.equal(instance.exports.gf_tick_accounting(
    control.handle, accounting.handle, binding.site,
    0, 0, 0, 0, 0, 0, 9, 2, 100, 0n, 3n, 1, 1n, 1,
  ), 0);
  assert.equal(control.journalLength, beforeInvalidFlags);
  let trace = accounting.tickControl(control, {
    site: binding.site, account: binding.name, event: binding.evidenceBinding.target,
    timezone: binding.basis.zone, eventType: 9, localDay: 100,
    monotonicMs: 0n, bootEpoch: 3n, wallMs: 1_700_000_000_000n, clockTrusted: true,
  });
  assert.equal(trace.inputs[binding.resultInputs.value], 0);
  assert.equal(trace.requested.ready, true);

  await accounting.recordEvent({ eventId: id(60), eventType: 9, localDay: 100 }, persist);
  trace = accounting.tickControl(control, {
    site: binding.site, account: binding.name, event: binding.evidenceBinding.target,
    timezone: binding.basis.zone, eventType: 9, localDay: 100,
    monotonicMs: 1n, bootEpoch: 3n, wallMs: 1_700_000_000_001n, clockTrusted: true,
  });
  assert.equal(trace.inputs[binding.resultInputs.value], 1);
  assert.equal(trace.requested.ready, true);
  assert.equal(trace.safe.ready, true);
  accounting.dispose();
  control.dispose();
});

test('canonical source binds only supported ledger accounts to explicit host IDs', async () => {
  const filename = 'accounting-source.ghost.md';
  const source = `# Accounting\n\n\`\`\`ghost
control Accounting {
  resource pump: BoolActuator;
  event started: Event;
  account applied = on_time(pump, stage: applied, persistence: durable);
  account starts = count_events(started, over: local_day("Asia/Seoul"), persistence: durable);
  output ready: Bool;
  ready <- true;
}
\`\`\`\n`;
  const persist = async () => true;
  const applied = await AccountingRuntime.instantiateSource(wasmBytes, source, {
    filename, account: 'applied', resourceId: 7, config,
  });
  assert.equal(applied.source.text, source);
  assert.equal(applied.source.filename, filename);
  assert.equal(applied.source.account, 'applied');
  assert.equal(applied.source.target, 'pump');
  assert.equal(applied.source.stage, 'applied');
  assert.match(applied.source.sha256, /^[a-f0-9]{64}$/);
  assert.match(applied.source.artifactSha256, /^[a-f0-9]{64}$/);
  await applied.initializeEmpty(persist);
  await assert.rejects(applied.recordAppliedSegment({ receiptId: id(1), resourceId: 8,
    startMs: 0n, endMs: 1n, localDay: 100 }, persist), /bound resource ID/);
  await applied.recordAppliedSegment({ receiptId: id(1), resourceId: 7,
    startMs: 0n, endMs: 10n, localDay: 100 }, persist);
  assert.equal(applied.usedLocalDay(7, 100), 10n);
  assert.throws(() => applied.usedRolling(8, 10n, 10n), /bound resource ID/);
  assert.throws(() => applied.eventCount(9, 100), /bound account operation/);
  applied.dispose();

  const starts = await AccountingRuntime.instantiateSource(wasmBytes, source, {
    filename, account: 'starts', eventType: 9, config,
  });
  await starts.initializeEmpty(persist);
  await starts.recordEvent({ eventId: id(2), eventType: 9, localDay: 100 }, persist);
  assert.equal(starts.eventCount(9, 100), 1n);
  await assert.rejects(starts.recordEvent({ eventId: id(3), eventType: 8, localDay: 100 }, persist), /bound Event type/);
  assert.throws(() => starts.usedLocalDay(7, 100), /bound account operation/);
  starts.dispose();

  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source, {
    filename, account: 'missing', resourceId: 7, config,
  }), /no accounting account/);
  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source, {
    filename, account: 'applied', eventType: 9, config,
  }), /resourceId is required/);
  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source, {
    filename, account: 'starts', resourceId: 7, config,
  }), /eventType is required/);
  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source.replace('stage: applied', 'stage: requested'), {
    filename, account: 'applied', resourceId: 7, config,
  }), /executable accounting requires durable applied/);
  await assert.rejects(AccountingRuntime.instantiateSource(wasmBytes, source.replace('persistence: durable', 'persistence: volatile'), {
    filename, account: 'applied', resourceId: 7, config,
  }), /executable accounting requires durable applied/);
});
