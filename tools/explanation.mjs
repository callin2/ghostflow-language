import { canonicalJson } from './canonical-json.mjs';
import { sha256Hex } from './sha256.mjs';
import { replaySourceProvenance, emitInteractionSchema } from './compile-source.mjs';
import { extractLiterate } from './literate.mjs';
import { parseControl } from './control.mjs';
import { prepareCompletedScanSnapshot, joinRuntimeSnapshot } from './interaction-runtime-snapshot.mjs';

export const EXPLANATION_LIMITS = Object.freeze({ nodes: 512, edges: 1024, depth: 64, instructions: 8192 });
const childrenOf = node => ['left', 'right', 'operand', 'condition', 'whenTrue', 'whenFalse']
  .filter(key => node[key]).map(key => node[key]);
const supported = new Set(['literal', 'input', 'previous_state', 'candidate_next', 'logical_not',
  'logical_and', 'logical_or', 'comparison', 'arithmetic', 'integer_arithmetic', 'integer_negation', 'conversion', 'time_guard', 'nominal_guard', 'conditional']);
const kinds = { previous_state: 'state', candidate_next: 'state', logical_and: 'all', logical_or: 'any',
  logical_not: 'not', comparison: 'predicate', arithmetic: 'derived', integer_arithmetic: 'derived',
  integer_negation: 'derived', conversion: 'derived', time_guard: 'derived', nominal_guard: 'derived', conditional: 'derived' };
const fail = message => { throw new Error(`explanation: ${message}`); };
const idOf = expression => 'explanation.' + sha256Hex(canonicalJson(expression)).slice(0, 32);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const own = value => structuredClone(value);
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

function instructionTable(bytes) {
  const table = [];
  for (let pc = 0; pc < bytes.length;) {
    const op = bytes[pc];
    const length = op === 1 ? 2 : op === 2 ? 9 : [3, 4, 5, 30, 31].includes(op) ? 3
      : [23, 56].includes(op) ? 5 : [57, 58, 59].includes(op) ? 4 : 1;
    const end = pc + length;
    if (end > bytes.length) fail('truncated compiler instruction');
    table.push({ pc, end, ...(op === 30 || op === 31 ? {
      branch: op === 30 ? 'false' : 'always', target: end + bytes[pc + 1] + 256 * bytes[pc + 2],
    } : {}) });
    pc = end;
  }
  return table;
}

function composedSources(compilation) {
  if (!compilation.sourceClosure) return null;
  const documents = new Map([compilation.sourceDocument, ...compilation.sourceClosure.documents]
    .map(document => [document.filename, document]));
  const declarations = new Map([...documents.values()].map(document => [document.filename,
    new Map(parseControl(extractLiterate(document.text, { filename: document.filename }).code,
      { filename: document.filename }).body.map(item => [item.id, item]))]));
  const nodes = new Map(compilation.sourceMap.map(node => [node.id, node]));
  return binding => {
    const node = nodes.get(binding.nodeId), document = documents.get(node?.filename);
    const declaration = declarations.get(node?.filename)?.get(node.definitionNodeId);
    if (!node || !document || !declaration) fail('composed semantic source binding unavailable');
    const intent = node.instance === null ? compilation.traceMetadata
      : compilation.traceMetadata.compositionIntent?.instances.find(item => item.instance === node.instance);
    return {
      label: declaration.name,
      source: { sourceNode: { nodeId: node.id, definitionNodeId: node.definitionNodeId,
        instance: node.instance, filename: node.filename, line: node.line, column: node.column,
        endLine: node.endLine, endColumn: node.endColumn,
        sourceSha256: document.sha256, ...(document.revision ? { sourceRevision: document.revision } : {}) },
      intentProvenance: own((intent?.intentLinks ?? intent?.links ?? []).filter(link => link.nodeId === node.id)) },
    };
  };
}

/** A bounded sidecar emitted from the same IR/instruction writers as GFB1.
 * Offsets are private artifact mappings, never public semantic identities. */
