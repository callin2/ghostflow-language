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

test('REF-04-057: checked Station source native/WASM reserves worst ON plus stop delay and enforces finite manual cutoff', async t => {
  const reference = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8')).cases.find(entry => entry.id === 'REF-04-057');
  assert.equal(reference.scope, 'runtime');
  assert.equal(reference.status, 'specified');
  assert(reference.issue.endsWith('/255'));
  assert.match(reference.given, /remaining=8min, worst ON=7min, stop delay=2min/);
  const filename = 'examples/station-rules.ghost.md';
  const source = readFileSync(resolve(root, filename), 'utf8').replace('<= 1h per day', '<= 8min per day');
  const bindings = {
    station: { id: 'station', config: { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 3_600_000, maxStartBudgetMs: 600_000 } },
    pump: { id: 'pump1' }, settings: { id: 'settings' }, schedules: { starts: { id: 'starts', timezone: 'Asia/Seoul' } },
    modeAliases: { Auto: 'Auto', Manual: 'Manual', Configure: 'Configure' },
    activityAliases: { automatic: 'Auto', manual: 'Manual', configuring: 'Configure' },
  };
  const compile = value => compileConstraints(extractLiterate(value, { filename }).code, { filename });
  const artifact = compile(source), policy = bindStationPolicy(artifact, bindings);
  assert.equal(policy.stationConfig.dailyQuotaMs, 480_000);
  assert(policy.stationConfig.maxStartBudgetMs >= 540_000);
  // These explicit host planner inputs are not new language syntax. Both real
  // owners receive their total finite bound, derived independently from 7+2.
  const planningInputs = { worstOnMs: 420_000, stopDelayMs: 120_000, manualCutoffMs: 360_000 };
  const sum = (a, b) => {
    assert(Number.isSafeInteger(a) && a > 0 && Number.isSafeInteger(b) && b >= 0, 'finite cutoff required');
    const total = a + b;
    assert(Number.isSafeInteger(total), 'reservation overflow');
    return total;
  };
  const automatic = sum(planningInputs.worstOnMs, planningInputs.stopDelayMs);
  const manual = sum(planningInputs.manualCutoffMs, planningInputs.stopDelayMs);
  assert.equal(automatic, 540_000); assert.equal(manual, 480_000);
  assert.throws(() => sum(undefined, planningInputs.stopDelayMs), /finite cutoff required/);
  assert.throws(() => sum(Infinity, planningInputs.stopDelayMs), /finite cutoff required/);
  assert.throws(() => sum(Number.MAX_SAFE_INTEGER, 1), /reservation overflow/);
  const bytes = Buffer.from(JSON.stringify(artifact)), sha = value => createHash('sha256').update(value).digest('hex');
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  const identity = { sourceSha256: sha(source), artifactSha256: sha(bytes), bindingSha256: sha(JSON.stringify(bindings)), policySha256: sha(JSON.stringify(policy)), artifactFingerprint: hash.toString(16).padStart(16, '0') };
  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'station_ownership_tape'], { cwd: root, stdio: 'inherit' });
  const runner = resolve(root, 'target/release/examples/station_ownership_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const directory = mkdtempSync(join(tmpdir(), 'reference-reservation-cutoff-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactPath = join(directory, 'constraints.json'), tapePath = join(directory, 'tape.json');
  assert.deepEqual(compile(source), artifact); assert.deepEqual(bindStationPolicy(artifact, bindings), policy);
  writeFileSync(artifactPath, bytes);
  const tape = { artifactFingerprint: identity.artifactFingerprint, stationConfig: policy.stationConfig, scenario: 'reservationCutoff', ...planningInputs };
  writeFileSync(tapePath, JSON.stringify(tape));
  const native = JSON.parse(execFileSync(runner, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10_000 }));
  const instance = await GhostFlowStation.instantiate(wasmBytes, policy.stationConfig);
  const recovered = await GhostFlowStation.instantiate(wasmBytes, policy.stationConfig);
  try {
    instance.synchronizeDay({ day: 20_000, nowMs: 0n, nextDayDeadlineMs: 86_400_000n, trusted: true }); enterAuto(instance);
    const request = budgetMs => ({ ...startRequest(instance, 2n, undefined, 0n, BigInt(budgetMs)), mode: instance.mode });
    let writes = 0;
    const persist = async image => { assert(image.length > 16); writes++; return true; };
    const ledger = () => ({ reservedMs: Number(instance.reservedMs), dailyUsedMs: Number(instance.dailyUsedMs) });
    await assert.rejects(instance.start(request(automatic), persist), /quota/);
    assert.equal(writes, 0); assert.equal(instance.reservedMs, 0n);
    const trace = [{ event: 'automaticRejected', budgetMs: automatic, error: 'QuotaExceeded', ...ledger() }];
    instance.requestStop({ requestId: 4n, ...instance.claim }); instance.confirmStopped({ nowMs: 0n });
    instance.enter({ requestId: 5n, ...instance.claim, mode: 'Manual' });
    for (const budget of [0n, 0xffff_ffff_ffff_ffffn]) await assert.rejects(instance.start(request(budget), persist), /finite.*maximum/);
    const missing = request(1); delete missing.budgetMs;
    await assert.rejects(instance.start(missing, persist), /budgetMs/);
    assert.equal(writes, 0);
    trace.push({ event: 'manualUnboundedRejected', ...ledger() });
    const grant = await instance.start(request(manual), persist);
    assert.equal(grant.leaseDeadlineMs, BigInt(manual));
    const on = { sessionId: 77n, pumpOn: true, valves: 1n, nowMs: 0n };
    instance.authorizeOutput(on); instance.reportApplied(on);
    trace.push({ event: 'finiteManualGranted', cutoffMs: planningInputs.manualCutoffMs, budgetMs: manual, leaseDeadlineMs: Number(grant.leaseDeadlineMs), reservedMs: Number(instance.reservedMs) });
    const acknowledgedSnapshot = instance.snapshot();
    assert(await persist(acknowledgedSnapshot));
    recovered.restore(acknowledgedSnapshot);
    recovered.synchronizeDay({ day: 20_000, nowMs: 0n, nextDayDeadlineMs: 86_400_000n, trusted: true });
    await assert.rejects(recovered.start({ ...request(manual), ...recovered.claim, requestId: 3n }, persist), /recovered uncertain reservation requires safe-output acknowledgement/);
    assert.equal(recovered.reservedMs, BigInt(manual));
    assert.equal(recovered.dailyUsedMs, 0n);
    trace.push({ event: 'recoveryHold', reservedMs: Number(recovered.reservedMs), dailyUsedMs: Number(recovered.dailyUsedMs) });
    const cutoff = BigInt(planningInputs.manualCutoffMs);
    instance.advance(cutoff);
    const directive = instance.requestStop({ requestId: 6n, ...instance.claim }); assert.equal(directive.forceSafeOutputs, true);
    trace.push({ event: 'manualCutoff', nowMs: Number(cutoff), forceSafeOutput: directive.forceSafeOutputs, reservedMs: Number(instance.reservedMs) });
    const deadline = instance.advance(BigInt(manual)); assert.equal(deadline.forceSafeOutputs, true);
    assert.throws(() => instance.authorizeOutput({ ...on, nowMs: BigInt(manual) }), /stop is in progress/);
    trace.push({ event: 'leaseDeadline', nowMs: manual, forceSafeOutput: deadline.forceSafeOutputs, reservedMs: Number(instance.reservedMs) });
    // Delayed applied SAFE fixture at cutoff+stop delay: total applied ON=8min.
    instance.reportApplied({ sessionId: 77n, pumpOn: false, valves: 0n, nowMs: BigInt(manual) });
    const finish = instance.prepareFinish({ sessionId: 77n, outcome: 'Cancelled', nowMs: BigInt(manual) });
    assert.throws(() => instance.commitFinish(finish.token + 1n), /token does not match/);
    await assert.rejects(instance.start(request(manual), persist), /awaiting commit or abort/);
    trace.push({ event: 'finishPending', ...ledger(), mode: instance.mode });
    assert(await persist(finish.bytes));
    instance.commitFinish(finish.token);
    trace.push({ event: 'settledApplied', ...ledger(), mode: instance.mode });
    assert.equal(instance.dailyUsedMs, 480_000n); assert.equal(instance.reservedMs, 0n); assert.equal(writes, 3);
    assert.deepEqual(native, { artifactFingerprint: identity.artifactFingerprint, scenario: 'reservationCutoff', trace });
    t.diagnostic(JSON.stringify({ identity, planningInputs, automaticRequiredMs: automatic, manualReserveMs: manual, trace }));
  } finally { instance.dispose(); recovered.dispose(); }
  writeFileSync(tapePath, JSON.stringify({ ...tape, artifactFingerprint: '0000000000000000' }));
  assert.throws(() => execFileSync(runner, [artifactPath, tapePath], { encoding: 'utf8', stdio: 'pipe' }), /checked constraint artifact identity mismatch/);
  assert.throws(() => bindStationPolicy(artifact, { ...bindings, pump: { id: 'missing' } }), /unbound pump identifier pump1/);
  assert.throws(() => bindStationPolicy(compile(source.replace('pump_capacity(pump1)', 'pump_capacity(missing)')), bindings), /unbound pump identifier missing/);
});

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

