import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileSource } from './helpers/literate-compile.mjs';
import { AdaptationSettingsHost } from '../runtimes/wasm/adaptation-settings-host.mjs';

const source = `control AtomicAdapt {
config first: Percent = 20% { min = 0%; max = 100%; step = 1%; access = operator; label = "First"; }
config second: Percent = 20% { min = 0%; max = 100%; step = 1%; access = operator; label = "Second"; }
adapt_setting first_policy for first { allowed = 0% .. 100%; max_step = 10%; max_change = 10% per 1h; authority = optimizer; }
adapt_setting second_policy for second { allowed = 0% .. 100%; max_step = 10%; max_change = 10% per 1h; authority = optimizer; }
output first_value, second_value: Percent;
first_value <- case first { ok(value) => value; fault(_) => 0%; };
second_value <- case second { ok(value) => value; fault(_) => 0%; };
}`;
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const packet = atMs => ({ nowMs: atMs, contextFacts: {
  clock: { monotonicMs: atMs, bootEpoch: 7, wallMs: null, uncertaintyMs: null, trusted: false, unknownReason: 'NoClock', sourceRevision: 'clock-v1' },
  natural: [], schedules: [], settings: null,
} });
const activate = artifact => AdaptationSettingsHost.instantiate(wasm, artifact,
  { context: { bootEpoch: 7, terminalCapacity: 32, bindings: [] }, authorities: { model: 'optimizer' } });
const proposal = (host, artifact, atMs, values) => {
  const state = host.snapshot().core.state;
  return { eventId: `event-${atMs}-${state.settingsRevision}`, programFingerprint: state.programFingerprint,
    sourceSha256: host.snapshot().sourceSha256,
    policySha256: host.snapshot().policySha256,
    baseRevision: state.settingsRevision, atMs, actor: 'model', authority: 'optimizer', source: 'model-v1', evidence: 'measurement-window-1',
    changes: Object.entries(values).map(([name,value]) => ({ configId: artifact.manifest.configs.find(item => item.name === name).id, type: 'Percent', value })) };
};

test('REF-04-064: actual activated host rejects the whole two-property proposal when one hourly rate is exceeded', async t => {
  const original = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url))).cases.find(item => item.id === 'REF-04-064');
  assert.ok(original, 'original Reference case must remain available');
  assert.equal(original.status, 'specified'); assert.equal(original.scope, 'host');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/258');
  const artifact = await compileSource(source, { filename: 'atomic-adaptation.ghost' });
  const host = await activate(artifact); t.after(() => host.dispose());
  assert.deepEqual(artifact.manifest.adaptSettings.map(item => [item.allowed,item.maxStep,item.maxChange,item.windowMs]),
    [[{min:0,max:100},10,10,3600000],[{min:0,max:100},10,10,3600000]]);
  const first = host.step(packet(0), proposal(host, artifact, 0, { second: 30 }));
  assert.equal(first.adaptation.accepted, true);
  assert.equal(host.snapshot().core.state.settingsRevision, 1);
  assert.deepEqual(first.outcome.vm.requested, { first_value: 20, second_value: 30 });
  const before = host.snapshot();
  const event = proposal(host, artifact, 1, { first: 25, second: 25 });
  const rejected = host.step(packet(1), event);
  assert.equal(rejected.outcome, null);
  assert.equal(rejected.adaptation.reason, 'rate-limit');
  assert.equal(rejected.adaptation.programFingerprint, before.core.state.programFingerprint);
  assert.equal(rejected.adaptation.baseRevision, 1);
  assert.equal(rejected.adaptation.settingsRevision, 1);
  assert.equal(rejected.adaptation.position, 2);
  assert.deepEqual(rejected.adaptation.proposal, event);
  assert.deepEqual(rejected.adaptation.changes.map(row => [row.old.value,row.proposed,row.effective.value]), [[20,25,20],[30,25,30]]);
  assert.deepEqual(host.snapshot(), before, 'rejection changes no core, clock, revision, position or accepted history');
  assert.deepEqual(host.step(packet(1)).outcome.vm.requested, { first_value:20, second_value:30 });
  // Exact excluded left boundary permits a real atomic event; rejected deltas
  // were never added to history. Absolute changes prevented down/up evasion.
  const accepted = host.step(packet(3600000), proposal(host, artifact, 3600000, { first:25, second:25 }));
  assert.equal(accepted.adaptation.accepted, true);
  assert.equal(accepted.adaptation.settingsRevision, 2);
  assert.deepEqual(accepted.outcome.vm.requested, { first_value:25, second_value:25 });
  const next = host.step(packet(3600001), proposal(host, artifact, 3600001, { second:30 }));
  assert.equal(next.adaptation.accepted, true);
  const alternating = host.step(packet(3600002), proposal(host, artifact, 3600002, { second:25 }));
  assert.equal(alternating.adaptation.reason, 'rate-limit');
});

