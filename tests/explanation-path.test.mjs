import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { prepareOutputExplanation, joinOutputExplanation } from '../tools/explanation.mjs';
import { emitCompletedScanSnapshot } from '../tools/interaction-runtime-snapshot.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const native = process.env.GF_EXPLANATION_NATIVE ?? path.join(root, 'target/release/examples/scan_tape.exe');
const source = fs.readFileSync(new URL('./fixtures/explanation-short-circuit.ghost.md', import.meta.url), 'utf8');
const artifact = compileSourceSync(source, { filename: 'explanation-short-circuit.ghost.md',
  interactionSourceIdentity: { documentId: 'source.ref-05-023', revisionId: 'revision.ref-05-023.1' } });
const runId = 'run.ref-05-023';
const frames = [{ scanId: 0, logicalTimeMs: 100, inputs: [] }, { scanId: 1, logicalTimeMs: 200, inputs: [] }];

async function wasmRun(artifact, scans, capture = true) {
  const runtime = await FramedGhostFlowRuntime.instantiate(fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm')));
  try {
    runtime.load(artifact.bytes);
    if (capture) runtime.enableInstructionWitnesses();
    for (const output of artifact.manifest.outputs) runtime.addCapability('actuator', output.name, output.type === 'Bool' ? 'bool' : 'number');
    runtime.activate();
    const rows = [];
    for (const frame of scans) {
      try { rows.push({ accepted: true, outcome: runtime.scan(frame) }); }
      catch (error) { rows.push({ accepted: false, outcome: runtime.outcome, error: error.message }); }
    }
    return rows;
  } finally { runtime.dispose(); }
}

function proofFor(artifact, result, outputId = 'output.pump') {
  return prepareOutputExplanation({ compilation: artifact, runId }).emit({ runId, result, outputId });
}

function nativeRun(artifact, tape, capture = true, expectedError) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-explanation-'));
  try {
    const modulePath = path.join(directory, 'module.gfb'), tapePath = path.join(directory, 'tape.tsv');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(tapePath, tape);
    const result = spawnSync(native, [modulePath, tapePath, ...(capture && !process.env.GF_EXPLANATION_BASELINE ? ['--instruction-witnesses'] : [])], { encoding: 'utf8' });
    if (expectedError) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expectedError);
      assert.equal(result.stdout, '');
      return [];
    }
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().split(/\r?\n/).map(row => JSON.parse(row));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('REF-05-023 actual native false-left AND skips the faulting right and publishes completed instruction witnesses', () => {
  const rows = nativeRun(artifact, '0\t100\n1\t200\n');
  assert.equal(rows[0].accepted, true);
  assert.equal(rows[0].outcome.trace.requested.pump, false);
  assert.deepEqual(rows[0].outcome.trace.faults, []);
  assert.ok(rows[0].outcome.trace.instructionWitnesses?.length);
  assert.equal(rows[1].accepted, false);
  assert.match(rows[1].error, /division by zero/);
});

test('REF-05-023 native/WASM requested OFF explanation keeps the false left support and the skipped faulting right unevaluated', async () => {
  const nativeRows = nativeRun(artifact, '0\t100\n1\t200\n');
  const wasmRows = await wasmRun(artifact, frames);
  assert.deepEqual(wasmRows, nativeRows);
  const nativeProof = proofFor(artifact, nativeRows[0]), wasmProof = proofFor(artifact, wasmRows[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(wasmProof)), nativeProof);
  assert.equal(nativeProof.status, 'ready');
  assert.equal(nativeProof.value, false);
  const output = artifact.explanationArtifact.strategies[0].outputs[0];
  const and = output.occurrences.find(item => item.id === output.rootOccurrenceId);
  const left = nativeProof.evaluations.find(item => item.occurrenceId === and.children[0]);
  const right = nativeProof.evaluations.find(item => item.occurrenceId === and.children[1]);
  assert.deepEqual([left.evaluated, left.value, left.supportsResult], [true, false, true]);
  assert.deepEqual([right.evaluated, right.status, right.supportsResult], [false, 'unavailable', false]);
  assert.equal(Object.hasOwn(right, 'value'), false);
  assert.deepEqual(nativeProof.edges.filter(edge => edge.parentOccurrenceId === and.id).map(edge => edge.supportsResult), [true, false]);
  assert.ok(artifact.explanationArtifact.nodes.every(node => node.sources.length));
  assert.ok(artifact.explanationArtifact.nodes.some(node => node.sources.some(source => source.intentProvenance.length)));
  assert.doesNotMatch(JSON.stringify(nativeProof), /__gf_|widget|coordinates/);
  assert.throws(() => proofFor(artifact, nativeRows[1]), /accepted completed scan/);
  assert.deepEqual(nativeRows[1].outcome, nativeRows[0].outcome, 'failed scan retains only its prior outcome');
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build/issue283-explanation-evidence.json'), JSON.stringify({
    issue: 283, caseId: 'REF-05-023', sourceSha256: artifact.sourceDocument.sha256,
    bytecodeSha256: artifact.manifest.bytecodeSha256, developerEvidence: true,
    descriptor: artifact.explanationArtifact, nativeRows, wasmRows, nativeProof, wasmProof,
  }, null, 2) + '\n');
});

