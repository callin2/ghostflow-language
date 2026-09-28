import {
  interactionSchemaSha256,
  validateInteraction,
} from '../contracts/interaction-v0/validate.mjs';
import { verifyInteractionSchema } from './interaction-schema.mjs';
import { observeRuntimeValues } from './source-trace.mjs';

const EXPECTED_FIELDS = Object.freeze([
  'schemaFormat', 'schemaVersion', 'schemaSha256',
  'moduleId', 'moduleFingerprint', 'moduleBytecodeSha256',
  'sourceDocumentId', 'sourceRevisionId', 'sourceSha256', 'runId',
]);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, fields, label) {
  if (!object(value) || fields.some(field => !Object.hasOwn(value, field))
      || Object.keys(value).some(field => !fields.includes(field))) {
    throw new Error(`interaction runtime snapshot: ${label} has unknown or missing fields`);
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function freezeOwned(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeOwned);
    Object.freeze(value);
  }
  return value;
}

function runtimeSchema(compilation, suppliedSchema) {
  if (!compilation?.interactionSchema) {
    throw new Error('interaction runtime snapshot: an emitted Interaction Schema is required');
  }
  const schema = suppliedSchema ?? compilation.interactionSchema;
  // Reconstruct the schema from the exact compiled literate artifact before an
  // observation can leave the runtime boundary. This makes a stale/tampered
  // artifact a hard producer failure rather than a plausible-looking snapshot.
  const verified = verifyInteractionSchema(compilation, schema);
  if (!sameJson(schema, compilation.interactionSchema) || !sameJson(verified, compilation.interactionSchema)) {
    throw new Error('interaction runtime snapshot: schema does not match the compiled literate artifact');
  }
  return verified;
}

function typeMatches(type, value) {
  if (type?.kind === 'builtin' && type.name === 'Bool') return typeof value === 'boolean';
  if (type?.kind === 'builtin' && type.name === 'Int') return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
  if (type?.kind === 'builtin' && type.name === 'Number') return typeof value === 'number' && Number.isFinite(value);
  if (type?.kind === 'builtin' && type.name === 'Duration') return Number.isSafeInteger(value) && value >= 0;
  const timeMax = type?.name === 'Date' ? 2_932_896 : type?.name === 'TimeOfDay' ? 86_399_999 : type?.name === 'DateTime' ? 253_402_300_799_999 : null;
  if (type?.kind === 'builtin' && timeMax !== null) return Number.isSafeInteger(value) && value >= 0 && value <= timeMax;
  return type?.kind === 'nominal' && value !== null
    && (typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value));
}

function runtimeValueKey(value) {
  return `${value.kind}\u0000${value.name}`;
}

function stateMalformed(descriptor, trace) {
  if (descriptor.kind !== 'state' && descriptor.kind !== 'counter') return false;
  const stateAfter = trace?.stateAfter;
  if (!object(stateAfter) || !Object.hasOwn(stateAfter, descriptor.name)) return false;
  const value = stateAfter[descriptor.name];
  return !(typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value));
}

function timerClockMalformed(descriptor, trace) {
  if (descriptor.kind !== 'timer') return false;
  const value = trace?.inputs?.__gf_now_ms;
  return value !== undefined && (!Number.isSafeInteger(value) || value < 0);
}

function publicObservation(descriptor, values, trace, settings) {
  if (descriptor.kind === 'setting') {
    if (!settings.has(descriptor.name)) return { descriptorId: descriptor.id, status: 'unavailable', reason: 'runtime-value-unavailable' };
    const result = settings.get(descriptor.name);
    if (!result.ok) return { descriptorId: descriptor.id, status: 'error', error: result.fault };
    const value = result.value;
    return typeMatches(descriptor.sourceType, value)
      ? { descriptorId: descriptor.id, status: 'ready', value }
      : { descriptorId: descriptor.id, status: 'error', error: 'runtime-value-type-mismatch' };
  }
  const runtimeKind = descriptor.kind === 'counter' ? 'state' : descriptor.kind;
  const value = values.get(`${runtimeKind}\u0000${descriptor.name}`);
  if (value) {
    return typeMatches(descriptor.sourceType, value.value)
      ? { descriptorId: descriptor.id, status: 'ready', value: value.value }
      : { descriptorId: descriptor.id, status: 'error', error: 'runtime-value-type-mismatch' };
  }
  if ((descriptor.kind === 'state' || descriptor.kind === 'counter') && stateMalformed(descriptor, trace)) {
    return { descriptorId: descriptor.id, status: 'error', error: 'runtime-value-invalid' };
  }
  if (timerClockMalformed(descriptor, trace)) {
    return { descriptorId: descriptor.id, status: 'error', error: 'runtime-clock-invalid' };
  }
  return { descriptorId: descriptor.id, status: 'unavailable', reason: 'runtime-value-unavailable' };
}

/**
 * Builds the exact expected identity a consumer must join before accepting a
 * completed-scan snapshot. `runId` is intentionally separate from scanId:
 * restarting a control may reuse scan zero, but never this execution epoch.
 */
export function expectedRuntimeIdentity(schema, runId) {
  if (!object(schema) || !object(schema.module) || !object(schema.source)) {
    throw new Error('interaction runtime snapshot: schema identity is unavailable');
  }
  return Object.freeze({
    schemaFormat: schema.format,
    schemaVersion: schema.version,
    schemaSha256: interactionSchemaSha256(schema),
    moduleId: schema.module.id,
    moduleFingerprint: schema.module.moduleFingerprint,
    moduleBytecodeSha256: schema.module.bytecodeSha256,
    sourceDocumentId: schema.source.documentId,
    sourceRevisionId: schema.source.revisionId,
    sourceSha256: schema.source.sha256,
    runId,
  });
}

