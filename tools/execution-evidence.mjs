// One completed-scan explanation plus strictly correlated, caller-supplied device reports.
import { canonicalJson } from './canonical-json.mjs';
import { sha256Hex } from './sha256.mjs';
import { compileSourceSync } from './compile-source.mjs';
import { prepareOutputExplanation, joinOutputExplanation } from './explanation.mjs';
import { emitCompletedScanSnapshot } from './interaction-runtime-snapshot.mjs';

export const EXECUTION_EVIDENCE_REQUEST = 'GhostFlow/execution-evidence-request-v1';
export const EXECUTION_EVIDENCE_RESULT = 'GhostFlow/execution-evidence-result-v1';
export const EXECUTION_EVIDENCE_LIMITS = Object.freeze({ inputBytes: 524288, outputBytes: 524288, records: 128 });
const SHA = /^[a-f0-9]{64}$/;
const own = (v, k) => Object.hasOwn(v, k);
const fail = (path, message) => { const error = new Error(`${path}: ${message}`); error.code = 'GF_EXECUTION_EVIDENCE'; error.path = path; throw error; };
function record(v, p, required, optional = []) {
  if (!v || Object.getPrototypeOf(v) !== Object.prototype) fail(p, 'expected object');
  for (const k of required) if (!own(v, k)) fail(`${p}.${k}`, 'required');
  for (const k of Object.keys(v)) if (![...required, ...optional].includes(k)) fail(`${p}.${k}`, 'unexpected field');
}
function text(v, p, max = 512) { if (typeof v !== 'string' || !v.trim() || v.length > max) fail(p, 'expected bounded nonempty text'); }
function digest(v, p) { if (typeof v !== 'string' || !SHA.test(v)) fail(p, 'expected lowercase SHA-256'); }
function time(v, p) { if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail(p, 'expected canonical UTC timestamp'); }
function value(v, p) { if (typeof v !== 'boolean' && !(typeof v === 'number' && Number.isFinite(v))) fail(p, 'expected Boolean or finite number'); }
function nonnegative(v, p) { if (!Number.isSafeInteger(v) || v < 0) fail(p, 'expected nonnegative safe integer'); }
function boundedArray(v, p) { if (!Array.isArray(v) || v.length > EXECUTION_EVIDENCE_LIMITS.records) fail(p, 'expected bounded array'); }

