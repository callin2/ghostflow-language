import { canonicalJson } from './canonical-json.mjs';
import { sha256Hex, utf8ByteLength } from './sha256.mjs';

export const INTENT_EVIDENCE_LIMITS = Object.freeze({ bytes: 262144, records: 128, text: 8192 });
const FORMAT = 'GhostFlow/intent-evidence-v1';
const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;

function fail(path, message) {
  const error = new Error(`${path}: ${message}`);
  error.diagnosticCode = 'GF_INTENT_EVIDENCE';
  error.evidencePath = path;
  throw error;
}
function record(value, path, required, optional = []) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail(path, 'must be a plain object');
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required');
  for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) fail(`${path}.${key}`, 'unsupported field');
}
function text(value, path) {
  if (typeof value !== 'string' || !value.trim() || value.length > INTENT_EVIDENCE_LIMITS.text) fail(path, 'must be a nonempty bounded string');
}
function id(value, path) { if (typeof value !== 'string' || !ID.test(value)) fail(path, 'invalid identifier'); }
function digest(value, path) { if (typeof value !== 'string' || !SHA.test(value)) fail(path, 'must be a lowercase SHA-256'); }
function choice(value, values, path) { if (!values.includes(value)) fail(path, `must be one of ${values.join(', ')}`); }
function array(value, path) {
  if (!Array.isArray(value) || value.length > INTENT_EVIDENCE_LIMITS.records) fail(path, 'must be a bounded array');
}
function ids(value, path) {
  array(value, path);
  value.forEach((item, index) => id(item, `${path}[${index}]`));
  if (new Set(value).size !== value.length) fail(path, 'duplicate identifier');
}
function timestamp(value, path) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value.replace(/(?<!\.\d{3})Z$/, '.000Z')) {
    fail(path, 'must be a valid UTC ISO timestamp');
  }
}
function reference(value, path) {
  record(value, path, ['id', 'revision', 'reference']);
  id(value.id, `${path}.id`); id(value.revision, `${path}.revision`); text(value.reference, `${path}.reference`);
}
function version(value, path) {
  record(value, path, ['id', 'revision']);
  id(value.id, `${path}.id`); id(value.revision, `${path}.revision`);
}
function indexed(values, path) {
  array(values, path);
  const result = new Map();
  for (const [index, value] of values.entries()) {
    const at = `${path}[${index}]`;
    if (!value || typeof value !== 'object') fail(at, 'must be a record');
    id(value.id, `${at}.id`);
    if (result.has(value.id)) fail(at, `duplicate id ${value.id}`);
    result.set(value.id, value);
  }
  return result;
}

/** Hash the interpreted content, never its claimed confirmation. */
export function intentInterpretationDigest(value) {
  const { id, revision, original, text, anchorIds } = value;
  return sha256Hex(canonicalJson({ id, revision, original, text, anchorIds }));
}
/** Bind confirmation and external checks to the complete condition revision. */
export function intentConditionDigest(value) { return sha256Hex(canonicalJson(value)); }

function conditionReference(value, conditions, path) {
  record(value, path, ['id', 'revision', 'sha256']);
  id(value.id, `${path}.id`); id(value.revision, `${path}.revision`); digest(value.sha256, `${path}.sha256`);
  const condition = conditions.get(value.id);
  if (!condition || condition.revision !== value.revision || intentConditionDigest(condition) !== value.sha256) {
    fail(path, 'condition identity, revision or digest mismatch');
  }
  return condition;
}