test('adaptation preserves identity, authority, type and core-failure admission boundaries', async t => {
  const artifact = await compileSource(source, { filename: 'atomic-adaptation.ghost' });
  const host = await activate(artifact); t.after(() => host.dispose());
  for (const [change, reason] of [
    [event => { event.programFingerprint = '0000000000000000'; },'program-identity'],
    [event => { event.baseRevision = 9; },'settings-revision'],
    [event => { event.actor = 'untrusted'; },'actor-authority'],
    [event => { event.atMs = 1; },'occurrence-time'],
    [event => { event.changes[0].configId = 999; },'setting-identity'],
    [event => { event.changes[0].type = 'Pressure'; },'setting-type'],
    [event => { event.changes[0].value = 21.5; },'setting-grid'],
    [event => { event.changes[0].value = 31; },'max-step'],
  ]) {
    const before = host.snapshot(), event = proposal(host, artifact, 0, { first:25 }); change(event);
    assert.equal(host.step(packet(0), event).adaptation.reason, reason);
    assert.deepEqual(host.snapshot(), before);
  }
  const before = host.snapshot(), broken = packet(0); broken.contextFacts.clock.bootEpoch = 8;
  assert.throws(() => host.step(broken, proposal(host, artifact, 0, { first:25 })));
  assert.deepEqual(host.snapshot(), before, 'core rejection commits neither accepted history nor settings');
  assert.equal(host.step(packet(0), proposal(host, artifact, 0, { first:25 })).adaptation.accepted, true);
  const restored = host.snapshot(); restored.history.length = 0;
  assert.equal(host.snapshot().history.length, 1, 'caller snapshot is not mutable owner state');
  assert.throws(() => new AdaptationSettingsHost(), /fresh activation/);
  await assert.rejects(() => compileSource(source.replace('for first', 'for missing')), /target must reference a config/);
  await assert.rejects(() => compileSource(source.replace('max_step = 10%', 'max_step = 10Pa')), /type mismatch/);
  await assert.rejects(() => compileSource(source.replace('max_step = 10%', 'extra = 1; max_step = 10%')), /unsupported adaptation field/);
  await assert.rejects(() => compileSource(source.replace('max_step = 10%', 'maxChangeWindow = 1h; max_step = 10%')), /unsupported adaptation field/);
});

test('adaptation typed descriptors and activation reject malformed bounds and ambiguous targets', async () => {
  const artifact = await compileSource(source, { filename: 'atomic-adaptation.ghost' });
  for (const change of [
    policy => { policy.maxChange = NaN; }, policy => { policy.windowMs = 0; },
    policy => { delete policy.targetId; }, policy => { policy.targetType = 'Pressure'; },
    policy => { policy.allowed.min = 101; },
  ]) {
    const candidate = structuredClone(artifact); change(candidate.manifest.adaptSettings[0]);
    await assert.rejects(() => activate(candidate), /adaptation|adaptSettings/);
  }
  await assert.rejects(() => compileSource(source.replace('for second', 'for first')), /duplicate adaptation target/);
  await assert.rejects(() => compileSource(source.replace('max_step = 10%', 'max_step = 0%')), /positive/);
  await assert.rejects(() => compileSource(source.replace('per 1h', 'per 0ms')), /positive/);
  const temperature = source.replaceAll('Percent','Temperature').replace(/(\d+)%/g,
    (_, value) => `${value}${['1','10'].includes(value) ? 'Δ°C' : '°C'}`);
  const typed = await compileSource(temperature, { filename: 'temperature-adaptation.ghost' });
  assert.equal(typed.manifest.adaptSettings[0].maxStep, 10);
  await assert.rejects(() => compileSource(temperature.replace('max_step = 10Δ°C', 'max_step = 10°C')), /type mismatch/);
});

