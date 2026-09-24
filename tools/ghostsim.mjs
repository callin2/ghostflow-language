#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '@toon-format/toon';
import { verifyArtifactSourceMap } from './toolchain.mjs';
import { encodeTemporalProfile } from '../runtimes/wasm/temporal-profile.mjs';
import { encodeScheduleFacts, encodeSolarFacts, validateSolarActivation } from '../runtimes/wasm/solar-abi.mjs';
import { encodeContextActivation, encodeContextFacts } from '../runtimes/wasm/context-abi.mjs';
import { AFTER_EVENT_CAPACITY } from '../runtimes/wasm/after-event-runtime.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MAX_SCENARIO_BYTES = 256 * 1024;
const MAX_ACTIONS = 1024;
const MAX_SCANS = 256;
const MAX_RESULT_BYTES = 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireShape(value, keys, location) {
  if (!object(value)) throw new Error(`${location}: expected object`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${location}: unknown field ${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${location}: missing field ${key}`);
  }
}

function requireFields(value, required, optional, location) {
  if (!object(value)) throw new Error(`${location}: expected object`);
  for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) throw new Error(`${location}: unknown field ${key}`);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new Error(`${location}: missing field ${key}`);
}

function requireNonnegative(value, location) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${location}: expected exact nonnegative integer`);
}
function requireI32(value, location) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new Error(`${location}: expected signed 32-bit integer`);
}

function requireName(value, location) {
  if (typeof value !== 'string' || !value || /[\t\r\n]/u.test(value)) {
    throw new Error(`${location}: expected nonempty text without control separators`);
  }
}

function requireTyped(input, location) {
  requireShape(input, ['name', 'type', 'value'], location);
  requireName(input.name, `${location}.name`);
  const valid = input.type === 'Bool' ? typeof input.value === 'boolean'
    : input.type === 'Int' ? Number.isInteger(input.value) && input.value >= -2147483648 && input.value <= 2147483647
      : input.type === 'Number' ? typeof input.value === 'number' && Number.isFinite(input.value) : false;
  if (!valid) throw new Error(`${location}: invalid ${input.type} value`);
}

