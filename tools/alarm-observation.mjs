import { restoreInteractionSchema } from './interaction-schema.mjs';
import { interactionSchemaSha256 } from '../contracts/interaction-v0/validate.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { sha256Hex } from './sha256.mjs';

export const ALARM_DESCRIPTOR_FORMAT = 'GhostFlow/alarm-descriptor-v1';
export const ALARM_REPORT_FORMAT = 'GhostFlow/alarm-report-v1';
const fail = message => { throw new Error(`alarm observation: ${message}`); };
const canonical = value => canonicalJson(value, { rejectSparseArrays: true, rejectUnsafeIntegers: true });
function exact(value, keys, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) fail(`${label} has unknown or missing fields`);
}
function publicId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(value) || value.startsWith('__gf_')) fail('invalid public identity');
}
function prose(value) { if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).length > 512) fail('meaning text must contain 1..512 UTF-8 bytes'); }
function frozen(value) { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }
class Writer {
  parts = [];
  bytes(value) { this.parts.push(Uint8Array.from(value)); }
  u8(value) { this.bytes([value]); }
  number(value, size) { const bytes = new Uint8Array(size), view = new DataView(bytes.buffer); if (size === 2) view.setUint16(0, value, true); else if (size === 4) view.setUint32(0, value, true); else view.setBigUint64(0, BigInt(value), true); this.bytes(bytes); }
  text(value) { const bytes = new TextEncoder().encode(value); if (!bytes.length || bytes.length > 512) fail('wire text bound'); this.number(bytes.length, 2); this.bytes(bytes); }
  finish() { const bytes = new Uint8Array(this.parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of this.parts) { bytes.set(part, at); at += part.length; } return bytes; }
}

/** Serialized descriptors are accepted only in strict canonical form, rejecting duplicate keys. */
export function parseAlarmDescriptor(text) {
  const value = JSON.parse(text);
  if (canonical(value) !== text) fail('descriptor JSON must be canonical with no duplicate keys');
  return value;
}

/** Source replay validates provenance; metadata maps an existing Bool state and contains no expressions. */
export function prepareAlarmObservation(compilation, descriptor) {
  descriptor = JSON.parse(canonical(descriptor));
  const schema = restoreInteractionSchema(compilation, compilation.interactionSchema);
  if (schema.version !== '0.3' || compilation.sourceClosure) fail('alarm v1 requires the standalone authored-state schema 0.3');
  const format = new DataView(compilation.bytes.buffer, compilation.bytes.byteOffset).getUint16(4, true);
  if (![1, 2, 3, 4].includes(format)) fail('alarm v1 requires the scalar scan profile');
  exact(descriptor, ['format', 'version', 'schema', 'module', 'source', 'retention', 'alarms'], 'descriptor');
  if (descriptor.format !== ALARM_DESCRIPTOR_FORMAT || descriptor.version !== 1) fail('unsupported alarm descriptor format');
  const schemaIdentity = { format: schema.format, version: schema.version, sha256: interactionSchemaSha256(schema) };
  for (const [key, expected] of [['schema', schemaIdentity], ['module', schema.module], ['source', schema.source]]) {
    if (canonical(descriptor[key]) !== canonical(expected)) fail(`${key} identity mismatch`);
  }
  exact(descriptor.retention, ['capacity', 'policy'], 'retention');
  if (!Number.isInteger(descriptor.retention.capacity) || descriptor.retention.capacity < 1 || descriptor.retention.capacity > 1024
    || descriptor.retention.policy !== 'drop-oldest-report-gap') fail('retention requires capacity 1..1024 and drop-oldest-report-gap');
  if (!Array.isArray(descriptor.alarms) || descriptor.alarms.length < 1 || descriptor.alarms.length > 16) fail('alarm count must be 1..16');
  const ids = new Set(), slots = new Set();
  const alarms = descriptor.alarms.map(alarm => {
    exact(alarm, ['id', 'kind', 'condition', 'severity', 'meaning', 'provenance'], 'alarm');
    publicId(alarm.id); if (alarm.kind !== 'alarm' || ids.has(alarm.id)) fail('invalid or duplicate alarm ID'); ids.add(alarm.id);
    exact(alarm.condition, ['descriptorId', 'activeWhen'], 'condition');
    const state = schema.descriptors.find(state => state.id === alarm.condition.descriptorId);
    if (!state || state.kind !== 'state' || state.sourceType.kind !== 'builtin' || state.sourceType.name !== 'Bool'
      || alarm.condition.activeWhen !== true || slots.has(state.name)) fail('condition must explicitly map one unique authored Bool state, activeWhen=true');
    slots.add(state.name);
    exact(alarm.severity, ['code', 'meaning'], 'severity'); publicId(alarm.severity.code); prose(alarm.severity.meaning);
    exact(alarm.meaning, ['raised', 'cleared'], 'meaning'); prose(alarm.meaning.raised); prose(alarm.meaning.cleared);
    exact(alarm.provenance, ['sourceNodeId', 'intentAnchorIds'], 'provenance');
    if (!Number.isInteger(alarm.provenance.sourceNodeId) || alarm.provenance.sourceNodeId < 0 || alarm.provenance.sourceNodeId > 0xffffffff
      || !Array.isArray(alarm.provenance.intentAnchorIds) || alarm.provenance.intentAnchorIds.length < 1 || alarm.provenance.intentAnchorIds.length > 32
      || alarm.provenance.sourceNodeId !== state.provenance.sourceNode.id
      || canonical(alarm.provenance.intentAnchorIds) !== canonical(state.provenance.intentAnchorIds)) fail('source node or intent anchors mismatch');
    return { ...alarm, stateName: state.name };
  });
  const owned = frozen(descriptor);
  return Object.freeze({ descriptor: owned, descriptorSha256: sha256Hex(canonical(owned)),
    bind({ runId, streamId }) {
      publicId(runId); publicId(streamId);
      const writer = new Writer(); writer.bytes(new TextEncoder().encode('GFAL')); writer.number(1, 2);
      for (const value of [owned.module.bytecodeSha256, owned.module.moduleFingerprint, owned.module.id,
        owned.source.sha256, owned.source.documentId, owned.source.revisionId, owned.schema.sha256,
        sha256Hex(canonical(owned)), runId, streamId]) writer.text(value);
      writer.number(owned.retention.capacity, 2); writer.number(alarms.length, 2);
      for (const alarm of alarms) {
        for (const value of [alarm.id, alarm.stateName]) writer.text(value);
        writer.number(alarm.provenance.sourceNodeId, 4); writer.number(alarm.provenance.intentAnchorIds.length, 2);
        for (const anchor of alarm.provenance.intentAnchorIds) writer.text(anchor);
      }
      const bytes = writer.finish();
      return { bytes, sha256: sha256Hex(bytes), runId, streamId };
    } });
}

export function encodeAlarmQuery({ sha256, runId, streamId }, afterSequence = null) {
  if (afterSequence !== null && (!Number.isSafeInteger(afterSequence) || afterSequence < 0)) fail('cursor sequence must be null or a nonnegative safe integer');
  const writer = new Writer(); writer.bytes(new TextEncoder().encode('GFAQ')); writer.number(1, 2);
  writer.text(sha256); writer.text(runId); writer.text(streamId); writer.u8(afterSequence === null ? 0 : 1);
  if (afterSequence !== null) writer.number(afterSequence, 8);
  return writer.finish();
}
