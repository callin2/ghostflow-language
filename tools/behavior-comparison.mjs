import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { encode } from '@toon-format/toon';
import { canonicalJson } from './canonical-json.mjs';
import { compileSource, intentConditionDigest, writeArtifact } from './toolchain.mjs';
import { runScenario, scenarioExecutionBackend, validateScenario } from './ghostsim.mjs';

export const BEHAVIOR_COMPARISON_LIMITS = Object.freeze({ requestBytes: 3 * 1024 * 1024,
  scenarioBytes: 256 * 1024, observations: 32, assertions: 64, resultBytes: 1024 * 1024 });
const FORMAT = 'GhostFlow/behavior-comparison-request-v1';
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const FIELDS = ['requested', 'safe', 'stateBefore', 'stateAfter', 'faults'];
const sourceFields = { requested: 'requestedVirtualIntent', safe: 'safeVirtualIntent',
  stateBefore: 'stateBefore', stateAfter: 'stateAfter', faults: 'faults' };
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const safeError = error => String(error?.message ?? error).slice(0, 4096);
const stableError = (message, directory) => String(message).replaceAll(directory, '<temporary>')
  .replace(/ghostsim-run-[A-Za-z0-9]+/g, 'ghostsim-run-<temporary>').slice(0, 4096);

