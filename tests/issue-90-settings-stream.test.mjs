import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { encode } from '@toon-format/toon';
import { extractLiterate } from '../tools/literate.mjs';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { typeCheckControl } from '../tools/control.mjs';
import { runScenario } from '../tools/ghostsim.mjs';
import { encodeContextFacts } from '../runtimes/wasm/context-abi.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureUrl = new URL('./fixtures/issue-90-settings-periodic.ghost.md', import.meta.url);
const document = fs.readFileSync(fixtureUrl, 'utf8');
const code = extractLiterate(document, { filename: 'issue-90-settings-periodic.ghost.md' }).code;
let builtWasm;
function wasmBytes() {
  if (builtWasm === undefined) {
    execFileSync('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-wasm',
      '--target', 'wasm32-unknown-unknown', '--release'], { cwd: root, stdio: 'pipe' });
    builtWasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
  }
  return builtWasm;
}
const clock = monotonicMs => ({
  monotonicMs, bootEpoch: 7, wallMs: 1_790_812_800_000 + monotonicMs,
  uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: 'issue-90-clock-v1',
});
const settingsPacket = settings => ({ clock: clock(settings.position), natural: [], schedules: [], settings });

export function assertSettingsTimeline(scans) {
  assert.deepEqual(scans.map(({ atMs, revision, interval, duration, due, active, fault }) =>
    ({ atMs, revision, interval, duration, due, active, fault })), [
    { atMs: 0, revision: 0, interval: 3_600_000, duration: 600_000, due: false, active: false, fault: null },
    { atMs: 3_600_000, revision: 0, interval: 3_600_000, duration: 600_000, due: true, active: true, fault: null },
    { atMs: 3_780_000, revision: 1, interval: 1_200_000, duration: 180_000, due: false, active: false, fault: null },
    { atMs: 4_800_000, revision: 1, interval: 1_200_000, duration: 180_000, due: true, active: true, fault: null },
    { atMs: 4_980_000, revision: 1, interval: 1_200_000, duration: 180_000, due: false, active: false, fault: null },
    { atMs: 4_980_000, revision: 2, interval: null, duration: null, due: false, active: false, fault: 'SettingsInvalid' },
    { atMs: 6_000_000, revision: 3, interval: 1_200_000, duration: 180_000, due: false, active: false, fault: null },
  ]);
}

test('Issue #90 compiles configs as typed Result values while one artifact retains both addressed settings', async () => {
  const compiled = await compileSource(document, { filename: 'issue-90-settings-periodic.ghost.md' });
  assert.deepEqual(compiled.manifest.configs.map(({ id, name, type, value }) => ({ id, name, type, value })), [
    { id: 2, name: 'interval', type: 'Duration', value: 3_600_000 },
    { id: 4, name: 'duration', type: 'Duration', value: 600_000 },
  ]);
  assert.deepEqual(compiled.manifest.schedules[0].every,
    { expression: 'interval', initialMs: 3_600_000, config: 'interval', configId: 2 });
  assert.equal(new DataView(compiled.bytes.buffer, compiled.bytes.byteOffset, compiled.bytes.byteLength)
    .getUint16(4, true), 11);
});

test('Issue #90 requires ordinary expressions to unwrap a config Result explicitly', () => {
  const unsafe = `control UnsafeConfigRead {
    config interval: Duration = 1h;
    output ready: Bool;
    ready <- interval == 1h;
  }`;
  assert.throws(() => typeCheckControl(unsafe), /Result|case|unwrap/);
});

test('Issue #90 rejects a Periodic config whose declared minimum is not positive', () => {
  const invalid = document.replace('min = 10min;', 'min = 0ms;');
  assert.throws(() => typeCheckControl(extractLiterate(invalid, {
    filename: 'issue-90-settings-periodic.ghost.md',
  }).code), /minimum must be positive/);
});

test('Issue #90 keeps fixed design values as let declarations rather than settings', () => {
  assert.deepEqual([...document.matchAll(/\bconfig\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]),
    ['interval', 'duration']);
  assert.doesNotMatch(document, /config\s+(?:fallback|anchor|grace)/);
  assert.match(document, /fault\(_\) => 0ms/);
});