function validateDevice(device) {
  record(device, 'deviceEvidence', ['identity', 'records']);
  const id = device.identity;
  record(id, 'deviceEvidence.identity', ['sourceDocumentId', 'sourceRevisionId', 'sourceSha256', 'bytecodeSha256', 'runId', 'scanId', 'logicalTimeMs', 'outputId', 'deviceId', 'bootId', 'installationRef', 'clockRef', 'requestId']);
  for (const k of ['sourceSha256', 'bytecodeSha256']) digest(id[k], `deviceEvidence.identity.${k}`);
  for (const k of ['sourceDocumentId', 'sourceRevisionId', 'runId', 'outputId', 'deviceId', 'bootId', 'installationRef', 'clockRef', 'requestId']) text(id[k], `deviceEvidence.identity.${k}`);
  for (const k of ['scanId', 'logicalTimeMs']) nonnegative(id[k], `deviceEvidence.identity.${k}`);
  boundedArray(device.records, 'deviceEvidence.records');
  for (const [index, r] of device.records.entries()) {
    const p = `deviceEvidence.records[${index}]`;
    record(r, p, ['kind', 'id', 'requestId', 'at', 'ref'], ['stage', 'value', 'outcome', 'quality']);
    for (const k of ['id', 'requestId', 'ref']) text(r[k], `${p}.${k}`);
    time(r.at, `${p}.at`);
    if (r.kind === 'driver-request') {
      if (!['requested', 'safe'].includes(r.stage) || !own(r, 'value') || own(r, 'outcome') || own(r, 'quality')) fail(p, 'invalid driver request');
      value(r.value, `${p}.value`);
    } else if (r.kind === 'ack') {
      if (!['accepted', 'rejected', 'fault', 'unknown'].includes(r.outcome) || own(r, 'stage') || own(r, 'value') || own(r, 'quality')) fail(p, 'invalid ACK');
    } else if (['register-readback', 'physical-feedback'].includes(r.kind)) {
      if (!['ok', 'fault', 'unknown'].includes(r.quality) || own(r, 'stage') || own(r, 'outcome') || (r.quality === 'ok' && !own(r, 'value')) || (r.quality !== 'ok' && own(r, 'value'))) fail(p, 'invalid observation quality/value');
      if (own(r, 'value')) value(r.value, `${p}.value`);
    } else fail(`${p}.kind`, 'unknown record kind');
  }
}
function deviceProjection(device, expected, requested, safe) {
  const missing = ['driver-request-missing', 'ack-missing', 'register-readback-missing', 'physical-feedback-missing'];
  if (!device) return { status: 'not-supplied', trust: 'not-authenticated', identity: null, records: [], diagnostics: missing.map(code => ({ code })) };
  validateDevice(device);
  const identity = device.identity, diagnostics = [];
  for (const [key, actual] of Object.entries(expected)) if (identity[key] !== actual) diagnostics.push({ code: `${key}-mismatch`, path: `deviceEvidence.identity.${key}` });
  if (diagnostics.length) return { status: 'unlinked', trust: 'not-authenticated', identity, records: device.records,
    diagnostics: [...diagnostics, ...missing.map(code => ({ code, reason: 'identity-unlinked' }))] };
  const requests = device.records.filter(r => r.kind === 'driver-request');
  const ids = new Set();
  const stages = new Map();
  for (const [index, r] of device.records.entries()) {
    const key = `${r.kind}:${r.id}`;
    if (ids.has(key)) diagnostics.push({ code: 'duplicate-record', index });
    ids.add(key);
    const stage = r.kind;
    if (stages.has(stage)) diagnostics.push({ code: 'conflicting-stage', index, otherIndex: stages.get(stage) });
    else stages.set(stage, index);
    if (r.requestId !== identity.requestId || r.kind === 'driver-request' && r.id !== identity.requestId) diagnostics.push({ code: 'request-mismatch', index });
    if (r.kind === 'driver-request' && r.value !== (r.stage === 'requested' ? requested : safe)) diagnostics.push({ code: 'stage-value-mismatch', index });
    if (r.kind !== 'driver-request' && !requests.some(q => q.id === r.requestId)) diagnostics.push({ code: 'orphan-record', index });
    if (r.kind !== 'driver-request' && requests.length === 1 && Date.parse(r.at) < Date.parse(requests[0].at)) diagnostics.push({ code: 'stage-before-request', index });
    if (['register-readback', 'physical-feedback'].includes(r.kind) && r.quality === 'ok' && requests.length === 1 && r.value !== requests[0].value) diagnostics.push({ code: 'reported-value-differs', index });
  }
  if (!requests.some(r => r.id === identity.requestId)) diagnostics.push({ code: 'driver-request-missing' });
  for (const [kind, code] of [['ack', 'ack-missing'], ['register-readback', 'register-readback-missing'], ['physical-feedback', 'physical-feedback-missing']]) {
    if (!device.records.some(r => r.kind === kind)) diagnostics.push({ code });
  }
  return { status: diagnostics.some(d => /mismatch|duplicate|orphan|conflicting|before|differs/.test(d.code)) ? 'conflicted' : 'linked-external-report',
    trust: 'not-authenticated', identity, records: device.records, diagnostics };
}
function authoredProjection(compilation, proof, descriptor) {
  const report = compilation.intentEvidence;
  if (!report) return { status: 'not-supplied', conditions: [], interpretations: [], judgments: null };
  const evaluations = new Map();
  const outputName = proof.outputId.replace(/^output\./, '');
  const outputBinding = compilation.traceMetadata.bindings.find(b => b.kind === 'connection' && b.name === outputName);
  for (const e of proof.evaluations) {
    const node = descriptor.nodes.find(n => n.id === e.nodeId);
    for (const source of node?.sources ?? []) {
      if (!['input', 'state'].includes(node.kind) && source.sourceNode.nodeId !== outputBinding?.nodeId) continue;
      const id = source.sourceNode.nodeId;
      const list = evaluations.get(id) ?? [];
      list.push({ occurrenceId: e.occurrenceId, evaluated: e.evaluated, supportsResult: e.supportsResult });
      evaluations.set(id, list);
    }
  }
  const conditions = report.record.conditions.map(original => {
    const summary = report.conditions.find(c => c.id === original.id);
    const occurrences = original.nodeIds.flatMap(id => evaluations.get(id) ?? []);
    const relation = proof.status !== 'ready' ? 'not-evaluated'
      : occurrences.some(e => e.evaluated && e.supportsResult) ? 'supports-requested-result'
        : occurrences.some(e => e.evaluated) ? 'evaluated-not-supporting' : 'not-evaluated';
    return { original, confirmation: summary.confirmation, checkIds: summary.checkIds,
      relation, occurrences };
  });
  return { status: 'source-bound', recordSha256: report.recordSha256,
    interpretations: report.record.interpretations, conditions,
    externalChecks: report.externalChecks, judgments: report.judgments, coverage: report.coverage };
}