export function emitExplanationArtifact(compilation) {
  const artifact = { format: 'GhostFlow/explanation-artifact-v1', version: '0.1',
    sourceSha256: compilation.sourceDocument.sha256, bytecodeSha256: compilation.manifest.bytecodeSha256,
    limits: { ...EXPLANATION_LIMITS }, nodes: [], strategies: [],
    ...(compilation.sourceClosure ? { sourceClosureSha256: sha256Hex(canonicalJson(compilation.sourceClosure)) } : {}),
    unsupportedKinds: ['timer', 'schedule', 'safety', 'result', 'transition-proof'] };
  const nodes = new Map();
  if (!compilation.explanationExpressions) {
    artifact.unavailableReason = 'unsupported-artifact-kind';
    return artifact;
  }
  const sourceFor = composedSources(compilation);
  for (const strategy of compilation.explanationExpressions) {
    const outputs = [];
    for (const intent of strategy.intents) {
      const output = { outputId: `output.${intent.name}`, name: intent.name, type: intent.type,
        byteLength: intent.byteLength, occurrences: [] };
      outputs.push(output);
      let unsupportedKind = null, count = 0, edges = 0;
      const check = (node, depth = 1) => {
        if (++count > EXPLANATION_LIMITS.nodes || depth > EXPLANATION_LIMITS.depth) unsupportedKind = 'resource-bounds';
        if (!supported.has(node.kind)) unsupportedKind ??= node.kind;
        if (node.name?.startsWith('__gf_')) unsupportedKind ??= 'generated-rail';
        const children = childrenOf(node); edges += children.length;
        for (const child of children) check(child, depth + 1);
      };
      check(intent.expression);
      if (intent.type !== 'Bool') unsupportedKind ??= 'non-boolean-output';
      if (edges > EXPLANATION_LIMITS.edges || nodes.size + count > EXPLANATION_LIMITS.nodes) unsupportedKind ??= 'resource-bounds';
      if (unsupportedKind) { output.unsupportedKind = unsupportedKind; continue; }
      const binding = compilation.traceMetadata.bindings.find(item => item.kind === 'connection' && item.name === intent.name);
      const sourceOf = expression => {
        const leaf = ['input', 'previous_state', 'candidate_next'].includes(expression.kind);
        const semanticBinding = leaf ? compilation.traceMetadata.bindings.find(item => item.name === expression.name
          && item.kind === (expression.kind === 'input' ? 'input' : 'state')) : binding;
        if (!semanticBinding) fail('semantic source binding unavailable');
        if (sourceFor) {
          const resolved = sourceFor(semanticBinding);
          return { label: leaf ? (resolved.source.sourceNode.instance ? `${resolved.source.sourceNode.instance}.` : '') + resolved.label : null,
            source: { ...resolved.source, sourceRole: leaf ? 'declaration' : 'output-connection' } };
        }
        return { label: expression.name,
          source: { sourceNode: { nodeId: semanticBinding.nodeId, ...semanticBinding.source },
            intentProvenance: (compilation.traceMetadata.intentLinks ?? []).filter(link => link.nodeId === semanticBinding.nodeId) } };
      };
      const add = (expression, path = 'root') => {
        const nodeId = idOf(expression), children = childrenOf(expression);
        const occurrenceId = `${output.outputId}:${path}`;
        const childOccurrences = children.map((child, index) => add(child, `${path}.${index}`));
        const { label, source } = sourceOf(expression);
        const descriptor = { id: nodeId, kind: kinds[expression.kind] ?? expression.kind, semanticType: expression.type,
          label: label ?? expression.operation ?? ({ logical_and: 'AND', logical_or: 'OR', logical_not: 'NOT' }[expression.kind]) ?? expression.kind,
          children: children.map(idOf), sources: [source] };
        if (!nodes.has(nodeId)) nodes.set(nodeId, descriptor);
        else if (!nodes.get(nodeId).sources.some(item => same(item, source))) nodes.get(nodeId).sources.push(source);
        // Expression objects retain occurrence identity in the emitter, including
        // repeated semantic nodes. Never deduplicate execution sites by node ID.
        const mapping = intent.witnessNodes.find(item => item.expression === expression);
        if (!mapping) fail('instruction mapping unavailable');
        output.occurrences.push({ id: occurrenceId, nodeId, operation: expression.kind,
          children: childOccurrences, exits: own(mapping.exits), ...(sourceFor ? { source: own(source) } : {}) });
        return occurrenceId;
      };
      output.rootOccurrenceId = add(intent.expression);
      output.rootNodeId = idOf(intent.expression);
      output.instructions = instructionTable(intent.expressionBytes);
    }
    artifact.strategies.push({ name: strategy.name, outputs });
  }
  artifact.nodes = [...nodes.values()];
  return artifact;
}