test('Issue #90 GFSF5 encodes one aggregate typed Result emission by stable config ID', () => {
  const bytes = encodeContextFacts(settingsPacket({
    programFingerprint: '18446744073709551615', eventId: 'settings-B', baseRevision: 0, position: 1,
    origin: 'operatorEdit',
    changes: [
      { configId: 2, result: { ok: true, type: 'Duration', value: 1_200_000 } },
      { configId: 4, result: { ok: true, type: 'Duration', value: 180_000 } },
    ],
  }));
  assert.deepEqual([...bytes.slice(0, 4)], [...new TextEncoder().encode('GFSF')]);
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(4, true), 5);
});

test('Issue #90 GFSF5 distinguishes accepted fault emissions from rejected envelopes', () => {
  const fault = encodeContextFacts(settingsPacket({
    programFingerprint: '18446744073709551615', eventId: 'settings-invalid', baseRevision: 1, position: 2,
    origin: 'producerObservation',
    changes: [
      { configId: 2, result: { ok: false, fault: 'SettingsInvalid' } },
      { configId: 4, result: { ok: false, fault: 'SettingsInvalid' } },
    ],
  }));
  assert.equal(new DataView(fault.buffer, fault.byteOffset, fault.byteLength).getUint16(4, true), 5);

  for (const [label, mutate, diagnostic] of [
    ['duplicate target', value => value.settings.changes.push(value.settings.changes[0]), /duplicate.*config/i],
    ['unknown rail', value => { value.settings.changes[0].result = { ok: false, fault: 'Other' }; }, /settings.*fault/i],
    ['malformed success', value => { delete value.settings.changes[0].result.type; }, /type|result/i],
  ]) {
    const packet = settingsPacket({
      programFingerprint: '1', eventId: `bad-${label}`, baseRevision: 1, position: 2, origin: 'operatorEdit',
      changes: [{ configId: 2, result: { ok: true, type: 'Duration', value: 1_200_000 } }],
    });
    mutate(packet);
    assert.throws(() => encodeContextFacts(packet), diagnostic, label);
  }
});

