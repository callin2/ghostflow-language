import { attachIntentMetadata, remapSourceTrace } from './source-trace.mjs';
import { emitInteractionSchema } from './interaction-schema.mjs';
import { extractLiterate, mapSourcePosition } from './literate.mjs';
import { compileAccountingControl, compileControl, compileControlPolicyDescriptorArtifact, compileResourcePolicyArtifact, compileScheduleDescriptorArtifact, compileTemporalDescriptorArtifact, hasTemporalDescriptorCalls, isExecutablePulseSchedule, isExecutableRangeSchedule, parseControl } from './control.mjs';
import { isWellFormedUnicode, sha256Hex, utf8ByteLength } from './sha256.mjs';
import { compileComposition, resolveDocument } from './composition.mjs';
import { emitExplanationArtifact } from './explanation.mjs';

export { emitInteractionSchema } from './interaction-schema.mjs';

const SOURCE_LIMIT = 1024 * 1024;
const SOURCE_DOCUMENT_FORMAT = 'GhostFlow/source-document-v1';
const DIAGNOSTICS_FORMAT = 'GhostFlow/diagnostics-v1';

function diagnosticSource(filename, source, identity) {
  return { filename, sha256: sha256Hex(source), ...(identity ?? {}) };
}

function attachDiagnostic(error, code, source, identity, position, end, requestSource) {
  if (!position) return;
  const prefix = `${error.filename}:${error.line}:${error.column}: `;
  const message = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
  error.diagnosticEnvelope = {
    format: DIAGNOSTICS_FORMAT,
    source: diagnosticSource(source.filename, source.text, identity),
    ...(requestSource ? { requestSource } : {}),
    diagnostics: [{
      code: error.diagnosticCode ?? code, severity: 'error', message: error.diagnosticMessage ?? message,
      ...(error.diagnosticHint ? { hint: error.diagnosticHint } : {}),
      ...(error.diagnosticReference ? { reference: error.diagnosticReference } : {}),
      span: {
        file: position.file,
        start: { line: position.line, column: position.column },
        ...(end ? { end: { line: end.line, column: end.column } } : {}),
      },
    }],
  };
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
  let extraction;
  try { extraction = extractLiterate(source, { filename }); }
  catch (error) {
    if (Number.isInteger(error.line) && Number.isInteger(error.column)) {
      attachDiagnostic(error, 'GF_LITERATE', { filename, text: source }, interactionSourceIdentity,
        { file: filename, line: error.line, column: error.column });
    }
    throw error;
  }
  let result, composition, stage = 'parse';
  try {
    const ast = parseControl(extraction.code, { filename });
    stage = 'semantic';
    if (options.sourceClosure !== undefined && ast.imports?.length) {
      composition = compileComposition(source, filename, options.sourceClosure);
      result = composition.result;
    } else result = ast.kind === 'resource-policy'
      ? compileResourcePolicyArtifact(extraction.code, { filename })
      : ast.body.some(item => item.kind === 'shared-constraints')
        ? compileControlPolicyDescriptorArtifact(extraction.code, { filename })
      : ast.body.some(item => item.kind === 'account' || item.kind === 'account-constraints')
        ? compileAccountingControl(extraction.code, { filename })
      : ast.body.some(item => item.kind === 'schedule' && !isExecutablePulseSchedule(item) && !isExecutableRangeSchedule(item)
        && Object.keys(item.policy ?? {}).some(key => key !== 'fallback'))
        ? compileScheduleDescriptorArtifact(extraction.code, { filename })
        : hasTemporalDescriptorCalls(ast)
          ? compileTemporalDescriptorArtifact(extraction.code, { filename })
          : compileControl(extraction.code, { filename });
  } catch (error) {
    // Map each independently checked error using the same canonical document
    // path as a single failure. Preserve the original thrown error/message.
    const failures = error.collectedErrors ?? [error];
    const mapFailure = error => {
      const errorDocument = error.filename === filename ? null : options.sourceClosure?.find(document => resolveDocument('', document.filename) === error.filename);
      if (error.name === 'LiterateError' && errorDocument) {
        attachDiagnostic(error, 'GF_LITERATE', { filename: errorDocument.filename, text: errorDocument.text }, undefined,
          { file: error.filename, line: error.line, column: error.column }, undefined,
          diagnosticSource(filename, source, interactionSourceIdentity));
        return error.diagnosticEnvelope;
      }
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
          const originalEnd = Number.isInteger(error.loc?.endLine) && Number.isInteger(error.loc?.endColumn)
            ? mapSourcePosition(errorMap, error.loc.endLine, error.loc.endColumn) : null;
          const prefix = `${error.filename}:${error.line}:${error.column}: `;
          const detail = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
          error.message = `${original.file}:${original.line}:${original.column}: ${detail}`;
          error.filename = original.file; error.line = original.line; error.column = original.column;
          const errorSource = errorDocument
            ? { filename: errorDocument.filename, text: errorDocument.text }
            : { filename, text: source };
          attachDiagnostic(error, stage === 'parse' ? 'GF_PARSE' : 'GF_SEMANTIC',
            errorSource, errorDocument ? undefined : interactionSourceIdentity, original, originalEnd,
            errorDocument ? diagnosticSource(filename, source, interactionSourceIdentity) : undefined);
        }
      }
      return error.diagnosticEnvelope;
    };
    const envelopes = failures.map(mapFailure).filter(Boolean);
    if (!failures.includes(error)) mapFailure(error);
    if (envelopes.length) error.diagnosticEnvelope = {
      ...envelopes[0], diagnostics: envelopes.flatMap(envelope => envelope.diagnostics),
      ...(error.diagnosticCollection ? { collection: error.diagnosticCollection } : {}),
    };
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
  const mapFor = name => composition?.units.get(resolveDocument('', name))?.extraction.sourceMap ?? extraction.sourceMap;
  const remapConstraintSource = identity => {
    if (!identity) return identity;
    const original = mapSourcePosition(mapFor(identity.filename), identity.line, identity.column);
    if (!original) return identity;
    const end = mapSourcePosition(mapFor(identity.filename), identity.endLine ?? identity.line, identity.endColumn ?? identity.column);
    const { nodeId, ...extracted } = identity;
    return { nodeId, filename: original.file, line: original.line, column: original.column,
      ...(end ? { endLine: end.line, endColumn: end.column } : {}), extracted };
  };
  const controlManifest = result.manifest?.format === 'GhostFlow/control-policy-descriptor-v1'
    ? result.manifest.control : result.manifest;
  if (controlManifest?.sharedResourceConstraints || controlManifest?.localConstraints) {
    const mappedControl = { ...controlManifest };
    for (const key of ['sharedResourceConstraints', 'localConstraints']) if (controlManifest[key]) {
      mappedControl[key] = controlManifest[key].map(group => ({ ...group, source: remapConstraintSource(group.source),
        rules: group.rules.map(rule => ({ ...rule, source: remapConstraintSource(rule.source) })),
        ...(group.safe ? { safe: group.safe.map(entry => ({ ...entry, source: remapConstraintSource(entry.source) })) } : {}),
      }));
    }
    result = { ...result, manifest: result.manifest.format === 'GhostFlow/control-policy-descriptor-v1'
      ? { ...result.manifest, control: mappedControl } : mappedControl };
  }
  if (result.manifest?.format === 'GhostFlow/control-policy-descriptor-v1') {
    const artifact = JSON.parse(new TextDecoder().decode(result.bytes));
    result = { ...result, bytes: new TextEncoder().encode(JSON.stringify({ ...artifact, manifest: result.manifest,
      sourceDocument: { format: SOURCE_DOCUMENT_FORMAT, kind: 'literate', filename, text: source, sha256: sha256Hex(source) },
    })) };
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
      ...(['GhostFlow/schedule-descriptor-v1', 'GhostFlow/temporal-descriptor-v1', 'GhostFlow/control-policy-descriptor-v1'].includes(result.manifest.format)
        ? { sourceDocumentSha256: sourceDocument.sha256 } : {}),
    } : null,
    extractionMap: extraction.sourceMap,
    warnings: extraction.warnings,
  };
  let schema = null;
  try {
    if (interactionSourceIdentity !== undefined) schema = emitInteractionSchema(compilation, interactionSourceIdentity);
  } catch (error) {
    // Schema provenance failures already carry canonical source-map locations;
    // mapping them through extracted code again would point into the wrong fence.
    if (error.diagnosticCode === 'GF_INTENT_PROVENANCE') {
      attachDiagnostic(error, error.diagnosticCode, sourceDocument, interactionSourceIdentity,
        { file: error.filename, line: error.line, column: error.column },
        Number.isInteger(error.loc?.endLine) && Number.isInteger(error.loc?.endColumn)
          ? { line: error.loc.endLine, column: error.loc.endColumn } : undefined);
    }
    throw error;
  }
  const explanationArtifact = emitExplanationArtifact(compilation);
  const { explanationExpressions: _expressionMappings, ...publicCompilation } = compilation;
  return {
    ...publicCompilation,
    diagnosticEnvelope: { format: DIAGNOSTICS_FORMAT,
      source: diagnosticSource(filename, source, interactionSourceIdentity), diagnostics: [] },
    interactionSchema: schema,
    explanationArtifact,
    interactionSourceIdentity: schema ? {
      documentId: schema.source.documentId,
      revisionId: schema.source.revisionId,
    } : null,
  };
}