export class BehaviorComparisonError extends Error {
  constructor(path_, message) { super(`${path_}: ${message}`); this.code = 'GF_BEHAVIOR_COMPARISON'; this.path = path_; }
}
const fail = (where, message) => { throw new BehaviorComparisonError(where, message); };
function shape(value, required, optional, where) {
  if (!plain(value)) fail(where, 'must be an object');
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${where}.${key}`, 'is required');
  for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) fail(`${where}.${key}`, 'unsupported field');
}
function id(value, where) { if (typeof value !== 'string' || !ID.test(value)) fail(where, 'invalid identifier'); }
function integer(value, where) { if (!Number.isSafeInteger(value) || value < 0) fail(where, 'must be a nonnegative safe integer'); }
function point(value, where) {
  shape(value, ['scanId', 'logicalTimeMs'], [], where);
  integer(value.scanId, `${where}.scanId`); integer(value.logicalTimeMs, `${where}.logicalTimeMs`);
}
function observation(value, where) {
  shape(value, ['field'], ['name'], where);
  if (!FIELDS.includes(value.field)) fail(`${where}.field`, 'unsupported observation field');
  if (value.field === 'faults') {
    if (Object.hasOwn(value, 'name')) fail(`${where}.name`, 'faults observes the complete fault list');
  } else if (typeof value.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.name)) {
    fail(`${where}.name`, 'must be a GhostFlow field name');
  }
}
function source(value, where) {
  shape(value, ['filename', 'source'], ['sourceClosure', 'intentEvidence'], where);
  if (typeof value.filename !== 'string' || !value.filename.endsWith('.ghost.md') || value.filename.includes('\0')) {
    fail(`${where}.filename`, 'must name a canonical .ghost.md document');
  }
  if (typeof value.source !== 'string' || !value.source) fail(`${where}.source`, 'must be nonempty source text');
}
function assertion(value, where) {
  shape(value, ['id', 'kind', 'observation'], ['at', 'side', 'expected', 'expectedDeltaMs', 'evidence'], where);
  id(value.id, `${where}.id`); observation(value.observation, `${where}.observation`);
  if (value.kind === 'unchanged') {
    for (const key of ['at', 'side', 'expected', 'expectedDeltaMs']) if (Object.hasOwn(value, key)) fail(`${where}.${key}`, 'unsupported for unchanged');
  } else if (value.kind === 'equals') {
    if (!['baseline', 'candidate'].includes(value.side)) fail(`${where}.side`, 'must be baseline or candidate');
    point(value.at, `${where}.at`);
    if (!Object.hasOwn(value, 'expected')) fail(`${where}.expected`, 'is required');
    if (Object.hasOwn(value, 'expectedDeltaMs')) fail(`${where}.expectedDeltaMs`, 'unsupported for equals');
  } else if (value.kind === 'bool-on-duration-delta') {
    if (!['requested', 'safe', 'stateBefore', 'stateAfter'].includes(value.observation.field)) fail(`${where}.observation`, 'duration requires a named Bool observation');
    if (!Number.isSafeInteger(value.expectedDeltaMs)) fail(`${where}.expectedDeltaMs`, 'must be a safe integer');
    for (const key of ['at', 'side', 'expected']) if (Object.hasOwn(value, key)) fail(`${where}.${key}`, 'unsupported for duration');
  } else fail(`${where}.kind`, 'unsupported assertion kind');
  if (value.evidence !== undefined) {
    shape(value.evidence, ['side', 'condition'], [], `${where}.evidence`);
    if (!['baseline', 'candidate'].includes(value.evidence.side)) fail(`${where}.evidence.side`, 'must be baseline or candidate');
    shape(value.evidence.condition, ['id', 'revision', 'sha256'], [], `${where}.evidence.condition`);
    id(value.evidence.condition.id, `${where}.evidence.condition.id`);
    id(value.evidence.condition.revision, `${where}.evidence.condition.revision`);
    if (!SHA.test(value.evidence.condition.sha256)) fail(`${where}.evidence.condition.sha256`, 'must be lowercase SHA-256');
    if (value.kind === 'equals' && value.evidence.side !== value.side) fail(`${where}.evidence.side`, 'must match the observed side');
  }
}
function capture(input) {
  let serialized;
  try { serialized = canonicalJson(input, { depthLimit: 24, rejectSparseArrays: true, rejectUnsafeIntegers: true }); }
  catch (error) { fail('request', safeError(error)); }
  if (Buffer.byteLength(serialized) > BEHAVIOR_COMPARISON_LIMITS.requestBytes) fail('request', 'byte limit exceeded');
  return JSON.parse(serialized);
}
function validate(request) {
  shape(request, ['format', 'baseline', 'candidate', 'scenario', 'observations', 'scope'], ['assertions'], 'request');
  if (request.format !== FORMAT) fail('request.format', `must be ${FORMAT}`);
  source(request.baseline, 'request.baseline'); source(request.candidate, 'request.candidate');
  if (!Array.isArray(request.observations) || request.observations.length === 0
      || request.observations.length > BEHAVIOR_COMPARISON_LIMITS.observations) fail('request.observations', 'must be a nonempty bounded array');
  request.observations.forEach((item, index) => observation(item, `request.observations[${index}]`));
  if (new Set(request.observations.map(canonicalJson)).size !== request.observations.length) fail('request.observations', 'duplicate observation');
  shape(request.scope, ['from', 'to'], [], 'request.scope');
  point(request.scope.from, 'request.scope.from'); point(request.scope.to, 'request.scope.to');
  if (request.scope.from.scanId > request.scope.to.scanId || request.scope.from.logicalTimeMs > request.scope.to.logicalTimeMs) fail('request.scope', 'reversed scope');
  if (!Array.isArray(request.assertions ?? []) || (request.assertions ?? []).length > BEHAVIOR_COMPARISON_LIMITS.assertions) fail('request.assertions', 'must be a bounded array');
  const seen = new Set();
  (request.assertions ?? []).forEach((item, index) => {
    assertion(item, `request.assertions[${index}]`);
    if (!request.observations.some(entry => equal(entry, item.observation))) fail(`request.assertions[${index}].observation`, 'must be listed in observations');
    if (seen.has(item.id)) fail('request.assertions', `duplicate id ${item.id}`);
    seen.add(item.id);
  });
  if (request.scenario?.plant !== undefined) fail('request.scenario.plant', 'closed-loop plant can produce different effective inputs');
  const scenarioText = encode(request.scenario) + '\n';
  if (Buffer.byteLength(scenarioText) > BEHAVIOR_COMPARISON_LIMITS.scenarioBytes) fail('request.scenario', 'byte limit exceeded');
  return scenarioText;
}
function selected(row, item) {
  const values = row[sourceFields[item.field]];
  if (item.field === 'faults') {
    if (!Array.isArray(values)) fail('runtime.faults', 'missing fault list');
    return values;
  }
  if (!plain(values) || !Object.hasOwn(values, item.name)) fail('runtime.observation', `missing ${item.field}.${item.name}`);
  return values[item.name];
}
function identity(compilation, backend) {
  const fileHash = filename => { try { return hash(fs.readFileSync(filename)); } catch { return null; } };
  const relative = filename => path.relative(root, filename).split(path.sep).join('/');
  return { sourceFilename: compilation.sourceDocument.filename,
    sourceDocumentSha256: compilation.sourceDocument.sha256,
    bytecodeSha256: compilation.manifest.bytecodeSha256,
    manifestSha256: hash(canonicalJson(compilation.manifest)),
    ...(compilation.sourceClosure ? { sourceClosureSha256: hash(canonicalJson(compilation.sourceClosure)) } : {}),
    runtime: { kind: backend.kind, path: relative(backend.runtime), sha256: fileHash(backend.runtime) },
    host: { path: relative(backend.host), sha256: fileHash(backend.host),
      ...(backend.kind === 'wasm' ? { nodeVersion: process.version } : {}) },
    ...(compilation.intentEvidence ? { intentEvidenceSha256: compilation.intentEvidence.recordSha256 } : {}) };
}
function boundEvidence(assertion_, compilations) {
  if (!assertion_.evidence) return undefined;
  const { side, condition: ref } = assertion_.evidence;
  const report = compilations[side].intentEvidence;
  const condition = report?.record.conditions.find(item => item.id === ref.id && item.revision === ref.revision);
  if (!condition || intentConditionDigest(condition) !== ref.sha256) fail(`assertions.${assertion_.id}.evidence`, 'condition identity, revision or digest mismatch');
  return { side, condition: ref, confirmation: report.conditions.find(item => item.id === ref.id).confirmation,
    authority: 'not-authenticated' };
}
function validateSelectedFields(request, compilations) {
  for (const [index, item] of request.observations.entries()) {
    if (item.field === 'faults') continue;
    for (const side of ['baseline', 'candidate']) {
      const compilation = compilations[side];
      const exists = ['requested', 'safe'].includes(item.field)
        ? (compilation.manifest.outputs ?? []).some(field => field.name === item.name)
        : (compilation.traceMetadata?.bindings ?? []).some(binding => binding.kind === 'state'
          && binding.name === item.name && binding.fields?.includes(item.field));
      if (!exists) {
        fail(`request.observations[${index}]`, `${side} has no ${item.field}.${item.name}`);
      }
    }
  }
}
function duration(rows, item, from, to) {
  let total = 0;
  for (let index = from; index < to; index += 1) {
    const value = selected(rows[index], item);
    if (typeof value !== 'boolean') fail('runtime.duration', 'selected duration observation is not Bool');
    if (value) total += rows[index + 1].logicalTimeMs - rows[index].logicalTimeMs;
  }
  return total;
}
function checkedResult(report) {
  if (Buffer.byteLength(JSON.stringify(report)) > BEHAVIOR_COMPARISON_LIMITS.resultBytes) {
    return { format: report.format, requestSha256: report.requestSha256, scenario: report.scenario,
      baseline: report.baseline, candidate: report.candidate, scope: report.scope, physicalEffects: false,
      outcome: 'incomplete', observations: [], assertions: report.assertions.map(item => ({ id: item.id,
        specificationSha256: item.specificationSha256, status: 'unknown', reason: 'result byte limit exceeded' })),
      runs: Object.fromEntries(Object.entries(report.runs ?? {}).map(([side, run]) => [side, { outcome: run.outcome, scans: run.scans,
        ...(run.error ? { error: run.error } : {}) }])),
      error: { code: 'GF_BEHAVIOR_COMPARISON', message: 'result byte limit exceeded' } };
  }
  return report;
}

/** Compare two fresh executions of one frozen scenario. No live I/O or inferred expected behavior. */
export async function compareBehavior(input) {
  // Capture every caller-owned object before the first asynchronous compiler call.
  const request = capture(input);
  const scenarioText = validate(request);
  const compilations = {};
  for (const side of ['baseline', 'candidate']) {
    const item = request[side];
    compilations[side] = await compileSource(item.source, { filename: item.filename,
      ...(item.sourceClosure ? { sourceClosure: item.sourceClosure } : {}),
      ...(Object.hasOwn(item, 'intentEvidence') ? { intentEvidence: item.intentEvidence } : {}) });
    if (!compilations[side].manifest) fail(`request.${side}`, 'source must compile to an executable control');
    validateScenario(request.scenario, compilations[side].manifest);
  }
  validateSelectedFields(request, compilations);
  const evidence = (request.assertions ?? []).map(item => boundEvidence(item, compilations));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-behavior-'));
  try {
    const scenarioPath = path.join(directory, 'scenario.toon');
    fs.writeFileSync(scenarioPath, scenarioText);
    const outputs = {};
    const identities = {};
    for (const side of ['baseline', 'candidate']) {
      const artifact = path.join(directory, `${side}.gfb`);
      writeArtifact(compilations[side], artifact);
      identities[side] = identity(compilations[side], scenarioExecutionBackend(compilations[side].manifest, request.scenario));
      try {
        const executed = runScenario(artifact, scenarioPath, { format: 'json' });
        outputs[side] = JSON.parse(executed.encoded);
      } catch (error) {
        outputs[side] = { outcome: 'host-error', scans: [], error: { message: stableError(safeError(error), directory) } };
      }
    }
    const basis = { format: 'GhostFlow/behavior-comparison-result-v1', requestSha256: hash(canonicalJson(request)),
      scenario: { id: request.scenario.id, sha256: hash(Buffer.from(scenarioText)),
      scanCount: request.scenario.actions.filter(item => item.kind === 'scan').length },
      baseline: identities.baseline, candidate: identities.candidate, scope: request.scope,
      observationScope: request.observations, initialState: 'canonical-source-initial-state',
      outputMeaning: 'virtual requested/safe intent and state; physicalEffects:false', physicalEffects: false };
    const partialRun = side => ({ outcome: outputs[side].outcome, scans: outputs[side].scans?.length ?? 0,
      ...(outputs[side].error ? { error: { ...outputs[side].error,
        message: stableError(outputs[side].error.message ?? '', directory) } } : {}),
      partialObservations: (outputs[side].scans ?? []).filter(scan => scan.scanId >= request.scope.from.scanId
        && scan.scanId <= request.scope.to.scanId).map(scan => ({
        at: { scanId: scan.scanId, logicalTimeMs: scan.logicalTimeMs },
        values: request.observations.map(item => {
          try { return { observation: item, value: selected(scan, item) }; }
          catch { return { observation: item, unavailable: true }; }
        }),
      })) });
    const unknown = reason => checkedResult({ ...basis, outcome: 'incomplete', observations: [],
      assertions: (request.assertions ?? []).map((item, index) => ({ id: item.id, specification: item,
        specificationSha256: hash(canonicalJson(item)), status: 'unknown', reason,
        ...(evidence[index] ? { evidence: evidence[index] } : { evidenceBinding: 'unlinked' }) })),
      runs: { baseline: partialRun('baseline'), candidate: partialRun('candidate') },
      error: { code: 'GF_BEHAVIOR_COMPARISON_INCOMPLETE', message: reason } });
    if (outputs.baseline.outcome !== 'completed' || outputs.candidate.outcome !== 'completed') {
      return unknown('one or both scenario runs did not complete');
    }
    const left = outputs.baseline.scans, right = outputs.candidate.scans;
    if (left.length !== right.length || !left.length) return unknown('scan count differs');
    for (let index = 0; index < left.length; index += 1) {
      if (left[index].scanId !== right[index].scanId || left[index].logicalTimeMs !== right[index].logicalTimeMs) return unknown('scan identities differ');
    }
    const from = left.findIndex(item => equal({ scanId: item.scanId, logicalTimeMs: item.logicalTimeMs }, request.scope.from));
    const to = left.findIndex(item => equal({ scanId: item.scanId, logicalTimeMs: item.logicalTimeMs }, request.scope.to));
    if (from < 0 || to < from) fail('request.scope', 'endpoints must match executed scans');
    for (const item of request.assertions ?? []) {
      if (item.kind === 'equals' && (item.at.scanId < request.scope.from.scanId || item.at.scanId > request.scope.to.scanId
          || !left.some(scan => equal({ scanId: scan.scanId, logicalTimeMs: scan.logicalTimeMs }, item.at)))) {
        fail(`assertions.${item.id}.at`, 'must match a scan inside scope');
      }
      if (item.kind === 'bool-on-duration-delta' && to === from) fail(`assertions.${item.id}`, 'duration requires two exact scan endpoints');
    }
    const observations = left.slice(from, to + 1).map((scan, offset) => ({
      at: { scanId: scan.scanId, logicalTimeMs: scan.logicalTimeMs },
      values: request.observations.map(item => {
        const baseline = selected(scan, item), candidate = selected(right[from + offset], item);
        return { observation: item, baseline, candidate, equal: equal(baseline, candidate) };
      }),
    }));
    const assertions = (request.assertions ?? []).map((item, index) => {
      let actual, passed;
      if (item.kind === 'unchanged') {
        actual = observations.every(row => {
          const value = row.values.find(entry => equal(entry.observation, item.observation));
          if (value) return value.equal;
          return equal(selected(left.find(scan => scan.scanId === row.at.scanId), item.observation),
            selected(right.find(scan => scan.scanId === row.at.scanId), item.observation));
        });
        passed = actual;
      } else if (item.kind === 'equals') {
        const row = (item.side === 'baseline' ? left : right).find(scan => scan.scanId === item.at.scanId);
        actual = selected(row, item.observation); passed = equal(actual, item.expected);
      } else {
        const baselineMs = duration(left, item.observation, from, to);
        const candidateMs = duration(right, item.observation, from, to);
        actual = { baselineMs, candidateMs, deltaMs: candidateMs - baselineMs };
        passed = actual.deltaMs === item.expectedDeltaMs;
      }
      return { id: item.id, kind: item.kind, specification: item, specificationSha256: hash(canonicalJson(item)),
        status: passed ? 'satisfied' : 'violated', actual,
        ...(evidence[index] ? { evidence: evidence[index] } : { evidenceBinding: 'unlinked' }) };
    });
    return checkedResult({ ...basis, outcome: 'completed', observations, assertions,
      summary: { changed: observations.flatMap(row => row.values).filter(item => !item.equal).length,
        unchanged: observations.flatMap(row => row.values).filter(item => item.equal).length },
      runs: { baseline: { outcome: 'completed', scans: left.length }, candidate: { outcome: 'completed', scans: right.length } } });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
