/**
 * Host-side binding for one GhostFlowStation and its one physical pump.
 *
 * This module only builds an audited policy/configuration object.  It neither
 * instantiates WASM nor drives a physical output; callers pass stationConfig
 * to GhostFlowStation after binding succeeds.
 */

const STATION_CONFIG_KEYS = new Set([
  'valveCount', 'maxOpenValves', 'dailyQuotaMs', 'maxStartBudgetMs', 'requireCapacityPass',
]);
const BINDING_KEYS = new Set([
  'station', 'pump', 'settings', 'schedules', 'modeAliases', 'activityAliases',
]);
const MODES = new Set(['Auto', 'Manual', 'Configure']);
const MAX_GROUPS = 128;
const MAX_RULES = 1024;

export class StationPolicyError extends Error {
  constructor(message) { super(message); this.name = 'StationPolicyError'; }
}

function fail(message) { throw new StationPolicyError(message); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

function exactKeys(value, allowed, name) {
  if (!isObject(value)) fail(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`unsupported ${name} field ${key}`);
}

function identifier(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) fail(`${name} must be an identifier`);
  return value;
}

function positiveInteger(value, name, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fail(`${name} must be an integer from 1 to ${max}`);
  return value;
}

function stationBinding(value) {
  exactKeys(value, new Set(['id', 'config']), 'station binding');
  if (!own(value, 'id')) fail('station binding requires id');
  if (!own(value, 'config')) fail('station binding requires config');
  const id = identifier(value.id, 'station binding id');
  exactKeys(value.config, STATION_CONFIG_KEYS, 'station config');
  const input = value.config;
  const valveCount = input.valveCount ?? 8;
  const maxOpenValves = input.maxOpenValves ?? 2;
  const dailyQuotaMs = input.dailyQuotaMs ?? 3_600_000;
  const maxStartBudgetMs = input.maxStartBudgetMs ?? 1_800_000;
  const requireCapacityPass = input.requireCapacityPass ?? false;
  positiveInteger(valveCount, 'station config valveCount', 64);
  positiveInteger(maxOpenValves, 'station config maxOpenValves', valveCount);
  positiveInteger(dailyQuotaMs, 'station config dailyQuotaMs');
  positiveInteger(maxStartBudgetMs, 'station config maxStartBudgetMs');
  if (typeof requireCapacityPass !== 'boolean') fail('station config requireCapacityPass must be boolean');
  return { id, config: { valveCount, maxOpenValves, dailyQuotaMs, maxStartBudgetMs, requireCapacityPass } };
}

function namedBinding(value, name) {
  exactKeys(value, new Set(['id']), `${name} binding`);
  if (!own(value, 'id')) fail(`${name} binding requires id`);
  return identifier(value.id, `${name} binding id`);
}

function aliases(value, name) {
  if (!isObject(value)) fail(`${name} must be an object`);
  const out = new Map();
  for (const [source, target] of Object.entries(value)) {
    identifier(source, `${name} source`);
    if (!MODES.has(target)) fail(`${name} target for ${source} must be Auto, Manual, or Configure`);
    out.set(source, target);
  }
  return out;
}

function scheduleBindings(value) {
  if (!isObject(value)) fail('schedules must be an object');
  const out = new Map();
  for (const [source, binding] of Object.entries(value)) {
    identifier(source, 'schedule source');
    exactKeys(binding, new Set(['id', 'timezone']), `schedule binding ${source}`);
    if (!own(binding, 'id') || !own(binding, 'timezone')) fail(`schedule binding ${source} requires id and timezone`);
    const id = identifier(binding.id, `schedule binding ${source} id`);
    if (typeof binding.timezone !== 'string' || binding.timezone.length === 0 || binding.timezone.length > 128) {
      fail(`schedule binding ${source} timezone must be a non-empty string`);
    }
    try { new Intl.DateTimeFormat('en-US', { timeZone: binding.timezone }); }
    catch { fail(`schedule binding ${source} has invalid IANA timezone ${JSON.stringify(binding.timezone)}`); }
    out.set(source, { id, timezone: binding.timezone });
  }
  return out;
}