test('REF-04-048: checked Station source native/WASM owner grant survives inactive false in either same-tick order', async t => {
  const reference = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8'))
    .cases.find(entry => entry.id === 'REF-04-048');
  assert(reference, 'retain the original shared pump reference');
  assert.equal(reference.scope, 'runtime');
  assert.match(reference.given, /control A.*lease.*true.*B.*false/);
  assert.match(reference.when, /tick intents.*arbitrate/);
  assert.match(reference.then, /A.*session.*final intent.*B.*false/);
  assert(reference.issue.endsWith('/247'));
  const filename = 'examples/station-rules.ghost.md';
  const source = readFileSync(resolve(root, filename), 'utf8');
  const bindings = {
    station: { id: 'station', config: { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 1000, maxStartBudgetMs: 800 } },
    pump: { id: 'pump1' }, settings: { id: 'settings' },
    schedules: { starts: { id: 'starts', timezone: 'Asia/Seoul' } },
    modeAliases: { Auto: 'Auto', Manual: 'Manual', Configure: 'Configure' },
    activityAliases: { automatic: 'Auto', manual: 'Manual', configuring: 'Configure' },
  };
  const compile = value => compileConstraints(extractLiterate(value, { filename }).code, { filename });
  const artifact = compile(source), policy = bindStationPolicy(artifact, bindings);
  const bytes = Buffer.from(JSON.stringify(artifact));
  const sha = value => createHash('sha256').update(value).digest('hex');
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  const identity = { sourceSha256: sha(source), artifactSha256: sha(bytes),
    bindingSha256: sha(JSON.stringify(bindings)), policySha256: sha(JSON.stringify(policy)),
    artifactFingerprint: hash.toString(16).padStart(16, '0') };
  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'station_ownership_tape'], {
    cwd: root, stdio: 'inherit',
  });
  const runner = resolve(root, 'target/release/examples/station_ownership_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const directory = mkdtempSync(join(tmpdir(), 'reference-station-ownership-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactPath = join(directory, 'constraints.json'), tapePath = join(directory, 'tape.json');
  assert.deepEqual(compile(source), artifact);
  assert.deepEqual(bindStationPolicy(artifact, bindings), policy);
  writeFileSync(artifactPath, bytes);
  for (const order of ['AB', 'BA']) {
    const tape = { artifactFingerprint: identity.artifactFingerprint, stationConfig: policy.stationConfig, order };
    writeFileSync(tapePath, JSON.stringify(tape));
    const native = JSON.parse(execFileSync(runner, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10_000 }));
    const instance = await GhostFlowStation.instantiate(wasmBytes, policy.stationConfig);
    try {
      synchronize(instance);
      enterAuto(instance);
      let writes = 0;
      const persist = async snapshot => { assert(snapshot.length > 16); writes++; return true; };
      const grant = await instance.start(startRequest(instance, 2n, undefined), persist);
      const ownerClaim = instance.claim;
      const trace = [{ event: 'lease', nowMs: 10, sessionId: 77,
        leaseDeadlineMs: Number(grant.leaseDeadlineMs), reservedMs: Number(instance.reservedMs) }];
      const on = { sessionId: 77n, pumpOn: true, valves: 1n };
      const off = { sessionId: 77n, pumpOn: false, valves: 1n };
      const inactive = { sessionId: 78n, pumpOn: false, valves: 0n };
      for (const actor of order) {
        if (actor === 'A') {
          const output = instance.authorizeOutput({ ...on, nowMs: 10n });
          trace.push({ event: 'request', actor, nowMs: 10, pumpOn: true,
            accepted: true, sessionId: Number(output.sessionId), valves: Number(output.valves) });
        } else {
          assert.throws(() => instance.authorizeOutput({ ...inactive, nowMs: 10n }), /session does not own/);
          trace.push({ event: 'request', actor, nowMs: 10, pumpOn: false,
            accepted: false, error: 'SessionMismatch' });
        }
      }
      // This is a host-supplied applied fixture, not a physical driver receipt.
      // Do not reauthorize: reportApplied checks the ON grant retained by Rust
      // after B's rejected OFF request, exposing a last-writer regression.
      instance.reportApplied({ ...on, nowMs: 10n });
      assert.throws(() => instance.reportApplied({ ...inactive, nowMs: 10n }), /session does not own/);
      trace.push({ event: 'appliedFixture', nowMs: 10, sessionId: 77, pumpOn: true,
        valves: 1, nonownerReportRejected: true });
      instance.advance(20n);
      trace.push({ event: 'ledger', nowMs: 20, dailyUsedMs: Number(instance.dailyUsedMs),
        reservedMs: Number(instance.reservedMs) });
      // The active session accrues ON time internally; dailyUsedMs settles
      // only at durable finish, while its full budget remains reserved.
      assert.equal(instance.dailyUsedMs, 0n);
      instance.authorizeOutput({ ...off, nowMs: 20n });
      assert.throws(() => instance.authorizeOutput({ ...inactive, nowMs: 20n }), /session does not own/);
      instance.reportApplied({ ...off, nowMs: 20n });
      assert.throws(() => instance.prepareStart({ ...startRequest(instance, 3n, undefined, 20n),
        sessionId: 78n, ownerId: 89n }), /already.*owner|owned/i);
      assert.equal(instance.reservedMs, 100n);
      assert.deepEqual(instance.claim, ownerClaim);
      assert.equal(writes, 1);
      trace.push({ event: 'betweenPhases', nowMs: 20, sessionId: 77, pumpOn: false, valves: 1,
        nonownerRejected: true, acquisitionRejected: 'AlreadyOwned', reservedMs: Number(instance.reservedMs) });
      instance.authorizeOutput({ ...on, nowMs: 30n });
      instance.reportApplied({ ...on, nowMs: 30n });
      trace.push({ event: 'appliedFixture', nowMs: 30, sessionId: 77, pumpOn: true, valves: 1 });
      instance.authorizeOutput({ sessionId: 77n, pumpOn: false, valves: 0n, nowMs: 40n });
      instance.reportApplied({ sessionId: 77n, pumpOn: false, valves: 0n, nowMs: 40n });
      await instance.finish({ sessionId: 77n, outcome: 'Completed', nowMs: 40n }, persist);
      trace.push({ event: 'finish', nowMs: 40, dailyUsedMs: Number(instance.dailyUsedMs),
        reservedMs: Number(instance.reservedMs) });
      assert.equal(instance.dailyUsedMs, 20n);
      assert.equal(instance.reservedMs, 0n);
      assert.equal(writes, 2);
      assert.throws(() => instance.authorizeOutput({ ...on, nowMs: 40n }), /session does not own/);
      assert.deepEqual(native, { artifactFingerprint: identity.artifactFingerprint, order, trace });
      t.diagnostic(JSON.stringify({ identity, order, trace }));
    } finally { instance.dispose(); }
    writeFileSync(tapePath, JSON.stringify({ ...tape, artifactFingerprint: '0000000000000000' }));
    assert.throws(() => execFileSync(runner, [artifactPath, tapePath], { encoding: 'utf8', stdio: 'pipe' }), /checked constraint artifact identity mismatch/);
  }
  assert.throws(() => bindStationPolicy(artifact, { ...bindings, pump: { id: 'valve1' } }), /unbound pump identifier pump1/);
  assert.throws(() => bindStationPolicy(compile(source.replace('pump_capacity(pump1)', 'pump_capacity(missing)')), bindings), /unbound pump identifier missing/);
});