/** Validate and derive the consumer-only ready/stale join result. */
export function joinRuntimeSnapshot(schema, snapshot, expected) {
  exactObject(expected, EXPECTED_FIELDS, 'expected identity');
  const result = validateInteraction(schema, snapshot, { expected });
  if (!result.valid) throw new Error('interaction runtime snapshot: snapshot failed contract validation');
  return result.join;
}

/**
 * Projects one already-completed Rust/native/WASM trace to Interaction v0.
 * This function neither ticks nor reads a runtime; observation therefore cannot
 * alter state, requested outputs, or safety-filtered outputs.
 */
export function prepareCompletedScanSnapshot({ compilation, schema, runId } = {}) {
  // Own every verification input before verification. Never retain or freeze a
  // caller-owned artifact, schema, or typed byte buffer across scan calls.
  let owned = structuredClone({
    interactionSchema: compilation?.interactionSchema,
    sourceDocument: compilation?.sourceDocument,
    sourceMap: compilation?.sourceMap,
    traceMetadata: compilation?.traceMetadata,
    manifest: compilation?.manifest,
    bytes: compilation?.bytes,
  });
  const verifiedSchema = freezeOwned(runtimeSchema(owned, schema === undefined ? undefined : structuredClone(schema)));
  if (typeof runId !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(runId) || runId.startsWith('__gf_')) {
    throw new Error('interaction runtime snapshot: runId must be a public execution epoch');
  }
  const traceMetadata = freezeOwned(owned.traceMetadata);
  const configs = freezeOwned(owned.manifest?.configs ?? []);
  const expected = expectedRuntimeIdentity(verifiedSchema, runId);
  const hasTimer = verifiedSchema.descriptors.some(descriptor => descriptor.kind === 'timer');
  // Byte buffers and canonical source are verification-only, not closure state.
  owned = null;
  return Object.freeze({
    schema: verifiedSchema,
    expected,
    emit: ({ completion, trace, settingsState } = {}) => emitVerifiedSnapshot({
      verifiedSchema, traceMetadata, configs, expected, hasTimer, completion, trace, settingsState,
    }),
  });
}

/** One-shot callers use the same owned and verified producer path. */
export function emitCompletedScanSnapshot({ compilation, schema, runId, completion, trace, settingsState } = {}) {
  return prepareCompletedScanSnapshot({ compilation, schema, runId }).emit({ completion, trace, settingsState });
}

function emitVerifiedSnapshot({ verifiedSchema, traceMetadata, configs, expected, hasTimer, completion, trace, settingsState }) {
  exactObject(completion, ['kind', 'scanId', 'logicalTimeMs'], 'completion');
  if (completion.kind !== 'completed-scan' || !Number.isSafeInteger(completion.scanId) || completion.scanId < 0
      || !Number.isSafeInteger(completion.logicalTimeMs) || completion.logicalTimeMs < 0) {
    throw new Error('interaction runtime snapshot: completion must be one non-negative completed scan');
  }
  const hasTraceClock = object(trace?.inputs) && Object.hasOwn(trace.inputs, '__gf_now_ms');
  if ((hasTimer || hasTraceClock) && trace?.inputs?.__gf_now_ms !== completion.logicalTimeMs) {
    throw new Error('interaction runtime snapshot: completed trace clock does not match completion');
  }

  let observed;
  try {
    observed = observeRuntimeValues(traceMetadata, trace);
  } catch {
    // The source-trace adapter may inspect generated timer slots internally;
    // do not expose those implementation names through this public boundary.
    throw new Error('interaction runtime snapshot: runtime observation could not be verified');
  }
  const values = new Map(observed.values.map(value => [runtimeValueKey(value), value]));
  const settings = new Map();
  if (configs.length) {
    if (!object(settingsState) || settingsState.programFingerprint !== traceMetadata.moduleFingerprint
        || !Number.isSafeInteger(settingsState.settingsRevision) || settingsState.settingsRevision < 0
        || !Array.isArray(settingsState.settings) || settingsState.settings.length !== configs.length) {
      throw new Error('interaction runtime snapshot: current Rust settings state is required');
    }
    const declared = new Map(configs.map(config => [config.id, config]));
    for (const item of settingsState.settings) {
      const config = declared.get(item?.id), result = item?.result;
      if (!config || item.name !== config.name || item.type !== config.type || settings.has(item.name)
          || !object(result) || typeof result.ok !== 'boolean'
          || result.ok && !Object.hasOwn(result, 'value')
          || !result.ok && !['SettingsInvalid','SettingsUnavailable'].includes(result.fault)) {
        throw new Error('interaction runtime snapshot: settings state identity or Result mismatch');
      }
      settings.set(item.name, result);
    }
  } else if (settingsState !== undefined) {
    throw new Error('interaction runtime snapshot: unexpected settings state');
  }
  const snapshot = {
    format: 'GhostFlow/runtime-snapshot-v0',
    version: '0.1',
    schema: {
      format: verifiedSchema.format,
      version: verifiedSchema.version,
      sha256: expected.schemaSha256,
    },
    module: { ...verifiedSchema.module },
    source: { ...verifiedSchema.source },
    runId: expected.runId,
    completion: { ...completion },
    observations: verifiedSchema.descriptors.map(descriptor => publicObservation(descriptor, values, trace, settings)),
  };
  const validated = validateInteraction(verifiedSchema, snapshot);
  if (!validated.valid) throw new Error('interaction runtime snapshot: produced snapshot failed contract validation');
  if (JSON.stringify(snapshot).includes('__gf_')) {
    throw new Error('interaction runtime snapshot: generated storage cannot be public');
  }
  return Object.freeze(snapshot);
}
