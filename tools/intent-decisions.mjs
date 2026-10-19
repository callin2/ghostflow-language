// Pure inspection of compiler-bound authored decisions and explicit external requirements.
import { canonicalJson } from './canonical-json.mjs';
import { sha256Hex } from './sha256.mjs';
import { compileSourceSync } from './compile-source.mjs';
import { intentConditionDigest, intentInterpretationDigest } from './intent-evidence.mjs';

export const INTENT_DECISIONS_REQUEST = 'GhostFlow/intent-decisions-request-v1';
export const INTENT_DECISIONS_RESULT = 'GhostFlow/intent-decisions-result-v1';
export const INTENT_DECISIONS_LIMITS = Object.freeze({ inputBytes: 524288, outputBytes: 524288, records: 128 });
const own = (v, k) => Object.hasOwn(v, k);
const SHA = /^[a-f0-9]{64}$/;
const fail = (p, message) => { const e = new Error(`${p}: ${message}`); e.code = 'GF_INTENT_DECISIONS'; e.path = p; throw e; };
function rec(v, p, required, optional = []) {
  if (!v || Object.getPrototypeOf(v) !== Object.prototype) fail(p, 'expected object');
  for (const k of required) if (!own(v, k)) fail(`${p}.${k}`, 'required');
  for (const k of Object.keys(v)) if (![...required, ...optional].includes(k)) fail(`${p}.${k}`, 'unexpected field');
}
function txt(v, p, max = 512) { if (typeof v !== 'string' || !v.trim() || v.length > max) fail(p, 'expected bounded nonempty text'); }
function sha(v, p) { if (typeof v !== 'string' || !SHA.test(v)) fail(p, 'expected lowercase SHA-256'); }
function utc(v, p) { if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail(p, 'expected canonical UTC timestamp'); }
function arr(v, p, max = INTENT_DECISIONS_LIMITS.records) { if (!Array.isArray(v) || v.length > max) fail(p, 'expected bounded array'); }
function uniqueText(v, p) {
  arr(v, p); const seen = new Set();
  v.forEach((x, i) => { txt(x, `${p}[${i}]`); if (seen.has(x)) fail(`${p}[${i}]`, 'duplicate'); seen.add(x); });
}
function version(v, p, hash = false) {
  rec(v, p, ['id', 'revision', ...(hash ? ['sha256'] : [])]);
  txt(v.id, `${p}.id`); txt(v.revision, `${p}.revision`); if (hash) sha(v.sha256, `${p}.sha256`);
}
function sourceObject(v, p) {
  rec(v, p, ['source', 'intentEvidence'], ['sourceClosure']);
  rec(v.source, `${p}.source`, ['text', 'filename', 'documentId', 'revisionId']);
  txt(v.source.text, `${p}.source.text`, 262144);
  for (const k of ['filename', 'documentId', 'revisionId']) txt(v.source[k], `${p}.source.${k}`);
  if (own(v, 'sourceClosure')) {
    arr(v.sourceClosure, `${p}.sourceClosure`, 32);
    v.sourceClosure.forEach((item, i) => {
      rec(item, `${p}.sourceClosure[${i}]`, ['filename', 'revision', 'text']);
      txt(item.filename, `${p}.sourceClosure[${i}].filename`);
      txt(item.revision, `${p}.sourceClosure[${i}].revision`);
      txt(item.text, `${p}.sourceClosure[${i}].text`, 262144);
    });
  }
}
function compileVersion(v, p) {
  sourceObject(v, p);
  const c = compileSourceSync(v.source.text, { filename: v.source.filename,
    interactionSourceIdentity: { documentId: v.source.documentId, revisionId: v.source.revisionId },
    ...(own(v, 'sourceClosure') ? { sourceClosure: v.sourceClosure } : {}), intentEvidence: v.intentEvidence });
  const report = c.intentEvidence;
  if (!report) fail(`${p}.intentEvidence`, 'validated intent evidence required');
  return { source: { documentId: v.source.documentId, revisionId: v.source.revisionId,
    filename: v.source.filename, sha256: c.sourceDocument.sha256, bytecodeSha256: c.manifest.bytecodeSha256,
    ...(c.sourceClosure ? { sourceClosureSha256: sha256Hex(canonicalJson(c.sourceClosure)) } : {}) },
    report };
}
function interpretationRow(item, report) {
  const summary = report.decisions.find(d => d.id === item.id);
  const ownedConditions = report.record.conditions.filter(c => c.interpretation.id === item.id);
  return { id: item.id, revision: item.revision, contentSha256: intentInterpretationDigest(item),
    recordSha256: sha256Hex(canonicalJson({ interpretation: item, conditions: ownedConditions })), original: item,
    kind: summary.kind, confirmation: summary.confirmation, authority: summary.authority,
    conditions: ownedConditions.map(c => {
      const status = report.conditions.find(x => x.id === c.id);
      return { original: c, sha256: intentConditionDigest(c), confirmation: status.confirmation,
        checkIds: status.checkIds };
    }) };
}
function rows(version) { return version.report.record.interpretations.map(item => interpretationRow(item, version.report)); }
function requirementContract(contract, rowsNow) {
  if (contract === undefined) return { status: 'not-supplied', requirements: [], diagnostics: [] };
  rec(contract, 'requirementContract', ['id', 'revision', 'reference', 'requirements']);
  for (const k of ['id', 'revision', 'reference']) txt(contract[k], `requirementContract.${k}`);
  arr(contract.requirements, 'requirementContract.requirements');
  const ids = new Set(), evaluations = [], diagnostics = [];
  for (const [i, req] of contract.requirements.entries()) {
    const p = `requirementContract.requirements[${i}]`;
    rec(req, p, ['id', 'interpretation', 'level', 'actionRefs', 'claimRefs', 'onUnmet'], ['conditionRefs']);
    txt(req.id, `${p}.id`); if (ids.has(req.id)) fail(`${p}.id`, 'duplicate'); ids.add(req.id);
    rec(req.interpretation, `${p}.interpretation`, ['id'], ['revision', 'sha256']);
    txt(req.interpretation.id, `${p}.interpretation.id`);
    if (own(req.interpretation, 'revision')) txt(req.interpretation.revision, `${p}.interpretation.revision`);
    if (own(req.interpretation, 'sha256')) sha(req.interpretation.sha256, `${p}.interpretation.sha256`);
    if (!['represented', 'confirmed'].includes(req.level)) fail(`${p}.level`, 'expected represented or confirmed');
    if (!['report', 'hold', 'block'].includes(req.onUnmet)) fail(`${p}.onUnmet`, 'expected report, hold or block');
    uniqueText(req.actionRefs, `${p}.actionRefs`); uniqueText(req.claimRefs, `${p}.claimRefs`);
    if (own(req, 'conditionRefs')) {
      arr(req.conditionRefs, `${p}.conditionRefs`); const seen = new Set();
      req.conditionRefs.forEach((x, j) => { version(x, `${p}.conditionRefs[${j}]`, true);
        if (seen.has(x.id)) fail(`${p}.conditionRefs[${j}]`, 'duplicate condition'); seen.add(x.id); });
    }
    const item = rowsNow.find(x => x.id === req.interpretation.id), codes = [];
    if (!item) codes.push('interpretation-missing');
    else {
      if (own(req.interpretation, 'revision') && req.interpretation.revision !== item.revision) codes.push('interpretation-revision-mismatch');
      if (own(req.interpretation, 'sha256') && req.interpretation.sha256 !== item.contentSha256) codes.push('interpretation-content-mismatch');
      for (const ref of req.conditionRefs ?? []) {
        const c = item.conditions.find(x => x.original.id === ref.id);
        if (!c) codes.push(`condition-missing:${ref.id}`);
        else if (c.original.revision !== ref.revision || c.sha256 !== ref.sha256) codes.push(`condition-version-mismatch:${ref.id}`);
        else if (req.level === 'confirmed' && c.confirmation !== 'recorded') codes.push(`condition-outside-confirmed-scope:${ref.id}`);
      }
      if (req.level === 'confirmed' && item.confirmation !== 'recorded') codes.push(`decision-${item.confirmation}`);
    }
    const status = codes.length ? 'unmet' : 'met';
    const row = { requirement: req, status, matchedInterpretation: item ? { id: item.id, revision: item.revision,
      contentSha256: item.contentSha256, kind: item.kind, confirmation: item.confirmation } : null, codes };
    evaluations.push(row);
    if (codes.length) diagnostics.push({ requirementId: req.id, codes, onUnmet: req.onUnmet,
      actionRefs: req.actionRefs, claimRefs: req.claimRefs });
  }
  return { status: 'supplied', id: contract.id, revision: contract.revision, reference: contract.reference,
    requirements: evaluations, diagnostics };
}
function transitionsOf(supplied, before, after) {
  if (supplied === undefined) supplied = [];
  arr(supplied, 'transitions');
  const previous = new Map(before.map(x => [x.id, x])), current = new Map(after.map(x => [x.id, x]));
  const fromIds = new Set(), toIds = new Set(), links = [];
  for (const [i, t] of supplied.entries()) {
    const p = `transitions[${i}]`;
    rec(t, p, ['from', 'to', 'actor', 'recordRef', 'at']);
    version(t.from, `${p}.from`, true); version(t.to, `${p}.to`, true);
    txt(t.actor, `${p}.actor`); txt(t.recordRef, `${p}.recordRef`); utc(t.at, `${p}.at`);
    if (fromIds.has(t.from.id) || toIds.has(t.to.id)) fail(p, 'duplicate or ambiguous transition');
    const old = previous.get(t.from.id), now = current.get(t.to.id);
    if (!old || !now || old.revision !== t.from.revision || now.revision !== t.to.revision
        || old.recordSha256 !== t.from.sha256 || now.recordSha256 !== t.to.sha256) fail(p, 'stale or mismatched transition reference');
    if (old.id !== now.id && (current.has(old.id) || previous.has(now.id))) fail(p, 'ambiguous renamed interpretation');
    fromIds.add(old.id); toIds.add(now.id); links.push(t);
  }
  const changes = [];
  const pairedOld = new Set(), pairedNow = new Set();
  for (const old of before) {
    const link = links.find(t => t.from.id === old.id);
    const now = link ? current.get(link.to.id) : current.get(old.id);
    if (!now || pairedNow.has(now.id)) continue;
    pairedOld.add(old.id); pairedNow.add(now.id);
    const status = old.recordSha256 === now.recordSha256 ? 'unchanged' : 'changed';
    const diagnostics = [];
    if (status === 'changed' && old.id === now.id && old.revision === now.revision && old.contentSha256 !== now.contentSha256) diagnostics.push('interpretation-revision-reused');
    if (status === 'changed') {
      for (const priorCondition of old.conditions) {
        const currentCondition = now.conditions.find(c => c.original.id === priorCondition.original.id);
        if (currentCondition && currentCondition.original.revision === priorCondition.original.revision
            && currentCondition.sha256 !== priorCondition.sha256) diagnostics.push(`condition-revision-reused:${priorCondition.original.id}`);
      }
    }
    if (status === 'changed' && !link) diagnostics.push('transition-link-missing');
    changes.push({ status, before: old, after: now, transition: link ?? null, diagnostics });
  }
  for (const old of before) if (!pairedOld.has(old.id)) changes.push({ status: 'removed', before: old, after: null,
    transition: null, diagnostics: [] });
  for (const now of after) if (!pairedNow.has(now.id)) changes.push({ status: 'added', before: null, after: now,
    transition: null, diagnostics: [] });
  return { status: 'compared', changes, transitionCount: links.length };
}

