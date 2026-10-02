import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GhostFlowStation } from '../runtimes/wasm/station.mjs';
import { bindStationPolicy } from '../runtimes/wasm/policy.mjs';
import { compileConstraints } from '../tools/constraints.mjs';
import { extractLiterate } from '../tools/literate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');

if (!existsSync(wasmPath)) {
  execFileSync('cargo', ['build', '-p', 'ghostflow-wasm', '--target', 'wasm32-unknown-unknown', '--release'], {
    cwd: root,
    stdio: 'inherit',
  });
}

const wasmBytes = readFileSync(wasmPath);

async function station(config = {}) {
  return GhostFlowStation.instantiate(wasmBytes, {
    valveCount: 4,
    maxOpenValves: 2,
    dailyQuotaMs: 1_000,
    maxStartBudgetMs: 800,
    ...config,
  });
}

function synchronize(instance, nowMs = 0n) {
  instance.synchronizeDay({ day: 20_000, nowMs, nextDayDeadlineMs: 10_000n, trusted: true });
}

function enterAuto(instance, requestId = 1n) {
  instance.enter({ requestId, ...instance.claim, mode: 'Auto' });
}

function startRequest(instance, requestId, occurrenceId, nowMs = 10n, budgetMs = 100n) {
  return {
    requestId,
    ...instance.claim,
    sessionId: 77n,
    ownerId: 88n,
    mode: 'Auto',
    valves: 0b11n,
    budgetMs,
    occurrenceId,
    nowMs,
  };
}

test('uses the built WASM and keeps optional capacity advisory', async () => {
  const instance = await station();
  synchronize(instance);
  enterAuto(instance);
  const writes = [];
  const grant = await instance.start(startRequest(instance, 2n, 501n), async (bytes, token) => {
    writes.push({ bytes: bytes.slice(), token });
    return true;
  });
  assert.equal(grant.capacity, 'Unknown');
  assert.equal(writes.length, 1);
  assert(writes[0].bytes.length > 16);
  const output = instance.authorizeOutput({ sessionId: 77n, pumpOn: true, valves: 1n, nowMs: 10n });
  assert.equal(output.pumpOn, true);
  instance.reportApplied({ sessionId: 77n, pumpOn: true, valves: 1n, nowMs: 10n });
  instance.reportApplied({ sessionId: 77n, pumpOn: false, valves: 0n, nowMs: 110n });
  instance.requestStop({ requestId: 3n, ...instance.claim });
  await instance.finish({ sessionId: 77n, outcome: 'Cancelled', nowMs: 110n }, async () => true);
  assert.equal(instance.dailyUsedMs, 100n);
  assert.equal(instance.reservedMs, 0n);
  instance.dispose();
});

