import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '@toon-format/toon';
import { compileSource, restoreArtifactSourceMap, writeArtifact,
  intentInterpretationDigest, intentConditionDigest, INTENT_EVIDENCE_LIMITS } from '../tools/toolchain.mjs';
import * as browser from '../tools/browser-toolchain.mjs';
import { buildPortablePackage, PortablePackageError } from '../tools/portable-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ghostc = path.join(root, 'tools/ghostc.mjs');
const filename = 'intent-evidence.ghost.md';
const source = `<!-- ghostflow:anchor id=REQ kind=intent status=confirmed origin=user -->
> A request may turn on the pump.

<!-- ghostflow:anchor id=POLICY kind=premise status=confirmed origin=engineer -->
> The interlock is supplied by the installation.

<!-- ghostflow:anchor id=GUESS kind=assumption status=unconfirmed origin=ai -->
> The candidate may follow the request.

<!-- ghostflow:anchor id=OPEN kind=intent status=unconfirmed origin=user -->
> The spare output behavior remains undecided.

\`\`\`ghost
control IntentEvidence {
  // ghostflow:link id=POLICY relation=constrains
  input request: Bool;
  // ghostflow:link id=REQ relation=implements
  output pump: Bool;
  // ghostflow:link id=GUESS relation=assumes
  output candidate: Bool;
  // ghostflow:link id=OPEN relation=implements
  output spare: Bool;
  // ghostflow:link id=REQ relation=implements
  pump <- request |> recover(false);
  // ghostflow:link id=GUESS relation=assumes
  candidate <- request |> recover(false);
  // ghostflow:link id=OPEN relation=implements
  spare <- request |> recover(false);
}
\`\`\`
`;
const at = '2026-10-19T00:00:00.000Z';
const clone = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');

async function fixture() {
  const base = await compileSource(source, { filename });
  const node = anchorId => base.traceMetadata.intentLinks.find(link => link.anchorId === anchorId).nodeId;
  const interpretation = (id, anchorId) => ({
    id, revision: 'r1', original: { id: `ORIG-${id}`, revision: 'r1', reference: `record:${id}` },
    text: `Interpretation ${id}`, anchorIds: [anchorId], decision: null,
  });
  const confirmed = interpretation('I-REQ', 'REQ');
  const policy = interpretation('I-POLICY', 'POLICY');
  const assumption = interpretation('I-GUESS', 'GUESS');
  const undecided = interpretation('I-OPEN', 'OPEN');
  const condition = (id, owner, statement, nodeIds) => ({
    id, revision: 'r1', interpretation: { id: owner.id, revision: owner.revision },
    statement, scope: `scope:${id}`, nodeIds,
  });
  const conditions = [
    condition('C-PUMP', confirmed, 'Pump follows a valid request.', [node('REQ')]),
    condition('C-OTHER', confirmed, 'A second behavior is not confirmed.', []),
    condition('C-INTERLOCK', policy, 'Use the declared interlock.', [node('POLICY')]),
  ];
  const ref = item => ({ id: item.id, revision: item.revision, sha256: intentConditionDigest(item) });
  confirmed.decision = { kind: 'confirmed', actor: 'operator', authorityRef: 'authority:operator', recordRef: 'decision:1',
    at, interpretationSha256: intentInterpretationDigest(confirmed), conditions: [ref(conditions[0])] };
  policy.decision = { kind: 'policy-derived', actor: 'engineer', authorityRef: 'authority:engineer', recordRef: 'decision:2',
    at, interpretationSha256: intentInterpretationDigest(policy), conditions: [ref(conditions[2])],
    policy: { id: 'P1', revision: 'r1', reference: 'policy:P1' }, applicationRef: 'installation:1', validity: 'unknown' };
  assumption.decision = { kind: 'assumption', actor: 'model', reason: 'candidate proposal' };
  undecided.decision = { kind: 'undecided', question: 'What should spare do?', owner: null };
  const evidence = { format: 'GhostFlow/intent-evidence-v1', sourceDocumentSha256: base.sourceDocument.sha256,
    interpretations: [confirmed, policy, assumption, undecided], conditions, checks: [] };
  const staticCheck = { id: 'K-STATIC', judgment: 'code-compliance', conditions: [ref(conditions[0])],
    result: 'satisfied', producer: 'external-checker', evidenceRef: 'report:static', scope: 'one scenario', at,
    context: { sourceDocumentSha256: evidence.sourceDocumentSha256, bytecodeSha256: sha(base.bytes), method: 'static', setupRef: 'setup:1' } };
  return { base, evidence, conditions, ref, staticCheck };
}

