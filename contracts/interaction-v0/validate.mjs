import { canonicalJson } from '../../tools/canonical-json.mjs';
import { sha256Hex } from '../../tools/sha256.mjs';

export const INTERACTION_SCHEMA_FORMAT = 'GhostFlow/interaction-schema-v0';
export const RUNTIME_SNAPSHOT_FORMAT = 'GhostFlow/runtime-snapshot-v0';
export const INTERACTION_SCHEMA_VERSION = '0.3';
export const RUNTIME_SNAPSHOT_VERSION = '0.1';
export const SETTINGS_INTERACTION_SCHEMA_VERSION = '0.4';
export const SETTINGS_RUNTIME_SNAPSHOT_VERSION = '0.2';

const PUBLIC_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const ENUM_MEMBER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MODULE_FINGERPRINT = /^[a-f0-9]{16}$/;
const BUILTIN_TYPES = new Map([
  ['Bool', null],
  ['Int', null],
  ['Number', null],
  ['Duration', 'ms'],
  ['Date', null],
  ['TimeOfDay', null],
  ['DateTime', null],
]);
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

function enumMemberName(value, path, errors) {
  if (typeof value !== 'string' || !ENUM_MEMBER_NAME.test(value) || value.startsWith('__gf_')) {
    issue(errors, path, 'enum_members', 'must be an authored enum identifier without the reserved __gf_ prefix');
  }
}

function sha256(value, path, errors) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    issue(errors, path, 'sha256', 'must be a lowercase SHA-256 digest');
    return false;
  }
  return true;
}

function moduleIdentity(value, path, errors) {
  if (!exactObject(value, ['id', 'moduleFingerprint', 'bytecodeSha256'], path, errors)) return;
  publicId(value.id, `${path}.id`, errors);
  if (typeof value.moduleFingerprint !== 'string' || !MODULE_FINGERPRINT.test(value.moduleFingerprint)) {
    issue(errors, `${path}.moduleFingerprint`, 'module_fingerprint', 'must be the lowercase 16-hex compiler moduleFingerprint');
  }
  sha256(value.bytecodeSha256, `${path}.bytecodeSha256`, errors);
}

function sourceIdentity(value, path, errors) {
  if (!exactObject(value, ['documentId', 'revisionId', 'format', 'kind', 'sha256'], path, errors)) return;
  publicId(value.documentId, `${path}.documentId`, errors);
  publicId(value.revisionId, `${path}.revisionId`, errors);
  if (value.format !== 'GhostFlow/source-document-v1') issue(errors, `${path}.format`, 'format', 'must be GhostFlow/source-document-v1');
  if (value.kind !== 'literate') issue(errors, `${path}.kind`, 'source_kind', 'must be literate in the canonical product contract');
  sha256(value.sha256, `${path}.sha256`, errors);
}

