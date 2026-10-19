// Explicit temporal fixture revision: issue531-quality-temporal-v1; predecessor retained in fixtures/history/issue531/temporal.
import assert from 'node:assert/strict';
import { softwareQualityObservations, softwareQualityRails } from './helpers/software-quality-observations.mjs';
const ControlRuntime = {
  instantiate: async (...args) => softwareQualityObservations(await BaseControlRuntime.instantiate(...args)),
  instantiateFramed: async (...args) => softwareQualityObservations(await BaseControlRuntime.instantiateFramed(...args)),
};

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource, restoreArtifactSourceMap } from '../tools/toolchain.mjs';
import { observeSourceTrace } from '../tools/source-trace.mjs';
import { ControlRuntime as BaseControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { solarContextEvidence } from '../runtimes/wasm/context-abi.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const nativePath = path.join(root, 'target/release/examples/context_tape' + (process.platform === 'win32' ? '.exe' : ''));
const fixture = fs.readFileSync(new URL('./fixtures/issue-145-solar-config.input-v1.ghost.md', import.meta.url), 'utf8');
const cases = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url), 'utf8')).cases;
const reference = cases.find(entry => entry.id === 'REF-03-010');
const activation = { bootEpoch: 203, terminalCapacity: 32, bindings: [] };
const startMono = 100_000;
const snapshotMono = 220_000;
const startWall = 700_000;
const rollbackWall = startWall - 600_000;

function clock(monotonicMs, wallMs, trusted, sourceRevision) {
  return { monotonicMs, bootEpoch: activation.bootEpoch, wallMs, uncertaintyMs: trusted ? 0 : 17,
    trusted, unknownReason: trusted ? null : 'WallClockRollbackQualityUnknown', sourceRevision };
}

function facts(compiled, monotonicMs, wallMs, trusted, sourceRevision) {
  return { clock: clock(monotonicMs, wallMs, trusted, sourceRevision), natural: [], schedules: [], settings: null,
    solars: compiled.manifest.schedules.map(schedule => solarContextEvidence(schedule, {
      site: schedule.site,
      coverageFromWallMs: 0,
      coverageToWallMs: 3 * 86_400_000,
      rows: [0, 1, 2].map(sourceDay => ({ sourceDay,
        scheduledWallMs: sourceDay * 86_400_000 + startWall + (schedule.name === 'mirror' ? 120_000 : 0),
        available: true,
        providerRevision: `ref-03-010-solar-${schedule.site}`,
        contextRevision: `ref-03-010-site-${schedule.site}`,
      })),
    })) };
}

function native(t, compiled, steps) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-ref-03-010-native-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'ref-03-010.gfb');
  const tapePath = path.join(directory, 'ref-03-010-tape.json');
  fs.writeFileSync(modulePath, compiled.bytes);
  fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-solar-v1', activation,
    steps: steps.map((step, scanId) => ({ scanId, logicalTimeMs: step.nowMs,
      inputs: Object.entries(softwareQualityRails(compiled, { divisor: 1 }, scanId + 1, step.nowMs)).map(([name, value]) => ({ name, value })), ...step.contextFacts })) }));
  return execFileSync(nativePath, [modulePath, tapePath], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
}

function projection(trace) {
  return { due: trace.safe.due, mirrored: trace.safe.mirrored, active: trace.safe.active,
    elapsedAge: trace.safe.elapsed_age, quotient: trace.safe.quotient };
}

