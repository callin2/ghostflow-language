import { GhostFlowRuntime } from './ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from './framed-runtime.mjs';
import { SignalConditioner } from './signals.mjs';
import { AFTER_EVENT_CAPACITY, AfterEventRuntime } from './after-event-runtime.mjs';
import { NativeDispatchError } from './native-dispatch.mjs';
import { encodeTemporalProfile } from './temporal-profile.mjs';
import { validateSolarDescriptor, validateClockPolicy, validateSolarFallback, validateSolarFallbackFacts } from './solar-schedule.mjs';
import { validateSolarActivation } from './solar-abi.mjs';
import { encodeContextActivation, encodeContextFacts, validateContextSolarFacts } from './context-abi.mjs';
import { QUANTITY_TYPES, canonicalUnitFor, isQuantityType } from '../../tools/quantities.mjs';
import { TIME_TYPES, isTimeType, validateTimeValue } from '../../tools/time-literals.mjs';
import { isInt32, intSettingsIssue } from '../../tools/int-settings.mjs';

const FORMAT = 'GhostFlow/control-v1';
const SETTINGS_FORMAT = 'GhostFlow/control-v2';
const SOLAR_FORMAT = 'GhostFlow/control-v3';
const INTEGER_FORMAT = 'GhostFlow/control-v4';
const SCHEDULE_FORMAT = 'GhostFlow/control-v7';
const SCHEDULE_SLOTS_FORMAT = 'GhostFlow/control-v8';
const STREAM_CONTEXT_FORMAT = 'GhostFlow/control-v10';
const AVAILABILITY_FORMAT = 'GhostFlow/control-v12';
const AT_FORMAT = 'GhostFlow/control-v13';
const HOLIDAY_FORMAT = 'GhostFlow/control-v14';
const SOLAR_CONTEXT_FORMAT = 'GhostFlow/control-v15';
const CALENDAR_EXECUTION_FORMAT = 'GhostFlow/control-v18';
const contextManifest = manifest => manifest?.format === STREAM_CONTEXT_FORMAT
  || manifest?.format === CALENDAR_EXECUTION_FORMAT
  || manifest?.format === SOLAR_CONTEXT_FORMAT
  || manifest?.format === HOLIDAY_FORMAT
  || manifest?.format === AT_FORMAT
  || manifest?.format === AVAILABILITY_FORMAT && !manifest.schedules?.some(item => item.kind === 'solar');
const RESERVED = '__gf_';
const TYPES = new Set(['Bool', 'Int', 'Number', 'Percent', 'Duration', ...TIME_TYPES, ...QUANTITY_TYPES]);
const SENSOR_TYPES = new Set(['Bool', 'Number', 'Percent', ...QUANTITY_TYPES]);
const MAX_WINDOW = 31;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_LIST = 128;
const MAX_NAMES = 128;
const MAX_NAME_LENGTH = 128;
const MAX_SCHEDULE_SLOTS = 96;
const SENSOR_FAULT_CODE = Object.freeze({ Disconnected: 0, Stale: 1, Invalid: 2, NotReady: 3 });
const HOLD_STATE_ROLES = ['available', 'value', 'heldSourceTag', 'heldEpoch', 'heldId', 'heldTimestamp', 'held', 'age', 'maskedFaultPresent', 'maskedFaultCode', 'maskedFaultOrigin'];
const isVmSignal = item => item.kind === 'debounce' || item.kind === 'hold-last' || item.kind === 'window';
const isAfterEvent = item => item.kind === 'after-event';
const RATE_TYPES = new Set(['Temperature', 'TemperatureDelta', 'Pressure', 'VaporPressureDeficit', 'FlowRate', 'Volume', 'Length', 'Irradiance', 'PPFD', 'Energy', 'Power', 'ElectricalCurrent', 'Voltage', 'Conductivity']);

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

function portName(value, label) {
  string(value, label);
  if (value.length > MAX_NAME_LENGTH) throw new RangeError(`${label} exceeds ${MAX_NAME_LENGTH} characters`);
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u.test(value)) throw new Error(`${label} is not a logical port name`);
  if (value.startsWith(RESERVED)) throw new Error(`${label} uses reserved prefix ${RESERVED}`);
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
  } else if (valueType === 'Int') {
    if (!isInt32(value)) throw new TypeError(`${label} must be a safe integer in [-2147483648, 2147483647]`);
  } else if (valueType === 'Duration') {
    safeInteger(value, label);
  } else if (isTimeType(valueType)) {
    try { validateTimeValue(valueType, value, label); } catch (cause) { throw new TypeError(cause.message); }
  } else {
    finite(value, label);
    if (valueType === 'Percent' && (value < 0 || value > 100)) throw new RangeError(`${label} must be in [0, 100]`);
    if (valueType === 'RelativeHumidity' && (value < 0 || value > 1)) throw new RangeError(`${label} must be in [0, 1]`);
  }
  return value;
}

function optionalFinite(value, label) {
  if (value !== null) finite(value, label);
  return value;
}

const INTERVAL_FIELDS = Object.freeze(['present', 'epoch', 'id', 'start', 'end', 'value', 'quality', 'fault']);
const INTERVAL_QUALITY = Object.freeze({ Measured: 1, Held: 2, Constructed: 3 });
const INTERVAL_FAULT = Object.freeze({ Disconnected: 0, Stale: 1, Invalid: 2, NotReady: 3 });

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

