import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { explainExecution, EXECUTION_EVIDENCE_REQUEST } from '../tools/execution-evidence.mjs';
import { jsonSha256, validateIntegration } from '../tools/integration-contract.mjs';

const source = {
  text: '# Output evidence\n\n<!-- ghostflow:anchor id=OUTPUTS kind=intent status=confirmed origin=user -->\n'
    + 'Request both outputs together; preserve application and feedback as separate observations.\n\n'
    + '```ghost\ncontrol Outputs {\n// ghostflow:link id=OUTPUTS relation=implements\n'
    + 'output pump, valve: Bool;\n// ghostflow:link id=OUTPUTS relation=implements\n'
    + 'pump <- true;\n// ghostflow:link id=OUTPUTS relation=implements\nvalve <- true;\n}\n```\n',
  filename: 'output-evidence.ghost.md', documentId: 'source.output-evidence', revisionId: 'revision.output-evidence.1',
};
const compilation = compileSourceSync(source.text, {
  filename: source.filename,
  interactionSourceIdentity: { documentId: source.documentId, revisionId: source.revisionId },
});
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));

async function completedRequest(output = 'pump') {
  const runtime = await FramedGhostFlowRuntime.instantiate(wasm);
  try {
    runtime.load(compilation.bytes);
    runtime.enableInstructionWitnesses();
    for (const name of ['pump', 'valve']) runtime.addCapability('actuator', name, 'bool');
    runtime.activate();
    const outcome = runtime.scan({ scanId: 0, logicalTimeMs: 100, inputs: [] });
    assert.deepEqual(outcome.trace.requested, { pump: true, valve: true });
    assert.deepEqual(outcome.trace.safe, { pump: true, valve: true });
    return { schema: EXECUTION_EVIDENCE_REQUEST, source, runId: 'run.output-evidence',
      outputId: `output.${output}`, result: { accepted: true, outcome } };
  } finally { runtime.dispose(); }
}

function attachReports(request, records) {
  request.expectedDevice = { deviceId: 'fixture-device', bootId: 'fixture-boot',
    installationRef: 'installation:r1', clockRef: 'clock:fixture', requestId: `request:${request.outputId}` };
  request.deviceEvidence = {
    identity: {
      sourceDocumentId: source.documentId, sourceRevisionId: source.revisionId,
      sourceSha256: compilation.sourceDocument.sha256, bytecodeSha256: compilation.manifest.bytecodeSha256,
      runId: request.runId, scanId: 0, logicalTimeMs: 100, outputId: request.outputId, ...request.expectedDevice,
    },
    records: records.map((record, index) => ({
      id: record.kind === 'driver-request' ? request.expectedDevice.requestId : `${request.outputId}:${index}`,
      requestId: request.expectedDevice.requestId, ref: `fixture://report/${request.outputId}/${index}`, ...record,
    })),
  };
  return request;
}
const at = ms => new Date(Date.UTC(2000, 0, 1) + ms).toISOString();

test('REF-05-025 completed ON intent without device evidence never invents application or confirmation', async () => {
  const explanation = explainExecution(await completedRequest());
  assert.equal(explanation.requested.value, true);
  assert.equal(explanation.safe.value, true);
  assert.equal(explanation.device.status, 'not-supplied');
  assert.deepEqual(explanation.device.records, []);
  assert.deepEqual(explanation.device.diagnostics.map(item => item.code), [
    'driver-request-missing', 'ack-missing', 'register-readback-missing', 'physical-feedback-missing',
  ]);
  assert.equal(explanation.trust.deviceEvidence, 'external-report-not-authenticated');
});

test('REF-00-002 acknowledged ON and register readback leave absent rotation feedback unknown', async () => {
  const request = attachReports(await completedRequest(), [
    { kind: 'driver-request', stage: 'safe', value: true, at: at(100) },
    { kind: 'ack', outcome: 'accepted', at: at(110) },
    { kind: 'register-readback', quality: 'ok', value: true, at: at(120) },
  ]);
  const explanation = explainExecution(request);
  assert.equal(explanation.requested.value, true);
  assert.equal(explanation.safe.value, true);
  assert.equal(explanation.device.status, 'linked-external-report');
  assert.deepEqual(explanation.device.records, request.deviceEvidence.records);
  assert.deepEqual(explanation.device.diagnostics, [{ code: 'physical-feedback-missing' }]);
  assert.equal(explanation.device.trust, 'not-authenticated');
});

