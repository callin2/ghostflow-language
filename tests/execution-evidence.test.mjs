import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { decode, encode } from '@toon-format/toon';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { explainExecution, EXECUTION_EVIDENCE_REQUEST } from '../tools/execution-evidence.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { intentConditionDigest, intentInterpretationDigest } from '../tools/intent-evidence.mjs';

const sourceText = fs.readFileSync(new URL('./fixtures/explanation-short-circuit.ghost.md', import.meta.url), 'utf8');
const source = { text: sourceText, filename: 'explanation-short-circuit.ghost.md', documentId: 'source.why', revisionId: 'revision.why.1' };
const clone = value => structuredClone(value);
let wasmResult;
async function base() {
  const compilation = compileSourceSync(sourceText, { filename: source.filename,
    interactionSourceIdentity: { documentId: source.documentId, revisionId: source.revisionId } });
  if (!wasmResult) {
    const runtime = await FramedGhostFlowRuntime.instantiate(fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url)));
    try {
      runtime.load(compilation.bytes); runtime.enableInstructionWitnesses();
      runtime.addCapability('actuator', 'pump', 'bool'); runtime.activate();
      wasmResult = { accepted: true, outcome: runtime.scan({ scanId: 0, logicalTimeMs: 100, inputs: [] }) };
    } finally { runtime.dispose(); }
  }
  return { schema: EXECUTION_EVIDENCE_REQUEST, source: clone(source), runId: 'run.why.1',
    outputId: 'output.pump', result: clone(wasmResult) };
}
function attachDevice(r) {
  r.expectedDevice = { deviceId: 'fictional-device', bootId: 'boot-1', installationRef: 'installation:1', clockRef: 'clock:1', requestId: 'request:1' };
  const initial = explainExecution(r);
  const id = { sourceDocumentId: r.source.documentId, sourceRevisionId: r.source.revisionId,
    sourceSha256: initial.source.sha256, bytecodeSha256: initial.module.bytecodeSha256,
    runId: r.runId, scanId: initial.completion.scanId, logicalTimeMs: initial.completion.logicalTimeMs,
    outputId: r.outputId, ...r.expectedDevice };
  const at = '2000-01-01T00:00:00.000Z';
  r.deviceEvidence = { identity: id, records: [
    { kind: 'driver-request', id: 'request:1', requestId: 'request:1', stage: 'safe', value: false, at, ref: 'fixture://request' },
    { kind: 'ack', id: 'ack:1', requestId: 'request:1', outcome: 'accepted', at, ref: 'fixture://ack' },
    { kind: 'register-readback', id: 'read:1', requestId: 'request:1', quality: 'ok', value: false, at, ref: 'fixture://read' },
    { kind: 'physical-feedback', id: 'physical:1', requestId: 'request:1', quality: 'unknown', at, ref: 'fixture://physical' },
  ] };
}

test('real WASM completed scan preserves skipped branch and requested/safe stages', async () => {
  const r = await base(), explanation = explainExecution(r);
  assert.equal(explanation.requested.value, false);
  assert.equal(explanation.safe.value, false);
  assert.equal(explanation.requested.proof.status, 'ready');
  assert.ok(explanation.requested.proof.evaluations.some(e => !e.evaluated && e.reason === 'not-evaluated'));
  assert.equal(explanation.device.status, 'not-supplied');
  assert.equal(explanation.trust.deviceEvidence, 'external-report-not-authenticated');
  assert.deepEqual(explainExecution(r), explanation);
  assert.ok(Object.isFrozen(explanation.requested.descriptor.nodes[0]));
  assert.deepEqual(explainExecution(r).requested.proof, explanation.requested.proof);
  const noWitness = clone(r); delete noWitness.result.outcome.trace.instructionWitnesses;
  const unavailable = explainExecution(noWitness);
  assert.equal(unavailable.requested.proof.status, 'unavailable');
  assert.equal(unavailable.requested.proof.reason, 'instruction-witnesses-disabled');
});