/** Compiler-bound inspection; no natural-language judgment or runtime policy enforcement. */
export function inspectIntentDecisions(input) {
  let encoded;
  try { encoded = canonicalJson(input, { depthLimit: 24, rejectSparseArrays: true, rejectUnsafeIntegers: true }); }
  catch (e) { fail('request', e.message); }
  if (Buffer.byteLength(encoded, 'utf8') > INTENT_DECISIONS_LIMITS.inputBytes) fail('request', 'byte limit exceeded');
  const req = JSON.parse(encoded);
  rec(req, 'request', ['schema', 'current'], ['requirementContract', 'previous', 'transitions']);
  if (req.schema !== INTENT_DECISIONS_REQUEST) fail('request.schema', `expected ${INTENT_DECISIONS_REQUEST}`);
  if (own(req, 'transitions') && !own(req, 'previous')) fail('request.transitions', 'previous source required');
  const current = compileVersion(req.current, 'request.current');
  const now = rows(current), previous = own(req, 'previous') ? compileVersion(req.previous, 'request.previous') : null;
  const comparison = previous ? transitionsOf(req.transitions, rows(previous), now) : { status: 'not-supplied', changes: [] };
  if (previous) comparison.diagnostics = previous.source.documentId === current.source.documentId
    && previous.source.revisionId === current.source.revisionId
    && (previous.source.sha256 !== current.source.sha256
      || previous.source.sourceClosureSha256 !== current.source.sourceClosureSha256)
      ? ['source-revision-reused'] : [];
  const result = { schema: INTENT_DECISIONS_RESULT, outcome: 'completed', requestSha256: sha256Hex(encoded),
    current: { source: current.source, evidenceRecordSha256: current.report.recordSha256,
      decisions: now, judgments: current.report.judgments, externalChecks: current.report.externalChecks,
      coverage: current.report.coverage },
    requirements: requirementContract(req.requirementContract, now),
    comparison: previous ? { ...comparison, previousSource: previous.source,
      previousEvidenceRecordSha256: previous.report.recordSha256 } : comparison,
    trust: { decisions: 'external-record-not-authenticated', requirements: 'external-contract-metadata-only',
      judgments: 'not-evaluated' } };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > INTENT_DECISIONS_LIMITS.outputBytes) {
    return { schema: INTENT_DECISIONS_RESULT, outcome: 'incomplete', requestSha256: sha256Hex(encoded),
      diagnostics: [{ code: 'output-limit', message: 'complete result exceeds byte limit' }] };
  }
  return result;
}