test('REF-04-049: checked Station source native/WASM retains the session lease through OFF cleanup and durable stop completion', async t => {
  const reference = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8'))
    .cases.find(entry => entry.id === 'REF-04-049');
  assert(reference, 'retain the original whole-session lease reference');
  assert.equal(reference.scope, 'runtime');
  assert.match(reference.given, /A session.*pump OFF.*cleanup.*B/);
  assert.match(reference.when, /lease admission/);
  assert.match(reference.then, /A.*ownership.*B.*queue\/admission/);
  assert(reference.issue.endsWith('/248'));
  const filename = 'examples/station-rules.ghost.md';
  const source = readFileSync(resolve(root, filename), 'utf8');
  const bindings = {
    station: { id: 'station', config: { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 1000, maxStartBudgetMs: 800 } },
    pump: { id: 'pump1' }, settings: { id: 'settings' },
    schedules: { starts: { id: 'starts', timezone: 'Asia/Seoul' } },
    modeAliases: { Auto: 'Auto', Manual: 'Manual', Configure: 'Configure' },
    activityAliases: { automatic: 'Auto', manual: 'Manual', configuring: 'Configure' },
  };
  const compile = value => compileConstraints(extractLiterate(value, { filename }).code, { filename });
  const artifact = compile(source), policy = bindStationPolicy(artifact, bindings);
  const bytes = Buffer.from(JSON.stringify(artifact));
  const sha = value => createHash('sha256').update(value).digest('hex');
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  const identity = { sourceSha256: sha(source), artifactSha256: sha(bytes),
    bindingSha256: sha(JSON.stringify(bindings)), policySha256: sha(JSON.stringify(policy)),
    artifactFingerprint: hash.toString(16).padStart(16, '0') };
  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'station_ownership_tape'], {
    cwd: root, stdio: 'inherit',
  });
  const runner = resolve(root, 'target/release/examples/station_ownership_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const directory = mkdtempSync(join(tmpdir(), 'reference-station-lifecycle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactPath = join(directory, 'constraints.json'), tapePath = join(directory, 'tape.json');
  // This approved fixed Station adapter uses reject admission, not a hidden
  // queue or generic resource-policy VM. Both real owners receive this config.
  assert.deepEqual(compile(source), artifact);
  assert.deepEqual(bindStationPolicy(artifact, bindings), policy);
  writeFileSync(artifactPath, bytes);
  const tape = { artifactFingerprint: identity.artifactFingerprint, stationConfig: policy.stationConfig, scenario: 'lifecycle' };
  writeFileSync(tapePath, JSON.stringify(tape));
  const native = JSON.parse(execFileSync(runner, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10_000 }));
  const instance = await GhostFlowStation.instantiate(wasmBytes, policy.stationConfig);
  try {
    synchronize(instance);
    enterAuto(instance);
    let writes = 0;
    const persist = async snapshot => { assert(snapshot.length > 16); writes++; return true; };
    const grant = await instance.start(startRequest(instance, 2n, undefined), persist);
    const trace = [{ event: 'lease', nowMs: 10, sessionId: 77,
      leaseDeadlineMs: Number(grant.leaseDeadlineMs), reservedMs: Number(instance.reservedMs) }];
    const bRequest = nowMs => ({ ...startRequest(instance, 3n, undefined, nowMs), sessionId: 78n, ownerId: 89n });
    const ledger = () => ({ reservedMs: Number(instance.reservedMs), dailyUsedMs: Number(instance.dailyUsedMs) });
    for (const [event, nowMs, pumpOn, valves] of [
      ['preopen', 10n, false, 1n], ['on', 20n, true, 1n],
      ['betweenStages', 30n, false, 1n], ['cleanup', 40n, false, 2n],
    ]) {
      const output = { sessionId: 77n, pumpOn, valves, nowMs };
      instance.authorizeOutput(output);
      instance.reportApplied(output); // host fixture, not a physical driver receipt
      const before = instance.claim;
      await assert.rejects(instance.start(bRequest(nowMs), persist), /already owned/);
      assert.deepEqual(instance.claim, before);
      assert.equal(instance.reservedMs, 100n);
      assert.equal(instance.dailyUsedMs, 0n);
      assert.equal(writes, 1);
      assert.throws(() => instance.commitStart(999n), /no matching prepared transition/);
      trace.push({ event, nowMs: Number(nowMs), sessionId: 77, pumpOn, valves: Number(valves),
        admission: 'AlreadyOwned', ...ledger() });
    }
    assert.throws(() => instance.prepareFinish({ sessionId: 77n, outcome: 'Cancelled', nowMs: 40n }), /pump and valves safely off/);
    const directive = instance.requestStop({ requestId: 4n, ...instance.claim });
    assert.equal(directive.forceSafeOutputs, true);
    await assert.rejects(instance.start(bRequest(40n), persist), /stop is in progress/);
    assert.throws(() => instance.confirmStopped({ nowMs: 40n }), /active session needs durable/);
    assert.equal(instance.mode, 'Auto');
    trace.push({ event: 'stopBarrier', nowMs: 40, mode: instance.mode, stopping: instance.stopping,
      admission: 'Stopping', sessionId: 77, ...ledger() });
    instance.reportApplied({ sessionId: 77n, pumpOn: false, valves: 0n, nowMs: 50n });
    await assert.rejects(instance.start(bRequest(50n), persist), /stop is in progress/);
    assert.throws(() => instance.confirmStopped({ nowMs: 50n }), /active session needs durable/);
    const finish = instance.prepareFinish({ sessionId: 77n, outcome: 'Cancelled', nowMs: 50n });
    assert(finish.bytes.length > 16);
    await assert.rejects(instance.start(bRequest(50n), persist), /awaiting commit or abort/);
    assert.throws(() => instance.commitFinish(finish.token + 1n), /token does not match/);
    assert.equal(instance.mode, 'Auto');
    assert.equal(instance.stopping, true);
    assert.equal(instance.reservedMs, 100n);
    assert.equal(instance.dailyUsedMs, 0n);
    assert.equal(writes, 1);
    trace.push({ event: 'finishPending', nowMs: 50, mode: instance.mode, stopping: instance.stopping,
      admission: 'PendingPersistence', sessionId: 77, pumpOn: false, valves: 0, ...ledger() });
    // Explicit simulated durable ACK boundary: a wrong ACK above retained A.
    assert(await persist(finish.bytes));
    instance.commitFinish(finish.token);
    assert.equal(instance.mode, 'Stopped');
    assert.equal(instance.stopping, false);
    assert.equal(instance.dailyUsedMs, 10n);
    assert.equal(instance.reservedMs, 0n);
    await assert.rejects(instance.start(bRequest(50n), persist), /active station mode/);
    trace.push({ event: 'finishAck', nowMs: 50, mode: instance.mode, stopping: instance.stopping,
      admission: 'ModeMismatch', ...ledger() });
    enterAuto(instance, 5n);
    const bGrant = await instance.start(bRequest(50n), persist);
    const output = instance.authorizeOutput({ sessionId: 78n, pumpOn: false, valves: 1n, nowMs: 50n });
    assert.throws(() => instance.authorizeOutput({ sessionId: 77n, pumpOn: false, valves: 0n, nowMs: 50n }), /session does not own/);
    assert.equal(writes, 3);
    assert.equal(instance.reservedMs, 100n);
    assert.equal(bGrant.leaseDeadlineMs, 150n);
    trace.push({ event: 'BAdmitted', nowMs: 50, sessionId: Number(output.sessionId),
      leaseDeadlineMs: Number(bGrant.leaseDeadlineMs), pumpOn: false, valves: 1, ...ledger() });
    assert.deepEqual(native, { artifactFingerprint: identity.artifactFingerprint, scenario: 'lifecycle', trace });
    t.diagnostic(JSON.stringify({ admissionPolicy: 'fixed Station rejection; explicit retry', identity, trace }));
  } finally { instance.dispose(); }
  writeFileSync(tapePath, JSON.stringify({ ...tape, artifactFingerprint: '0000000000000000' }));
  assert.throws(() => execFileSync(runner, [artifactPath, tapePath], { encoding: 'utf8', stdio: 'pipe' }), /checked constraint artifact identity mismatch/);
  assert.throws(() => bindStationPolicy(artifact, { ...bindings, pump: { id: 'valve1' } }), /unbound pump identifier pump1/);
  assert.throws(() => bindStationPolicy(compile(source.replace('pump_capacity(pump1)', 'pump_capacity(missing)')), bindings), /unbound pump identifier missing/);
});