test('validated authored conditions retain original interpretation and partial confirmation', async () => {
  const r = await base();
  const compiled = compileSourceSync(sourceText, { filename: source.filename,
    interactionSourceIdentity: { documentId: source.documentId, revisionId: source.revisionId } });
  const link = compiled.traceMetadata.intentLinks.find(x => x.anchorId === 'GF-INT-REF-05-023');
  const interpretation = { id: 'I-1', revision: 'r1', original: { id: 'ORIG-1', revision: 'r1', reference: 'fixture://original' },
    text: 'Requested OFF on false gate', anchorIds: ['GF-INT-REF-05-023'], decision: null };
  const condition = { id: 'C-1', revision: 'r1', interpretation: { id: 'I-1', revision: 'r1' },
    statement: 'Gate false yields OFF', scope: 'this source', nodeIds: [link.nodeId] };
  const outside = { id: 'C-2', revision: 'r1', interpretation: { id: 'I-1', revision: 'r1' },
    statement: 'Separate unresolved behavior', scope: 'outside this scan', nodeIds: [] };
  interpretation.decision = { kind: 'confirmed', actor: 'operator', authorityRef: 'authority:fixture', recordRef: 'decision:fixture',
    at: '2000-01-01T00:00:00.000Z', interpretationSha256: intentInterpretationDigest(interpretation),
    conditions: [{ id: condition.id, revision: condition.revision, sha256: intentConditionDigest(condition) }] };
  r.intentEvidence = { format: 'GhostFlow/intent-evidence-v1', sourceDocumentSha256: compiled.sourceDocument.sha256,
    interpretations: [interpretation], conditions: [condition, outside], checks: [] };
  const out = explainExecution(r);
  assert.equal(out.authored.conditions[0].confirmation, 'recorded');
  assert.equal(out.authored.conditions[1].confirmation, 'outside-confirmed-scope');
  assert.equal(out.authored.conditions[1].relation, 'not-evaluated');
  assert.equal(out.authored.conditions[0].original.statement, condition.statement);
  assert.equal(out.authored.interpretations[0].original.reference, 'fixture://original');
  assert.ok(out.requested.descriptor.nodes.some(n => n.sources.some(s => s.sourceNode.line && s.intentProvenance.length)));
  assert.equal(out.authored.judgments.intentFit, 'not-evaluated');
  r.intentEvidence.conditions[0].statement = 'tampered';
  assert.throws(() => explainExecution(r), /digest mismatch|condition identity|intentEvidence/);
});

test('shared explanation node never attributes another output connection as support', async () => {
  const text = `# Two outputs\n\n<!-- ghostflow:anchor id=PUMP kind=intent status=unconfirmed origin=ai -->\nPump.\n\n<!-- ghostflow:anchor id=VALVE kind=intent status=unconfirmed origin=ai -->\nValve.\n\n\`\`\`ghost\ncontrol Two {\n// ghostflow:link id=PUMP relation=implements\nstate gate: Bool = false;\n// ghostflow:link id=PUMP relation=implements\noutput pump, valve: Bool;\n// ghostflow:link id=PUMP relation=implements\npump <- gate && true;\n// ghostflow:link id=VALVE relation=implements\nvalve <- gate && true;\n}\n\`\`\`\n`;
  const localSource = { text, filename: 'two.ghost.md', documentId: 'source.two', revisionId: 'revision.two.1' };
  const compiled = compileSourceSync(text, { filename: localSource.filename,
    interactionSourceIdentity: { documentId: localSource.documentId, revisionId: localSource.revisionId } });
  const runtime = await FramedGhostFlowRuntime.instantiate(fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url)));
  let result;
  try {
    runtime.load(compiled.bytes); runtime.enableInstructionWitnesses();
    for (const name of ['pump', 'valve']) runtime.addCapability('actuator', name, 'bool');
    runtime.activate(); result = { accepted: true, outcome: runtime.scan({ scanId: 0, logicalTimeMs: 100, inputs: [] }) };
  } finally { runtime.dispose(); }
  const interpretations = [], conditions = [];
  for (const name of ['PUMP', 'VALVE']) {
    const id = `I-${name}`, nodeId = compiled.traceMetadata.intentLinks.find(x => x.anchorId === name).nodeId;
    const i = { id, revision: 'r1', original: { id: `O-${name}`, revision: 'r1', reference: `fixture://${name}` },
      text: `${name} interpretation`, anchorIds: [name], decision: { kind: 'undecided', question: 'pending', owner: null } };
    interpretations.push(i);
    conditions.push({ id: `C-${name}`, revision: 'r1', interpretation: { id, revision: 'r1' },
      statement: `${name} condition`, scope: 'two-output source', nodeIds: [nodeId] });
  }
  const request = { schema: EXECUTION_EVIDENCE_REQUEST, source: localSource, runId: 'run.two', outputId: 'output.pump', result,
    intentEvidence: { format: 'GhostFlow/intent-evidence-v1', sourceDocumentSha256: compiled.sourceDocument.sha256,
      interpretations, conditions, checks: [] } };
  const out = explainExecution(request);
  assert.equal(out.authored.conditions.find(c => c.original.id === 'C-VALVE').relation, 'not-evaluated');
  assert.equal(out.authored.conditions.find(c => c.original.id === 'C-PUMP').relation, 'supports-requested-result');
});

