import { attachIntentMetadata, remapSourceTrace } from './source-trace.mjs';
import { emitInteractionSchema } from './interaction-schema.mjs';
import { extractLiterate, mapSourcePosition } from './literate.mjs';
import { compileAccountingDescriptorArtifact, compileControl, compileResourcePolicyArtifact, compileScheduleDescriptorArtifact, compileTemporalDescriptorArtifact, hasTemporalDescriptorCalls, parseControl } from './control.mjs';
import { isWellFormedUnicode, sha256Hex, utf8ByteLength } from './sha256.mjs';
import { compileComposition, resolveDocument } from './composition.mjs';

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
  return compileSourceSync(source, options);
}

/** Deterministic core also used when verifying persisted artifacts. */
export function compileSourceSync(source, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('compile options must be an object');
  if (Object.hasOwn(options, 'interactionSchema')) {
    throw new Error('interactionSchema is not a compile option; supply interactionSourceIdentity explicitly');
  }
  const { filename = 'program.ghost.md', interactionSourceIdentity } = options;
  requireFilename(filename, 'source filename');
  requireSourceText(source, `${filename}: source`);
  if (!filename.endsWith('.ghost.md')) throw new Error(`${filename}: GhostFlow product compilation requires a canonical .ghost.md literate source`);
  const extraction = extractLiterate(source, { filename });
  let result, composition;
  try {
    const ast = parseControl(extraction.code, { filename });
    if (options.sourceClosure !== undefined && ast.imports?.length) {
      composition = compileComposition(source, filename, options.sourceClosure);
      result = composition.result;
    } else result = ast.kind === 'resource-policy'
      ? compileResourcePolicyArtifact(extraction.code, { filename })
      : ast.body.some(item => item.kind === 'account' || item.kind === 'account-constraints')
        ? compileAccountingDescriptorArtifact(extraction.code, { filename })
      : ast.body.some(item => item.kind === 'schedule' && item.scheduleType !== 'Solar'
        && Object.keys(item.policy ?? {}).some(key => key !== 'fallback'))
        ? compileScheduleDescriptorArtifact(extraction.code, { filename })
        : hasTemporalDescriptorCalls(ast)
          ? compileTemporalDescriptorArtifact(extraction.code, { filename })
          : compileControl(extraction.code, { filename });
  } catch (error) {
    const errorDocument = error.filename === filename ? null : options.sourceClosure?.find(document => resolveDocument('', document.filename) === error.filename);
    const errorMap = errorDocument ? extractLiterate(errorDocument.text, { filename: error.filename }).sourceMap : extraction.sourceMap;
    if (Number.isInteger(error.line) && (error.filename === filename || errorDocument)) {
      let original = mapSourcePosition(errorMap, error.line, error.column ?? 1);
      // Extraction appends a newline after the final authored code line. Its
      // terminal EOF belongs to that line's insertion point, not a prose line
      // or a generated separator between executable fences.
      if (!original && error.line === errorMap.length + 1 && error.column === 1) {
        const lastLine = errorMap.at(-1);
        if (lastLine) original = mapSourcePosition(errorMap, errorMap.length, lastLine.length + 1);
      }
      if (original) {
        const prefix = `${error.filename}:${error.line}:${error.column}: `;
        const detail = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
        error.message = `${original.file}:${original.line}:${original.column}: ${detail}`;
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
  const mapFor = name => composition?.units.get(resolveDocument('', name))?.extraction.sourceMap ?? extraction.sourceMap;
  const mappedTrace = composition ? (() => {
    const trace = { ...result.traceMetadata };
    for (const key of ['bindings', 'constraints', 'resultSites', 'windowSites', 'intentLinks']) if (Array.isArray(trace[key])) {
      trace[key] = trace[key].map(entry => {
        const shell = { bindings: [], constraints: [], resultSites: [], [key]: [entry] };
        return remapSourceTrace(shell, mapFor(entry.source.filename))[key][0];
      });
    }
    return trace;
  })() : remapSourceTrace(result.traceMetadata, extraction.sourceMap);
  const traceMetadata = result.traceMetadata ? {
    ...mappedTrace,
    sourceDocumentSha256: sourceDocument.sha256,
    bytecodeSha256: digest,
  } : result.traceMetadata;
  const compilation = {
    ...result,
    bytes,
    sourceDocument,
    sourceMap: composition ? result.sourceMap.map(node => remapSourceNodes([node], mapFor(node.filename))[0]) : remapSourceNodes(result.sourceMap, extraction.sourceMap),
    ...(composition ? { sourceClosure: composition.closure } : {}),
    traceMetadata,
    manifest: result.manifest ? {
      ...result.manifest, bytecodeSha256: digest,
      ...(['GhostFlow/schedule-descriptor-v1', 'GhostFlow/accounting-v1', 'GhostFlow/temporal-descriptor-v1'].includes(result.manifest.format)
        ? { sourceDocumentSha256: sourceDocument.sha256 } : {}),
    } : null,
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