function compileControl(body) {
  const link = '// ghostflow:link id=GF-INT-REF-05-023 relation=implements\n';
  return compileSourceSync('# Boolean proof regressions\n\n<!-- ghostflow:anchor id=GF-INT-REF-05-023 kind=intent status=confirmed origin=user -->\nProof paths.\n\n```ghost\ncontrol Proof {\n'
    + body.split('\n').map(line => link + line).join('\n') + '\n}\n```\n', {
    filename: 'proof.ghost.md', interactionSourceIdentity: { documentId: 'source.proof', revisionId: 'revision.proof.1' },
  });
}

test('Boolean ON/OFF AND/OR/NOT, nested branches, shared DAG per parent/output, and actual zero retain native/WASM parity', async () => {
  const compiled = compileControl(`state yes: Bool = true;
state no: Bool = false;
state zero: Number = 0.0;
output pump: Bool;
output on: Bool;
output off: Bool;
output inverted: Bool;
output number: Bool;
output nested: Bool;
output shared: Bool;
pump <- yes && no;
on <- yes || no;
off <- no || no;
inverted <- !no;
number <- zero == 0.0;
nested <- no || (no || yes);
shared <- (yes && no) || yes;`);
  const nativeRows = nativeRun(compiled, '0\t100\n');
  assert.deepEqual(await wasmRun(compiled, frames.slice(0, 1)), nativeRows);
  const pump = proofFor(compiled, nativeRows[0]);
  const on = proofFor(compiled, nativeRows[0], 'output.on');
  const yes = compiled.explanationArtifact.nodes.find(node => node.label === 'yes');
  const no = compiled.explanationArtifact.nodes.find(node => node.label === 'no');
  assert.deepEqual(pump.evaluations.filter(item => item.nodeId === yes.id).map(item => [item.evaluated, item.value, item.supportsResult]), [[true, true, false]]);
  assert.deepEqual(on.evaluations.filter(item => item.nodeId === yes.id).map(item => [item.evaluated, item.value, item.supportsResult]), [[true, true, true]]);
  assert.deepEqual(on.evaluations.filter(item => item.nodeId === no.id).map(item => [item.evaluated, item.supportsResult]), [[false, false]]);
  assert.equal(compiled.explanationArtifact.nodes.filter(node => node.id === no.id).length, 1);
  const off = proofFor(compiled, nativeRows[0], 'output.off');
  assert.ok(off.evaluations.every(item => item.evaluated && item.supportsResult));
  const inverted = proofFor(compiled, nativeRows[0], 'output.inverted');
  assert.ok(inverted.evaluations.every(item => item.evaluated && item.supportsResult));
  assert.equal(inverted.value, true);
  const numeric = proofFor(compiled, nativeRows[0], 'output.number');
  assert.ok(numeric.evaluations.some(item => item.value === 0 && item.evaluated && item.supportsResult));
  assert.equal(proofFor(compiled, nativeRows[0], 'output.nested').value, true);
  const shared = proofFor(compiled, nativeRows[0], 'output.shared');
  assert.deepEqual(shared.evaluations.filter(item => item.nodeId === yes.id).map(item => [item.evaluated, item.supportsResult]), [[true, false], [true, true]]);
  assert.ok(shared.edges.some(edge => edge.childNodeId === yes.id && !edge.supportsResult));
  assert.ok(shared.edges.some(edge => edge.childNodeId === yes.id && edge.supportsResult));
});

test('OR skips faulting right, then executed right faults; false/true runtime semantics are unchanged without observation', async () => {
  const compiled = compileControl(`state gate: Bool = true;
state divisor: Number = 0.0;
gate' = false;
output pump: Bool;
pump <- gate || (1.0 / divisor > 0.0);`);
  const captured = nativeRun(compiled, '0\t100\n1\t200\n');
  assert.deepEqual(await wasmRun(compiled, frames), captured);
  const uncaptured = nativeRun(compiled, '0\t100\n1\t200\n', false);
  const stripped = structuredClone(captured);
  for (const row of stripped) delete row.outcome?.trace.instructionWitnesses;
  assert.deepEqual(stripped, uncaptured);
  const proof = proofFor(compiled, captured[0]);
  assert.equal(proof.value, true);
  assert.ok(proof.evaluations.some(item => !item.evaluated && !Object.hasOwn(item, 'value')));
  assert.equal(captured[1].accepted, false);
  assert.equal(proofFor(compiled, uncaptured[0]).reason, 'instruction-witnesses-disabled');
});