function validateSettings(config, label, { stream = false } = {}) {
  const settings = record(config.settings, `${label}.settings`);
  keys(settings, ['access'], ['min', 'max', 'step', 'stepType', ...(stream ? [] : ['apply']), 'label'], `${label}.settings`);
  if (settings.access !== 'operator' && settings.access !== 'designer') throw new Error(`${label}.settings.access must be operator or designer`);
  if (!stream && settings.apply !== undefined && settings.apply !== 'stopped') throw new Error(`${label}.settings.apply must be stopped`);
  if (settings.label !== undefined && (typeof settings.label !== 'string' || settings.label.length === 0 || settings.label.length > 128)) {
    throw new Error(`${label}.settings.label must be a string of 1 to 128 characters`);
  }

  const numericKeys = ['min', 'max', 'step'];
  const presentNumeric = numericKeys.filter(key => Object.prototype.hasOwnProperty.call(settings, key));
  if (config.type === 'Bool') {
    if (presentNumeric.length > 0) throw new Error(`${label}.settings cannot define numeric bounds for Bool`);
  } else {
    if (config.type === 'Temperature') {
      if (settings.stepType !== 'TemperatureDelta') throw new Error(`${label}.settings.stepType must be TemperatureDelta`);
    } else if (config.type === 'Date') {
      if (settings.stepType !== 'Int') throw new Error(`${label}.settings.stepType must be Int`);
    } else if (config.type === 'TimeOfDay' || config.type === 'DateTime') {
      if (settings.stepType !== 'Duration') throw new Error(`${label}.settings.stepType must be Duration`);
    } else if (Object.prototype.hasOwnProperty.call(settings, 'stepType')) {
      throw new Error(`${label}.settings.stepType is forbidden for ${config.type}`);
    }
    for (const key of numericKeys) if (!Object.prototype.hasOwnProperty.call(settings, key)) throw new Error(`${label}.settings.${key} is required for numeric config`);
    typedValue(settings.min, config.type, `${label}.settings.min`);
    typedValue(settings.max, config.type, `${label}.settings.max`);
    if (config.type === 'Date') typedValue(settings.step, 'Int', `${label}.settings.step`);
    else if (config.type === 'TimeOfDay' || config.type === 'DateTime') typedValue(settings.step, 'Duration', `${label}.settings.step`);
    else typedValue(settings.step, config.type === 'Temperature' ? 'TemperatureDelta' : config.type, `${label}.settings.step`);
    if (config.type === 'Int') {
      const issue = intSettingsIssue(config.value, settings);
      if (issue === 'inverted-range') throw new Error(`${label}.settings range is inverted`);
      if (issue === 'nonpositive-step') throw new Error(`${label}.settings.step must be positive`);
      if (issue === 'value-grid') throw new Error(`${label}.value is not aligned to settings.step from settings.min`);
      if (issue === 'max-grid') throw new Error(`${label}.settings.max is not aligned to settings.step from settings.min`);
      if (issue === 'value-range') throw new Error(`${label}.value is outside settings range`);
    } else {
      if (settings.min > settings.max) throw new Error(`${label}.settings range is inverted`);
      if (settings.step <= 0) throw new Error(`${label}.settings.step must be positive`);
      const misaligned = isTimeType(config.type)
        ? (config.value - settings.min) % settings.step !== 0
        : Math.abs((config.value - settings.min) / settings.step - Math.round((config.value - settings.min) / settings.step)) > 1e-9;
      if (misaligned) {
        throw new Error(`${label}.value is not aligned to settings.step from settings.min`);
      }
      if (isTimeType(config.type) && (settings.max - settings.min) % settings.step !== 0) {
        throw new Error(`${label}.settings.max is not aligned to settings.step from settings.min`);
      }
      if (config.value < settings.min || config.value > settings.max) throw new Error(`${label}.value is outside settings range`);
    }
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
  if (!stream && normalized.apply === undefined) normalized.apply = 'stopped';
  return normalized;
}

function validateCanonicalUnit(item, label) {
  const hasUnit = Object.prototype.hasOwnProperty.call(item, 'canonicalUnit');
  if (isQuantityType(item.type)) {
    if (!hasUnit) throw new Error(`${label}.canonicalUnit is required`);
    const expected = canonicalUnitFor(item.type);
    if (item.canonicalUnit !== expected) throw new Error(`${label}.canonicalUnit must be ${expected}`);
  } else if (hasUnit) throw new Error(`${label}.canonicalUnit is forbidden for non-quantity type ${item.type}`);
}

function validateContextManifest(input, bytecodeFormat) {
  const manifest = record(input, 'manifest');
  keys(manifest, ['format','name','inputs','outputs','sensors','schedules','timers','signals','configs','bytecodeSha256'],
    ['providers','calendars','naturalConditions','calendarConditions','accounting','resources','objectives','adaptSettings'], 'manifest');
  if (manifest.format === CALENDAR_EXECUTION_FORMAT ? bytecodeFormat !== 18 : manifest.format === SOLAR_CONTEXT_FORMAT ? bytecodeFormat !== 16 : manifest.format === HOLIDAY_FORMAT ? bytecodeFormat !== 15 : manifest.format === AT_FORMAT ? bytecodeFormat !== 14 : manifest.format === AVAILABILITY_FORMAT ? bytecodeFormat !== 13 : ![11, 12].includes(bytecodeFormat)) throw new Error('context manifest requires its matching GFB format');
  name(manifest.name, 'manifest.name');
  if (!/^[0-9a-f]{64}$/.test(manifest.bytecodeSha256)) throw new Error('invalid bytecode SHA-256');
  const inputs = validateList(manifest.inputs, 'manifest.inputs', ['name','type'], ['canonicalUnit']);
  const outputs = validateList(manifest.outputs, 'manifest.outputs', ['name','type'], ['canonicalUnit']);
  const schedules = validateList(manifest.schedules, 'manifest.schedules', ['kind','site','name','policy'],
    ['timezone','latitude','longitude','configIds','source','event','offsetMs','anchor','every','intervalChange','cron5','fields','dstMissing','dstRepeated','atMs','day','gridMs','slots','selectedConfig']);
  const configs = validateList(manifest.configs, 'manifest.configs', ['name','type','value'],
    ['id','settings','gridMs','capacity','initialOffset','initialEndOffset','canonicalUnit','displayUnit']);
  const sensors = validateList(manifest.sensors, 'manifest.sensors',
    ['name','type','sampleMs','validMin','validMax','filter','window','staleMs','recoverSamples','valueInput','okInput','faultInput'],
    ['optional','alpha','canonicalUnit','samplePresentInput','sampleEpochInput','sampleIdInput','sampleTimestampInput']);
  const objectives = validateList(manifest.objectives ?? [], 'manifest.objectives',
    ['name','measure','target','manipulate','output','controller','binding','executable','bindings']);
  const resources = validateList(manifest.resources ?? [], 'manifest.resources', ['name','type']);
  const adaptSettings = validateList(manifest.adaptSettings ?? [], 'manifest.adaptSettings',
    ['name','target','authority','runtime'], ['targetId','targetType']);
  const providers = validateList(manifest.providers ?? [], 'manifest.providers', ['name','type']);
  const calendars = validateList(manifest.calendars ?? [], 'manifest.calendars', ['name','type']);
  const naturals = validateList(manifest.naturalConditions ?? [], 'manifest.naturalConditions',
    ['site','operation','provider','classification','result','projectionInputs']);
  const calendarConditions = validateList(manifest.calendarConditions ?? [], 'manifest.calendarConditions',
    ['site','calendar','classification','timezone','result','projectionInputs']);
  if (manifest.format === CALENDAR_EXECUTION_FORMAT && !calendarConditions.length && !schedules.some(item => item.day && item.policy?.basis?.kind === 'range')) throw new Error('calendar execution profile requires a calendar Result or Range');
  if (manifest.format !== CALENDAR_EXECUTION_FORMAT && calendarConditions.length) throw new Error('calendar Result requires control-v18');
  const accounting = manifest.accounting === undefined ? null : copy(record(manifest.accounting, 'manifest.accounting'));
  if (manifest.format === SOLAR_CONTEXT_FORMAT && !schedules.some(item => item.kind === 'solar')) throw new Error('Solar context profile requires Solar');
  if (manifest.format === HOLIDAY_FORMAT && (!schedules.some(item => item.kind === 'daily' && item.day?.kind === 'holiday')
    || schedules.some(item => item.kind === 'at'))) throw new Error('Holiday profile requires Holiday Daily and excludes At');
  if (manifest.format === AT_FORMAT && (!schedules.length || schedules.some(item => item.kind !== 'at')
    || [configs,sensors,objectives,resources,adaptSettings,providers,calendars,naturals].some(list => list.length) || accounting)) {
    throw new Error('At profile requires At-only execution');
  }
  if (manifest.signals.length) throw new Error('context signal mixing is not supported');
  if (sensors.length && (!objectives.length || sensors.length !== 1)) throw new Error('context sensors require one PID objective');
  const timers = validateList(manifest.timers, 'manifest.timers', ['name','state','clockInput']);
  for (const item of timers) {
    name(item.name, 'timer.name'); name(item.state, `timer ${item.name}.state`);
    if (item.clockInput !== `${RESERVED}now_ms`) throw new Error(`timer ${item.name}.clockInput must be ${RESERVED}now_ms`);
  }
  for (const item of inputs) { name(item.name, 'input.name'); if (item.name.startsWith(RESERVED)) throw new Error('reserved user input'); type(item.type, `input ${item.name}.type`); validateCanonicalUnit(item, `input ${item.name}`); }
  for (const item of outputs) { portName(item.name, 'output.name'); type(item.type, `output ${item.name}.type`); validateCanonicalUnit(item, `output ${item.name}`); }
  for (const item of schedules) {
    name(item.name, 'schedule.name'); safeInteger(item.site, 'schedule.site', 1, 0xffff_ffff);
    if (item.kind === 'at') {
      if (manifest.format !== AT_FORMAT) throw new Error('At requires control-v13 and GFB14');
      keys(item, ['kind','site','name','policy','atMs'], [], 'At schedule');
      safeInteger(item.atMs, 'At atMs', 0, 253_402_300_799_999);
      keys(record(item.policy, 'At policy'), ['basis','when','clock','gapMs','recovery','fallback'], [], 'At policy');
      if (item.policy.basis !== 'pulse' || item.policy.clock !== 'trusted_only' || item.policy.recovery !== 'baseline'
        || item.policy.fallback !== 'skip') throw new Error('unsupported At policy');
      safeInteger(item.policy.gapMs, 'At gapMs', 1);
      continue;
    }
    if (item.kind === 'solar') {
      if (manifest.format !== SOLAR_CONTEXT_FORMAT) throw new Error('context Solar requires control-v15 and GFB16');
      keys(item, ['kind','site','name','timezone','latitude','longitude','event','offsetMs','policy','configIds'], [], 'context Solar schedule');
      if (!Array.isArray(item.configIds) || item.configIds.length > 128
        || item.configIds.some((id, index) => !Number.isSafeInteger(id) || id <= 0 || id > 0xffff_ffff
          || index > 0 && id <= item.configIds[index - 1] || !configs.some(config => config.id === id))) throw new Error('invalid context Solar config dependencies');
      validateSolarDescriptor(item);
      keys(record(item.policy, 'Solar policy'), ['basis','when','clock','gapMs','recovery','fallback'], [], 'Solar policy');
      safeInteger(item.policy.gapMs, 'Solar gapMs', 1);
      validateClockPolicy(item.policy?.clock, { allowHold: true });
      validateSolarFallback(item.policy?.fallback, { allowFixed: true });
      if (item.policy?.basis !== 'pulse' || item.policy?.recovery !== 'baseline') throw new Error('unsupported context Solar policy');
      continue;
    }
    if (!['periodic','cron','daily','daily-slots','tide'].includes(item.kind)) throw new Error('unsupported context schedule kind');
    const range = item.policy?.basis?.kind === 'range';
    if (range) {
      if (![12, 13, 15, 16, 18].includes(bytecodeFormat) || item.timezone !== 'UTC' || item.day && bytecodeFormat !== 18 || item.selectedConfig
        || !['daily','daily-slots'].includes(item.kind)) throw new Error('executable Range requires GFB12 and immutable UTC Daily or DailySlots');
      const policy = record(item.policy, `schedule ${item.name}.policy`);
      keys(policy, ['basis','when','cancelWhen','clock','gapMs','recovery','fallback'], [], `schedule ${item.name}.policy`);
      keys(record(policy.basis, 'Range basis'), ['kind','durationMs'], [], 'Range basis');
      if (policy.clock !== 'trusted_only' || policy.recovery !== 'baseline' || policy.fallback !== 'skip') throw new Error('unsupported Range policy');
      safeInteger(policy.gapMs, 'Range gapMs', 1);
      safeInteger(policy.basis.durationMs, 'Range durationMs', 1, 86_400_000);
      const starts = item.kind === 'daily' ? [safeInteger(item.atMs, 'Range atMs', 0, 86_399_999)]
        : (Array.isArray(item.slots) ? item.slots.map(minute => safeInteger(minute, 'Range slot', 0, 1439) * 60_000) : []);
      if (!starts.length || starts.length > 96 || starts.some((start, index) => index > 0 && start <= starts[index - 1])
        || starts.some((start, index) => starts[(index + 1) % starts.length] + (index + 1 === starts.length ? 86_400_000 : 0) - start < policy.basis.durationMs)) {
        throw new Error('Range occurrences must not overlap');
      }
      if (item.day && (item.kind !== 'daily' || !['workday','offday'].includes(item.day.kind)
        || !calendars.some(calendar => calendar.name === item.day.calendar && calendar.type === 'WorkCalendar')
        || starts[0] + policy.basis.durationMs > 86_400_000)) throw new Error('work calendar Range must be typed and stay within one civil date');
    }
    if (!range && item.kind === 'daily') {
      if (!['workday','offday','holiday'].includes(item.day?.kind)) throw new Error('context Daily requires calendar day');
      const holiday = item.day.kind === 'holiday';
      if (holiday && ![HOLIDAY_FORMAT, SOLAR_CONTEXT_FORMAT, CALENDAR_EXECUTION_FORMAT].includes(manifest.format)) throw new Error('Holiday Daily requires its calendar profile');
      if (!calendars.some(calendar => calendar.name === item.day.calendar
        && calendar.type === (holiday ? 'HolidayCalendar' : 'WorkCalendar'))) throw new Error('unbound or wrong-type Daily calendar');
    }
    if (!range && item.kind === 'daily-slots' && !item.selectedConfig) throw new Error('context DailySlots requires TimeSlots config');
    if (item.kind === 'tide' && !providers.some(p => p.name === item.source && p.type === 'TidePredictions')) throw new Error('unbound Tide provider');
    if (!range) {
      validateClockPolicy(item.policy?.clock, { allowHold: [AVAILABILITY_FORMAT, HOLIDAY_FORMAT, SOLAR_CONTEXT_FORMAT].includes(manifest.format) && item.kind === 'tide' });
      if (item.policy?.fallback !== 'skip' || item.policy?.recovery !== 'baseline') throw new Error('unsupported context schedule fallback or recovery');
    }
  }
  for (const item of naturals) {
    safeInteger(item.site, 'natural site', 1, 0xffff_ffff);
    const expected = item.operation === 'tide_is' ? 'TidePredictions' : item.operation === 'moon_is' ? 'LunarEphemeris' : null;
    if (!expected || !providers.some(p => p.name === item.provider && p.type === expected)) throw new Error('natural provider mismatch');
    for (const role of ['ok','value','fault']) generated(item.projectionInputs[role], `${RESERVED}natural_${item.site}_${role}`, 'natural projection');
  }
  for (const item of calendarConditions) {
    safeInteger(item.site, 'calendar Result site', 1, 0xffff_ffff);
    if (item.timezone !== 'UTC' || !['workday','offday','holiday'].includes(item.classification)
      || !calendars.some(calendar => calendar.name === item.calendar && calendar.type === (item.classification === 'holiday' ? 'HolidayCalendar' : 'WorkCalendar'))
      || item.result?.value !== 'Bool' || item.result?.error !== 'CalendarFault') throw new Error('calendar Result definition mismatch');
    keys(record(item.projectionInputs, 'calendar Result projections'), ['ok','value','fault'], [], 'calendar Result projections');
    for (const role of ['ok','value','fault']) generated(item.projectionInputs[role], `${RESERVED}calendar_${item.site}_${role}`, 'calendar Result projection');
  }
  for (const item of configs) {
    name(item.name, 'config.name');
    validateCanonicalUnit(item, `config ${item.name}`);
    safeInteger(item.id, `config ${item.name}.id`, 1, 0xffff_ffff);
    if (item.type === 'Duration') typedValue(item.value, 'Duration', `config ${item.name}`);
    else if (item.type.startsWith('TimeSlots<')) {
      if (!Array.isArray(item.value) || item.value.length > item.capacity) throw new Error('invalid TimeSlots config');
    } else typedValue(item.value, item.type, `config ${item.name}`);
    if (item.settings) {
      if (item.type.startsWith('TimeSlots<')) {
        const settings = record(item.settings, `config ${item.name}.settings`);
        keys(settings, ['access'], ['label'], `config ${item.name}.settings`);
        if (!['operator','designer'].includes(settings.access)) throw new Error(`config ${item.name}.settings.access must be operator or designer`);
      } else item.settings = validateSettings(item, `config ${item.name}`, { stream: true });
    }
  }
  unique(configs.map(item => item.id), 'config id');
  unique([...inputs,...outputs,...schedules,...configs,...providers,...calendars,...timers,...sensors,...objectives,...adaptSettings].map(item => item.name), 'context name');
  unique([...schedules,...naturals,...calendarConditions].map(item => item.site), 'context site');
  for (const sensor of sensors) {
    name(sensor.name, 'sensor.name');
    if (sensor.type !== 'Temperature' || sensor.canonicalUnit !== 'K') throw new Error('context PID sensor must be canonical Temperature');
    for (const field of ['sampleMs','staleMs','recoverSamples','window']) if (sensor[field] !== null) safeInteger(sensor[field], `sensor ${sensor.name}.${field}`, 1);
    if (sensor.filter !== null) throw new Error('context PID sensor filtering is not supported');
    optionalFinite(sensor.validMin, `sensor ${sensor.name}.validMin`);
    optionalFinite(sensor.validMax, `sensor ${sensor.name}.validMax`);
    if (sensor.validMin !== null && sensor.validMax !== null && sensor.validMin > sensor.validMax) throw new Error('context PID sensor range is inverted');
    for (const [role,prefix] of [['valueInput','sensor_value'],['okInput','sensor_ok'],['faultInput','sensor_fault']])
      generated(sensor[role], `${RESERVED}${prefix}_${sensor.name}`, `sensor ${sensor.name}.${role}`);
  }
  if (objectives.length > 1) throw new Error('only one context PID objective is supported');
  for (const objective of objectives) {
    name(objective.name, 'objective.name');
    if (objective.binding !== 'native-temperature-percent-v1' || objective.executable !== false) throw new Error('unsupported context PID objective binding');
    const sensor = sensors.find(item => item.name === objective.measure);
    const target = configs.find(item => item.name === objective.target);
    if (!sensor || !target || target.type !== 'Temperature' || target.canonicalUnit !== 'K') throw new Error('context PID measure/target binding mismatch');
    if (!['°C','K'].includes(target.displayUnit)) throw new Error('context PID target display unit is required');
    const binding = record(objective.bindings, `objective ${objective.name}.bindings`);
    keys(binding, ['output','measure','measureOk','target','targetOk','safeMax'], [], `objective ${objective.name}.bindings`);
    if (binding.measure !== sensor.valueInput || binding.measureOk !== sensor.okInput
      || binding.target !== `${RESERVED}config_${target.id}_value` || binding.targetOk !== `${RESERVED}config_${target.id}_ok`)
      throw new Error('context PID protected Result binding mismatch');
    generated(binding.safeMax, `${RESERVED}objective_safe_max_${objective.name}`, 'context PID safeMax');
    if (!outputs.some(output => output.name === binding.output && output.type === 'Percent')) throw new Error('context PID output binding mismatch');
  }
  for (const adapt of adaptSettings) {
    name(adapt.name, 'adapt_setting.name');
    const target = configs.find(item => item.name === adapt.target);
    if (!target || adapt.runtime !== 'requires-host-settings-event-validation') throw new Error('invalid adaptation proposal descriptor');
    if (adapt.targetId !== undefined && adapt.targetId !== target.id || adapt.targetType !== undefined && adapt.targetType !== target.type)
      throw new Error('adaptation proposal target identity mismatch');
  }
  const normalized = freeze(copy({ ...manifest, inputs, outputs, schedules, configs, providers, calendars, timers,
    sensors, objectives, resources, adaptSettings, naturalConditions: naturals, ...(calendarConditions.length ? { calendarConditions } : {}), ...(accounting === null ? {} : { accounting }) }));
  return { manifest: normalized, inputNames: new Set(inputs.map(item => item.name)),
    sensorByName: new Map(sensors.map(item => [item.name,item])), scheduleNames: new Set(schedules.map(item => item.name)), signalNames: new Set() };
}

function validateManifest(input, { acceptSettings = false, bytecodeFormat = null, capabilities } = {}) {
  if (contextManifest(input)) return validateContextManifest(input, bytecodeFormat);
  const manifest = record(input, 'manifest');
  if ((Object.hasOwn(manifest, 'adaptPolicy') || Object.hasOwn(manifest, 'strategies')) && capabilities === undefined) {
    throw new Error('adapt strategy activation requires a capability-aware host; ControlRuntime cannot activate this manifest');
  }
  keys(manifest, ['format', 'name', 'inputs', 'outputs', 'sensors', 'schedules', 'timers', 'signals', 'configs', 'bytecodeSha256'], ['adaptPolicy', 'strategies', 'objectives', 'resources', 'sensorInstances'], 'manifest');
  if (manifest.format !== FORMAT && manifest.format !== INTEGER_FORMAT && !(manifest.format === SETTINGS_FORMAT && acceptSettings) && manifest.format !== SOLAR_FORMAT && manifest.format !== SCHEDULE_FORMAT && manifest.format !== SCHEDULE_SLOTS_FORMAT && manifest.format !== AVAILABILITY_FORMAT) throw new Error(`unsupported manifest format ${String(manifest.format)}`);
  const settingsManifest = manifest.format === SETTINGS_FORMAT || manifest.format === INTEGER_FORMAT || manifest.format === AVAILABILITY_FORMAT;
  const solarManifest = manifest.format === SOLAR_FORMAT || manifest.format === INTEGER_FORMAT || manifest.format === AVAILABILITY_FORMAT;
  name(manifest.name, 'manifest.name');
  if (typeof manifest.bytecodeSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.bytecodeSha256)) throw new Error('manifest.bytecodeSha256 must be a lowercase SHA-256 hex digest');

  const inputs = validateList(manifest.inputs, 'manifest.inputs', ['name', 'type'], ['canonicalUnit']);
  const outputs = validateList(manifest.outputs, 'manifest.outputs', ['name', 'type'], ['canonicalUnit']);
  const sensors = validateList(manifest.sensors, 'manifest.sensors', ['name', 'type', 'sampleMs', 'validMin', 'validMax', 'filter', 'window', 'staleMs', 'recoverSamples', 'valueInput', 'okInput', 'faultInput'], ['optional', 'alpha', 'canonicalUnit', 'samplePresentInput', 'sampleEpochInput', 'sampleIdInput', 'sampleTimestampInput']);
  const sensorInstances = validateList(manifest.sensorInstances ?? [], 'manifest.sensorInstances', ['name', 'type', 'sampleMs', 'validMin', 'validMax', 'filter', 'window', 'staleMs', 'recoverSamples', 'valueInput', 'okInput', 'faultInput', 'sourceSensor', 'instance', 'port'], ['optional', 'alpha', 'canonicalUnit', 'samplePresentInput', 'sampleEpochInput', 'sampleIdInput', 'sampleTimestampInput']);
  if (!Array.isArray(manifest.schedules) || manifest.schedules.length > MAX_LIST) throw new TypeError('manifest.schedules must be a bounded array');
  const schedules = manifest.schedules.map((schedule, index) => {
    const solar = (solarManifest || manifest.format === SCHEDULE_SLOTS_FORMAT) && schedule?.kind === 'solar';
    const daily = [SCHEDULE_FORMAT, SCHEDULE_SLOTS_FORMAT].includes(manifest.format) && schedule?.kind === 'daily';
    const dailySlots = manifest.format === SCHEDULE_SLOTS_FORMAT && schedule?.kind === 'daily-slots';
    const fields = solar ? ['kind', 'site', 'name', 'timezone', 'latitude', 'longitude', 'event', 'offsetMs', 'policy']
      : daily ? ['kind', 'atMs', 'site', 'name', 'timezone', 'dstMissing', 'dstRepeated', 'policy']
        : dailySlots ? ['kind', 'gridMs', 'slots', 'site', 'name', 'timezone', 'dstMissing', 'dstRepeated', 'policy']
          : ['name', 'timezone', 'slots', 'dueInput'];
    const optional = solar || daily || dailySlots ? [] : ['gridMs', 'selectedConfig', 'policy'];
    const item = record(schedule, `manifest.schedules[${index}]`);
    keys(item, fields, optional, `manifest.schedules[${index}]`);
    if (solar || daily || dailySlots) {
      if (solar) validateSolarDescriptor(item);
      else {
        name(item.name, `schedule ${item.name}.name`);
        if (typeof item.timezone !== 'string' || !item.timezone) throw new TypeError(`schedule ${item.name}.timezone must be nonempty text`);
        try { new Intl.DateTimeFormat('en-US', { timeZone: item.timezone }); }
        catch { throw new Error(`schedule ${item.name}.timezone must be a supported IANA timezone`); }
        if (daily) safeInteger(item.atMs, `schedule ${item.name}.atMs`, 0, 86_399_999);
        else {
          if (item.gridMs !== 900_000) throw new Error(`schedule ${item.name}.gridMs is unsupported`);
          if (!Array.isArray(item.slots) || !item.slots.length || item.slots.length > MAX_SCHEDULE_SLOTS) throw new Error(`schedule ${item.name}.slots is invalid`);
          for (let index = 0; index < item.slots.length; index += 1) {
            safeInteger(item.slots[index], `schedule ${item.name}.slots[${index}]`, 0, 1439);
            if (item.slots[index] % 15 || index > 0 && item.slots[index - 1] >= item.slots[index]) throw new Error(`schedule ${item.name}.slots is invalid`);
          }
        }
        if (!['skip', 'next_valid'].includes(item.dstMissing)) throw new Error(`schedule ${item.name}.dstMissing is unsupported`);
        if (!['first', 'second', 'both', 'skip'].includes(item.dstRepeated)) throw new Error(`schedule ${item.name}.dstRepeated is unsupported`);
      }
      safeInteger(item.site, `schedule ${item.name}.site`, 1, 0xffff_ffff);
      const policy = record(item.policy, `schedule ${item.name}.policy`);
      keys(policy, ['basis', 'when', 'clock', 'gapMs', 'recovery', 'fallback'], [], `schedule ${item.name}.policy`);
      validateClockPolicy(policy.clock, { allowHold: solar && manifest.format === AVAILABILITY_FORMAT });
      validateSolarFallback(policy.fallback, { allowFixed: solar && manifest.format === AVAILABILITY_FORMAT });
      if (policy.basis !== 'pulse' || policy.recovery !== 'baseline') throw new Error(`schedule ${item.name} has unsupported pulse policy`);
      if (typeof policy.when !== 'string' && !Array.isArray(policy.when)) throw new TypeError(`schedule ${item.name}.policy.when must be a compiled expression`);
      safeInteger(policy.gapMs, `schedule ${item.name}.policy.gapMs`, 1);
    }
    return copy(item);
  });
  if (manifest.format === SOLAR_FORMAT && !schedules.some(item => item.kind === 'solar')) throw new Error('v3 manifest requires a Solar schedule');
  if (manifest.format === AVAILABILITY_FORMAT && (bytecodeFormat !== 13 || !schedules.length || schedules.some(item => item.kind !== 'solar'))) throw new Error('v12 Solar manifest requires GFB13 Solar schedules');
  if (schedules.some(item => item.kind === 'solar') && !(manifest.format === AVAILABILITY_FORMAT ? bytecodeFormat === 13 : [5, 9].includes(bytecodeFormat))) throw new Error('Solar manifest requires matching GFB format');
  if (manifest.format === SCHEDULE_FORMAT && (bytecodeFormat !== 8 || !schedules.length || schedules.some(item => item.kind !== 'daily'))) throw new Error('v7 manifest requires GFB format 8 Daily schedules');
  if (manifest.format === SCHEDULE_SLOTS_FORMAT && (bytecodeFormat !== 9 || !schedules.length || schedules.some(item => item.kind !== 'daily-slots'))) throw new Error('v8 manifest requires GFB format 9 DailySlots schedules');
  if (!Array.isArray(manifest.timers) || manifest.timers.length > MAX_LIST) throw new TypeError('manifest.timers must be a bounded array');
  const timers = manifest.timers.map((timer, index) => {
    const item = record(timer, `manifest.timers[${index}]`);
    const continuous = Object.hasOwn(item, 'mode');
    keys(item, continuous ? ['name', 'mode', 'clockInput'] : ['name', 'state', 'clockInput'], [], `manifest.timers[${index}]`);
    if (continuous && item.mode !== 'continuous-true') throw new Error(`timer ${String(item.name)} has unsupported mode ${String(item.mode)}`);
    return copy(item);
  });
  if (!Array.isArray(manifest.signals) || manifest.signals.length > MAX_LIST) throw new TypeError('manifest.signals must be a bounded array');
  const signals = manifest.signals.map((signal, index) => {
    const item = record(signal, `manifest.signals[${index}]`);
    if (item.kind === 'debounce') keys(item,
      ['kind', 'name', 'payloadType', 'errorType', 'sourceMode', 'stableForMs', 'initial', 'clockInput', 'sources', 'states'],
      ['members'], `manifest.signals[${index}]`);
    else if (item.kind === 'hold-last') keys(item,
      ['kind', 'name', 'payloadType', 'errorType', 'quality', 'sourceMode', 'forAtMostMs', 'clockInput', 'sources', 'states'],
      ['members'], `manifest.signals[${index}]`);
    else if (item.kind === 'window') keys(item,
      ['kind', 'name', 'site', 'slot', 'operation', 'payloadType', 'errorType', 'quality', 'overMs', 'maxAgeMs', 'clockInput', 'timeEpochInput', 'sources'],
      ['upstreamWindows'], `manifest.signals[${index}]`);
    else if (item.kind === 'true-for') keys(item,
      ['kind', 'name', 'site', 'slot', 'payloadType', 'errorType', 'quality', 'durationMs', 'clockInput', 'timeEpochInput', 'sources', 'intervalInputs'],
      [], `manifest.signals[${index}]`);
    else if (isAfterEvent(item)) keys(item,
      ['kind', 'name', 'site', 'payloadType', 'errorType', 'quality', 'windowMs', 'event', 'predicate', 'projections', 'projectionInputs'],
      [], `manifest.signals[${index}]`);
    else keys(item, ['name', 'sensor', 'onBelow', 'offAbove', 'initial', 'valueInput', 'okInput', 'faultInput'], [], `manifest.signals[${index}]`);
    return copy(item);
  });
  const configs = validateList(manifest.configs, 'manifest.configs', ['name', 'type', 'value'], settingsManifest ? ['settings', 'initialOffset', 'initialEndOffset', 'canonicalUnit', 'displayUnit'] : ['canonicalUnit']);
  const resources = manifest.resources === undefined ? [] : validateList(manifest.resources, 'manifest.resources', ['name', 'type'], []);

  for (const item of inputs) { name(item.name, 'input.name'); type(item.type, `input ${item.name}.type`); validateCanonicalUnit(item, `input ${item.name}`); }
  for (const item of outputs) { portName(item.name, 'output.name'); type(item.type, `output ${item.name}.type`); validateCanonicalUnit(item, `output ${item.name}`); }
  const windows = signals.filter(item => item.kind === 'window');
  if (manifest.format === INTEGER_FORMAT && ![2, 3, 4, 5, 6].includes(bytecodeFormat)) throw new Error('v4 manifest requires GFB format 2, 3, 4, 5 or 6');
  if (bytecodeFormat === 4 && (manifest.format !== INTEGER_FORMAT || !windows.length)) throw new Error('GFB format 4 requires a v4 window manifest');
  if (bytecodeFormat === 6 && (manifest.format !== INTEGER_FORMAT || !signals.some(item => item.kind === 'true-for'))) throw new Error('GFB format 6 requires a v4 true_for manifest');
  if (windows.length && bytecodeFormat !== 4) throw new Error('window manifest requires GFB format 4');
  unique(inputs.map(item => item.name), 'input');
  unique(outputs.map(item => item.name), 'output');
  unique([...inputs, ...outputs].map(item => item.name), 'port');
  const declarationNames = [...inputs, ...outputs, ...configs, ...sensors, ...schedules, ...timers, ...signals].map(item => item.name);
  if (declarationNames.length > MAX_NAMES) throw new RangeError(`manifest names exceed ${MAX_NAMES}`);
  unique(declarationNames, 'declaration');
  const generatedTotal = sensors.reduce((count, item) => count + 3 + (item.samplePresentInput === undefined ? 0 : 4), 0)
    + signals.reduce((count, item) => count + (isVmSignal(item) ? 0
      : isAfterEvent(item) ? item.projections.length * 3 : 3), 0)
    + schedules.filter(item => item.kind !== 'solar').length + timers.length * 2 + (timers.length > 0 || signals.some(isVmSignal) ? 1 : 0) + (windows.length ? 1 : 0);
  if (generatedTotal > MAX_NAMES) throw new RangeError(`generated manifest names exceed ${MAX_NAMES}`);
  const inputNames = new Set(inputs.map(item => item.name));

  for (const item of configs) {
    name(item.name, 'config.name');
    type(item.type, `config ${item.name}.type`);
    validateCanonicalUnit(item, `config ${item.name}`);
    typedValue(item.value, item.type, `config ${item.name}.value`);
    const hasSettings = Object.prototype.hasOwnProperty.call(item, 'settings');
    const hasOffsets = Object.prototype.hasOwnProperty.call(item, 'initialOffset') || Object.prototype.hasOwnProperty.call(item, 'initialEndOffset');
    if (!settingsManifest && (hasSettings || hasOffsets)) throw new Error(`v1 config ${item.name} cannot contain operating settings metadata`);
    if (settingsManifest && hasOffsets && !hasSettings) throw new Error(`v2 config ${item.name} literal offsets require settings`);
    if (settingsManifest && hasSettings) {
      if (item.type === 'Temperature' && item.displayUnit !== '°C' && item.displayUnit !== 'K') throw new Error(`config ${item.name}.displayUnit must be explicitly °C or K`);
      if (item.type !== 'Temperature' && Object.hasOwn(item, 'displayUnit')) throw new Error(`config ${item.name}.displayUnit is forbidden for ${item.type}`);
      item.settings = validateSettings(item, `config ${item.name}`);
    }
  }
  unique(configs.map(item => item.name), 'config');
  for (const item of resources) {
    name(item.name, 'resource.name');
    if (item.type !== 'ContinuousActuator') throw new Error(`resource ${item.name} has unsupported type ${String(item.type)}`);
  }
  unique(resources.map(item => item.name), 'resource');

  const sensorByName = new Map();
  for (const item of [...sensors, ...sensorInstances]) {
    name(item.name, 'sensor.name');
    type(item.type, `sensor ${item.name}.type`);
    validateCanonicalUnit(item, `sensor ${item.name}`);
    if (!SENSOR_TYPES.has(item.type)) throw new Error(`sensor ${item.name} has unsupported type ${item.type}`);
    if (item.sampleMs !== null) safeInteger(item.sampleMs, `sensor ${item.name}.sampleMs`, 1);
    if (item.staleMs !== null) safeInteger(item.staleMs, `sensor ${item.name}.staleMs`, 1);
    if (item.recoverSamples !== null) safeInteger(item.recoverSamples, `sensor ${item.name}.recoverSamples`, 1, MAX_WINDOW);
    if (item.filter !== null && !['median', 'moving_average', 'ema'].includes(item.filter)) throw new Error(`sensor ${item.name} uses unsupported filter ${String(item.filter)}`);
    const hasAlpha = Object.hasOwn(item, 'alpha');
    if (item.window !== null) {
      safeInteger(item.window, `sensor ${item.name}.window`, 1, MAX_WINDOW);
      if (item.filter === 'median' && item.window % 2 === 0) throw new Error(`sensor ${item.name}.window must be odd for median`);
    }
    if (item.filter === null && item.window !== null) throw new Error(`sensor ${item.name}.window requires a filter`);
    if (item.filter !== null && item.window === null) throw new Error(`sensor ${item.name}.filter requires a window`);
    if (item.filter === 'ema') {
      if (!['Number', 'Percent'].includes(item.type) && !isQuantityType(item.type)) throw new Error(`sensor ${item.name} ema requires a numeric payload`);
      if (item.window !== 1) throw new Error(`sensor ${item.name} ema window must be 1`);
      if (!hasAlpha) throw new Error(`sensor ${item.name} ema alpha is required`);
      finite(item.alpha, `sensor ${item.name}.alpha`);
      if (!(item.alpha > 0 && item.alpha <= 1)) throw new RangeError(`sensor ${item.name}.alpha must be in (0, 1]`);
    } else if (hasAlpha) throw new Error(`sensor ${item.name} alpha is only valid for ema`);
    optionalFinite(item.validMin, `sensor ${item.name}.validMin`);
    optionalFinite(item.validMax, `sensor ${item.name}.validMax`);
    if ((item.validMin === null) !== (item.validMax === null)) throw new Error(`sensor ${item.name} valid range requires both bounds`);
    if (item.validMin !== null && item.validMin > item.validMax) throw new Error(`sensor ${item.name} valid range is inverted`);
    if (item.type === 'Percent') {
      for (const bound of ['validMin', 'validMax']) if (item[bound] !== null && (item[bound] < 0 || item[bound] > 100)) throw new RangeError(`sensor ${item.name}.${bound} must be in [0, 100]`);
    }
    if (item.type === 'RelativeHumidity') {
      for (const bound of ['validMin', 'validMax']) if (item[bound] !== null && (item[bound] < 0 || item[bound] > 1)) throw new RangeError(`sensor ${item.name}.${bound} must be in [0, 1]`);
    }
    name(item.valueInput, `sensor ${item.name}.valueInput`, true);
    name(item.okInput, `sensor ${item.name}.okInput`, true);
    name(item.faultInput, `sensor ${item.name}.faultInput`, true);
    generated(item.valueInput, `${RESERVED}sensor_value_${item.name}`, `sensor ${item.name}.valueInput`);
    generated(item.okInput, `${RESERVED}sensor_ok_${item.name}`, `sensor ${item.name}.okInput`);
    generated(item.faultInput, `${RESERVED}sensor_fault_${item.name}`, `sensor ${item.name}.faultInput`);
    const sampleFields = ['samplePresentInput', 'sampleEpochInput', 'sampleIdInput', 'sampleTimestampInput'];
    const sampleCount = sampleFields.filter(field => item[field] !== undefined).length;
    if (sampleCount !== 0 && sampleCount !== sampleFields.length) throw new Error(`sensor ${item.name} sample metadata inputs must be provided together`);
    if (sampleCount) {
      const expected = {
        samplePresentInput: `${RESERVED}sensor_sample_present_${item.name}`,
        sampleEpochInput: `${RESERVED}sensor_sample_epoch_${item.name}`,
        sampleIdInput: `${RESERVED}sensor_sample_id_${item.name}`,
        sampleTimestampInput: `${RESERVED}sensor_sample_timestamp_${item.name}`,
      };
      for (const field of sampleFields) { name(item[field], `sensor ${item.name}.${field}`, true); generated(item[field], expected[field], `sensor ${item.name}.${field}`); }
    }
    if (item.optional !== undefined && typeof item.optional !== 'boolean') throw new TypeError(`sensor ${item.name}.optional must be boolean`);
    if (!sensorInstances.includes(item)) sensorByName.set(item.name, item);
  }
  unique([...sensors, ...sensorInstances].map(item => item.name), 'sensor');
  if (new Set(sensorByName.keys()).size !== sensors.length) throw new Error('duplicate sensor name');
  for (const item of sensorInstances) {
    name(item.sourceSensor, 'sensor sourceSensor'); name(item.port, 'sensor port');
    if (typeof item.instance !== 'string' || !/^[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*$/.test(item.instance)) throw new Error('invalid sensor instance');
    const source = sensorByName.get(item.sourceSensor);
    if (!source || source.type !== item.type || source.sampleMs !== item.sampleMs || !!source.optional !== !!item.optional) throw new Error(`sensor instance ${item.name} source contract mismatch`);
    const expected = `instance_${item.instance.split('.').map(part => `${part.length}_${part}`).join('_')}_${item.port}`;
    if (item.name !== expected) throw new Error('sensor instance name mismatch');
  }

  const objectives = manifest.objectives === undefined ? [] : validateList(manifest.objectives, 'manifest.objectives',
    ['name', 'measure', 'target', 'manipulate', 'output', 'controller', 'binding', 'executable', 'bindings'], []);
  if (objectives.length > 1) throw new Error('only one native objective is supported');
  for (const objective of objectives) {
    name(objective.name, 'objective.name');
    if (objective.binding !== 'native-temperature-percent-v1') throw new Error(`objective ${objective.name} has unsupported binding`);
    if (bytecodeFormat !== 7) throw new Error(`objective ${objective.name} requires verified GFB7 bytecode`);
    const sensor = sensorByName.get(objective.measure);
    if (!sensor || sensor.type !== 'Temperature' || sensor.canonicalUnit !== 'K') throw new Error(`objective ${objective.name} requires a canonical Temperature measure`);
    const config = configs.find(item => item.name === objective.target);
    if (!config || config.type !== 'Temperature' || config.canonicalUnit !== 'K') throw new Error(`objective ${objective.name} requires a canonical Temperature target`);
    if (!['°C', 'K'].includes(config.displayUnit)) throw new Error(`objective ${objective.name} target displayUnit must be °C or K`);
    const output = outputs.find(item => item.name === objective.bindings?.output);
    if (!output || output.type !== 'Percent') throw new Error(`objective ${objective.name} requires a Percent output binding`);
    keys(record(objective.bindings, `objective ${objective.name}.bindings`), ['output', 'measure', 'measureOk', 'target', 'safeMax'], [], `objective ${objective.name}.bindings`);
    if (objective.bindings.measure !== sensor.valueInput || objective.bindings.measureOk !== sensor.okInput) throw new Error(`objective ${objective.name} measure binding mismatch`);
    generated(objective.bindings.target, `${RESERVED}objective_target_${objective.name}`, `objective ${objective.name}.target binding`);
    generated(objective.bindings.safeMax, `${RESERVED}objective_safe_max_${objective.name}`, `objective ${objective.name}.safeMax binding`);
    keys(record(objective.output, `objective ${objective.name}.output`), ['min', 'max'], [], `objective ${objective.name}.output`);
    finite(objective.output.min, `objective ${objective.name}.output.min`); finite(objective.output.max, `objective ${objective.name}.output.max`);
    if (objective.output.min !== 0 || objective.output.max < 0 || objective.output.max > 100) throw new Error(`objective ${objective.name} has invalid Percent range`);
  }

  const scheduleNames = new Set();
  for (const item of schedules) {
    name(item.name, 'schedule.name');
    string(item.timezone, `schedule ${item.name}.timezone`);
    try { new Intl.DateTimeFormat('en-US', { timeZone: item.timezone }).format(0); }
    catch { throw new Error(`schedule ${item.name}.timezone is not an Intl timezone`); }
    if (!['solar', 'daily', 'daily-slots'].includes(item.kind)) {
      if (!Array.isArray(item.slots) || item.slots.length > MAX_SCHEDULE_SLOTS) throw new RangeError(`schedule ${item.name}.slots must contain at most ${MAX_SCHEDULE_SLOTS} slots`);
      for (const slot of item.slots) { safeInteger(slot, `schedule ${item.name}.slot`, 0, 1439); if (slot % 15 !== 0) throw new Error(`schedule ${item.name}.slot must be a 15-minute boundary`); }
      unique(item.slots, `schedule ${item.name}.slot`);
    }
    if (!['solar', 'daily', 'daily-slots'].includes(item.kind)) {
      name(item.dueInput, `schedule ${item.name}.dueInput`, true);
      generated(item.dueInput, `${RESERVED}schedule_due_${item.name}`, `schedule ${item.name}.dueInput`);
    }
    scheduleNames.add(item.name);
  }
  unique(schedules.map(item => item.name), 'schedule');

  for (const item of timers) {
    name(item.name, 'timer.name');
    if (item.mode === undefined) name(item.state, `timer ${item.name}.state`, true);
    if (item.clockInput !== `${RESERVED}now_ms`) throw new Error(`timer ${item.name}.clockInput must be ${RESERVED}now_ms`);
  }
  unique(timers.map(item => item.name), 'timer');

  const signalNames = new Set();
  const windowSites = new Set();
  const windowRoots = new Map();
  let windowSlot = 0;
  const trueForSites = new Set();
  let trueForSlot = 0;
  for (const item of signals) {
    name(item.name, 'signal.name');
    if (item.kind === 'window') {
      safeInteger(item.site, `signal ${item.name}.site`, 1, 0xffff_ffff);
      if (windowSites.has(item.site)) throw new Error('duplicate window site');
      windowSites.add(item.site);
      if (item.slot !== windowSlot++) throw new Error(`signal ${item.name}.slot must follow window declaration order`);
      if (!['average', 'min', 'max', 'rate'].includes(item.operation)) throw new Error(`signal ${item.name}.operation is unsupported`);
      const ratePayload = /^Rate<([A-Za-z]+)>$/.exec(item.payloadType);
      const numericPayload = ['Number', 'Percent', ...QUANTITY_TYPES].includes(item.payloadType);
      if (item.operation === 'rate' ? !ratePayload || !RATE_TYPES.has(ratePayload[1])
        : !numericPayload && !(item.payloadType === 'Int' && ['min', 'max'].includes(item.operation))) {
        throw new Error(`signal ${item.name}.payloadType is unsupported for ${item.operation}`);
      }
      if (item.errorType !== 'SensorFault' || item.quality !== 'measured') throw new Error(`signal ${item.name} window requires measured SensorFault evidence`);
      safeInteger(item.overMs, `signal ${item.name}.overMs`, 1);
      safeInteger(item.maxAgeMs, `signal ${item.name}.maxAgeMs`, 1);
      if (item.clockInput !== `${RESERVED}now_ms` || item.timeEpochInput !== `${RESERVED}time_epoch`) throw new Error(`signal ${item.name} has invalid window clock bindings`);
      if (!Array.isArray(item.sources) || !item.sources.length || item.sources.length > MAX_LIST) throw new Error(`signal ${item.name}.sources must be a bounded non-empty array`);
      let priorTag = 0;
      for (const source of item.sources) {
        keys(record(source, `signal ${item.name}.source`), ['name', 'tag'], [], `signal ${item.name}.source`);
        safeInteger(source.tag, `signal ${item.name}.source.tag`, 1, 0xffff_ffff);
        if (source.tag <= priorTag) throw new Error(`signal ${item.name}.sources must be sorted by unique tag`);
        priorTag = source.tag;
        const sensor = sensorByName.get(source.name);
        if (!sensor || sensor.samplePresentInput === undefined) throw new Error(`signal ${item.name} references unknown or unbound sample source ${String(source.name)}`);
        if (windowRoots.has(source.tag) && windowRoots.get(source.tag) !== source.name) throw new Error('window source tag has inconsistent binding');
        windowRoots.set(source.tag, source.name);
      }
      unique(item.sources.map(source => source.name), `signal ${item.name} sample source`);
      if (Object.hasOwn(item, 'upstreamWindows')) {
        if (!Array.isArray(item.upstreamWindows) || !item.upstreamWindows.length || item.upstreamWindows.length > item.slot) {
          throw new Error(`signal ${item.name}.upstreamWindows must be a non-empty prior-window list`);
        }
        let priorSlot = -1;
        for (const dependency of item.upstreamWindows) {
          keys(record(dependency, 'window evidence dependency'), ['name', 'site', 'slot'], [], 'window evidence dependency');
          const upstream = windows[dependency.slot];
          if (!Number.isInteger(dependency.slot) || dependency.slot <= priorSlot || dependency.slot >= item.slot
              || !upstream || upstream.name !== dependency.name || upstream.site !== dependency.site
              || upstream.sources.some(root => !item.sources.some(source => source.name === root.name && source.tag === root.tag))) {
            throw new Error(`signal ${item.name} has invalid window evidence dependency`);
          }
          priorSlot = dependency.slot;
        }
      }
      signalNames.add(item.name);
      continue;
    }
    if (item.kind === 'true-for') {
      keys(item, ['kind', 'name', 'site', 'slot', 'payloadType', 'errorType', 'quality', 'durationMs', 'clockInput', 'timeEpochInput', 'sources', 'intervalInputs'], [], `manifest.signals[${item.name}]`);
      safeInteger(item.site, `signal ${item.name}.site`, 1, 0xffff_ffff);
      if (trueForSites.has(item.site)) throw new Error('duplicate true_for site');
      trueForSites.add(item.site);
      if (item.slot !== trueForSlot++) throw new Error(`signal ${item.name}.slot must follow true_for declaration order`);
      if (item.payloadType !== 'Bool' || item.errorType !== 'SensorFault' || item.quality !== 'measured') {
        throw new Error(`signal ${item.name} true_for requires Bool measured SensorFault evidence`);
      }
      safeInteger(item.durationMs, `signal ${item.name}.durationMs`, 1);
      if (item.clockInput !== `${RESERVED}now_ms` || item.timeEpochInput !== `${RESERVED}time_epoch`) {
        throw new Error(`signal ${item.name} has invalid true_for clock bindings`);
      }
      if (!Array.isArray(item.sources) || item.sources.length !== 1) throw new Error(`signal ${item.name}.sources must contain exactly one source`);
      const source = record(item.sources[0], `signal ${item.name}.sources[0]`);
      keys(source, ['name', 'tag'], [], `signal ${item.name}.sources[0]`);
      const sensor = sensorByName.get(source.name);
      if (!sensor || sensor.type !== 'Bool') throw new Error(`signal ${item.name} references an unknown Bool sensor`);
      safeInteger(source.tag, `signal ${item.name}.sources[0].tag`, 1, 0xffff_ffff);
      if (!item.intervalInputs || typeof item.intervalInputs !== 'object' || Array.isArray(item.intervalInputs)) {
        throw new TypeError(`signal ${item.name}.intervalInputs must be an object`);
      }
      keys(item.intervalInputs, INTERVAL_FIELDS, [], `signal ${item.name}.intervalInputs`);
      for (const field of INTERVAL_FIELDS) {
        const input = item.intervalInputs[field];
        name(input, `signal ${item.name}.intervalInputs.${field}`, true);
        generated(input, `${RESERVED}interval_${field}_${source.name}`, `signal ${item.name}.intervalInputs.${field}`);
      }
      signalNames.add(item.name);
      continue;
    }
    if (isAfterEvent(item)) {
      safeInteger(item.site, `signal ${item.name}.site`, 1, 0xffff_ffff);
      if (item.payloadType !== 'Bool' || item.errorType !== 'SensorFault' || item.quality !== 'measured') {
        throw new Error(`signal ${item.name} after_event requires Bool measured SensorFault evidence`);
      }
      safeInteger(item.windowMs, `signal ${item.name}.windowMs`, 1);
      for (const [role, source] of [['event', item.event], ['predicate', item.predicate]]) {
        keys(record(source, `signal ${item.name}.${role}`), ['name', 'tag'], [], `signal ${item.name}.${role}`);
        name(source.name, `signal ${item.name}.${role}.name`);
        safeInteger(source.tag, `signal ${item.name}.${role}.tag`, 1, 0xffff_ffff);
      }
      const predicate = sensorByName.get(item.predicate.name);
      if (!predicate || predicate.type !== 'Bool') throw new Error(`signal ${item.name} predicate must bind a Bool sensor`);
      if (!Array.isArray(item.projections) || !item.projections.length || item.projections.length > 2) {
        throw new Error(`signal ${item.name}.projections must be a non-empty bounded array`);
      }
      unique(item.projections, `signal ${item.name} projection`);
      keys(record(item.projectionInputs, `signal ${item.name}.projectionInputs`), item.projections, [], `signal ${item.name}.projectionInputs`);
      for (const mode of item.projections) {
        if (!['any', 'all'].includes(mode)) throw new Error(`signal ${item.name} has unsupported projection ${mode}`);
        const inputs = record(item.projectionInputs[mode], `signal ${item.name}.projectionInputs.${mode}`);
        keys(inputs, ['value', 'ok', 'fault'], [], `signal ${item.name}.projectionInputs.${mode}`);
        for (const role of ['value', 'ok', 'fault']) {
          name(inputs[role], `signal ${item.name}.projectionInputs.${mode}.${role}`, true);
          generated(inputs[role], `${RESERVED}after_event_${mode}_${role}_${item.name}`,
            `signal ${item.name}.projectionInputs.${mode}.${role}`);
        }
      }
      signalNames.add(item.name);
      continue;
    }
    if (isVmSignal(item)) {
      const hold = item.kind === 'hold-last';
      const prefix = hold ? 'hold_last' : 'debounce';
      if (hold && TYPES.has(item.payloadType)) {
        if (item.members !== undefined) throw new Error(`signal ${item.name}.members is forbidden for scalar hold_last`);
      } else if (item.payloadType === 'Bool') {
        if (item.members !== undefined) throw new Error(`signal ${item.name}.members is forbidden for Bool debounce`);
        if (typeof item.initial !== 'boolean') throw new TypeError(`signal ${item.name}.initial must be boolean`);
      } else {
        name(item.payloadType, `signal ${item.name}.payloadType`);
        if (!Array.isArray(item.members) || item.members.length < 1 || item.members.length > MAX_LIST) throw new Error(`signal ${item.name}.members must be a bounded non-empty array`);
        for (const member of item.members) name(member, `signal ${item.name}.member`);
        unique(item.members, `signal ${item.name}.member`);
        if (!hold) safeInteger(item.initial, `signal ${item.name}.initial`, 0, item.members.length - 1);
      }
      if (hold && (item.errorType !== 'SensorFault' || item.quality !== 'measured' || item.sourceMode !== 'sample')) throw new Error(`signal ${item.name} hold_last requires measured SensorFault sample evidence`);
      if (item.errorType !== null && !['SensorFault', 'ClockFault', 'CalendarFault', 'TemporalContextFault'].includes(item.errorType)) throw new Error(`signal ${item.name}.errorType is unsupported`);
      if (!['scan', 'sample'].includes(item.sourceMode)) throw new Error(`signal ${item.name}.sourceMode is unsupported`);
      safeInteger(hold ? item.forAtMostMs : item.stableForMs, `signal ${item.name}.${hold ? 'forAtMostMs' : 'stableForMs'}`, 1);
      if (item.clockInput !== `${RESERVED}now_ms`) throw new Error(`signal ${item.name}.clockInput must be ${RESERVED}now_ms`);
      if (!Array.isArray(item.sources) || item.sources.length > MAX_LIST) throw new Error(`signal ${item.name}.sources must be a bounded array`);
      let priorTag = 0;
      for (const [index, source] of item.sources.entries()) {
        keys(record(source, `signal ${item.name}.sources[${index}]`), ['name', 'tag', 'states'], [], `signal ${item.name}.sources[${index}]`);
        const sensor = sensorByName.get(source.name); if (!sensor) throw new Error(`signal ${item.name} references unknown sample source ${String(source.name)}`);
        safeInteger(source.tag, `signal ${item.name}.sources[${index}].tag`, 1, 0xffff_ffff);
        if (source.tag <= priorTag) throw new Error(`signal ${item.name}.sources must be sorted by unique tag`);
        priorTag = source.tag;
        if (sensor.samplePresentInput === undefined) throw new Error(`signal ${item.name} sample source ${source.name} lacks metadata inputs`);
        keys(record(source.states, `signal ${item.name}.sources[${index}].states`), ['lastEpoch', 'lastId'], [], `signal ${item.name}.sources[${index}].states`);
        for (const [role, sourceRole] of [['lastEpoch', 'source_epoch'], ['lastId', 'source_id']]) {
          name(source.states[role], `signal ${item.name}.sources[${index}].states.${role}`, true);
          generated(source.states[role], `${RESERVED}${prefix}_${sourceRole}_${item.name}_${source.tag}`, `signal ${item.name}.sources[${index}].states.${role}`);
        }
      }
      unique(item.sources.map(source => source.name), `signal ${item.name} sample source`);
      if ((item.sourceMode === 'sample') !== (item.sources.length > 0)) throw new Error(`signal ${item.name}.sourceMode does not match sources`);
      const stateFields = hold ? HOLD_STATE_ROLES : ['stable', 'candidate', 'candidateActive', 'candidateSince', 'lastSourceTag'];
      keys(record(item.states, `signal ${item.name}.states`), stateFields, [], `signal ${item.name}.states`);
      for (const role of stateFields) {
        name(item.states[role], `signal ${item.name}.states.${role}`, true);
        const snake = role.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        generated(item.states[role], `${RESERVED}${prefix}_${snake}_${item.name}`, `signal ${item.name}.states.${role}`);
      }
      signalNames.add(item.name);
      continue;
    }
    const sensor = sensorByName.get(item.sensor);
    if (!sensor) throw new Error(`signal ${item.name} references unknown sensor ${String(item.sensor)}`);
    if (sensor.type === 'Bool') throw new Error(`signal ${item.name} requires a numeric sensor`);
    finite(item.onBelow, `signal ${item.name}.onBelow`); finite(item.offAbove, `signal ${item.name}.offAbove`);
    if (item.onBelow >= item.offAbove) throw new Error(`signal ${item.name} hysteresis bounds are inverted`);
    if (sensor.type === 'Percent' && (item.onBelow < 0 || item.onBelow > 100 || item.offAbove < 0 || item.offAbove > 100)) throw new RangeError(`signal ${item.name} thresholds must be in [0, 100]`);
    if (sensor.type === 'RelativeHumidity' && (item.onBelow < 0 || item.onBelow > 1 || item.offAbove < 0 || item.offAbove > 1)) throw new RangeError(`signal ${item.name} thresholds must be in [0, 1]`);
    if (typeof item.initial !== 'boolean') throw new TypeError(`signal ${item.name}.initial must be boolean`);
    name(item.valueInput, `signal ${item.name}.valueInput`, true); name(item.okInput, `signal ${item.name}.okInput`, true); name(item.faultInput, `signal ${item.name}.faultInput`, true);
    generated(item.valueInput, `${RESERVED}signal_value_${item.name}`, `signal ${item.name}.valueInput`);
    generated(item.okInput, `${RESERVED}signal_ok_${item.name}`, `signal ${item.name}.okInput`);
    generated(item.faultInput, `${RESERVED}signal_fault_${item.name}`, `signal ${item.name}.faultInput`);
    signalNames.add(item.name);
  }
  unique(signals.map(item => item.name), 'signal');
  unique([...windowRoots.values()], 'window root');

  unique([
    ...sensors.flatMap(item => [item.valueInput, item.okInput, item.faultInput]),
    ...sensors.flatMap(item => [item.samplePresentInput, item.sampleEpochInput, item.sampleIdInput, item.sampleTimestampInput].filter(Boolean)),
    ...signals.flatMap(item => item.kind === 'true-for' || isVmSignal(item) || isAfterEvent(item) ? [] : [item.valueInput, item.okInput, item.faultInput]),
    ...signals.flatMap(item => item.kind === 'true-for' ? INTERVAL_FIELDS.map(field => item.intervalInputs[field]) : []),
    ...signals.flatMap(item => isAfterEvent(item)
      ? Object.values(item.projectionInputs).flatMap(inputs => [inputs.value, inputs.ok, inputs.fault]) : []),
    ...schedules.map(item => item.dueInput).filter(Boolean),
    ...new Set([...timers.flatMap(item => [item.clockInput, item.state].filter(Boolean)), ...windows.flatMap(item => [item.clockInput, item.timeEpochInput])]),
  ], 'generated input');

  for (const item of inputs) if (item.name.startsWith(RESERVED)) throw new Error(`input ${item.name} uses reserved prefix`);
  for (const item of outputs) if (item.name.startsWith(RESERVED)) throw new Error(`output ${item.name} uses reserved prefix`);
  const publicManifest = freeze({ ...copy(manifest), inputs, outputs, sensors, schedules, timers, signals, configs,
    ...(manifest.sensorInstances === undefined ? {} : { sensorInstances }),
    ...(manifest.resources === undefined ? {} : { resources }), ...(manifest.objectives === undefined ? {} : { objectives }) });
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
    filter: item.filter ?? 'median', window: item.window ?? 1,
    ...(item.filter === 'ema' ? { alpha: item.alpha } : {}),
    validMin: item.validMin ?? defaults.min, validMax: item.validMax ?? defaults.max,
    staleMs: item.staleMs ?? 3000, recoverSamples: item.recoverSamples ?? 1,
  };
}