test('Issue #90 applies, faults, recovers, retries and restores one settings stream in real WASM', async t => {
  const wasm = wasmBytes();
  const compiled = await compileSource(document, { filename: 'issue-90-settings-periodic.ghost.md' });
  const activation = { bootEpoch: 7, terminalCapacity: 16, bindings: [] };
  const runtime = await ControlRuntime.instantiate(wasm, compiled, { context: activation });
  t.after(() => runtime.dispose());
  const anchor = 1_790_812_800_000;
  const schedule = wallMs => ({
    site: 26, coverageStartMs: wallMs - 1, coverageEndMs: wallMs + 1,
    provider: null, calendar: null, rows: [],
  });
  const facts = (monotonicMs, wallMs, settings = null) => ({
    clock: { ...clock(monotonicMs), wallMs }, natural: [], schedules: [schedule(wallMs)], settings,
  });
  const settings = (programFingerprint, eventId, baseRevision, position, changes) =>
    ({ programFingerprint, eventId, baseRevision, position, origin: 'operatorEdit', changes });
  const success = (configId, value) => ({ configId, result: { ok: true, type: 'Duration', value } });
  const observe = (atMs, row) => {
    const state = runtime.contextSnapshot().state;
    const values = Object.fromEntries(state.settings.map(item => [item.name, item.result]));
    return {
      atMs, revision: state.settingsRevision,
      interval: values.interval.ok ? values.interval.value : null,
      duration: values.duration.ok ? values.duration.value : null,
      due: row.vm.safe.due, active: row.vm.safe.active,
      fault: values.interval.ok ? null : values.interval.fault,
    };
  };

  const initial = runtime.contextSnapshot();
  const fingerprint = initial.state.programFingerprint;
  const timeline = [];
  timeline.push(observe(0, runtime.step({ nowMs: 0, contextFacts: facts(0, anchor + 3_600_000 - 1) })));
  timeline.push(observe(3_600_000, runtime.step({ nowMs: 1, contextFacts: facts(1, anchor + 3_600_000) })));
  timeline.push(observe(3_780_000, runtime.step({ nowMs: 180_001, contextFacts: facts(180_001, anchor + 3_780_000,
    settings(fingerprint, 'settings-B', 0, 3, [success(2, 1_200_000), success(4, 180_000)])) })));

  timeline.push(observe(4_800_000, runtime.step({ nowMs: 1_200_001, contextFacts: facts(1_200_001, anchor + 4_800_000) })));
  timeline.push(observe(4_980_000, runtime.step({ nowMs: 1_380_001, contextFacts: facts(1_380_001, anchor + 4_980_000) })));

  const beforeReject = runtime.contextSnapshot();
  assert.throws(() => runtime.step({ nowMs: 1_380_001, contextFacts: facts(1_380_001, anchor + 4_980_000,
    settings(fingerprint, 'retryable', 0, 6, [success(2, 1_200_000), success(4, 180_000)])) }),
  /stale|settings transaction/);
  assert.deepEqual(runtime.contextSnapshot(), beforeReject, 'rejected identity/revision must not emit or advance');

  timeline.push(observe(4_980_000, runtime.step({ nowMs: 1_380_001, contextFacts: facts(1_380_001, anchor + 4_980_000,
    settings(fingerprint, 'retryable', 1, 6, [success(2, 1), success(4, 180_000)])) })));
  timeline.push(observe(6_000_000, runtime.step({ nowMs: 2_400_001, contextFacts: facts(2_400_001, anchor + 6_000_000,
    settings(fingerprint, 'settings-recovered', 2, 7, [success(2, 1_200_000), success(4, 180_000)])) })));
  assertSettingsTimeline(timeline);

  const saved = runtime.contextSnapshot();
  const restored = await ControlRuntime.instantiate(wasm, compiled, { context: activation });
  t.after(() => restored.dispose());
  restored.restoreContextCheckpoint(saved.bytes);
  assert.deepEqual(restored.contextSnapshot().state, saved.state);
  const afterRestart = restored.step({ nowMs: 0, contextFacts: facts(0, anchor + 6_000_001) });
  assert.equal(afterRestart.vm.safe.due, false, 'restart must not catch up a recovered Periodic occurrence');
});

test('Issue #90 initial 10-minute run remains active until its exact elapsed deadline', async t => {
  const compiled = await compileSource(document, { filename: 'issue-90-settings-periodic.ghost.md' });
  const runtime = await ControlRuntime.instantiate(wasmBytes(), compiled,
    { context: { bootEpoch: 7, terminalCapacity: 16, bindings: [] } });
  t.after(() => runtime.dispose());
  const anchor = 1_790_812_800_000;
  const scan = (monotonicMs, wallMs) => runtime.step({ nowMs: monotonicMs, contextFacts: {
    clock: { ...clock(monotonicMs), wallMs }, natural: [],
    schedules: [{ site: 26, coverageStartMs: wallMs - 1, coverageEndMs: wallMs + 1,
      provider: null, calendar: null, rows: [] }], settings: null,
  } });
  assert.equal(scan(0, anchor + 3_600_000 - 1).vm.safe.active, false);
  assert.equal(scan(1, anchor + 3_600_000).vm.safe.active, true);
  assert.equal(scan(540_001, anchor + 4_140_000).vm.safe.active, true);
  assert.equal(scan(600_001, anchor + 4_200_000).vm.safe.active, false);
});

