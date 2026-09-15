import { createHash } from 'node:crypto';
import { canonicalJson } from '../../tools/canonical-json.mjs';

export const INTERACTION_SCHEMA_FORMAT = 'GhostFlow/interaction-schema-v0';
export const RUNTIME_SNAPSHOT_FORMAT = 'GhostFlow/runtime-snapshot-v0';
export const INTERACTION_SCHEMA_VERSION = '0.1';
export const RUNTIME_SNAPSHOT_VERSION = '0.1';

const PUBLIC_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BUILTIN_TYPES = new Map([
  ['Bool', null],
  ['Number', null],
  ['Duration', 'ms'],
]);
const ACCESS = new Set(['read', 'write', 'execute']);
const OBSERVATION_STATUS = new Set(['ready', 'unavailable', 'error']);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function issue(errors, path, code, message) {
  errors.push({ path, code, message });
}

function exactObject(value, fields, path, errors) {
  const initialErrors = errors.length;
  if (!object(value)) {
    issue(errors, path, 'shape', 'must be an object');
    return false;
  }
  for (const field of fields) if (!Object.hasOwn(value, field)) issue(errors, `${path}.${field}`, 'missing_field', 'is required');
  for (const field of Object.keys(value)) if (!fields.includes(field)) issue(errors, `${path}.${field}`, 'unknown_field', 'is not allowed');
  return errors.length === initialErrors;
}

function publicId(value, path, errors) {
  if (typeof value !== 'string' || !PUBLIC_ID.test(value) || value.startsWith('__gf_')) {
    issue(errors, path, 'public_identity', 'must be a public stable identity and must not use __gf_');
    return false;
  }
  return true;
}

function sha256(value, path, errors) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    issue(errors, path, 'sha256', 'must be a lowercase SHA-256 digest');
    return false;
  }
  return true;
}

function identity(value, path, errors, { source = false } = {}) {
  const fields = source ? ['format', 'kind', 'path', 'sha256'] : ['id', 'sha256'];
  if (!exactObject(value, fields, path, errors)) return;
  if (source) {
    if (value.format !== 'GhostFlow/source-document-v1') issue(errors, `${path}.format`, 'format', 'must be GhostFlow/source-document-v1');
    if (value.kind !== 'literate' && value.kind !== 'plain') issue(errors, `${path}.kind`, 'source_kind', 'must be literate or plain');
    if (typeof value.path !== 'string' || !value.path || value.path.startsWith('/') || value.path.split('/').includes('..')) {
      issue(errors, `${path}.path`, 'source_path', 'must be a repository-relative path');
    }
  } else {
    publicId(value.id, `${path}.id`, errors);
  }
  sha256(value.sha256, `${path}.sha256`, errors);
}

function sourceType(value, path, errors) {
  if (!exactObject(value, ['kind', 'name', 'unit'], path, errors)) return;
  if (value.kind !== 'builtin' && value.kind !== 'nominal') issue(errors, `${path}.kind`, 'source_type', 'must be builtin or nominal');
  if (value.kind === 'builtin') {
    if (!BUILTIN_TYPES.has(value.name)) issue(errors, `${path}.name`, 'source_type', 'must be Bool, Number, or Duration');
    else if (value.unit !== BUILTIN_TYPES.get(value.name)) issue(errors, `${path}.unit`, 'unit', `must be ${BUILTIN_TYPES.get(value.name) ?? 'null'} for ${value.name}`);
  } else {
    publicId(value.name, `${path}.name`, errors);
    if (value.unit !== null && (typeof value.unit !== 'string' || !value.unit)) issue(errors, `${path}.unit`, 'unit', 'must be null or a non-empty semantic unit');
  }
}

