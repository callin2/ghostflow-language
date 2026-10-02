import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const nativePath = path.join(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`);
const activation = { bootEpoch: 1, terminalCapacity: 64, bindings: [] };
const day = Date.UTC(2026, 0, 1);
const minute = 60_000;
const hour = 3_600_000;
const DAY = 86_400_000;

const source = `# Live Range start

Issue [#266](https://github.com/callin2/ghostflow-language/issues/266) verifies REF-03-077: a bounded UTC Daily Range start may be edited as a typed TimeOfDay setting while preserving the admitted occurrence identity.

\`\`\`ghost
control LiveRangeStart {
  config start: TimeOfDay = time\`08:00\` { min = time\`08:00\`; max = time\`08:30\`; step = 1min; access = operator; }
  schedule watering: Daily {
    timezone = "UTC";
    at = start;
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
}
\`\`\`
`;

async function artifact(sourceText = source, filename = 'range-live-start.ghost.md') {
  const out = await compileSource(sourceText, { filename });
  out.bytes = Buffer.from(out.bytes);
  assert.equal(out.manifest.bytecodeSha256, sha256Hex(out.bytes));
  assert.equal(out.bytes.readUInt16LE(4), 19);
  assert.equal(out.manifest.format, 'GhostFlow/control-v19');
  assert.equal(out.manifest.schedules[0].policy.basis.startConfig, 'start');
  return out;
}

function facts(site, mono, wall, settings = null, trusted = true) {
  return { clock: { monotonicMs: mono, bootEpoch: 1, wallMs: wall, uncertaintyMs: 0,
    trusted, unknownReason: trusted ? null : 'ClockUnknown', sourceRevision: 'range-live-start-v1' },
  natural: [], schedules: [{ site, coverageStartMs: 0, coverageEndMs: 253402300799999,
    provider: null, calendar: null, rows: [] }], settings };
}

function clone(value) { return structuredClone(value); }

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

function event(fingerprint, configId, eventId, baseRevision, position, value) {
  return { programFingerprint: fingerprint, eventId, baseRevision, position, origin: 'operatorEdit',
    changes: [{ configId, result: { ok: true, type: 'TimeOfDay', value } }] };
}

async function assertNativeCheckpointRejected(compiled, checkpointHex, match = /Range|checkpoint|invalid|truncated bytecode/i) {
  const site = compiled.manifest.schedules[0].site;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-range-live-start-checkpoint-'));
  try {
    const artifactPath = path.join(dir, 'module.gfb');
    const tapePath = path.join(dir, 'tape.json');
    fs.writeFileSync(artifactPath, compiled.bytes);
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-civil-v1', activation, checkpoint: checkpointHex,
      steps: [{ scanId: 0, logicalTimeMs: 0, inputs: [], ...facts(site, 0, day + 8 * hour) }] }));
    const native = spawnSync(nativePath, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
    assert.notEqual(native.status, 0, 'native restore must reject malformed checkpoint');
    assert.match(native.stderr || native.stdout, match, native.stderr || native.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function run(steps, { checkpoint = null, sourceText = source, filename = 'range-live-start.ghost.md', assertAccepted = true } = {}) {
  const a = await artifact(sourceText, filename);
  const site = a.manifest.schedules[0].site;
  const probe = await ControlRuntime.instantiateFramed(wasm, a, { context: activation });
  const fingerprint = probe.contextSnapshot().state.programFingerprint;
  probe.dispose();
  const frames = steps.map((step, scanId) => ({ scanId: step.scanId ?? scanId, logicalTimeMs: step.mono, inputs: [],
    ...facts(site, step.mono, step.wall, step.settings?.(fingerprint, a.manifest.configs[0].id), step.trusted ?? true) }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-range-live-start-'));
  const runtime = await ControlRuntime.instantiateFramed(wasm, a, { context: activation });
  if (checkpoint) runtime.restoreContextCheckpoint(Buffer.from(checkpoint, 'hex'));
  try {
    const artifactPath = path.join(dir, 'module.gfb');
    const tapePath = path.join(dir, 'tape.json');
    fs.writeFileSync(artifactPath, a.bytes);
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
      if (assertAccepted) assert.equal(row.accepted, true, JSON.stringify(row));
      assert.equal(row.accepted, wasmRows[i].accepted, `native/WASM acceptance ${i}: ${JSON.stringify(row)}`);
      assert.deepEqual(row.settings, wasmRows[i].settings, `native/WASM settings ${i}`);
      if (row.accepted) {
        assert.deepEqual(row.outcome.trace, wasmRows[i].vm, `native/WASM trace ${i}`);
        assert.equal(row.checkpoint, wasmRows[i].checkpoint, `native/WASM checkpoint ${i}`);
      } else {
        assert.match(row.error, new RegExp(wasmRows[i].error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 24)));
      }
    });
    return rows;
  } finally {
    runtime.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const decisions = row => row.outcome.trace.contextTrace.map(entry => entry.decision).filter(decision => decision !== 'ObservationGap' && !decision.startsWith('Settings'));
const ids = row => row.outcome.trace.contextTrace.filter(entry => entry.occurrenceId && !entry.decision.startsWith('Settings')).map(entry => entry.occurrenceId);

test('REF-03-077 live scalar Range start pauses same occurrence and resumes without readmission', async () => {
  const start = day + 8 * hour;
  const rows = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: 3 * minute, wall: start + 7 * minute,
      settings: (fp, id) => event(fp, id, 'trusted-move-to-0808', 0, 2, 8 * hour + 8 * minute) },
    { mono: 4 * minute, wall: start + 8 * minute },
    { mono: 14 * minute, wall: start + 18 * minute },
  ]);
  assert.deepEqual(rows.map(row => row.outcome.trace.safe.pump), [true, false, true, false]);
  assert.deepEqual(decisions(rows[0]), ['Due']);
  assert.deepEqual(decisions(rows[1]), ['Waiting']);
  assert.deepEqual(decisions(rows[2]), ['Active']);
  assert.deepEqual(decisions(rows[3]), ['Completed']);
  assert.equal(rows.flatMap(decisions).filter(d => d === 'Due').length, 1);
  assert.equal(new Set(rows.flatMap(ids)).size, 1);
});

test('REF-03-077 accepted start after date correction and ClockUnknown retains frozen occurrence', async () => {
  const start = day + 8 * hour;
  const rows = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: minute, wall: start + DAY + 5 * minute },
    { mono: 3 * minute, wall: start + DAY + 7 * minute, trusted: false,
      settings: (fp, id) => event(fp, id, 'move-to-0808', 0, 3, 8 * hour + 8 * minute) },
    { mono: 4 * minute, wall: start + 8 * minute },
    { mono: 14 * minute, wall: start + 18 * minute },
  ]);
  assert.deepEqual(rows.map(row => row.outcome.trace.safe.pump), [true, true, false, true, false]);
  assert.deepEqual(decisions(rows[0]), ['Due']);
  assert.deepEqual(decisions(rows[1]), ['Active']);
  assert.deepEqual(decisions(rows[2]), ['ClockUnknown']);
  assert.deepEqual(decisions(rows[3]), ['Active']);
  assert.deepEqual(decisions(rows[4]), ['Completed']);
  assert.equal(rows.flatMap(decisions).filter(d => d === 'Due').length, 1);
  assert.equal(new Set(rows.flatMap(ids)).size, 1);
  assert.deepEqual(rows[2].settings.settings[0].result, { ok: true, value: 29280000 });
});


