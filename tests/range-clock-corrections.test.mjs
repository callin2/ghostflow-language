import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { dailySlotsRange } from './helpers/range-source.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasmPath = path.join(root, 'target', 'wasm32-unknown-unknown', 'release', 'ghostflow_wasm.wasm');
const nativePath = path.join(root, 'target', 'release', 'examples', process.platform === 'win32' ? 'context_tape.exe' : 'context_tape');
const wasm = fs.readFileSync(wasmPath);
const activation = { bootEpoch: 1, terminalCapacity: 64, bindings: [] };
const day = Date.UTC(2026, 0, 1);
const hour = 3_600_000;
const minute = 60_000;

function facts(site, monotonicMs, wallMs) {
  return { clock: { monotonicMs, bootEpoch: 1, wallMs, uncertaintyMs: 0, trusted: true,
    unknownReason: null, sourceRevision: 'issue-263-range-clock-corrections' }, natural: [],
  schedules: [{ site, coverageStartMs: 0, coverageEndMs: 253402300799999,
    provider: null, calendar: null, rows: [] }], settings: null };
}

function occurrenceIds(trace) {
  return trace.contextTrace.map(observation => observation.occurrenceId);
}

function dueObservations(trace) {
  return trace.contextTrace.filter(observation => observation.decision === 'Due');
}

async function runClockCorrectionCase({ label, correctedWall }) {
  const source = dailySlotsRange({ selected: '[08:00]', duration: '10min' });
  const artifact = await compileSource(source, { filename: `issue-263-${label}.ghost.md` });
  assert.equal(artifact.bytes.readUInt16LE(4), 12, 'checked source compiles as executable GFB12 Range');
  const site = artifact.manifest.schedules[0].site;
  const steps = [
    { mono: 0, wall: day + 8 * hour + 4 * minute, note: 'admit at trusted wall 08:04' },
    { mono: 3 * minute, wall: correctedWall, note: 'wall correction at monotonic 3min' },
    { mono: 359_999, wall: correctedWall + 179_999, note: 'still active 1ms before monotonic deadline' },
    { mono: 360_000, wall: correctedWall + 180_000, note: 'complete at monotonic deadline' },
    { mono: 360_001, wall: day + 8 * hour + 5 * minute, note: 'return inside consumed interval after completion' },
    { mono: 360_002, wall: day + 8 * hour + 5 * minute, note: 'duplicate trusted observation after any gap baseline' },
  ];
  const frames = steps.map((step, scanId) => ({ scanId, logicalTimeMs: step.mono, inputs: [],
    ...facts(site, step.mono, step.wall) }));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `ghostflow-issue263-${label}-`));
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
  try {
    const artifactPath = path.join(directory, 'range-clock-correction.gfb');
    const tapePath = path.join(directory, 'range-clock-correction-tape.json');
    writeArtifact(artifact, artifactPath);
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-civil-v1', activation, checkpoint: null, steps: frames }));
    const native = spawnSync(nativePath, [artifactPath, tapePath],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(native.status, 0, native.stderr || native.stdout);
    const nativeRows = native.stdout.trim().split('\n').map(row => JSON.parse(row));
    assert.equal(nativeRows.length, steps.length, 'native context_tape ran every exact correction frame');

    const checkpoints = [];
    const wasmRows = steps.map(step => {
      const trace = runtime.step({ nowMs: step.mono,
        contextFacts: facts(site, step.mono, step.wall) }).vm;
      checkpoints.push(Buffer.from(runtime.contextSnapshot().bytes).toString('hex'));
      return trace;
    });
    assert.deepEqual(wasmRows.map(row => row.safe.pump), [true, true, true, false, false, false],
      `${label}: active through 359999ms and complete at 360000ms`);
    nativeRows.forEach((row, index) => {
      assert.equal(row.accepted, true, `${label}: native frame ${index} accepted (${steps[index].note})`);
      assert.deepEqual(row.outcome.trace, wasmRows[index], `${label}: native/WASM full VM trace parity frame ${index}`);
      assert.equal(row.checkpoint, checkpoints[index], `${label}: native/WASM durable checkpoint parity frame ${index}`);
    });
    assert.equal(new Set(checkpoints).size, 1, `${label}: consumed occurrence checkpoint is unchanged by corrections or completion`);
    assert.deepEqual(wasmRows.map(row => row.contextTrace.map(observation => observation.decision)),
      [['Due'], ['Active', 'ObservationGap'], ['Active', 'ObservationGap'], ['Completed'],
        [label === 'backward' ? 'ObservationGap' : 'AlreadyTerminal'], ['AlreadyTerminal']],
      `${label}: monotonic completion and durable no-readmission decisions`);

    const due = wasmRows.flatMap(dueObservations);
    assert.equal(due.length, 1, `${label}: 08:04 admission emits exactly one due observation`);
    assert.equal(due[0].plannedWallMs, day + 8 * hour, `${label}: due is for planned 08:00 occurrence`);
    const identities = wasmRows.flatMap(occurrenceIds).filter(Boolean);
    assert.ok(identities.length > 0, `${label}: schedule ledger exposes occurrence identity`);
    assert.equal(new Set(identities).size, 1, `${label}: occurrence identity remains immutable across correction`);
    assert.deepEqual(wasmRows.map(row => dueObservations(row).length), [1, 0, 0, 0, 0, 0],
      `${label}: no new due on corrected wall recrossing/rollback frames`);
    return { checkpoint: runtime.contextSnapshot().bytes, traces: wasmRows, nativeCheckpoint: nativeRows.at(-1).checkpoint };
  } finally {
    runtime.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('REF-03-074: admitted UTC Range keeps monotonic deadline across ±20min wall corrections', async () => {
  const forward = await runClockCorrectionCase({ label: 'forward', correctedWall: day + 8 * hour + 27 * minute });
  const backward = await runClockCorrectionCase({ label: 'backward', correctedWall: day + 7 * hour + 47 * minute });

  assert.deepEqual(forward.traces.map(trace => trace.safe.pump), backward.traces.map(trace => trace.safe.pump),
    'forward and rollback corrections share the same monotonic active/complete oracle');
  assert.deepEqual(forward.checkpoint, backward.checkpoint,
    'durable context checkpoints are equal for the same consumed occurrence despite opposite wall corrections');
  assert.equal(typeof forward.nativeCheckpoint, 'string', 'native context_tape emitted a durable checkpoint');
  assert.equal(forward.nativeCheckpoint, backward.nativeCheckpoint,
    'native durable checkpoints are also equal across opposite corrections');
});