function hostReading(raw, sensorType) {
  return { ok: raw.ok, value: raw.ok ? (sensorType === 'Bool' ? Boolean(raw.value) : raw.value) : (sensorType === 'Bool' ? false : 0), quality: raw.quality };
}

function sensorFaultCode(reading) {
  if (reading.ok) return 0;
  const code = SENSOR_FAULT_CODE[reading.quality];
  if (code === undefined) throw new Error(`unsupported SensorFault quality ${String(reading.quality)}`);
  return code;
}

function inputValue(value, inputType, label) { return typedValue(value, inputType, label); }

async function instantiateControlRuntime(wasmBytes, { bytes: bytecode, manifest } = {}, options, instantiateRuntime, supportsSchedules) {
  const wasm = new Uint8Array(bytes(wasmBytes, 'wasmBytes'));
  // Copy caller-owned bytecode before awaiting digest verification (TOCTOU-safe).
  const compiledBytes = new Uint8Array(bytes(bytecode, 'bytes'));
  const bytecodeFormat = compiledBytes.byteLength >= 6
    ? new DataView(compiledBytes.buffer, compiledBytes.byteOffset, compiledBytes.byteLength).getUint16(4, true)
    : null;
  const checkedManifest = validateManifest(manifest, { ...options, bytecodeFormat });
  const suppliedCapabilities = options.capabilities;
  const presentSensors = new Set(checkedManifest.manifest.sensors.filter(sensor => !sensor.optional).map(sensor => sensor.name));
  if (suppliedCapabilities !== undefined) {
    if (!Array.isArray(suppliedCapabilities) || suppliedCapabilities.length > MAX_LIST) throw new TypeError('capabilities must be a bounded array');
    const seen = new Set();
    for (const capability of suppliedCapabilities) {
      record(capability, 'capability');
      keys(capability, ['kind', 'name', 'type'], [], 'capability');
      if (capability.kind !== 'sensor') throw new Error('virtual capabilities must have kind sensor');
      const sensor = checkedManifest.sensorByName.get(capability.name);
      if (!sensor) throw new Error(`unknown capability sensor ${capability.name}`);
      if (seen.has(capability.name)) throw new Error(`duplicate capability sensor ${capability.name}`);
      if (sensor.type !== capability.type) throw new Error(`capability sensor ${capability.name} type mismatch`);
      seen.add(capability.name);
      presentSensors.add(capability.name);
    }
  }
  checkedManifest.presentSensors = suppliedCapabilities === undefined ? null : presentSensors;
  const hasWindows = checkedManifest.manifest.signals.some(item => item.kind === 'window');
  const hasTrueFor = checkedManifest.manifest.signals.some(item => item.kind === 'true-for');
  const hasAfterEvent = checkedManifest.manifest.signals.some(isAfterEvent);
  const hasContext = contextManifest(checkedManifest.manifest);
  const hasSolar = !hasContext && checkedManifest.manifest.schedules.some(item => item.kind === 'solar');
  const hasSchedules = !hasContext && checkedManifest.manifest.schedules.some(item => ['daily', 'daily-slots'].includes(item.kind));
  let temporal = null;
  if (hasContext) {
    if (options.context === undefined) throw new Error('context activation profile is required');
    encodeContextActivation(options.context);
    if (options.schedule !== undefined || options.solar !== undefined || options.temporal !== undefined) throw new Error('context activation cannot mix legacy profiles');
  }
  if (hasSolar && !supportsSchedules) throw new Error('framed Solar activation is not supported by this runtime');
  if (hasContext) {
    // The Rust runtime owns the provider and settings state.
  } else if (hasSchedules) {
    if (options.schedule === undefined) throw new Error('schedule activation profile is required');
    validateSolarActivation(options.schedule);
    if (options.solar !== undefined) throw new Error('civil schedule activation cannot use a Solar profile');
    if (options.temporal !== undefined) throw new Error('schedule activation cannot use a temporal profile');
  } else if (hasSolar) {
    if (options.solar === undefined) throw new Error('Solar activation profile is required');
    validateSolarActivation(options.solar);
    if (options.temporal !== undefined) throw new Error('Solar activation cannot use a temporal profile');
  } else if (hasWindows || hasTrueFor) {
    const suppliedTemporal = options.temporal;
    if (suppliedTemporal === undefined) throw new Error('window runtime requires an explicit temporal profile');
    encodeTemporalProfile(suppliedTemporal);
    temporal = freeze(copy(suppliedTemporal));
    encodeTemporalProfile(temporal);
  } else if (options.temporal !== undefined) {
    throw new Error('temporal profile requires a window module');
  }
  if (!hasSchedules && options.schedule !== undefined) throw new Error('schedule profile requires a Daily or DailySlots schedule');
  let afterEventEpoch = null;
  if (hasAfterEvent) {
    const profile = record(options.afterEvent, 'afterEvent');
    keys(profile, ['timeEpoch'], [], 'afterEvent');
    afterEventEpoch = safeInteger(profile.timeEpoch, 'afterEvent.timeEpoch');
  } else if (options.afterEvent !== undefined) {
    throw new Error('afterEvent profile requires an after_event signal');
  }
  const digest = await sha256(compiledBytes);
  if (digest !== checkedManifest.manifest.bytecodeSha256) throw new Error('bytecode SHA-256 does not match manifest');

  const runtime = await instantiateRuntime(wasm);
  const sensors = new Map();
  const signals = new Map();
  const afterEvents = new Map();
  try {
    runtime.load(compiledBytes);
    for (const item of [...checkedManifest.manifest.sensors, ...(checkedManifest.manifest.sensorInstances ?? [])]) sensors.set(item.name, { item, conditioner: new SignalConditioner(runtime.wasm, sensorConfig(item)) });
    for (const item of checkedManifest.manifest.signals) {
      if (isVmSignal(item) || item.kind === 'true-for' || isAfterEvent(item)) continue;
      const sensor = checkedManifest.sensorByName.get(item.sensor);
      // Signals intentionally duplicate the sensor conditioner: each node owns
      // its own bounded 31-slot state and can be checkpointed independently.
      signals.set(item.name, { item, conditioner: new SignalConditioner(runtime.wasm, { ...sensorConfig(sensor), hysteresis: { onBelow: item.onBelow, offAbove: item.offAbove, initial: item.initial } }) });
    }
    for (const item of checkedManifest.manifest.signals.filter(isAfterEvent)) {
      const tracker = await AfterEventRuntime.instantiate(wasm, {
        windowMs: item.windowMs,
        eventSourceTag: item.event.tag,
        predicateSourceTag: item.predicate.tag,
      });
      afterEvents.set(item.name, { item, runtime: tracker });
    }
    for (const output of checkedManifest.manifest.outputs) runtime.addCapability('actuator', output.name, output.type === 'Bool' ? 'bool' : output.type === 'Int' ? 'int' : 'number');
    if (suppliedCapabilities !== undefined) for (const sensor of [...checkedManifest.manifest.sensors, ...(checkedManifest.manifest.sensorInstances ?? [])]) {
      if (presentSensors.has(sensor.sourceSensor ?? sensor.name)) runtime.addCapability('sensor', sensor.name, sensor.type === 'Bool' ? 'bool' : 'number');
    }
    if (hasContext) runtime.activateContext(options.context);
    else if (hasSchedules) runtime.activateSchedules(options.schedule);
    else if (hasSolar) runtime.activateSolar(options.solar);
    else if (temporal) runtime.activateTemporal(temporal); else runtime.activate();
  } catch (error) {
    for (const { runtime: tracker } of afterEvents.values()) tracker.dispose();
    for (const { conditioner } of signals.values()) conditioner.dispose();
    for (const { conditioner } of sensors.values()) conditioner.dispose();
    runtime.dispose();
    throw error;
  }
  return { runtime, checkedManifest, sensors, signals, afterEvents, afterEventEpoch,
    temporalEpoch: hasContext ? options.context.bootEpoch : hasSchedules ? options.schedule.bootEpoch : hasSolar ? options.solar.bootEpoch : temporal?.timeEpoch ?? null,
    hasSolar, hasSchedules, hasContext };
}