test('REF-03-077 repeated start settings and fault recovery preserve one consumed occurrence', async () => {
  const start = day + 8 * hour;
  const rows = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: 3 * minute, wall: start + 7 * minute,
      settings: (fp, id) => event(fp, id, 'accepted-start-0808', 0, 2, 8 * hour + 8 * minute) },
    { mono: 4 * minute, wall: start + 8 * minute },
    { mono: 5 * minute, wall: start + 9 * minute,
      settings: (fp, id) => event(fp, id, 'accepted-start-0802', 1, 4, 8 * hour + 2 * minute) },
    { mono: 6 * minute, wall: start + 10 * minute,
      settings: (fp, id) => event(fp, id, 'fault-start-0831', 2, 5, 8 * hour + 31 * minute) },
    { mono: 7 * minute, wall: start + 11 * minute,
      settings: (fp, id) => event(fp, id, 'recovery-start-0806', 3, 6, 8 * hour + 6 * minute) },
    { mono: 7 * minute + 1_000, wall: start + 11 * minute + 1_000,
      settings: (fp, id) => event(fp, id, 'accepted-start-0800', 4, 7, 8 * hour) },
    { mono: 8 * minute, wall: start + 12 * minute,
      settings: (fp, id) => event(fp, id, 'accepted-start-0808-again', 5, 8, 8 * hour + 8 * minute) },
  ]);
  assert.deepEqual(rows.map(row => row.accepted), Array(8).fill(true));
  assert.deepEqual(rows.map(row => row.settings.settingsRevision), [0, 1, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(rows.map(row => row.settings.settings[0].result), [
    { ok: true, value: 28_800_000 },
    { ok: true, value: 29_280_000 },
    { ok: true, value: 29_280_000 },
    { ok: true, value: 28_920_000 },
    { ok: false, fault: 'SettingsInvalid' },
    { ok: true, value: 29_160_000 },
    { ok: true, value: 28_800_000 },
    { ok: true, value: 29_280_000 },
  ]);
  assert.deepEqual(rows.map(row => row.outcome.trace.safe.pump), [true, false, true, true, false, true, false, false]);
  assert.deepEqual(rows.map(decisions), [
    ['Due'], ['Waiting'], ['Active'], ['Active'], ['Unknown(SettingsInvalid)'], ['Active'], ['Completed'], ['AlreadyTerminal'],
  ]);
  const occurrenceIds = rows.flatMap(ids).filter(Boolean);
  assert.equal(new Set(occurrenceIds).size, 1, occurrenceIds.join(','));
  assert.equal(rows.flatMap(decisions).filter(d => d === 'Due').length, 1);
  assert.equal(rows[3].outcome.trace.contextTrace.find(entry => entry.decision === 'Active').plannedWallMs, start + 2 * minute);
  assert.equal(rows[5].outcome.trace.contextTrace.find(entry => entry.decision === 'Active').plannedWallMs, start + 6 * minute);
  // Terminal evidence retains the preceding active fact, while the accepted
  // 08:00 setting ends it immediately because its new 08:10 end is already past.
  assert.equal(rows[6].outcome.trace.contextTrace.find(entry => entry.decision === 'Completed').plannedWallMs, start + 6 * minute);
  assert.equal(rows[7].outcome.trace.contextTrace.find(entry => entry.decision === 'AlreadyTerminal').plannedWallMs, start + 8 * minute);
});