test('REF-04-043 failed application and false feedback retain independent provenance and quality', async () => {
  const request = attachReports(await completedRequest('valve'), [
    { kind: 'driver-request', stage: 'safe', value: true, at: at(100) },
    { kind: 'ack', outcome: 'fault', at: at(110) },
    { kind: 'register-readback', quality: 'fault', at: at(120) },
    { kind: 'physical-feedback', quality: 'ok', value: false, at: at(130) },
  ]);
  const explanation = explainExecution(request);
  assert.equal(explanation.requested.value, true);
  assert.equal(explanation.safe.value, true);
  assert.deepEqual(explanation.device.records, request.deviceEvidence.records);
  assert.ok(explanation.device.diagnostics.some(item => item.code === 'reported-value-differs'));
  assert.equal(explanation.device.trust, 'not-authenticated');
  const wrongRun = structuredClone(request);
  wrongRun.deviceEvidence.identity.runId = 'run.previous';
  const stale = explainExecution(wrongRun);
  assert.equal(stale.device.status, 'unlinked');
  assert.ok(stale.device.diagnostics.some(item => item.code === 'runId-mismatch'));
  assert.deepEqual(stale.device.records, request.deviceEvidence.records);
});

test('REF-08-010 one logical output commit preserves distinct bus application and feedback times', async () => {
  const first = await completedRequest('pump');
  const second = { ...structuredClone(first), outputId: 'output.valve' };
  const reports = [first, second].map((request, index) => explainExecution(attachReports(request, [
    { kind: 'driver-request', stage: 'safe', value: true, at: at(100) },
    { kind: 'ack', outcome: 'accepted', at: at(110 + 20 * index) },
    { kind: 'physical-feedback', quality: 'ok', value: true, at: at(115 + 20 * index) },
  ])));
  assert.deepEqual(reports[0].completion, reports[1].completion);
  assert.deepEqual(reports.map(item => item.safe.value), [true, true]);
  assert.deepEqual(reports.map(item => item.device.records.find(record => record.kind === 'ack').at), [at(110), at(130)]);
  assert.deepEqual(reports.map(item => item.device.records.find(record => record.kind === 'physical-feedback').at), [at(115), at(135)]);
  assert.ok(reports.every(item => item.device.trust === 'not-authenticated'));
  assert.notEqual(reports[0].device.identity.requestId, reports[1].device.identity.requestId);
});

test('REF-06-006 compatible logical outputs admit GPIO expansion and bus endpoints without source changes', () => {
  const example = JSON.parse(fs.readFileSync(new URL('../contracts/integration-v1/examples/fictional-fixture.json', import.meta.url)));
  const original = structuredClone(example.artifacts);
  for (const [driver, address] of [['soc-gpio', '17'], ['i2c-expander', 'bus0/address32/channel2'], ['modbus-relay', 'bus0/slave3/channel2']]) {
    const fixture = structuredClone(example);
    const endpoint = fixture.boardProfile.endpoints[fixture.installation.bindings.pump];
    Object.assign(endpoint, { driver, address });
    fixture.boardProfile.revision = `fixture-${driver}`;
    const profile = { id: fixture.boardProfile.id, revision: fixture.boardProfile.revision, sha256: jsonSha256(fixture.boardProfile) };
    fixture.release.device.boardProfile = profile;
    fixture.installation.boardProfile = profile;
    fixture.installation.revision = `fixture-${driver}`;
    fixture.release.installation = { id: fixture.installation.id, revision: fixture.installation.revision,
      sha256: jsonSha256(fixture.installation) };
    const input = { release: fixture.release, boardProfile: fixture.boardProfile, installation: fixture.installation,
      artifacts: { source: original.source, module: Buffer.from(original.moduleHex, 'hex'), manifest: original.manifest } };
    assert.deepEqual(validateIntegration(input), { valid: true, errors: [] });
    assert.deepEqual(fixture.artifacts, original);
    assert.equal(fixture.runEvidence.gates.physical.status, 'unknown');
    endpoint.direction = 'input';
    profile.sha256 = jsonSha256(fixture.boardProfile);
    fixture.release.installation.sha256 = jsonSha256(fixture.installation);
    assert.ok(validateIntegration(input).errors.some(error => error.code === 'direction_mismatch'));
  }
});
