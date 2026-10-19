// Pure bounded query over caller-supplied declarations and reports. No I/O or clock.
import { jsonSha256, validateReleaseIdentity } from './integration-contract.mjs';

export const TARGET_QUERY_SCHEMA = 'GhostFlow/target-query-v1';
export const TARGET_QUERY_RESULT = 'GhostFlow/target-query-result-v1';
export const TARGET_QUERY_MAX_BYTES = 262144;
export const TARGET_QUERY_MAX_OUTPUT_BYTES = 65536;
const SHA = /^[a-f0-9]{64}$/;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (object, key) => Object.hasOwn(object, key);

export class TargetQueryError extends Error {
  constructor(path, message) { super(`${path}: ${message}`); this.name = 'TargetQueryError'; this.code = 'GF_TARGET_QUERY'; this.path = path; }
}
function fail(path, message) { throw new TargetQueryError(path, message); }
function snapshot(value) {
  const seen = new Set();
  let count = 0;
  function copy(item, path, depth) {
    if (++count > 12000 || depth > 16) fail(path, 'input complexity limit exceeded');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'string') { if (item.length > 4096) fail(path, 'text limit exceeded'); return item; }
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if ((!isRecord(item) && !Array.isArray(item)) || seen.has(item)) fail(path, 'expected acyclic JSON data');
    seen.add(item);
    let result;
    if (Array.isArray(item)) {
      if (item.length > 1024) fail(path, 'array limit exceeded');
      result = [];
      for (let index = 0; index < item.length; index++) {
        if (!own(item, index)) fail(`${path}[${index}]`, 'sparse array');
        result.push(copy(item[index], `${path}[${index}]`, depth + 1));
      }
    } else {
      const keys = Object.keys(item);
      if (keys.length > 1024 || Object.getOwnPropertySymbols(item).length) fail(path, 'object key limit exceeded');
      result = Object.create(null);
      for (const key of keys) {
        if (key.length > 128) fail(path, 'key limit exceeded');
        result[key] = copy(item[key], `${path}.${key}`, depth + 1);
      }
    }
    seen.delete(item);
    return result;
  }
  const result = copy(value, 'request', 0);
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > TARGET_QUERY_MAX_BYTES) fail('request', 'byte limit exceeded');
  return result;
}
function record(value, path, required, optional = []) {
  if (!isRecord(value)) fail(path, 'expected object');
  for (const key of required) if (!own(value, key)) fail(`${path}.${key}`, 'required field');
  for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) fail(`${path}.${key}`, 'unexpected field');
  return value;
}
function str(value, path) { if (typeof value !== 'string' || !value.trim() || value.length > 256) fail(path, 'expected nonempty text of at most 256 characters'); return value; }
function digest(value, path) { if (typeof value !== 'string' || !SHA.test(value)) fail(path, 'expected lowercase SHA-256'); return value; }
function utc(value, path) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(path, 'expected canonical UTC ISO 8601 milliseconds');
  return Date.parse(value);
}
function list(value, path, validate, max = 128, nonempty = false) {
  if (!Array.isArray(value) || value.length > max || (nonempty && !value.length)) fail(path, `expected ${nonempty ? 'nonempty ' : ''}array of at most ${max}`);
  const seen = new Set();
  return value.map((entry, index) => {
    const v = validate(entry, `${path}[${index}]`);
    const key = typeof v === 'string' ? v : (v.id ?? v.evidenceRef);
    if (seen.has(key)) fail(`${path}[${index}]`, 'duplicate entry');
    seen.add(key);
    return v;
  });
}
const texts = (value, path, max = 32, nonempty = false) => list(value, path, str, max, nonempty);
function driver(value, path) {
  record(value, path, ['id', 'version', 'sha256']);
  str(value.id, `${path}.id`); str(value.version, `${path}.version`); digest(value.sha256, `${path}.sha256`);
  return value;
}
function identity(value, path, observation = false) {
  record(value, path, ['targetId', 'bootId', 'releaseSha256', 'drivers', 'observedAt', 'evidenceRef'], observation ? ['channels', 'resources'] : []);
  str(value.targetId, `${path}.targetId`); str(value.bootId, `${path}.bootId`);
  digest(value.releaseSha256, `${path}.releaseSha256`);
  list(value.drivers, `${path}.drivers`, driver, 128);
  utc(value.observedAt, `${path}.observedAt`); str(value.evidenceRef, `${path}.evidenceRef`);
}
function state(value, path) {
  record(value, path, ['id', 'state']); str(value.id, `${path}.id`);
  if (!['available', 'busy', 'reserved'].includes(value.state)) fail(`${path}.state`, 'expected available, busy or reserved');
  return value;
}
function ageStatus(at, asOf, maxAgeMs) { return at > asOf ? 'future' : asOf - at > maxAgeMs ? 'stale' : 'fresh'; }
function identityIssues(report, targetId, releaseSha, drivers, bootId) {
  const issues = [];
  if (report.targetId !== targetId) issues.push('target_mismatch');
  if (report.releaseSha256 !== releaseSha) issues.push('release_mismatch');
  if (bootId !== null && report.bootId !== bootId) issues.push('boot_mismatch');
  const got = new Map(report.drivers.map(d => [d.id, d]));
  if (got.size !== drivers.length || drivers.some(d => got.get(d.id)?.version !== d.version || got.get(d.id)?.sha256 !== d.sha256)) issues.push('driver_mismatch');
  return issues;
}
function filterObject(value) {
  if (value === undefined) return Object.create(null);
  record(value, 'request.filter', [], ['channels', 'directions', 'types', 'features', 'contractVersions', 'exampleTags']);
  for (const key of Object.keys(value)) {
    texts(value[key], `request.filter.${key}`, 128, true);
    if (key === 'directions' && value[key].some(x => !['input', 'output'].includes(x))) fail(`request.filter.${key}`, 'expected input or output');
  }
  return value;
}
function matches(channel, filter) {
  return (!filter.channels || filter.channels.includes(channel.id))
    && (!filter.directions || filter.directions.includes(channel.direction))
    && (!filter.types || filter.types.includes(channel.type))
    && (!filter.features || filter.features.every(x => channel.features?.includes(x)))
    && (!filter.contractVersions || filter.contractVersions.includes(channel.driver.version));
}
const diagnostic = (source, index, report, codes) => ({ source, index,
  evidenceRef: report.evidenceRef, observedAt: report.observedAt,
  targetId: report.targetId, bootId: report.bootId, codes });
