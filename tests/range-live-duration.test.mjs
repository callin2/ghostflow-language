import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const nativePath = path.join(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`);
const activation = { bootEpoch: 1, terminalCapacity: 64, bindings: [] };
const day = Date.UTC(2026, 0, 1);
const hour = 3_600_000;

const source = `# Live Range duration\n\n\`\`\`ghost\ncontrol LiveRangeDuration {\n  config duration: Duration = 10min { min = 5min; max = 20min; step = 1min; access = operator; }\n  schedule watering: DailySlots<15min> {\n    timezone = "UTC";\n    selected = [08:00];\n    dst_missing = skip;\n    dst_repeated = first;\n    basis = range(duration);\n    when = true;\n    cancel_when = false;\n    clock = trusted_only;\n    gap = skip_after(60s);\n    recovery = baseline;\n    fallback = skip;\n  }\n  output pump: Bool;\n  pump <- watering.active;\n}\n\`\`\`\n`;

function facts(site, mono, wall, settings = null, trusted = true) {
  return { clock: { monotonicMs: mono, bootEpoch: 1, wallMs: wall, uncertaintyMs: 0,
    trusted, unknownReason: trusted ? null : 'ClockUnknown', sourceRevision: 'range-live-duration-v1' },
  natural: [], schedules: [{ site, coverageStartMs: 0, coverageEndMs: 253402300799999,
    provider: null, calendar: null, rows: [] }], settings };
}

function event(fingerprint, configId, eventId, baseRevision, position, value) {
  return { programFingerprint: fingerprint, eventId, baseRevision, position, origin: 'operatorEdit',
    changes: [{ configId, result: { ok: true, type: 'Duration', value } }] };
}

function clone(value) { return structuredClone(value); }

async function liveArtifact(sourceText = source) {
  const artifact = await compileSource(sourceText, { filename: 'range-live-duration.ghost.md' });
  assert.equal(artifact.bytes.readUInt16LE(4), 12);
  assert.equal(artifact.manifest.schedules[0].policy.basis.durationConfig, 'duration');
  return artifact;
}

async function assertNativeCheckpointRejected(artifact, checkpointHex, match = /Range|checkpoint|invalid|truncated bytecode/i) {
  const site = artifact.manifest.schedules[0].site;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-range-live-checkpoint-'));
  try {
    const artifactPath = path.join(dir, 'module.gfb');
    const tapePath = path.join(dir, 'tape.json');
    fs.writeFileSync(artifactPath, artifact.bytes);
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-civil-v1', activation, checkpoint: checkpointHex,
      steps: [{ scanId: 0, logicalTimeMs: 0, inputs: [], ...facts(site, 0, day + 8 * hour) }] }));
    const native = spawnSync(nativePath, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
    assert.notEqual(native.status, 0, 'native restore must reject malformed checkpoint');
    assert.match(native.stderr || native.stdout, match, native.stderr || native.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function run(steps, { sourceText = source, checkpoint = null } = {}) {
  const artifact = await liveArtifact(sourceText);
  const site = artifact.manifest.schedules[0].site;
  const probe = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
  const fingerprint = probe.contextSnapshot().state.programFingerprint;
  probe.dispose();
  const frames = steps.map((step, scanId) => ({ scanId: step.scanId ?? scanId, logicalTimeMs: step.mono, inputs: [],
    ...facts(site, step.mono, step.wall, step.settings?.(fingerprint, artifact.manifest.configs[0].id), step.trusted ?? true) }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-range-live-duration-'));
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
  if (checkpoint) runtime.restoreContextCheckpoint(Buffer.from(checkpoint, 'hex'));
  try {
    const artifactPath = path.join(dir, 'module.gfb');
    const tapePath = path.join(dir, 'tape.json');
    fs.writeFileSync(artifactPath, artifact.bytes);
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-civil-v1', activation, steps: frames, checkpoint }));
    const native = spawnSync(nativePath, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(native.status, 0, native.stderr || native.stdout);
    const rows = native.stdout.trim().split('\n').map(line => JSON.parse(line));
    const wasmRows = frames.map(frame => {
      try {
        const step = runtime.step({ nowMs: frame.logicalTimeMs, inputs: {}, contextFacts: facts(site, frame.logicalTimeMs, frame.clock.wallMs, frame.settings, frame.clock.trusted) });
        return { accepted: true, vm: step.vm, checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex'), settings: runtime.contextSnapshot().state };
      } catch (error) {
        return { accepted: false, error: error.message, checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex'), settings: runtime.contextSnapshot().state };
      }
    });
    rows.forEach((row, i) => {
      assert.equal(row.accepted, wasmRows[i].accepted, `native/WASM acceptance ${i}: native=${row.error ?? 'accepted'} wasm=${wasmRows[i].error ?? 'accepted'}`);
      if (row.accepted) {
        assert.deepEqual(row.outcome.trace, wasmRows[i].vm, `native/WASM trace ${i}`);
        assert.equal(row.checkpoint, wasmRows[i].checkpoint, `native/WASM checkpoint ${i}`);
      } else {
        assert.match(wasmRows[i].error, new RegExp(row.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `native/WASM error ${i}`);
        assert.equal(row.checkpoint, wasmRows[i].checkpoint, `rejected native/WASM checkpoint ${i}`);
        if (i > 0) assert.equal(row.checkpoint, rows[i - 1].checkpoint, 'rejection leaves complete context checkpoint unchanged');
      }
    });
    return { artifact, native: rows, wasm: wasmRows };
  } finally {
    runtime.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const decisions = row => row.outcome.trace.contextTrace.map(entry => entry.decision).filter(decision => !decision.startsWith('Settings') && decision !== 'ObservationGap');
const ids = row => row.outcome.trace.contextTrace.filter(entry => entry.occurrenceId && !entry.decision.startsWith('Settings')).map(entry => entry.occurrenceId);

const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function fixCheckpointChecksum(buffer) {
  buffer.writeUInt32LE(crc32(buffer.subarray(0, -4)), buffer.length - 4);
  return buffer;
}

test('REF-03-076 live Range duration extension and reduction retime same occurrence without new due', async () => {
  const start = day + 8 * hour;
  const extend = await run([
    { mono: 0, wall: start + 4 * 60_000 },
    { mono: 180_000, wall: start + 7 * 60_000, settings: (fp, id) => event(fp, id, 'extend-to-12m', 0, 2, 12 * 60_000) },
    { mono: 479_999, wall: start + 11 * 60_000 + 59_999 },
    { mono: 480_000, wall: start + 12 * 60_000 },
  ]);
  assert.deepEqual(extend.native.map(row => row.outcome.trace.safe.pump), [true, true, true, false]);
  assert.deepEqual(decisions(extend.native[0]).filter(d => d !== 'ObservationGap'), ['Due']);
  assert.deepEqual(decisions(extend.native[1]), ['Active']);
  assert.deepEqual(decisions(extend.native[2]), ['Active']);
  assert.deepEqual(decisions(extend.native[3]), ['Completed']);
  assert.equal(extend.native.flatMap(decisions).filter(d => d === 'Due').length, 1);
  assert.deepEqual(new Set(extend.native.flatMap(ids)).size, 1, 'occurrence id is immutable across extension');
  assert.equal(extend.native[1].settings.settingsRevision, 1);
  assert.deepEqual(extend.native[1].settings.settings[0].result, { ok: true, value: 720_000 });

  const reduce = await run([
    { mono: 0, wall: start + 4 * 60_000 },
    { mono: 180_000, wall: start + 7 * 60_000, settings: (fp, id) => event(fp, id, 'reduce-to-5m', 0, 2, 5 * 60_000) },
    { mono: 180_001, wall: start + 7 * 60_000 + 1 },
  ]);
  assert.deepEqual(reduce.native.map(row => row.outcome.trace.safe.pump), [true, false, false]);
  assert.deepEqual(decisions(reduce.native[1]), ['Completed']);
  assert.equal(reduce.native.flatMap(decisions).filter(d => d === 'Due').length, 1);
  assert.deepEqual(new Set(reduce.native.flatMap(ids)).size, 1, 'occurrence id is immutable across reduction');
  assert.equal(reduce.native[1].settings.settingsRevision, 1);
  assert.deepEqual(reduce.native[1].settings.settings[0].result, { ok: true, value: 300_000 });
});

test('REF-03-076 accepted out-of-bounds payload advances revision onto SettingsInvalid without readmission', async () => {
  const start = day + 8 * hour;
  const rows = await run([
    { mono: 0, wall: start + 4 * 60_000 },
    { mono: 180_000, wall: start + 7 * 60_000, settings: (fp, id) => event(fp, id, 'reject-out-of-range', 0, 2, 4 * 60_000) },
    { mono: 359_999, wall: start + 9 * 60_000 + 59_999 },
    { mono: 360_000, wall: start + 10 * 60_000 },
  ]);
  assert.deepEqual(rows.native.map(row => row.accepted), [true, true, true, true]);
  assert.deepEqual(rows.native.map(row => row.outcome.trace.safe.pump), [true, false, false, false]);
  assert.equal(rows.native[1].settings.settingsRevision, 1);
  assert.deepEqual(rows.native[1].settings.settings[0].result, { ok: false, fault: 'SettingsInvalid' });
  assert.deepEqual(decisions(rows.native[1]), ['Unknown(SettingsInvalid)']);
  assert.equal(rows.native.flatMap(decisions).filter(d => d === 'Due').length, 1);
  assert.deepEqual(new Set(rows.native.flatMap(ids)).size, 1, 'settings fault does not change occurrence id');
});

test('REF-03-076 accepted duration persists to checkpoint and next occurrence', async () => {
  const start = day + 8 * hour;
  const first = await run([
    { mono: 0, wall: start + 4 * 60_000 },
    { mono: 180_000, wall: start + 7 * 60_000, settings: (fp, id) => event(fp, id, 'persist-12m', 0, 2, 12 * 60_000) },
    { mono: 480_000, wall: start + 12 * 60_000 },
  ]);
  assert.deepEqual(first.native.map(row => row.outcome.trace.safe.pump), [true, true, false]);
  const checkpoint = first.native.at(-1).checkpoint;
  const next = await run([
    { mono: 0, wall: start + 24 * hour + 11 * 60_000 + 59_999 },
    { mono: 1, wall: start + 24 * hour + 12 * 60_000 },
  ], { checkpoint });
  assert.deepEqual(next.native.map(row => row.outcome.trace.safe.pump), [true, false]);
  assert.deepEqual(decisions(next.native[0]), ['Due']);
  assert.deepEqual(decisions(next.native[1]), ['Completed']);
  assert.deepEqual(next.native[0].settings.settings[0].result, { ok: true, value: 720_000 });
});

test('REF-03-076 retimes active occurrence after cross-date or untrusted wall correction', async () => {
  const start = day + 8 * hour;
  const rows = await run([
    { mono: 0, wall: start + 4 * 60_000 },
    { mono: 180_000, wall: start - 24 * hour, settings: (fp, id) => {
      const e = event(fp, id, 'cross-date-12m', 0, 2, 12 * 60_000);
      return e;
    } },
    { mono: 479_999, wall: start - 24 * hour + 1, trusted: false },
    { mono: 480_000, wall: start + 12 * 60_000 },
  ]);
  assert.deepEqual(rows.native.map(row => row.outcome.trace.safe.pump), [true, true, true, false]);
  assert.deepEqual(decisions(rows.native[1]), ['Active']);
});

test('REF-03-076 accepted duration during ClockUnknown retimes the already active occurrence', async () => {
  const start = day + 8 * hour;
  const rows = await run([
    { mono: 0, wall: start + 4 * 60_000 },
    { mono: 180_000, wall: start - 7 * 24 * hour, trusted: false, settings: (fp, id) => event(fp, id, 'unknown-clock-12m', 0, 2, 12 * 60_000) },
    { mono: 479_999, wall: start - 7 * 24 * hour + 1, trusted: false },
    { mono: 480_000, wall: start + 12 * 60_000 },
  ]);
  assert.deepEqual(rows.native.map(row => row.accepted), [true, true, true, true]);
  assert.deepEqual(rows.native.map(row => row.outcome.trace.safe.pump), [true, true, true, false]);
  assert.deepEqual(decisions(rows.native[1]), ['Active']);
  assert.deepEqual(decisions(rows.native[2]), ['Active']);
  assert.deepEqual(decisions(rows.native[3]), ['Completed']);
  assert.equal(rows.native.flatMap(decisions).filter(d => d === 'Due').length, 1, 'ClockUnknown settings must not admit a second Due');
  assert.deepEqual(new Set(rows.native.flatMap(ids)).size, 1, 'ClockUnknown retime preserves occurrence id');
  assert.equal(rows.native[1].settings.settingsRevision, 1);
  assert.deepEqual(rows.native[1].settings.settings[0].result, { ok: true, value: 720_000 });
});

test('REF-03-076 malformed Range duration metadata rejects framed instantiation', async () => {
  const artifact = await liveArtifact();
  const mutations = [
    ['missing name', manifest => { delete manifest.schedules[0].policy.basis.durationConfig; }, /name and id together/],
    ['missing id', manifest => { delete manifest.schedules[0].policy.basis.durationConfigId; }, /name and id together/],
    ['invalid name type', manifest => { manifest.schedules[0].policy.basis.durationConfig = 7; }, /durationConfig/],
    ['mismatched name', manifest => { manifest.schedules[0].policy.basis.durationConfig = 'other'; }, /metadata mismatch/],
    ['mismatched id', manifest => { manifest.schedules[0].policy.basis.durationConfigId += 99; }, /metadata mismatch/],
    ['wrong typed config', manifest => { manifest.configs[0].type = 'Bool'; manifest.configs[0].value = false; delete manifest.configs[0].settings.min; delete manifest.configs[0].settings.max; delete manifest.configs[0].settings.step; }, /metadata mismatch|Duration/],
    ['missing descriptor', manifest => { manifest.configs = []; }, /metadata mismatch/],
    ['initial duration mismatch', manifest => { manifest.schedules[0].policy.basis.durationMs += 60_000; }, /initial value mismatch/],
  ];
  for (const [label, mutate, match] of mutations) {
    const manifest = clone(artifact.manifest);
    mutate(manifest);
    await assert.rejects(() => ControlRuntime.instantiateFramed(wasm, { ...artifact, manifest }, { context: activation }), match, label);
  }
});

test('REF-03-076 GFRG2 checkpoint malformed payloads reject in WASM and native restore', async () => {
  const start = day + 8 * hour;
  const rows = await run([
    { mono: 0, wall: start + 4 * 60_000 },
    { mono: 180_000, wall: start + 7 * 60_000, settings: (fp, id) => event(fp, id, 'checkpoint-12m', 0, 2, 12 * 60_000) },
  ]);
  const artifact = rows.artifact;
  const good = Buffer.from(rows.native.at(-1).checkpoint, 'hex');
  assert.equal(good.subarray(0, 6).toString('latin1'), 'GFCX\x03\x00');
  const marker = good.indexOf(Buffer.from('GFES\x02GFRG\x02', 'latin1'));
  assert.ok(marker > 0, 'wrapped checkpoint contains GFRG2 engine payload');
  const corruptions = [
    ['invalid engine header', buffer => { buffer[marker + 7] = 255; return fixCheckpointChecksum(buffer); }],
    ['missing effective duration payload', buffer => fixCheckpointChecksum(Buffer.concat([buffer.subarray(0, marker + 10), buffer.subarray(marker + 18)]))],
    ['effective duration outside config bounds', buffer => { buffer.writeBigUInt64LE(12_000_000n, marker + 10); return fixCheckpointChecksum(buffer); }],
    ['unexpected duplicate payload', buffer => fixCheckpointChecksum(Buffer.concat([buffer.subarray(0, -4), buffer.subarray(marker + 18, -4), buffer.subarray(-4)]))],
    ['truncation', buffer => buffer.subarray(0, buffer.length - 1)],
    ['trailing bytes', buffer => Buffer.concat([buffer, Buffer.from([0])])],
  ];
  for (const [label, mutate] of corruptions) {
    const bad = Buffer.from(good);
    const payload = mutate(bad);
    const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
    try {
      assert.throws(() => runtime.restoreContextCheckpoint(payload), /Range|checkpoint|invalid|trailing|duplicate|corrupt|truncated bytecode/i, label);
    } finally {
      runtime.dispose();
    }
    await assertNativeCheckpointRejected(artifact, payload.toString('hex'));
  }
});

test('REF-03-076 overlapping live duration event is transport-rejected atomically', async () => {
  const overlapping = source.replace('selected = [08:00];', 'selected = [08:00, 08:15];')
    .replace('max = 20min;', 'max = 30min;');
  const start = day + 8 * hour;
  const rows = await run([
    { mono: 0, wall: start + 4 * 60_000 },
    { mono: 180_000, wall: start + 7 * 60_000, settings: (fp, id) => event(fp, id, 'overlap-20m', 0, 2, 20 * 60_000) },
    { scanId: 1, mono: 660_000, wall: start + 15 * 60_000 },
  ], { sourceText: overlapping });
  assert.deepEqual(rows.native.map(row => row.accepted), [true, false, true]);
  assert.match(rows.native[1].error, /overlap/i);
  assert.deepEqual(rows.native[1].settings.settings[0].result, { ok: true, value: 600_000 });
  assert.equal(rows.native[1].settings.settingsRevision, 0);
  assert.deepEqual(rows.native[2].settings.settings[0].result, { ok: true, value: 600_000 });
  assert.equal(rows.native[2].settings.settingsRevision, 0);
  assert.equal(rows.native.flatMap(row => row.accepted ? decisions(row) : []).filter(d => d === 'Due').length, 2);
});

test('REF-03-076 stale revision, wrong event position or wrong source identity rejects unchanged', async () => {
  const start = day + 8 * hour;
  const stale = await run([
    { mono: 0, wall: start + 4 * 60_000 },
    { mono: 180_000, wall: start + 7 * 60_000, settings: (fp, id) => event(fp, id, 'stale-revision', 1, 2, 12 * 60_000) },
  ]);
  assert.deepEqual(stale.native.map(row => row.accepted), [true, false]);
  assert.match(stale.native[1].error, /stale settings transaction/);
  assert.equal(stale.native[1].settings.settingsRevision, 0);
  assert.deepEqual(stale.native[1].settings.settings[0].result, { ok: true, value: 600_000 });

  const wrongPosition = await run([
    { mono: 0, wall: start + 4 * 60_000 },
    { mono: 180_000, wall: start + 7 * 60_000, settings: (fp, id) => event(fp, id, 'wrong-position', 0, 99, 12 * 60_000) },
  ]);
  assert.deepEqual(wrongPosition.native.map(row => row.accepted), [true, false]);
  assert.match(wrongPosition.native[1].error, /stale settings transaction/);
  assert.equal(wrongPosition.native[1].settings.settingsRevision, 0);
  assert.deepEqual(wrongPosition.native[1].settings.settings[0].result, { ok: true, value: 600_000 });

  const wrongSource = await run([
    { mono: 0, wall: start + 4 * 60_000 },
    { mono: 180_000, wall: start + 7 * 60_000, settings: (fp, id) =>
      event((BigInt(`0x${fp}`) ^ 1n).toString(16).padStart(16, '0'), id, 'wrong-source', 0, 2, 12 * 60_000) },
  ]);
  assert.deepEqual(wrongSource.native.map(row => row.accepted), [true, false]);
  assert.match(wrongSource.native[1].error, /stale settings transaction/);
  assert.equal(wrongSource.native[1].settings.settingsRevision, 0);
  assert.deepEqual(wrongSource.native[1].settings.settings[0].result, { ok: true, value: 600_000 });
});

test('REF-03-076 repeated changes and config fault recovery preserve effective duration at next occurrence', async () => {
  const start = day + 8 * hour;
  const rows = await run([
    { mono: 0, wall: start + 4 * 60_000 },
    { mono: 60_000, wall: start + 5 * 60_000, settings: (fp, id) => event(fp, id, 'first-12m', 0, 2, 720_000) },
    { mono: 120_000, wall: start + 6 * 60_000, settings: (fp, id) => event(fp, id, 'second-15m', 1, 3, 900_000) },
    { mono: 180_000, wall: start + 7 * 60_000, settings: (fp, id) => event(fp, id, 'invalid-4m', 2, 4, 240_000) },
    { mono: 240_000, wall: start + 8 * 60_000, settings: (fp, id) => event(fp, id, 'recover-12m', 3, 5, 720_000) },
    { mono: 479_999, wall: start + 12 * 60_000 - 1 },
    { mono: 480_000, wall: start + 12 * 60_000 },
  ]);
  assert.deepEqual(rows.native.map(row => row.outcome.trace.safe.pump), [true, true, true, false, true, true, false]);
  assert.equal(rows.native.flatMap(decisions).filter(d => d === 'Due').length, 1);
  assert.equal(new Set(rows.native.flatMap(ids)).size, 1);
  assert.deepEqual(rows.native.map(row => row.settings.settingsRevision), [0, 1, 2, 3, 4, 4, 4]);
  const checkpoint = rows.native.at(-1).checkpoint;
  const next = await run([
    { mono: 0, wall: start + 11 * 60_000 }, // Fresh owner does not resume consumed same-day interval.
    { mono: 1, wall: start + 24 * hour + 12 * 60_000 - 1 },
    { mono: 2, wall: start + 24 * hour + 12 * 60_000 },
  ], { checkpoint });
  assert.deepEqual(next.native.map(row => row.outcome.trace.safe.pump), [false, true, false]);
  assert.equal(next.native.flatMap(decisions).filter(d => d === 'Due').length, 1);
  assert.deepEqual(next.native[1].settings.settings[0].result, { ok: true, value: 720_000 });
});

test('REF-03-076 compiler rejects zero-min live duration Range but preserves zero-min elapsed Duration config', async () => {
  const zeroMinRange = source.replace('min = 5min;', 'min = 0min;');
  await assert.rejects(() => compileSource(zeroMinRange, { filename: 'range-zero-min-duration.ghost.md' }), /positive minimum Duration/);

  const elapsedTimer = `# Zero-min elapsed timer Duration config\n\n\`\`\`ghost\ncontrol ZeroMinElapsedDuration {\n  config delay: Duration = 10min { min = 0min; max = 20min; step = 1min; access = operator; }\n  output enabled: Bool;\n  enabled <- true;\n}\n\`\`\`\n`;
  const artifact = await compileSource(elapsedTimer, { filename: 'zero-min-elapsed-duration.ghost.md' });
  assert.equal(artifact.manifest.configs[0].settings.min, 0);
});

test('REF-03-076 malformed GFB12 live duration binding rejects in actual native and WASM loaders', async () => {
  const artifact = await liveArtifact(source.replace('  config duration:', '  config other: Bool = true { access = operator; }\n  config duration:'));
  const duration = artifact.manifest.configs.find(item => item.name === 'duration');
  const other = artifact.manifest.configs.find(item => item.name === 'other');
  const pattern = Buffer.alloc(27);
  pattern.writeUInt16LE(3, 0); pattern.write('UTC', 2);
  pattern.writeUInt32LE(duration.id, 13); pattern.writeUInt16LE(1, 17);
  pattern.writeBigUInt64LE(8n * 3_600_000n, 19);
  const offset = artifact.bytes.indexOf(pattern);
  assert.ok(offset >= 0, 'locate encoded zero-duration sentinel and source-bound config id');
  assert.equal(artifact.bytes.indexOf(pattern, offset + 1), -1, 'unambiguous encoded Range descriptor');
  const malformed = [
    ['missing config', bytes => { bytes.writeUInt32LE(0, offset + 13); return bytes; }],
    ['unknown/forward config', bytes => { bytes.writeUInt32LE(0xffffffff, offset + 13); return bytes; }],
    ['wrong typed config', bytes => { bytes.writeUInt32LE(other.id, offset + 13); return bytes; }],
    ['truncated config id', bytes => bytes.subarray(0, offset + 15)],
    ['trailing bytes', bytes => Buffer.concat([bytes, Buffer.from([0])])],
  ];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-range-live-loader-'));
  const runtime = await GhostFlowRuntime.instantiate(wasm);
  try {
    const modulePath = path.join(directory, 'module.gfb'), tapePath = path.join(directory, 'tape.json');
    fs.writeFileSync(tapePath, '{}');
    for (const [label, mutate] of malformed) {
      const bytes = mutate(Buffer.from(artifact.bytes));
      assert.throws(() => runtime.load(bytes), /config|Duration|truncated|trailing|bytecode/i, label);
      fs.writeFileSync(modulePath, bytes);
      const native = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 });
      assert.notEqual(native.status, 0, `native loader ${label}`);
      assert.match(native.stderr || native.stdout, /config|Duration|truncated|trailing|bytecode/i, `actual decoder ${label}`);
    }
  } finally { runtime.dispose(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('REF-03-076 compiler rejects live duration config on calendar Range', async () => {
  const bad = source.replace('schedule watering: DailySlots<15min> {\n    timezone = "UTC";\n    selected = [08:00];', 'calendar workdays: WorkCalendar;\n  schedule watering: Daily {\n    timezone = "UTC";\n    on = day`workday`;\n    calendar = workdays;\n    at = time`08:00`;');
  await assert.rejects(() => compileSource(bad, { filename: 'calendar-live-range.ghost.md' }), /live Range duration settings.*without a work calendar/);
});