/** Verification reconstructs the bounded DAG and every exit from canonical
 * source. Equality rejects malformed/cyclic/oversized sidecars, forged bounds,
 * offsets into operands and mappings for another artifact before projection. */
export function prepareOutputExplanation({ compilation, runId } = {}) {
  const owned = own(compilation);
  const identity = owned.interactionSourceIdentity;
  if (!owned.sourceDocument || !identity) fail('canonical source and Interaction identity required');
  let replay;
  try { replay = replaySourceProvenance(owned); }
  catch (error) { fail(`artifact mapping mismatch: ${error.message}`); }
  const rebuilt = { ...replay, interactionSchema: emitInteractionSchema(replay, identity) };
  if (sha256Hex(owned.bytes) !== rebuilt.manifest.bytecodeSha256 || !same(owned.explanationArtifact, rebuilt.explanationArtifact)) fail('artifact mapping mismatch');
  for (const field of ['sourceMap', 'traceMetadata', 'manifest', ...(owned.sourceClosure ? ['sourceClosure'] : [])]) {
    if (!same(owned[field], rebuilt[field])) fail(`${field} mapping mismatch`);
  }
  const descriptor = freeze(own(rebuilt.explanationArtifact));
  const snapshotProducer = prepareCompletedScanSnapshot({ compilation: rebuilt, runId });
  return Object.freeze({ descriptor, expected: snapshotProducer.expected,
    emit({ runId: actualRunId, result, outputId } = {}) {
      if (actualRunId !== runId) fail('run epoch mismatch');
      const { completion, trace, settingsState } = completedResult(result, snapshotProducer.expected, rebuilt.manifest.configs ?? []);
      const snapshot = snapshotProducer.emit({ completion, trace, ...(settingsState ? { settingsState } : {}) });
      return projectVerifiedProof(descriptor, snapshot, trace, outputId);
    },
  });
}

function completedResult(result, expected, configs = []) {
  if (result?.accepted !== true || !result.outcome) fail('accepted completed scan required');
  const outcome = result.outcome, ownedHost = outcome.frame !== undefined;
  const frame = ownedHost ? outcome.frame : outcome;
  const trace = ownedHost ? outcome.vm : outcome.trace;
  if ((!ownedHost && outcome.format !== 'GhostFlow/scan-outcome-v1')
    || !Number.isSafeInteger(frame?.scanId) || frame.scanId < 0
    || !Number.isSafeInteger(frame.logicalTimeMs) || frame.logicalTimeMs < 0
    || trace?.tick !== frame.scanId + 1 || trace.module !== expected.moduleFingerprint) fail('scan/tick/module mismatch for fresh run');
  let settingsState;
  if (ownedHost) {
    const state = result.snapshot;
    if (state?.runId !== expected.runId || state.sourceSha256 !== expected.sourceSha256
      || state.programFingerprint !== expected.moduleFingerprint || state.position !== frame.scanId + 1
      || state.lastOutcome?.scanId !== frame.scanId || state.lastOutcome.logicalTimeMs !== frame.logicalTimeMs
      || !same(state.lastOutcome.trace, trace)) fail('completed settings host identity mismatch');
    if (trace.contextTrace?.some(item => ['SettingsOk', 'SettingsInvalid', 'SettingsUnavailable'].includes(item.decision)
      && item.providerRevision !== String(state.core?.state?.settingsRevision))) fail('completed settings revision mismatch');
    if (configs.length) {
      settingsState = state.core?.state;
      if (!settingsState || !configs.every(config => {
        const observation = trace.contextTrace?.filter(item => item.site === config.id && item.contextRevision === config.name);
        return observation?.length === 1 && observation[0].providerRevision === String(settingsState.settingsRevision);
      })) fail('completed settings revision mismatch');
    }
  }
  return { completion: { kind: 'completed-scan', scanId: frame.scanId, logicalTimeMs: frame.logicalTimeMs }, trace, settingsState };
}