function sourceType(value, path, errors) {
  const fields = value?.kind === 'nominal' && Object.hasOwn(value, 'enumMembers')
    ? ['kind', 'name', 'unit', 'enumMembers'] : ['kind', 'name', 'unit'];
  if (!exactObject(value, fields, path, errors)) return;
  if (value.kind !== 'builtin' && value.kind !== 'nominal') issue(errors, `${path}.kind`, 'source_type', 'must be builtin or nominal');
  if (value.kind === 'builtin') {
    if (!BUILTIN_TYPES.has(value.name)) issue(errors, `${path}.name`, 'source_type', 'must be a supported builtin source type');
    else if (value.unit !== BUILTIN_TYPES.get(value.name)) issue(errors, `${path}.unit`, 'unit', `must be ${BUILTIN_TYPES.get(value.name) ?? 'null'} for ${value.name}`);
  } else {
    publicId(value.name, `${path}.name`, errors);
    if (value.unit !== null && (typeof value.unit !== 'string' || !value.unit)) issue(errors, `${path}.unit`, 'unit', 'must be null or a non-empty semantic unit');
    if (Object.hasOwn(value, 'enumMembers')) {
      if (value.unit !== null || !Array.isArray(value.enumMembers) || value.enumMembers.length === 0) {
        issue(errors, `${path}.enumMembers`, 'enum_members', 'must be a non-empty authored enum with no unit');
      } else {
        const names = new Set();
        value.enumMembers.forEach((member, index) => {
          const memberPath = `${path}.enumMembers[${index}]`;
          if (!exactObject(member, Object.hasOwn(member ?? {}, 'displayLabel')
            ? ['name', 'value', 'displayLabel'] : ['name', 'value'], memberPath, errors)) return;
          if (Object.hasOwn(member, 'displayLabel') && (typeof member.displayLabel !== 'string' || !member.displayLabel.trim())) {
            issue(errors, `${memberPath}.displayLabel`, 'enum_member_label', 'must be a non-empty plain-text string');
          }
          enumMemberName(member.name, `${memberPath}.name`, errors);
          if (names.has(member.name)) issue(errors, `${memberPath}.name`, 'duplicate_identity', 'enum member names must be unique');
          names.add(member.name);
          if (member.value !== index) issue(errors, `${memberPath}.value`, 'enum_members', 'enum member value must equal its declaration ordinal');
        });
      }
    }
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

function descriptor(value, index, errors, settingsProfile) {
  const path = `schema.descriptors[${index}]`;
  if (!object(value)) {
    issue(errors, path, 'shape', 'must be an object');
    return;
  }
  const fields = value.kind === 'timer'
    ? ['id', 'name', 'kind', 'sourceType', 'access', 'operation', 'provenance']
    : value.kind === 'setting'
      ? ['id', 'name', 'kind', 'sourceType', 'access', 'authority', 'applyPolicy', 'label', ...(settingsProfile ? ['defaultValue'] : []), 'constraint', 'provenance']
    : ['id', 'name', 'kind', 'sourceType', 'access', 'provenance'];
  if (!exactObject(value, fields, path, errors)) return;
  publicId(value.id, `${path}.id`, errors);
  publicId(value.name, `${path}.name`, errors);
  if (!['state', 'timer', 'counter', 'setting'].includes(value.kind)) issue(errors, `${path}.kind`, 'descriptor_kind', 'v0 supports state, timer, counter, and setting only');
  sourceType(value.sourceType, `${path}.sourceType`, errors);
  if (!Array.isArray(value.access) || value.access.length !== 1 || value.access[0] !== 'read') {
    issue(errors, `${path}.access`, 'access', 'must be exactly ["read"] for a v0 observation');
  }
  if (value.kind === 'timer') {
    const continuous = value.operation?.kind === 'continuous_true';
    const operationFields = continuous ? ['kind', 'subjectNodeId'] : ['kind', 'subjectId'];
    if (exactObject(value.operation, operationFields, `${path}.operation`, errors)) {
      if (continuous) {
        if (!Number.isInteger(value.operation.subjectNodeId) || value.operation.subjectNodeId < 1) {
          issue(errors, `${path}.operation.subjectNodeId`, 'timer_subject', 'must be a positive compiler source node ID');
        }
      } else {
        if (value.operation.kind !== 'elapsed_since_change') issue(errors, `${path}.operation.kind`, 'timer_operation', 'must be elapsed_since_change or continuous_true');
        publicId(value.operation.subjectId, `${path}.operation.subjectId`, errors);
      }
    }
    if (value.sourceType?.kind !== 'builtin' || value.sourceType?.name !== 'Duration' || value.sourceType?.unit !== 'ms') {
      issue(errors, `${path}.sourceType`, 'timer_type', 'must be builtin Duration in ms');
    }
  }
  if (value.kind === 'counter' && (value.sourceType?.kind !== 'builtin' || value.sourceType?.name !== 'Int' || value.sourceType?.unit !== null)) {
    issue(errors, `${path}.sourceType`, 'counter_type', 'must be builtin Int with no unit');
  }
  if (value.kind === 'setting') {
    if (settingsProfile) readyValue(value.sourceType, value.defaultValue, `${path}.defaultValue`, errors);
    if (!['operator', 'designer'].includes(value.authority)) issue(errors, `${path}.authority`, 'setting_authority', 'must be operator or designer');
    if (value.applyPolicy !== 'live') issue(errors, `${path}.applyPolicy`, 'setting_apply', 'must be live');
    if (typeof value.label !== 'string' || value.label.length < 1 || value.label.length > 128) issue(errors, `${path}.label`, 'setting_label', 'must be 1 to 128 characters');
    if (value.sourceType?.kind === 'builtin' && value.sourceType?.name === 'Bool') {
      if (!exactObject(value.constraint, ['kind', 'values'], `${path}.constraint`, errors)
          || value.constraint.kind !== 'choices' || JSON.stringify(value.constraint.values) !== '[false,true]') {
        issue(errors, `${path}.constraint`, 'setting_constraint', 'Bool setting choices must be [false,true]');
      }
    } else if (exactObject(value.constraint, ['kind', 'min', 'max', 'step'], `${path}.constraint`, errors)) {
      const { min, max, step } = value.constraint;
      if (value.constraint.kind !== 'range' || ![min, max, step].every(Number.isFinite) || step <= 0 || min > max) {
        issue(errors, `${path}.constraint`, 'setting_constraint', 'must be a finite ordered range with positive step');
      }
      if (value.sourceType?.kind === 'builtin' && value.sourceType.name === 'Int') {
        for (const field of ['min', 'max', 'step']) {
          const bound = value.constraint[field];
          if (!Number.isInteger(bound) || bound < -2147483648 || bound > 2147483647 || (field === 'step' && bound <= 0)) {
            issue(errors, `${path}.constraint.${field}`, 'setting_constraint', field === 'step' ? 'must be a positive signed i32 Int' : 'must be a signed i32 Int');
          }
        }
        if ([min, max, step].every(Number.isInteger) && step > 0 && (max - min) % step !== 0) {
          issue(errors, `${path}.constraint.max`, 'setting_constraint', 'must align to step from min');
        }
      }
    }
  }
  provenance(value.provenance, value.kind === 'counter' ? 'state' : value.kind === 'setting' ? 'config' : value.kind, `${path}.provenance`, errors);
}

function validateSchema(schema, errors) {
  if (!exactObject(schema, ['format', 'version', 'module', 'source', 'descriptors'], 'schema', errors)) return;
  if (schema.format !== INTERACTION_SCHEMA_FORMAT) issue(errors, 'schema.format', 'format', `must be ${INTERACTION_SCHEMA_FORMAT}`);
  moduleIdentity(schema.module, 'schema.module', errors);
  sourceIdentity(schema.source, 'schema.source', errors);
  if (!Array.isArray(schema.descriptors)) {
    issue(errors, 'schema.descriptors', 'descriptors', 'must be an array');
    return;
  }
  const ids = new Set();
  const names = new Set();
  schema.descriptors.forEach((entry, index) => {
    descriptor(entry, index, errors, schema.version === SETTINGS_INTERACTION_SCHEMA_VERSION);
    if (ids.has(entry?.id)) issue(errors, `schema.descriptors[${index}].id`, 'duplicate_identity', 'must be unique');
    if (names.has(entry?.name)) issue(errors, `schema.descriptors[${index}].name`, 'duplicate_identity', 'must be unique');
    ids.add(entry?.id); names.add(entry?.name);
  });
  const hasSettings = schema.descriptors.some(entry => entry?.kind === 'setting');
  if (schema.version !== INTERACTION_SCHEMA_VERSION && !(hasSettings && schema.version === SETTINGS_INTERACTION_SCHEMA_VERSION)) {
    issue(errors, 'schema.version', 'version', 'must be 0.3 or the explicit settings profile 0.4');
  }
  const descriptorsById = new Map(schema.descriptors.map(entry => [entry?.id, entry]));
  for (const entry of schema.descriptors) {
    if (entry?.kind !== 'timer') continue;
    if (entry.operation?.kind === 'continuous_true') continue;
    const subject = descriptorsById.get(entry.operation?.subjectId);
    if (!subject || subject.kind !== 'state') {
      issue(errors, `schema.descriptors.${entry.id}.operation.subjectId`, 'timer_subject', 'must resolve to an authored state descriptor');
    }
  }
}

function sameIdentity(actual, expected, path, errors) {
  for (const key of Object.keys(expected)) {
    if (actual?.[key] !== expected[key]) issue(errors, `${path}.${key}`, 'identity_mismatch', 'does not match the static schema');
  }
}

function readyValue(type, value, path, errors) {
  if (type?.kind === 'nominal' && Array.isArray(type.enumMembers)) {
    if (!Number.isSafeInteger(value) || !type.enumMembers.some(member => member?.value === value)) {
      issue(errors, path, 'value_type', 'must be a declared enum member ordinal');
    }
    return;
  }
  if (type?.kind === 'builtin' && type.name === 'Bool' && typeof value !== 'boolean') issue(errors, path, 'value_type', 'must be Bool from source semantics');
  if (type?.kind === 'builtin' && type.name === 'Int' && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)) issue(errors, path, 'value_type', 'must be a signed i32 Int from source semantics');
  if (type?.kind === 'builtin' && type.name === 'Number' && (typeof value !== 'number' || !Number.isFinite(value))) issue(errors, path, 'value_type', 'must be finite Number from source semantics');
  if (type?.kind === 'builtin' && type.name === 'Duration' && (!Number.isSafeInteger(value) || value < 0)) issue(errors, path, 'value_type', 'must be a non-negative safe integer milliseconds Duration');
  const timeMax = type?.name === 'Date' ? 2_932_896 : type?.name === 'TimeOfDay' ? 86_399_999 : type?.name === 'DateTime' ? 253_402_300_799_999 : null;
  if (type?.kind === 'builtin' && timeMax !== null && (!Number.isSafeInteger(value) || value < 0 || value > timeMax)) issue(errors, path, 'value_type', `must be an integer ${type.name} in range`);
  if (type?.kind === 'nominal' && (value === null || !['boolean', 'number', 'string'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)))) {
    issue(errors, path, 'value_type', 'must be a finite JSON scalar for the declared nominal source type');
  }
}