test('REF-03-077 accepted start persists through fresh-owner restore and future occurrence', async () => {
  const start = day + 8 * hour;
  const admitted = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: 3 * minute, wall: start + 7 * minute,
      settings: (fp, id) => event(fp, id, 'fresh-owner-start-0808', 0, 2, 8 * hour + 8 * minute) },
  ]);
  assert.equal(admitted.at(-1).checkpoint.includes(Buffer.from('GFRG', 'latin1').toString('hex')), true);
  const restored = await run([
    { mono: 4 * minute, wall: start + 9 * minute },
    { mono: DAY - minute, wall: start + DAY + 7 * minute },
    { mono: DAY, wall: start + DAY + 8 * minute },
    { mono: DAY + 10 * minute, wall: start + DAY + 18 * minute },
  ], { checkpoint: admitted.at(-1).checkpoint });
  assert.deepEqual(restored.map(row => row.outcome.trace.safe.pump), [false, false, true, false]);
  assert.deepEqual(restored.map(decisions), [['AlreadyTerminal'], [], ['Due'], ['Completed']]);
  assert.deepEqual(restored.map(row => row.settings.settings[0].result), Array(4).fill({ ok: true, value: 29_280_000 }));
  assert.deepEqual(restored.map(row => row.settings.settingsRevision), [1, 1, 1, 1]);
  const firstDayIds = new Set(admitted.concat(restored.slice(0, 1)).flatMap(ids));
  assert.equal(firstDayIds.size, 1);
  assert.equal(restored[2].outcome.trace.contextTrace.find(entry => entry.decision === 'Due').plannedWallMs, start + DAY + 8 * minute);
  assert.equal(restored[3].outcome.trace.contextTrace.find(entry => entry.decision === 'Completed').plannedWallMs, start + DAY + 8 * minute);
  assert.notEqual(ids(restored[2])[0], ids(admitted[0])[0], 'future date admits a new occurrence identity');

  const midnight = source.replace(/time`08:00`/g, 'time`00:00`').replace('max = time`08:30`;', 'max = time`00:30`;');
  const midnightStart = day;
  const midnightRows = await run([
    { mono: 0, wall: midnightStart },
    { mono: 10 * minute, wall: midnightStart + 10 * minute },
  ], { sourceText: midnight, filename: 'range-live-start-midnight.ghost.md' });
  assert.deepEqual(midnightRows.map(row => row.outcome.trace.safe.pump), [true, false]);
  assert.equal(midnightRows[0].settings.settings[0].result.value, 0);
});


