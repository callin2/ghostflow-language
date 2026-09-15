import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { compileConstraints } from './constraints.mjs';
import { extractLiterate } from './literate.mjs';
import { bindStationPolicy } from '../runtimes/wasm/policy.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { GhostFlowStation } from '../runtimes/wasm/station.mjs';
import { FileLedger } from '../runtimes/node/ledger.mjs';
import { DailySlots } from '../runtimes/wasm/schedule.mjs';
import { ScheduledAdmission } from '../runtimes/wasm/scheduled-admission.mjs';

/** Integration demonstration, not a physical Driver. All applications below
 * update only a JS record. A real host needs watchdog/lease enforcement outside
 * the VM and must command safe outputs even when a runtime/storage call fails.
 */
export async function runStationDemo({ wasm, first, second, root, build }) {
  const rulesFilename = 'examples/station-rules.ghost.md';
  const rulesDocument = fs.readFileSync(path.join(root, rulesFilename), 'utf8');
  const rulesSource = extractLiterate(rulesDocument, { filename: rulesFilename }).code +
    '\nconstraints ExtraSchedule { once extra_starts per occurrence; }\n';
  const rules = compileConstraints(rulesSource, { filename: rulesFilename });
  const modes = { Auto: 'Auto', Manual: 'Manual', Configure: 'Configure' };
  const policy = bindStationPolicy(rules, {
    station: { id: 'station', config: { valveCount: 4, maxOpenValves: 4, dailyQuotaMs: 7_200_000, maxStartBudgetMs: 3_600_000 } },
    pump: { id: 'pump1' }, settings: { id: 'settings' },
    schedules: { starts: { id: 'starts', timezone: 'Asia/Seoul' }, extra_starts: { id: 'extra_starts', timezone: 'Asia/Seoul' } },
    modeAliases: modes, activityAliases: { automatic: 'Auto', manual: 'Manual', configuring: 'Configure' },
  });
  assert.equal(policy.stationConfig.dailyQuotaMs, 3_600_000);
  assert.equal(policy.stationConfig.maxOpenValves, 2);
  assert.equal(policy.stationConfig.requireCapacityPass, false);
  fs.writeFileSync(path.join(build, 'station-policy.json'), JSON.stringify(policy, null, 2) + '\n');
  // These IDs belong to this installation, not the order of discovered devices.
  // They must remain immutable across restarts and ordinary schedule edits.
  const numericIds = { starts: 1, extra_starts: 2 };
  const scheduleBindings = Object.fromEntries([...first.manifest.schedules, ...second.manifest.schedules]
    .map(schedule => [schedule.name, { numericId: numericIds[schedule.name], timezone: schedule.timezone, slots: schedule.slots }]));
  const admission = new ScheduledAdmission(policy, scheduleBindings);
  fs.writeFileSync(path.join(build, 'schedule-bindings.json'), JSON.stringify(scheduleBindings, null, 2) + '\n');

  // Unique temporary installation: never overwrite an existing user's ledger.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-tutorial-'));
  const ledger = new FileLedger(path.join(directory, 'pump1.ledger'));
  const persist = bytes => ledger.persist(bytes);
  const station = await GhostFlowStation.instantiate(wasm, policy.stationConfig);
  const oldControl = await ControlRuntime.instantiate(wasm, first);
  const newControl = await ControlRuntime.instantiate(wasm, second);
  const virtualDriver = { pumpOn: false, valves: 0n };
  const applied = [];
  const day = Math.floor(Date.UTC(2026, 8, 5) / 86_400_000);
  station.synchronizeDay({ day, nowMs: 0, nextDayDeadlineMs: 64_801_000 });
  station.enter({ requestId: 1n, ...station.claim, mode: 'Auto' });
  assert.throws(() => station.enter({ requestId: 90n, ...station.claim, mode: 'Manual' }), /not stopped/);
  assert.throws(() => station.prepareApply({ requestId: 91n, ...station.claim, nextRevision: station.claim.revision + 1n }), /not stopped/);

  function request(requestId, ownerId, sessionId, valves, nowMs, budgetMs = 620_000) {
    return { requestId, ...station.claim, ownerId, sessionId, mode: 'Auto', valves, nowMs, budgetMs };
  }
  function apply(sessionId, trace, names, masks, nowMs) {
    const valves = names.reduce((mask, name, index) => mask | (trace.vm.safe[name] ? masks[index] : 0n), 0n);
    const command = { sessionId, pumpOn: trace.vm.safe.pump, valves, nowMs };
    station.authorizeOutput(command);
    Object.assign(virtualDriver, { pumpOn: command.pumpOn, valves });
    station.reportApplied(command);
    applied.push({ sessionId: String(sessionId), nowMs, pumpOn: command.pumpOn, valves: String(valves) });
  }
  oldControl.step({ nowMs: 0 });
  const newRows = [newControl.step({ nowMs: 0 })];
  const morningClock = new DailySlots(first.manifest.schedules[0]);
  const morningWall = Date.parse('2026-09-05T06:00:00+09:00');
  morningClock.poll({ nowMs: 0, wallMs: morningWall - 1000 });
  const morningEvent = morningClock.poll({ nowMs: 1000, wallMs: morningWall });
  const grant = await admission.start(station, morningEvent, request(2n, 1n, 101n, 3n, 1000), persist);
  assert.equal(grant.capacity, 'Unknown', 'no pressure or flow metadata is required');
  const crashAfterReservation = await ledger.read();
  assert.equal(virtualDriver.pumpOn, false, 'durable reservation alone is not a physical output');
  const firstTimes = [1000, 3000, 303000, 305000, 307000, 309000, 609000, 611000];
  for (const nowMs of firstTimes) {
    const trace = oldControl.step({ nowMs, due: { starts: nowMs === 1000 } });
    apply(101n, trace, ['valve1', 'valve2'], [1n, 2n], nowMs);
    if (nowMs === 305000) {
      assert.deepEqual(virtualDriver, { pumpOn: false, valves: 0n });
      assert.throws(() => station.prepareStart(request(3n, 2n, 102n, 12n, nowMs)), /already owned/);
    }
  }
  await station.finish({ sessionId: 101n, nowMs: 611000 }, persist);
  assert.equal(station.dailyUsedMs, 600_000n);
  assert.equal(station.reservedMs, 0n);

  const extra = new DailySlots(second.manifest.schedules[0]);
  const evening = Date.parse('2026-09-05T19:15:00+09:00');
  extra.poll({ nowMs: 47_700_000, wallMs: evening - 1000 });
  const eveningEvent = extra.poll({ nowMs: 47_701_000, wallMs: evening });
  assert.equal(eveningEvent.due, true);
  await admission.start(station, eveningEvent, request(4n, 2n, 102n, 12n, 47_701_000), persist);
  const secondTimes = firstTimes.map(time => time + 47_700_000);
  for (const nowMs of secondTimes) {
    const trace = newControl.step({ nowMs, due: { extra_starts: nowMs === 47_701_000 } });
    newRows.push(trace);
    apply(102n, trace, ['valve3', 'valve4'], [4n, 8n], nowMs);
  }
  const finalTime = secondTimes.at(-1);
  await station.finish({ sessionId: 102n, nowMs: finalTime }, persist);
  assert.equal(station.dailyUsedMs, 1_200_000n);
  assert.equal(station.reservedMs, 0n);
  await assert.rejects(admission.start(station, morningEvent, request(5n, 1n, 103n, 3n, finalTime), persist), /occurrence id was already/);
  assert.throws(() => station.prepareStart(request(6n, 1n, 104n, 3n, finalTime, 3_000_000)), /quota/);

  // Stop applies synchronously to this virtual driver before any awaited write.
  const directive = station.requestStop({ requestId: 7n, ...station.claim });
  assert.equal(directive.forceSafeOutputs, true);
  Object.assign(virtualDriver, { pumpOn: false, valves: 0n });
  await persist(station.snapshot());
  station.confirmStopped({ nowMs: finalTime, proof: 'Commanded' });
  station.enter({ requestId: 8n, ...station.claim, mode: 'Configure' });
  const beforeRevision = station.claim.revision;
  await station.apply({ requestId: 9n, ...station.claim, nextRevision: beforeRevision + 1n }, persist);
  assert.equal(station.claim.revision, beforeRevision + 1n);
  assert.throws(() => station.enter({ requestId: 10n, ...station.claim, mode: 'Manual' }), /not stopped/);

  // A simulated crash immediately after the first durable reservation uses the
  // real bytes read back from FileLedger. It never restores an ON output.
  const recovered = await GhostFlowStation.instantiate(wasm, policy.stationConfig);
  recovered.restore(crashAfterReservation);
  recovered.synchronizeDay({ day, nowMs: 0, nextDayDeadlineMs: 64_801_000 });
  assert.throws(() => recovered.enter({ requestId: 20n, ...recovered.claim, mode: 'Auto' }), /not stopped/);
  recovered.acknowledgeRecoverySafeOutput({ nowMs: 1, proof: 'Commanded' });
  recovered.enter({ requestId: 20n, ...recovered.claim, mode: 'Auto' });
  assert.equal(recovered.reservedMs, 620_000n, 'uncertain reservation remains charged');
  const recoveredAdmission = new ScheduledAdmission(policy, JSON.parse(fs.readFileSync(path.join(build, 'schedule-bindings.json'), 'utf8')));
  assert.equal(recoveredAdmission.occurrenceId(morningEvent), admission.occurrenceId(morningEvent));
  await assert.rejects(recoveredAdmission.start(recovered, morningEvent,
    { ...request(21n, 1n, 105n, 3n, 10), ...recovered.claim }, persist), /occurrence id was already/);

  const result = {
    name: 'SharedPumpStation', controls: ['ScheduledWatering', 'ExtraValves'],
    pumpOnMs: Number(station.dailyUsedMs), quotaMs: policy.stationConfig.dailyQuotaMs,
    capacity: grant.capacity, revision: String(station.claim.revision),
    checks: ['compiled-controls-share-one-station', 'owner-held-through-off-gap', 'Auto-Manual-interlock', 'configure-only-after-stop', 'daily-quota', 'scheduler-to-durable-occurrence-dedup', 'reboot-conservative-reservation', 'metadata-optional'],
    occurrences: [morningEvent, eveningEvent].map(event => ({ occurrence: event.occurrence, id: String(admission.occurrenceId(event)) })),
    virtualOnly: true, driverProof: 'Commanded (virtual)', fileLedger: ledger.filename,
    applied,
  };
  fs.writeFileSync(path.join(build, 'station.trace.json'), JSON.stringify(result, null, 2) + '\n');
  recovered.dispose(); station.dispose(); oldControl.dispose(); newControl.dispose();
  return { result, secondRows: newRows };
}