function expectEvidenceError(error) {
  assert.equal(error.diagnosticEnvelope?.diagnostics?.[0]?.code, 'GF_INTENT_EVIDENCE');
  return true;
}

test('four decisions keep partial confirmation, missing checks and external claims distinct', async () => {
  const { evidence, staticCheck } = await fixture();
  evidence.checks.push(staticCheck);
  const compiled = await compileSource(source, { filename, intentEvidence: evidence });
  const report = compiled.intentEvidence;
  assert.deepEqual(report.decisions.map(item => item.kind), ['confirmed', 'policy-derived', 'assumption', 'undecided']);
  assert.deepEqual(report.decisions.map(item => item.authority), Array(4).fill('not-authenticated'));
  assert.equal(report.conditions.find(item => item.id === 'C-PUMP').confirmation, 'recorded');
  assert.equal(report.conditions.find(item => item.id === 'C-OTHER').confirmation, 'outside-confirmed-scope');
  assert.equal(report.conditions.find(item => item.id === 'C-INTERLOCK').confirmation, 'policy-not-current');
  assert.deepEqual(report.externalChecks, [{ id: 'K-STATIC', judgment: 'code-compliance', reportedResult: 'satisfied', trust: 'external-report' }]);
  assert.deepEqual(report.judgments, { intentFit: 'not-evaluated', requirementsConsistency: 'not-evaluated',
    codeCompliance: 'not-evaluated', deviceCompliance: 'not-evaluated' });
  assert.deepEqual(report.coverage.unlinkedConditionIds, ['C-OTHER']);
  assert.match(report.recordSha256, /^[a-f0-9]{64}$/);
  evidence.checks[0].result = 'violated';
  assert.equal(report.record.checks[0].result, 'satisfied');
});

test('source, interpretation and condition revisions are bound even when bytecode is identical', async () => {
  const { base, evidence, staticCheck } = await fixture();
  evidence.checks.push(staticCheck);
  const proseEdit = source.replace('A request may turn on the pump.', 'A request can turn on the pump.');
  const edited = await compileSource(proseEdit, { filename });
  assert.deepEqual(edited.bytes, base.bytes);
  await assert.rejects(() => compileSource(proseEdit, { filename, intentEvidence: evidence }), expectEvidenceError);
  const staleInterpretation = clone(evidence);
  staleInterpretation.interpretations[0].text = 'A revised interpretation';
  await assert.rejects(() => compileSource(source, { filename, intentEvidence: staleInterpretation }), expectEvidenceError);
  const staleCondition = clone(evidence);
  staleCondition.conditions[0].statement = 'A revised condition';
  await assert.rejects(() => compileSource(source, { filename, intentEvidence: staleCondition }), expectEvidenceError);
});

test('references and node links reject duplicates, unknown nodes and foreign anchors', async () => {
  const { evidence } = await fixture();
  const mutations = [
    item => item.interpretations.push(clone(item.interpretations[0])),
    item => item.interpretations[0].anchorIds.push('MISSING'),
    item => item.conditions[0].nodeIds.push('not-a-node'),
    item => item.conditions[0].nodeIds.push(999999),
    item => item.conditions[0].nodeIds = [...item.conditions[2].nodeIds],
    item => item.interpretations[0].decision.conditions.push(clone(item.interpretations[0].decision.conditions[0])),
    item => item.conditions[0].interpretation.id = 'NO-SUCH-INTERPRETATION',
  ];
  for (const mutate of mutations) {
    const candidate = clone(evidence);
    mutate(candidate);
    await assert.rejects(() => compileSource(source, { filename, intentEvidence: candidate }), expectEvidenceError);
  }
});