test('REF-03-077 rejected start envelopes preserve complete checkpoint and settings revision', async () => {
  const start = day + 8 * hour;
  const accepted = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: 3 * minute, wall: start + 7 * minute,
      settings: (fp, id) => event(fp, id, 'baseline-start-0808', 0, 2, 8 * hour + 8 * minute) },
  ]);
  const checkpoint = accepted.at(-1).checkpoint;
  const beforeSettings = accepted.at(-1).settings;
  const attempts = [
    ['alternate fingerprint', (fp, id) => event('0123456789abcdef', id, 'bad-fingerprint', 1, 3, 8 * hour + 6 * minute), /fingerprint|settings transaction|invalid/i],
    ['stale base revision', (fp, id) => event(fp, id, 'stale-revision', 0, 3, 8 * hour + 6 * minute), /stale settings transaction/i],
    ['wrong application position', (fp, id) => event(fp, id, 'wrong-position', 1, 2, 8 * hour + 6 * minute), /stale settings transaction/i],
  ];
  for (const [label, packet, match] of attempts) {
    const rows = await run([
      { mono: 4 * minute, wall: start + 8 * minute, settings: packet },
    ], { checkpoint, assertAccepted: false });
    assert.equal(rows[0].accepted, false, label);
    assert.match(rows[0].error, match, label);
    assert.equal(rows[0].checkpoint, checkpoint, label);
    assert.deepEqual(rows[0].settings, beforeSettings, label);
  }

  const unauthorized = source.replace('access = operator;', 'access = designer;');
  const denied = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: 3 * minute, wall: start + 7 * minute,
      settings: (fp, id) => event(fp, id, 'unauthorized-operator-start', 0, 2, 8 * hour + 8 * minute) },
  ], { sourceText: unauthorized, filename: 'range-live-start-designer.ghost.md', assertAccepted: false });
  assert.equal(denied[0].accepted, true);
  assert.equal(denied[1].accepted, false);
  assert.match(denied[1].error, /invalid settings target|unauthorized/i);
  assert.equal(denied[1].checkpoint, denied[0].checkpoint);
  assert.deepEqual(denied[1].settings, denied[0].settings);

  const sharedSourceConfig = source.replace('access = operator;', 'access = designer;');
  const shared = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: 3 * minute, wall: start + 7 * minute,
      settings: (fp, id) => ({ ...event(fp, id, 'shared-source-wrong-payload', 0, 2, 8 * hour + 8 * minute), origin: 'producerObservation' }) },
  ], { sourceText: sharedSourceConfig, filename: 'range-live-start-shared-source.ghost.md', assertAccepted: false });
  assert.equal(shared[1].accepted, false);
  assert.match(shared[1].error, /producer cannot change readonly config payload|invalid settings target/i);
  assert.equal(shared[1].checkpoint, shared[0].checkpoint);
  assert.deepEqual(shared[1].settings, shared[0].settings);
});