function projectVerifiedProof(descriptor, snapshot, trace, outputId) {
  const strategy = descriptor.strategies.find(item => item.name === trace.strategy);
  const output = strategy?.outputs.find(item => item.outputId === outputId);
  if (!output || !Object.hasOwn(trace.requested, output.name)) fail('requested output unavailable');
  const shell = { format: 'GhostFlow/output-explanation-v1', version: '0.1', schema: snapshot.schema,
    module: snapshot.module, source: snapshot.source, runId: snapshot.runId, completion: snapshot.completion,
    ...(snapshot.composition ? { composition: snapshot.composition } : {}),
    ...(snapshot.settingsRevision !== undefined ? { settingsRevision: snapshot.settingsRevision } : {}),
    artifactSha256: sha256Hex(canonicalJson(descriptor)), outputId, stage: 'requested',
    value: trace.requested[output.name], rootNodeId: output.rootNodeId ?? null, evaluations: [], edges: [] };
  if (output.unsupportedKind) return freeze({ ...shell, status: 'unavailable', reason: `unsupported-kind:${output.unsupportedKind}` });
  const steps = trace.instructionWitnesses?.find(item => item.name === output.name)?.steps;
  if (!steps) return freeze({ ...shell, status: 'unavailable', reason: 'instruction-witnesses-disabled' });
  if (!Array.isArray(steps) || steps.length > output.byteLength || steps.length > EXPLANATION_LIMITS.instructions) fail('instruction witness bounds');
  const byExit = new Map(), instructions = new Map(output.instructions.map(item => [item.pc, item]));
  let expectedPc = 0, priorValue;
  for (const step of steps) {
    const instruction = instructions.get(step.pc);
    const nextPc = instruction?.branch === 'always' || instruction?.branch === 'false' && priorValue === false
      ? instruction.target : instruction?.end;
    if (step.pc !== expectedPc || !Number.isInteger(step.end) || step.end <= step.pc || step.end > output.byteLength
      || step.end !== instruction?.end || step.nextPc !== nextPc
      || instruction?.branch === 'false' && typeof priorValue !== 'boolean'
      || !Number.isInteger(step.nextPc) || step.nextPc < step.end || step.nextPc > output.byteLength) fail('instruction witness path mismatch');
    expectedPc = step.nextPc;
    const key = `${step.pc}:${step.end}`;
    if (byExit.has(key)) fail('duplicate instruction witness');
    if (Object.hasOwn(step, 'value') && !(typeof step.value === 'boolean' || typeof step.value === 'number' && Number.isFinite(step.value))) fail('invalid actual value');
    byExit.set(key, step);
    priorValue = step.value;
  }
  if (expectedPc !== output.byteLength) fail('incomplete instruction witnesses');
  const evaluations = new Map();
  for (const occurrence of output.occurrences) {
    const hits = occurrence.exits.map(exit => byExit.get(`${exit.pc}:${exit.end}`)).filter(Boolean);
    if (hits.length > 1) fail('multiple occurrence exits');
    const value = hits[0];
    const node = descriptor.nodes.find(item => item.id === occurrence.nodeId);
    if (value && (!Object.hasOwn(value, 'value') || (node.semanticType === 'Bool' ? typeof value.value !== 'boolean' : typeof value.value !== 'number'))) fail('actual value type mismatch');
    evaluations.set(occurrence.id, { occurrenceId: occurrence.id, nodeId: occurrence.nodeId,
      ...(occurrence.source ? { source: occurrence.source } : {}),
      status: value ? 'ready' : 'unavailable', evaluated: Boolean(value),
      ...(value ? { value: value.value } : { reason: 'not-evaluated' }), supportsResult: false });
  }
  const root = evaluations.get(output.rootOccurrenceId);
  if (!root?.evaluated || root.value !== shell.value) fail('root/requested value mismatch');
  const edges = [];
  // Structural Boolean support uses actual witnessed results. No expression
  // is executed here, and a skipped occurrence never borrows a shared value.
  for (const parent of output.occurrences) {
    const parentValue = evaluations.get(parent.id);
    for (const childId of parent.children) {
      const child = evaluations.get(childId);
      let supportsResult = parentValue.evaluated && child.evaluated;
      if (parent.operation === 'logical_and' || parent.operation === 'logical_or') supportsResult &&= child.value === parentValue.value;
      edges.push({ parentOccurrenceId: parent.id, childOccurrenceId: childId,
        parentNodeId: parent.nodeId, childNodeId: child.nodeId, evaluated: child.evaluated, supportsResult });
    }
  }
  const visit = id => {
    evaluations.get(id).supportsResult = true;
    for (const edge of edges.filter(edge => edge.parentOccurrenceId === id && edge.supportsResult)) visit(edge.childOccurrenceId);
  };
  visit(output.rootOccurrenceId);
  return freeze({ ...shell, status: 'ready', evaluations: [...evaluations.values()], edges });
}

