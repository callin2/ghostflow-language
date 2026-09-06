import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileConstraints } from '../tools/constraints.mjs';
import { bindStationPolicy, StationPolicyError } from '../runtimes/wasm/policy.mjs';
import { GhostFlowStation } from '../runtimes/wasm/station.mjs';

const source = fs.readFileSync(new URL('../examples/station-rules.ghost', import.meta.url), 'utf8');
const artifact = compileConstraints(source, { filename: 'examples/station-rules.ghost' });

function bindings(overrides = {}) {
  const value = {
    station: { id: 'station', config: { valveCount: 4, maxOpenValves: 3, dailyQuotaMs: 7_200_000, maxStartBudgetMs: 900_000 } },
    pump: { id: 'pump1' },
    settings: { id: 'settings' },
    schedules: { starts: { id: 'starts', timezone: 'Asia/Seoul' } },
    modeAliases: { Auto: 'Auto', Manual: 'Manual', Configure: 'Configure' },
    activityAliases: { automatic: 'Auto', manual: 'Manual', configuring: 'Configure' },
    ...overrides,
  };
  return value;
}

const policy = bindStationPolicy(artifact, bindings());
assert.deepEqual(policy, {
  stationConfig: { valveCount: 4, maxOpenValves: 2, dailyQuotaMs: 3_600_000, maxStartBudgetMs: 900_000, requireCapacityPass: false },
  timezone: 'Asia/Seoul',
  onceSchedules: [{ id: 'starts', timezone: 'Asia/Seoul' }],
  checks: [{ kind: 'capacityCheck', pump: 'pump1', required: false, missing: 'Unknown', blocking: false }],
  interlock: {
    station: 'station', enterModes: ['Auto', 'Configure', 'Manual'], requiresStoppedForEnter: true,
    configureOnly: { settings: 'settings', requiresStopped: true }, exclusiveModes: ['Auto', 'Configure', 'Manual'],
  },
  pump: { id: 'pump1', requiresOpenValve: true },
});
assert.deepEqual(Object.keys(policy.stationConfig).sort(),
  ['dailyQuotaMs', 'maxOpenValves', 'maxStartBudgetMs', 'requireCapacityPass', 'valveCount']);

// npm test builds this artifact before Node tests. This validates the policy
// configuration against the real station ABI without issuing a physical output.
const wasmBytes = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const station = await GhostFlowStation.instantiate(wasmBytes, policy.stationConfig);
assert.equal(station.mode, 'Stopped');
station.dispose();

const required = compileConstraints(`constraints Strict { require pump_capacity(pump1) == Pass; }`);
const strictPolicy = bindStationPolicy(required, bindings());
assert.equal(strictPolicy.stationConfig.requireCapacityPass, true);
assert.deepEqual(strictPolicy.checks, [{ kind: 'capacityCheck', pump: 'pump1', required: true, missing: 'Unknown', blocking: true }]);

const combined = compileConstraints(`
constraints A { require count_on(pump1.valves) <= 3; limit on_time(pump1) <= 2h per day("Asia/Seoul"); }
constraints B { require count_on(pump1.valves) <= 1; limit on_time(pump1) <= 30min per day("Asia/Seoul"); }
`);
const combinedPolicy = bindStationPolicy(combined, bindings());
assert.equal(combinedPolicy.stationConfig.maxOpenValves, 1);
assert.equal(combinedPolicy.stationConfig.dailyQuotaMs, 1_800_000);

const aliases = compileConstraints(`constraints Alias { allow enter(RunAuto, Hand, Edit) only when mode == Stopped && stopped(station); }`);
assert.deepEqual(bindStationPolicy(aliases, bindings({ modeAliases: { RunAuto: 'Auto', Hand: 'Manual', Edit: 'Configure' } })).interlock.enterModes,
  ['Auto', 'Configure', 'Manual']);

const splitEntries = compileConstraints(`
constraints AutoOnly { allow enter(Auto) only when mode == Stopped && stopped(station); }
constraints ManualOnly { allow enter(Manual) only when mode == Stopped && stopped(station); }
`);
assert.deepEqual(bindStationPolicy(splitEntries, bindings()).interlock.enterModes, ['Auto', 'Manual']);

function expectError(input, text, profile = bindings()) {
  assert.throws(() => bindStationPolicy(input, profile), error => error instanceof StationPolicyError && error.message.includes(text));
}

expectError(compileConstraints('constraints X { require count_on(other.valves) <= 2; }'), 'unbound pump identifier other');
expectError(compileConstraints('constraints X { allow enter(Auto) only when mode == Stopped && stopped(other); }'), 'unbound station identifier other');
expectError(compileConstraints('constraints X { allow apply(other) only when mode == Configure && stopped(station); }'), 'unbound settings identifier other');
expectError(compileConstraints('constraints X { once other per occurrence; }'), 'unbound schedule identifier other');
expectError(compileConstraints('constraints X { exclusive(watering, flushing); }'), 'unbound activity identifier watering');
expectError(compileConstraints('constraints X { allow enter(Auto) only when mode == Stopped && stopped(station); }'), 'unbound mode identifier Auto',
  bindings({ modeAliases: { Manual: 'Manual', Configure: 'Configure' } }));
expectError(compileConstraints(`
constraints A { limit on_time(pump1) <= 1h per day("Asia/Seoul"); }
constraints B { limit on_time(pump1) <= 1h per day("UTC"); }
`), 'different constraint timezones are unsupported');
expectError({ format: 'GhostFlow/constraints-v1', groups: [{ name: 'Unknown', rules: [{ kind: 'unknownRule' }] }] }, 'unsupported constraint rule unknownRule');
expectError({ format: 'GhostFlow/constraints-v1', groups: [{ name: 'Extra', rules: [{ kind: 'once', schedule: 'starts', ignored: true }] }] }, 'unsupported once rule field ignored');
expectError(compileConstraints('constraints X { require count_on(pump1.valves) <= 0; }'), 'maxValves max must be an integer from 1');

console.log(`policy tests passed (${policy.checks[0].missing} capacity remains advisory)`);