test('REF-03-010: Unknown wall rollback cannot admit a fresh Solar occurrence while monotonic elapsed keeps an active five-minute run', async t => {
  assert.ok(reference, 'REF-03-010 must stay indexed');
  assert.equal(reference.issue, 'https://github.com/callin2/ghostflow-language/issues/203');
  assert.equal(reference.scope, 'host');
  assert.equal(reference.status, 'specified');
  assert.match(reference.references.join('\n'), /03-time-and-schedules\.md#달력-시계와-단조-시계/);
  assert.match(reference.rule, /wall 보정은 단조 타이머를 바꾸지/);

  const source = fixture
    .replaceAll('clock = trusted_only;', 'clock = hold_trusted(2s, terminal: skip);')
    .replaceAll('gap = skip_after(60s);', 'gap = skip_after(180s);');
  const compiled = await compileSource(source, { filename: 'ref-03-010-clock-timer-domain.ghost.md' });
  assert.equal(compiled.manifest.schedules.length, 2, 'fixture exposes two same-source Solar schedules from compilation');
  assert.deepEqual(compiled.manifest.schedules.map(schedule => schedule.policy.clock),
    compiled.manifest.schedules.map(() => ({ kind: 'hold_trusted', durationMs: 2000, terminal: 'skip' })));
  assert.deepEqual(compiled.manifest.schedules.map(schedule => schedule.policy.fallback),
    compiled.manifest.schedules.map(() => 'skip'));
  const durationConfig = compiled.manifest.configs.find(config => config.name === 'duration');
  assert.ok(durationConfig, 'duration config id is derived from compilation');
  assert.equal(durationConfig.value, 300_000, 'fixture keeps canonical five-minute duration');

  const verified = restoreArtifactSourceMap({ format: 'GhostFlow/source-map-v1', bytecodeSha256: compiled.manifest.bytecodeSha256,
    sourceDocument: compiled.sourceDocument, nodes: compiled.sourceMap, lines: compiled.extractionMap,
    traceMetadata: compiled.traceMetadata, interactionSchema: null, interactionSourceIdentity: null }, compiled.bytes,
    { manifest: compiled.manifest });

  const steps = [
    { nowMs: startMono - 1, contextFacts: facts(compiled, startMono - 1, startWall - 1, true, 'ref-03-010-clock-trusted-r1') },
    { nowMs: startMono, contextFacts: facts(compiled, startMono, startWall, true, 'ref-03-010-clock-trusted-r1') },
    { nowMs: snapshotMono, contextFacts: facts(compiled, snapshotMono, rollbackWall, false, 'ref-03-010-clock-unknown-r2') },
  ];
  const executeWasm = async (frames = steps) => {
    const runtime = await ControlRuntime.instantiateFramed(fs.readFileSync(wasmPath), compiled, { context: activation });
    try {
      const rows = frames.map(step => {
        const trace = runtime.step({ ...step, inputs: { divisor: 1 } }).vm;
        return { trace, outcome: structuredClone(runtime.lastFrameOutcome),
          checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex'), snapshot: runtime.contextSnapshot() };
      });
      return rows;
    } finally {
      runtime.dispose();
    }
  };

  const wasmRows = await executeWasm();
  assert.deepEqual(wasmRows.map(row => projection(row.trace)), [
    { due: false, mirrored: false, active: false, elapsedAge: 0, quotient: 1 },
    { due: true, mirrored: false, active: true, elapsedAge: 1, quotient: 1 },
    { due: false, mirrored: false, active: true, elapsedAge: 120_000, quotient: 1 },
  ]);
  assert.equal(wasmRows[2].trace.safe.elapsed_age, snapshotMono - startMono,
    'elapsed(running) is monotonic elapsed from the actual accepted start, not wall delta');
  assert.equal(rollbackWall, startWall - 600_000, 'case supplies the ten-minute wall rollback explicitly');

  const firstAdmission = wasmRows[1].trace.contextTrace.filter(row => row.decision === 'Due');
  assert.deepEqual(firstAdmission.map(row => row.site), [compiled.manifest.schedules.find(s => s.name === 'dawn').site],
    'trusted wall evidence admits dawn while mirror is still a future occurrence');
  assert.deepEqual(firstAdmission.map(row => row.clockSourceRevision),
    ['ref-03-010-clock-trusted-r1']);
  const rollbackObservations = wasmRows[2].trace.contextTrace
    .filter(row => compiled.manifest.schedules.some(schedule => schedule.site === row.site));
  assert.equal(rollbackObservations.some(row => row.decision === 'Due'), false,
    'Unknown wall quality at the rollback snapshot admits no fresh wall occurrence');
  assert.ok(rollbackObservations.some(row => /ClockUnknown|WallClockRollbackQualityUnknown/.test(row.decision)),
    JSON.stringify(rollbackObservations));
  assert.equal(rollbackObservations.some(row => row.clockProvenance === 'HeldClock'), false,
    '120s exceeds the authored 2s hold_trusted grace, so fallback terminal skip is observable instead of hidden grace');
  assert.ok(rollbackObservations.every(row => row.contextRevision === 'ref-03-010-clock-unknown-r2'
    || row.clockSourceRevision === 'ref-03-010-clock-unknown-r2'
    || row.unknownReason === 'WallClockRollbackQualityUnknown'
    || row.decision === 'AlreadyTerminal'), JSON.stringify(rollbackObservations));
  for (const trace of wasmRows.map(row => row.trace)) {
    const sourceObservation = observeSourceTrace(verified.traceMetadata, trace);
    assert.equal(sourceObservation.sourceDocumentSha256, compiled.sourceDocument.sha256);
    assert.equal(sourceObservation.bytecodeSha256, compiled.manifest.bytecodeSha256);
    assert.equal(trace.module, compiled.traceMetadata.moduleFingerprint);
  }

  const nativeRows = native(t, compiled, steps);
  assert.deepEqual(nativeRows.map(row => row.accepted), [true, true, true]);
  assert.deepEqual(nativeRows.map(row => row.outcome.trace), wasmRows.map(row => row.trace),
    'native context_tape and WASM host expose full outcome parity at the host snapshot boundary');
  assert.deepEqual(nativeRows.map(row => row.outcome), wasmRows.map(row => row.outcome));
  assert.deepEqual(nativeRows.map(row => row.settings), wasmRows.map(row => row.snapshot.state));
  assert.deepEqual(nativeRows.map(row => row.checkpoint), wasmRows.map(row => row.checkpoint),
    'durable snapshots are immutable replay inputs tied to the same activation identity');
  assert.deepEqual((await executeWasm()).map(row => row.trace), wasmRows.map(row => row.trace),
    'fresh WASM activation replays finite facts without handwritten model state');

  const trustedFrames = [...steps.slice(0, 2), { nowMs: snapshotMono,
    contextFacts: facts(compiled, snapshotMono, startWall + 120_000, true, 'ref-03-010-clock-trusted-r1') }];
  const trustedRows = await executeWasm(trustedFrames);
  assert.equal(trustedRows[2].trace.safe.mirrored, true,
    'positive control: the fresh mirror occurrence is due at extrapolated trusted time');
  assert.deepEqual(native(t, compiled, trustedFrames).map(row => row.outcome), trustedRows.map(row => row.outcome));

  const heldFrames = [...steps.slice(0, 2), ...[1_999, 2_000].map(delta => ({ nowMs: startMono + delta,
    contextFacts: facts(compiled, startMono + delta, rollbackWall, false, 'ref-03-010-clock-unknown-r2') }))];
  for (const frame of heldFrames) {
    const mirror = compiled.manifest.schedules.find(s => s.name === 'mirror');
    for (const row of frame.contextFacts.solars.find(s => s.site === mirror.site).rows) row.scheduledWallMs -= 118_001;
  }
  const heldRows = await executeWasm(heldFrames);
  const scheduleRows = row => row.trace.contextTrace.filter(e => compiled.manifest.schedules.some(s => s.site === e.site));
  assert.ok(scheduleRows(heldRows[2]).some(e => e.clockProvenance === 'HeldClock' && e.clockSourceRevision === 'ref-03-010-clock-trusted-r1'));
  assert.equal(scheduleRows(heldRows[3]).some(e => e.clockProvenance === 'HeldClock'), false,
    'the selected hold ends at its exact authored boundary');
  assert.deepEqual(native(t, compiled, heldFrames).map(row => row.outcome), heldRows.map(row => row.outcome));
});
