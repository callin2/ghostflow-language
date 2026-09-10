import { mapSourcePosition } from './literate.mjs';

/** Diagnostic identity matching the portable core; NOT a cryptographic digest. */
function moduleFingerprint(bytes) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}

/** Consumes the authoritative parsed AST and already-lowered constraints. */
export function buildSourceTrace(ast, constraints, bytes) {
  const bindings = [];
  const add = (node, name, fields) => bindings.push({ nodeId: node.id, kind: node.kind, name, fields, source: { ...node.loc } });
  for (const node of ast.body) {
    if (node.kind === 'input') for (const name of node.names) add(node, name, ['inputs']);
    if (node.kind === 'state') add(node, node.name, ['stateBefore', 'stateAfter']);
    if (node.kind === 'next') add(node, node.name, ['stateAfter']);
    if (node.kind === 'connection') add(node, node.name, ['requested', 'safe']);
  }
  const sourceConstraints = ast.body.filter(node => node.kind === 'require' || node.kind === 'mutex');
  if (sourceConstraints.length !== constraints.length) throw new Error('constraint source mapping mismatch');
  return {
    format: 'GhostFlow/source-trace-v1', moduleFingerprint: moduleFingerprint(bytes), bindings,
    constraints: constraints.map(([kind, ...names], index) => ({
      index, kind, names, nodeId: sourceConstraints[index].id, source: { ...sourceConstraints[index].loc },
    })),
  };
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
  return { format: 'GhostFlow/source-observation-v1', bindings, constraints };
}