const evidence = (report, status, codes = []) => ({
  evidenceRef: report.evidenceRef, observedAt: report.observedAt,
  targetId: report.targetId, bootId: report.bootId, releaseSha256: report.releaseSha256,
  drivers: report.drivers.map(d => ({ ...d })), status, codes: [...codes],
  ...(own(report, 'channels') ? { channels: report.channels.map(x => ({ ...x })) } : {}),
  ...(own(report, 'resources') ? { resources: report.resources.map(x => ({ ...x })) } : {}),
});

/** A deterministic view of declared metadata and explicitly supplied reports. Throws TargetQueryError on malformed input. */
export function queryTarget(input) {
  const request = snapshot(input);
  const requestSha256 = jsonSha256(request);
  record(request, 'request', ['schema', 'asOf', 'maxAgeMs', 'target'], ['installed', 'observations', 'filter']);
  if (request.schema !== TARGET_QUERY_SCHEMA) fail('request.schema', `expected ${TARGET_QUERY_SCHEMA}`);
  const asOf = utc(request.asOf, 'request.asOf');
  if (!Number.isSafeInteger(request.maxAgeMs) || request.maxAgeMs < 0 || request.maxAgeMs > 31536000000) fail('request.maxAgeMs', 'expected safe integer from 0 to 31536000000');
  const filter = filterObject(request.filter);
  const target = record(request.target, 'request.target', ['id', 'release', 'boardProfile', 'installation', 'drivers', 'channels'], ['examples']);
  const targetSha256 = jsonSha256(target);
  str(target.id, 'request.target.id');
  const releaseCheck = validateReleaseIdentity(target.release, target);
  if (!releaseCheck.valid) fail('request.target', `invalid integration identity: ${releaseCheck.errors.map(x => `${x.path}:${x.code}`).slice(0, 8).join(', ')}`);
  const releaseSha256 = jsonSha256(target.release);
  const drivers = list(target.drivers, 'request.target.drivers', driver, 128);
  const driverById = new Map(drivers.map(d => [d.id, d]));
  const channels = list(target.channels, 'request.target.channels', (channel, path) => {
    record(channel, path, ['id'], ['unit', 'updatePeriodMs', 'features', 'resources']);
    str(channel.id, `${path}.id`);
    const endpoint = target.boardProfile.endpoints[channel.id];
    if (!endpoint) fail(`${path}.id`, 'unknown board profile endpoint');
    if (!driverById.has(endpoint.driver)) fail(`${path}.id`, 'endpoint driver lacks versioned reference');
    if (own(channel, 'unit')) str(channel.unit, `${path}.unit`);
    if (own(channel, 'updatePeriodMs') && (!Number.isSafeInteger(channel.updatePeriodMs) || channel.updatePeriodMs <= 0 || channel.updatePeriodMs > 31536000000)) fail(`${path}.updatePeriodMs`, 'expected positive bounded integer');
    if (own(channel, 'features')) texts(channel.features, `${path}.features`, 32);
    if (own(channel, 'resources')) texts(channel.resources, `${path}.resources`, 32);
    return channel;
  }, 256);
  if (channels.length !== Object.keys(target.boardProfile.endpoints).length) fail('request.target.channels', 'each board profile endpoint needs one explicit channel record');
  const channelIds = new Set(channels.map(c => c.id));
  const examples = list(target.examples ?? [], 'request.target.examples', (example, path) => {
    record(example, path, ['id', 'ref', 'tags', 'channels']);
    str(example.id, `${path}.id`); str(example.ref, `${path}.ref`);
    texts(example.tags, `${path}.tags`, 32, true);
    texts(example.channels, `${path}.channels`, 32, true);
    for (const id of example.channels) if (!channelIds.has(id)) fail(`${path}.channels`, `unknown channel ${id}`);
    return example;
  }, 128);
  let installed = null;
  const diagnostics = [];
  let installedCodes = [];
  if (own(request, 'installed')) {
    identity(request.installed, 'request.installed');
    installed = request.installed;
    const codes = identityIssues(installed, target.id, releaseSha256, drivers, null);
    const age = ageStatus(Date.parse(installed.observedAt), asOf, request.maxAgeMs);
    if (age !== 'fresh') codes.push(age);
    installedCodes = codes;
    if (codes.length) diagnostics.push(diagnostic('installed', 0, installed, codes));
  }
  const observed = list(request.observations ?? [], 'request.observations', (observation, path) => {
    identity(observation, path, true);
    record(observation, path, ['targetId', 'bootId', 'releaseSha256', 'drivers', 'observedAt', 'evidenceRef', 'channels', 'resources']);
    list(observation.channels, `${path}.channels`, state, 256);
    list(observation.resources, `${path}.resources`, state, 256);
    for (const item of observation.channels) if (!channelIds.has(item.id)) fail(`${path}.channels`, `unknown channel ${item.id}`);
    return observation;
  }, 128);
  const validInstalled = installed && !diagnostics.some(d => d.source === 'installed');
  const validObservations = [];
  const observedEvidence = [];
  observed.forEach((item, index) => {
    const codes = identityIssues(item, target.id, releaseSha256, drivers, installed?.bootId ?? null);
    if (!validInstalled) codes.push('unlinked_installation');
    const age = ageStatus(Date.parse(item.observedAt), asOf, request.maxAgeMs);
    if (age !== 'fresh') codes.push(age);
    if (codes.length) diagnostics.push(diagnostic('observation', index, item, [...new Set(codes)]));
    else validObservations.push(item);
    observedEvidence.push(evidence(item, codes.length ? 'excluded' : 'linked_fresh', [...new Set(codes)]));
  });
  const bindings = Object.entries(target.installation.bindings);
  const selected = channels.filter(c => matches({ ...c, direction: target.boardProfile.endpoints[c.id].direction,
    type: target.boardProfile.endpoints[c.id].type, driver: driverById.get(target.boardProfile.endpoints[c.id].driver) }, filter));
  const results = selected.map(channel => {
    const endpoint = target.boardProfile.endpoints[channel.id];
    const resourceIds = channel.resources ?? [];
    const channelStates = validObservations.flatMap(o => o.channels.filter(x => x.id === channel.id).map(x => x.state));
    const resourceStates = resourceIds.map(id => validObservations.flatMap(o => o.resources.filter(x => x.id === id).map(x => x.state)));
    const allStates = [channelStates, ...resourceStates];
    let availability = 'unknown';
    if (allStates.some(states => new Set(states).size > 1)) availability = 'conflict';
    else if (own(channel, 'resources') && allStates.every(states => states.length)) {
      const values = allStates.map(states => states[0]);
      availability = values.includes('reserved') ? 'reserved' : values.includes('busy') ? 'busy' : 'available';
    }
    const logicalNames = bindings.filter(([, endpointId]) => endpointId === channel.id).map(([name]) => name).sort();
    return { id: channel.id, direction: endpoint.direction, type: endpoint.type,
      driver: { ...driverById.get(endpoint.driver) }, logicalNames,
      ...(own(channel, 'unit') ? { unit: channel.unit } : {}),
      ...(own(channel, 'updatePeriodMs') ? { updatePeriodMs: channel.updatePeriodMs } : {}),
      ...(own(channel, 'features') ? { features: [...channel.features] } : {}),
      ...(own(channel, 'resources') ? { resources: [...channel.resources] } : {}),
      installation: validInstalled ? 'installed_reported' : 'unknown',
      observation: channelStates.length ? 'observed' : 'unknown', availability };
  });
  const selectedIds = new Set(results.map(c => c.id));
  const matchedExamples = filter.exampleTags ? examples.filter(e => filter.exampleTags.some(tag => e.tags.includes(tag))
    && e.channels.some(id => selectedIds.has(id))).map(e => ({ id: e.id, ref: e.ref, tags: [...e.tags], channels: [...e.channels] })) : [];
  const result = { schema: TARGET_QUERY_RESULT, asOf: request.asOf, targetId: target.id,
    requestSha256, targetSha256,
    declared: { releaseSha256, runtimeSemanticsVersion: target.release.runtimeSemanticsVersion,
      protocolVersion: target.release.protocolVersion, firmwareSha256: target.release.device.firmwareSha256,
      boardProfile: { ...target.release.device.boardProfile }, installation: { ...target.release.installation } },
    installation: validInstalled ? 'installed_reported' : 'unknown',
    channels: results, examples: matchedExamples, diagnostics,
    suppliedEvidence: { installed: installed ? evidence(installed, validInstalled ? 'linked_fresh' : 'excluded', installedCodes) : null,
      observations: observedEvidence } };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > TARGET_QUERY_MAX_OUTPUT_BYTES) {
    return { schema: TARGET_QUERY_RESULT, outcome: 'incomplete', asOf: request.asOf,
      targetId: target.id, requestSha256, targetSha256,
      diagnostics: [{ source: 'result', index: 0, codes: ['output_limit'],
        message: 'complete result exceeds byte limit; narrow the supplied reports or filters' }] };
  }
  return result;
}