test('unsupported requested expression remains unavailable while safe stays separate', async () => {
  const text = `# Unsupported proof\n\n<!-- ghostflow:anchor id=REQ kind=intent status=confirmed origin=user -->\nRequest level.\n\n\`\`\`ghost\ncontrol Unsupported {\n// ghostflow:link id=REQ relation=implements\nstate level_state: Number = 1.0;\n// ghostflow:link id=REQ relation=implements\noutput level: Number;\n// ghostflow:link id=REQ relation=implements\nlevel <- level_state;\n}\n\`\`\`\n`;
  const local = { text, filename: 'unsupported.ghost.md', documentId: 'source.unsupported', revisionId: 'revision.unsupported.1' };
  const compiled = compileSourceSync(text, { filename: local.filename,
    interactionSourceIdentity: { documentId: local.documentId, revisionId: local.revisionId } });
  const runtime = await FramedGhostFlowRuntime.instantiate(fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url)));
  let result;
  try {
    runtime.load(compiled.bytes); runtime.enableInstructionWitnesses();
    runtime.addCapability('actuator', 'level', 'number');
    runtime.activate(); result = { accepted: true, outcome: runtime.scan({ scanId: 0, logicalTimeMs: 100, inputs: [] }) };
  } finally { runtime.dispose(); }
  const out = explainExecution({ schema: EXECUTION_EVIDENCE_REQUEST, source: local, runId: 'run.unsupported',
    outputId: 'output.level', result });
  assert.equal(out.requested.proof.status, 'unavailable');
  assert.match(out.requested.proof.reason, /^unsupported-kind:/);
  assert.equal(out.safe.value, 1);
});

test('device stages remain external reports and missing/orphan/conflict diagnostics stay visible', async () => {
  const r = await base(); attachDevice(r);
  let out = explainExecution(r);
  assert.equal(out.device.status, 'linked-external-report');
  assert.equal(out.device.trust, 'not-authenticated');
  assert.equal(out.device.records[3].quality, 'unknown');
  assert.deepEqual(out.device.diagnostics, []);
  r.deviceEvidence.records.splice(1, 1);
  out = explainExecution(r);
  assert.ok(out.device.diagnostics.some(d => d.code === 'ack-missing'));
  r.deviceEvidence.records.push({ kind: 'ack', id: 'orphan', requestId: 'wrong', outcome: 'accepted', at: '2000-01-01T00:00:00.000Z', ref: 'fixture://orphan' });
  out = explainExecution(r);
  assert.equal(out.device.status, 'conflicted');
  assert.ok(out.device.diagnostics.some(d => d.code === 'orphan-record'));
  r.deviceEvidence.records.push(clone(r.deviceEvidence.records[0]));
  assert.ok(explainExecution(r).device.diagnostics.some(d => d.code === 'duplicate-record'));
  r.deviceEvidence.records.pop();
  r.deviceEvidence.records.push({ kind: 'ack', id: 'ack:2', requestId: 'request:1', outcome: 'rejected',
    at: '2000-01-01T00:00:00.000Z', ref: 'fixture://ack-2' });
  assert.ok(explainExecution(r).device.diagnostics.some(d => d.code === 'conflicting-stage'));
  r.deviceEvidence.records.pop();
  r.deviceEvidence.records[1].at = '1999-12-31T23:59:59.000Z';
  assert.ok(explainExecution(r).device.diagnostics.some(d => d.code === 'stage-before-request'));
});