test('Issue #90 framed context reports accepted native scan identity and exposes the same Result state', async t => {
  const compiled = await compileSource(document, { filename: 'issue-90-settings-periodic.ghost.md' });
  const runtime = await ControlRuntime.instantiateFramed(wasmBytes(), compiled,
    { context: { bootEpoch: 7, terminalCapacity: 16, bindings: [] } });
  t.after(() => runtime.dispose());
  const anchor = 1_790_812_800_000;
  const facts = (monotonicMs, wallMs) => ({ clock: { ...clock(monotonicMs), wallMs }, natural: [],
    schedules: [{ site: 26, coverageStartMs: wallMs - 1, coverageEndMs: wallMs + 1,
      provider: null, calendar: null, rows: [] }], settings: null });
  const baseline = runtime.step({ nowMs: 0, contextFacts: facts(0, anchor + 3_600_000 - 1) });
  assert.deepEqual(baseline.frame, { scanId: 0, logicalTimeMs: 0 });
  assert.equal(baseline.vm.safe.due, false);
  const due = runtime.step({ nowMs: 1, contextFacts: facts(1, anchor + 3_600_000) });
  assert.deepEqual(due.frame, { scanId: 1, logicalTimeMs: 1 });
  assert.equal(due.vm.safe.active, true);
  assert.equal(runtime.lastFrameOutcome.scanId, 1);
  assert.deepEqual(runtime.contextSnapshot().state.settings.map(setting => setting.result), [
    { ok: true, value: 3_600_000 }, { ok: true, value: 600_000 },
  ]);
  const beforeReject = runtime.contextSnapshot();
  const nextFacts = facts(2, anchor + 3_600_001);
  const change = programFingerprint => ({ programFingerprint, eventId: 'framed-change',
    baseRevision: 0, position: 3, origin: 'operatorEdit',
    changes: [{ configId: 4, result: { ok: true, type: 'Duration', value: 180_000 } }] });
  assert.throws(() => runtime.step({ nowMs: 2, contextFacts: {
    ...nextFacts, settings: change('0'),
  } }), /fingerprint|settings transaction/i);
  assert.deepEqual(runtime.contextSnapshot(), beforeReject, 'rejected frame cannot advance Result state');
  assert.equal(runtime.lastFrameOutcome.scanId, 1);
  const accepted = runtime.step({ nowMs: 2, contextFacts: {
    ...nextFacts, settings: change(beforeReject.state.programFingerprint),
  } });
  assert.deepEqual(accepted.frame, { scanId: 2, logicalTimeMs: 2 });
  assert.deepEqual(runtime.contextSnapshot().state.settings.map(setting => setting.result), [
    { ok: true, value: 3_600_000 }, { ok: true, value: 180_000 },
  ]);
});

test('Issue #90 ghostsim exposes the same accelerated A-to-B Result stream and Periodic decisions', async t => {
  const compiled = await compileSource(document, { filename: 'issue-90-settings-periodic.ghost.md' });
  const activation = { bootEpoch: 7, terminalCapacity: 16, bindings: [] };
  const probe = await ControlRuntime.instantiate(wasmBytes(), compiled, { context: activation });
  const fingerprint = probe.contextSnapshot().state.programFingerprint;
  probe.dispose();

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-issue-90-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, 'settings.gfb');
  writeArtifact(compiled, artifactPath);
  const anchor = 1_790_812_800_000;
  const schedule = wallMs => ({ site: 26, coverageStartMs: wallMs - 1, coverageEndMs: wallMs + 1,
    provider: null, calendar: null, rows: [] });
  const facts = (monotonicMs, wallMs, settings = null) => ({
    clock: { ...clock(monotonicMs), wallMs }, natural: [], schedules: [schedule(wallMs)], settings,
  });
  const scenario = {
    format: 'GhostFlow/scenario-v1', id: 'issue-90-accelerated-settings',
    initialInputs: [], keyBindings: [], context: activation,
    actions: [
      { kind: 'scan', atMs: 0, contextFacts: facts(0, anchor + 3_600_000 - 1) },
      { kind: 'scan', atMs: 1, contextFacts: facts(1, anchor + 3_600_000) },
      { kind: 'scan', atMs: 180_001, contextFacts: facts(180_001, anchor + 3_780_000, {
        programFingerprint: fingerprint, eventId: 'settings-B', baseRevision: 0, position: 3,
        origin: 'operatorEdit',
        changes: [
          { configId: 2, result: { ok: true, type: 'Duration', value: 1_200_000 } },
          { configId: 4, result: { ok: true, type: 'Duration', value: 180_000 } },
        ],
      }) },
      { kind: 'scan', atMs: 1_200_001, contextFacts: facts(1_200_001, anchor + 4_800_000) },
    ],
  };
  const scenarioPath = path.join(directory, 'scenario.toon');
  fs.writeFileSync(scenarioPath, `${encode(scenario)}\n`);
  const result = runScenario(artifactPath, scenarioPath, { format: 'json' });
  assert.equal(result.success, true, result.encoded);
  const output = JSON.parse(result.encoded);
  assert.deepEqual(output.scans.map(scan => ({ due: scan.safeVirtualIntent.due, active: scan.safeVirtualIntent.active })), [
    { due: false, active: false }, { due: true, active: true },
    { due: false, active: false }, { due: true, active: true },
  ]);
  assert.deepEqual(output.scans.map(scan => scan.settingsState.settingsRevision), [0, 0, 1, 1]);
  assert.deepEqual(output.scans.at(-1).settingsState.settings.map(setting => setting.result), [
    { ok: true, value: 1_200_000 }, { ok: true, value: 180_000 },
  ]);
});