test('adaptation capacity and accepted-event identity fail closed without resetting rolling history', async t => {
  const artifact = await compileSource(source, { filename: 'atomic-adaptation.ghost' });
  const authorities = { model:'optimizer' };
  const host = await AdaptationSettingsHost.instantiate(wasm, artifact,
    { context: { bootEpoch:7, terminalCapacity:32, bindings:[] }, authorities, historyCapacity:2 });
  t.after(() => host.dispose()); authorities.model = 'intruder';
  const first = proposal(host, artifact, 0, { first:21, second:21 });
  assert.equal(host.step(packet(0), first).adaptation.accepted, true);
  let before = host.snapshot();
  const duplicate = proposal(host, artifact, 1, { first:22 }); duplicate.eventId = first.eventId;
  assert.equal(host.step(packet(1), duplicate).adaptation.reason, 'duplicate-event');
  assert.deepEqual(host.snapshot(), before);
  assert.equal(host.step(packet(1), proposal(host, artifact, 1, { first:22 })).adaptation.reason, 'history-capacity');
  assert.deepEqual(host.snapshot(), before);
  assert.equal(host.step(packet(3600000), proposal(host, artifact, 3600000, { first:22 })).adaptation.accepted, true);
  before = host.snapshot();
  assert.equal(host.step(packet(7200000), proposal(host, artifact, 7200000, { first:23 })).adaptation.reason, 'event-capacity');
  assert.deepEqual(host.snapshot(), before, 'expired rolling entries cannot erase accepted identity bounds');
});

test('adaptation Int grid uses exact remainder for large ranges before any core commit', async t => {
  const integers = source.replaceAll('Percent','Int').replace(/(\d+)%/g,
    (_, value) => ['20','0'].includes(value) ? '0' : '2147483646');
  const artifact = await compileSource(integers, { filename:'integer-adaptation.ghost' });
  const host = await activate(artifact); t.after(() => host.dispose());
  const before = host.snapshot(), event = proposal(host, artifact, 0, { first:1 }); event.changes[0].type = 'Int';
  assert.equal(host.step(packet(0), event).adaptation.reason, 'setting-grid');
  assert.deepEqual(host.snapshot(), before, 'a tiny ratio off-grid cannot pass a float epsilon');
  event.changes[0].value = 2147483646;
  assert.equal(host.step(packet(0), event).adaptation.accepted, true);
  assert.equal(host.snapshot().core.state.settings[0].result.value, 2147483646);
});

test('adaptation canonical source identity rejects an old policy proposal even with identical bytecode and core identity', async t => {
  const original = await compileSource(source, { filename:'atomic-adaptation.ghost' });
  const revised = await compileSource(source.replaceAll('max_change = 10%', 'max_change = 20%'), { filename:'atomic-adaptation.ghost' });
  assert.deepEqual(original.bytes, revised.bytes);
  assert.notEqual(original.sourceDocument.sha256, revised.sourceDocument.sha256);
  const oldHost = await activate(original), newHost = await activate(revised);
  t.after(() => { oldHost.dispose(); newHost.dispose(); });
  assert.equal(oldHost.snapshot().core.state.programFingerprint, newHost.snapshot().core.state.programFingerprint);
  const before = newHost.snapshot();
  const oldProposal = proposal(oldHost, original, 0, { first:25 });
  assert.equal(newHost.step(packet(0), oldProposal).adaptation.reason, 'source-identity');
  assert.deepEqual(newHost.snapshot(), before);
  oldProposal.sourceSha256 = revised.sourceDocument.sha256;
  assert.equal(newHost.step(packet(0), oldProposal).adaptation.reason, 'policy-identity');
  assert.deepEqual(newHost.snapshot(), before);
  assert.equal(newHost.step(packet(0), proposal(newHost, revised, 0, { first:25 })).adaptation.accepted, true);
});

test('adaptation Duration grid rejects a one-millisecond error across a large exact step', async t => {
  const duration = source.replaceAll('Percent','Duration').replace(/(\d+)%/g,
    (_, value) => ['20','0'].includes(value) ? '0ms' : '2000000000ms');
  const artifact = await compileSource(duration, { filename:'duration-adaptation.ghost' });
  const host = await activate(artifact); t.after(() => host.dispose());
  const before = host.snapshot(), event = proposal(host, artifact, 0, { first:1 }); event.changes[0].type = 'Duration';
  assert.equal(host.step(packet(0), event).adaptation.reason, 'setting-grid');
  assert.deepEqual(host.snapshot(), before);
  event.changes[0].value = 2000000000;
  assert.equal(host.step(packet(0), event).adaptation.accepted, true);
  assert.equal(host.snapshot().core.state.settings[0].result.value, 2000000000);
});