test('REF-04-047: checked Station source native/WASM capacity is advisory Unknown unless Pass is required', async t => {
  const reference = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8'))
    .cases.find(entry => entry.id === 'REF-04-047');
  assert.equal(reference.scope, 'runtime');
  assert.match(reference.given, /Unknown/);
  assert.match(reference.when, /check.*require Pass/);
  assert(reference.issue.endsWith('/246'));
  const filename = 'examples/station-rules.ghost.md';
  const advisory = readFileSync(resolve(root, filename), 'utf8');
  const strict = advisory.replace('check pump_capacity(pump1);', 'require pump_capacity(pump1) == Pass;');
  assert.notEqual(strict, advisory);
  const bindings = {
    station: { id: 'station', config: { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 1000, maxStartBudgetMs: 800 } },
    pump: { id: 'pump1' }, settings: { id: 'settings' },
    schedules: { starts: { id: 'starts', timezone: 'Asia/Seoul' } },
    modeAliases: { Auto: 'Auto', Manual: 'Manual', Configure: 'Configure' },
    activityAliases: { automatic: 'Auto', manual: 'Manual', configuring: 'Configure' },
  };
  const compile = source => compileConstraints(extractLiterate(source, { filename }).code, { filename });
  const sha = value => createHash('sha256').update(value).digest('hex');
  const fingerprint = bytes => {
    let hash = 0xcbf29ce484222325n;
    for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
    return hash.toString(16).padStart(16, '0');
  };
  // Trusted host inputs: these paired flows are already expressed in L/min
  // under one validated operating condition. No pressure quantity is passed
  // to or summed by either owner; missing curve context supplies absent flow.
  const cases = [
    { label: 'missing curve context', capacity: {}, expected: 'Unknown' },
    { label: 'missing available flow', capacity: { requestedFlow: 10 }, expected: 'Unknown' },
    { label: 'missing requested flow', capacity: { availableFlow: 10 }, expected: 'Unknown' },
    { label: 'below available flow', capacity: { availableFlow: 10, requestedFlow: 9 }, expected: 'Pass' },
    { label: 'equal available flow', capacity: { availableFlow: 10, requestedFlow: 10 }, expected: 'Pass' },
    { label: 'above available flow', capacity: { availableFlow: 10, requestedFlow: 11 }, expected: 'Violation' },
  ];
  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'station_capacity_tape'], {
    cwd: root, stdio: 'inherit',
  });
  const runner = resolve(root, 'target/release/examples/station_capacity_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const directory = mkdtempSync(join(tmpdir(), 'reference-station-capacity-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactPath = join(directory, 'constraints.json'), tapePath = join(directory, 'tape.json');
  const identities = [];
  for (const [source, required] of [[advisory, false], [strict, true]]) {
    const artifact = compile(source), policy = bindStationPolicy(artifact, bindings);
    assert.equal(policy.stationConfig.requireCapacityPass, required);
    assert.deepEqual(policy.checks, [{ kind: 'capacityCheck', pump: 'pump1', required, missing: 'Unknown', blocking: required }]);
    const bytes = Buffer.from(JSON.stringify(artifact));
    const identity = { sourceSha256: sha(source), artifactSha256: sha(bytes), bindingSha256: sha(JSON.stringify(bindings)),
      policySha256: sha(JSON.stringify(policy)), artifactFingerprint: fingerprint(bytes) };
    identities.push(identity);
    // Validate the exact source -> checked artifact -> bound configuration
    // immediately before crossing the test-only native transport boundary.
    assert.deepEqual(compile(source), artifact);
    assert.deepEqual(bindStationPolicy(artifact, bindings), policy);
    writeFileSync(artifactPath, bytes);
    const tape = { artifactFingerprint: identity.artifactFingerprint, stationConfig: policy.stationConfig, cases };
    writeFileSync(tapePath, JSON.stringify(tape));
    const native = JSON.parse(execFileSync(runner, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10_000 }));
    assert.equal(native.artifactFingerprint, identity.artifactFingerprint);
    const observations = [];
    for (const row of cases) {
      const instance = await GhostFlowStation.instantiate(wasmBytes, policy.stationConfig);
      try {
        synchronize(instance);
        enterAuto(instance);
        const before = instance.claim;
        let writes = 0;
        const persist = async bytes => { assert(bytes.length > 16); writes++; return true; };
        const grantObservation = (grant, nowMs) => {
          const output = instance.authorizeOutput({ sessionId: 77n, pumpOn: true, valves: 1n, nowMs });
          return { capacity: grant.capacity, leaseDeadlineMs: Number(grant.leaseDeadlineMs),
            reservedMs: Number(instance.reservedMs), pumpOn: output.pumpOn, valves: Number(output.valves), durableWrites: writes };
        };
        const request = { ...startRequest(instance, 2n, 501n), capacity: row.capacity };
        let initial, retry = null;
        if (required && row.expected !== 'Pass') {
          await assert.rejects(instance.start(request, persist), { message: 'required pump capacity check was not Pass' });
          assert.deepEqual(instance.claim, before);
          assert.equal(instance.reservedMs, 0n);
          assert.equal(writes, 0);
          assert.throws(() => instance.authorizeOutput({ sessionId: 77n, pumpOn: true, valves: 1n, nowMs: 10n }), /session does not own/);
          assert.throws(() => instance.commitStart(1n), /no matching prepared transition/);
          initial = { rejected: true, error: 'required pump capacity check was not Pass', unchanged: true,
            reservedMs: 0, durableWrites: 0, noGrant: true, noPending: true };
          // Same request/session/occurrence can retry: rejection consumed none
          // of their identities and left no partial durable reservation.
          retry = grantObservation(await instance.start({ ...request, nowMs: 11n,
            capacity: { availableFlow: 10, requestedFlow: 10 } }, persist), 11n);
          assert.deepEqual(retry, { capacity: 'Pass', leaseDeadlineMs: 111, reservedMs: 100,
            pumpOn: true, valves: 1, durableWrites: 1 });
        } else {
          const grant = grantObservation(await instance.start(request, persist), 10n);
          assert.deepEqual(grant, { capacity: row.expected, leaseDeadlineMs: 110, reservedMs: 100,
            pumpOn: true, valves: 1, durableWrites: 1 });
          initial = { rejected: false, grant };
        }
        observations.push({ label: row.label, initial, retry });
      } finally { instance.dispose(); }
    }
    assert.deepEqual(native.observations, observations);
    writeFileSync(tapePath, JSON.stringify({ ...tape, artifactFingerprint: '0000000000000000' }));
    assert.throws(() => execFileSync(runner, [artifactPath, tapePath], { encoding: 'utf8', stdio: 'pipe' }), /checked constraint artifact identity mismatch/);
    t.diagnostic(JSON.stringify({ required, identity, observations }));
  }
  assert.notEqual(identities[0].sourceSha256, identities[1].sourceSha256);
  assert.notEqual(identities[0].artifactSha256, identities[1].artifactSha256);
  assert.notEqual(identities[0].policySha256, identities[1].policySha256);
  assert.equal(identities[0].bindingSha256, identities[1].bindingSha256);
  assert.throws(() => bindStationPolicy(compile(advisory), { ...bindings, pump: { id: 'valve1' } }), /unbound pump identifier pump1/);
  assert.throws(() => bindStationPolicy(compile(advisory.replace('pump_capacity(pump1)', 'pump_capacity(missing)')), bindings), /unbound pump identifier missing/);
  assert.throws(() => compile(advisory.replace('pump_capacity(pump1)', 'pump_capacity(flow + pressure)')), /unexpected character "\+"/);
});