/** Pure one-shot projection. Runtime results and device reports are caller supplied, not authenticated. */
export function explainExecution(input) {
  let serialized;
  try { serialized = canonicalJson(input, { depthLimit: 24, rejectSparseArrays: true, rejectUnsafeIntegers: true }); }
  catch (e) { fail('request', e.message); }
  if (Buffer.byteLength(serialized, 'utf8') > EXECUTION_EVIDENCE_LIMITS.inputBytes) fail('request', 'byte limit exceeded');
  const request = JSON.parse(serialized);
  record(request, 'request', ['schema', 'source', 'runId', 'outputId', 'result'], ['sourceClosure', 'intentEvidence', 'expectedDevice', 'deviceEvidence']);
  if (request.schema !== EXECUTION_EVIDENCE_REQUEST) fail('request.schema', `expected ${EXECUTION_EVIDENCE_REQUEST}`);
  record(request.source, 'request.source', ['text', 'filename', 'documentId', 'revisionId']);
  text(request.source.text, 'request.source.text', 262144);
  for (const k of ['filename', 'documentId', 'revisionId']) text(request.source[k], `request.source.${k}`);
  text(request.runId, 'request.runId'); text(request.outputId, 'request.outputId');
  if (own(request, 'sourceClosure')) {
    if (!Array.isArray(request.sourceClosure) || request.sourceClosure.length > 32) fail('request.sourceClosure', 'expected bounded array');
    for (const [i, item] of request.sourceClosure.entries()) {
      record(item, `request.sourceClosure[${i}]`, ['filename', 'revision', 'text']);
      text(item.filename, `request.sourceClosure[${i}].filename`);
      text(item.revision, `request.sourceClosure[${i}].revision`);
      text(item.text, `request.sourceClosure[${i}].text`, 262144);
    }
  }
  if (own(request, 'deviceEvidence')) {
    if (!own(request, 'expectedDevice')) fail('request.expectedDevice', 'required when deviceEvidence is supplied');
    validateDevice(request.deviceEvidence);
  }
  if (own(request, 'expectedDevice')) {
    record(request.expectedDevice, 'request.expectedDevice', ['deviceId', 'bootId', 'installationRef', 'clockRef', 'requestId']);
    for (const k of ['deviceId', 'bootId', 'installationRef', 'clockRef', 'requestId']) text(request.expectedDevice[k], `request.expectedDevice.${k}`);
  }
  const compilation = compileSourceSync(request.source.text, { filename: request.source.filename,
    interactionSourceIdentity: { documentId: request.source.documentId, revisionId: request.source.revisionId },
    ...(own(request, 'sourceClosure') ? { sourceClosure: request.sourceClosure } : {}),
    ...(own(request, 'intentEvidence') ? { intentEvidence: request.intentEvidence } : {}) });
  const producer = prepareOutputExplanation({ compilation, runId: request.runId });
  const proof = producer.emit({ runId: request.runId, result: request.result, outputId: request.outputId });
  const snapshot = emitCompletedScanSnapshot({ compilation, runId: request.runId, completion: proof.completion,
    trace: request.result.outcome.trace });
  const joined = joinOutputExplanation(compilation.interactionSchema, proof, snapshot, producer.expected, producer.descriptor, request.result);
  if (joined.status !== 'ready') fail('result', 'completed result failed exact identity join');
  const name = request.outputId.replace(/^output\./, '');
  const safe = request.result.outcome.trace.safe?.[name];
  const outputType = compilation.manifest.outputs.find(o => o.name === name)?.type;
  if (safe === undefined || (outputType === 'Bool' ? typeof safe !== 'boolean' : typeof safe !== 'number' || !Number.isFinite(safe))) fail('result.outcome.trace.safe', 'safe output unavailable or wrong type');
  const expectedDevice = { sourceDocumentId: request.source.documentId, sourceRevisionId: request.source.revisionId,
    sourceSha256: compilation.sourceDocument.sha256,
    bytecodeSha256: compilation.manifest.bytecodeSha256, runId: request.runId,
    scanId: proof.completion.scanId, logicalTimeMs: proof.completion.logicalTimeMs,
    outputId: request.outputId, ...(request.expectedDevice ?? {}) };
  const result = { schema: EXECUTION_EVIDENCE_RESULT, outcome: 'completed', source: { documentId: request.source.documentId,
    revisionId: request.source.revisionId, filename: request.source.filename, sha256: compilation.sourceDocument.sha256 },
    module: { bytecodeSha256: compilation.manifest.bytecodeSha256 }, runId: request.runId,
    completion: proof.completion, outputId: request.outputId,
    requested: { value: proof.value, proof, descriptor: producer.descriptor }, safe: { value: safe, source: 'accepted-completed-scan' },
    authored: authoredProjection(compilation, proof, producer.descriptor),
    device: deviceProjection(request.deviceEvidence, expectedDevice, proof.value, safe),
    trust: { runtimeResult: 'caller-supplied-validated-shape-and-join', deviceEvidence: 'external-report-not-authenticated' },
    requestSha256: sha256Hex(serialized) };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > EXECUTION_EVIDENCE_LIMITS.outputBytes) {
    return { schema: EXECUTION_EVIDENCE_RESULT, outcome: 'incomplete', requestSha256: sha256Hex(serialized),
      diagnostics: [{ code: 'output-limit', message: 'complete result exceeds byte limit' }] };
  }
  return result;
}