function observation(value, descriptorValue, index, errors, globalSettingsRevision, settingsProfile) {
  const path = `snapshot.observations[${index}]`;
  if (!object(value)) {
    issue(errors, path, 'shape', 'must be an object');
    return;
  }
  if (!OBSERVATION_STATUS.has(value.status)) issue(errors, `${path}.status`, 'observation_status', 'must be ready, unavailable, or error; stale is a validated join result');
  const settingReadyFields = settingsProfile && descriptorValue?.kind === 'setting'
    ? ['defaultValue', 'emissionRevision', 'applicationPosition', 'override'] : [];
  const settingErrorFields = settingsProfile && descriptorValue?.kind === 'setting'
    ? ['defaultValue', 'emissionRevision', 'applicationPosition'] : [];
  const fields = value.status === 'ready' ? ['descriptorId', ...settingReadyFields, 'status', 'value']
    : value.status === 'unavailable' ? ['descriptorId', 'status', 'reason']
      : value.status === 'error' ? ['descriptorId', ...settingErrorFields, 'status', 'error']
        : ['descriptorId', 'status'];
  if (!exactObject(value, fields, path, errors)) return;
  publicId(value.descriptorId, `${path}.descriptorId`, errors);
  if (value.status === 'ready') {
    readyValue(descriptorValue?.sourceType, value.value, `${path}.value`, errors);
    if (settingsProfile && descriptorValue?.kind === 'setting') {
      readyValue(descriptorValue.sourceType, value.defaultValue, `${path}.defaultValue`, errors);
      if (!Number.isSafeInteger(value.emissionRevision) || value.emissionRevision < 0 || value.emissionRevision > globalSettingsRevision) issue(errors, `${path}.emissionRevision`, 'settings_provenance', 'must be a non-negative safe integer not greater than the global settingsRevision');
      if (!(value.applicationPosition === null || Number.isSafeInteger(value.applicationPosition) && value.applicationPosition >= 0)) issue(errors, `${path}.applicationPosition`, 'settings_provenance', 'must be null or a non-negative safe integer');
      if (typeof value.override !== 'boolean' || value.override !== (value.emissionRevision !== 0)
          || (value.emissionRevision === 0) !== (value.applicationPosition === null)) issue(errors, `${path}.override`, 'settings_provenance', 'must match emission revision and application position');
      if (value.emissionRevision === 0 && value.value !== value.defaultValue) issue(errors, `${path}.value`, 'settings_provenance', 'initial setting value must equal defaultValue');
      if (value.defaultValue !== descriptorValue.defaultValue) issue(errors, `${path}.defaultValue`, 'settings_provenance', 'must equal the static source default');
    }
    if (descriptorValue?.kind === 'setting') {
      const constraint = descriptorValue.constraint;
      const misaligned = constraint?.kind === 'range' && (descriptorValue.sourceType?.name === 'Int'
        ? (value.value - constraint.min) % constraint.step !== 0
        : Math.abs((value.value - constraint.min) / constraint.step - Math.round((value.value - constraint.min) / constraint.step)) > 1e-9);
      if (constraint?.kind === 'range' && (typeof value.value !== 'number' || value.value < constraint.min || value.value > constraint.max
          || misaligned)) {
        issue(errors, `${path}.value`, 'setting_value', 'must satisfy the authored range and step');
      }
      if (constraint?.kind === 'choices' && !constraint.values?.includes(value.value)) issue(errors, `${path}.value`, 'setting_value', 'must be an authored choice');
    }
  }
  if (settingsProfile && value.status === 'error' && descriptorValue?.kind === 'setting') {
    if (!['SettingsInvalid', 'SettingsUnavailable'].includes(value.error)) issue(errors, `${path}.error`, 'settings_provenance', 'must be a current SettingsFault');
    readyValue(descriptorValue.sourceType, value.defaultValue, `${path}.defaultValue`, errors);
    if (!Number.isSafeInteger(value.emissionRevision) || value.emissionRevision < 0 || value.emissionRevision > globalSettingsRevision) issue(errors, `${path}.emissionRevision`, 'settings_provenance', 'must be a non-negative safe integer not greater than the global settingsRevision');
    if (!(value.applicationPosition === null || Number.isSafeInteger(value.applicationPosition) && value.applicationPosition >= 0)) issue(errors, `${path}.applicationPosition`, 'settings_provenance', 'must be null or a non-negative safe integer');
    if ((value.emissionRevision === 0) !== (value.applicationPosition === null)) issue(errors, `${path}.applicationPosition`, 'settings_provenance', 'must match emission revision');
    if (value.emissionRevision === 0) issue(errors, `${path}.emissionRevision`, 'settings_provenance', 'a fault requires an accepted emission');
    if (value.defaultValue !== descriptorValue.defaultValue) issue(errors, `${path}.defaultValue`, 'settings_provenance', 'must equal the static source default');
  }
  if (settingsProfile && value.status === 'unavailable' && descriptorValue?.kind === 'setting') issue(errors, `${path}.status`, 'settings_provenance', 'settings expose the current success or fault Result');
  if (value.status === 'unavailable' && (typeof value.reason !== 'string' || !value.reason)) issue(errors, `${path}.reason`, 'observation_reason', 'must be non-empty');
  if (value.status === 'error' && (typeof value.error !== 'string' || !value.error)) issue(errors, `${path}.error`, 'observation_error', 'must be non-empty');
}