test('Issue #90 readonly streams accept producer fault/recovery and reject operator edits atomically', async t => {
  const readonlyDocument = fs.readFileSync(
    new URL('./fixtures/issue-90-readonly-settings.ghost.md', import.meta.url), 'utf8');
  const compiled = await compileSource(readonlyDocument, { filename: 'issue-90-readonly-settings.ghost.md' });
  const runtime = await ControlRuntime.instantiate(wasmBytes(), compiled,
    { context: { bootEpoch: 9, terminalCapacity: 8, bindings: [] } });
  t.after(() => runtime.dispose());
  const fingerprint = runtime.contextSnapshot().state.programFingerprint;
  const facts = (position, settings) => ({
    clock: { monotonicMs: position, bootEpoch: 9, wallMs: 1_000 + position,
      uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: 'readonly-clock-v1' },
    natural: [], schedules: [], settings,
  });
  const event = (eventId, baseRevision, position, origin, result) => ({
    programFingerprint: fingerprint, eventId, baseRevision, position, origin,
    changes: [{ configId: 2, result }],
  });

  const unavailable = runtime.step({ nowMs: 1, contextFacts: facts(1,
    event('readonly-unavailable', 0, 1, 'producerObservation',
      { ok: false, fault: 'SettingsUnavailable' })) });
  assert.equal(unavailable.vm.safe.available, false);
  assert.deepEqual(runtime.contextSnapshot().state.settings[0].result,
    { ok: false, fault: 'SettingsUnavailable' });

  const beforeUnauthorized = runtime.contextSnapshot();
  assert.throws(() => runtime.step({ nowMs: 2, contextFacts: facts(2,
    event('readonly-operator', 1, 2, 'operatorEdit',
      { ok: true, type: 'Duration', value: 600_000 })) }), /unauthorized|settings target/);
  assert.deepEqual(runtime.contextSnapshot(), beforeUnauthorized);

  const recovered = runtime.step({ nowMs: 2, contextFacts: facts(2,
    event('readonly-recovered', 1, 2, 'producerObservation',
      { ok: true, type: 'Duration', value: 300_000 })) });
  assert.equal(recovered.vm.safe.available, true);
  assert.deepEqual(runtime.contextSnapshot().state.settings[0].result, { ok: true, value: 300_000 });
});