test('immediate Stop cancels a hanging Start persistence before it can grant output', async () => {
  const instance = await station();
  synchronize(instance);
  enterAuto(instance);
  let releasePersistence;
  const starting = instance.start(
    startRequest(instance, 2n, 502n),
    () => new Promise((resolvePersistence) => { releasePersistence = resolvePersistence; }),
  );
  await Promise.resolve();
  const directive = instance.requestStop({ requestId: 3n, ...instance.claim, skippedOccurrenceIds: [502n] });
  assert.deepEqual(directive, { forceSafeOutputs: true, reason: 'StopRequested' });
  assert.equal(instance.stopping, true);
  assert(instance.snapshot().length > 16);
  assert.throws(() => instance.commitStart(1n), /no matching prepared transition/);
  releasePersistence(false);
  await assert.rejects(starting, /did not acknowledge/);
  assert.throws(() => instance.authorizeOutput({ sessionId: 77n, pumpOn: true, valves: 1n, nowMs: 11n }));
  instance.dispose();
});

test('stop invokes its synchronous safe-output callback before hanging or rejected persistence', async () => {
  const instance = await station();
  synchronize(instance);
  enterAuto(instance);
  const order = [];
  let releasePersistence;
  const stopping = instance.stop({ requestId: 2n, ...instance.claim, skippedOccurrenceIds: [599n] }, (bytes, token) => {
    order.push('persist');
    assert.equal(token, 0n);
    assert(bytes.length > 16);
    return new Promise((resolvePersistence) => { releasePersistence = resolvePersistence; });
  }, (directive) => {
    order.push('safe');
    assert.deepEqual(directive, { forceSafeOutputs: true, reason: 'StopRequested' });
  });
  assert.deepEqual(order, ['safe', 'persist']);
  assert.equal(instance.stopping, true);
  releasePersistence(false);
  await assert.rejects(stopping, /did not acknowledge/);
  instance.dispose();
});