function validateSnapshot(schema, snapshot, errors) {
  const hasSettings = schema.version === SETTINGS_INTERACTION_SCHEMA_VERSION;
  const snapshotFields = hasSettings
    ? ['format', 'version', 'schema', 'module', 'source', 'runId', 'completion', 'settingsRevision', 'observations']
    : ['format', 'version', 'schema', 'module', 'source', 'runId', 'completion', 'observations'];
  if (!exactObject(snapshot, snapshotFields, 'snapshot', errors)) return;
  if (snapshot.format !== RUNTIME_SNAPSHOT_FORMAT) issue(errors, 'snapshot.format', 'format', `must be ${RUNTIME_SNAPSHOT_FORMAT}`);
  const expectedSnapshotVersion = hasSettings ? SETTINGS_RUNTIME_SNAPSHOT_VERSION : RUNTIME_SNAPSHOT_VERSION;
  if (snapshot.version !== expectedSnapshotVersion) issue(errors, 'snapshot.version', 'version', `must be ${expectedSnapshotVersion} for ${hasSettings ? 'settings' : 'non-settings'} profile`);
  const globalSettingsRevision = hasSettings ? snapshot.settingsRevision : 0;
  if (hasSettings && (!Number.isSafeInteger(globalSettingsRevision) || globalSettingsRevision < 0)) issue(errors, 'snapshot.settingsRevision', 'settings_provenance', 'must be a non-negative safe integer');
  if (exactObject(snapshot.schema, ['format', 'version', 'sha256'], 'snapshot.schema', errors)) {
    if (snapshot.schema.format !== schema.format) issue(errors, 'snapshot.schema.format', 'identity_mismatch', 'does not match the static schema');
    if (snapshot.schema.version !== schema.version) issue(errors, 'snapshot.schema.version', 'identity_mismatch', 'does not match the static schema');
    sha256(snapshot.schema.sha256, 'snapshot.schema.sha256', errors);
    if (snapshot.schema.sha256 !== interactionSchemaSha256(schema)) issue(errors, 'snapshot.schema.sha256', 'identity_mismatch', 'does not match the exact static schema digest');
  }
  moduleIdentity(snapshot.module, 'snapshot.module', errors);
  sourceIdentity(snapshot.source, 'snapshot.source', errors);
  sameIdentity(snapshot.module, schema.module, 'snapshot.module', errors);
  sameIdentity(snapshot.source, schema.source, 'snapshot.source', errors);
  publicId(snapshot.runId, 'snapshot.runId', errors);
  if (exactObject(snapshot.completion, ['kind', 'scanId', 'logicalTimeMs'], 'snapshot.completion', errors)) {
    if (snapshot.completion.kind !== 'completed-scan') issue(errors, 'snapshot.completion.kind', 'completion', 'must be completed-scan in v0');
    for (const key of ['scanId', 'logicalTimeMs']) if (!Number.isSafeInteger(snapshot.completion[key]) || snapshot.completion[key] < 0) issue(errors, `snapshot.completion.${key}`, 'completion', 'must be a non-negative safe integer');
  }
  if (!Array.isArray(snapshot.observations)) {
    issue(errors, 'snapshot.observations', 'observations', 'must be an array');
    return;
  }
  const descriptors = new Map(schema.descriptors.map(entry => [entry.id, entry]));
  const ids = new Set();
  snapshot.observations.forEach((entry, index) => {
    observation(entry, descriptors.get(entry?.descriptorId), index, errors, globalSettingsRevision, hasSettings);
    if (!descriptors.has(entry?.descriptorId)) issue(errors, `snapshot.observations[${index}].descriptorId`, 'unknown_descriptor', 'is absent from the static schema');
    if (ids.has(entry?.descriptorId)) issue(errors, `snapshot.observations[${index}].descriptorId`, 'duplicate_descriptor', 'must occur once');
    ids.add(entry?.descriptorId);
  });
  for (const descriptorId of descriptors.keys()) if (!ids.has(descriptorId)) issue(errors, 'snapshot.observations', 'missing_observation', `must explicitly cover ${descriptorId}`);
  if (hasSettings) {
    const settings = snapshot.observations.filter(entry => descriptors.get(entry?.descriptorId)?.kind === 'setting');
    const positions = new Map();
    for (const entry of settings) {
      if (positions.has(entry.emissionRevision) && positions.get(entry.emissionRevision) !== entry.applicationPosition) {
        issue(errors, 'snapshot.observations', 'settings_provenance', 'one atomic emission must have one application position');
      }
      positions.set(entry.emissionRevision, entry.applicationPosition);
    }
    if (globalSettingsRevision > 0 && !settings.some(entry => entry.emissionRevision === globalSettingsRevision)) {
      issue(errors, 'snapshot.settingsRevision', 'settings_provenance', 'latest accepted revision must be represented by a setting');
    }
  }
}