test('REF-05-106 [host] 복귀 실패를 정상 설정값으로 숨기지 않는다.', async t => {
  const referenceCases = JSON.parse(fs.readFileSync(
    new URL('./reference/cases/03-settings-boundaries.json', import.meta.url), 'utf8')).cases;
  const ref05106 = referenceCases.find(entry => entry.id === 'REF-05-106');
  const settingsChapter = fs.readFileSync(
    new URL('../docs/reference/05-settings-and-observation.md', import.meta.url), 'utf8');
  assert.equal(ref05106?.issue, 'https://github.com/callin2/ghostflow-language/issues/338');
  assert.match(ref05106.rule, /복귀 실패를 정상 설정값으로 숨기지 않는다/);
  assert.match(ref05106.given, /Until overlay 만료/);
  assert.match(ref05106.then, /설정 unavailable과 복귀 실패를 관찰/);
  assert.match(ref05106.then, /성공 tick으로 확정하지 않는다/);
  assert.match(settingsChapter, /\| 복귀 실패 \| 성공한 복귀로 기록하지 않는다\./);
  assert.match(settingsChapter, /설정 유효성을 unavailable로 보고/);
  assert.match(settingsChapter, /물리 출력 대응은 설치의 명시된 장애 계약을 따른다/);

  const readonlyDocument = fs.readFileSync(
    new URL('./fixtures/issue-90-readonly-settings.ghost.md', import.meta.url), 'utf8');
  const compiled = await compileSource(readonlyDocument, { filename: 'issue-90-readonly-settings.ghost.md' });
  const runtime = await ControlRuntime.instantiate(wasmBytes(), compiled,
    { context: { bootEpoch: 10, terminalCapacity: 8, bindings: [] } });
  t.after(() => runtime.dispose());
  const fingerprint = runtime.contextSnapshot().state.programFingerprint;
  const facts = (position, settings) => ({
    clock: { monotonicMs: position, bootEpoch: 10, wallMs: 2_000 + position,
      uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: 'return-failure-clock-v1' },
    natural: [], schedules: [], settings,
  });
  assert.deepEqual(runtime.contextSnapshot().state.settings[0].result, { ok: true, value: 300_000 });
  const returnFailure = {
    programFingerprint: fingerprint,
    eventId: 'until-overlay-return-failure',
    baseRevision: 0,
    position: 1,
    origin: 'producerObservation',
    changes: [{ configId: compiled.manifest.configs[0].id, result: { ok: false, fault: 'SettingsUnavailable' } }],
  };
  const unavailable = runtime.step({ nowMs: 1, contextFacts: facts(1, returnFailure) });
  assert.equal(unavailable.vm.safe.available, false);
  const state = runtime.contextSnapshot().state;
  assert.equal(state.settingsRevision, 1);
  assert.deepEqual(state.settings[0].result, { ok: false, fault: 'SettingsUnavailable' });
  assert.notDeepEqual(state.settings[0].result, { ok: true, value: 300_000 });
});

test('REF-05-105 [host] 오래된 expiry는 새 일반 설정을 덮어쓰지 않는다.', async t => {
  const referenceCases = JSON.parse(fs.readFileSync(
    new URL('./reference/cases/03-settings-boundaries.json', import.meta.url), 'utf8')).cases;
  const ref05105 = referenceCases.find(entry => entry.id === 'REF-05-105');
  const settingsChapter = fs.readFileSync(
    new URL('../docs/reference/05-settings-and-observation.md', import.meta.url), 'utf8');
  assert.equal(ref05105?.issue, 'https://github.com/callin2/ghostflow-language/issues/337');
  assert.match(ref05105.rule, /오래된 expiry는 새 일반 설정을 덮어쓰지 않는다/);
  assert.match(ref05105.given, /5min 위 8min 임시값을 일반 설정 6min으로 대체했다/);
  assert.match(ref05105.then, /6min을 유지/);
  assert.match(ref05105.then, /이미 제거된 overlay에 대한 event로 식별/);
  assert.match(settingsChapter, /새 일반 설정 \| 해당 setting의 overlay를 같은 event에서 제거하고 새 일반값을 적용한다/);
  assert.match(settingsChapter, /이전 expiry가 새 값을 덮어쓰지 않는다/);

  const compiled = await compileSource(`# Stale expiry settings\n\n\`\`\`ghost\ncontrol StaleExpiry {
  config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; }
  output seconds: Number;
  seconds <- case duration { ok(value) => value / 1s; fault(_) => -1.0; };
}\n\`\`\`\n`, { filename: 'stale-expiry-settings.ghost.md' });
  const runtime = await ControlRuntime.instantiate(wasmBytes(), compiled,
    { context: { bootEpoch: 11, terminalCapacity: 8, bindings: [] } });
  t.after(() => runtime.dispose());
  const fingerprint = runtime.contextSnapshot().state.programFingerprint;
  const configId = compiled.manifest.configs[0].id;
  const facts = (position, settings) => ({
    clock: { monotonicMs: position, bootEpoch: 11, wallMs: 3_000 + position,
      uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: 'stale-expiry-clock-v1' },
    natural: [], schedules: [], settings,
  });
  const event = (eventId, baseRevision, position, value) => ({
    programFingerprint: fingerprint,
    eventId,
    baseRevision,
    position,
    origin: 'operatorEdit',
    changes: [{ configId, result: { ok: true, type: 'Duration', value } }],
  });

  assert.deepEqual(runtime.contextSnapshot().state.settings[0].result, { ok: true, value: 300_000 });
  assert.equal(runtime.step({ nowMs: 1, contextFacts: facts(1,
    event('temp-overlay-8min', 0, 1, 480_000)) }).vm.safe.seconds, 480);
  assert.equal(runtime.contextSnapshot().state.settingsRevision, 1);
  assert.equal(runtime.step({ nowMs: 2, contextFacts: facts(2,
    event('ordinary-6min-removes-overlay', 1, 2, 360_000)) }).vm.safe.seconds, 360);
  assert.equal(runtime.contextSnapshot().state.settingsRevision, 2);

  const staleExpiryReturn = event('stale-expiry-return-to-5min', 1, 3, 300_000);
  assert.throws(() => runtime.step({ nowMs: 3, contextFacts: facts(3, staleExpiryReturn) }), /stale settings transaction/);
  const state = runtime.contextSnapshot().state;
  assert.equal(state.settingsRevision, 2);
  assert.deepEqual(state.settings[0].result, { ok: true, value: 360_000 });
});