/** Called only with the compiler's freshly derived canonical compilation. No I/O or policy decisions. */
export function bindIntentEvidence(compilation, supplied) {
  let serialized;
  try { serialized = canonicalJson(supplied, { depthLimit: 16, rejectSparseArrays: true, rejectUnsafeIntegers: true }); }
  catch (error) { fail('intentEvidence', error.message); }
  if (utf8ByteLength(serialized) > INTENT_EVIDENCE_LIMITS.bytes) fail('intentEvidence', 'byte limit exceeded');
  // Detach caller-owned data; outputs must not change when a caller edits its next candidate.
  const evidence = JSON.parse(serialized);
  record(evidence, 'intentEvidence', ['format', 'sourceDocumentSha256', 'interpretations', 'conditions', 'checks']);
  if (evidence.format !== FORMAT) fail('intentEvidence.format', `must be ${FORMAT}`);
  digest(evidence.sourceDocumentSha256, 'intentEvidence.sourceDocumentSha256');
  if (evidence.sourceDocumentSha256 !== compilation.sourceDocument.sha256) fail('intentEvidence.sourceDocumentSha256', 'canonical source revision mismatch');
  const bytecodeSha256 = sha256Hex(compilation.bytes);
  const anchors = new Map((compilation.traceMetadata?.intentAnchors ?? []).map(anchor => [anchor.id, anchor]));
  const links = compilation.traceMetadata?.intentLinks ?? [];
  const interpretations = indexed(evidence.interpretations, 'interpretations');
  const conditions = indexed(evidence.conditions, 'conditions');
  indexed(evidence.checks, 'checks');
  const represented = new Set();

  for (const [index, item] of evidence.interpretations.entries()) {
    const at = `interpretations[${index}]`;
    record(item, at, ['id', 'revision', 'original', 'text', 'anchorIds', 'decision']);
    id(item.revision, `${at}.revision`); reference(item.original, `${at}.original`); text(item.text, `${at}.text`);
    ids(item.anchorIds, `${at}.anchorIds`);
    for (const anchorId of item.anchorIds) {
      const anchor = anchors.get(anchorId);
      if (!anchor || anchor.status === 'superseded') fail(`${at}.anchorIds`, 'missing or superseded anchor');
      if (represented.has(anchorId)) fail(`${at}.anchorIds`, 'anchor has multiple current interpretations');
      represented.add(anchorId);
    }
  }
  for (const [index, item] of evidence.conditions.entries()) {
    const at = `conditions[${index}]`;
    record(item, at, ['id', 'revision', 'interpretation', 'statement', 'scope', 'nodeIds']);
    id(item.revision, `${at}.revision`); version(item.interpretation, `${at}.interpretation`);
    text(item.statement, `${at}.statement`); text(item.scope, `${at}.scope`);
    array(item.nodeIds, `${at}.nodeIds`);
    item.nodeIds.forEach((nodeId, index) => {
      if (!Number.isSafeInteger(nodeId) || nodeId < 0) fail(`${at}.nodeIds[${index}]`, 'must be a compiler node ID');
    });
    if (new Set(item.nodeIds).size !== item.nodeIds.length) fail(`${at}.nodeIds`, 'duplicate node');
    const interpretation = interpretations.get(item.interpretation.id);
    if (!interpretation || interpretation.revision !== item.interpretation.revision) fail(`${at}.interpretation`, 'interpretation revision mismatch');
    for (const nodeId of item.nodeIds) {
      if (!compilation.sourceMap.some(node => node.id === nodeId)
          || !links.some(link => link.nodeId === nodeId && interpretation.anchorIds.includes(link.anchorId))) {
        fail(`${at}.nodeIds`, 'node has no authored link to this interpretation in the canonical compilation');
      }
    }
  }

  const decisions = evidence.interpretations.map((item, index) => {
    const at = `interpretations[${index}].decision`, decision = item.decision;
    if (!decision || typeof decision !== 'object') fail(at, 'must be an object');
    choice(decision.kind, ['confirmed', 'policy-derived', 'assumption', 'undecided'], `${at}.kind`);
    const confirming = ['confirmed', 'policy-derived'].includes(decision.kind);
    if (confirming) {
      record(decision, at, ['kind', 'actor', 'authorityRef', 'recordRef', 'at', 'interpretationSha256', 'conditions'],
        decision.kind === 'policy-derived' ? ['policy', 'applicationRef', 'validity'] : []);
      for (const key of ['actor', 'authorityRef', 'recordRef']) text(decision[key], `${at}.${key}`);
      timestamp(decision.at, `${at}.at`); digest(decision.interpretationSha256, `${at}.interpretationSha256`);
      if (intentInterpretationDigest(item) !== decision.interpretationSha256) fail(at, 'confirmation belongs to another interpretation');
      array(decision.conditions, `${at}.conditions`);
      const seen = new Set();
      for (const ref of decision.conditions) {
        const condition = conditionReference(ref, conditions, `${at}.conditions`);
        if (condition.interpretation.id !== item.id || seen.has(ref.id)) fail(`${at}.conditions`, 'foreign or duplicate condition');
        seen.add(ref.id);
      }
      if (decision.kind === 'policy-derived') {
        reference(decision.policy, `${at}.policy`); text(decision.applicationRef, `${at}.applicationRef`);
        choice(decision.validity, ['current', 'expired', 'unknown'], `${at}.validity`);
      }
    } else if (decision.kind === 'assumption') {
      record(decision, at, ['kind', 'actor', 'reason']); text(decision.actor, `${at}.actor`); text(decision.reason, `${at}.reason`);
    } else {
      record(decision, at, ['kind', 'question', 'owner']); text(decision.question, `${at}.question`);
      if (decision.owner !== null) text(decision.owner, `${at}.owner`);
    }
    for (const anchorId of item.anchorIds) {
      const anchor = anchors.get(anchorId);
      if (confirming && (anchor.kind === 'assumption' || anchor.status !== 'confirmed')) fail(at, 'confirmation contradicts authored anchor classification');
      if (!confirming && anchor.status !== 'unconfirmed') fail(at, 'unconfirmed decision contradicts authored anchor status');
      if (decision.kind === 'assumption' && (anchor.kind !== 'assumption' || anchor.origin !== 'ai')) fail(at, 'LLM assumption requires an authored AI assumption');
    }
    return { id: item.id, revision: item.revision, kind: decision.kind,
      confirmation: confirming ? decision.kind === 'policy-derived' && decision.validity !== 'current' ? 'policy-not-current' : 'recorded' : decision.kind === 'assumption' ? 'unconfirmed' : 'undecided',
      authority: 'not-authenticated', conditionIds: confirming ? decision.conditions.map(ref => ref.id) : [] };
  });

  for (const [index, check] of evidence.checks.entries()) {
    const at = `checks[${index}]`;
    record(check, at, ['id', 'judgment', 'conditions', 'result', 'producer', 'evidenceRef', 'scope', 'at', 'context']);
    choice(check.judgment, ['requirements-consistency', 'code-compliance', 'device-compliance'], `${at}.judgment`);
    choice(check.result, ['satisfied', 'violated', 'unknown'], `${at}.result`);
    for (const key of ['producer', 'evidenceRef', 'scope']) text(check[key], `${at}.${key}`);
    timestamp(check.at, `${at}.at`); array(check.conditions, `${at}.conditions`);
    if (!check.conditions.length) fail(`${at}.conditions`, 'must name the conditions actually checked');
    const seen = new Set();
    for (const ref of check.conditions) {
      conditionReference(ref, conditions, `${at}.conditions`);
      if (seen.has(ref.id)) fail(`${at}.conditions`, 'duplicate condition');
      seen.add(ref.id);
    }
    const context = check.context;
    record(context, `${at}.context`, ['sourceDocumentSha256', 'bytecodeSha256', 'method', 'setupRef'], ['run', 'device']);
    if (context.sourceDocumentSha256 !== evidence.sourceDocumentSha256 || context.bytecodeSha256 !== bytecodeSha256) fail(`${at}.context`, 'check source or bytecode revision mismatch');
    text(context.setupRef, `${at}.context.setupRef`);
    choice(context.method, ['static', 'scenario', 'physical'], `${at}.context.method`);
    if (context.method === 'static' && Object.hasOwn(context, 'run')) fail(`${at}.context.run`, 'static check cannot claim a completed scan');
    if (context.method !== 'static') {
      record(context.run, `${at}.context.run`, ['id', 'scanId', 'logicalTimeMs']);
      id(context.run.id, `${at}.context.run.id`);
      for (const key of ['scanId', 'logicalTimeMs']) if (!Number.isSafeInteger(context.run[key]) || context.run[key] < 0) fail(`${at}.context.run.${key}`, 'must be a nonnegative safe integer');
    }
    if (check.judgment === 'device-compliance' && context.method !== 'physical') fail(`${at}.context.method`, 'device judgment requires physical evidence context');
    if (context.method === 'physical') {
      if (check.judgment !== 'device-compliance') fail(`${at}.judgment`, 'physical evidence requires a device judgment');
      record(context.device, `${at}.context.device`, ['id', 'installationRef', 'commandRef', 'observationRef', 'clockRef', 'stage', 'quality']);
      for (const key of ['id', 'installationRef', 'commandRef', 'observationRef', 'clockRef']) text(context.device[key], `${at}.context.device.${key}`);
      choice(context.device.stage, ['requested', 'safe', 'applied', 'readback', 'confirmed'], `${at}.context.device.stage`);
      choice(context.device.quality, ['ok', 'unknown', 'fault'], `${at}.context.device.quality`);
    } else if (Object.hasOwn(context, 'device')) fail(`${at}.context.device`, 'nonphysical checks cannot carry device evidence');
  }
  return {
    format: 'GhostFlow/intent-evidence-report-v1',
    recordSha256: sha256Hex(serialized), sourceDocumentSha256: evidence.sourceDocumentSha256, bytecodeSha256,
    validation: { structure: 'valid', sourceBinding: 'matched', authoredLinks: 'matched' },
    judgments: { intentFit: 'not-evaluated', requirementsConsistency: 'not-evaluated', codeCompliance: 'not-evaluated', deviceCompliance: 'not-evaluated' },
    decisions,
    conditions: evidence.conditions.map(condition => {
      const decision = decisions.find(item => item.id === condition.interpretation.id);
      return { id: condition.id, revision: condition.revision, nodeIds: [...condition.nodeIds],
        confirmation: decision.confirmation !== 'recorded' ? decision.confirmation : decision.conditionIds.includes(condition.id) ? 'recorded' : 'outside-confirmed-scope',
        checkIds: evidence.checks.filter(check => check.conditions.some(ref => ref.id === condition.id)).map(check => check.id) };
    }),
    externalChecks: evidence.checks.map(check => ({ id: check.id, judgment: check.judgment, reportedResult: check.result, trust: 'external-report' })),
    coverage: { unrepresentedAnchorIds: [...anchors.values()].filter(anchor => anchor.status !== 'superseded' && !represented.has(anchor.id)).map(anchor => anchor.id),
      unlinkedConditionIds: evidence.conditions.filter(condition => !condition.nodeIds.length).map(condition => condition.id) },
    record: evidence,
  };
}
