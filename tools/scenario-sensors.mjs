// Scenario transport for the existing Rust/WASM sensor conditioner and framed VM.
import fs from 'node:fs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { loadVerifiedArtifact, validateScenario } from './ghostsim.mjs';

const [artifactPath, scenarioPath] = process.argv.slice(2);
const { artifactBytes, manifest } = loadVerifiedArtifact(artifactPath);
const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
validateScenario(scenario, manifest);
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
let runtime;
const certified = manifest.signals?.some(signal => signal.kind === 'true-for');
const hasSolar = manifest.schedules?.some(schedule => schedule.kind === 'solar');
try {
  const instantiate = certified || hasSolar ? ControlRuntime.instantiate : ControlRuntime.instantiateFramed;
  runtime = await instantiate.call(ControlRuntime, wasm, { bytes: artifactBytes, manifest }, {
    acceptSettings: true,
    ...(scenario.temporal === undefined ? {} : { temporal: scenario.temporal }),
    ...(scenario.solar === undefined ? {} : { solar: scenario.solar }),
    ...(scenario.capabilities === undefined ? {} : { capabilities: scenario.capabilities }),
  });
} catch (error) {
  console.error(`activation: ${error.message}`);
  process.exit(1);
}
const inputs = Object.fromEntries(scenario.initialInputs.map(input => [input.name, input.value]));
const bindings = new Map(scenario.keyBindings.map(binding => [binding.key, binding.input]));
let samples = {};
let intervals = {};
let scanId = 0;
try {
  for (const [index, action] of scenario.actions.entries()) {
    try {
      if (action.kind === 'input') inputs[action.name] = action.value;
      else if (action.kind === 'key') inputs[bindings.get(action.key)] = action.event === 'down';
      else if (action.kind === 'sample') {
        const { kind, name, ...sample } = action;
        samples[name] = sample;
      } else if (action.kind === 'interval') {
        const { kind, name, ...interval } = action;
        intervals[name] = interval;
      }
      else if (action.kind === 'scan') {
        const outcome = runtime.step({ nowMs: action.atMs, inputs, samples, intervals,
          ...(action.solarFacts === undefined ? {} : { solarFacts: action.solarFacts }) });
        console.log(JSON.stringify({ scanId: outcome.frame?.scanId ?? scanId, logicalTimeMs: action.atMs, trace: outcome.vm }));
        scanId += 1;
        samples = {};
        intervals = {};
      }
    } catch (error) {
      console.error(`action[${index}]: ${error.message}`);
      process.exitCode = 1;
      break;
    }
  }
} finally {
  runtime.dispose();
}