test('REF-05-104 [host] Until 임시값의 만료는 복귀 설정 event다.', async t => {
  const referenceCases = JSON.parse(fs.readFileSync(
    new URL('./reference/cases/03-settings-boundaries.json', import.meta.url), 'utf8')).cases;
  const ref05104 = referenceCases.find(entry => entry.id === 'REF-05-104');
  const settingsChapter = fs.readFileSync(
    new URL('../docs/reference/05-settings-and-observation.md', import.meta.url), 'utf8');
  assert.equal(ref05104?.issue, 'https://github.com/callin2/ghostflow-language/issues/336');
  assert.match(ref05104.rule, /Until 임시값의 만료는 복귀 설정 event다/);
  assert.match(ref05104.given, /일반값 5min/);
  assert.match(ref05104.when, /정확히 10:00Z/);
  assert.match(ref05104.then, /유효값 5min/);
  assert.match(ref05104.then, /새 settings revision/);
  assert.match(ref05104.then, /state와 timer는 reset하지 않는다/);
  assert.match(settingsChapter, /만료·취소 \| 원래 overlay ID를 대상으로 하는 atomic settings event다/);
  assert.match(settingsChapter, /완료된 settings revision과 적용 위치를 남긴다/);

  const compiled = await compileSource(`# Until expiry return\n\n\`\`\`ghost\ncontrol UntilExpiryReturn {
  input tick: Bool;
  config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; }
  state seen: Bool = false;
  timer age = elapsed(seen);
  seen' = seen || tick;
  output seconds: Number;
  output remembered: Bool;
  output age_ms: Duration;
  seconds <- case duration { ok(value) => value / 1s; fault(_) => -1.0; };
  remembered <- seen;
  age_ms <- age;
}\n\`\`\`\n`, { filename: 'until-expiry-return.ghost.md' });
  const runtime = await ControlRuntime.instantiate(wasmBytes(), compiled,
    { context: { bootEpoch: 12, terminalCapacity: 8, bindings: [] } });
  t.after(() => runtime.dispose());
  const fingerprint = runtime.contextSnapshot().state.programFingerprint;
  const configId = compiled.manifest.configs[0].id;
  const facts = (position, settings) => ({
    clock: { monotonicMs: position, bootEpoch: 12, wallMs: Date.parse('2026-09-29T10:00:00.000Z') + position,
      uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: 'until-expiry-clock-v1' },
    natural: [], schedules: [], settings,
  });
  const event = (eventId, baseRevision, position, value) => ({
    programFingerprint: fingerprint,
    eventId,
    baseRevision,
    position,
    origin: 'operatorEdit',
    changes: [{ configId, result: { ok: true, type: 'Duration', value } }],
  });

  const overlay = runtime.step({ nowMs: 1_000, inputs: { tick: true }, contextFacts: facts(1_000,
    event('until-overlay-8min-expires-at-10z', 0, 1, 480_000)) });
  assert.equal(overlay.vm.safe.seconds, 480);
  assert.equal(overlay.vm.safe.remembered, false);
  assert.equal(runtime.contextSnapshot().state.settingsRevision, 1);

  const returned = runtime.step({ nowMs: 61_000, inputs: { tick: false }, contextFacts: facts(61_000,
    event('until-overlay-8min-return-to-5min', 1, 2, 300_000)) });
  assert.equal(returned.vm.safe.seconds, 300);
  assert.equal(returned.vm.safe.remembered, true, 'state is not reset by expiry return');
  assert.ok(returned.vm.safe.age_ms > 0, 'timer memory continues across expiry return');
  assert.equal(runtime.contextSnapshot().state.settingsRevision, 2);
  assert.deepEqual(runtime.contextSnapshot().state.settings[0].result, { ok: true, value: 300_000 });
});

