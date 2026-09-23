import { extractLiterate, mapSourcePosition } from './literate.mjs';
import { canonicalJson } from './canonical-json.mjs';

// Reference §2.5 fixes these enum identities and ordinal order.
export const RESULT_FAULT_MEMBERS = Object.freeze({
  SensorFault: Object.freeze(['Disconnected', 'Stale', 'Invalid', 'NotReady']),
  ClockFault: Object.freeze(['ClockUnknown', 'ZoneUnsupported']),
  CalendarFault: Object.freeze(['ClockUnknown', 'CalendarMissing', 'CalendarOutOfRange', 'ZoneUnsupported']),
  TemporalContextFault: Object.freeze(['ClockUnknown', 'LocationUnknown', 'EventUnavailable', 'PredictionMissing', 'PredictionStale', 'ZoneUnsupported']),
});

/** Diagnostic identity matching the portable core; NOT a cryptographic digest. */
export function moduleFingerprint(bytes) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}

const BINDING_FIELDS = new Map([
  ['input', ['inputs']],
  ['state', ['stateBefore', 'stateAfter']],
  ['next', ['stateAfter']],
  ['connection', ['requested', 'safe']],
  ['timer', ['stateBefore', 'stateAfter']],
  ['signal', ['stateBefore', 'stateAfter']],
  ['schedule', ['inputs']],
]);
const TRACEABLE_NODE_KINDS = new Set([...BINDING_FIELDS.keys(), 'require', 'mutex']);
const INTENT_KINDS = new Set(['intent', 'premise', 'assumption']);
const INTENT_STATUSES = new Set(['confirmed', 'unconfirmed', 'superseded']);
const INTENT_ORIGINS = new Set(['user', 'operator', 'engineer', 'ai', 'imported']);
const INTENT_RELATIONS = new Set(['implements', 'constrains', 'fallback', 'assumes']);
const INTENT_TARGET_KINDS = new Set([
  'input', 'output', 'state', 'config', 'parameter', 'let', 'enum', 'function', 'sensor',
  'signal', 'schedule', 'timer', 'require', 'mutex', 'next', 'connection',
]);
const ANCHOR_FIELDS = ['id', 'kind', 'status', 'origin', 'directiveSource', 'source'];
const LINK_FIELDS = ['anchorId', 'relation', 'nodeId', 'nodeKind', 'directiveSource', 'source', 'extractedDirectiveSource', 'extractedSource'];
const COUNTER_LINK_FIELDS = [...LINK_FIELDS, 'meaning'];

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
  const lines = document.text.replace(/\r\n?/g, '\n').split('\n');
  if (value.line > lines.length || value.endLine > lines.length
      || value.column > lines[value.line - 1].length + 1
      || value.endColumn > lines[value.endLine - 1].length + 1) {
    throw new Error(`${label} range is outside source document`);
  }
}

