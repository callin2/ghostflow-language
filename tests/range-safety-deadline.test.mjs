import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const activation = { bootEpoch: 1, terminalCapacity: 64, bindings: [] };
const day = Date.UTC(2026, 0, 1);
const minute = 60_000;
const morning = day + 8 * 60 * minute;

function source() {
  return `# REF-03-075 Range safety deadline

<!-- ghostflow:anchor id=GF-ISSUE-264-REF-03-075 kind=intent status=confirmed origin=user -->
An 08:00 UTC range(10min) keeps its planned deadline while a safety input blocks the safe output.

\`\`\`ghost
control PlannedRangeSafety {
  input safety_ok: Bool;
  output safety_gate: Bool;
  safety_gate <- safety_ok;

  schedule watering: DailySlots<15min> {
    timezone = "UTC";
    selected = [08:00];
    dst_missing = skip;
    dst_repeated = first;
    basis = range(10min);
    when = true;
    cancel_when = false;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }

  output pump: Bool;
  pump <- watering.active;

  require pump => safety_gate;
}
\`\`\`
`;
}

function facts(site, monotonicMs, wallMs) {
  return { clock: { monotonicMs, bootEpoch: 1, wallMs, uncertaintyMs: 0,
    trusted: true, unknownReason: null, sourceRevision: 'issue-264-ref-03-075' },
  natural: [], schedules: [{ site, coverageStartMs: 0, coverageEndMs: 253402300799999,
    provider: null, calendar: null, rows: [] }], settings: null };
}

function rangeDecisions(trace) {
  return (trace.contextTrace ?? [])
    .filter(row => row.site !== undefined && row.decision !== 'ObservationGap')
    .map(row => row.decision);
}

test('REF-03-075: fixed Range deadline survives safety blocking in native context tape and framed WASM', async () => {
  const artifact = await compileSource(source(), { filename: 'range-safety-deadline.ghost.md' });
  assert.equal(artifact.bytes.readUInt16LE(4), 12, 'test must exercise executable GFB12 UTC Range bytecode');
  const site = artifact.manifest.schedules[0].site;
  const steps = [
    { mono: 0, wall: morning + 4 * minute, safety_ok: true },
    { mono: 2 * minute, wall: morning + 6 * minute, safety_ok: false },
    { mono: 3 * minute, wall: morning + 7 * minute, safety_ok: false },
    { mono: 4 * minute, wall: morning + 8 * minute, safety_ok: true },
    { mono: 5 * minute + 59_999, wall: morning + 9 * minute + 59_999, safety_ok: true },
    { mono: 6 * minute, wall: morning + 10 * minute, safety_ok: true },
  ];
  const expected = [
    { requested: true, safe: true, decisions: ['Due'] },
    { requested: true, safe: false, decisions: ['Active'] },
    { requested: true, safe: false, decisions: ['Active'] },
    { requested: true, safe: true, decisions: ['Active'] },
    { requested: true, safe: true, decisions: ['Active'] },
    { requested: false, safe: false, decisions: ['Completed'] },
  ];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-range-safety-'));
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
  try {
    const artifactPath = path.join(dir, 'range-safety.gfb');
    const tapePath = path.join(dir, 'tape.json');
    writeArtifact(artifact, artifactPath);
    const frames = steps.map(({ mono, wall, safety_ok }, scanId) => ({
      scanId, logicalTimeMs: mono,
      inputs: [{ name: 'safety_ok', type: 'Bool', value: safety_ok }],
      ...facts(site, mono, wall),
    }));
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-civil-v1', activation, steps: frames }));
    const exe = path.join(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`);
    const native = spawnSync(exe, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(native.status, 0, native.error?.message || native.stderr || native.stdout || 'native context_tape failed');
    const nativeRows = native.stdout.trim().split('\n').map(row => JSON.parse(row));
    assert.equal(nativeRows.length, steps.length, 'native context tape executes every safety and deadline frame');

    const wasmRows = steps.map(({ mono, wall, safety_ok }) => {
      const outcome = runtime.step({ nowMs: mono, inputs: { safety_ok }, contextFacts: facts(site, mono, wall) });
      return { outcome, checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex') };
    });
    assert.equal(new Set(wasmRows.map(row => row.checkpoint)).size, 1,
      'safety blocking, recovery and completion retain the same consumed occurrence checkpoint');

    nativeRows.forEach((row, index) => {
      assert.equal(row.accepted, true, `native frame ${index} accepted`);
      const trace = wasmRows[index].outcome.vm;
      assert.deepEqual(row.outcome.trace, trace, `native/WASM full VM trace equality frame ${index}`);
      assert.equal(row.checkpoint, wasmRows[index].checkpoint, `per-tick durable checkpoint equality frame ${index}`);
      assert.equal(trace.requested.pump, expected[index].requested, `requested pump frame ${index}`);
      assert.equal(trace.safe.pump, expected[index].safe, `safe pump frame ${index}`);
      assert.equal(trace.safe.safety_gate, steps[index].safety_ok, `host supplies only the safety fact frame ${index}`);
      assert.deepEqual(rangeDecisions(trace), expected[index].decisions, `Range decision frame ${index}`);
    });

    assert.equal(nativeRows.flatMap(row => rangeDecisions(row.outcome.trace)).filter(decision => decision === 'Due').length, 1,
      'safety recovery resumes without a new due/admission');
    const due = nativeRows[0].outcome.trace.contextTrace.find(row => row.decision === 'Due');
    const active = nativeRows[3].outcome.trace.contextTrace.find(row => row.decision === 'Active');
    const completed = nativeRows[5].outcome.trace.contextTrace.find(row => row.decision === 'Completed');
    assert.ok(due?.occurrenceId, 'Range admission records immutable occurrence identity');
    assert.equal(active?.occurrenceId, due.occurrenceId, 'blocked and recovered ticks keep the same occurrence identity');
    assert.equal(completed?.occurrenceId, due.occurrenceId, 'planned endpoint completes the same occurrence');
    assert.equal(completed.plannedWallMs, morning, 'deadline remains tied to the 08:00 planned start');
    assert.equal(nativeRows[5].outcome.trace.requested.pump, false, 'half-open endpoint is off exactly at 08:10');
  } finally {
    runtime.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
