import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compile, parse, tokenize } from './gfb1.mjs';
import { attachIntentMetadata, remapSourceTrace, sourceMapRequiresTraceMetadata, verifySourceTraceMetadata } from './source-trace.mjs';

const SOURCE_LIMIT = 1024 * 1024;
const SOURCE_DOCUMENT_FORMAT = 'GhostFlow/source-document-v1';
const SOURCE_MAP_FORMAT = 'GhostFlow/source-map-v1';
const SHA256 = /^[0-9a-f]{64}$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isLosslessUtf8(value) {
  if (typeof value !== 'string') return false;
  if (typeof value.isWellFormed === 'function') return value.isWellFormed();
  return Buffer.from(value, 'utf8').toString('utf8') === value;
}

function requireSourceText(text, label = 'source text') {
  if (!isLosslessUtf8(text)) throw new Error(`${label} must be a well-formed UTF-8 string`);
  if (Buffer.byteLength(text) > SOURCE_LIMIT) throw new Error(`${label} byte limit exceeded`);
}

function requireFilename(filename, label = 'source filename') {
  if (!isLosslessUtf8(filename) || filename.length === 0 || filename.includes('\0')) {
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
    bytecodeSha256: sha256(bytes),
    sourceDocument: result.sourceDocument,
    nodes: result.sourceMap,
    lines: result.extractionMap ?? null,
    traceMetadata: result.traceMetadata ?? null,
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
  if (document.kind !== 'literate' && document.kind !== 'plain') throw new Error('source document kind must be literate or plain');
  requireFilename(document.filename);
  requireSourceText(document.text);
  requireDigest(document.sha256, 'source document sha256');
  if (sha256(document.text) !== document.sha256) throw new Error('source document SHA-256 does not match text');

  const artifactBytes = requireBytes(bytes);
  if (sha256(artifactBytes) !== map.bytecodeSha256) throw new Error('source map bytecode SHA-256 does not match artifact');
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
  return { document, traceMetadata: hasTraceMetadata ? map.traceMetadata : null };
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
  };
}

function remapSourceNodes(nodes, lines, mapPosition) {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.map(node => {
    if (!node || typeof node !== 'object') return node;
    const original = mapPosition(lines, node.line, node.column);
    if (!original) return node;
    const extracted = {
      filename: node.filename, line: node.line, column: node.column,
      endLine: node.endLine, endColumn: node.endColumn,
    };
    const end = mapPosition(lines, node.endLine ?? node.line, node.endColumn ?? node.column);
    // Preserve the compiler-assigned ID exactly: host trace IDs are stable
    // across Markdown-only edits, while this records both coordinate systems.
    return {
      ...node,
      filename: original.file, line: original.line, column: original.column,
      ...(end ? { endLine: end.line, endColumn: end.column } : {}),
      extracted,
    };
  });
}

export async function compileSource(source, { filename = 'program.ghost' } = {}) {
  requireFilename(filename, 'source filename');
  requireSourceText(source, `${filename}: source`);
  let code = source, extraction = null;
  if (filename.endsWith('.ghost.md')) {
    const { extractLiterate } = await import('./literate.mjs');
    extraction = extractLiterate(source, { filename });
    code = extraction.code;
  } else if (filename.endsWith('.md')) {
    throw new Error(`${filename}: literate sources must use .ghost.md`);
  }
  if (!extraction) {
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const line = lines.findIndex(value => /^\s*\/\/.*ghostflow:link/.test(value));
    if (line >= 0) {
      const column = lines[line].indexOf('ghostflow:link') + 1;
      throw new Error(`${filename}:${line + 1}:${column}: ghostflow link directives require a literate .ghost.md source`);
    }
  }
  const legacy = code.trimStart().startsWith('(') || code.trimStart().startsWith(';');
  let result;
  try {
    result = legacy ? { bytes: compile(parse(tokenize(code))), manifest: null, sourceMap: [] }
      : (await import('./control.mjs')).compileControl(code, { filename });
  } catch (error) {
    if (extraction && Number.isInteger(error.line)) {
      const { mapSourcePosition } = await import('./literate.mjs');
      const original = mapSourcePosition(extraction.sourceMap, error.line, error.column ?? 1);
      if (original) {
        const detail = error.message.replace(/^.*?:\d+:\d+:\s*/, '');
        error.message = `${filename}:${original.line}:${original.column}: ${detail}`;
        error.filename = original.file; error.line = original.line; error.column = original.column;
      }
    }
    throw error;
  }
  if (extraction && (extraction.anchors.length || extraction.linkDirectives.length)) {
    if (legacy) throw new Error(`${filename}: ghostflow intent links require a control source`);
    const { parseControl } = await import('./control.mjs');
    const ast = parseControl(code, { filename });
    result = {
      ...result,
      traceMetadata: attachIntentMetadata(result.traceMetadata, {
        anchors: extraction.anchors,
        linkDirectives: extraction.linkDirectives,
        ast,
        sourceMap: result.sourceMap,
        extractionMap: extraction.sourceMap,
      }),
    };
  }
  if (extraction) {
    const { mapSourcePosition } = await import('./literate.mjs');
    result = { ...result, sourceMap: remapSourceNodes(result.sourceMap, extraction.sourceMap, mapSourcePosition), traceMetadata: remapSourceTrace(result.traceMetadata, extraction.sourceMap) };
  }
  const bytes = Buffer.from(result.bytes);
  if (bytes.length > SOURCE_LIMIT) throw new Error('compiled module byte limit exceeded');
  const digest = sha256(bytes);
  const sourceDocument = {
    format: SOURCE_DOCUMENT_FORMAT,
    kind: extraction ? 'literate' : 'plain',
    filename,
    text: source,
    sha256: sha256(source),
  };
  const traceMetadata = result.traceMetadata ? {
    ...result.traceMetadata,
    sourceDocumentSha256: sourceDocument.sha256,
    bytecodeSha256: digest,
  } : result.traceMetadata;
  return { ...result, bytes, sourceDocument, traceMetadata,
    manifest: result.manifest ? { ...result.manifest, bytecodeSha256: digest } : null,
    extractionMap: extraction?.sourceMap ?? null, warnings: extraction?.warnings ?? [] };
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