test('REF-05-103 [host] 임시 Run overlay는 run 경계에서 제거된다.', async t => {
  const referenceCases = JSON.parse(fs.readFileSync(
    new URL('./reference/cases/03-settings-boundaries.json', import.meta.url), 'utf8')).cases;
  const ref05103 = referenceCases.find(entry => entry.id === 'REF-05-103');
  const settingsChapter = fs.readFileSync(
    new URL('../docs/reference/05-settings-and-observation.md', import.meta.url), 'utf8');
  assert.equal(ref05103?.issue, 'https://github.com/callin2/ghostflow-language/issues/335');
  assert.match(ref05103.rule, /임시 Run overlay는 run 경계에서 제거된다/);
  assert.match(ref05103.given, /일반값 5min 위 Run 임시값 8min/);
  assert.match(ref05103.then, /첫 판단 전에 overlay가 제거되어 5min/);
  assert.match(settingsChapter, /\| `Run` \| 현재 run에서만 유효하다\. run이 끝나면 overlay를 제거한다\. \|/);
  assert.match(settingsChapter, /재시작은 새 `runId`를 만든다/);

  const compiled = await compileSource(`# Run overlay removal\n\n\`\`\`ghost\ncontrol RunOverlayRemoval {
  config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; }
  output seconds: Number;
  seconds <- case duration { ok(value) => value / 1s; fault(_) => -1.0; };
}\n\`\`\`\n`, { filename: 'run-overlay-removal.ghost.md' });
  const firstRun = await ControlRuntime.instantiate(wasmBytes(), compiled,
    { context: { bootEpoch: 13, terminalCapacity: 8, bindings: [] } });
  t.after(() => firstRun.dispose());
  const fingerprint = firstRun.contextSnapshot().state.programFingerprint;
  const configId = compiled.manifest.configs[0].id;
  const facts = (position, settings, bootEpoch = 13) => ({
    clock: { monotonicMs: position, bootEpoch, wallMs: 4_000 + position,
      uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: `run-overlay-clock-${bootEpoch}` },
    natural: [], schedules: [], settings,
  });
  const runOverlay = {
    programFingerprint: fingerprint,
    eventId: 'run-overlay-8min',
    baseRevision: 0,
    position: 1,
    origin: 'operatorEdit',
    changes: [{ configId, result: { ok: true, type: 'Duration', value: 480_000 } }],
  };
  assert.equal(firstRun.step({ nowMs: 1, contextFacts: facts(1, runOverlay) }).vm.safe.seconds, 480);
  assert.deepEqual(firstRun.contextSnapshot().state.settings[0].result, { ok: true, value: 480_000 });

  const nextRun = await ControlRuntime.instantiate(wasmBytes(), compiled,
    { context: { bootEpoch: 14, terminalCapacity: 8, bindings: [] } });
  t.after(() => nextRun.dispose());
  const firstDecision = nextRun.step({ nowMs: 0, contextFacts: facts(0, null, 14) });
  assert.equal(firstDecision.vm.safe.seconds, 300);
  assert.equal(nextRun.contextSnapshot().state.settingsRevision, 0);
  assert.deepEqual(nextRun.contextSnapshot().state.settings[0].result, { ok: true, value: 300_000 });
});