function provenance(value, kind, path, errors) {
  if (!exactObject(value, ['sourceNode', 'intentAnchorIds'], path, errors)) return;
  if (exactObject(value.sourceNode, ['id', 'kind'], `${path}.sourceNode`, errors)) {
    if (!Number.isSafeInteger(value.sourceNode.id) || value.sourceNode.id < 1) {
      issue(errors, `${path}.sourceNode.id`, 'source_node', 'must be a positive source-map node ID');
    }
    if (value.sourceNode.kind !== kind) issue(errors, `${path}.sourceNode.kind`, 'source_node', 'must match descriptor kind');
  }
  if (!Array.isArray(value.intentAnchorIds) || value.intentAnchorIds.length === 0) {
    issue(errors, `${path}.intentAnchorIds`, 'intent_provenance', 'must be a non-empty array');
  } else {
    const seen = new Set();
    value.intentAnchorIds.forEach((id, index) => {
      publicId(id, `${path}.intentAnchorIds[${index}]`, errors);
      if (seen.has(id)) issue(errors, `${path}.intentAnchorIds[${index}]`, 'duplicate_identity', 'must not repeat an intent anchor');
      seen.add(id);
    });
  }
}

function descriptor(value, index, errors) {
  const path = `schema.descriptors[${index}]`;
  if (!object(value)) {
    issue(errors, path, 'shape', 'must be an object');
    return;
  }
  const fields = value.kind === 'timer'
    ? ['id', 'name', 'kind', 'sourceType', 'access', 'operation', 'provenance']
    : ['id', 'name', 'kind', 'sourceType', 'access', 'provenance'];
  if (!exactObject(value, fields, path, errors)) return;
  publicId(value.id, `${path}.id`, errors);
  publicId(value.name, `${path}.name`, errors);
  if (!['state', 'input', 'setting', 'command', 'timer'].includes(value.kind)) issue(errors, `${path}.kind`, 'descriptor_kind', 'is unsupported in v0');
  sourceType(value.sourceType, `${path}.sourceType`, errors);
  if (!Array.isArray(value.access) || value.access.length === 0) issue(errors, `${path}.access`, 'access', 'must be a non-empty array');
  else {
    const seen = new Set();
    value.access.forEach((entry, position) => {
      if (!ACCESS.has(entry)) issue(errors, `${path}.access[${position}]`, 'access', 'must be read, write, or execute');
      if (seen.has(entry)) issue(errors, `${path}.access[${position}]`, 'duplicate_access', 'must not repeat an access');
      seen.add(entry);
    });
  }
  if (value.kind === 'timer') {
    if (exactObject(value.operation, ['kind', 'subjectId'], `${path}.operation`, errors)) {
      if (value.operation.kind !== 'elapsed_since_change') issue(errors, `${path}.operation.kind`, 'timer_operation', 'must be elapsed_since_change');
      publicId(value.operation.subjectId, `${path}.operation.subjectId`, errors);
    }
    if (value.sourceType?.kind !== 'builtin' || value.sourceType?.name !== 'Duration' || value.sourceType?.unit !== 'ms') {
      issue(errors, `${path}.sourceType`, 'timer_type', 'must be builtin Duration in ms');
    }
  }
  provenance(value.provenance, value.kind, `${path}.provenance`, errors);
}

function validateSchema(schema, errors) {
  if (!exactObject(schema, ['format', 'version', 'module', 'source', 'descriptors'], 'schema', errors)) return;
  if (schema.format !== INTERACTION_SCHEMA_FORMAT) issue(errors, 'schema.format', 'format', `must be ${INTERACTION_SCHEMA_FORMAT}`);
  if (schema.version !== INTERACTION_SCHEMA_VERSION) issue(errors, 'schema.version', 'version', `must be ${INTERACTION_SCHEMA_VERSION}`);
  identity(schema.module, 'schema.module', errors);
  identity(schema.source, 'schema.source', errors, { source: true });
  if (!Array.isArray(schema.descriptors) || schema.descriptors.length === 0) {
    issue(errors, 'schema.descriptors', 'descriptors', 'must be a non-empty array');
    return;
  }
  const ids = new Set();
  const names = new Set();
  schema.descriptors.forEach((entry, index) => {
    descriptor(entry, index, errors);
    if (ids.has(entry?.id)) issue(errors, `schema.descriptors[${index}].id`, 'duplicate_identity', 'must be unique');
    if (names.has(entry?.name)) issue(errors, `schema.descriptors[${index}].name`, 'duplicate_identity', 'must be unique');
    ids.add(entry?.id); names.add(entry?.name);
  });
  for (const entry of schema.descriptors) {
    if (entry?.kind === 'timer' && !ids.has(entry.operation?.subjectId)) {
      issue(errors, `schema.descriptors.${entry.id}.operation.subjectId`, 'timer_subject', 'must name an authored descriptor');
    }
  }
}