export class ControlRuntime {
  static async instantiate(wasmBytes, { bytes: bytecode, manifest } = {}, options = {}) {
    const initialized = await instantiateControlRuntime(wasmBytes, { bytes: bytecode, manifest }, options, GhostFlowRuntime.instantiate, true);
    return new ControlRuntime(initialized.runtime, initialized.checkedManifest, initialized.sensors, initialized.signals,
      initialized.afterEvents, false, initialized.temporalEpoch, initialized.hasSolar, initialized.afterEventEpoch, initialized.hasSchedules, initialized.hasContext);
  }

  static async instantiateFramed(wasmBytes, artifact = {}, options = {}) {
    if ((artifact.manifest?.objectives?.length ?? 0) > 0) throw new Error('framed native objectives are not supported');
    const initialized = await instantiateControlRuntime(wasmBytes, artifact, options, FramedGhostFlowRuntime.instantiate, false);
    return new ControlRuntime(initialized.runtime, initialized.checkedManifest, initialized.sensors, initialized.signals,
      initialized.afterEvents, true, initialized.temporalEpoch, initialized.hasSolar, initialized.afterEventEpoch, initialized.hasSchedules, initialized.hasContext);
  }

  #frameScanId;
  #framed;
  #faulted;
  #temporalEpoch;
  #hasSolar;
  #hasSchedules;
  #hasContext;
  #afterEventEpoch;
  #presentSensors;

