import { createHash } from 'node:crypto';
import {
  INTERACTION_SCHEMA_FORMAT,
  INTERACTION_SCHEMA_VERSION,
  RUNTIME_SNAPSHOT_FORMAT,
  RUNTIME_SNAPSHOT_VERSION,
  interactionSchemaSha256,
  validateInteraction,
} from '../contracts/interaction-v0/validate.mjs';
import { extractLiterate } from './literate.mjs';
import { compileControl, parseControl } from './control.mjs';

const PUBLIC_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_FORMAT = 'GhostFlow/source-document-v1';

function fail(message) {
  throw new Error(`interaction schema: ${message}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function publicId(value, label) {
  if (typeof value !== 'string' || !PUBLIC_ID.test(value) || value.startsWith('__gf_')) {
    fail(`${label} must be an explicit public immutable identity`);
  }
  return value;
}

function sourceIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 2
      || !Object.hasOwn(value, 'documentId') || !Object.hasOwn(value, 'revisionId')) {
    fail('source identity must contain exactly documentId and revisionId');
  }
  return {
    documentId: publicId(value.documentId, 'source identity documentId'),
    revisionId: publicId(value.revisionId, 'source identity revisionId'),
  };
}

function canonicalDocument(document) {
  if (!document || typeof document !== 'object' || document.format !== SOURCE_FORMAT
      || document.kind !== 'literate' || typeof document.text !== 'string'
      || typeof document.filename !== 'string' || !SHA256.test(document.sha256)
      || sha256(document.text) !== document.sha256) {
    fail('a product Interaction Schema requires an intact canonical literate source document');
  }
  return document;
}

function sourceType(name) {
  if (name === 'Bool' || name === 'Number') return { kind: 'builtin', name, unit: null };
  if (name === 'Duration') return { kind: 'builtin', name, unit: 'ms' };
  return { kind: 'nominal', name, unit: name === 'Percent' ? 'percent' : null };
}

function validationSnapshot(schema) {
  const valueFor = type => {
    if (type.kind === 'builtin' && type.name === 'Bool') return false;
    return 0;
  };
  return {
    format: RUNTIME_SNAPSHOT_FORMAT,
    version: RUNTIME_SNAPSHOT_VERSION,
    schema: { format: schema.format, version: schema.version, sha256: '0'.repeat(64) },
    module: { ...schema.module },
    source: { ...schema.source },
    runId: 'schema-validation',
    completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 },
    observations: schema.descriptors.map(descriptor => ({
      descriptorId: descriptor.id, status: 'ready', value: valueFor(descriptor.sourceType),
    })),
  };
}

function assertContractSchema(schema) {
  const snapshot = validationSnapshot(schema);
  // The exact digest joins static and dynamic documents; calculate it using
  // the contract validator rather than maintaining a local JSON variant.
  snapshot.schema.sha256 = interactionSchemaSha256(schema);
  const result = validateInteraction(schema, snapshot);
  if (!result.valid) fail(`does not satisfy interaction-v0: ${result.errors[0]?.path} ${result.errors[0]?.message}`);
}

function expectedSchema(compilation, identityValue) {
  const source = canonicalDocument(compilation?.sourceDocument);
  const identity = sourceIdentity(identityValue);
  const manifest = compilation?.manifest;
  const trace = compilation?.traceMetadata;
  if (!manifest || typeof manifest.name !== 'string' || !trace || typeof trace.moduleFingerprint !== 'string') {
    fail('compiler result lacks product control manifest or source trace metadata');
  }
  if (!SHA256.test(manifest.bytecodeSha256) || manifest.bytecodeSha256 !== sha256(compilation.bytes)) {
    fail('compiler result bytecode identity is invalid');
  }
  const extraction = extractLiterate(source.text, { filename: source.filename });
  const ast = parseControl(extraction.code, { filename: source.filename });
  const nodeById = new Map((compilation.sourceMap ?? []).map(node => [node?.id, node]));
  const linksByNode = new Map();
  for (const link of trace.intentLinks ?? []) {
    if (!link || !PUBLIC_ID.test(link.anchorId) || link.anchorId.startsWith('__gf_')) continue;
    const key = `${link.nodeId}\u0000${link.nodeKind}`;
    const anchors = linksByNode.get(key) ?? [];
    if (!anchors.includes(link.anchorId)) anchors.push(link.anchorId);
    linksByNode.set(key, anchors);
  }
  const declaredStates = new Map();
  for (const item of ast.body) if (item.kind === 'state') declaredStates.set(item.name, item.type.name);
  const descriptors = [];
  for (const item of ast.body) {
    if (item.kind !== 'state' && item.kind !== 'timer') continue;
    const node = nodeById.get(item.id);
    if (!node || node.kind !== item.kind) fail(`compiler source node is missing for ${item.kind}.${item.name}`);
    const anchors = linksByNode.get(`${item.id}\u0000${item.kind}`);
    if (!anchors?.length) fail(`${item.kind}.${item.name} has no literate intent-anchor provenance`);
    if (item.kind === 'state') {
      descriptors.push({
        id: `state.${item.name}`, name: item.name, kind: 'state', sourceType: sourceType(item.type.name), access: ['read'],
        provenance: { sourceNode: { id: item.id, kind: 'state' }, intentAnchorIds: anchors },
      });
      continue;
    }
    const subject = item.call?.args?.[0]?.name;
    if (declaredStates.get(subject) !== 'Bool') fail(`timer.${item.name} must target an authored Bool state`);
    descriptors.push({
      id: `timer.${item.name}`, name: item.name, kind: 'timer', sourceType: sourceType('Duration'), access: ['read'],
      operation: { kind: 'elapsed_since_change', subjectId: `state.${subject}` },
      provenance: { sourceNode: { id: item.id, kind: 'timer' }, intentAnchorIds: anchors },
    });
  }
  if (!descriptors.length) fail('control has no public state or timer descriptors');
  const schema = {
    format: INTERACTION_SCHEMA_FORMAT,
    version: INTERACTION_SCHEMA_VERSION,
    module: { id: manifest.name, moduleFingerprint: trace.moduleFingerprint, bytecodeSha256: manifest.bytecodeSha256 },
    source: { ...identity, format: SOURCE_FORMAT, kind: 'literate', sha256: source.sha256 },
    descriptors,
  };
  assertContractSchema(schema);
  return schema;
}

/** Emit a v0 schema only from an already type-checked canonical literate compilation. */
export function emitInteractionSchema(compilation, sourceIdentityValue) {
  return expectedSchema(compilation, sourceIdentityValue);
}

/** Verify a persisted schema by reconstructing it from the exact source and compiler metadata. */
export function verifyInteractionSchema(compilation, schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) fail('schema must be an object');
  const expected = expectedSchema(compilation, {
    documentId: schema.source?.documentId,
    revisionId: schema.source?.revisionId,
  });
  if (JSON.stringify(schema) !== JSON.stringify(expected)) fail('schema does not match compiler provenance, source identity, or canonical source');
  return expected;
}

/** Recompile the literate envelope before accepting its persisted interaction schema. */
export function restoreInteractionSchema({ sourceDocument, sourceMap, traceMetadata, bytes }, schema) {
  const source = canonicalDocument(sourceDocument);
  const extraction = extractLiterate(source.text, { filename: source.filename });
  const replay = compileControl(extraction.code, { filename: source.filename });
  const replayBytes = Buffer.from(replay.bytes);
  if (!Buffer.from(bytes).equals(replayBytes)) fail('bytecode does not match canonical literate source replay');
  const manifest = { ...replay.manifest, bytecodeSha256: sha256(replayBytes) };
  return verifyInteractionSchema({
    bytes: replayBytes,
    manifest,
    sourceDocument: source,
    sourceMap,
    traceMetadata,
  }, schema);
}