/** Consumers must join both this proof and the output's same-scan snapshot. */
export function joinOutputExplanation(schema, proof, snapshot, expected, descriptor, result) {
  if (!descriptor || descriptor.format !== 'GhostFlow/explanation-artifact-v1'
    || proof?.format !== 'GhostFlow/output-explanation-v1' || proof.version !== '0.1' || proof.stage !== 'requested'
    || proof.artifactSha256 !== sha256Hex(canonicalJson(descriptor))) fail('proof artifact identity mismatch');
  const output = descriptor.strategies.flatMap(strategy => strategy.outputs).find(output => output.outputId === proof.outputId);
  if (!output || proof.rootNodeId !== (output.rootNodeId ?? null)) fail('proof output/root identity mismatch');
  const edgeCount = output.occurrences.reduce((sum, occurrence) => sum + occurrence.children.length, 0);
  if (!Array.isArray(proof.evaluations) || !Array.isArray(proof.edges)
    || proof.evaluations.length > EXPLANATION_LIMITS.nodes || proof.edges.length > EXPLANATION_LIMITS.edges
    || proof.status === 'ready' && (proof.evaluations.length !== output.occurrences.length || proof.edges.length !== edgeCount)
    || proof.status === 'unavailable' && (proof.evaluations.length !== 0 || proof.edges.length !== 0)) fail('proof payload bounds or occurrence mismatch');
  const snapshotJoin = joinRuntimeSnapshot(schema, snapshot, expected);
  const proofJoin = joinRuntimeSnapshot(schema, { ...snapshot, schema: proof.schema, module: proof.module,
    source: proof.source, runId: proof.runId, completion: proof.completion,
    ...(snapshot.composition ? { composition: proof.composition } : {}) }, expected);
  const staleReasons = [...new Set([...snapshotJoin.staleReasons, ...proofJoin.staleReasons])];
  if (!same(proof.completion, snapshot.completion)) staleReasons.push('completion-mismatch');
  if (proof.settingsRevision !== snapshot.settingsRevision) staleReasons.push('settings-revision-mismatch');
  if (!staleReasons.length) {
    const actual = completedResult(result, expected);
    if (!same(actual.completion, snapshot.completion)
      || snapshot.settingsRevision !== undefined && result.outcome.frame
        && result.snapshot.core?.state?.settingsRevision !== snapshot.settingsRevision) fail('accepted output sample mismatch');
    const rebuiltProof = projectVerifiedProof(descriptor, snapshot, actual.trace, proof.outputId);
    if (!same(proof, rebuiltProof)) fail('proof payload does not match actual output/witnesses');
  }
  return { status: staleReasons.length ? 'stale' : 'ready', staleReasons };
}