function sameIdentity(actual, expected, path, errors) {
  for (const key of Object.keys(expected)) {
    if (actual?.[key] !== expected[key]) issue(errors, `${path}.${key}`, 'identity_mismatch', 'does not match the static schema');
  }
}

function readyValue(type, value, path, errors) {
  if (type?.kind === 'builtin' && type.name === 'Bool' && typeof value !== 'boolean') issue(errors, path, 'value_type', 'must be Bool from source semantics');
  if (type?.kind === 'builtin' && type.name === 'Number' && (typeof value !== 'number' || !Number.isFinite(value))) issue(errors, path, 'value_type', 'must be finite Number from source semantics');
  if (type?.kind === 'builtin' && type.name === 'Duration' && (!Number.isSafeInteger(value) || value < 0)) issue(errors, path, 'value_type', 'must be a non-negative safe integer milliseconds Duration');
  if (type?.kind === 'nominal' && (value === null || !['boolean', 'number', 'string'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)))) {
    issue(errors, path, 'value_type', 'must be a finite JSON scalar for the declared nominal source type');
  }
}

function observation(value, type, index, errors) {
  const path = `snapshot.observations[${index}]`;
  if (!object(value)) {
    issue(errors, path, 'shape', 'must be an object');
    return;
  }
  if (!OBSERVATION_STATUS.has(value.status)) issue(errors, `${path}.status`, 'observation_status', 'must be ready, unavailable, or error; stale is a validated join result');
  const fields = value.status === 'ready' ? ['descriptorId', 'status', 'value']
    : value.status === 'unavailable' ? ['descriptorId', 'status', 'reason']
      : value.status === 'error' ? ['descriptorId', 'status', 'error']
        : ['descriptorId', 'status'];
  if (!exactObject(value, fields, path, errors)) return;
  publicId(value.descriptorId, `${path}.descriptorId`, errors);
  if (value.status === 'ready') readyValue(type, value.value, `${path}.value`, errors);
  if (value.status === 'unavailable' && (typeof value.reason !== 'string' || !value.reason)) issue(errors, `${path}.reason`, 'observation_reason', 'must be non-empty');
  if (value.status === 'error' && (typeof value.error !== 'string' || !value.error)) issue(errors, `${path}.error`, 'observation_error', 'must be non-empty');
}