function expectedJoin(schema, snapshot, expected) {
  if (!expected) return { status: 'ready', staleReasons: [] };
  const staleReasons = [];
  const compare = (actual, expectedValue, label) => {
    if (expectedValue !== undefined && actual !== expectedValue) staleReasons.push(label);
  };
  compare(snapshot.schema.format, expected.schemaFormat, 'schema.format');
  compare(snapshot.schema.version, expected.schemaVersion, 'schema.version');
  compare(interactionSchemaSha256(schema), expected.schemaSha256, 'schema.sha256');
  compare(snapshot.module.id, expected.moduleId, 'module.id');
  compare(snapshot.module.moduleFingerprint, expected.moduleFingerprint, 'module.moduleFingerprint');
  compare(snapshot.module.bytecodeSha256, expected.moduleBytecodeSha256, 'module.bytecodeSha256');
  compare(snapshot.source.documentId, expected.sourceDocumentId, 'source.documentId');
  compare(snapshot.source.revisionId, expected.sourceRevisionId, 'source.revisionId');
  compare(snapshot.source.sha256, expected.sourceSha256, 'source.sha256');
  compare(snapshot.runId, expected.runId, 'runId');
  return { status: staleReasons.length ? 'stale' : 'ready', staleReasons };
}

/** SHA-256 of strict canonical JSON bytes for the static schema, distinct from its format version. */
export function interactionSchemaSha256(schema) {
  return sha256Hex(canonicalJson(schema, {
    rejectSparseArrays: true,
    rejectUnsafeIntegers: true,
  }));
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
