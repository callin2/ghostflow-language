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
const hasAfterEvent = manifest.signals?.some(signal => signal.kind === 'after-event');
const hasSolar = manifest.schedules?.some(schedule => schedule.kind === 'solar');
const hasDaily = manifest.schedules?.some(schedule => schedule.kind === 'daily');
const hasObjective = (manifest.objectives?.length ?? 0) > 0;
try {
  const instantiate = certified || hasAfterEvent || hasSolar || hasDaily || hasObjective ? ControlRuntime.instantiate : ControlRuntime.instantiateFramed;
  runtime = await instantiate.call(ControlRuntime, wasm, { bytes: artifactBytes, manifest }, {
    acceptSettings: true,
    ...(scenario.temporal === undefined ? {} : { temporal: scenario.temporal }),
    ...(scenario.afterEvent === undefined ? {} : { afterEvent: scenario.afterEvent }),
    ...(scenario.solar === undefined ? {} : { solar: scenario.solar }),
    ...(scenario.schedule === undefined ? {} : { schedule: scenario.schedule }),
    ...(scenario.capabilities === undefined ? {} : { capabilities: scenario.capabilities }),
  });
} catch (error) {
  console.error(`activation: ${error.message}`);
  process.exit(1);
}
const inputs = Object.fromEntries(scenario.initialInputs.map(input => [input.name, input.value]));
const kelvin = temperature => temperature.unit === 'K' ? temperature.value : temperature.value + 273.15;
const displayTemperature = (valueK, unit) => ({ value: unit === 'K' ? valueK : valueK - 273.15, unit });
const bindings = new Map(scenario.keyBindings.map(binding => [binding.key, binding.input]));
let samples = {};
const latestSamples = new Map();
let intervals = {};
let scanId = 0;
const plantState = scenario.plant === undefined ? null : {
  temperatureK: kelvin(scenario.plant.initialTemperature), atMs: null, appliedPercent: 0, sampleId: 0,
};
try {
  for (const [index, action] of scenario.actions.entries()) {
    try {
      if (action.kind === 'input') inputs[action.name] = action.value;
      else if (action.kind === 'key') inputs[bindings.get(action.key)] = action.event === 'down';
      else if (action.kind === 'sample') {
        const { kind, name, ...sample } = action;
        samples[name] = sample;
        latestSamples.set(name, sample);
      } else if (action.kind === 'interval') {
        const { kind, name, ...interval } = action;
        intervals[name] = interval;
      }
      else if (action.kind === 'scan') {
        let plant;
        if (plantState !== null) {
          if (plantState.atMs !== null) {
            const seconds = (action.atMs - plantState.atMs) / 1000;
            const loss = scenario.plant.leakPerSecond
              + scenario.plant.ventilationPerSecond * plantState.appliedPercent / 100;
            const outsideK = kelvin(scenario.plant.outsideTemperature);
            plantState.temperatureK = loss === 0
              ? plantState.temperatureK + scenario.plant.heatingKPerSecond * seconds
              : outsideK + scenario.plant.heatingKPerSecond / loss
                + (plantState.temperatureK - outsideK - scenario.plant.heatingKPerSecond / loss)
                  * Math.exp(-loss * seconds);
          }
          plantState.atMs = action.atMs;
          const generated = {
            epoch: scenario.plant.epoch, id: ++plantState.sampleId, timestampMs: action.atMs,
            value: plantState.temperatureK, quality: 'Good',
          };
          samples[scenario.plant.sensor] = generated;
          latestSamples.set(scenario.plant.sensor, generated);
          const objective = manifest.objectives.find(item => item.measure === scenario.plant.sensor
            && item.bindings.output === scenario.actuatorBindings.find(binding => binding.actuator === scenario.plant.actuator).output);
          const displayUnit = manifest.configs.find(item => item.name === objective.target).displayUnit;
          plant = {
            kind: scenario.plant.kind, insideTemperature: displayTemperature(plantState.temperatureK, displayUnit),
            outsideTemperature: displayTemperature(kelvin(scenario.plant.outsideTemperature), displayUnit),
            priorAppliedPercent: plantState.appliedPercent,
            sampleProvenance: { epoch: generated.epoch, id: generated.id, timestampMs: generated.timestampMs },
          };
        }
        const outcome = runtime.step({ nowMs: action.atMs, inputs, samples, intervals,
          ...(action.events === undefined ? {} : { events: action.events }),
          objectiveSafeMax: Object.fromEntries((manifest.objectives ?? []).map(objective => {
            const binding = scenario.actuatorBindings?.find(item => item.output === objective.bindings.output);
            return [objective.name, binding?.max ?? objective.output.max];
          })),
          ...(action.solarFacts === undefined ? {} : { solarFacts: action.solarFacts }),
          ...(action.scheduleFacts === undefined ? {} : { scheduleFacts: action.scheduleFacts }) });
        const virtualActuators = Object.fromEntries((scenario.actuatorBindings ?? []).map(binding => {
          const requested = outcome.vm.requested[binding.output];
          const safe = outcome.vm.safe[binding.output];
          if (typeof safe !== 'number' || !Number.isFinite(safe)) throw new Error(`virtual actuator ${binding.actuator} received a non-finite safe value`);
          if (safe < binding.min || safe > binding.max) {
            throw new RangeError(`virtual actuator ${binding.actuator} safe value ${safe} is outside ${binding.min}..${binding.max}`);
          }
          const reading = binding.feedbackSensor === undefined ? undefined : outcome.sensors[binding.feedbackSensor];
          const sample = binding.feedbackSensor === undefined ? undefined : latestSamples.get(binding.feedbackSensor);
          return [binding.actuator, {
            output: binding.output, type: binding.type, requested, safe, applied: safe,
            ...(reading === undefined ? {} : { feedback: {
              sensor: binding.feedbackSensor, type: binding.type,
              ok: reading.ok, value: reading.value, quality: reading.quality,
              ...(sample === undefined ? {} : { provenance: { epoch: sample.epoch, id: sample.id, timestampMs: sample.timestampMs } }),
            } }),
          }];
        }));
        if (plantState !== null) plantState.appliedPercent = virtualActuators[scenario.plant.actuator].applied;
        console.log(JSON.stringify({ scanId: outcome.frame?.scanId ?? scanId, logicalTimeMs: action.atMs, trace: outcome.vm,
          ...(scenario.actuatorBindings === undefined ? {} : { virtualActuators }), ...(plant === undefined ? {} : { plant }) }));
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