test('advance returns a safe-output directive when the finite lease expires', async () => {
  const instance = await station();
  synchronize(instance);
  enterAuto(instance);
  await instance.start(startRequest(instance, 2n, undefined, 10n, 100n), async () => true);
  assert.deepEqual(instance.advance(109n), { forceSafeOutputs: false, reason: undefined });
  assert.deepEqual(instance.advance(110n), { forceSafeOutputs: true, reason: 'LeaseExpired' });
  instance.dispose();
});

test('a pending start that outlives its lease cannot commit or rewind monotonic time', async () => {
  const instance = await station();
  synchronize(instance);
  enterAuto(instance);
  const prepared = instance.prepareStart(startRequest(instance, 2n, 504n, 10n, 100n));
  assert.deepEqual(instance.advance(110n), { forceSafeOutputs: false, reason: undefined });
  assert.throws(() => instance.commitStart(prepared.token), /lease/i);
  assert.equal(instance.reservedMs, 100n);
  assert.throws(() => instance.advance(109n), /monotonic/i);
  instance.dispose();
});

test('restored active reservation is held, then still deduplicates its occurrence', async () => {
  const original = await station();
  synchronize(original);
  enterAuto(original);
  await original.start(startRequest(original, 2n, 503n), async () => true);
  const snapshot = original.snapshot();
  const restored = new GhostFlowStation(original.wasm, { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 1_000, maxStartBudgetMs: 800 });
  restored.restore(snapshot);
  synchronize(restored, 1n);
  restored.acknowledgeRecoverySafeOutput({ nowMs: 2n });
  enterAuto(restored, 3n);
  assert.throws(() => restored.prepareStart(startRequest(restored, 4n, 503n, 10n)), /occurrence id was already accepted/);
  original.dispose();
  restored.dispose();
});

test('restore rejects a snapshot made with different safety configuration', async () => {
  const original = await station();
  synchronize(original);
  const snapshot = original.snapshot();
  const mismatched = new GhostFlowStation(original.wasm, { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 1_000, maxStartBudgetMs: 799 });
  assert.throws(() => mismatched.restore(snapshot), /safety configuration/i);
  original.dispose();
  mismatched.dispose();
});

test('wrapper rejects narrowing/coercion and use after disposal', async () => {
  const instance = await station();
  assert.throws(() => instance.synchronizeDay({ day: 1.5, nowMs: 0n, nextDayDeadlineMs: 10n, trusted: true }), /32-bit/);
  assert.throws(() => instance.synchronizeDay({ day: 1, nowMs: Number.MAX_SAFE_INTEGER + 1, nextDayDeadlineMs: 10n, trusted: true }), /safe integer/);
  synchronize(instance);
  enterAuto(instance);
  assert.throws(() => instance.prepareStart({ ...startRequest(instance, 2n, undefined), valves: '3' }), /BigInt or safe integer/);
  assert.throws(() => instance.authorizeOutput({ sessionId: 77n, pumpOn: 1, valves: 1n, nowMs: 10n }), /boolean/);
  instance.dispose();
  assert.throws(() => instance.snapshot(), /disposed/);
  assert.throws(() => instance.claim, /disposed/);
});