test('REF-03-077 compiler rejects config-backed Daily at outside the selected UTC Range start profile', async () => {
  const cases = [
    ['pulse', source.replace('basis = range(10min);\n    when = true;\n    cancel_when = false;', 'basis = pulse;\n    when = true;')],
    ['calendar daily pulse', source.replace('schedule watering: Daily {\n    timezone = "UTC";', 'calendar workdays: WorkCalendar;\n  schedule watering: Daily {\n    timezone = "UTC";\n    on = day`workday`;\n    calendar = workdays;').replace('basis = range(10min);\n    when = true;\n    cancel_when = false;', 'basis = pulse;\n    when = true;')],
    ['non-UTC range', source.replace('timezone = "UTC";', 'timezone = "Asia/Seoul";')],
    ['combined live duration and start', source.replace('basis = range(10min);', 'basis = range(duration);').replace('  config start:', '  config duration: Duration = 10min { min = 5min; max = 20min; step = 1min; access = operator; }\n  config start:')],
  ];
  for (const [label, bad] of cases) {
    await assert.rejects(() => compileSource(bad, { filename: `range-live-start-${label}.ghost.md` }), /config-backed Daily at|live Range start|recurrence non-overlap|calendar/i, label);
  }
  const midnight = source.replace(/time`08:00`/g, 'time`00:00`').replace('max = time`08:30`;', 'max = time`00:30`;');
  const out = await compileSource(midnight, { filename: 'range-live-start-midnight.ghost.md' });
  assert.equal(out.manifest.configs[0].settings.min, 0);
  assert.equal(out.manifest.schedules[0].atMs, 0);
});

test('REF-03-077 malformed Range start manifest metadata rejects framed instantiation', async () => {
  const compiled = await artifact();
  const mutations = [
    ['missing name', manifest => { delete manifest.schedules[0].policy.basis.startConfig; }, /name and id together/],
    ['missing id', manifest => { delete manifest.schedules[0].policy.basis.startConfigId; }, /name and id together/],
    ['invalid name type', manifest => { manifest.schedules[0].policy.basis.startConfig = 7; }, /startConfig/],
    ['mismatched name', manifest => { manifest.schedules[0].policy.basis.startConfig = 'other'; }, /metadata mismatch/],
    ['mismatched id', manifest => { manifest.schedules[0].policy.basis.startConfigId += 99; }, /metadata mismatch/],
    ['wrong typed config', manifest => { manifest.configs[0].type = 'Bool'; manifest.configs[0].value = false; delete manifest.configs[0].settings.min; delete manifest.configs[0].settings.max; delete manifest.configs[0].settings.step; }, /metadata mismatch|TimeOfDay/],
    ['missing descriptor', manifest => { manifest.configs = []; }, /metadata mismatch/],
    ['initial start mismatch', manifest => { manifest.schedules[0].atMs += minute; }, /initial value mismatch/],
    ['both live start and duration', manifest => { manifest.schedules[0].policy.basis.durationConfig = manifest.configs[0].name; manifest.schedules[0].policy.basis.durationConfigId = manifest.configs[0].id; }, /both live|live duration and live start/],
  ];
  for (const [label, mutate, match] of mutations) {
    const manifest = clone(compiled.manifest);
    mutate(manifest);
    await assert.rejects(() => ControlRuntime.instantiateFramed(wasm, { ...compiled, manifest }, { context: activation }), match, label);
  }
});

test('REF-03-077 GFRG3 live start checkpoint rejects repaired malformed payloads in WASM and native restore', async () => {
  const start = day + 8 * hour;
  const rows = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: 3 * minute, wall: start + 7 * minute, settings: (fp, id) => event(fp, id, 'checkpoint-0808', 0, 2, 8 * hour + 8 * minute) },
  ]);
  const compiled = await artifact();
  const good = Buffer.from(rows.at(-1).checkpoint, 'hex');
  assert.equal(good.subarray(0, 6).toString('latin1'), 'GFCX\x04\x00');
  const marker = good.indexOf(Buffer.from('GFES\x02GFRG\x03', 'latin1'));
  assert.ok(marker > 0, 'wrapped checkpoint contains GFRG3 engine payload');
  const corruptions = [
    ['wrong effective start value', buffer => { buffer.writeBigUInt64LE(9n * 60_000n, marker + 20); return fixCheckpointChecksum(buffer); }],
    ['missing live start tag', buffer => { buffer[marker + 19] = 0; return fixCheckpointChecksum(buffer); }],
    ['out of bounds live start', buffer => { buffer.writeBigUInt64LE(BigInt(9 * hour), marker + 20); return fixCheckpointChecksum(buffer); }],
    ['off grid live start', buffer => { buffer.writeBigUInt64LE(BigInt(8 * hour + 8 * minute + 1), marker + 20); return fixCheckpointChecksum(buffer); }],
    ['wrong consumed identity', buffer => {
      const text = Buffer.from(String(compiled.manifest.schedules[0].site), 'utf8');
      const at = buffer.indexOf(text, marker + 28);
      assert.ok(at > marker, 'locate consumed identity');
      buffer[at] = text[0] === 0x39 ? 0x38 : 0x39;
      return fixCheckpointChecksum(buffer);
    }],
    ['truncation', buffer => buffer.subarray(0, buffer.length - 1)],
    ['trailing bytes', buffer => Buffer.concat([buffer, Buffer.from([0])])],
  ];
  for (const [label, mutate] of corruptions) {
    const payload = mutate(Buffer.from(good));
    const runtime = await ControlRuntime.instantiateFramed(wasm, compiled, { context: activation });
    const before = Buffer.from(runtime.contextSnapshot().bytes).toString('hex');
    try {
      assert.throws(() => runtime.restoreContextCheckpoint(payload), /Range|checkpoint|invalid|trailing|corrupt|truncated|identity/i, label);
      assert.equal(Buffer.from(runtime.contextSnapshot().bytes).toString('hex'), before, `${label} leaves WASM runtime unchanged`);
    } finally {
      runtime.dispose();
    }
    await assertNativeCheckpointRejected(compiled, payload.toString('hex'));
  }
});

