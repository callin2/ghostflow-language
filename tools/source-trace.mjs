import { extractLiterate, mapSourcePosition } from './literate.mjs';

/** Diagnostic identity matching the portable core; NOT a cryptographic digest. */
export function moduleFingerprint(bytes) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}

const BINDING_FIELDS = new Map([
  ['input', ['inputs']],
  ['schedule', ['inputs']],
  ['state', ['stateBefore', 'stateAfter']],
  ['next', ['stateAfter']],
  ['connection', ['requested', 'safe']],
  ['timer', ['stateBefore', 'stateAfter']],
]);
const TRACEABLE_NODE_KINDS = new Set([...BINDING_FIELDS.keys(), 'require', 'mutex']);
const INTENT_KINDS = new Set(['intent', 'premise', 'assumption']);
const INTENT_STATUSES = new Set(['confirmed', 'unconfirmed', 'superseded']);
const INTENT_ORIGINS = new Set(['user', 'operator', 'engineer', 'ai', 'imported']);
const INTENT_RELATIONS = new Set(['implements', 'constrains', 'fallback', 'assumes']);
const INTENT_TARGET_KINDS = new Set([
  'input', 'output', 'state', 'config', 'let', 'enum', 'function', 'sensor',
  'signal', 'schedule', 'timer', 'require', 'mutex', 'next', 'connection',
]);
const ANCHOR_FIELDS = ['id', 'kind', 'status', 'origin', 'directiveSource', 'source'];
const LINK_FIELDS = ['anchorId', 'relation', 'nodeId', 'nodeKind', 'directiveSource', 'source', 'extractedDirectiveSource', 'extractedSource'];

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function samePosition(left, right) {
  return object(left) && object(right)
    && left.filename === right.filename && left.line === right.line && left.column === right.column;
}

function rangeFromNode(node) {
  return {
    filename: node.filename,
    line: node.line,
    column: node.column,
    endLine: node.endLine ?? node.line,
    endColumn: node.endColumn ?? node.column,
  };
}

function sameRange(left, right) {
  return object(left) && object(right)
    && left.filename === right.filename && left.line === right.line && left.column === right.column
    && left.endLine === right.endLine && left.endColumn === right.endColumn;
}

function requireExactFields(value, fields, label) {
  if (!object(value) || Object.keys(value).sort().join('\u0000') !== [...fields].sort().join('\u0000')) {
    throw new Error(`${label} fields mismatch`);
  }
}

function requireRange(value, label, document) {
  if (!object(value) || typeof value.filename !== 'string' || !Number.isInteger(value.line)
      || !Number.isInteger(value.column) || !Number.isInteger(value.endLine) || !Number.isInteger(value.endColumn)
      || value.line < 1 || value.column < 1 || value.endLine < value.line
      || (value.endLine === value.line && value.endColumn < value.column)) {
    throw new Error(`${label} range mismatch`);
  }
  if (!document) return;
  if (value.filename !== document.filename) throw new Error(`${label} range filename mismatch`);
  const lines = document.text.replace(/\r\n/g, '\n').split('\n');
  if (value.line > lines.length || value.endLine > lines.length
      || value.column > lines[value.line - 1].length + 1
      || value.endColumn > lines[value.endLine - 1].length + 1) {
    throw new Error(`${label} range is outside source document`);
  }
}

function rangeText(document, value) {
  if (value.line !== value.endLine) return null;
  return document.text.replace(/\r\n/g, '\n').split('\n')[value.line - 1].slice(value.column - 1, value.endColumn - 1);
}

function requireAnchorShape(anchor, document) {
  requireExactFields(anchor, ANCHOR_FIELDS, 'intent anchor');
  if (typeof anchor.id !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(anchor.id)) throw new Error('intent anchor id mismatch');
  if (!INTENT_KINDS.has(anchor.kind) || !INTENT_STATUSES.has(anchor.status) || !INTENT_ORIGINS.has(anchor.origin)) {
    throw new Error('intent anchor classification mismatch');
  }
  if (anchor.kind === 'assumption' && anchor.status === 'confirmed') throw new Error('confirmed intent assumption is invalid');
  requireRange(anchor.directiveSource, 'intent anchor directive', document);
  requireRange(anchor.source, 'intent anchor source', document);
  if (document) {
    const expected = `<!-- ghostflow:anchor id=${anchor.id} kind=${anchor.kind} status=${anchor.status} origin=${anchor.origin} -->`;
    if (rangeText(document, anchor.directiveSource) !== expected) throw new Error('intent anchor directive source mismatch');
    if (rangeText(document, anchor.source)?.trim().length === 0) throw new Error('intent anchor source is empty');
  }
}