function bindingProfile(value) {
  exactKeys(value, BINDING_KEYS, 'policy bindings');
  for (const key of BINDING_KEYS) if (!own(value, key)) fail(`policy bindings require ${key}`);
  return {
    station: stationBinding(value.station),
    pump: namedBinding(value.pump, 'pump'),
    settings: namedBinding(value.settings, 'settings'),
    schedules: scheduleBindings(value.schedules),
    modes: aliases(value.modeAliases, 'modeAliases'),
    activities: aliases(value.activityAliases, 'activityAliases'),
  };
}

function boundName(actual, expected, kind) {
  if (actual !== expected) fail(`unbound ${kind} identifier ${actual}`);
}

function mapped(aliasMap, source, kind) {
  const target = aliasMap.get(source);
  if (!target) fail(`unbound ${kind} identifier ${source}`);
  return target;
}

function mergeTimezone(current, next) {
  if (current !== undefined && current !== next) fail(`different constraint timezones are unsupported (${current}, ${next})`);
  return next;
}

function validateArtifact(artifact) {
  if (!isObject(artifact)) fail('expected GhostFlow/constraints-v1 artifact');
  exactKeys(artifact, new Set(['format', 'groups']), 'constraint artifact');
  if (artifact.format !== 'GhostFlow/constraints-v1' || !Array.isArray(artifact.groups)) {
    fail('expected GhostFlow/constraints-v1 artifact');
  }
  if (artifact.groups.length > MAX_GROUPS) fail(`constraint group count exceeds ${MAX_GROUPS}`);
  const names = new Set(); let count = 0;
  for (const group of artifact.groups) {
    exactKeys(group, new Set(['name', 'rules']), 'constraint group');
    if (typeof group.name !== 'string' || !Array.isArray(group.rules)) fail('invalid constraint group');
    if (names.has(group.name)) fail(`duplicate constraint group ${group.name}`);
    names.add(group.name);
    count += group.rules.length;
    if (count > MAX_RULES) fail(`constraint rule count exceeds ${MAX_RULES}`);
  }
}

/**
 * Bind a parsed constraint artifact to one station/pump installation.
 * All source identifiers must have explicit bindings; aliases map rule names
 * to the station runtime's Auto, Manual, and Configure mode values.
 */