export function validateScenario(scenario, manifest) {
  requireFields(scenario, ['format', 'id', 'initialInputs', 'keyBindings', 'actions'], ['temporal', 'afterEvent', 'capabilities', 'solar', 'schedule', 'context', 'accounting', 'actuatorBindings', 'plant'], 'scenario');
  if (scenario.format !== 'GhostFlow/scenario-v1') throw new Error('scenario.format: unsupported version');
  requireName(scenario.id, 'scenario.id');
  if (!Array.isArray(scenario.initialInputs)) throw new Error('initialInputs: expected array');
  if (!Array.isArray(scenario.keyBindings)) throw new Error('keyBindings: expected array');
  if (!Array.isArray(scenario.actions) || scenario.actions.length > MAX_ACTIONS) {
    throw new Error(`actions: expected at most ${MAX_ACTIONS} actions`);
  }
  if (scenario.temporal !== undefined) {
    if (!manifest.signals?.some(signal => ['window', 'true-for'].includes(signal.kind))) {
      throw new Error('temporal profile requires a temporal signal');
    }
    encodeTemporalProfile(scenario.temporal);
  }
  const afterEventSignals = (manifest.signals ?? []).filter(signal => signal.kind === 'after-event');
  if (afterEventSignals.length) {
    requireShape(scenario.afterEvent, ['timeEpoch'], 'afterEvent');
    requireNonnegative(scenario.afterEvent.timeEpoch, 'afterEvent.timeEpoch');
  } else if (scenario.afterEvent !== undefined) throw new Error('afterEvent profile requires an after_event signal');
  if (scenario.capabilities !== undefined) {
    if (!Array.isArray(scenario.capabilities)) throw new Error('capabilities: expected array');
    if (!manifest.adaptPolicy && !manifest.strategies) throw new Error('capabilities require an adapt control');
  }
  const hasSolar = manifest.schedules?.some(schedule => schedule.kind === 'solar') ?? false;
  const hasDaily = manifest.schedules?.some(schedule => schedule.kind === 'daily') ?? false;
  const hasDailySlots = manifest.schedules?.some(schedule => schedule.kind === 'daily-slots') ?? false;
  const hasCivilSchedule = hasDaily || hasDailySlots;
  const hasContext = manifest.format === 'GhostFlow/control-v10';
  if (hasContext) {
    if (scenario.context === undefined) throw new Error('context control requires explicit context activation');
    encodeContextActivation(scenario.context);
  } else if (scenario.context !== undefined) throw new Error('context activation requires a context control');
  const accountingBindings = manifest.accounting?.bindings ?? [];
  if (scenario.accounting !== undefined) {
    if (!accountingBindings.length) throw new Error('accounting activation requires accounting declarations');
    requireShape(scenario.accounting, ['config', 'bootEpoch', 'terminalCapacity', 'bindings'], 'accounting');
    requireShape(scenario.accounting.config, ['maxIntervals', 'maxEvents', 'maxReservations', 'maxRollingWindowMs'], 'accounting.config');
    for (const field of ['maxIntervals', 'maxEvents', 'maxReservations', 'maxRollingWindowMs', 'bootEpoch', 'terminalCapacity']) {
      const owner = ['bootEpoch', 'terminalCapacity'].includes(field) ? scenario.accounting : scenario.accounting.config;
      requireNonnegative(owner[field], `accounting.${field}`);
    }
    if (!Array.isArray(scenario.accounting.bindings)) throw new Error('accounting.bindings: expected array');
    const supplied = new Map();
    for (const [index, binding] of scenario.accounting.bindings.entries()) {
      const location = `accounting.bindings[${index}]`;
      requireFields(binding, ['account', 'evidenceStream'], ['resourceId', 'eventType'], location);
      requireName(binding.account, `${location}.account`); requireName(binding.evidenceStream, `${location}.evidenceStream`);
      const declared = accountingBindings.find(item => item.name === binding.account);
      if (!declared) throw new Error(`${location}: unknown account ${binding.account}`);
      if (supplied.has(binding.account)) throw new Error(`${location}: duplicate account ${binding.account}`);
      if (binding.evidenceStream !== declared.evidenceBinding.target) throw new Error(`${location}: evidence stream mismatch`);
      const idField = declared.operation === 'on_time' ? 'resourceId' : 'eventType';
      requireNonnegative(binding[idField], `${location}.${idField}`);
      if (Object.hasOwn(binding, idField === 'resourceId' ? 'eventType' : 'resourceId')) throw new Error(`${location}: wrong binding ID kind`);
      supplied.set(binding.account, binding);
    }
    for (const binding of accountingBindings) if (!supplied.has(binding.name)) throw new Error(`accounting.bindings: missing account ${binding.name}`);
  } else if (accountingBindings.length) throw new Error('accounting declarations require explicit accounting activation');
  if (scenario.solar !== undefined) {
    if (!hasSolar) throw new Error('solar activation requires a Solar schedule');
    validateSolarActivation(scenario.solar);
  } else if (hasSolar) throw new Error('Solar schedule requires explicit solar activation');
  if (scenario.schedule !== undefined) {
    if (hasContext) throw new Error('context control cannot use legacy schedule activation');
    if (!hasCivilSchedule) throw new Error('schedule activation requires a Daily or DailySlots schedule');
    validateSolarActivation(scenario.schedule);
  } else if (hasCivilSchedule && !hasContext) throw new Error('civil schedule requires explicit schedule activation');
  const sensors = new Map((manifest.sensors ?? []).map(sensor => [sensor.name, sensor.type]));
  const outputs = new Map((manifest.outputs ?? []).map(output => [output.name, output]));
  if (scenario.actuatorBindings !== undefined) {
    if (!Array.isArray(scenario.actuatorBindings)) throw new Error('actuatorBindings: expected array');
    const actuators = new Set();
    const boundOutputs = new Set();
    for (const [index, binding] of scenario.actuatorBindings.entries()) {
      const location = `actuatorBindings[${index}]`;
      requireFields(binding, ['actuator', 'output', 'type', 'min', 'max'], ['feedbackSensor'], location);
      requireName(binding.actuator, `${location}.actuator`);
      if (actuators.has(binding.actuator)) throw new Error(`${location}: duplicate actuator ${binding.actuator}`);
      if (boundOutputs.has(binding.output)) throw new Error(`${location}: duplicate output binding ${binding.output}`);
      const output = outputs.get(binding.output);
      if (!output) throw new Error(`${location}: unknown output ${binding.output}`);
      if (output.type === 'Bool') throw new Error(`${location}: output ${binding.output} must be numeric`);
      if (binding.type !== output.type) throw new Error(`${location}: type mismatch ${binding.output}`);
      if (typeof binding.min !== 'number' || !Number.isFinite(binding.min)) throw new Error(`${location}: min must be finite`);
      if (typeof binding.max !== 'number' || !Number.isFinite(binding.max)) throw new Error(`${location}: max must be finite`);
      if (binding.min > binding.max) throw new Error(`${location}: min must be less than or equal to max`);
      if (binding.feedbackSensor !== undefined) {
        if (!sensors.has(binding.feedbackSensor)) throw new Error(`${location}: unknown feedback sensor ${binding.feedbackSensor}`);
        if (sensors.get(binding.feedbackSensor) !== binding.type) throw new Error(`${location}: feedback sensor ${binding.feedbackSensor} type mismatch`);
      }
      actuators.add(binding.actuator);
      boundOutputs.add(binding.output);
    }
  }
  if (scenario.plant !== undefined) {
    requireShape(scenario.plant, ['kind', 'sensor', 'actuator', 'epoch', 'initialTemperature', 'outsideTemperature', 'heatingKPerSecond', 'leakPerSecond', 'ventilationPerSecond'], 'plant');
    const plant = scenario.plant;
    if (plant.kind !== 'GhostFlow/greenhouse-temperature-v1') throw new Error('plant.kind: unsupported model');
    if (sensors.get(plant.sensor) !== 'Temperature') throw new Error(`plant.sensor: ${plant.sensor} must be a Temperature sensor`);
    const binding = scenario.actuatorBindings?.find(item => item.actuator === plant.actuator);
    if (!binding) throw new Error(`plant.actuator: unknown virtual actuator ${plant.actuator}`);
    if (binding.type !== 'Percent') throw new Error(`plant.actuator: ${plant.actuator} must have Percent type`);
    requireNonnegative(plant.epoch, 'plant.epoch');
    for (const field of ['initialTemperature', 'outsideTemperature']) {
      requireShape(plant[field], ['value', 'unit'], `plant.${field}`);
      if (typeof plant[field].value !== 'number' || !Number.isFinite(plant[field].value)) throw new Error(`plant.${field}.value: expected finite number`);
      if (!['°C', 'K'].includes(plant[field].unit)) throw new Error(`plant.${field}.unit: expected °C or K`);
      if ((plant[field].unit === 'K' ? plant[field].value : plant[field].value + 273.15) < 0) {
        throw new Error(`plant.${field}: must not be below absolute zero`);
      }
    }
    for (const field of ['heatingKPerSecond', 'leakPerSecond', 'ventilationPerSecond']) {
      if (typeof plant[field] !== 'number' || !Number.isFinite(plant[field])) throw new Error(`plant.${field}: expected finite number`);
    }
    const objective = manifest.objectives?.find(item => item.measure === plant.sensor && item.bindings?.output === binding.output);
    const target = objective && manifest.configs?.find(item => item.name === objective.target);
    if (!objective || !target || !['°C', 'K'].includes(target.displayUnit)) {
      throw new Error('plant: matching objective target requires explicit displayUnit °C or K');
    }
    for (const field of ['heatingKPerSecond', 'leakPerSecond', 'ventilationPerSecond']) {
      if (plant[field] < 0) throw new Error(`plant.${field}: expected nonnegative number`);
    }
  }
  const intervalSources = new Set((manifest.signals ?? []).filter(signal => signal.kind === 'true-for')
    .flatMap(signal => signal.sources.map(source => source.name)));
  const fields = new Map(manifest.inputs.filter(field => field.name !== '__gf_now_ms').map(field => [field.name, field.type]));
  const inputs = new Map();
  for (const [index, input] of scenario.initialInputs.entries()) {
    const location = `initialInputs[${index}]`;
    requireTyped(input, location);
    if (!fields.has(input.name)) throw new Error(`${location}: unknown input ${input.name}`);
    if (inputs.has(input.name)) throw new Error(`${location}: duplicate input ${input.name}`);
    if (fields.get(input.name) !== input.type) throw new Error(`${location}: type mismatch ${input.name}`);
    inputs.set(input.name, input.value);
  }
  for (const name of fields.keys()) {
    if (!inputs.has(name)) throw new Error(`initialInputs: missing input ${name}`);
  }
  const keys = new Set();
  const boundInputs = new Set();
  for (const [index, binding] of scenario.keyBindings.entries()) {
    const location = `keyBindings[${index}]`;
    requireShape(binding, ['key', 'input'], location);
    if (!Number.isInteger(binding.key) || binding.key < 1 || binding.key > 8) throw new Error(`${location}: key must be 1..8`);
    if (keys.has(binding.key)) throw new Error(`${location}: duplicate key ${binding.key}`);
    if (boundInputs.has(binding.input)) throw new Error(`${location}: duplicate binding ${binding.input}`);
    if (fields.get(binding.input) !== 'Bool') throw new Error(`${location}: binding ${binding.input} must be a Bool input`);
    keys.add(binding.key);
    boundInputs.add(binding.input);
  }
  let scans = 0;
  let previousTime = null;
  const pendingSamples = new Set();
  const pendingIntervals = new Set();
  const eventNames = new Set(afterEventSignals.map(signal => signal.event.name));
  for (const [index, action] of scenario.actions.entries()) {
    const location = `actions[${index}]`;
    if (!object(action)) throw new Error(`${location}: expected object`);
    switch (action.kind) {
      case 'input':
        requireShape(action, ['kind', 'name', 'type', 'value'], location);
        requireTyped({ name: action.name, type: action.type, value: action.value }, location);
        if (!fields.has(action.name)) throw new Error(`${location}: unknown input ${action.name}`);
        if (fields.get(action.name) !== action.type) throw new Error(`${location}: type mismatch ${action.name}`);
        break;
      case 'key':
        requireShape(action, ['kind', 'key', 'event'], location);
        if (!keys.has(action.key)) throw new Error(`${location}: unbound key ${action.key}`);
        if (!['down', 'up'].includes(action.event)) throw new Error(`${location}: key event must be down or up`);
        break;
      case 'sample':
        requireShape(action, ['kind', 'name', 'epoch', 'id', 'timestampMs', 'value', 'quality'], location);
        if (!sensors.has(action.name)) throw new Error(`${location}: unknown sensor ${action.name}`);
        if (scenario.plant?.sensor === action.name) throw new Error(`${location}: plant sensor ${action.name} is generated by the plant`);
        if (pendingSamples.has(action.name)) throw new Error(`${location}: duplicate pending sample ${action.name}`);
        for (const field of ['epoch', 'id', 'timestampMs']) requireNonnegative(action[field], `${location}.${field}`);
        if (sensors.get(action.name) === 'Bool' ? typeof action.value !== 'boolean' : typeof action.value !== 'number' || !Number.isFinite(action.value)) {
          throw new Error(`${location}: invalid sample value`);
        }
        if (!['Good', 'NotReady', 'Disconnected', 'Stale', 'Invalid'].includes(action.quality)) throw new Error(`${location}: unsupported sample quality`);
        pendingSamples.add(action.name);
        break;
      case 'interval':
        requireFields(action, ['kind', 'name', 'epoch', 'id', 'startMs', 'endMs', 'value', 'quality'], ['fault'], location);
        if (!intervalSources.has(action.name)) throw new Error(`${location}: unknown certified interval source ${action.name}`);
        if (scenario.temporal === undefined) throw new Error(`${location}: certified interval requires temporal profile`);
        if (pendingIntervals.has(action.name)) throw new Error(`${location}: duplicate pending interval ${action.name}`);
        for (const field of ['epoch', 'id', 'startMs', 'endMs']) requireNonnegative(action[field], `${location}.${field}`);
        if (action.endMs < action.startMs) throw new Error(`${location}: endMs precedes startMs`);
        if (typeof action.value !== 'boolean') throw new Error(`${location}: interval value must be Bool`);
        if (!['Measured', 'Held', 'Constructed', 'Unavailable', 'Disconnected', 'Stale', 'Invalid', 'NotReady'].includes(action.quality)) throw new Error(`${location}: unsupported interval quality`);
        if (action.fault !== undefined && !['Disconnected', 'Stale', 'Invalid', 'NotReady'].includes(action.fault)) throw new Error(`${location}: unsupported interval fault`);
        pendingIntervals.add(action.name);
        break;
      case 'accountingEvent': {
        requireShape(action, ['kind', 'stream', 'eventId', 'localDay'], location);
        if (!scenario.accounting) throw new Error(`${location}: accounting event requires accounting activation`);
        const binding = scenario.accounting.bindings.find(item => item.evidenceStream === action.stream && item.eventType !== undefined);
        if (!binding) throw new Error(`${location}: unknown accounting Event stream ${action.stream}`);
        if (typeof action.eventId !== 'string' || !/^[0-9a-f]{32}$/u.test(action.eventId)) throw new Error(`${location}.eventId: expected 16-byte lowercase hex identity`);
        requireI32(action.localDay, `${location}.localDay`);
        break;
      }
      case 'scan':
        requireFields(action, ['kind', 'atMs'], ['solarFacts', 'scheduleFacts', 'contextFacts', 'accountingFacts', 'events'], location);
        if (!Number.isSafeInteger(action.atMs) || action.atMs < 0) throw new Error(`${location}: atMs must be an exact nonnegative integer`);
        if (action.events !== undefined) {
          if (!eventNames.size) throw new Error(`${location}: events require an after_event signal`);
          if (!object(action.events)) throw new Error(`${location}.events: expected object`);
          for (const [eventName, batch] of Object.entries(action.events)) {
            if (!eventNames.has(eventName)) throw new Error(`${location}.events: unknown Event source ${eventName}`);
            requireShape(batch, ['starts', 'acknowledgements'], `${location}.events.${eventName}`);
            for (const [field, withTime] of [['starts', true], ['acknowledgements', false]]) {
              if (!Array.isArray(batch[field]) || batch[field].length > AFTER_EVENT_CAPACITY) {
                throw new Error(`${location}.events.${eventName}.${field}: expected at most ${AFTER_EVENT_CAPACITY} entries`);
              }
              for (const [itemIndex, item] of batch[field].entries()) {
                requireShape(item, withTime ? ['sourceEpoch', 'id', 'atMs'] : ['sourceEpoch', 'id'],
                  `${location}.events.${eventName}.${field}[${itemIndex}]`);
                for (const key of withTime ? ['sourceEpoch', 'id', 'atMs'] : ['sourceEpoch', 'id']) {
                  requireNonnegative(item[key], `${location}.events.${eventName}.${field}[${itemIndex}].${key}`);
                }
                if (withTime && item.atMs > action.atMs) throw new Error(`${location}.events.${eventName}.${field}[${itemIndex}].atMs: future event`);
              }
            }
          }
        }
        if (hasSolar) {
          if (action.solarFacts === undefined) throw new Error(`${location}: Solar scan requires provider facts`);
          encodeSolarFacts(action.solarFacts);
          if (action.solarFacts.clock.monotonicMs !== action.atMs) throw new Error(`${location}: solar clock monotonicMs must match atMs`);
          if (action.solarFacts.clock.bootEpoch !== scenario.solar.bootEpoch) throw new Error(`${location}: solar bootEpoch must match activation`);
        } else if (action.solarFacts !== undefined) throw new Error(`${location}: solar facts require a Solar schedule`);
        if (hasCivilSchedule && !hasContext) {
          if (action.scheduleFacts === undefined) throw new Error(`${location}: civil schedule scan requires provider facts`);
          encodeScheduleFacts(action.scheduleFacts);
          if (action.scheduleFacts.clock.monotonicMs !== action.atMs) throw new Error(`${location}: schedule clock.monotonicMs must match atMs`);
          if (action.scheduleFacts.clock.bootEpoch !== scenario.schedule.bootEpoch) throw new Error(`${location}: schedule bootEpoch must match activation`);
        } else if (action.scheduleFacts !== undefined) throw new Error(`${location}: schedule facts require a Daily or DailySlots schedule`);
        if (hasContext) {
          if (action.contextFacts === undefined) throw new Error(`${location}: context scan requires typed facts`);
          encodeContextFacts(action.contextFacts);
          if (action.contextFacts.clock.monotonicMs !== action.atMs) throw new Error(`${location}: context clock monotonicMs must match atMs`);
          if (action.contextFacts.clock.bootEpoch !== scenario.context.bootEpoch) throw new Error(`${location}: context bootEpoch must match activation`);
        } else if (action.contextFacts !== undefined) throw new Error(`${location}: context facts require a context control`);
        if (scenario.accounting) {
          requireShape(action.accountingFacts, ['localDay', 'wallMs', 'clockTrusted'], `${location}.accountingFacts`);
          requireI32(action.accountingFacts.localDay, `${location}.accountingFacts.localDay`);
          requireNonnegative(action.accountingFacts.wallMs, `${location}.accountingFacts.wallMs`);
          if (typeof action.accountingFacts.clockTrusted !== 'boolean') throw new Error(`${location}.accountingFacts.clockTrusted: expected Bool`);
        } else if (action.accountingFacts !== undefined) throw new Error(`${location}: accounting facts require accounting activation`);
        if (previousTime !== null && action.atMs < previousTime) throw new Error(`${location}: logical time moved backwards`);
        previousTime = action.atMs;
        pendingSamples.clear();
        pendingIntervals.clear();
        if (++scans > MAX_SCANS) throw new Error(`${location}: scan budget ${MAX_SCANS} exceeded`);
        break;
      default: throw new Error(`${location}: unknown action kind ${String(action.kind)}`);
    }
  }
  if (scans === 0) throw new Error('actions: at least one scan is required');
  return scans;
}

