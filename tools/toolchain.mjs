import fs from 'node:fs';
import path from 'node:path';
import { restoreInteractionSchema } from './interaction-schema.mjs';
import { sourceMapRequiresTraceMetadata, verifySourceTraceMetadata } from './source-trace.mjs';
import { compileSource as compileCanonicalSource, emitInteractionSchema } from './compile-source.mjs';
import { isWellFormedUnicode, sha256Hex, utf8ByteLength } from './sha256.mjs';

export { emitInteractionSchema };

const SOURCE_LIMIT = 1024 * 1024;
const SOURCE_DOCUMENT_FORMAT = 'GhostFlow/source-document-v1';
const SOURCE_MAP_FORMAT = 'GhostFlow/source-map-v1';
const SHA256 = /^[0-9a-f]{64}$/;

/** Node artifact wrapper; browser callers import browser-toolchain.mjs. */
export async function compileSource(source, options = {}) {
  const result = await compileCanonicalSource(source, options);
  return { ...result, bytes: Buffer.from(result.bytes) };
}

function requireSourceText(text, label = 'source text') {
  if (!isWellFormedUnicode(text)) throw new Error(`${label} must be a well-formed UTF-8 string`);
  if (utf8ByteLength(text) > SOURCE_LIMIT) throw new Error(`${label} byte limit exceeded`);
}

function requireFilename(filename, label = 'source filename') {
  if (!isWellFormedUnicode(filename) || filename.length === 0 || filename.includes('\0')) {
    throw new Error(`${label} must be a non-empty well-formed UTF-8 string`);
  }
}

function requireDigest(digest, label) {
  if (typeof digest !== 'string' || !SHA256.test(digest)) {
    throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
  }
}

function requireBytes(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  throw new Error('artifact bytes must be a Buffer or Uint8Array');
}

function sourceMapEnvelope(result, bytes) {
  return {
    format: SOURCE_MAP_FORMAT,
    bytecodeSha256: sha256Hex(bytes),
    sourceDocument: result.sourceDocument,
    nodes: result.sourceMap,
    lines: result.extractionMap ?? null,
    traceMetadata: result.traceMetadata ?? null,
    interactionSchema: result.interactionSchema ?? null,
    interactionSourceIdentity: result.interactionSourceIdentity ?? null,
  };
}

