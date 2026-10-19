import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { encode } from '@toon-format/toon';
import { canonicalJson } from './canonical-json.mjs';
import { compileSource, intentConditionDigest, writeArtifact } from './toolchain.mjs';
import { runScenario, scenarioExecutionBackend, validateScenario } from './ghostsim.mjs';

export const FAILURE_REDUCTION_LIMITS = Object.freeze({ requestBytes: 3 * 1024 * 1024,
  scenarioBytes: 256 * 1024, maxAttempts: 128, guards: 8, resultBytes: 1024 * 1024 });
const FORMAT = 'GhostFlow/failure-reduction-request-v1';
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const FIELD = { requested: 'requestedVirtualIntent', safe: 'safeVirtualIntent',
  stateBefore: 'stateBefore', stateAfter: 'stateAfter', faults: 'faults' };
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class FailureReductionError extends Error {
  constructor(where, message) { super(`${where}: ${message}`); this.code = 'GF_FAILURE_REDUCTION'; this.path = where; }
}
const fail = (where, message) => { throw new FailureReductionError(where, message); };
function shape(value, required, optional, where) {
  if (!plain(value)) fail(where, 'must be an object');
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${where}.${key}`, 'is required');
  for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) fail(`${where}.${key}`, 'unsupported field');
}
function id(value, where) { if (typeof value !== 'string' || !ID.test(value)) fail(where, 'invalid identifier'); }
function sha(value, where) { if (typeof value !== 'string' || !SHA.test(value)) fail(where, 'must be a lowercase SHA-256'); }
function index(value, where) { if (!Number.isSafeInteger(value) || value < 0) fail(where, 'must be a nonnegative safe integer'); }
function capture(value) {
  let serialized;
  try { serialized = canonicalJson(value, { depthLimit: 24, rejectSparseArrays: true, rejectUnsafeIntegers: true }); }
  catch (error) { fail('request', String(error.message).slice(0, 4096)); }
  if (Buffer.byteLength(serialized) > FAILURE_REDUCTION_LIMITS.requestBytes) fail('request', 'byte limit exceeded');
  return JSON.parse(serialized);
}
function encodedScenario(scenario) {
  const text = encode(scenario) + '\n';
  if (Buffer.byteLength(text) > FAILURE_REDUCTION_LIMITS.scenarioBytes) fail('request.scenario', 'byte limit exceeded');
  return text;
}
function validate(request) {
  shape(request, ['format', 'program', 'scenario', 'predicate', 'requirement', 'maxAttempts'], ['condition'], 'request');
  if (request.format !== FORMAT) fail('request.format', `must be ${FORMAT}`);
  shape(request.program, ['filename', 'source'], ['sourceClosure', 'intentEvidence'], 'request.program');
  if (typeof request.program.filename !== 'string' || !request.program.filename.endsWith('.ghost.md')
      || request.program.filename.includes('\0')) fail('request.program.filename', 'must be a canonical .ghost.md filename');
  if (typeof request.program.source !== 'string' || !request.program.source) fail('request.program.source', 'must be nonempty source text');
  shape(request.predicate, ['kind', 'observation', 'expected', 'at'], ['when'], 'request.predicate');
  if (request.predicate.kind !== 'equals') fail('request.predicate.kind', 'only equals is supported');
  shape(request.predicate.observation, ['field'], ['name'], 'request.predicate.observation');
  const observation = request.predicate.observation;
  if (!Object.hasOwn(FIELD, observation.field)) fail('request.predicate.observation.field', 'unsupported field');
  if (observation.field === 'faults') {
    if (Object.hasOwn(observation, 'name')) fail('request.predicate.observation.name', 'faults selects the complete list');
  } else if (typeof observation.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(observation.name)) {
    fail('request.predicate.observation.name', 'must be a GhostFlow field name');
  }
  shape(request.predicate.at, ['actionIndex', 'logicalTimeMs'], [], 'request.predicate.at');
  index(request.predicate.at.actionIndex, 'request.predicate.at.actionIndex');
  index(request.predicate.at.logicalTimeMs, 'request.predicate.at.logicalTimeMs');
  if (Buffer.byteLength(canonicalJson(request.predicate.expected)) > 8192) fail('request.predicate.expected', 'byte limit exceeded');
  if (request.predicate.when !== undefined) {
    if (!Array.isArray(request.predicate.when) || request.predicate.when.length === 0
        || request.predicate.when.length > FAILURE_REDUCTION_LIMITS.guards) {
      fail('request.predicate.when', 'must be a nonempty bounded guard array');
    }
    for (const [guardIndex, guard] of request.predicate.when.entries()) {
      const where = `request.predicate.when[${guardIndex}]`;
      shape(guard, ['observation', 'expected'], [], where);
      shape(guard.observation, ['field'], ['name'], `${where}.observation`);
      if (!Object.hasOwn(FIELD, guard.observation.field)) fail(`${where}.observation.field`, 'unsupported field');
      if (guard.observation.field === 'faults') {
        if (Object.hasOwn(guard.observation, 'name')) fail(`${where}.observation.name`, 'faults selects the complete list');
      } else if (typeof guard.observation.name !== 'string'
          || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(guard.observation.name)) {
        fail(`${where}.observation.name`, 'must be a GhostFlow field name');
      }
      if (Buffer.byteLength(canonicalJson(guard.expected)) > 8192) fail(`${where}.expected`, 'byte limit exceeded');
    }
  }
  shape(request.requirement, ['id', 'revision', 'sha256', 'reference'], [], 'request.requirement');
  id(request.requirement.id, 'request.requirement.id'); id(request.requirement.revision, 'request.requirement.revision');
  sha(request.requirement.sha256, 'request.requirement.sha256');
  if (typeof request.requirement.reference !== 'string' || !request.requirement.reference.trim()
      || request.requirement.reference.length > 8192) fail('request.requirement.reference', 'must be nonempty bounded text');
  if (request.condition !== undefined) {
    shape(request.condition, ['id', 'revision', 'sha256'], [], 'request.condition');
    id(request.condition.id, 'request.condition.id'); id(request.condition.revision, 'request.condition.revision');
    sha(request.condition.sha256, 'request.condition.sha256');
  }
  if (!Number.isSafeInteger(request.maxAttempts) || request.maxAttempts < 1
      || request.maxAttempts > FAILURE_REDUCTION_LIMITS.maxAttempts) fail('request.maxAttempts', 'must be 1..128');
  if (!Array.isArray(request.scenario?.actions)) fail('request.scenario.actions', 'must be an action array');
  const target = request.scenario.actions[request.predicate.at.actionIndex];
  if (target?.kind !== 'scan' || target.atMs !== request.predicate.at.logicalTimeMs) {
    fail('request.predicate.at', 'must identify an original scan action and its exact logical time');
  }
  if (request.scenario.plant !== undefined) fail('request.scenario.plant', 'closed-loop plant makes deletion input-dependent');
  return encodedScenario(request.scenario);
}
function validateField(compilation, observation) {
  if (observation.field === 'faults') return null;
  const binding = (compilation.traceMetadata?.bindings ?? []).find(item => item.name === observation.name
    && item.fields?.includes(observation.field)
    && (['requested', 'safe'].includes(observation.field) ? item.kind === 'connection' : item.kind === 'state'));
  if (!binding) fail('request.predicate.observation', 'no compiler source binding for selected field');
  return { nodeId: binding.nodeId, kind: binding.kind, name: binding.name, field: observation.field, source: binding.source };
}
function boundCondition(request, compilation) {
  if (!request.condition) return { binding: 'unlinked' };
  const report = compilation.intentEvidence;
  const stored = report?.record.conditions.find(item => item.id === request.condition.id && item.revision === request.condition.revision);
  if (!stored || intentConditionDigest(stored) !== request.condition.sha256) fail('request.condition', 'condition identity, revision or digest mismatch');
  return { binding: 'recorded', reference: request.condition,
    confirmation: report.conditions.find(item => item.id === stored.id).confirmation,
    authority: 'not-authenticated' };
}
function observe(scan, observation) {
  const bucket = scan?.[FIELD[observation.field]];
  if (observation.field === 'faults') return Array.isArray(bucket) ? { available: true, value: bucket } : { available: false };
  return plain(bucket) && Object.hasOwn(bucket, observation.name)
    ? { available: true, value: bucket[observation.name] } : { available: false };
}
function identity(compilation, backend) {
  const fileHash = filename => { try { return hash(fs.readFileSync(filename)); } catch { return null; } };
  const relative = filename => path.relative(root, filename).split(path.sep).join('/');
  return { sourceFilename: compilation.sourceDocument.filename, sourceDocumentSha256: compilation.sourceDocument.sha256,
    bytecodeSha256: compilation.manifest.bytecodeSha256, manifestSha256: hash(canonicalJson(compilation.manifest)),
    ...(compilation.sourceClosure ? { sourceClosureSha256: hash(canonicalJson(compilation.sourceClosure)) } : {}),
    ...(compilation.intentEvidence ? { intentEvidenceSha256: compilation.intentEvidence.recordSha256 } : {}),
    runtime: { kind: backend.kind, path: relative(backend.runtime), sha256: fileHash(backend.runtime) },
    host: { path: relative(backend.host), sha256: fileHash(backend.host),
      ...(backend.kind === 'wasm' ? { nodeVersion: process.version } : {}) } };
}
function runtimeStable(identity_, backend) {
  const shaOf = filename => { try { return hash(fs.readFileSync(filename)); } catch { return null; } };
  return identity_.runtime.sha256 === shaOf(backend.runtime) && identity_.host.sha256 === shaOf(backend.host);
}
function sanitize(message, directory) { return String(message).replaceAll(directory, '<temporary>')
  .replace(/ghostsim-run-[A-Za-z0-9]+/g, 'ghostsim-run-<temporary>').slice(0, 4096); }
function limited(result) {
  if (Buffer.byteLength(JSON.stringify(result)) <= FAILURE_REDUCTION_LIMITS.resultBytes) return result;
  return { format: result.format, outcome: 'incomplete', requestSha256: result.requestSha256,
    source: result.source, originalScenarioSha256: result.originalScenarioSha256,
    predicate: result.predicate, predicateSha256: result.predicateSha256, requirement: result.requirement,
    condition: result.condition, attempts: result.attempts, reductionStatus: 'unknown',
    physicalEffects: false, resultTruncated: true,
    error: { code: 'GF_FAILURE_REDUCTION', message: 'result byte limit exceeded' } };
}

/** Greedy deletion against a fixed external equals predicate and fresh scenario executions. */
export async function reduceFailure(input) {
  const request = capture(input); // Snapshot before the first await.
  const originalText = validate(request);
  const item = request.program;
  const compilation = await compileSource(item.source, { filename: item.filename,
    ...(item.sourceClosure ? { sourceClosure: item.sourceClosure } : {}),
    ...(Object.hasOwn(item, 'intentEvidence') ? { intentEvidence: item.intentEvidence } : {}) });
  if (!compilation.manifest) fail('request.program', 'must compile to an executable control');
  validateScenario(request.scenario, compilation.manifest);
  const sourceBinding = validateField(compilation, request.predicate.observation);
  const guardSourceBindings = (request.predicate.when ?? []).map(guard => validateField(compilation, guard.observation));
  const condition = boundCondition(request, compilation);
  const backend = scenarioExecutionBackend(compilation.manifest, request.scenario);
  const sourceIdentity = identity(compilation, backend);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-shrink-'));
  try {
    const artifact = path.join(directory, 'program.gfb'), scenarioPath = path.join(directory, 'scenario.toon');
    writeArtifact(compilation, artifact);
    const originalIndices = request.scenario.actions.map((_, index_) => index_);
    const originalKinds = request.scenario.actions.map(action => action.kind);
    const targetIndex = request.predicate.at.actionIndex;
    const scanIdFor = indices => indices.slice(0, indices.indexOf(targetIndex) + 1)
      .filter(index_ => originalKinds[index_] === 'scan').length - 1;
    const execute = (scenario, indices) => {
      if (!runtimeStable(sourceIdentity, backend)) return { outcome: 'identity-changed', scans: [], error: { message: 'runtime or host identity changed' } };
      fs.writeFileSync(scenarioPath, encodedScenario(scenario));
      try {
        const result = JSON.parse(runScenario(artifact, scenarioPath, { format: 'json' }).encoded);
        if (!runtimeStable(sourceIdentity, backend)) return { outcome: 'identity-changed', scans: result.scans ?? [], error: { message: 'runtime or host identity changed' } };
        const scanId = scanIdFor(indices);
        const scan = result.scans?.find(row => row.scanId === scanId && row.logicalTimeMs === request.predicate.at.logicalTimeMs);
        const observed = observe(scan, request.predicate.observation);
        const guards = (request.predicate.when ?? []).map(guard => observe(scan, guard.observation));
        return { outcome: result.outcome, scanId, observed,
          guards,
          scans: result.scans ?? [], ...(result.error ? { error: result.error } : {}) };
      } catch (error) { return { outcome: 'host-error', scans: [], error: { message: sanitize(error.message, directory) } }; }
    };
    const original = execute(request.scenario, originalIndices);
    const base = { format: 'GhostFlow/failure-reduction-result-v1', requestSha256: hash(canonicalJson(request)),
      source: sourceIdentity, requirement: { ...request.requirement, authority: 'not-authenticated' },
      condition, predicate: request.predicate, predicateSha256: hash(canonicalJson(request.predicate)),
      sourceBinding, guardSourceBindings, originalScenarioSha256: hash(Buffer.from(originalText)),
      metric: 'action-count', maxAttempts: request.maxAttempts, physicalEffects: false,
      initialState: 'canonical-source-initial-state' };
    const observed = run => ({ outcome: run.outcome, scanId: run.scanId ?? null,
      ...(run.observed?.available ? { value: run.observed.value } : { valueStatus: 'unavailable' }),
      guards: (request.predicate.when ?? []).map((guard, guardIndex) => ({ specification: guard,
        ...(run.guards?.[guardIndex]?.available ? { value: run.guards[guardIndex].value,
          matched: equal(run.guards[guardIndex].value, guard.expected) } : { valueStatus: 'unavailable' }) })),
      ...(run.error ? { error: { ...run.error, message: sanitize(run.error.message ?? '', directory) } } : {}) });
    if (original.outcome !== 'completed' || !original.observed?.available
        || original.guards?.some(guard => !guard.available)) {
      return limited({ ...base, outcome: 'incomplete', reason: 'original execution or target observation unavailable',
        originalObservation: observed(original), attempts: 0 });
    }
    if ((request.predicate.when ?? []).some((guard, guardIndex) => !equal(original.guards[guardIndex].value, guard.expected))) {
      return limited({ ...base, outcome: 'original-not-applicable', originalObservation: observed(original), attempts: 0 });
    }
    if (equal(original.observed.value, request.predicate.expected)) {
      return limited({ ...base, outcome: 'original-not-failing', originalObservation: observed(original), attempts: 0 });
    }
    let scenario = request.scenario, indices = originalIndices, current = original;
    let attempts = 0, cursor = 0, passUnknowns = 0, budgetExhausted = false;
    const history = [];
    while (cursor < scenario.actions.length) {
      const deletedOriginalIndex = indices[cursor];
      if (deletedOriginalIndex === targetIndex) { cursor += 1; continue; }
      if (attempts >= request.maxAttempts) { budgetExhausted = true; break; }
      attempts += 1;
      const candidateIndices = indices.filter((_, index_) => index_ !== cursor);
      const candidate = { ...scenario, actions: scenario.actions.filter((_, index_) => index_ !== cursor) };
      let attempt;
      try { validateScenario(candidate, compilation.manifest); attempt = execute(candidate, candidateIndices); }
      catch (error) { attempt = { outcome: 'invalid-candidate', error: { message: String(error.message).slice(0, 4096) } }; }
      if (attempt.outcome === 'identity-changed') {
        return limited({ ...base, outcome: 'incomplete', reason: 'runtime or host identity changed during reduction',
          originalObservation: observed(original), attempts, history });
      }
      const guardsAvailable = (request.predicate.when ?? []).every((_, guardIndex) => attempt.guards?.[guardIndex]?.available);
      const guardsMatched = guardsAvailable && (request.predicate.when ?? []).every((guard, guardIndex) =>
        equal(attempt.guards[guardIndex].value, guard.expected));
      const reproduced = attempt.outcome === 'completed' && attempt.observed?.available && guardsMatched
        && !equal(attempt.observed.value, request.predicate.expected);
      const status = reproduced ? 'accepted' : attempt.outcome === 'invalid-candidate' ? 'invalid'
        : attempt.outcome === 'completed' && guardsAvailable && !guardsMatched ? 'rejected'
          : attempt.outcome === 'completed' && attempt.observed?.available && guardsAvailable ? 'rejected' : 'unknown';
      history.push({ deletedOriginalActionIndex: deletedOriginalIndex, status, outcome: attempt.outcome,
        ...(attempt.observed?.available ? { value: attempt.observed.value } : {}),
        ...(request.predicate.when?.length ? { guards: observed(attempt).guards } : {}),
        ...(attempt.error ? { error: { message: sanitize(attempt.error.message ?? '', directory) } } : {}) });
      if (reproduced) {
        scenario = candidate; indices = candidateIndices; current = attempt; cursor = 0; passUnknowns = 0;
      } else { if (status === 'unknown') passUnknowns += 1; cursor += 1; }
    }
    const finalStatus = budgetExhausted ? 'budget-exhausted' : passUnknowns ? 'unresolved-candidates' : 'single-deletion-minimal';
    const reducedText = encodedScenario(scenario);
    const scanMapping = indices.flatMap((originalActionIndex, newActionIndex) => originalKinds[originalActionIndex] === 'scan'
      ? [{ originalActionIndex, newActionIndex, scanId: indices.slice(0, newActionIndex + 1).filter(index_ => originalKinds[index_] === 'scan').length - 1,
        logicalTimeMs: scenario.actions[newActionIndex].atMs }] : []);
    return limited({ ...base, outcome: 'reproduced', reductionStatus: finalStatus,
      originalObservation: observed(original), reducedObservation: observed(current),
      originalActionCount: request.scenario.actions.length, reducedActionCount: scenario.actions.length,
      reducedScenario: scenario, reducedScenarioSha256: hash(Buffer.from(reducedText)),
      target: { originalActionIndex: targetIndex, reducedActionIndex: indices.indexOf(targetIndex),
        reducedScanId: scanIdFor(indices), logicalTimeMs: request.predicate.at.logicalTimeMs },
      scanMapping, attempts, history });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