test('REF-04-052: checked Station source native/WASM rejects same-tick Stop Manual Configure entries without deferred transition', async t => {
  const reference = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8'))
    .cases.find(entry => entry.id === 'REF-04-052');
  assert(reference && reference.issue.endsWith('/250'));
  assert.equal(reference.scope, 'runtime');
  assert.match(reference.given, /Stop, Manual.*Configure/);
  assert.match(reference.then, /두 진입.*거부.*Stop\/cleanup.*몰래/);
  const filename = 'examples/station-rules.ghost.md';
  const source = readFileSync(resolve(root, filename), 'utf8');
  const bindings = {
    station: { id: 'station', config: { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 1000, maxStartBudgetMs: 800 } },
    pump: { id: 'pump1' }, settings: { id: 'settings' },
    schedules: { starts: { id: 'starts', timezone: 'Asia/Seoul' } },
    modeAliases: { Auto: 'Auto', Manual: 'Manual', Configure: 'Configure' },
    activityAliases: { automatic: 'Auto', manual: 'Manual', configuring: 'Configure' },
  };
  const compile = value => compileConstraints(extractLiterate(value, { filename }).code, { filename });
  const artifact = compile(source), policy = bindStationPolicy(artifact, bindings);
  const bytes = Buffer.from(JSON.stringify(artifact));
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  const sha = value => createHash('sha256').update(value).digest('hex');
  const identity = { sourceSha256: sha(source), artifactSha256: sha(bytes), bindingSha256: sha(JSON.stringify(bindings)),
    policySha256: sha(JSON.stringify(policy)), artifactFingerprint: hash.toString(16).padStart(16, '0') };
  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'station_ownership_tape'], { cwd: root, stdio: 'inherit' });
  const runner = resolve(root, 'target/release/examples/station_ownership_tape' + (process.platform === 'win32' ? '.exe' : ''));
  const directory = mkdtempSync(join(tmpdir(), 'reference-station-mode-batch-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactPath = join(directory, 'constraints.json'), tapePath = join(directory, 'tape.json');
  writeFileSync(artifactPath, bytes);
  for (const order of ['MC', 'CM']) {
    const tape = { artifactFingerprint: identity.artifactFingerprint, stationConfig: policy.stationConfig, scenario: 'stopModeBatch', order };
    writeFileSync(tapePath, JSON.stringify(tape));
    const native = JSON.parse(execFileSync(runner, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10_000 }));
    const instance = await GhostFlowStation.instantiate(wasmBytes, policy.stationConfig);
    try {
      synchronize(instance); enterAuto(instance);
      await instance.start(startRequest(instance, 2n, undefined), async () => true);
      const on = { sessionId: 77n, pumpOn: true, valves: 1n, nowMs: 20n };
      instance.authorizeOutput(on); instance.reportApplied(on); // host applied fixture
      instance.advance(40n);
      const old = instance.claim;
      assert.equal(instance.requestStop({ requestId: 4n, ...old }).forceSafeOutputs, true);
      const trace = [{ event: 'Stop', nowMs: 40, mode: instance.mode, stopping: instance.stopping, reservedMs: Number(instance.reservedMs) }];
      const modes = order === 'MC' ? ['Manual', 'Configure'] : ['Configure', 'Manual'];
      const entries = claim => modes.map((mode, index) => ({ requestId: BigInt(5 + index), ...claim, mode }));
      for (const claim of [old, instance.claim]) {
        const before = instance.snapshot();
        assert.throws(() => instance.enterBatch(entries(claim)), /generation|conflicting/i);
        assert.deepEqual(instance.snapshot(), before);
      }
      assert.throws(() => instance.prepareStart({ ...startRequest(instance, 3n, undefined, 40n), sessionId: 78n }), /stop is in progress/);
      assert.throws(() => instance.enter({ requestId: 7n, ...instance.claim, mode: 'Manual' }), /not stopped/);
      trace.push({ event: 'entriesRejected', nowMs: 40, order, mode: instance.mode, stopping: instance.stopping, reservedMs: Number(instance.reservedMs) });
      instance.reportApplied({ sessionId: 77n, pumpOn: false, valves: 0n, nowMs: 50n });
      const finish = instance.prepareFinish({ sessionId: 77n, outcome: 'Cancelled', nowMs: 50n });
      assert.throws(() => instance.enterBatch(entries(instance.claim)), /awaiting commit or abort/);
      instance.commitFinish(finish.token); // explicit simulated durable ACK
      instance.advance(60n);
      assert.equal(instance.mode, 'Stopped');
      trace.push({ event: 'finishAck', nowMs: 60, mode: instance.mode, stopping: instance.stopping,
        reservedMs: Number(instance.reservedMs), dailyUsedMs: Number(instance.dailyUsedMs) });
      const before = instance.snapshot();
      assert.throws(() => instance.enterBatch(entries(instance.claim)), /conflicting/i);
      assert.deepEqual(instance.snapshot(), before); // both rejected; no first winner
      assert.throws(() => instance.enter({ requestId: 5n, ...old, mode: modes[0] }), /generation/);
      instance.enterBatch([{ requestId: 5n, ...instance.claim, mode: modes[0] }]);
      trace.push({ event: 'explicitEntry', nowMs: 60, mode: instance.mode });
      assert.deepEqual(native, { artifactFingerprint: identity.artifactFingerprint, scenario: 'stopModeBatch', trace });
      t.diagnostic(JSON.stringify({ identity, order, trace }));
    } finally { instance.dispose(); }
    writeFileSync(tapePath, JSON.stringify({ ...tape, artifactFingerprint: '0000000000000000' }));
    assert.throws(() => execFileSync(runner, [artifactPath, tapePath], { encoding: 'utf8', stdio: 'pipe' }), /checked constraint artifact identity mismatch/);
  }
  assert.throws(() => bindStationPolicy(artifact, { ...bindings, pump: { id: 'valve1' } }), /unbound pump identifier pump1/);
  assert.throws(() => bindStationPolicy(compile(source.replace('pump_capacity(pump1)', 'pump_capacity(missing)')), bindings), /unbound pump identifier missing/);
});