function mapRange(extractionMap, range) {
  if (!Array.isArray(extractionMap)) return null;
  const start = mapSourcePosition(extractionMap, range.line, range.column);
  const end = mapSourcePosition(extractionMap, range.endLine, range.endColumn);
  return start && end ? {
    filename: start.file, line: start.line, column: start.column,
    endLine: end.line, endColumn: end.column,
  } : null;
}

function sameExtractionMap(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    if (entry === null || other === null) return entry === other;
    return object(entry) && object(other)
      && Object.keys(entry).length === 4 && Object.keys(other).length === 4
      && entry.file === other.file && entry.line === other.line
      && entry.column === other.column && entry.length === other.length;
  });
}

function provenanceError(entry, message) {
  const source = entry?.directiveSource;
  return source ? new Error(`${source.filename}:${source.line}:${source.column}: ${message}`) : new Error(message);
}

function requireName(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${label} must be a GhostFlow name`);
  }
}

function requireFields(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length
      || actual.some((field, index) => field !== expected[index])) {
    throw new Error(`${label} fields mismatch`);
  }
}

function requireNodePosition(entry, node, label) {
  if (!samePosition(entry.source, node)) throw new Error(`${label} source node mismatch`);
  const hasExtractedSource = Object.hasOwn(entry, 'extractedSource');
  const hasExtractedNode = Object.hasOwn(node, 'extracted');
  if (hasExtractedSource !== hasExtractedNode
      || (hasExtractedSource && !samePosition(entry.extractedSource, node.extracted))) {
    throw new Error(`${label} extracted source node mismatch`);
  }
}

export function sourceMapRequiresTraceMetadata(nodes) {
  return Array.isArray(nodes) && nodes.some(node => object(node) && TRACEABLE_NODE_KINDS.has(node.kind));
}

function dependencyField(value) {
  if (typeof value !== 'string') return null;
  for (const [prefix, field] of [['input.', 'inputs'], ['state.', 'stateBefore'], ['next.', 'stateAfter']]) {
    if (value.startsWith(prefix) && value.length > prefix.length) return { field, name: value.slice(prefix.length) };
  }
  return null;
}

// Lowered expressions are S-expression arrays. Visiting every leaf deliberately
// retains dependencies from both branches of a static conditional; this is not
// an execution-path observation.
function expressionDependencies(expression) {
  const reads = [];
  const seen = new Set();
  const visit = value => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const read = dependencyField(value);
    if (!read) return;
    const key = `${read.field}\u0000${read.name}`;
    if (!seen.has(key)) { seen.add(key); reads.push(read); }
  };
  visit(expression);
  return reads;
}

function dependenciesForForms(transitions, intents) {
  const dependencies = [];
  const add = (form, field) => {
    if (!Array.isArray(form) || typeof form[1] !== 'string') return;
    dependencies.push({ target: { field, name: form[1] }, reads: expressionDependencies(form[2]) });
  };
  for (const transition of transitions) if (transition?.[0] === 'next') add(transition, 'stateAfter');
  for (const intent of intents) if (intent?.[0] === 'intent') add(intent, 'requested');
  return dependencies;
}

/** Consumes the authoritative parsed AST, lowered constraints, forms, and generated timer state names. */
export function buildSourceTrace(ast, constraints, bytes, transitions = [], intents = [], generatedTimers = []) {
  const bindings = [];
  const add = (node, name, fields, extra = {}) => bindings.push({
    nodeId: node.id, kind: node.kind, name, fields, source: { ...node.loc }, ...extra,
  });
  const timers = new Map();
  for (const generated of generatedTimers) {
    if (!object(generated) || !object(generated.node) || generated.node.kind !== 'timer'
        || !['since', 'initialized'].includes(generated.role)) {
      throw new Error('invalid generated timer source binding');
    }
    const key = `${generated.node.id}\u0000${generated.role}`;
    if (timers.has(key)) throw new Error('duplicate generated timer source binding');
    timers.set(key, generated);
  }
  for (const node of ast.body) {
    if (node.kind === 'input') for (const name of node.names) add(node, name, ['inputs']);
    if (node.kind === 'schedule') add(node, `__gf_schedule_due_${node.name}`, ['inputs']);
    if (node.kind === 'state') add(node, node.name, ['stateBefore', 'stateAfter']);
    if (node.kind === 'next') add(node, node.name, ['stateAfter']);
    if (node.kind === 'connection') add(node, node.name, ['requested', 'safe']);
    if (node.kind === 'timer') for (const role of ['since', 'initialized']) {
      const generated = timers.get(`${node.id}\u0000${role}`);
      if (!generated) throw new Error(`missing generated ${role} state for timer ${node.name}`);
      add(node, generated.name, ['stateBefore', 'stateAfter'], {
        generated: { declaration: node.name, role },
      });
      timers.delete(`${node.id}\u0000${role}`);
    }
  }
  if (timers.size) throw new Error('generated timer source binding has no authoritative declaration');
  const sourceConstraints = ast.body.filter(node => node.kind === 'require' || node.kind === 'mutex');
  if (sourceConstraints.length !== constraints.length) throw new Error('constraint source mapping mismatch');
  return {
    format: 'GhostFlow/source-trace-v1', moduleFingerprint: moduleFingerprint(bytes), bindings,
    dependencies: dependenciesForForms(transitions, intents),
    constraints: constraints.map(([kind, ...names], index) => ({
      index, kind, names, nodeId: sourceConstraints[index].id, source: { ...sourceConstraints[index].loc },
    })),
  };
}

/**
 * Adds only author-supplied intent provenance to the compiler-owned trace.
 * Links bind to parser top-level nodes; they never affect lowering or execution.
 */
export function attachIntentMetadata(metadata, { anchors, linkDirectives, ast, sourceMap, extractionMap } = {}) {
  if (!Array.isArray(anchors) || !Array.isArray(linkDirectives) || !ast || !Array.isArray(ast.body)
      || !Array.isArray(sourceMap) || !Array.isArray(extractionMap)) {
    throw new Error('intent anchor compilation context is invalid');
  }
  const byId = new Map();
  for (const anchor of anchors) {
    try { requireAnchorShape(anchor); } catch (error) { throw provenanceError(anchor, error.message); }
    if (byId.has(anchor.id)) throw provenanceError(anchor, `duplicate intent anchor ${anchor.id}`);
    byId.set(anchor.id, anchor);
  }
  const directivesByLine = new Map();
  for (const directive of linkDirectives) {
    if (!object(directive) || typeof directive.anchorId !== 'string' || !INTENT_RELATIONS.has(directive.relation)
        || !object(directive.extractedDirectiveSource) || !Number.isInteger(directive.extractedDirectiveSource.line)) {
      throw provenanceError(directive, 'intent link directive shape mismatch');
    }
    if (directivesByLine.has(directive.extractedDirectiveSource.line)) throw provenanceError(directive, 'duplicate intent link directive location');
    directivesByLine.set(directive.extractedDirectiveSource.line, directive);
  }
  const topLevelByLine = new Map();
  for (const node of ast.body) {
    if (!INTENT_TARGET_KINDS.has(node.kind) || topLevelByLine.has(node.loc.line)) continue;
    topLevelByLine.set(node.loc.line, node);
  }
  const validateDirective = directive => {
    const anchor = byId.get(directive.anchorId);
    if (!anchor) throw provenanceError(directive, `intent link references missing anchor ${directive.anchorId}`);
    if (anchor.status === 'superseded') {
      throw provenanceError(directive, `intent link references superseded anchor ${directive.anchorId}`);
    }
    if (directive.relation === 'assumes') {
      if (anchor.kind !== 'assumption' || anchor.status !== 'unconfirmed') {
        throw provenanceError(directive, `intent link assumes requires unconfirmed assumption ${directive.anchorId}`);
      }
    } else if (anchor.kind === 'assumption') {
      throw provenanceError(directive, `intent link ${directive.relation} cannot reference assumption ${directive.anchorId}`);
    }
  };
  const intentLinks = [];
  for (const [line, directive] of [...directivesByLine.entries()].sort(([left], [right]) => left - right)) {
    if (directivesByLine.has(line - 1)) continue;
    let targetLine = line;
    while (directivesByLine.has(targetLine + 1)) targetLine++;
    const node = topLevelByLine.get(targetLine + 1);
    if (!node || extractionMap[targetLine] === null || extractionMap[targetLine] === undefined) {
      throw provenanceError(directive, `orphan intent link ${directive.anchorId}`);
    }
    const target = sourceMap.find(candidate => candidate?.id === node.id) ?? rangeFromNode(node.loc);
    const source = rangeFromNode(target);
    for (let current = line; current <= targetLine; current++) {
      const linked = directivesByLine.get(current);
      validateDirective(linked);
      intentLinks.push({
        anchorId: linked.anchorId, relation: linked.relation, nodeId: node.id, nodeKind: node.kind,
        directiveSource: linked.directiveSource,
        source,
        extractedDirectiveSource: linked.extractedDirectiveSource,
        extractedSource: source,
      });
    }
  }
  const seen = new Set();
  for (const link of intentLinks) {
    const key = `${link.anchorId}\u0000${link.relation}\u0000${link.nodeId}`;
    if (seen.has(key)) throw provenanceError(link, 'duplicate identical intent link');
    seen.add(key);
  }
  return anchors.length || linkDirectives.length ? {
    ...metadata,
    intentAnchors: anchors.map(anchor => ({ ...anchor })),
    intentLinks,
  } : metadata;
}

/** Validate persisted compiler-owned links without evaluating or inferring source meaning. */
export function verifySourceTraceMetadata(metadata, bytes, nodes, {
  sourceDocumentSha256, bytecodeSha256, requireRevisionIdentity = false, sourceDocument, extractionMap,
} = {}) {
  if (!object(metadata) || metadata.format !== 'GhostFlow/source-trace-v1') {
    throw new Error('source trace metadata format mismatch');
  }
  const allowedMetadataFields = new Set([
    'format', 'moduleFingerprint', 'bindings', 'dependencies', 'constraints',
    'sourceDocumentSha256', 'bytecodeSha256', 'intentAnchors', 'intentLinks',
  ]);
  if (Object.keys(metadata).some(field => !allowedMetadataFields.has(field))) {
    throw new Error('source trace metadata fields mismatch');
  }
  if (!(bytes instanceof Uint8Array)) throw new Error('source trace bytes must be a Uint8Array');
  if (metadata.moduleFingerprint !== moduleFingerprint(bytes)) {
    throw new Error('source trace module fingerprint mismatch');
  }
  if (requireRevisionIdentity || Object.hasOwn(metadata, 'sourceDocumentSha256')) {
    if (metadata.sourceDocumentSha256 !== sourceDocumentSha256) {
      throw new Error('source trace source document revision mismatch');
    }
  }
  if (requireRevisionIdentity || Object.hasOwn(metadata, 'bytecodeSha256')) {
    if (metadata.bytecodeSha256 !== bytecodeSha256) {
      throw new Error('source trace bytecode revision mismatch');
    }
  }
  if (!Array.isArray(nodes)) throw new Error('source trace nodes must be an array');
  if (!Array.isArray(metadata.bindings) || !Array.isArray(metadata.dependencies)
      || !Array.isArray(metadata.constraints)) {
    throw new Error('source trace metadata arrays are missing');
  }

  const hasIntentAnchors = Object.hasOwn(metadata, 'intentAnchors');
  const hasIntentLinks = Object.hasOwn(metadata, 'intentLinks');
  if (hasIntentAnchors !== hasIntentLinks) throw new Error('intent trace metadata arrays mismatch');
  if (hasIntentAnchors && (!Array.isArray(metadata.intentAnchors) || !Array.isArray(metadata.intentLinks))) {
    throw new Error('intent trace metadata arrays are invalid');
  }

  let reextracted = null;
  if (sourceDocument !== undefined) {
    if (!object(sourceDocument) || typeof sourceDocument.text !== 'string') {
      throw new Error('source trace source document shape mismatch');
    }
    if (sourceDocument.kind === 'literate') {
      if (!Array.isArray(extractionMap)) throw new Error('literate intent trace requires extraction map');
      reextracted = extractLiterate(sourceDocument.text, { filename: sourceDocument.filename });
      if (!sameExtractionMap(reextracted.sourceMap, extractionMap)) {
        throw new Error('literate intent trace extraction map mismatch');
      }
      const hasAuthoredIntent = reextracted.anchors.length > 0 || reextracted.linkDirectives.length > 0;
      if (hasAuthoredIntent !== hasIntentAnchors) throw new Error('literate intent trace metadata presence mismatch');
    } else if (hasIntentAnchors) {
      throw new Error('intent trace metadata requires literate source kind');
    }
  } else if (hasIntentAnchors) {
    throw new Error('intent trace metadata requires source document');
  }

  const nodeById = new Map();
  for (const node of nodes) {
    if (node === nodes) throw new Error('circular source map nodes are not supported');
    if (!object(node) || !Number.isInteger(node.id) || nodeById.has(node.id)) {
      throw new Error('source trace node identity mismatch');
    }
    nodeById.set(node.id, node);
  }

  if (hasIntentAnchors) {
    if (!reextracted) throw new Error('intent trace metadata requires deterministic literate extraction');
    if (metadata.intentAnchors.length !== reextracted.anchors.length) {
      throw new Error('intent anchor extraction count mismatch');
    }
    const anchorsById = new Map();
    for (const [index, anchor] of metadata.intentAnchors.entries()) {
      requireAnchorShape(anchor, sourceDocument);
      if (anchorsById.has(anchor.id)) throw new Error('duplicate intent anchor');
      const extracted = reextracted.anchors[index];
      if (!extracted || anchor.id !== extracted.id || anchor.kind !== extracted.kind
          || anchor.status !== extracted.status || anchor.origin !== extracted.origin
          || !sameRange(anchor.directiveSource, extracted.directiveSource)
          || !sameRange(anchor.source, extracted.source)) {
        throw new Error('intent anchor does not match deterministic literate extraction');
      }
      anchorsById.set(anchor.id, anchor);
    }
    const expectedLinks = [];
    const directivesByLine = new Map(reextracted.linkDirectives.map(directive => [
      directive.extractedDirectiveSource.line, directive,
    ]));
    const targetNodesByLine = new Map();
    for (const node of nodes) {
      if (!INTENT_TARGET_KINDS.has(node.kind) || !object(node.extracted)) continue;
      const grouped = targetNodesByLine.get(node.extracted.line) ?? [];
      grouped.push(node);
      targetNodesByLine.set(node.extracted.line, grouped);
    }
    for (const [line, directive] of [...directivesByLine.entries()].sort(([left], [right]) => left - right)) {
      if (directivesByLine.has(line - 1)) continue;
      let finalDirectiveLine = line;
      while (directivesByLine.has(finalDirectiveLine + 1)) finalDirectiveLine++;
      if (reextracted.sourceMap[finalDirectiveLine] === null
          || reextracted.sourceMap[finalDirectiveLine] === undefined) {
        throw new Error('deterministic intent link target crosses generated separator');
      }
      const candidates = targetNodesByLine.get(finalDirectiveLine + 1) ?? [];
      if (candidates.length !== 1) throw new Error('deterministic intent link target mismatch');
      const node = candidates[0];
      for (let current = line; current <= finalDirectiveLine; current++) {
        expectedLinks.push({ directive: directivesByLine.get(current), node });
      }
    }
    if (metadata.intentLinks.length !== expectedLinks.length) throw new Error('intent link extraction count mismatch');
    const linkKeys = new Set();
    for (const [index, link] of metadata.intentLinks.entries()) {
      requireExactFields(link, LINK_FIELDS, 'intent link');
      if (typeof link.anchorId !== 'string' || !INTENT_RELATIONS.has(link.relation)
          || !Number.isInteger(link.nodeId) || !INTENT_TARGET_KINDS.has(link.nodeKind)) {
        throw new Error('intent link shape mismatch');
      }
      requireRange(link.directiveSource, 'intent link directive', sourceDocument);
      requireRange(link.source, 'intent link source', sourceDocument);
      requireRange(link.extractedDirectiveSource, 'intent link extracted directive');
      requireRange(link.extractedSource, 'intent link extracted source');
      const node = nodeById.get(link.nodeId);
      if (!node || node.kind !== link.nodeKind || !sameRange(link.source, rangeFromNode(node))) {
        throw new Error('intent link source node mismatch');
      }
      if (!object(node.extracted) || !sameRange(link.extractedSource, rangeFromNode(node.extracted))) {
        throw new Error('intent link extracted source node mismatch');
      }
      const expected = expectedLinks[index];
      if (!expected || link.anchorId !== expected.directive.anchorId || link.relation !== expected.directive.relation
          || link.nodeId !== expected.node.id || link.nodeKind !== expected.node.kind
          || !sameRange(link.directiveSource, expected.directive.directiveSource)
          || !sameRange(link.extractedDirectiveSource, expected.directive.extractedDirectiveSource)) {
        throw new Error('intent link does not match deterministic literate extraction');
      }
      const mappedDirective = mapRange(extractionMap, link.extractedDirectiveSource);
      if (!mappedDirective || !sameRange(mappedDirective, link.directiveSource)) {
        throw new Error('intent link directive source mapping mismatch');
      }
      const anchor = anchorsById.get(link.anchorId);
      if (!anchor) throw new Error('intent link references missing anchor');
      if (anchor.status === 'superseded') throw new Error('intent link references superseded anchor');
      if (link.relation === 'assumes') {
        if (anchor.kind !== 'assumption' || anchor.status !== 'unconfirmed') throw new Error('intent link assumption classification mismatch');
      } else if (anchor.kind === 'assumption') throw new Error('intent link relation classification mismatch');
      const key = `${link.anchorId}\u0000${link.relation}\u0000${link.nodeId}`;
      if (linkKeys.has(key)) throw new Error('duplicate identical intent link');
      linkKeys.add(key);
    }
  }

  const bindingsByNode = new Map();
  const bindingKeys = new Set();
  const fieldBindings = new Set();
  for (const entry of metadata.bindings) {
    if (!object(entry) || !Number.isInteger(entry.nodeId) || !BINDING_FIELDS.has(entry.kind)) {
      throw new Error('source trace binding shape mismatch');
    }
    requireName(entry.name, 'source trace binding name');
    const node = nodeById.get(entry.nodeId);
    if (!node || node.kind !== entry.kind) throw new Error('source trace binding node mismatch');
    requireFields(entry.fields, BINDING_FIELDS.get(entry.kind), `source trace binding ${entry.name}`);
    requireNodePosition(entry, node, `source trace binding ${entry.name}`);
    const key = `${entry.nodeId}\u0000${entry.kind}\u0000${entry.name}`;
    if (bindingKeys.has(key)) throw new Error('duplicate source trace binding');
    bindingKeys.add(key);
    for (const field of entry.fields) fieldBindings.add(`${field}\u0000${entry.name}`);
    const grouped = bindingsByNode.get(entry.nodeId) ?? [];
    grouped.push(entry);
    bindingsByNode.set(entry.nodeId, grouped);

    if (entry.kind === 'timer') {
      if (!object(entry.generated)) throw new Error('generated timer binding metadata is missing');
      requireName(entry.generated.declaration, 'generated timer declaration');
      if (!['since', 'initialized'].includes(entry.generated.role)) {
        throw new Error('generated timer binding role mismatch');
      }
      const expected = `__gf_timer_${entry.generated.role}_${entry.generated.declaration}`;
      if (entry.name !== expected) throw new Error('generated timer binding name mismatch');
    } else if (Object.hasOwn(entry, 'generated')) {
      throw new Error('authored source binding cannot be marked generated');
    }
  }

  for (const node of nodes) {
    if (!BINDING_FIELDS.has(node.kind)) continue;
    const grouped = bindingsByNode.get(node.id) ?? [];
    if (node.kind === 'input') {
      if (grouped.length < 1) throw new Error('source trace input binding is missing');
      continue;
    }
    if (node.kind !== 'timer') {
      if (grouped.length !== 1) throw new Error(`source trace ${node.kind} binding count mismatch`);
      continue;
    }
    if (grouped.length !== 2) throw new Error('generated timer binding count mismatch');
    const roles = new Set(grouped.map(entry => entry.generated?.role));
    const declarations = new Set(grouped.map(entry => entry.generated?.declaration));
    if (roles.size !== 2 || !roles.has('since') || !roles.has('initialized') || declarations.size !== 1) {
      throw new Error('generated timer binding pair mismatch');
    }
  }

  const dependencyTargets = new Set();
  for (const dependency of metadata.dependencies) {
    if (!object(dependency) || !object(dependency.target) || !Array.isArray(dependency.reads)) {
      throw new Error('source trace dependency shape mismatch');
    }
    const { field, name } = dependency.target;
    if (!['stateAfter', 'requested'].includes(field)) throw new Error('source trace dependency target field mismatch');
    requireName(name, 'source trace dependency target name');
    const key = `${field}\u0000${name}`;
    if (dependencyTargets.has(key)) throw new Error('duplicate source trace dependency target');
    dependencyTargets.add(key);
    if (!fieldBindings.has(key)) throw new Error('source trace dependency target has no binding');
    const reads = new Set();
    for (const read of dependency.reads) {
      if (!object(read) || !['inputs', 'stateBefore', 'stateAfter'].includes(read.field)) {
        throw new Error('source trace dependency read field mismatch');
      }
      requireName(read.name, 'source trace dependency read name');
      const readKey = `${read.field}\u0000${read.name}`;
      if (reads.has(readKey)) throw new Error('duplicate source trace dependency read');
      reads.add(readKey);
    }
  }

  const constraintNodes = nodes.filter(node => object(node) && (node.kind === 'require' || node.kind === 'mutex'));
  if (metadata.constraints.length !== constraintNodes.length) throw new Error('source trace constraint coverage mismatch');
  const usedConstraintNodes = new Set();
  for (const [position, entry] of metadata.constraints.entries()) {
    if (!object(entry) || entry.index !== position || !Number.isInteger(entry.nodeId)
        || !Array.isArray(entry.names) || entry.names.length === 0) {
      throw new Error('source trace constraint shape mismatch');
    }
    for (const name of entry.names) requireName(name, 'source trace constraint name');
    const node = nodeById.get(entry.nodeId);
    const kindMatches = node?.kind === 'mutex' ? entry.kind === 'mutex'
      : node?.kind === 'require' && ['requires', 'requires-any', 'mutex'].includes(entry.kind);
    if (!kindMatches || usedConstraintNodes.has(entry.nodeId)) throw new Error('source trace constraint node mismatch');
    usedConstraintNodes.add(entry.nodeId);
    requireNodePosition(entry, node, `source trace constraint ${entry.index}`);
  }
  if (usedConstraintNodes.size !== constraintNodes.length) throw new Error('source trace constraint coverage mismatch');
  return metadata;
}

/** Keep both coordinate systems; never fabricate an original location. */
export function remapSourceTrace(metadata, extractionMap) {
  if (!metadata) return metadata;
  const remap = entry => {
    const position = mapSourcePosition(extractionMap, entry.source.line, entry.source.column);
    return { ...entry, extractedSource: entry.source, source: position ? {
      filename: position.file, line: position.line, column: position.column,
    } : null };
  };
  const remapIntentLink = entry => {
    const source = mapRange(extractionMap, entry.source);
    if (!source) throw new Error('intent link target cannot be remapped to literate source');
    return { ...entry, source, extractedSource: entry.source };
  };
  return {
    ...metadata,
    bindings: metadata.bindings.map(remap),
    constraints: metadata.constraints.map(remap),
    ...(Object.hasOwn(metadata, 'intentLinks')
      ? { intentLinks: metadata.intentLinks.map(remapIntentLink) } : {}),
  };
}

/** Joins observed fields only. It does not evaluate expressions or infer causes. */
export function observeSourceTrace(metadata, trace) {
  if (metadata?.format !== 'GhostFlow/source-trace-v1' || trace?.module !== metadata.moduleFingerprint) {
    throw new Error('source/trace module identity mismatch');
  }
  const observations = trace.safetyTrace;
  if (observations?.format !== 'GhostFlow/safety-trace-v1' || !Array.isArray(observations.constraints)
      || observations.constraints.length !== metadata.constraints.length) throw new Error('safety trace unavailable or incompatible');
  const constraints = metadata.constraints.map((entry, index) => {
    const observed = observations.constraints[index];
    if (observed.index !== entry.index || observed.kind !== entry.kind || JSON.stringify(observed.names) !== JSON.stringify(entry.names)) {
      throw new Error('constraint source/trace mapping mismatch');
    }
    return { ...entry, observed };
  });
  const bindings = metadata.bindings.map(entry => ({ ...entry, observations: entry.fields.map(field => {
    const values = trace[field];
    const observed = values !== null && typeof values === 'object' && Object.hasOwn(values, entry.name);
    return { field, observed, ...(observed ? { value: values[entry.name] } : {}) };
  }) }));
  return {
    format: 'GhostFlow/source-observation-v1',
    ...(Object.hasOwn(metadata, 'sourceDocumentSha256')
      ? { sourceDocumentSha256: metadata.sourceDocumentSha256 } : {}),
    ...(Object.hasOwn(metadata, 'bytecodeSha256') ? { bytecodeSha256: metadata.bytecodeSha256 } : {}),
    dependencies: metadata.dependencies, bindings, constraints,
  };
}

function observedScalar(values, name) {
  if (!object(values) || !Object.hasOwn(values, name)) return null;
  const value = values[name];
  return typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Projects authored state and timer declarations into stable, public runtime
 * values. Generated `__gf_` storage names stay an implementation detail: a
 * consumer receives the authored timer name and its Duration in integer ms.
 *
 * This observes a completed scan. Missing fields remain missing; they are not
 * replaced with plausible zero/false values.
 */
export function observeRuntimeValues(metadata, trace) {
  if (metadata?.format !== 'GhostFlow/source-trace-v1' || trace?.module !== metadata.moduleFingerprint) {
    throw new Error('source/trace module identity mismatch');
  }
  if (!Array.isArray(metadata.bindings)) throw new Error('source trace bindings are unavailable');

  const values = [];
  const stateNames = new Set();
  const timers = new Map();
  for (const binding of metadata.bindings) {
    if (binding?.kind === 'state' && typeof binding.name === 'string'
        && !binding.name.startsWith('__gf_') && !stateNames.has(binding.name)) {
      stateNames.add(binding.name);
      const value = observedScalar(trace.stateAfter, binding.name);
      if (value !== null) values.push({
        kind: 'state', name: binding.name,
        valueType: typeof value === 'boolean' ? 'Bool' : 'Number', value,
      });
      continue;
    }
    if (binding?.kind !== 'timer' || !object(binding.generated)) continue;
    const { declaration, role } = binding.generated;
    if (typeof declaration !== 'string' || !['since', 'initialized'].includes(role)) {
      throw new Error('generated timer binding metadata is invalid');
    }
    const timer = timers.get(declaration) ?? { nodeId: binding.nodeId, source: binding.source };
    if (timer.nodeId !== binding.nodeId || Object.hasOwn(timer, role)) {
      throw new Error(`generated timer binding pair mismatch for ${declaration}`);
    }
    timer[role] = binding.name;
    timers.set(declaration, timer);
  }

  for (const [name, timer] of timers) {
    if (typeof timer.since !== 'string' || typeof timer.initialized !== 'string') {
      throw new Error(`generated timer binding pair mismatch for ${name}`);
    }
    const initialized = observedScalar(trace.stateAfter, timer.initialized);
    const since = observedScalar(trace.stateAfter, timer.since);
    const now = observedScalar(trace.inputs, '__gf_now_ms');
    if (typeof initialized !== 'boolean' || typeof since !== 'number' || typeof now !== 'number') continue;
    const value = initialized ? now - since : 0;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`timer ${name} observation is not a non-negative safe integer`);
    values.push({ kind: 'timer', name, valueType: 'Duration', unit: 'ms', value });
  }
  return Object.freeze({
    format: 'GhostFlow/runtime-values-v1',
    moduleFingerprint: metadata.moduleFingerprint,
    values: Object.freeze(values.map(value => Object.freeze(value))),
  });
}