test('physical context is shape-checked and cannot turn an external report into physical proof', async () => {
  const { evidence, staticCheck } = await fixture();
  const physical = clone(staticCheck);
  physical.id = 'K-DEVICE'; physical.judgment = 'device-compliance'; physical.context.method = 'physical';
  physical.context.run = { id: 'RUN1', scanId: 1, logicalTimeMs: 100 };
  physical.context.device = { id: 'device1', installationRef: 'install:1', commandRef: 'command:1',
    observationRef: 'observation:1', clockRef: 'clock:1', stage: 'safe', quality: 'unknown' };
  evidence.checks.push(physical);
  const report = (await compileSource(source, { filename, intentEvidence: evidence })).intentEvidence;
  assert.equal(report.externalChecks[0].reportedResult, 'satisfied');
  assert.equal(report.judgments.deviceCompliance, 'not-evaluated');
  for (const mutate of [
    item => { delete item.context.device.clockRef; },
    item => { item.context.method = 'scenario'; },
    item => { item.context.run.scanId = -1; },
    item => { item.context.device.stage = 'physically-proven'; },
  ]) {
    const candidate = clone(evidence);
    mutate(candidate.checks[0]);
    await assert.rejects(() => compileSource(source, { filename, intentEvidence: candidate }), expectEvidenceError);
  }
});

test('bounded records and Node/browser results agree without a global Buffer', async () => {
  const { evidence } = await fixture();
  assert.deepEqual(browser.INTENT_EVIDENCE_LIMITS, INTENT_EVIDENCE_LIMITS);
  const node = await compileSource(source, { filename, intentEvidence: evidence });
  const previous = globalThis.Buffer;
  let web;
  try {
    globalThis.Buffer = undefined;
    web = await browser.compileSource(source, { filename, intentEvidence: evidence });
  } finally { globalThis.Buffer = previous; }
  assert.deepEqual(web.intentEvidence, node.intentEvidence);
  assert.deepEqual(web.bytes, new Uint8Array(node.bytes));
  for (const candidate of [
    { ...evidence, interpretations: Array(INTENT_EVIDENCE_LIMITS.records + 1).fill(evidence.interpretations[0]) },
    { ...evidence, conditions: [{ ...evidence.conditions[0], statement: 'x'.repeat(INTENT_EVIDENCE_LIMITS.text + 1) }] },
    { ...evidence, padding: 'x'.repeat(INTENT_EVIDENCE_LIMITS.bytes) },
  ]) await assert.rejects(() => compileSource(source, { filename, intentEvidence: candidate }), expectEvidenceError);
});

