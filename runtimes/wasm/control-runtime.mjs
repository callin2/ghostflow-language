import { GhostFlowRuntime } from './ghostflow-runtime.mjs';
import { SignalConditioner } from './signals.mjs';

const FORMAT = 'GhostFlow/control-v1';
const SETTINGS_FORMAT = 'GhostFlow/control-v2';
const RESERVED = '__gf_';
const TYPES = new Set(['Bool', 'Number', 'Percent', 'Duration']);
const SENSOR_TYPES = new Set(['Bool', 'Number', 'Percent']);
const MAX_WINDOW = 31;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_LIST = 128;
const MAX_NAMES = 128;
const MAX_NAME_LENGTH = 128;
const MAX_SCHEDULE_SLOTS = 96;

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  return value;
}

function freeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function keys(value, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} has unknown key ${key}`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${label}.${key} is required`);
}

function string(value, label) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function name(value, label, generated = false) {
  string(value, label);
  if (value.length > MAX_NAME_LENGTH) throw new RangeError(`${label} exceeds ${MAX_NAME_LENGTH} characters`);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`${label} is not an identifier`);
  if (!generated && value.startsWith(RESERVED)) throw new Error(`${label} uses reserved prefix ${RESERVED}`);
  return value;
}

function type(value, label) {
  if (!TYPES.has(value)) throw new Error(`${label} has unsupported type ${String(value)}`);
  return value;
}

function safeInteger(value, label, minimum = 0, maximum = MAX_SAFE) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function typedValue(value, valueType, label) {
  if (valueType === 'Bool') {
    if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  } else if (valueType === 'Duration') {
    safeInteger(value, label);
  } else {
    finite(value, label);
    if (valueType === 'Percent' && (value < 0 || value > 100)) throw new RangeError(`${label} must be in [0, 100]`);
  }
  return value;
}

function optionalFinite(value, label) {
  if (value !== null) finite(value, label);
  return value;
}

function validateList(list, label, required, optional = []) {
  if (!Array.isArray(list)) throw new TypeError(`${label} must be an array`);
  if (list.length > MAX_LIST) throw new RangeError(`${label} exceeds ${MAX_LIST} entries`);
  return list.map((item, index) => {
    const value = record(item, `${label}[${index}]`);
    keys(value, required, optional, `${label}[${index}]`);
    return copy(value);
  });
}

function unique(items, label) {
  const seen = new Set();
  for (const item of items) { if (seen.has(item)) throw new Error(`duplicate ${label} ${item}`); seen.add(item); }
}

function generated(value, expected, label) {
  if (value !== expected) throw new Error(`${label} must be ${expected}`);
}

function validateSettings(config, label) {
  const settings = record(config.settings, `${label}.settings`);
  keys(settings, ['access'], ['min', 'max', 'step', 'apply', 'label'], `${label}.settings`);
  if (settings.access !== 'operator' && settings.access !== 'designer') throw new Error(`${label}.settings.access must be operator or designer`);
  if (settings.apply !== undefined && settings.apply !== 'stopped') throw new Error(`${label}.settings.apply must be stopped`);
  if (settings.label !== undefined && (typeof settings.label !== 'string' || settings.label.length === 0 || settings.label.length > 128)) {
    throw new Error(`${label}.settings.label must be a string of 1 to 128 characters`);
  }

  const numericKeys = ['min', 'max', 'step'];
  const presentNumeric = numericKeys.filter(key => Object.prototype.hasOwnProperty.call(settings, key));
  if (config.type === 'Bool') {
    if (presentNumeric.length > 0) throw new Error(`${label}.settings cannot define numeric bounds for Bool`);
  } else {
    for (const key of numericKeys) if (!Object.prototype.hasOwnProperty.call(settings, key)) throw new Error(`${label}.settings.${key} is required for numeric config`);
    for (const key of numericKeys) typedValue(settings[key], config.type, `${label}.settings.${key}`);
    if (settings.min > settings.max) throw new Error(`${label}.settings range is inverted`);
    if (settings.step <= 0) throw new Error(`${label}.settings.step must be positive`);
    if (Math.abs((config.value - settings.min) / settings.step - Math.round((config.value - settings.min) / settings.step)) > 1e-9) {
      throw new Error(`${label}.value is not aligned to settings.step from settings.min`);
    }
    if (config.value < settings.min || config.value > settings.max) throw new Error(`${label}.value is outside settings range`);
  }

  // Compiler-emitted source-literal spans are metadata for candidate generation.
  // Validate them strictly instead of accepting or silently dropping them.
  const hasStart = Object.prototype.hasOwnProperty.call(config, 'initialOffset');
  const hasEnd = Object.prototype.hasOwnProperty.call(config, 'initialEndOffset');
  if (hasStart !== hasEnd) throw new Error(`${label} literal offsets must be provided together`);
  if (hasStart) {
    safeInteger(config.initialOffset, `${label}.initialOffset`);
    safeInteger(config.initialEndOffset, `${label}.initialEndOffset`);
    if (config.initialEndOffset <= config.initialOffset) throw new Error(`${label} literal offsets must be increasing`);
  }

  const normalized = copy(settings);
  if (normalized.apply === undefined) normalized.apply = 'stopped';
  return normalized;
}