test('source, scan and separate device identity mismatches cannot be joined', async () => {
  const r = await base(); attachDevice(r);
  for (const [field, wrong] of [['sourceDocumentId', 'source.other'], ['sourceRevisionId', 'revision.other'],
    ['deviceId', 'another'], ['bootId', 'boot-2'], ['installationRef', 'installation:other'],
    ['clockRef', 'clock:other'], ['requestId', 'request:other'], ['sourceSha256', '0'.repeat(64)],
    ['bytecodeSha256', '0'.repeat(64)], ['runId', 'run.other'], ['scanId', 2], ['logicalTimeMs', 200], ['outputId', 'output.other']]) {
    const bad = clone(r); bad.deviceEvidence.identity[field] = wrong;
    assert.equal(explainExecution(bad).device.status, 'unlinked', field);
  }
  const wrongSource = clone(r); wrongSource.source.text = wrongSource.source.text.replace('A skipped division must not', 'An unexecuted division must not');
  assert.equal(explainExecution(wrongSource).device.status, 'unlinked');
  const wrongScan = clone(r); wrongScan.result.outcome.trace.tick += 1;
  assert.throws(() => explainExecution(wrongScan), /mismatch/);
  const wrongSafe = clone(r); wrongSafe.result.outcome.trace.safe.pump = 0;
  assert.throws(() => explainExecution(wrongSafe), /safe output unavailable or wrong type/);
  const wrongRequested = clone(r); wrongRequested.deviceEvidence.records[0].value = true;
  assert.ok(explainExecution(wrongRequested).device.diagnostics.some(d => d.code === 'stage-value-mismatch'));
});

test('malformed and oversized records reject; JSON and TOON CLI agree', async () => {
  const r = await base(); attachDevice(r);
  const bad = clone(r); bad.deviceEvidence.records[1].outcome = 'magically-applied';
  assert.throws(() => explainExecution(bad), /invalid ACK/);
  const excess = clone(r); excess.deviceEvidence.records = Array(129).fill(r.deviceEvidence.records[0]);
  assert.throws(() => explainExecution(excess), /bounded array/);
  const sparse = clone(r); sparse.deviceEvidence.records = Array(2); sparse.deviceEvidence.records[0] = r.deviceEvidence.records[0];
  assert.throws(() => explainExecution(sparse), /sparse|array/);
  const huge = clone(r); huge.source.text = 'x'.repeat(524289);
  assert.throws(() => explainExecution(huge), /byte limit/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostwhy-'));
  try {
    const json = path.join(directory, 'request.json'), toon = path.join(directory, 'request.toon');
    fs.writeFileSync(json, JSON.stringify(r)); fs.writeFileSync(toon, encode(r));
    const cli = new URL('../tools/ghostwhy.mjs', import.meta.url).pathname;
    const run = (file, format) => spawnSync(process.execPath, [cli, '--request', file, '--format', format], { encoding: 'utf8' });
    const j = run(json, 'json'), t = run(toon, 'toon');
    assert.equal(j.status, 0, j.stdout + j.stderr); assert.equal(t.status, 0, t.stdout + t.stderr);
    assert.deepEqual(decode(t.stdout, { strict: true }), JSON.parse(j.stdout));
    fs.writeFileSync(json, 'x'.repeat(524289));
    const rejected = run(json, 'json');
    assert.equal(rejected.status, 1); assert.equal(JSON.parse(rejected.stdout).outcome, 'rejected');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