test('station entry batch validates JS and packed ABI input before atomic owner mutation', async () => {
  const instance = await station();
  try {
    synchronize(instance);
    const request = { requestId: 1n, ...instance.claim, mode: 'Manual' };
    const before = instance.snapshot();
    for (const input of [null, [], Array(257).fill(request), [request, { ...request, requestId: 2n, mode: 'Stopped' }],
      [request, { ...request, requestId: -1n }], [request, request]]) {
      assert.throws(() => instance.enterBatch(input));
      assert.deepEqual(instance.snapshot(), before);
    }
    const wasm = instance.wasm;
    for (const [ptr, count] of [[0, 0], [0, 1], [0, 257], [wasm.memory.buffer.byteLength - 16, 1]]) {
      assert.equal(wasm.gf_station_enter_batch(instance.handle, ptr, count), 0);
      assert.deepEqual(instance.snapshot(), before);
    }
    const ptr = wasm.gf_alloc(64);
    try {
      const view = new DataView(wasm.memory.buffer);
      for (let index = 0; index < 2; index++) {
        [BigInt(index + 1), request.revision, request.stopGeneration, index === 0 ? 2n : 258n]
          .forEach((value, field) => view.setBigUint64(ptr + index * 32 + field * 8, value, true));
      }
      assert.equal(wasm.gf_station_enter_batch(instance.handle, ptr, 2), 0);
      assert.deepEqual(instance.snapshot(), before);
    } finally { wasm.gf_dealloc(ptr, 64); }
    instance.enterBatch([request, { ...request, requestId: 2n }]);
    assert.equal(instance.mode, 'Manual');
    instance.requestStop({ requestId: 3n, ...instance.claim });
    instance.confirmStopped({ nowMs: 0n });
    assert.throws(() => instance.enterBatch([{ ...request, ...instance.claim }]), /already accepted/);
    assert.equal(instance.mode, 'Stopped');
  } finally { instance.dispose(); }
  assert.throws(() => instance.enterBatch([]), /disposed/);
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
