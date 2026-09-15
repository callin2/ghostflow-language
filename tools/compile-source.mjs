import { attachIntentMetadata, remapSourceTrace } from './source-trace.mjs';
import { emitInteractionSchema } from './interaction-schema.mjs';
import { extractLiterate, mapSourcePosition } from './literate.mjs';
import { compileControl, parseControl } from './control.mjs';
import { isWellFormedUnicode, sha256Hex, utf8ByteLength } from './sha256.mjs';

export { emitInteractionSchema } from './interaction-schema.mjs';

const SOURCE_LIMIT = 1024 * 1024;
const SOURCE_DOCUMENT_FORMAT = 'GhostFlow/source-document-v1';

function requireSourceText(text, label = 'source text') {
  if (!isWellFormedUnicode(text)) throw new Error(`${label} must be a well-formed UTF-8 string`);
  if (utf8ByteLength(text) > SOURCE_LIMIT) throw new Error(`${label} byte limit exceeded`);
}

function requireFilename(filename, label = 'source filename') {
  if (!isWellFormedUnicode(filename) || filename.length === 0 || filename.includes('\0')) {
    throw new Error(`${label} must be a non-empty well-formed UTF-8 string`);
  }
}

function remapSourceNodes(nodes, lines) {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.map(node => {
    if (!node || typeof node !== 'object') return node;
    const original = mapSourcePosition(lines, node.line, node.column);
    if (!original) return node;
    const extracted = {
      filename: node.filename, line: node.line, column: node.column,
      endLine: node.endLine, endColumn: node.endColumn,
    };
    const end = mapSourcePosition(lines, node.endLine ?? node.line, node.endColumn ?? node.column);
    return {
      ...node,
      filename: original.file, line: original.line, column: original.column,
      ...(end ? { endLine: end.line, endColumn: end.column } : {}),
      extracted,
    };
  });
}

/** Environment-neutral product compiler: canonical literate input only. */
export async function compileSource(source, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('compile options must be an object');
  if (Object.hasOwn(options, 'interactionSchema')) {
    throw new Error('interactionSchema is not a compile option; supply interactionSourceIdentity explicitly');
  }
  const { filename = 'program.ghost.md', interactionSourceIdentity } = options;
  requireFilename(filename, 'source filename');
  requireSourceText(source, `${filename}: source`);
  if (!filename.endsWith('.ghost.md')) throw new Error(`${filename}: GhostFlow product compilation requires a canonical .ghost.md literate source`);
  const extraction = extractLiterate(source, { filename });
  let result;
  try {
    result = compileControl(extraction.code, { filename });
  } catch (error) {
    if (Number.isInteger(error.line)) {
      const original = mapSourcePosition(extraction.sourceMap, error.line, error.column ?? 1);
      if (original) {
        const detail = error.message.replace(/^.*?:\d+:\d+:\s*/, '');
        error.message = `${filename}:${original.line}:${original.column}: ${detail}`;
        error.filename = original.file; error.line = original.line; error.column = original.column;
      }
    }
    throw error;
  }
  if (extraction.anchors.length || extraction.linkDirectives.length) {
    const ast = parseControl(extraction.code, { filename });
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
  const bytes = Uint8Array.from(result.bytes);
  if (bytes.byteLength > SOURCE_LIMIT) throw new Error('compiled module byte limit exceeded');
  const digest = sha256Hex(bytes);
  const sourceDocument = {
    format: SOURCE_DOCUMENT_FORMAT,
    kind: 'literate',
    filename,
    text: source,
    sha256: sha256Hex(source),
  };
  const traceMetadata = result.traceMetadata ? {
    ...remapSourceTrace(result.traceMetadata, extraction.sourceMap),
    sourceDocumentSha256: sourceDocument.sha256,
    bytecodeSha256: digest,
  } : result.traceMetadata;
  const compilation = {
    ...result,
    bytes,
    sourceDocument,
    sourceMap: remapSourceNodes(result.sourceMap, extraction.sourceMap),
    traceMetadata,
    manifest: result.manifest ? { ...result.manifest, bytecodeSha256: digest } : null,
    extractionMap: extraction.sourceMap,
    warnings: extraction.warnings,
  };
  const schema = interactionSourceIdentity === undefined ? null : emitInteractionSchema(compilation, interactionSourceIdentity);
  return {
    ...compilation,
    interactionSchema: schema,
    interactionSourceIdentity: schema ? {
      documentId: schema.source.documentId,
      revisionId: schema.source.revisionId,
    } : null,
  };
}