function rangeText(document, value) {
  if (value.line !== value.endLine) return null;
  return document.text.replace(/\r\n?/g, '\n').split('\n')[value.line - 1].slice(value.column - 1, value.endColumn - 1);
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
  if (!source) return new Error(message);
  const error = new Error(`${source.filename}:${source.line}:${source.column}: ${message}`);
  error.filename = source.filename;
  error.line = source.line;
  error.column = source.column;
  return error;
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
  return Array.isArray(nodes) && nodes.some(node => object(node) && TRACEABLE_NODE_KINDS.has(node.kind)
    && (node.kind !== 'signal' || ['debounce', 'hold_last'].includes(node.signalMode) || node.signalMode?.startsWith('window_')));
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
function expressionDependencies(expression, windows = []) {
  const reads = [];
  const seen = new Set();
  const visit = value => {
    if (Array.isArray(value)) {
      if (value[0] === 'window-read') {
        const slot = Number(value[1]);
        const window = windows[slot];
        if (!Number.isInteger(slot) || !window) throw new Error('window dependency references an unknown prior slot');
        const read = { field: 'windowTrace', name: window.name };
        const key = `${read.field}\u0000${read.name}`;
        if (!seen.has(key)) { seen.add(key); reads.push(read); }
        return;
      }
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

function windowDependencies(generatedWindows) {
  const dependencies = [];
  const prior = [];
  for (const generated of generatedWindows) {
    const reads = []; const seen = new Set();
    const add = read => {
      const key = `${read.field}\u0000${read.name}`;
      if (!seen.has(key)) { seen.add(key); reads.push(read); }
    };
    for (const expression of Object.values(generated.source)) {
      for (const read of expressionDependencies(expression, prior)) add(read);
    }
    for (const root of generated.descriptor.sources) for (const role of ['present', 'epoch', 'id', 'timestamp']) {
      add({ field: 'inputs', name: `__gf_sensor_sample_${role}_${root.name}` });
    }
    add({ field: 'inputs', name: generated.descriptor.clockInput });
    add({ field: 'inputs', name: generated.descriptor.timeEpochInput });
    dependencies.push({ target: { field: 'windowTrace', name: generated.descriptor.name }, reads });
    prior.push(generated.descriptor);
  }
  return dependencies;
}

function dependenciesForForms(transitions, intents, generatedTimers = [], windows = []) {
  const dependencies = [];
  const add = (form, field) => {
    if (!Array.isArray(form) || typeof form[1] !== 'string') return;
    dependencies.push({ target: { field, name: form[1] }, reads: expressionDependencies(form[2], windows) });
  };
  for (const transition of transitions) if (transition?.[0] === 'next') add(transition, 'stateAfter');
  for (const intent of intents) if (intent?.[0] === 'intent') add(intent, 'requested');
  for (const timer of generatedTimers) if (timer?.role === 'since' && Array.isArray(timer.value)) {
    dependencies.push({
      target: { field: 'timerValue', name: timer.node.name },
      reads: expressionDependencies(timer.value, windows),
    });
  }
  return dependencies;
}

function timerRoles(node) {
  return node.call?.name === 'continuous_true' ? ['since', 'wasTrue'] : ['since', 'initialized'];
}

function generatedTimerState(role, declaration) {
  return `__gf_timer_${role === 'wasTrue' ? 'was_true' : role}_${declaration}`;
}

const DEBOUNCE_ROLES = Object.freeze(['stable', 'candidate', 'candidateActive', 'candidateSince', 'lastSourceTag']);
const HOLD_ROLES = Object.freeze(['available', 'value', 'heldSourceTag', 'heldEpoch', 'heldId', 'heldTimestamp', 'held', 'age', 'maskedFaultPresent', 'maskedFaultCode', 'maskedFaultOrigin']);
const DEBOUNCE_SOURCE_ROLES = Object.freeze(['sourceEpoch', 'sourceId']);
const signalRoles = mode => mode === 'hold_last' ? HOLD_ROLES : DEBOUNCE_ROLES;
function validSignalRole({ role, sourceTag }, mode) {
  return signalRoles(mode).includes(role) ? sourceTag === undefined
    : DEBOUNCE_SOURCE_ROLES.includes(role) && Number.isSafeInteger(sourceTag) && sourceTag > 0;
}
function generatedSignalState(role, declaration, sourceTag, mode) {
  const suffix = sourceTag === undefined ? '' : `_${sourceTag}`;
  return `__gf_${mode}_${role.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}_${declaration}${suffix}`;
}
function requireSignalRoles(entries, mode) {
  const roles = signalRoles(mode);
  const common = entries.filter(entry => roles.includes(entry.role));
  const sources = entries.filter(entry => DEBOUNCE_SOURCE_ROLES.includes(entry.role));
  const tags = new Set(sources.map(entry => entry.sourceTag));
  if (common.length !== roles.length
      || new Set(common.map(entry => entry.role)).size !== roles.length
      || sources.length !== 2 * tags.size
      || [...tags].some(tag => new Set(sources.filter(entry => entry.sourceTag === tag).map(entry => entry.role)).size !== 2)) {
    throw new Error(`generated ${mode} binding count or roles mismatch`);
  }
}

/** Consumes the authoritative parsed AST, lowered constraints, forms, and generated timer state names. */
export function buildSourceTrace(ast, constraints, bytes, transitions = [], intents = [], generatedTimers = [], resultSites = [], generatedSignals = [], generatedWindows = []) {
  const bindings = [];
  const add = (node, name, fields, extra = {}) => bindings.push({
    nodeId: node.id, kind: node.kind, name, fields, source: { ...node.loc }, ...extra,
  });
  const timers = new Map();
  const signals = new Map();
  for (const generated of generatedSignals) {
    if (!object(generated) || generated.node?.kind !== 'signal'
        || !['debounce', 'hold_last'].includes(generated.node.call?.name) || !validSignalRole(generated, generated.node.call.name)
        || generated.name !== generatedSignalState(generated.role, generated.node.name, generated.sourceTag, generated.node.call.name)) {
      throw new Error('invalid generated debounce source binding');
    }
    const key = `${generated.node.id}\u0000${generated.role}\u0000${generated.sourceTag ?? ''}`;
    if (signals.has(key)) throw new Error('duplicate generated debounce source binding');
    signals.set(key, generated);
  }
  for (const generated of generatedTimers) {
    if (!object(generated) || !object(generated.node) || generated.node.kind !== 'timer'
        || !timerRoles(generated.node).includes(generated.role)) {
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
    if (node.kind === 'adapt') for (const strategy of node.strategies) {
      for (const statement of strategy.body) if (statement.kind === 'connection') {
        add(statement, statement.name, ['requested', 'safe'], { strategy: strategy.name });
      }
    }
    if (node.kind === 'signal' && ['debounce', 'hold_last'].includes(node.call?.name)) {
      const entries = [...signals.entries()].filter(([, entry]) => entry.node.id === node.id);
      requireSignalRoles(entries.map(([, entry]) => entry), node.call.name);
      for (const [key, generated] of entries) {
        const metadata = { declaration: node.name, role: generated.role };
        if (generated.sourceTag !== undefined) metadata.sourceTag = generated.sourceTag;
        add(node, generated.name, ['stateBefore', 'stateAfter'], { generated: metadata });
        signals.delete(key);
      }
    }
    if (node.kind === 'timer') for (const role of timerRoles(node)) {
      const generated = timers.get(`${node.id}\u0000${role}`);
      if (!generated) throw new Error(`missing generated ${role} state for timer ${node.name}`);
      add(node, generated.name, ['stateBefore', 'stateAfter'], {
        generated: { declaration: node.name, role },
      });
      timers.delete(`${node.id}\u0000${role}`);
    }
  }
  if (timers.size) throw new Error('generated timer source binding has no authoritative declaration');
  if (signals.size) throw new Error('generated debounce source binding has no authoritative declaration');
  if (!Array.isArray(resultSites)) throw new Error('result trace sites must be an array');
  if (!Array.isArray(generatedWindows)) throw new Error('window trace sites must be an array');
  const windowSites = generatedWindows.map((generated, slot) => {
    if (!object(generated) || generated.node?.kind !== 'signal' || !generated.node.call?.name?.startsWith('window_')
        || !object(generated.descriptor) || generated.descriptor.kind !== 'window' || generated.descriptor.slot !== slot
        || generated.descriptor.site !== generated.node.id || generated.descriptor.name !== generated.node.name
        || !object(generated.source) || !Array.isArray(generated.origins)) throw new Error('invalid generated window source binding');
    const descriptor = generated.descriptor;
    return {
      site: descriptor.site, slot, nodeId: generated.node.id, name: descriptor.name, operation: descriptor.operation,
      payloadType: descriptor.payloadType, errorType: descriptor.errorType, quality: descriptor.quality,
      overMs: descriptor.overMs, maxAgeMs: descriptor.maxAgeMs, clockInput: descriptor.clockInput,
      timeEpochInput: descriptor.timeEpochInput, sources: descriptor.sources.map(source => ({ ...source })),
      ...(descriptor.upstreamWindows ? { upstreamWindows: descriptor.upstreamWindows.map(window => ({ ...window })) } : {}),
      origins: generated.origins.map(origin => ({ ...origin })), source: { ...generated.node.loc },
    };
  });
  const sourceConstraints = ast.body.filter(node => node.kind === 'require' || node.kind === 'mutex');
  if (sourceConstraints.length !== constraints.length) throw new Error('constraint source mapping mismatch');
  return {
    format: 'GhostFlow/source-trace-v1', moduleFingerprint: moduleFingerprint(bytes), bindings,
    dependencies: [...windowDependencies(generatedWindows), ...dependenciesForForms(transitions, intents, generatedTimers, windowSites)],
    constraints: constraints.map(([kind, ...names], index) => ({
      index, kind, names, nodeId: sourceConstraints[index].id, source: { ...sourceConstraints[index].loc },
    })),
    resultSites: resultSites.map(site => ({
      ...site, source: { ...site.source }, origins: site.origins.map(origin => ({ ...origin })),
    })),
    ...(windowSites.length ? { windowSites } : {}),
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
        ...(linked.meaning ? { meaning: linked.meaning } : {}),
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
  timerDescriptors, expectedTimerDependencies, expectedResultSites, expectedSignalBindings, expectedSignalDependencies,
  expectedWindowSites, expectedWindowDependencies,
} = {}) {
  if (!object(metadata) || metadata.format !== 'GhostFlow/source-trace-v1') {
    throw new Error('source trace metadata format mismatch');
  }
  const allowedMetadataFields = new Set([
    'format', 'moduleFingerprint', 'bindings', 'dependencies', 'constraints', 'resultSites',
    'windowSites', 'sourceDocumentSha256', 'bytecodeSha256', 'intentAnchors', 'intentLinks',
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
      || !Array.isArray(metadata.constraints) || !Array.isArray(metadata.resultSites)) {
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

  const resultSiteIds = new Set();
  for (const site of metadata.resultSites) {
    requireExactFields(site, ['site', 'nodeId', 'kind', 'errorType', 'source', 'origins',
      ...(Object.hasOwn(site, 'extractedSource') ? ['extractedSource'] : [])], 'result trace site');
    if (!Number.isInteger(site.site) || site.site < 1 || site.site > 0xffff_ffff || site.nodeId !== site.site
        || !['recover', 'case'].includes(site.kind) || typeof site.errorType !== 'string'
        || !Object.hasOwn(RESULT_FAULT_MEMBERS, site.errorType) || resultSiteIds.has(site.site)) {
      throw new Error('result trace site identity mismatch');
    }
    resultSiteIds.add(site.site);
    const node = nodeById.get(site.nodeId);
    if (!node || node.kind !== (site.kind === 'recover' ? 'call' : 'case') || !sameRange(site.source, rangeFromNode(node))) {
      throw new Error('result trace site source mismatch');
    }
    requireRange(site.source, 'result trace site source', sourceDocument);
    if (Object.hasOwn(node, 'extracted') !== Object.hasOwn(site, 'extractedSource')
        || (Object.hasOwn(node, 'extracted') && !sameRange(site.extractedSource, node.extracted))) {
      throw new Error('result trace site extracted source mismatch');
    }
    if (!Array.isArray(site.origins)) throw new Error('result trace origins must be an array');
    const originTags = new Set();
    for (const origin of site.origins) {
      const named = origin?.kind === 'sensor' || origin?.kind === 'signal';
      requireExactFields(origin, named ? ['tag', 'nodeId', 'kind', 'name'] : ['tag', 'nodeId', 'kind'], 'result trace origin');
      if (!Number.isInteger(origin.tag) || origin.tag < 1 || origin.tag > 0xffff_ffff
          || origin.nodeId !== origin.tag || originTags.has(origin.tag)
          || !['sensor', 'signal', 'fault'].includes(origin.kind)) throw new Error('result trace origin identity mismatch');
      originTags.add(origin.tag);
      const originNode = nodeById.get(origin.nodeId);
      if (!originNode || originNode.kind !== (origin.kind === 'fault' ? 'call' : origin.kind)) throw new Error('result trace origin source mismatch');
      if (named) requireName(origin.name, 'result trace origin name');
    }
  }
  if (metadata.resultSites.length && !Array.isArray(expectedResultSites)) {
    throw new Error('canonical result trace sites are required');
  }
  if (Array.isArray(expectedResultSites) && canonicalJson(metadata.resultSites) !== canonicalJson(expectedResultSites)) {
    throw new Error('result trace sites do not match canonical source lowering');
  }

  const windowNodes = nodes.filter(node => node.kind === 'signal' && node.signalMode?.startsWith('window_'));
  if (windowNodes.length && !Array.isArray(metadata.windowSites)) throw new Error('window trace sites are required');
  if (!windowNodes.length && Object.hasOwn(metadata, 'windowSites')) throw new Error('window trace sites have no source declarations');
  const windowNames = new Map();
  for (const [slot, site] of (metadata.windowSites ?? []).entries()) {
    requireExactFields(site, ['site', 'slot', 'nodeId', 'name', 'operation', 'payloadType', 'errorType', 'quality',
      'overMs', 'maxAgeMs', 'clockInput', 'timeEpochInput', 'sources', 'origins', 'source',
      ...(Object.hasOwn(site, 'upstreamWindows') ? ['upstreamWindows'] : []),
      ...(Object.hasOwn(site, 'extractedSource') ? ['extractedSource'] : [])], 'window trace site');
    const node = nodeById.get(site.nodeId);
    if (site.slot !== slot || site.site !== site.nodeId || !node || node.kind !== 'signal'
        || node.signalMode !== `window_${site.operation}` || windowNames.has(site.name)
        || !['average', 'min', 'max', 'rate'].includes(site.operation)
        || typeof site.payloadType !== 'string' || site.errorType !== 'SensorFault' || site.quality !== 'measured'
        || !Number.isSafeInteger(site.overMs) || site.overMs < 1 || !Number.isSafeInteger(site.maxAgeMs) || site.maxAgeMs < 1
        || site.clockInput !== '__gf_now_ms' || site.timeEpochInput !== '__gf_time_epoch'
        || !Array.isArray(site.sources) || !site.sources.length || !Array.isArray(site.origins)) {
      throw new Error('window trace site identity mismatch');
    }
    requireName(site.name, 'window trace site name'); requireNodePosition(site, node, `window trace site ${site.name}`);
    let previousTag = 0;
    for (const source of site.sources) {
      requireExactFields(source, ['name', 'tag'], 'window trace source'); requireName(source.name, 'window trace source name');
      if (!Number.isInteger(source.tag) || source.tag <= previousTag || nodeById.get(source.tag)?.kind !== 'sensor') {
        throw new Error('window trace source identity mismatch');
      }
      previousTag = source.tag;
    }
    const originTags = new Set();
    if (Object.hasOwn(site, 'upstreamWindows')) {
      if (!Array.isArray(site.upstreamWindows) || !site.upstreamWindows.length || site.upstreamWindows.length > slot) {
        throw new Error('window trace evidence dependencies must be a non-empty prior-window list');
      }
      let previousSlot = -1;
      for (const dependency of site.upstreamWindows) {
        requireExactFields(dependency, ['name', 'site', 'slot'], 'window trace evidence dependency');
        const upstream = windowNames.get(dependency.name);
        if (!Number.isInteger(dependency.slot) || dependency.slot <= previousSlot || !upstream
            || dependency.slot !== upstream.slot || dependency.site !== upstream.site
            || upstream.sources.some(root => !site.sources.some(source => source.name === root.name && source.tag === root.tag))) {
          throw new Error('window trace evidence dependency identity mismatch');
        }
        previousSlot = dependency.slot;
      }
    }
    for (const origin of site.origins) {
      const named = origin?.kind === 'sensor' || origin?.kind === 'signal';
      requireExactFields(origin, named ? ['tag', 'nodeId', 'kind', 'name'] : ['tag', 'nodeId', 'kind'], 'window trace origin');
      if (!Number.isInteger(origin.tag) || origin.tag !== origin.nodeId || originTags.has(origin.tag)
          || !['sensor', 'signal', 'fault'].includes(origin.kind) || nodeById.get(origin.nodeId)?.kind !== (origin.kind === 'fault' ? 'call' : origin.kind)) {
        throw new Error('window trace origin identity mismatch');
      }
      if (named) requireName(origin.name, 'window trace origin name'); originTags.add(origin.tag);
    }
    windowNames.set(site.name, site);
  }
  if (windowNodes.length !== (metadata.windowSites?.length ?? 0)) throw new Error('window trace site coverage mismatch');
  if (windowNodes.length && !Array.isArray(expectedWindowSites)) throw new Error('canonical window trace sites are required');
  if (Array.isArray(expectedWindowSites) && canonicalJson(metadata.windowSites) !== canonicalJson(expectedWindowSites)) {
    throw new Error('window trace sites do not match canonical source lowering');
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
      requireExactFields(link, link.meaning === 'counter' ? COUNTER_LINK_FIELDS : LINK_FIELDS, 'intent link');
      if (typeof link.anchorId !== 'string' || !INTENT_RELATIONS.has(link.relation)
          || !Number.isInteger(link.nodeId) || !INTENT_TARGET_KINDS.has(link.nodeKind)) {
        throw new Error('intent link shape mismatch');
      }
      if (link.meaning === 'counter' && (link.relation !== 'implements' || link.nodeKind !== 'state')) {
        throw new Error('counter meaning requires an implemented authored state');
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
          || link.meaning !== expected.directive.meaning
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
  const timerDescriptorsByName = timerDescriptors === undefined ? null : new Map();
  if (timerDescriptorsByName) {
    if (!Array.isArray(timerDescriptors)) throw new Error('timer descriptors must be an array');
    for (const descriptor of timerDescriptors) {
      const continuous = object(descriptor) && Object.hasOwn(descriptor, 'mode');
      requireExactFields(descriptor,
        continuous ? ['name', 'mode', 'clockInput'] : ['name', 'state', 'clockInput'],
        'timer descriptor');
      requireName(descriptor.name, 'timer descriptor name');
      if (continuous && descriptor.mode !== 'continuous-true') throw new Error('timer descriptor mode mismatch');
      if (descriptor.clockInput !== '__gf_now_ms') throw new Error('timer descriptor clock input mismatch');
      if (!continuous) requireName(descriptor.state, 'timer descriptor state');
      if (timerDescriptorsByName.has(descriptor.name)) throw new Error('duplicate timer descriptor');
      timerDescriptorsByName.set(descriptor.name, descriptor);
    }
  }
  const verifiedTimerDescriptors = new Set();
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

    if (entry.kind === 'signal') {
      if (!['debounce', 'hold_last'].includes(node.signalMode) || !object(entry.generated)
          || !validSignalRole(entry.generated, node.signalMode)) throw new Error('generated signal binding shape mismatch');
      requireExactFields(entry.generated, DEBOUNCE_SOURCE_ROLES.includes(entry.generated.role)
        ? ['declaration', 'role', 'sourceTag'] : ['declaration', 'role'], 'generated debounce binding');
      requireName(entry.generated.declaration, 'generated debounce declaration');
      if (entry.name !== generatedSignalState(entry.generated.role, entry.generated.declaration, entry.generated.sourceTag, node.signalMode)) {
        throw new Error('generated debounce binding name mismatch');
      }
    } else if (entry.kind === 'timer') {
      if (!object(entry.generated)) throw new Error('generated timer binding metadata is missing');
      requireName(entry.generated.declaration, 'generated timer declaration');
      if (!['since', 'initialized', 'wasTrue'].includes(entry.generated.role)) {
        throw new Error('generated timer binding role mismatch');
      }
      const expected = generatedTimerState(entry.generated.role, entry.generated.declaration);
      if (entry.name !== expected) throw new Error('generated timer binding name mismatch');
      fieldBindings.add(`timerValue\u0000${entry.generated.declaration}`);
    } else if (Object.hasOwn(entry, 'generated')) {
      throw new Error('authored source binding cannot be marked generated');
    }
  }

  for (const node of nodes) {
    if (!BINDING_FIELDS.has(node.kind)) continue;
    if (node.kind === 'signal' && !['debounce', 'hold_last'].includes(node.signalMode)) continue;
    const grouped = bindingsByNode.get(node.id) ?? [];
    if (node.kind === 'signal') {
      requireSignalRoles(grouped.map(entry => entry.generated), node.signalMode);
      if (new Set(grouped.map(entry => entry.generated.declaration)).size !== 1) {
        throw new Error('generated debounce binding count or roles mismatch');
      }
      continue;
    }
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
    const [declaration] = declarations;
    const descriptor = timerDescriptorsByName?.get(declaration);
    if (!['elapsed', 'continuous-true'].includes(node.timerMode)) throw new Error('timer source node mode mismatch');
    const continuous = node.timerMode === 'continuous-true';
    if (continuous && !timerDescriptorsByName) {
      throw new Error('continuous timer source binding requires its manifest descriptor');
    }
    if (timerDescriptorsByName && !descriptor) throw new Error('timer source binding has no manifest descriptor');
    if (descriptor && (descriptor.mode === 'continuous-true') !== continuous) {
      throw new Error('timer source binding mode does not match manifest descriptor');
    }
    if (roles.size !== 2 || !roles.has('since') || declarations.size !== 1
        || (continuous ? !roles.has('wasTrue') || roles.has('initialized')
          : !roles.has('initialized') || roles.has('wasTrue'))) {
      throw new Error('generated timer binding pair mismatch');
    }
    if (descriptor) verifiedTimerDescriptors.add(descriptor.name);
  }
  if (timerDescriptorsByName && verifiedTimerDescriptors.size !== timerDescriptorsByName.size) {
    throw new Error('manifest timer descriptor has no source binding');
  }
  const signalBindings = metadata.bindings.filter(entry => entry.kind === 'signal');
  if ((signalBindings.length || nodes.some(node => node.kind === 'signal' && ['debounce', 'hold_last'].includes(node.signalMode)))
      && !Array.isArray(expectedSignalBindings)) throw new Error('canonical debounce bindings are required');
  if (Array.isArray(expectedSignalBindings) && canonicalJson(signalBindings) !== canonicalJson(expectedSignalBindings)) {
    throw new Error('debounce bindings do not match canonical source lowering');
  }
  if (Array.isArray(expectedSignalBindings)) {
    const generatedNames = new Set(expectedSignalBindings.map(entry => entry.name));
    const actual = metadata.dependencies.filter(entry => entry.target?.field === 'stateAfter' && generatedNames.has(entry.target.name));
    if (!Array.isArray(expectedSignalDependencies) || canonicalJson(actual) !== canonicalJson(expectedSignalDependencies)) {
      throw new Error('debounce dependencies do not match canonical source lowering');
    }
  }

  const dependencyTargets = new Set();
  for (const dependency of metadata.dependencies) {
    if (!object(dependency) || !object(dependency.target) || !Array.isArray(dependency.reads)) {
      throw new Error('source trace dependency shape mismatch');
    }
    const { field, name } = dependency.target;
    if (!['stateAfter', 'requested', 'timerValue', 'windowTrace'].includes(field)) throw new Error('source trace dependency target field mismatch');
    requireName(name, 'source trace dependency target name');
    const key = `${field}\u0000${name}`;
    if (dependencyTargets.has(key)) throw new Error('duplicate source trace dependency target');
    dependencyTargets.add(key);
    if (field === 'windowTrace' ? !windowNames.has(name) : !fieldBindings.has(key)) throw new Error('source trace dependency target has no binding');
    const reads = new Set();
    for (const read of dependency.reads) {
      if (!object(read) || !['inputs', 'stateBefore', 'stateAfter', 'windowTrace'].includes(read.field)) {
        throw new Error('source trace dependency read field mismatch');
      }
      requireName(read.name, 'source trace dependency read name');
      const readKey = `${read.field}\u0000${read.name}`;
      if (reads.has(readKey)) throw new Error('duplicate source trace dependency read');
      if (read.field === 'windowTrace' && (!windowNames.has(read.name)
          || field === 'windowTrace' && windowNames.get(read.name).slot >= windowNames.get(name).slot)) {
        throw new Error('window dependency must reference an available slot');
      }
      reads.add(readKey);
    }
  }
  if (windowNames.size) {
    const targets = metadata.dependencies.filter(entry => entry.target?.field === 'windowTrace');
    if (targets.length !== windowNames.size) throw new Error('window trace dependency coverage mismatch');
    const actual = metadata.dependencies.filter(entry => entry.target?.field === 'windowTrace'
      || entry.reads?.some(read => read.field === 'windowTrace'));
    if (!Array.isArray(expectedWindowDependencies)) throw new Error('canonical window trace dependencies are required');
    if (canonicalJson(actual) !== canonicalJson(expectedWindowDependencies)) {
      throw new Error('window trace dependencies do not match canonical source lowering');
    }
  }
  if (timerDescriptorsByName) for (const descriptor of timerDescriptorsByName.values()) {
    if (descriptor.mode === 'continuous-true'
        && !dependencyTargets.has(`timerValue\u0000${descriptor.name}`)) {
      throw new Error('continuous timer value dependency is missing');
    }
  }
  const continuousTimerNames = new Set(timerDescriptorsByName
    ? [...timerDescriptorsByName.values()]
      .filter(descriptor => descriptor.mode === 'continuous-true')
      .map(descriptor => descriptor.name)
    : []);
  if (continuousTimerNames.size) {
    if (!Array.isArray(expectedTimerDependencies)) {
      throw new Error('continuous timer canonical dependencies are required');
    }
    const actual = metadata.dependencies.filter(entry => (
      entry.target?.field === 'timerValue' && continuousTimerNames.has(entry.target.name)
    ));
    if (JSON.stringify(actual) !== JSON.stringify(expectedTimerDependencies)) {
      throw new Error('continuous timer value dependencies do not match canonical source lowering');
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
    resultSites: metadata.resultSites.map(entry => {
      const source = mapRange(extractionMap, entry.source);
      if (!source) throw new Error('result trace site cannot be remapped to literate source');
      return { ...entry, source, extractedSource: entry.source };
    }),
    ...(Array.isArray(metadata.windowSites) ? { windowSites: metadata.windowSites.map(entry => {
      const source = mapRange(extractionMap, entry.source);
      if (!source) throw new Error('window trace site cannot be remapped to literate source');
      return { ...entry, source, extractedSource: entry.source };
    }) } : {}),
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
  if (!Array.isArray(metadata.resultSites) || !Array.isArray(trace.resultTrace)) {
    throw new Error('result trace metadata or events are unavailable');
  }
  const resultSites = new Map();
  for (const site of metadata.resultSites) {
    if (!object(site) || !Number.isInteger(site.site) || site.site < 1 || site.site > 0xffff_ffff
        || resultSites.has(site.site) || typeof site.errorType !== 'string' || !Object.hasOwn(RESULT_FAULT_MEMBERS, site.errorType)
        || !Array.isArray(site.origins)) throw new Error('result trace site identity mismatch');
    resultSites.set(site.site, site);
  }
  const resultEvents = trace.resultTrace.map(event => {
    requireExactFields(event, ['site', 'choice', 'origin'], 'result trace event');
    const site = resultSites.get(event.site);
    if (!site || !Number.isInteger(event.choice) || event.choice < 0
        || event.choice > RESULT_FAULT_MEMBERS[site.errorType].length
        || !Number.isInteger(event.origin) || event.origin < 0 || event.origin > 0xffff_ffff) {
      throw new Error('result trace event identity or domain mismatch');
    }
    const originDescriptor = event.choice === 0 ? null : site.origins.find(origin => origin.tag === event.origin);
    if (event.choice === 0 ? event.origin !== 0 : !originDescriptor) {
      throw new Error('result trace event origin mismatch');
    }
    return { ...event, kind: site.kind, source: site.source, errorType: site.errorType,
      fault: event.choice === 0 ? null : RESULT_FAULT_MEMBERS[site.errorType][event.choice - 1],
      originDescriptor };
  });
  const bindings = metadata.bindings.map(entry => ({ ...entry, observations: entry.fields.map(field => {
    const values = trace[field];
    const observed = values !== null && typeof values === 'object' && Object.hasOwn(values, entry.name);
    return { field, observed, ...(observed ? { value: values[entry.name] } : {}) };
  }) }));
  const windowEvents = observeWindowEvents(metadata.windowSites, trace.windowTrace);
  return {
    format: 'GhostFlow/source-observation-v1',
    ...(Object.hasOwn(metadata, 'sourceDocumentSha256')
      ? { sourceDocumentSha256: metadata.sourceDocumentSha256 } : {}),
    ...(Object.hasOwn(metadata, 'bytecodeSha256') ? { bytecodeSha256: metadata.bytecodeSha256 } : {}),
    dependencies: metadata.dependencies, bindings, constraints, resultEvents, windowEvents,
    heldEvents: observeHeldEvents(metadata.bindings, trace.stateAfter),
  };
}

function windowEvidenceKey(point) {
  return point.kind === 'derived'
    ? [1, point.site, point.timeEpoch, point.admissionRevision]
    : [0, point.sourceTag, point.epoch, point.id];
}

function windowEvidenceOrder(left, right) {
  const a = [left.timestampMs, ...windowEvidenceKey(left)];
  const b = [right.timestampMs, ...windowEvidenceKey(right)];
  return a.map((value, index) => value - b[index]).find(value => value !== 0) ?? 0;
}

// Validate retained proof structure and identity. Aggregate arithmetic stays in Rust.
function windowProofValidator(sites, record) {
  const proof = record.proof;
  const visited = new Set();
  const bySite = new Map(sites.map(site => [site.site, site]));
  const safe = value => Number.isSafeInteger(value) && value >= 0;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const valueFits = (value, site) => finite(value) && (site.payloadType !== 'Int'
    || Number.isInteger(value) && value >= -2147483648 && value <= 2147483647);
  const fail = () => { throw new Error('window proof identity, domain or tree mismatch'); };
  function visit(index, owner, nowMs) {
    const node = proof?.[index];
    if (!safe(index) || !object(node) || visited.has(index)) fail();
    visited.add(index);
    if (!safe(node.timestampMs) || node.timestampMs > nowMs || nowMs - node.timestampMs >= owner.overMs
        || !valueFits(node.suppliedValue, owner) || !safe(node.childCount)
        || !safe(node.subtreeSize) || node.subtreeSize < 1 || index + node.subtreeSize > proof.length) fail();
    if (node.kind === 'physical') {
      requireExactFields(node, ['kind', 'sourceTag', 'epoch', 'id', 'timestampMs', 'value', 'suppliedValue', 'childCount', 'subtreeSize'], 'window proof physical leaf');
      if (!owner.sources.some(source => source.tag === node.sourceTag) || !safe(node.epoch) || !safe(node.id)
          || node.value !== node.suppliedValue || node.childCount !== 0 || node.subtreeSize !== 1) fail();
      return index + 1;
    }
    requireExactFields(node, ['kind', 'site', 'timeEpoch', 'admissionRevision', 'timestampMs', 'evaluatedAtMs',
      'value', 'suppliedValue', 'operation', 'childCount', 'subtreeSize'], 'window proof aggregate');
    const upstream = bySite.get(node.site);
    if (node.kind !== 'derived' || !upstream || !owner.upstreamWindows?.some(item => item.site === node.site)
        || upstream.slot >= owner.slot || node.operation !== upstream.operation || !valueFits(node.value, upstream)
        || node.timeEpoch !== record.timeEpoch || !safe(node.admissionRevision) || node.admissionRevision === 0
        || !safe(node.evaluatedAtMs) || node.evaluatedAtMs > nowMs || node.timestampMs > node.evaluatedAtMs
        || node.evaluatedAtMs - node.timestampMs >= upstream.maxAgeMs || node.childCount < 1
        || node.childCount >= node.subtreeSize) fail();
    let next = index + 1; let previous = null; let first = null; let last = null;
    const identities = new Set();
    for (let child = 0; child < node.childCount; child++) {
      const point = proof[next];
      if (!object(point)) fail();
      const identity = windowEvidenceKey(point).join(':');
      if (identities.has(identity) || previous && windowEvidenceOrder(previous, point) >= 0) fail();
      identities.add(identity);
      next = visit(next, upstream, node.evaluatedAtMs);
      first ??= point; last = point; previous = point;
    }
    if (next !== index + node.subtreeSize || last.timestampMs !== node.timestampMs
        || upstream.operation === 'rate' && (node.childCount < 2 || first.timestampMs >= last.timestampMs)) fail();
    return next;
  }
  return {
    contributor(point, owner) {
      if (!Array.isArray(proof) || !proof.length) fail();
      visit(point.proofRoot, owner, record.nowMs);
      const root = proof[point.proofRoot];
      if (root.kind !== 'derived' || root.site !== point.site || root.timeEpoch !== point.timeEpoch
          || root.admissionRevision !== point.admissionRevision || root.timestampMs !== point.timestampMs
          || root.evaluatedAtMs !== point.evaluatedAtMs || root.suppliedValue !== point.value) fail();
    },
    finish() {
      if (proof === undefined) return {};
      if (!Array.isArray(proof) || !proof.length || visited.size !== proof.length) fail();
      return { proof: proof.map(node => ({ ...node })) };
    },
  };
}

function observeWindowEvents(sites, records) {
  if (sites === undefined) {
    if (records !== undefined) throw new Error('window trace has no source metadata');
    return [];
  }
  if (!Array.isArray(sites) || !Array.isArray(records) || records.length !== sites.length) {
    throw new Error('window trace metadata or records are unavailable');
  }
  const safe = value => Number.isSafeInteger(value) && value >= 0;
  const scalarType = site => site.payloadType === 'Int' ? 'int' : 'number';
  return sites.map((site, slot) => {
    const record = records[slot];
    requireExactFields(record, ['site', 'payloadType', 'operation', 'value', 'quality', 'count', 'admissionRevision',
      'timeEpoch', 'nowMs', 'first', 'last', 'contributors', 'upstreamFault',
      ...(Object.hasOwn(record, 'proof') ? ['proof'] : [])], 'window trace record');
    const machineType = scalarType(site);
    if (site.slot !== slot || record.site !== site.site || record.operation !== site.operation || record.payloadType !== machineType
        || ![0, 3].includes(record.quality) || !safe(record.count) || !safe(record.admissionRevision)
        || !safe(record.timeEpoch) || !safe(record.nowMs) || !Array.isArray(record.contributors)
        || record.count !== record.contributors.length) throw new Error('window trace record identity or domain mismatch');
    const sources = new Map(site.sources.map(source => [source.tag, source]));
    const proofs = windowProofValidator(sites, record);
    const point = value => {
      if (value?.kind === 'derived') {
        requireExactFields(value, ['kind', 'site', 'timeEpoch', 'admissionRevision', 'timestampMs', 'evaluatedAtMs', 'value', 'proofRoot'], 'window trace derived contributor');
        if (!safe(value.timestampMs) || value.timestampMs > record.nowMs || record.nowMs - value.timestampMs >= site.overMs
            || typeof value.value !== 'number' || !Number.isFinite(value.value)
            || machineType === 'int' && (!Number.isInteger(value.value) || value.value < -2147483648 || value.value > 2147483647)) {
          throw new Error('window trace contributor identity or domain mismatch');
        }
        proofs.contributor(value, site);
        return { ...value };
      }
      requireExactFields(value, ['sourceTag', 'epoch', 'id', 'timestampMs', 'value'], 'window trace contributor');
      const source = sources.get(value.sourceTag);
      if (!source || !safe(value.epoch) || !safe(value.id) || !safe(value.timestampMs)
          || typeof value.value !== 'number' || !Number.isFinite(value.value)
          || value.timestampMs > record.nowMs || record.nowMs - value.timestampMs >= site.overMs
          || machineType === 'int' && (!Number.isInteger(value.value) || value.value < -2147483648 || value.value > 2147483647)) {
        throw new Error('window trace contributor identity or domain mismatch');
      }
      return { ...value, source: { ...source } };
    };
    const contributors = record.contributors.map(point);
    const identityKeys = new Set();
    for (let index = 0; index < record.contributors.length; index++) {
      const current = record.contributors[index];
      const identity = windowEvidenceKey(current).join(':');
      if (identityKeys.has(identity)) throw new Error('window trace contributor identity or domain mismatch');
      identityKeys.add(identity);
      if (index) {
        const prior = record.contributors[index - 1];
        const order = windowEvidenceOrder(prior, current);
        if (order >= 0) throw new Error('window trace contributor order mismatch');
      }
    }
    const first = contributors[0] ?? null;
    const last = contributors.at(-1) ?? null;
    const rawFirst = record.contributors[0] ?? null, rawLast = record.contributors.at(-1) ?? null;
    if (canonicalJson(record.first) !== canonicalJson(rawFirst) || canonicalJson(record.last) !== canonicalJson(rawLast)) {
      throw new Error('window trace contributor boundary mismatch');
    }
    const available = record.value !== null;
    if (available ? record.quality !== 3 || typeof record.value !== 'number' || !Number.isFinite(record.value)
      || machineType === 'int' && (!Number.isInteger(record.value) || record.value < -2147483648 || record.value > 2147483647) : record.quality !== 0) {
      throw new Error('window trace value or quality mismatch');
    }
    if (available && (record.count < 1 || last === null || record.nowMs - last.timestampMs >= site.maxAgeMs)) {
      throw new Error('window trace available evidence is missing or stale');
    }
    if (available && site.operation === 'rate'
        && (record.count < 2 || first === null || last.timestampMs <= first.timestampMs)) {
      throw new Error('window rate trace requires two time-distinct contributors');
    }
    let upstreamFault = null;
    if (record.upstreamFault !== null) {
      requireExactFields(record.upstreamFault, ['origin', 'faultCode'], 'window upstream fault');
      const originDescriptor = site.origins.find(origin => origin.tag === record.upstreamFault.origin);
      if (!originDescriptor || !Number.isInteger(record.upstreamFault.faultCode)
          || record.upstreamFault.faultCode < 0 || record.upstreamFault.faultCode >= RESULT_FAULT_MEMBERS.SensorFault.length) {
        throw new Error('window upstream fault identity or domain mismatch');
      }
      upstreamFault = { ...record.upstreamFault, fault: RESULT_FAULT_MEMBERS.SensorFault[record.upstreamFault.faultCode], originDescriptor };
    }
    return {
      name: site.name, nodeId: site.nodeId, source: site.source, site: site.site, slot,
      operation: site.operation, payloadType: site.payloadType, quality: available ? 'Derived' : null,
      value: record.value, count: record.count, admissionRevision: record.admissionRevision,
      timeEpoch: record.timeEpoch, nowMs: record.nowMs, first, last, contributors,
      ...proofs.finish(),
      fault: available ? null : { code: 3, fault: 'NotReady', origin: site.site,
        originDescriptor: { kind: 'signal', name: site.name, nodeId: site.nodeId } },
      upstreamFault,
    };
  });
}

// Project committed Rust state only. Eligibility and age are never recomputed here.
function observeHeldEvents(bindings, stateAfter) {
  const declarations = bindings.filter(entry => entry.kind === 'signal' && entry.generated?.role === 'held');
  return declarations.flatMap(entry => {
    const entries = bindings.filter(binding => binding.kind === 'signal' && binding.nodeId === entry.nodeId);
    requireSignalRoles(entries.map(binding => binding.generated), 'hold_last');
    const roles = new Map(entries.filter(binding => HOLD_ROLES.includes(binding.generated.role))
      .map(binding => [binding.generated.role, binding.name]));
    const values = Object.fromEntries([...roles].map(([role, name]) => [role, observedScalar(stateAfter, name)]));
    const unsigned = value => Number.isSafeInteger(value) && value >= 0;
    if (typeof values.available !== 'boolean' || typeof values.held !== 'boolean'
        || typeof values.maskedFaultPresent !== 'boolean' || values.value === null
        || !unsigned(values.heldSourceTag) || values.heldSourceTag > 0xffff_ffff
        || !unsigned(values.heldEpoch) || !Number.isSafeInteger(values.heldId) || values.heldId < -1
        || !unsigned(values.heldTimestamp) || !unsigned(values.age)
        || !Number.isInteger(values.maskedFaultCode) || values.maskedFaultCode < 0 || values.maskedFaultCode > 3
        || !unsigned(values.maskedFaultOrigin) || values.maskedFaultOrigin > 0xffff_ffff) {
      throw new Error('hold_last trace state domain mismatch');
    }
    if (!values.held) return [];
    const tags = new Set(entries.filter(binding => binding.generated.role === 'sourceEpoch').map(binding => binding.generated.sourceTag));
    if (!values.available || values.heldId < 0 || !tags.has(values.heldSourceTag)
        || (values.maskedFaultPresent && values.maskedFaultOrigin === 0)) {
      throw new Error('hold_last trace evidence identity mismatch');
    }
    return [{
      name: entry.generated.declaration, nodeId: entry.nodeId, source: entry.source,
      quality: 'Held', value: values.value, sourceTag: values.heldSourceTag,
      epoch: values.heldEpoch, id: values.heldId, timestampMs: values.heldTimestamp, ageMs: values.age,
      maskedFault: values.maskedFaultPresent ? {
        code: values.maskedFaultCode, fault: RESULT_FAULT_MEMBERS.SensorFault[values.maskedFaultCode], origin: values.maskedFaultOrigin,
      } : null,
    }];
  });
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
    if (typeof declaration !== 'string' || !['since', 'initialized', 'wasTrue'].includes(role)) {
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
    const tracking = timer.initialized ?? timer.wasTrue;
    if (typeof timer.since !== 'string' || typeof tracking !== 'string'
        || (timer.initialized !== undefined && timer.wasTrue !== undefined)) {
      throw new Error(`generated timer binding pair mismatch for ${name}`);
    }
    const initialized = observedScalar(trace.stateAfter, tracking);
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