test('artifact identity, mapping boundaries, witness bounds, accepted scan and run joins reject stale or forged evidence', () => {
  const rows = nativeRun(artifact, '0\t100\n');
  const proof = proofFor(artifact, rows[0]);
  const producer = prepareOutputExplanation({ compilation: artifact, runId });
  const snapshot = emitCompletedScanSnapshot({ compilation: artifact, runId,
    completion: proof.completion, trace: rows[0].outcome.trace });
  const join = candidate => joinOutputExplanation(artifact.interactionSchema, candidate, snapshot, producer.expected, producer.descriptor, rows[0]);
  assert.equal(join(proof).status, 'ready');
  assert.equal(join({ ...proof, runId: 'run.old' }).status, 'stale');
  assert.equal(join({ ...proof, completion: { ...proof.completion, scanId: 1 } }).status, 'stale');
  assert.throws(() => join({ ...proof, artifactSha256: '0'.repeat(64) }), /artifact identity/);
  for (const mutate of [
    p => { p.value = true; },
    p => { p.evaluations = []; p.edges = []; },
    p => { for (const item of p.evaluations) { item.evaluated = true; item.supportsResult = true; } },
    p => { for (const edge of p.edges) edge.supportsResult = true; },
    p => { p.evaluations.push(...Array(8193).fill(p.evaluations[0])); },
  ]) {
    const forged = structuredClone(proof); mutate(forged);
    assert.throws(() => join(forged), /proof payload/);
  }
  assert.throws(() => producer.emit({ runId: 'run.old', result: rows[0], outputId: 'output.pump' }), /epoch mismatch/);
  for (const mutate of [
    a => { a.bytes[0] ^= 1; },
    a => { a.sourceDocument.text += '\n'; },
    a => { a.explanationArtifact.strategies[0].outputs[0].occurrences[0].exits[0].pc += 1; },
    a => { a.explanationArtifact.nodes[0].children.push(a.explanationArtifact.nodes[0].id); },
    a => { a.explanationArtifact.nodes.push(...Array(513).fill(a.explanationArtifact.nodes[0])); },
  ]) {
    const forged = structuredClone(artifact); mutate(forged);
    assert.throws(() => prepareOutputExplanation({ compilation: forged, runId }), /mapping mismatch/);
  }
  for (const mutate of [
    r => { r.outcome.trace.tick += 1; },
    r => { r.outcome.trace.requested.pump = true; },
    r => { r.outcome.trace.instructionWitnesses[0].steps[0].end += 1; },
    r => { r.outcome.trace.instructionWitnesses[0].steps.push(...Array(8193).fill({})); },
  ]) {
    const forged = structuredClone(rows[0]); mutate(forged);
    assert.throws(() => proofFor(artifact, forged), /mismatch|bounds/);
  }
  assert.equal(JSON.stringify(proofFor(artifact, rows[0])), JSON.stringify(proof), 'read-only repeated observations');
});

test('bounded descriptors explicitly report unsupported kinds and runtime rejects oversize capture before executing', async () => {
  const compiled = compileControl(`input request: Bool;
output pump: Bool;
pump <- request |> recover(false);`);
  assert.ok(compiled.explanationArtifact.strategies[0].outputs[0].unsupportedKind);
  const large = compileControl('state zero: Number = 0.0;\n' + Array.from({ length: 64 }, (_, i) =>
    `output out${i}: Bool;\nout${i} <- (zero + ${Array(20).fill(`${i}.0`).join(' + ')}) == ${i * 20}.0;`).join('\n'));
  const runtime = await FramedGhostFlowRuntime.instantiate(fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm')));
  nativeRun(large, '0\t100\n', true, /budget exceeded/);
  try {
    runtime.load(large.bytes);
    assert.throws(() => runtime.enableInstructionWitnesses(), /budget exceeded/);
    for (const output of large.manifest.outputs) runtime.addCapability('actuator', output.name, 'bool');
    runtime.activate();
    assert.deepEqual(Object.values(runtime.scan(frames[0]).trace.requested), Array(64).fill(true));
    assert.equal(Object.hasOwn(runtime.outcome.trace, 'instructionWitnesses'), false);
    assert.throws(() => runtime.enableInstructionWitnesses(), /new configuring run/);
  } finally { runtime.dispose(); }
  assert.ok(large.explanationArtifact.nodes.length <= 512);
  assert.ok(large.explanationArtifact.strategies[0].outputs.some(output => output.unsupportedKind === 'resource-bounds'));
  assert.throws(() => compileControl('state no: Bool = false;\noutput pump: Bool;\npump <- ' + '!'.repeat(64) + 'no;'), /nesting exceeds 64/);
});