test('REF-03-077 malformed GFB19 both-live Range metadata rejects actual native and WASM loaders', async () => {
  const twoConfigs = source.replace('  config start:', '  config duration: Duration = 10min { min = 5min; max = 20min; step = 1min; access = operator; }\n  config start:');
  const compiled = await artifact(twoConfigs);
  const startId = compiled.manifest.configs.find(config => config.name === 'start').id;
  const durationId = compiled.manifest.configs.find(config => config.name === 'duration').id;
  const pattern = Buffer.alloc(27);
  pattern.writeUInt16LE(3, 0); pattern.write('UTC', 2);
  pattern.writeBigUInt64LE(10n * 60_000n, 5);
  pattern.writeUInt32LE(startId, 13);
  pattern.writeUInt16LE(1, 17);
  pattern.writeBigUInt64LE(8n * 3_600_000n, 19);
  const offset = compiled.bytes.indexOf(pattern);
  assert.ok(offset >= 0, 'locate encoded GFB19 Range descriptor');
  assert.equal(compiled.bytes.indexOf(pattern, offset + 1), -1, 'unambiguous encoded GFB19 Range descriptor');
  const insertedDurationId = Buffer.alloc(4);
  insertedDurationId.writeUInt32LE(durationId);
  const malformed = Buffer.concat([compiled.bytes.subarray(0, offset + 13), insertedDurationId, compiled.bytes.subarray(offset + 13)]);
  malformed.writeBigUInt64LE(0n, offset + 5);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-range-live-start-loader-'));
  const runtime = await GhostFlowRuntime.instantiate(wasm);
  try {
    assert.throws(() => runtime.load(malformed), /both live|live duration and live start/i);
    const modulePath = path.join(directory, 'module.gfb');
    const tapePath = path.join(directory, 'tape.json');
    fs.writeFileSync(modulePath, malformed);
    fs.writeFileSync(tapePath, '{}');
    const native = spawnSync(nativePath, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 });
    assert.notEqual(native.status, 0, 'native loader rejects both-live Range metadata');
    assert.match(native.stderr || native.stdout, /both live|live duration and live start/i);
  } finally {
    runtime.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('REF-03-077 earlier scalar Range start moves same occurrence end earlier', async () => {
  const start = day + 8 * hour;
  const rows = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: 3 * minute, wall: start + 7 * minute, settings: (fp, id) => event(fp, id, 'move-to-0802', 0, 2, 8 * hour + 2 * minute) },
    { mono: 7 * minute, wall: start + 11 * minute + 59_999 },
    { mono: 8 * minute, wall: start + 12 * minute },
  ]);
  assert.deepEqual(rows.map(row => row.outcome.trace.safe.pump), [true, true, true, false]);
  assert.deepEqual(decisions(rows[1]), ['Active']);
  assert.deepEqual(decisions(rows[3]), ['Completed']);
  assert.equal(rows.flatMap(decisions).filter(d => d === 'Due').length, 1);
  assert.equal(new Set(rows.flatMap(ids)).size, 1);
});
