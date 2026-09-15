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
  if (type?.kind === 'builtin' && type.name === 'Number') return typeof value === 'number' && Number.isFinite(value);
  if (type?.kind === 'builtin' && type.name === 'Duration') return Number.isSafeInteger(value) && value >= 0;
  return type?.kind === 'nominal' && value !== null
    && (typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value));
}

function runtimeValueKey(value) {
  return `${value.kind}\u0000${value.name}`;
}

function stateMalformed(descriptor, trace) {
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

function publicObservation(descriptor, values, trace) {
  const value = values.get(`${descriptor.kind}\u0000${descriptor.name}`);
  if (value) {
    return typeMatches(descriptor.sourceType, value.value)
      ? { descriptorId: descriptor.id, status: 'ready', value: value.value }
      : { descriptorId: descriptor.id, status: 'error', error: 'runtime-value-type-mismatch' };
  }
  if (descriptor.kind === 'state' && stateMalformed(descriptor, trace)) {
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
export function emitCompletedScanSnapshot({ compilation, schema, runId, completion, trace } = {}) {
  const verifiedSchema = runtimeSchema(compilation, schema);
  exactObject(completion, ['kind', 'scanId', 'logicalTimeMs'], 'completion');
  if (completion.kind !== 'completed-scan' || !Number.isSafeInteger(completion.scanId) || completion.scanId < 0
      || !Number.isSafeInteger(completion.logicalTimeMs) || completion.logicalTimeMs < 0) {
    throw new Error('interaction runtime snapshot: completion must be one non-negative completed scan');
  }
  if (trace?.inputs?.__gf_now_ms !== completion.logicalTimeMs) {
    throw new Error('interaction runtime snapshot: completed trace clock does not match completion');
  }

  let observed;
  try {
    observed = observeRuntimeValues(compilation.traceMetadata, trace);
  } catch {
    // The source-trace adapter may inspect generated timer slots internally;
    // do not expose those implementation names through this public boundary.
    throw new Error('interaction runtime snapshot: runtime observation could not be verified');
  }
  const values = new Map(observed.values.map(value => [runtimeValueKey(value), value]));
  const snapshot = {
    format: 'GhostFlow/runtime-snapshot-v0',
    version: '0.1',
    schema: {
      format: verifiedSchema.format,
      version: verifiedSchema.version,
      sha256: interactionSchemaSha256(verifiedSchema),
    },
    module: { ...verifiedSchema.module },
    source: { ...verifiedSchema.source },
    runId,
    completion: { ...completion },
    observations: verifiedSchema.descriptors.map(descriptor => publicObservation(descriptor, values, trace)),
  };
  const validated = validateInteraction(verifiedSchema, snapshot);
  if (!validated.valid) throw new Error('interaction runtime snapshot: produced snapshot failed contract validation');
  if (JSON.stringify(snapshot).includes('__gf_')) {
    throw new Error('interaction runtime snapshot: generated storage cannot be public');
  }
  return Object.freeze(snapshot);
}