test('artifact map persists the detached record and rejects tampering', async t => {
  const { evidence, staticCheck } = await fixture();
  evidence.checks.push(staticCheck);
  const compiled = await compileSource(source, { filename, intentEvidence: evidence });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-intent-map-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'control.gfb');
  writeArtifact(compiled, output);
  const map = JSON.parse(fs.readFileSync(`${output}.map.json`, 'utf8'));
  assert.deepEqual(map.intentEvidence, compiled.intentEvidence.record);
  assert.deepEqual(restoreArtifactSourceMap(map, compiled.bytes, { manifest: compiled.manifest }).intentEvidence, compiled.intentEvidence);
  const expected = { manifest: compiled.manifest, expectedIntentEvidenceSha256: compiled.intentEvidence.recordSha256 };
  assert.deepEqual(restoreArtifactSourceMap(map, compiled.bytes, expected).intentEvidence, compiled.intentEvidence);
  const missing = clone(map);
  delete missing.intentEvidence;
  assert.throws(() => restoreArtifactSourceMap(missing, compiled.bytes, expected), /missing or different/);
  assert.equal(restoreArtifactSourceMap(missing, compiled.bytes, { manifest: compiled.manifest }).intentEvidence, undefined);
  const replacedReport = clone(map);
  replacedReport.intentEvidence.checks[0].result = 'violated';
  assert.throws(() => restoreArtifactSourceMap(replacedReport, compiled.bytes, expected), /missing or different/);
  assert.equal(restoreArtifactSourceMap(replacedReport, compiled.bytes, { manifest: compiled.manifest }).intentEvidence.externalChecks[0].reportedResult, 'violated',
    'an unpinned external report is recorded, not authenticated');
  compiled.intentEvidence.record.checks[0].result = 'violated';
  assert.throws(() => writeArtifact(compiled, output), /missing or different/);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${output}.map.json`, 'utf8')), map, 'rejected mutation preserves saved artifact');
  for (const mutate of [
    item => { item.intentEvidence.sourceDocumentSha256 = '0'.repeat(64); },
    item => { item.intentEvidence.interpretations[0].text = 'tampered'; },
    item => { item.intentEvidence.conditions[0].statement = 'tampered'; },
    item => { item.intentEvidence.checks[0].context.bytecodeSha256 = '0'.repeat(64); },
  ]) {
    const candidate = clone(map);
    mutate(candidate);
    assert.throws(() => restoreArtifactSourceMap(candidate, compiled.bytes, { manifest: compiled.manifest }));
  }
});

test('portable package builder explicitly rejects evidence it cannot carry', async () => {
  const { evidence } = await fixture();
  const compiled = await compileSource(source, { filename, intentEvidence: evidence });
  await assert.rejects(() => buildPortablePackage(compiled, {}), error => {
    assert.ok(error instanceof PortablePackageError);
    assert.equal(error.code, 'unsupported-intent-evidence');
    return true;
  });
});

function cli(args) {
  const result = spawnSync(process.execPath, [ghostc, ...args], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.stderr, '');
  return result;
}

test('structured CLI check and compile expose matching JSON/TOON reports and preserve artifacts on bad files', async t => {
  const { evidence } = await fixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-intent-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'control.ghost.md');
  const evidencePath = path.join(directory, 'intent.json');
  const requestPath = path.join(directory, 'request.toon');
  const artifactPath = path.join(directory, 'control.gfb');
  fs.writeFileSync(sourcePath, source);
  fs.writeFileSync(evidencePath, JSON.stringify(evidence));
  const request = operation => ({ format: 'GhostFlow/cli-request-v1', operation,
    source: { path: sourcePath, documentId: 'doc1', revisionId: 'r1' }, intentEvidencePath: evidencePath,
    ...(operation === 'compile' ? { artifactPath } : {}) });
  for (const operation of ['check', 'compile']) {
    fs.writeFileSync(requestPath, encode(request(operation)));
    const json = cli(['--request', requestPath, '--format', 'json']);
    const toon = cli(['--request', requestPath]);
    assert.equal(json.status, 0, json.stdout);
    assert.equal(toon.status, 0, toon.stdout);
    assert.deepEqual(JSON.parse(json.stdout), decode(toon.stdout, { strict: true }));
    assert.equal(JSON.parse(json.stdout).intentEvidence.record.sourceDocumentSha256, evidence.sourceDocumentSha256);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(`${artifactPath}.map.json`, 'utf8')).intentEvidence, evidence);
  const previous = [artifactPath, `${artifactPath}.manifest.json`, `${artifactPath}.map.json`].map(file => fs.readFileSync(file));
  const rejected = [
    () => fs.unlinkSync(evidencePath),
    () => fs.writeFileSync(evidencePath, '{broken'),
    () => fs.writeFileSync(evidencePath, JSON.stringify({ ...evidence, sourceDocumentSha256: '0'.repeat(64) })),
    () => fs.writeFileSync(evidencePath, 'x'.repeat(INTENT_EVIDENCE_LIMITS.bytes + 1)),
  ];
  for (const mutate of rejected) {
    fs.writeFileSync(evidencePath, JSON.stringify(evidence));
    mutate();
    fs.writeFileSync(requestPath, encode(request('compile')));
    const failure = cli(['--request', requestPath, '--format', 'json']);
    assert.equal(failure.status, 1, failure.stdout);
    const decoded = JSON.parse(failure.stdout);
    assert.equal(decoded.ok, false);
    assert.equal(decoded.diagnostics[0]?.code ?? decoded.error?.code, 'GF_INTENT_EVIDENCE');
    for (const [index, file] of [artifactPath, `${artifactPath}.manifest.json`, `${artifactPath}.map.json`].entries()) {
      assert.deepEqual(fs.readFileSync(file), previous[index]);
    }
  }
});