  constructor(runtime, manifest, sensors, signals, afterEvents, framed = false, temporalEpoch = null, hasSolar = false, afterEventEpoch = null, hasSchedules = false, hasContext = false) {
    this.runtime = runtime;
    this.exports = runtime.wasm;
    this.manifest = manifest.manifest;
    this.inputNames = manifest.inputNames;
    this.sensorByName = manifest.sensorByName;
    this.scheduleNames = manifest.scheduleNames;
    this.solarScheduleNames = new Set(manifest.manifest.schedules.filter(item => item.kind === 'solar').map(item => item.name));
    this.trueForSignals = manifest.manifest.signals.filter(item => item.kind === 'true-for');
    this.trueForSources = new Set(this.trueForSignals.flatMap(item => item.sources.map(source => source.name)));
    this.objectives = manifest.manifest.objectives ?? [];
    this.sensors = sensors;
    this.signals = signals;
    this.afterEvents = afterEvents;
    this.lastNowMs = null;
    this.#framed = framed;
    this.#frameScanId = 0;
    this.#faulted = false;
    this.#temporalEpoch = temporalEpoch;
    this.#hasSolar = hasSolar;
    this.#hasSchedules = hasSchedules;
    this.#hasContext = hasContext;
    this.#afterEventEpoch = afterEventEpoch;
    this.#presentSensors = manifest.presentSensors;
  }