function validateManifest(input, { acceptSettings = false } = {}) {
  const manifest = record(input, 'manifest');
  keys(manifest, ['format', 'name', 'inputs', 'outputs', 'sensors', 'schedules', 'timers', 'signals', 'configs', 'bytecodeSha256'], [], 'manifest');
  if (manifest.format !== FORMAT && (manifest.format !== SETTINGS_FORMAT || !acceptSettings)) throw new Error(`unsupported manifest format ${String(manifest.format)}`);
  const settingsManifest = manifest.format === SETTINGS_FORMAT;
  name(manifest.name, 'manifest.name');
  if (typeof manifest.bytecodeSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.bytecodeSha256)) throw new Error('manifest.bytecodeSha256 must be a lowercase SHA-256 hex digest');

  const inputs = validateList(manifest.inputs, 'manifest.inputs', ['name', 'type']);
  const outputs = validateList(manifest.outputs, 'manifest.outputs', ['name', 'type']);
  const sensors = validateList(manifest.sensors, 'manifest.sensors', ['name', 'type', 'sampleMs', 'validMin', 'validMax', 'filter', 'window', 'staleMs', 'recoverSamples', 'valueInput', 'okInput'], ['optional']);
  const schedules = validateList(manifest.schedules, 'manifest.schedules', ['name', 'timezone', 'slots', 'dueInput']);
  const timers = validateList(manifest.timers, 'manifest.timers', ['name', 'state', 'clockInput']);
  const signals = validateList(manifest.signals, 'manifest.signals', ['name', 'sensor', 'onBelow', 'offAbove', 'initial', 'valueInput', 'okInput']);
  const configs = validateList(manifest.configs, 'manifest.configs', ['name', 'type', 'value'], settingsManifest ? ['settings', 'initialOffset', 'initialEndOffset'] : []);

  for (const item of inputs) { name(item.name, 'input.name'); type(item.type, `input ${item.name}.type`); }
  for (const item of outputs) { name(item.name, 'output.name'); type(item.type, `output ${item.name}.type`); }
  unique(inputs.map(item => item.name), 'input');
  unique(outputs.map(item => item.name), 'output');
  unique([...inputs, ...outputs].map(item => item.name), 'port');
  const declarationNames = [...inputs, ...outputs, ...configs, ...sensors, ...schedules, ...timers, ...signals].map(item => item.name);
  if (declarationNames.length > MAX_NAMES) throw new RangeError(`manifest names exceed ${MAX_NAMES}`);
  unique(declarationNames, 'declaration');
  const generatedTotal = sensors.length * 2 + signals.length * 2 + schedules.length + timers.length * 2 + (timers.length > 0 ? 1 : 0);
  if (generatedTotal > MAX_NAMES) throw new RangeError(`generated manifest names exceed ${MAX_NAMES}`);
  const inputNames = new Set(inputs.map(item => item.name));

  for (const item of configs) {
    name(item.name, 'config.name');
    type(item.type, `config ${item.name}.type`);
    typedValue(item.value, item.type, `config ${item.name}.value`);
    const hasSettings = Object.prototype.hasOwnProperty.call(item, 'settings');
    const hasOffsets = Object.prototype.hasOwnProperty.call(item, 'initialOffset') || Object.prototype.hasOwnProperty.call(item, 'initialEndOffset');
    if (!settingsManifest && (hasSettings || hasOffsets)) throw new Error(`v1 config ${item.name} cannot contain operating settings metadata`);
    if (settingsManifest && hasOffsets && !hasSettings) throw new Error(`v2 config ${item.name} literal offsets require settings`);
    if (settingsManifest && hasSettings) item.settings = validateSettings(item, `config ${item.name}`);
  }
  unique(configs.map(item => item.name), 'config');

  const sensorByName = new Map();
  for (const item of sensors) {
    name(item.name, 'sensor.name');
    type(item.type, `sensor ${item.name}.type`);
    if (!SENSOR_TYPES.has(item.type)) throw new Error(`sensor ${item.name} has unsupported type ${item.type}`);
    if (item.sampleMs !== null) safeInteger(item.sampleMs, `sensor ${item.name}.sampleMs`, 1);
    if (item.staleMs !== null) safeInteger(item.staleMs, `sensor ${item.name}.staleMs`, 1);
    if (item.recoverSamples !== null) safeInteger(item.recoverSamples, `sensor ${item.name}.recoverSamples`, 1, MAX_WINDOW);
    if (item.filter !== null && item.filter !== 'median') throw new Error(`sensor ${item.name} uses unsupported filter ${String(item.filter)}`);
    if (item.window !== null) {
      safeInteger(item.window, `sensor ${item.name}.window`, 1, MAX_WINDOW);
      if (item.window % 2 === 0) throw new Error(`sensor ${item.name}.window must be odd for median`);
    }
    if (item.filter === null && item.window !== null) throw new Error(`sensor ${item.name}.window requires filter=median`);
    optionalFinite(item.validMin, `sensor ${item.name}.validMin`);
    optionalFinite(item.validMax, `sensor ${item.name}.validMax`);
    if ((item.validMin === null) !== (item.validMax === null)) throw new Error(`sensor ${item.name} valid range requires both bounds`);
    if (item.validMin !== null && item.validMin > item.validMax) throw new Error(`sensor ${item.name} valid range is inverted`);
    if (item.type === 'Percent') {
      for (const bound of ['validMin', 'validMax']) if (item[bound] !== null && (item[bound] < 0 || item[bound] > 100)) throw new RangeError(`sensor ${item.name}.${bound} must be in [0, 100]`);
    }
    name(item.valueInput, `sensor ${item.name}.valueInput`, true);
    name(item.okInput, `sensor ${item.name}.okInput`, true);
    generated(item.valueInput, `${RESERVED}sensor_value_${item.name}`, `sensor ${item.name}.valueInput`);
    generated(item.okInput, `${RESERVED}sensor_ok_${item.name}`, `sensor ${item.name}.okInput`);
    if (item.optional !== undefined && typeof item.optional !== 'boolean') throw new TypeError(`sensor ${item.name}.optional must be boolean`);
    sensorByName.set(item.name, item);
  }
  unique(sensors.map(item => item.name), 'sensor');
  if (new Set(sensorByName.keys()).size !== sensors.length) throw new Error('duplicate sensor name');

  const scheduleNames = new Set();
  for (const item of schedules) {
    name(item.name, 'schedule.name');
    string(item.timezone, `schedule ${item.name}.timezone`);
    try { new Intl.DateTimeFormat('en-US', { timeZone: item.timezone }).format(0); }
    catch { throw new Error(`schedule ${item.name}.timezone is not an Intl timezone`); }
    if (!Array.isArray(item.slots) || item.slots.length > MAX_SCHEDULE_SLOTS) throw new RangeError(`schedule ${item.name}.slots must contain at most ${MAX_SCHEDULE_SLOTS} slots`);
    for (const slot of item.slots) { safeInteger(slot, `schedule ${item.name}.slot`, 0, 1439); if (slot % 15 !== 0) throw new Error(`schedule ${item.name}.slot must be a 15-minute boundary`); }
    unique(item.slots, `schedule ${item.name}.slot`);
    name(item.dueInput, `schedule ${item.name}.dueInput`, true);
    generated(item.dueInput, `${RESERVED}schedule_due_${item.name}`, `schedule ${item.name}.dueInput`);
    scheduleNames.add(item.name);
  }
  unique(schedules.map(item => item.name), 'schedule');

  for (const item of timers) {
    name(item.name, 'timer.name'); name(item.state, `timer ${item.name}.state`, true);
    if (item.clockInput !== `${RESERVED}now_ms`) throw new Error(`timer ${item.name}.clockInput must be ${RESERVED}now_ms`);
  }
  unique(timers.map(item => item.name), 'timer');

  const signalNames = new Set();
  for (const item of signals) {
    name(item.name, 'signal.name');
    const sensor = sensorByName.get(item.sensor);
    if (!sensor) throw new Error(`signal ${item.name} references unknown sensor ${String(item.sensor)}`);
    if (sensor.type === 'Bool') throw new Error(`signal ${item.name} requires a numeric sensor`);
    finite(item.onBelow, `signal ${item.name}.onBelow`); finite(item.offAbove, `signal ${item.name}.offAbove`);
    if (item.onBelow >= item.offAbove) throw new Error(`signal ${item.name} hysteresis bounds are inverted`);
    if (sensor.type === 'Percent' && (item.onBelow < 0 || item.onBelow > 100 || item.offAbove < 0 || item.offAbove > 100)) throw new RangeError(`signal ${item.name} thresholds must be in [0, 100]`);
    if (typeof item.initial !== 'boolean') throw new TypeError(`signal ${item.name}.initial must be boolean`);
    name(item.valueInput, `signal ${item.name}.valueInput`, true); name(item.okInput, `signal ${item.name}.okInput`, true);
    generated(item.valueInput, `${RESERVED}signal_value_${item.name}`, `signal ${item.name}.valueInput`);
    generated(item.okInput, `${RESERVED}signal_ok_${item.name}`, `signal ${item.name}.okInput`);
    signalNames.add(item.name);
  }
  unique(signals.map(item => item.name), 'signal');

  for (const item of inputs) if (item.name.startsWith(RESERVED)) throw new Error(`input ${item.name} uses reserved prefix`);
  for (const item of outputs) if (item.name.startsWith(RESERVED)) throw new Error(`output ${item.name} uses reserved prefix`);
  const publicManifest = freeze({ ...copy(manifest), inputs, outputs, sensors, schedules, timers, signals, configs });
  return { manifest: publicManifest, inputNames, sensorByName, scheduleNames, signalNames };
}