function validateSnapshot(schema, snapshot, errors) {
  if (!exactObject(snapshot, ['format', 'version', 'schema', 'module', 'source', 'runId', 'completion', 'observations'], 'snapshot', errors)) return;
  if (snapshot.format !== RUNTIME_SNAPSHOT_FORMAT) issue(errors, 'snapshot.format', 'format', `must be ${RUNTIME_SNAPSHOT_FORMAT}`);
  if (snapshot.version !== RUNTIME_SNAPSHOT_VERSION) issue(errors, 'snapshot.version', 'version', `must be ${RUNTIME_SNAPSHOT_VERSION}`);
  if (exactObject(snapshot.schema, ['format', 'version', 'sha256'], 'snapshot.schema', errors)) {
    if (snapshot.schema.format !== schema.format) issue(errors, 'snapshot.schema.format', 'identity_mismatch', 'does not match the static schema');
    if (snapshot.schema.version !== schema.version) issue(errors, 'snapshot.schema.version', 'identity_mismatch', 'does not match the static schema');
    sha256(snapshot.schema.sha256, 'snapshot.schema.sha256', errors);
    if (snapshot.schema.sha256 !== interactionSchemaSha256(schema)) issue(errors, 'snapshot.schema.sha256', 'identity_mismatch', 'does not match the exact static schema digest');
  }
  identity(snapshot.module, 'snapshot.module', errors);
  identity(snapshot.source, 'snapshot.source', errors, { source: true });
  sameIdentity(snapshot.module, schema.module, 'snapshot.module', errors);
  sameIdentity(snapshot.source, schema.source, 'snapshot.source', errors);
  publicId(snapshot.runId, 'snapshot.runId', errors);
  if (exactObject(snapshot.completion, ['kind', 'scanId', 'logicalTimeMs'], 'snapshot.completion', errors)) {
    if (!['completed-scan', 'completed-tick'].includes(snapshot.completion.kind)) issue(errors, 'snapshot.completion.kind', 'completion', 'must be completed-scan or completed-tick');
    for (const key of ['scanId', 'logicalTimeMs']) if (!Number.isSafeInteger(snapshot.completion[key]) || snapshot.completion[key] < 0) issue(errors, `snapshot.completion.${key}`, 'completion', 'must be a non-negative safe integer');
  }
  if (!Array.isArray(snapshot.observations)) {
    issue(errors, 'snapshot.observations', 'observations', 'must be an array');
    return;
  }
  const types = new Map(schema.descriptors.map(entry => [entry.id, entry.sourceType]));
  const ids = new Set();
  snapshot.observations.forEach((entry, index) => {
    observation(entry, types.get(entry?.descriptorId), index, errors);
    if (!types.has(entry?.descriptorId)) issue(errors, `snapshot.observations[${index}].descriptorId`, 'unknown_descriptor', 'is absent from the static schema');
    if (ids.has(entry?.descriptorId)) issue(errors, `snapshot.observations[${index}].descriptorId`, 'duplicate_descriptor', 'must occur once');
    ids.add(entry?.descriptorId);
  });
  for (const descriptorId of types.keys()) if (!ids.has(descriptorId)) issue(errors, 'snapshot.observations', 'missing_observation', `must explicitly cover ${descriptorId}`);
}

function expectedJoin(schema, snapshot, expected) {
  if (!expected) return { status: 'ready', staleReasons: [] };
  const staleReasons = [];
  const compare = (actual, expectedValue, label) => {
    if (expectedValue !== undefined && actual !== expectedValue) staleReasons.push(label);
  };
  compare(interactionSchemaSha256(schema), expected.schemaSha256, 'schema.sha256');
  compare(snapshot.module.id, expected.moduleId, 'module.id');
  compare(snapshot.module.sha256, expected.moduleSha256, 'module.sha256');
  compare(snapshot.source.sha256, expected.sourceSha256, 'source.sha256');
  compare(snapshot.runId, expected.runId, 'runId');
  return { status: staleReasons.length ? 'stale' : 'ready', staleReasons };
}

/** SHA-256 of the canonical static schema document; this is distinct from its format version. */
export function interactionSchemaSha256(schema) {
  return createHash('sha256').update(canonicalJson(schema)).digest('hex');
}

/**
 * Validates a static schema plus one completed snapshot. `stale` is returned
 * only from an optional expected-identity join, never trusted from payload data.
 */
export function validateInteraction(schema, snapshot, { expected } = {}) {
  const errors = [];
  validateSchema(schema, errors);
  if (!errors.length) validateSnapshot(schema, snapshot, errors);
  return {
    valid: errors.length === 0,
    errors,
    join: errors.length ? { status: 'error', staleReasons: [] } : expectedJoin(schema, snapshot, expected),
  };
}