export function loadVerifiedArtifact(artifactPath) {
  const artifactBytes = fs.readFileSync(artifactPath);
  const manifest = JSON.parse(fs.readFileSync(`${artifactPath}.manifest.json`, 'utf8'));
  const map = JSON.parse(fs.readFileSync(`${artifactPath}.map.json`, 'utf8'));
  const document = verifyArtifactSourceMap(map, artifactBytes, { manifest });
  if (!/^GhostFlow\/control-v(?:[1-9]|10)$/u.test(manifest.format)) throw new Error('artifact must be an executable control artifact');
  if (manifest.bytecodeSha256 !== sha256(artifactBytes)) throw new Error('artifact SHA-256 mismatch');
  return { artifactBytes, manifest, map, document };
}

export function runScenario(artifactPath, scenarioPath, { format = 'toon' } = {}) {
  if (!['toon', 'json'].includes(format)) throw new Error('--format must be toon or json');
  const scenarioBytes = fs.readFileSync(scenarioPath);
  if (scenarioBytes.length > MAX_SCENARIO_BYTES) throw new Error(`scenario exceeds ${MAX_SCENARIO_BYTES} bytes`);
  const scenario = decode(new TextDecoder('utf-8', { fatal: true }).decode(scenarioBytes), { strict: true });
  const { manifest, map, document } = loadVerifiedArtifact(artifactPath);
  const scanCount = validateScenario(scenario, manifest);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-run-'));
  try {
    const actionsPath = path.join(directory, 'actions.json');
    fs.writeFileSync(actionsPath, JSON.stringify(scenario));
    const identity = {
      format: 'GhostFlow/scenario-result-v1',
      scenario: { id: scenario.id, sha256: sha256(scenarioBytes) },
      artifact: {
        bytecodeSha256: manifest.bytecodeSha256,
        sourceDocumentSha256: document.sha256,
        sourceFilename: document.filename,
        ...(map.interactionSourceIdentity ? { sourceIdentity: map.interactionSourceIdentity } : {}),
      },
      outputMeaning: 'virtual requested/safe intent and scenario-driver application; no physical output confirmed',
    };
    const encodeResult = result => (format === 'json' ? JSON.stringify(result) : encode(result)) + '\n';
    const hostError = error => {
      const message = String(error.message ?? error).slice(0, 4096);
      return {
        encoded: encodeResult({
          ...identity, outcome: 'host-error', traceComplete: false, scans: [],
          error: { location: 'host', message: `native observations unavailable: ${message}` },
        }),
        success: false,
      };
    };
    // Sensor conditioning is supplied by the existing WASM host; plain input
    // modules use the native framed runner. Neither path retries failed scans.
    const conditioned = (manifest.sensors?.length ?? 0) > 0
      || (manifest.accounting?.bindings?.length ?? 0) > 0
      || (scenario.actuatorBindings?.length ?? 0) > 0
      || manifest.schedules?.some(schedule => schedule.kind === 'solar')
      || manifest.schedules?.some(schedule => schedule.kind === 'daily')
      || manifest.schedules?.some(schedule => schedule.kind === 'daily-slots')
      || (manifest.naturalConditions?.length ?? 0) > 0
      || manifest.format === 'GhostFlow/control-v10'
      || manifest.schedules?.some(schedule => ['periodic','cron','tide'].includes(schedule.kind))
      || manifest.signals?.some(signal => signal.kind === 'after-event');
    const executable = conditioned ? process.execPath : path.join(root, 'target/release/examples/scenario_scan');
    const arguments_ = conditioned
      ? [path.join(root, manifest.accounting?.bindings?.length ? 'tools/scenario-accounting.mjs' : 'tools/scenario-sensors.mjs'), artifactPath, actionsPath]
      : [artifactPath, actionsPath];
    const child = spawnSync(executable, arguments_, {
      encoding: 'utf8', timeout: 20_000, maxBuffer: MAX_RESULT_BYTES + 4096,
    });
    if (child.error) return hostError(child.error);
    if (child.status === null) return hostError(new Error(`native runner terminated by ${child.signal ?? 'unknown signal'}`));
    let rows;
    try {
      rows = child.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      if (child.status === 0 && rows.length !== scanCount) throw new Error(`native runner returned ${rows.length} of ${scanCount} scans`);
    } catch (error) {
      return hostError(error);
    }
    const failed = child.status !== 0;
    const diagnostic = child.stderr.trim() || `native runner exited ${child.status}`;
    const indexedError = /^action\[(\d+)\]: (.*)$/u.exec(diagnostic);
    const activationError = /^activation: (.*)$/u.exec(diagnostic);
    if (failed && !indexedError && !activationError) return hostError(new Error(diagnostic));
    let scans;
    try {
      scans = rows.map(row => ({
        scanId: row.scanId, logicalTimeMs: row.logicalTimeMs,
        inputs: row.trace.inputs,
        requestedVirtualIntent: row.trace.requested,
        safeVirtualIntent: row.trace.safe,
        ...(row.virtualActuators ? { virtualActuators: row.virtualActuators } : {}),
        ...(row.plant ? { plant: row.plant } : {}),
        faults: row.trace.faults,
        stateBefore: row.trace.stateBefore,
        stateAfter: row.trace.stateAfter,
        ...(row.trace.windowTrace ? { windowTrace: row.trace.windowTrace } : {}),
        ...(row.trace.trueForTrace ? { trueForTrace: row.trace.trueForTrace } : {}),
        ...(row.trace.scheduleTrace ? { scheduleTrace: row.trace.scheduleTrace } : {}),
        ...(row.settingsState ? { settingsState: row.settingsState } : {}),
      }));
    } catch (error) {
      return hostError(error);
    }
    const result = {
      ...identity,
      outcome: !failed ? 'completed' : indexedError ? 'runtime-error' : 'rejected',
      scans,
      ...(failed ? { error: indexedError
        ? { actionIndex: Number(indexedError[1]), message: indexedError[2] }
        : { location: activationError ? 'activation' : 'runner', message: activationError ? activationError[1] : diagnostic } } : {}),
    };
    let encoded;
    try {
      encoded = encodeResult(result);
    } catch (error) {
      return hostError(error);
    }
    if (Buffer.byteLength(encoded) > MAX_RESULT_BYTES) {
      return hostError(new Error(`result budget ${MAX_RESULT_BYTES} bytes exceeded`));
    }
    return { encoded, success: !failed };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function rejectedScenario(artifactPath, scenarioPath, error, format) {
  let scenario = { id: null, sha256: null };
  let artifact = null;
  try {
    if (fs.statSync(scenarioPath).size <= MAX_SCENARIO_BYTES) {
      const bytes = fs.readFileSync(scenarioPath);
      scenario.sha256 = sha256(bytes);
      const decoded = decode(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { strict: true });
      if (object(decoded) && typeof decoded.id === 'string') scenario.id = decoded.id.slice(0, 256);
    }
  } catch { /* The rejection still reports its original decode or file error. */ }
  try {
    const bytes = fs.readFileSync(artifactPath);
    const manifest = JSON.parse(fs.readFileSync(`${artifactPath}.manifest.json`, 'utf8'));
    const map = JSON.parse(fs.readFileSync(`${artifactPath}.map.json`, 'utf8'));
    const document = verifyArtifactSourceMap(map, bytes, { manifest });
    artifact = {
      bytecodeSha256: manifest.bytecodeSha256,
      sourceDocumentSha256: document.sha256,
      sourceFilename: document.filename,
      ...(map.interactionSourceIdentity ? { sourceIdentity: map.interactionSourceIdentity } : {}),
    };
  } catch { /* An unverified artifact has no claimed identity. */ }
  const message = String(error.message).slice(0, 4096);
  const line = /^Line (\d+):/u.exec(message);
  const path = /^([A-Za-z][\w.]*\[?\d*\]?):/u.exec(message);
  const location = line ? `line:${line[1]}` : path?.[1] ?? 'scenario';
  const result = {
    format: 'GhostFlow/scenario-result-v1', scenario, artifact,
    outcome: 'rejected', outputMeaning: 'virtual requested/safe intent and scenario-driver application; no physical output confirmed',
    scans: [], error: { location, message, ...(String(error.message).length > 4096 ? { diagnosticTruncated: true } : {}) },
  };
  return (format === 'json' ? JSON.stringify(result) : encode(result)) + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.length > 4 || args.slice(2).length % 2 !== 0) {
    console.error('usage: ghostsim <artifact.gfb> <scenario.toon> [--format toon|json]');
    process.exitCode = 2;
  } else {
    const options = {};
    try {
      for (let index = 2; index < args.length; index += 2) {
        const name = args[index];
        if (name === '--format' && options.format === undefined) options.format = args[index + 1];
        else throw new Error(`unknown or repeated option ${name}`);
      }
      const result = runScenario(args[0], args[1], options);
      process.stdout.write(result.encoded);
      if (!result.success) process.exitCode = 1;
    } catch (error) {
      process.stdout.write(rejectedScenario(args[0], args[1], error, options?.format === 'json' ? 'json' : 'toon'));
      process.exitCode = 1;
    }
  }
}