function validateArtifactSourceMap(map, bytes, { expectedSourceSha256, requireTraceMetadata = false } = {}) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('source map must be an object');
  if (map.format !== SOURCE_MAP_FORMAT) throw new Error(`unsupported source map format ${String(map.format)}`);
  if (!Array.isArray(map.nodes)) throw new Error('source map nodes must be an array');
  if (map.lines !== null && !Array.isArray(map.lines)) throw new Error('source map lines must be an array or null');
  requireDigest(map.bytecodeSha256, 'source map bytecodeSha256');

  const document = map.sourceDocument;
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('source map sourceDocument must be an object');
  if (document.format !== SOURCE_DOCUMENT_FORMAT) throw new Error(`unsupported source document format ${String(document.format)}`);
  if (document.kind !== 'literate') throw new Error('source document kind must be canonical literate');
  requireFilename(document.filename);
  requireSourceText(document.text);
  requireDigest(document.sha256, 'source document sha256');
  if (sha256Hex(document.text) !== document.sha256) throw new Error('source document SHA-256 does not match text');

  const artifactBytes = requireBytes(bytes);
  if (sha256Hex(artifactBytes) !== map.bytecodeSha256) throw new Error('source map bytecode SHA-256 does not match artifact');
  if (expectedSourceSha256 !== undefined) {
    requireDigest(expectedSourceSha256, 'expected source SHA-256');
    if (document.sha256 !== expectedSourceSha256) throw new Error('source document SHA-256 does not match expected revision');
  }

  const hasTraceMetadata = Object.hasOwn(map, 'traceMetadata');
  if (hasTraceMetadata && map.traceMetadata !== null) {
    verifySourceTraceMetadata(map.traceMetadata, artifactBytes, map.nodes, {
      sourceDocumentSha256: document.sha256,
      bytecodeSha256: map.bytecodeSha256,
      requireRevisionIdentity: true,
      sourceDocument: document,
      extractionMap: map.lines,
    });
  } else if (sourceMapRequiresTraceMetadata(map.nodes) && (hasTraceMetadata || requireTraceMetadata)) {
    throw new Error('source map trace metadata is missing for a traceable control');
  }
  const hasInteractionSchema = Object.hasOwn(map, 'interactionSchema') && map.interactionSchema !== null;
  const hasInteractionIdentity = Object.hasOwn(map, 'interactionSourceIdentity') && map.interactionSourceIdentity !== null;
  if (hasInteractionSchema !== hasInteractionIdentity) {
    throw new Error('interaction schema and explicit source identity must be persisted together');
  }
  let interactionSchema = null;
  let interactionSourceIdentity = null;
  if (hasInteractionSchema) {
    const identity = map.interactionSourceIdentity;
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)
        || Object.keys(identity).length !== 2
        || typeof identity.documentId !== 'string' || typeof identity.revisionId !== 'string'
        || map.interactionSchema.source?.documentId !== identity.documentId
        || map.interactionSchema.source?.revisionId !== identity.revisionId) {
      throw new Error('interaction schema source identity does not match its persisted immutable identity');
    }
    interactionSchema = restoreInteractionSchema({
      sourceDocument: document,
      sourceMap: map.nodes,
      traceMetadata: hasTraceMetadata ? map.traceMetadata : null,
      bytes: artifactBytes,
    }, map.interactionSchema);
    interactionSourceIdentity = { documentId: identity.documentId, revisionId: identity.revisionId };
  }
  return { document, traceMetadata: hasTraceMetadata ? map.traceMetadata : null, interactionSchema, interactionSourceIdentity };
}

export function verifyArtifactSourceMap(map, bytes, options = {}) {
  return validateArtifactSourceMap(map, bytes, options).document;
}

/** Restore only a source/trace pair proven to belong to these exact source and bytecode revisions. */
export function restoreArtifactSourceMap(map, bytes, options = {}) {
  const restored = validateArtifactSourceMap(map, bytes, { ...options, requireTraceMetadata: true });
  return {
    sourceDocument: restored.document,
    sourceMap: map.nodes,
    extractionMap: map.lines,
    traceMetadata: restored.traceMetadata,
    interactionSchema: restored.interactionSchema,
    interactionSourceIdentity: restored.interactionSourceIdentity,
  };
}

export function writeArtifact(result, outputPath) {
  const bytes = requireBytes(result?.bytes);
  const envelope = Object.hasOwn(result, 'sourceDocument') ? sourceMapEnvelope(result, bytes) : null;
  if (envelope) {
    verifyArtifactSourceMap(envelope, bytes);
    if (result.manifest) {
      requireDigest(result.manifest.bytecodeSha256, 'manifest bytecodeSha256');
      if (result.manifest.bytecodeSha256 !== envelope.bytecodeSha256) throw new Error('manifest bytecode SHA-256 does not match artifact');
    }
  }
  // Finish validation and serialization before replacing any existing file.
  const manifestJson = result.manifest ? JSON.stringify(result.manifest, null, 2) + '\n' : null;
  const mapJson = result.manifest || envelope
    ? JSON.stringify(envelope ?? { nodes: result.sourceMap, lines: result.extractionMap }, null, 2) + '\n'
    : null;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, bytes);
  if (manifestJson !== null) {
    fs.writeFileSync(`${outputPath}.manifest.json`, manifestJson);
  }
  if (mapJson !== null) {
    fs.writeFileSync(`${outputPath}.map.json`, mapJson);
  }
}