  /** Latest committed framed outcome; legacy entries deliberately expose none. */
  get lastFrameOutcome() {
    this.#live();
    if (!this.#framed) return null;
    return this.runtime.outcome;
  }
  contextSnapshot() {
    this.#live();
    if (!this.#hasContext) throw new Error('context snapshot requires a context control');
    return this.runtime.contextSnapshot();
  }
  restoreContextCheckpoint(bytes) {
    this.#live();
    if (!this.#hasContext) throw new Error('context restore requires a context control');
    this.runtime.restoreContextCheckpoint(bytes);
  }

  /**
   * Executes one caller-supplied snapshot. Sensor sampleMs is metadata for the
   * acquisition owner; this host never polls hardware or performs I/O.
   */
  step({ nowMs, inputs = {}, samples = {}, due = {}, intervals = {}, events = {}, objectiveSafeMax = {}, solarFacts, scheduleFacts, contextFacts } = {}) {
    if (this.#framed) return this.#stepFramed({ nowMs, inputs, samples, due, intervals, events, objectiveSafeMax, solarFacts, scheduleFacts, contextFacts });
    return this.#stepLegacy({ nowMs, inputs, samples, due, intervals, events, objectiveSafeMax, solarFacts, scheduleFacts, contextFacts });
  }

  #stepLegacy({ nowMs, inputs = {}, samples = {}, due = {}, intervals = {}, events = {}, objectiveSafeMax = {}, solarFacts, scheduleFacts, contextFacts } = {}) {
    this.#live();
    if (this.#faulted) throw new Error('ControlRuntime is faulted; create a new instance');
    const captured = this.#captureSnapshot({ nowMs, inputs, samples, due, intervals, events, objectiveSafeMax, solarFacts, scheduleFacts, contextFacts });
    const transaction = this.#beginConditioners();
    let afterEventTransaction = [];
    let phase = 'prepare';
    try {
      const { sensorReadings, signalReadings, observedSensors } = this.#condition(captured.normalizedSamples, captured.nowMs);
      const staged = this.#stageAfterEvents(captured, sensorReadings, observedSensors);
      afterEventTransaction = staged.trackers;

      for (const item of this.manifest.inputs) {
        const value = captured.inputValues.get(item.name);
        if (item.type === 'Bool') this.runtime.setBool(item.name, value);
        else if (item.type === 'Int') this.runtime.setInt(item.name, value);
        else this.runtime.setNumber(item.name, value);
      }
      for (const [sensorName, entry] of this.sensors) {
        const reading = sensorReadings.get(sensorName);
        if (entry.item.type === 'Bool') this.runtime.setBool(entry.item.valueInput, reading.value);
        else this.runtime.setNumber(entry.item.valueInput, reading.value);
        this.runtime.setBool(entry.item.okInput, reading.ok);
        this.runtime.setNumber(entry.item.faultInput, sensorFaultCode(reading));
        if (entry.item.samplePresentInput !== undefined) {
          const identity = entry.conditioner.sampleIdentity();
          this.runtime.setBool(entry.item.samplePresentInput, captured.normalizedSamples.has(entry.item.sourceSensor ?? sensorName) && identity !== null);
          this.runtime.setNumber(entry.item.sampleEpochInput, identity?.epoch ?? 0);
          this.runtime.setNumber(entry.item.sampleIdInput, identity?.id ?? 0);
          this.runtime.setNumber(entry.item.sampleTimestampInput, identity?.timestampMs ?? 0);
        }
      }
      for (const [signalName, entry] of this.signals) {
        const reading = signalReadings.get(signalName);
        this.runtime.setBool(entry.item.valueInput, reading.value);
        this.runtime.setBool(entry.item.okInput, reading.ok);
        this.runtime.setNumber(entry.item.faultInput, sensorFaultCode(reading));
      }
      for (const objective of this.objectives) {
        if (!this.#hasContext) {
          const target = this.manifest.configs.find(item => item.name === objective.target);
          this.runtime.setNumber(objective.bindings.target, target.value);
        }
        this.runtime.setNumber(objective.bindings.safeMax, captured.objectiveSafeMax.get(objective.name));
      }
      for (const item of this.manifest.schedules) if (!this.#hasContext && !['solar', 'daily', 'daily-slots'].includes(item.kind)) this.runtime.setBool(item.dueInput, captured.dueValues.get(item.name) ?? false);
      this.#setIntervals(captured.intervalValues, (name, value) => {
        if (value.type === 'Bool') this.runtime.setBool(name, value.value);
        else this.runtime.setNumber(name, value.value);
      });
      this.#setAfterEventProjections(staged.projections, (name, value) => {
        if (value.type === 'Bool') this.runtime.setBool(name, value.value);
        else this.runtime.setNumber(name, value.value);
      });
      if (this.#temporalEpoch !== null) this.runtime.setNumber(`${RESERVED}time_epoch`, this.#temporalEpoch);
      if (this.#hasSolar || this.#hasSchedules || this.#hasContext) this.runtime.setNumber(`${RESERVED}now_ms`, captured.nowMs);
      phase = 'dispatch';
      if (this.#hasContext) this.runtime.tickContext(captured.contextFacts);
      else if (this.#hasSchedules) this.runtime.tickSchedules(captured.scheduleFacts);
      else if (this.#hasSolar) this.runtime.tickSolar(captured.solarFacts);
      else if (this.objectives.length || this.#temporalEpoch !== null || this.manifest.timers.length > 0 || this.manifest.signals.some(isVmSignal)) this.runtime.tickAt(captured.nowMs); else this.runtime.tick();
      phase = 'committed';
      this.lastNowMs = captured.nowMs;
      this.#commitConditioners(transaction);
      this.#commitAfterEvents(afterEventTransaction);
      const trace = this.runtime.trace;
      return {
        vm: trace,
        sensors: Object.fromEntries(sensorReadings),
        signals: Object.fromEntries(signalReadings),
      };
    } catch (error) {
      if (phase === 'prepare' || (phase === 'dispatch' && error instanceof NativeDispatchError && error.committed === false)) {
        this.#rollbackPrepared(transaction, afterEventTransaction, error);
      } else {
        if (phase === 'dispatch' && error instanceof NativeDispatchError && error.committed === true) {
          this.lastNowMs = captured.nowMs;
          try {
            this.#commitConditioners(transaction);
            this.#commitAfterEvents(afterEventTransaction);
          }
          catch (commitError) {
            this.#faulted = true;
            throw new AggregateError([error, commitError], 'postcommit conditioner finalization failed');
          }
        }
        this.#faulted = true;
      }
      throw error;
    }
  }

  #captureSnapshot({ nowMs, inputs = {}, samples = {}, due = {}, intervals = {}, events = {}, objectiveSafeMax = {}, solarFacts, scheduleFacts, contextFacts } = {}) {
    safeInteger(nowMs, 'nowMs');
    if (this.lastNowMs !== null && nowMs < this.lastNowMs) throw new Error('nowMs must be monotonic');
    record(inputs, 'inputs'); record(samples, 'samples'); record(due, 'due'); record(intervals, 'intervals'); record(events, 'events'); record(objectiveSafeMax, 'objectiveSafeMax');
    for (const key of Object.keys(inputs)) if (!this.inputNames.has(key)) throw new Error(`unknown input ${key}`);
    for (const item of this.manifest.inputs) if (!Object.prototype.hasOwnProperty.call(inputs, item.name)) throw new Error(`missing input ${item.name}`);
    for (const key of Object.keys(samples)) {
      if (!this.sensorByName.has(key)) throw new Error(`unknown sensor ${key}`);
      if (this.#presentSensors !== null && !this.#presentSensors.has(key)) throw new Error(`absent sensor capability ${key}`);
    }
    for (const key of Object.keys(due)) {
      if (this.#hasContext || this.solarScheduleNames.has(key) || this.manifest.schedules.some(item => ['daily', 'daily-slots'].includes(item.kind) && item.name === key)) throw new Error(`due.${key} cannot supply a runtime-owned due value`);
      if (!this.scheduleNames.has(key)) throw new Error(`unknown schedule ${key}`);
    }
    if (this.#hasSolar && solarFacts === undefined) throw new Error('solar facts are required');
    if (!this.#hasSolar && solarFacts !== undefined) throw new Error('solar facts require a Solar schedule');
    if (this.#hasSolar) {
      record(solarFacts, 'solarFacts');
      validateSolarFallbackFacts(solarFacts, this.manifest.schedules);
      const clock = record(solarFacts.clock, 'solarFacts.clock');
      if (clock.monotonicMs !== nowMs) throw new Error('solar facts clock.monotonicMs must equal nowMs');
      if (clock.bootEpoch !== this.#temporalEpoch) throw new Error('solar facts clock.bootEpoch must match activation');
    }
    if (this.#hasSchedules && scheduleFacts === undefined) throw new Error('schedule facts are required');
    if (!this.#hasSchedules && scheduleFacts !== undefined) throw new Error('schedule facts require a Daily or DailySlots schedule');
    if (this.#hasSchedules) {
      record(scheduleFacts, 'scheduleFacts');
      const clock = record(scheduleFacts.clock, 'scheduleFacts.clock');
      if (clock.monotonicMs !== nowMs) throw new Error('schedule facts clock.monotonicMs must equal nowMs');
      if (clock.bootEpoch !== this.#temporalEpoch) throw new Error('schedule facts clock.bootEpoch must match activation');
    }
    if (this.#hasContext && contextFacts === undefined) throw new Error('context facts are required');
    if (!this.#hasContext && contextFacts !== undefined) throw new Error('context facts require a GFB10 control');
    if (this.#hasContext) {
      validateContextSolarFacts(contextFacts, this.manifest.schedules);
      encodeContextFacts(contextFacts);
      if (contextFacts.clock.monotonicMs !== nowMs) throw new Error('context clock.monotonicMs must equal nowMs');
      if (contextFacts.clock.bootEpoch !== this.#temporalEpoch) throw new Error('context bootEpoch must match activation');
    }
    for (const key of Object.keys(intervals)) if (!this.trueForSources.has(key)) throw new Error(`unknown true_for source ${key}`);
    const eventNames = new Set([...this.afterEvents.values()].map(entry => entry.item.event.name));
    for (const key of Object.keys(events)) if (!eventNames.has(key)) throw new Error(`unknown Event source ${key}`);
    const objectiveSafeValues = new Map();
    for (const key of Object.keys(objectiveSafeMax)) if (!this.objectives.some(item => item.name === key)) throw new Error(`unknown objective ${key}`);
    for (const objective of this.objectives) {
      const value = Object.hasOwn(objectiveSafeMax, objective.name) ? objectiveSafeMax[objective.name] : objective.output.max;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < objective.output.min || value > objective.output.max) {
        throw new RangeError(`objectiveSafeMax.${objective.name} must be within ${objective.output.min}..${objective.output.max}`);
      }
      objectiveSafeValues.set(objective.name, value);
    }

    const inputValues = new Map();
    for (const item of this.manifest.inputs) {
      const value = inputs[item.name];
      inputValue(value, item.type, `inputs.${item.name}`);
      inputValues.set(item.name, value);
    }

    const normalizedSamples = new Map();
    for (const sensorName of Object.keys(samples)) {
      const item = this.sensorByName.get(sensorName);
      const sample = record(samples[sensorName], `samples.${sensorName}`);
      keys(sample, ['epoch', 'id', 'timestampMs', 'quality', 'value'], [], `samples.${sensorName}`);
      const epoch = safeInteger(sample.epoch, `samples.${sensorName}.epoch`);
      const id = safeInteger(sample.id, `samples.${sensorName}.id`);
      const timestampMs = safeInteger(sample.timestampMs, `samples.${sensorName}.timestampMs`);
      if (timestampMs > nowMs) throw new RangeError(`samples.${sensorName}.timestampMs cannot be in the future`);
      const quality = sample.quality;
      if (!(typeof quality === 'number' ? Number.isInteger(quality) && quality >= 0 && quality <= 4 : ['NotReady', 'Good', 'Disconnected', 'Stale', 'Invalid'].includes(quality))) throw new TypeError(`samples.${sensorName}.quality is unsupported`);
      const rawValue = sample.value;
      let value;
      if (item.type === 'Bool') {
        if (typeof rawValue !== 'boolean') throw new TypeError(`samples.${sensorName}.value must be boolean`);
        value = rawValue ? 1 : 0;
      } else {
        if (typeof rawValue !== 'number') throw new TypeError(`samples.${sensorName}.value must be numeric`);
        value = Number.isFinite(rawValue) ? rawValue : 0;
      }
      normalizedSamples.set(sensorName, { epoch, id, timestampMs, value, quality: Number.isFinite(rawValue) || item.type === 'Bool' ? quality : 'Invalid' });
    }

    const dueValues = new Map();
    for (const item of this.manifest.schedules) {
      if (!Object.prototype.hasOwnProperty.call(due, item.name)) continue;
      const value = due[item.name];
      if (typeof value !== 'boolean') throw new TypeError(`due.${item.name} must be boolean`);
      dueValues.set(item.name, value);
    }
    const intervalValues = new Map();
    for (const sourceName of this.trueForSources) {
      const raw = Object.prototype.hasOwnProperty.call(intervals, sourceName) ? intervals[sourceName] : null;
      intervalValues.set(sourceName, this.#normalizeInterval(raw, sourceName, nowMs));
    }
    const eventValues = new Map();
    for (const eventName of eventNames) {
      const raw = Object.hasOwn(events, eventName) ? record(events[eventName], `events.${eventName}`) : { starts: [], acknowledgements: [] };
      keys(raw, ['starts', 'acknowledgements'], [], `events.${eventName}`);
      const normalize = (items, label, withTime) => {
        if (!Array.isArray(items) || items.length > AFTER_EVENT_CAPACITY) throw new RangeError(`${label} exceeds ${AFTER_EVENT_CAPACITY} entries`);
        return items.map((item, index) => {
          const at = record(item, `${label}[${index}]`);
          keys(at, withTime ? ['sourceEpoch', 'id', 'atMs'] : ['sourceEpoch', 'id'], [], `${label}[${index}]`);
          const value = {
            sourceEpoch: safeInteger(at.sourceEpoch, `${label}[${index}].sourceEpoch`),
            id: safeInteger(at.id, `${label}[${index}].id`),
          };
          if (withTime) {
            value.atMs = safeInteger(at.atMs, `${label}[${index}].atMs`);
            if (value.atMs > nowMs) throw new RangeError(`${label}[${index}].atMs cannot be in the future`);
          }
          return value;
        });
      };
      eventValues.set(eventName, {
        starts: normalize(raw.starts, `events.${eventName}.starts`, true),
        acknowledgements: normalize(raw.acknowledgements, `events.${eventName}.acknowledgements`, false),
      });
    }
    return { nowMs, inputValues, normalizedSamples, dueValues, intervalValues, eventValues,
      objectiveSafeMax: objectiveSafeValues, solarFacts, scheduleFacts, contextFacts };
  }

  #normalizeInterval(raw, sourceName, nowMs) {
    if (raw === null || raw === undefined) return { present: false, epoch: 0, id: 0, start: 0, end: 0, value: false, quality: 0, fault: 0 };
    const item = record(raw, `intervals.${sourceName}`);
    keys(item, ['epoch', 'id', 'startMs', 'endMs', 'value', 'quality'], ['fault'], `intervals.${sourceName}`);
    const epoch = safeInteger(item.epoch, `intervals.${sourceName}.epoch`);
    const id = safeInteger(item.id, `intervals.${sourceName}.id`);
    const start = safeInteger(item.startMs, `intervals.${sourceName}.startMs`);
    const end = safeInteger(item.endMs, `intervals.${sourceName}.endMs`);
    if (end < start) throw new RangeError(`intervals.${sourceName}.endMs must be >= startMs`);
    if (end > nowMs) throw new RangeError(`intervals.${sourceName}.endMs cannot be in the future`);
    if (typeof item.value !== 'boolean') throw new TypeError(`intervals.${sourceName}.value must be boolean`);
    let quality = item.quality;
    let fault = item.fault ?? 0;
    if (typeof quality === 'string') {
      if (Object.hasOwn(INTERVAL_QUALITY, quality)) quality = INTERVAL_QUALITY[quality];
      else if (['Unavailable', 'Disconnected', 'Stale', 'Invalid', 'NotReady'].includes(quality)) {
        fault = quality === 'Unavailable' ? fault : INTERVAL_FAULT[quality];
        quality = 4;
      } else throw new TypeError(`intervals.${sourceName}.quality is unsupported`);
    }
    if (!Number.isInteger(quality) || quality < 1 || quality > 4) throw new TypeError(`intervals.${sourceName}.quality is unsupported`);
    if (typeof fault === 'string') {
      if (!Object.hasOwn(INTERVAL_FAULT, fault)) throw new TypeError(`intervals.${sourceName}.fault is unsupported`);
      fault = INTERVAL_FAULT[fault];
    }
    if (!Number.isInteger(fault) || fault < 0 || fault > 3) throw new TypeError(`intervals.${sourceName}.fault is unsupported`);
    if (quality !== 4 && fault !== 0) throw new Error(`intervals.${sourceName}.fault requires unavailable quality`);
    return { present: true, epoch, id, start, end, value: item.value, quality, fault };
  }

  #setIntervals(intervalValues, set) {
    for (const signal of this.trueForSignals) {
      const value = intervalValues.get(signal.sources[0].name);
      const fields = signal.intervalInputs;
      for (const field of INTERVAL_FIELDS) set(fields[field], { type: field === 'present' || field === 'value' ? 'Bool' : 'Number', value: value[field] });
    }
  }

  #stageAfterEvents(captured, sensorReadings, observedSensors) {
    const trackers = [];
    const projections = new Map();
    try {
      for (const [name, entry] of this.afterEvents) {
        const batch = captured.eventValues.get(entry.item.event.name);
        const sample = captured.normalizedSamples.get(entry.item.predicate.name);
        const hasObservation = observedSensors.has(entry.item.predicate.name)
          && sample.timestampMs === captured.nowMs;
        const reading = sensorReadings.get(entry.item.predicate.name);
        entry.runtime.stage({
          time: { epoch: this.#afterEventEpoch, nowMs: captured.nowMs },
          starts: batch.starts.map(event => ({
            sourceTag: entry.item.event.tag,
            sourceEpoch: event.sourceEpoch,
            id: event.id,
            timeEpoch: this.#afterEventEpoch,
            atMs: event.atMs,
          })),
          predicate: hasObservation && reading.ok ? {
            sourceTag: entry.item.predicate.tag,
            atMs: captured.nowMs,
            value: reading.value,
            quality: 'measured',
          } : null,
          acknowledgements: batch.acknowledgements.map(key => ({
            sourceTag: entry.item.event.tag,
            sourceEpoch: key.sourceEpoch,
            id: key.id,
          })),
        });
        trackers.push(entry.runtime);
        const values = new Map();
        for (const mode of entry.item.projections) {
          const projected = mode === 'any' ? entry.runtime.stagedAny() : entry.runtime.stagedAll();
          values.set(mode, projected.ok ? projected : {
            ok: false,
            fault: reading.ok ? 'NotReady' : reading.quality,
          });
        }
        projections.set(name, values);
      }
      return { trackers, projections };
    } catch (error) {
      this.#rollbackAfterEvents(trackers, error);
    }
  }

  #setAfterEventProjections(projections, set) {
    for (const [name, values] of projections) {
      const descriptor = this.afterEvents.get(name).item;
      for (const [mode, result] of values) {
        const inputs = descriptor.projectionInputs[mode];
        set(inputs.value, { type: 'Bool', value: result.ok ? result.value : false });
        set(inputs.ok, { type: 'Bool', value: result.ok });
        set(inputs.fault, { type: 'Number', value: result.ok ? 0 : SENSOR_FAULT_CODE[result.fault] });
      }
    }
  }

  #commitAfterEvents(trackers) {
    const failures = [];
    for (const tracker of trackers) {
      try { tracker.commit(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'after_event transaction commit failed');
  }

  #rollbackAfterEvents(trackers, cause) {
    const failures = [];
    for (const tracker of [...trackers].reverse()) {
      try { tracker.rollback(); } catch (error) { failures.push(error); }
    }
    if (failures.length) {
      this.#faulted = true;
      throw new AggregateError([cause, ...failures], 'after_event transaction rollback failed');
    }
    throw cause;
  }

  #rollbackPrepared(conditioners, trackers, cause) {
    const failures = [];
    try { this.#rollbackConditioners(conditioners, cause); } catch (error) { failures.push(error); }
    try { this.#rollbackAfterEvents(trackers, cause); } catch (error) {
      if (error !== cause) failures.push(error);
    }
    if (failures.length) {
      this.#faulted = true;
      throw new AggregateError([cause, ...failures], 'prepared transaction rollback failed');
    }
    throw cause;
  }

  #condition(normalizedSamples, nowMs) {
    const sensorReadings = new Map();
    const observedSensors = new Set();
    for (const [sensorName, entry] of this.sensors) {
      const sample = normalizedSamples.get(entry.item.sourceSensor ?? sensorName);
      const before = sample === undefined ? null : entry.conditioner.sampleIdentity();
      const raw = sample === undefined ? entry.conditioner.read(nowMs) : entry.conditioner.update(sample, nowMs);
      if (sample !== undefined) {
        const after = entry.conditioner.sampleIdentity();
        if (after?.epoch === sample.epoch && after.id === sample.id && after.timestampMs === sample.timestampMs
          && (before?.epoch !== after.epoch || before.id !== after.id || before.timestampMs !== after.timestampMs)) {
          observedSensors.add(sensorName);
        }
      }
      sensorReadings.set(sensorName, hostReading(raw, entry.item.type));
    }
    const signalReadings = new Map();
    for (const [signalName, entry] of this.signals) {
      const raw = normalizedSamples.has(entry.item.sensor) ? entry.conditioner.update(normalizedSamples.get(entry.item.sensor), nowMs) : entry.conditioner.read(nowMs);
      signalReadings.set(signalName, { ok: raw.ok, value: raw.ok ? Boolean(raw.dry) : false, quality: raw.quality, dry: raw.ok ? Boolean(raw.dry) : false });
    }
    return { sensorReadings, signalReadings, observedSensors };
  }

  #beginConditioners() {
    const begun = [];
    try {
      for (const { conditioner } of [...this.sensors.values(), ...this.signals.values()]) {
        conditioner.begin();
        begun.push(conditioner);
      }
      return begun;
    } catch (error) {
      this.#rollbackConditioners(begun, error);
      throw error;
    }
  }

  #commitConditioners(conditioners) {
    const failures = [];
    for (const conditioner of conditioners) {
      try { conditioner.commit(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'conditioner transaction commit failed');
  }

  #rollbackConditioners(conditioners, cause) {
    const failures = [];
    for (const conditioner of [...conditioners].reverse()) {
      try { conditioner.rollback(); } catch (error) { failures.push(error); }
    }
    if (failures.length) {
      this.#faulted = true;
      throw new AggregateError([cause, ...failures], 'conditioner transaction rollback failed');
    }
  }

  #stepFramed(snapshot) {
    this.#live();
    if (this.#faulted) throw new Error('framed ControlRuntime is faulted; create a new instance');
      const captured = this.#captureSnapshot(snapshot);
    if (this.#frameScanId === null || !Number.isSafeInteger(this.#frameScanId) || this.#frameScanId < 0 || this.#frameScanId > MAX_SAFE) {
      throw new RangeError('framed scan ID is exhausted');
    }

    const scanId = this.#frameScanId;
    const transaction = this.#beginConditioners();
    let afterEventTransaction = [];
    let phase = 'prepare';
    try {
      const { sensorReadings, signalReadings, observedSensors } = this.#condition(captured.normalizedSamples, captured.nowMs);
      const staged = this.#stageAfterEvents(captured, sensorReadings, observedSensors);
      afterEventTransaction = staged.trackers;
      const frameInputs = [];
      for (const item of this.manifest.inputs) frameInputs.push({ name: item.name, type: item.type, value: captured.inputValues.get(item.name) });
      for (const [, entry] of this.sensors) {
        const reading = sensorReadings.get(entry.item.name);
        frameInputs.push({ name: entry.item.valueInput, type: entry.item.type, value: reading.value });
        frameInputs.push({ name: entry.item.okInput, type: 'Bool', value: reading.ok });
        frameInputs.push({ name: entry.item.faultInput, type: 'Number', value: sensorFaultCode(reading) });
        if (entry.item.samplePresentInput !== undefined) {
          const identity = entry.conditioner.sampleIdentity();
          frameInputs.push({ name: entry.item.samplePresentInput, type: 'Bool', value: captured.normalizedSamples.has(entry.item.sourceSensor ?? entry.item.name) && identity !== null });
          frameInputs.push({ name: entry.item.sampleEpochInput, type: 'Number', value: identity?.epoch ?? 0 });
          frameInputs.push({ name: entry.item.sampleIdInput, type: 'Number', value: identity?.id ?? 0 });
          frameInputs.push({ name: entry.item.sampleTimestampInput, type: 'Number', value: identity?.timestampMs ?? 0 });
        }
      }
      for (const [, entry] of this.signals) {
        const reading = signalReadings.get(entry.item.name);
        frameInputs.push({ name: entry.item.valueInput, type: 'Bool', value: reading.value });
        frameInputs.push({ name: entry.item.okInput, type: 'Bool', value: reading.ok });
        frameInputs.push({ name: entry.item.faultInput, type: 'Number', value: sensorFaultCode(reading) });
      }
      for (const item of this.manifest.schedules) if (!this.#hasContext && !['solar', 'daily', 'daily-slots'].includes(item.kind)) {
        frameInputs.push({ name: item.dueInput, type: 'Bool', value: captured.dueValues.get(item.name) ?? false });
      }
      this.#setIntervals(captured.intervalValues, (name, value) => frameInputs.push({ name, type: value.type, value: value.value }));
      this.#setAfterEventProjections(staged.projections,
        (name, value) => frameInputs.push({ name, type: value.type, value: value.value }));
      if (this.#temporalEpoch !== null && !this.#hasContext && !this.#hasSchedules) frameInputs.push({ name: `${RESERVED}time_epoch`, type: 'Number', value: this.#temporalEpoch });

      phase = 'dispatch';
      const frame = { scanId, logicalTimeMs: captured.nowMs, inputs: frameInputs };
      if (this.#hasContext) this.runtime.dispatchContext(frame, captured.contextFacts);
      else if (this.#hasSchedules) this.runtime.dispatchSchedules(frame, captured.scheduleFacts);
      else this.runtime.dispatch(frame);
      phase = 'committed';
      this.lastNowMs = captured.nowMs;
      this.#frameScanId = scanId === MAX_SAFE ? null : scanId + 1;
      this.#commitConditioners(transaction);
      this.#commitAfterEvents(afterEventTransaction);
      const outcome = this.runtime.outcome;
      return {
        vm: outcome.trace,
        sensors: Object.fromEntries(sensorReadings),
        signals: Object.fromEntries(signalReadings),
        frame: { scanId, logicalTimeMs: captured.nowMs },
      };
    } catch (error) {
      if (phase === 'prepare' || (phase === 'dispatch' && error instanceof NativeDispatchError && error.committed === false)) {
        this.#rollbackPrepared(transaction, afterEventTransaction, error);
      } else {
        if (phase === 'dispatch' && error instanceof NativeDispatchError && error.committed === true) {
          this.lastNowMs = captured.nowMs;
          this.#frameScanId = scanId === MAX_SAFE ? null : scanId + 1;
          try {
            this.#commitConditioners(transaction);
            this.#commitAfterEvents(afterEventTransaction);
          }
          catch (commitError) {
            this.#faulted = true;
            throw new AggregateError([error, commitError], 'postcommit conditioner finalization failed');
          }
        }
        this.#faulted = true;
      }
      throw error;
    }
  }

  dispose() {
    for (const { runtime } of this.afterEvents.values()) runtime.dispose();
    for (const { conditioner } of this.signals.values()) conditioner.dispose();
    for (const { conditioner } of this.sensors.values()) conditioner.dispose();
    this.runtime.dispose();
    this.lastNowMs = null;
    this.#frameScanId = null;
    this.#faulted = false;
  }

  #live() { if (!this.runtime.handle) throw new Error('ControlRuntime is disposed'); }
}