function bytes(value, label) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`${label} must be an ArrayBuffer or typed array`);
}

async function sha256(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('crypto.subtle is unavailable for bytecode verification');
  const digest = await subtle.digest('SHA-256', value);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function sensorConfig(item) {
  // sampleMs is descriptive cadence metadata only; step() never polls hardware.
  const defaults = item.type === 'Bool' ? { min: 0, max: 1 } : item.type === 'Percent' ? { min: 0, max: 100 } : { min: -Number.MAX_VALUE, max: Number.MAX_VALUE };
  return {
    filter: 'median', window: item.window ?? 1,
    validMin: item.validMin ?? defaults.min, validMax: item.validMax ?? defaults.max,
    staleMs: item.staleMs ?? 3000, recoverSamples: item.recoverSamples ?? 1,
  };
}

function hostReading(raw, sensorType) {
  return { ok: raw.ok, value: raw.ok ? (sensorType === 'Bool' ? Boolean(raw.value) : raw.value) : (sensorType === 'Bool' ? false : 0), quality: raw.quality };
}

function inputValue(value, inputType, label) { return typedValue(value, inputType, label); }

export class ControlRuntime {
  static async instantiate(wasmBytes, { bytes: bytecode, manifest } = {}, options = {}) {
    const wasm = new Uint8Array(bytes(wasmBytes, 'wasmBytes'));
    // Copy caller-owned bytecode before awaiting digest verification (TOCTOU-safe).
    const compiledBytes = new Uint8Array(bytes(bytecode, 'bytes'));
    const checkedManifest = validateManifest(manifest, options);
    const digest = await sha256(compiledBytes);
    if (digest !== checkedManifest.manifest.bytecodeSha256) throw new Error('bytecode SHA-256 does not match manifest');

    const runtime = await GhostFlowRuntime.instantiate(wasm);
    const sensors = new Map();
    const signals = new Map();
    try {
      runtime.load(compiledBytes);
      for (const item of checkedManifest.manifest.sensors) sensors.set(item.name, { item, conditioner: new SignalConditioner(runtime.wasm, sensorConfig(item)) });
      for (const item of checkedManifest.manifest.signals) {
        const sensor = checkedManifest.sensorByName.get(item.sensor);
        // Signals intentionally duplicate the sensor conditioner: each node owns
        // its own bounded 31-slot state and can be checkpointed independently.
        signals.set(item.name, { item, conditioner: new SignalConditioner(runtime.wasm, { ...sensorConfig(sensor), hysteresis: { onBelow: item.onBelow, offAbove: item.offAbove, initial: item.initial } }) });
      }
      for (const output of checkedManifest.manifest.outputs) runtime.addCapability('actuator', output.name, output.type === 'Bool' ? 'bool' : 'number');
      runtime.activate();
    } catch (error) {
      for (const { conditioner } of signals.values()) conditioner.dispose();
      for (const { conditioner } of sensors.values()) conditioner.dispose();
      runtime.dispose();
      throw error;
    }
    return new ControlRuntime(runtime, checkedManifest, sensors, signals);
  }

  // New simulation consumers opt into the v2 operating-settings contract.
  // The original instantiate entry point remains a strict v1 consumer.
  static async instantiateSimulation(wasmBytes, artifact = {}) {
    return ControlRuntime.instantiate(wasmBytes, artifact, { acceptSettings: true });
  }

  constructor(runtime, manifest, sensors, signals) {
    this.runtime = runtime;
    this.exports = runtime.wasm;
    this.manifest = manifest.manifest;
    this.inputNames = manifest.inputNames;
    this.sensorByName = manifest.sensorByName;
    this.scheduleNames = manifest.scheduleNames;
    this.sensors = sensors;
    this.signals = signals;
    this.lastNowMs = null;
  }

  /**
   * Executes one caller-supplied snapshot. Sensor sampleMs is metadata for the
   * acquisition owner; this host never polls hardware or performs I/O.
   */
  step({ nowMs, inputs = {}, samples = {}, due = {} } = {}) {
    this.#live();
    safeInteger(nowMs, 'nowMs');
    if (this.lastNowMs !== null && nowMs < this.lastNowMs) throw new Error('nowMs must be monotonic');
    record(inputs, 'inputs'); record(samples, 'samples'); record(due, 'due');
    const inputKeys = Object.keys(inputs);
    for (const key of inputKeys) if (!this.inputNames.has(key)) throw new Error(`unknown input ${key}`);
    for (const item of this.manifest.inputs) if (!Object.prototype.hasOwnProperty.call(inputs, item.name)) throw new Error(`missing input ${item.name}`);
    for (const key of Object.keys(samples)) if (!this.sensorByName.has(key)) throw new Error(`unknown sensor ${key}`);
    for (const key of Object.keys(due)) if (!this.scheduleNames.has(key)) throw new Error(`unknown schedule ${key}`);

    const normalizedSamples = new Map();
    for (const [sensorName, raw] of Object.entries(samples)) {
      const item = this.sensorByName.get(sensorName);
      const sample = record(raw, `samples.${sensorName}`);
      keys(sample, ['epoch', 'id', 'timestampMs', 'quality', 'value'], [], `samples.${sensorName}`);
      const epoch = safeInteger(sample.epoch, `samples.${sensorName}.epoch`);
      const id = safeInteger(sample.id, `samples.${sensorName}.id`);
      const timestampMs = safeInteger(sample.timestampMs, `samples.${sensorName}.timestampMs`);
      if (timestampMs > nowMs) throw new RangeError(`samples.${sensorName}.timestampMs cannot be in the future`);
      const quality = sample.quality;
      if (!(typeof quality === 'number' ? Number.isInteger(quality) && quality >= 0 && quality <= 4 : ['NotReady', 'Good', 'Disconnected', 'Stale', 'Invalid'].includes(quality))) throw new TypeError(`samples.${sensorName}.quality is unsupported`);
      let value;
      if (item.type === 'Bool') {
        if (typeof sample.value !== 'boolean') throw new TypeError(`samples.${sensorName}.value must be boolean`);
        value = sample.value ? 1 : 0;
      } else {
        if (typeof sample.value !== 'number') throw new TypeError(`samples.${sensorName}.value must be numeric`);
        // Hardware payloads are fallible data. Normalize non-finite values to a
        // core Invalid sample so the VM receives a safe value and provenance.
        value = Number.isFinite(sample.value) ? sample.value : 0;
      }
      normalizedSamples.set(sensorName, { epoch, id, timestampMs, value, quality: Number.isFinite(sample.value) || item.type === 'Bool' ? quality : 'Invalid' });
    }
    for (const item of this.manifest.inputs) inputValue(inputs[item.name], item.type, `inputs.${item.name}`);
    for (const [scheduleName, value] of Object.entries(due)) if (typeof value !== 'boolean') throw new TypeError(`due.${scheduleName} must be boolean`);

    const sensorReadings = new Map();
    for (const [sensorName, entry] of this.sensors) {
      const raw = normalizedSamples.has(sensorName) ? entry.conditioner.update(normalizedSamples.get(sensorName), nowMs) : entry.conditioner.read(nowMs);
      sensorReadings.set(sensorName, hostReading(raw, entry.item.type));
    }
    const signalReadings = new Map();
    for (const [signalName, entry] of this.signals) {
      const raw = normalizedSamples.has(entry.item.sensor) ? entry.conditioner.update(normalizedSamples.get(entry.item.sensor), nowMs) : entry.conditioner.read(nowMs);
      signalReadings.set(signalName, { ok: raw.ok, value: raw.ok ? Boolean(raw.dry) : false, quality: raw.quality, dry: raw.ok ? Boolean(raw.dry) : false });
    }

    for (const item of this.manifest.inputs) {
      if (item.type === 'Bool') this.runtime.setBool(item.name, inputs[item.name]);
      else this.runtime.setNumber(item.name, inputs[item.name]);
    }
    for (const [sensorName, entry] of this.sensors) {
      const reading = sensorReadings.get(sensorName);
      if (entry.item.type === 'Bool') this.runtime.setBool(entry.item.valueInput, reading.value);
      else this.runtime.setNumber(entry.item.valueInput, reading.value);
      this.runtime.setBool(entry.item.okInput, reading.ok);
    }
    for (const [signalName, entry] of this.signals) {
      const reading = signalReadings.get(signalName);
      this.runtime.setBool(entry.item.valueInput, reading.value);
      this.runtime.setBool(entry.item.okInput, reading.ok);
    }
    for (const item of this.manifest.schedules) this.runtime.setBool(item.dueInput, due[item.name] ?? false);
    if (this.manifest.timers.length > 0) this.runtime.tickAt(nowMs); else this.runtime.tick();
    this.lastNowMs = nowMs;
    return {
      vm: this.runtime.trace,
      sensors: Object.fromEntries(sensorReadings),
      signals: Object.fromEntries(signalReadings),
    };
  }

  dispose() {
    for (const { conditioner } of this.signals.values()) conditioner.dispose();
    for (const { conditioner } of this.sensors.values()) conditioner.dispose();
    this.runtime.dispose();
    this.lastNowMs = null;
  }

  #live() { if (!this.runtime.handle) throw new Error('ControlRuntime is disposed'); }
}
