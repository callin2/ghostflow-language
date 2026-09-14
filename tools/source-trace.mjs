import { mapSourcePosition } from './literate.mjs';

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
]);
const TRACEABLE_NODE_KINDS = new Set([...BINDING_FIELDS.keys(), 'require', 'mutex']);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function samePosition(left, right) {
  return object(left) && object(right)
    && left.filename === right.filename && left.line === right.line && left.column === right.column;
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
    if (node.kind === 'schedule' && node.scheduleType === 'Solar') add(node, `__gf_schedule_due_${node.name}`, ['inputs']);
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

/** Validate persisted compiler-owned links without evaluating or inferring source meaning. */
export function verifySourceTraceMetadata(metadata, bytes, nodes, {
  sourceDocumentSha256, bytecodeSha256, requireRevisionIdentity = false,
} = {}) {
  if (!object(metadata) || metadata.format !== 'GhostFlow/source-trace-v1') {
    throw new Error('source trace metadata format mismatch');
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

  const nodeById = new Map();
  for (const node of nodes) {
    if (node === nodes) throw new Error('circular source map nodes are not supported');
    if (!object(node) || !Number.isInteger(node.id) || nodeById.has(node.id)) {
      throw new Error('source trace node identity mismatch');
    }
    nodeById.set(node.id, node);
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
  return { ...metadata, bindings: metadata.bindings.map(remap), constraints: metadata.constraints.map(remap) };
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