export function bindStationPolicy(artifact, bindings) {
  validateArtifact(artifact);
  const profile = bindingProfile(bindings);
  let maxOpenValves = profile.station.config.maxOpenValves;
  let dailyQuotaMs = profile.station.config.dailyQuotaMs;
  let timezone;
  let requireCapacityPass = profile.station.config.requireCapacityPass;
  let requiresOpenValve = false;
  let enterModes = null;
  const exclusiveModes = new Set();
  const onceSchedules = [];
  const seenSchedules = new Set();
  const checks = [];
  let configureOnly = false;

  for (const group of artifact.groups) for (const rule of group.rules) {
    if (!isObject(rule) || typeof rule.kind !== 'string') fail(`invalid rule in group ${group.name}`);
    switch (rule.kind) {
      case 'exclusive': {
        exactKeys(rule, new Set(['kind', 'activities']), 'exclusive rule');
        if (!Array.isArray(rule.activities) || rule.activities.length < 2) fail(`invalid exclusive rule in group ${group.name}`);
        const values = rule.activities.map(activity => mapped(profile.activities, activity, 'activity'));
        if (new Set(values).size !== values.length) fail(`exclusive rule in group ${group.name} aliases duplicate station modes`);
        values.forEach(value => exclusiveModes.add(value));
        break;
      }
      case 'enterStopped': {
        exactKeys(rule, new Set(['kind', 'modes', 'station']), 'enterStopped rule');
        if (!Array.isArray(rule.modes) || rule.modes.length < 1) fail(`invalid enterStopped rule in group ${group.name}`);
        boundName(rule.station, profile.station.id, 'station');
        const values = rule.modes.map(mode => mapped(profile.modes, mode, 'mode'));
        if (enterModes === null) enterModes = new Set();
        values.forEach(mode => enterModes.add(mode));
        break;
      }
      case 'configureOnly':
        exactKeys(rule, new Set(['kind', 'settings', 'station']), 'configureOnly rule');
        boundName(rule.station, profile.station.id, 'station');
        boundName(rule.settings, profile.settings, 'settings');
        configureOnly = true;
        break;
      case 'maxValves':
        exactKeys(rule, new Set(['kind', 'pump', 'max']), 'maxValves rule');
        boundName(rule.pump, profile.pump, 'pump');
        positiveInteger(rule.max, 'maxValves max', 64);
        maxOpenValves = Math.min(maxOpenValves, rule.max);
        break;
      case 'pumpNeedsValve':
        exactKeys(rule, new Set(['kind', 'pump']), 'pumpNeedsValve rule');
        boundName(rule.pump, profile.pump, 'pump');
        requiresOpenValve = true;
        break;
      case 'dailyLimit':
        exactKeys(rule, new Set(['kind', 'pump', 'limitMs', 'timezone']), 'dailyLimit rule');
        boundName(rule.pump, profile.pump, 'pump');
        positiveInteger(rule.limitMs, 'dailyLimit limitMs');
        if (typeof rule.timezone !== 'string' || rule.timezone.length === 0 || rule.timezone.length > 128) fail('dailyLimit timezone must be a non-empty string');
        try { new Intl.DateTimeFormat('en-US', { timeZone: rule.timezone }); }
        catch { fail(`dailyLimit has invalid IANA timezone ${JSON.stringify(rule.timezone)}`); }
        timezone = mergeTimezone(timezone, rule.timezone);
        dailyQuotaMs = Math.min(dailyQuotaMs, rule.limitMs);
        break;
      case 'once': {
        exactKeys(rule, new Set(['kind', 'schedule']), 'once rule');
        const schedule = profile.schedules.get(rule.schedule);
        if (!schedule) fail(`unbound schedule identifier ${rule.schedule}`);
        timezone = mergeTimezone(timezone, schedule.timezone);
        if (!seenSchedules.has(schedule.id)) {
          seenSchedules.add(schedule.id);
          onceSchedules.push({ id: schedule.id, timezone: schedule.timezone });
        }
        break;
      }
      case 'capacityCheck':
        exactKeys(rule, new Set(['kind', 'pump', 'required']), 'capacityCheck rule');
        boundName(rule.pump, profile.pump, 'pump');
        if (typeof rule.required !== 'boolean') fail('capacityCheck required must be boolean');
        checks.push({ kind: 'capacityCheck', pump: profile.pump, required: rule.required,
          missing: 'Unknown', blocking: rule.required });
        if (rule.required) requireCapacityPass = true;
        break;
      default:
        fail(`unsupported constraint rule ${rule.kind} in group ${group.name}`);
    }
  }

  if (maxOpenValves > profile.station.config.valveCount) fail('combined maxOpenValves exceeds valveCount');
  return {
    stationConfig: {
      valveCount: profile.station.config.valveCount,
      maxOpenValves,
      dailyQuotaMs,
      maxStartBudgetMs: profile.station.config.maxStartBudgetMs,
      requireCapacityPass,
    },
    timezone,
    onceSchedules,
    checks,
    interlock: {
      station: profile.station.id,
      enterModes: enterModes === null ? [] : [...enterModes].sort(),
      requiresStoppedForEnter: enterModes !== null,
      configureOnly: configureOnly ? { settings: profile.settings, requiresStopped: true } : null,
      exclusiveModes: [...exclusiveModes].sort(),
    },
    pump: { id: profile.pump, requiresOpenValve },
  };
}
