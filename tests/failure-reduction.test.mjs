import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '@toon-format/toon';
import { reduceFailure, FAILURE_REDUCTION_LIMITS } from '../tools/failure-reduction.mjs';
import { compileSource, intentConditionDigest, intentInterpretationDigest } from '../tools/toolchain.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'tools/ghostshrink.mjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const source = `<!-- ghostflow:anchor id=LIMIT kind=intent status=confirmed origin=user -->
> Expiry is determined by the elapsed active interval.

\`\`\`ghost
control Timer {
  state active: Bool = true;
  timer age = elapsed(active);
  // ghostflow:link id=LIMIT relation=implements
  output expired: Bool;
  output drive: Percent;
  // ghostflow:link id=LIMIT relation=implements
  expired <- age >= 10s;
  drive <- 0%;
}
\`\`\`
`;
const originalActions = [0, 1000, 5000, 10000, 15000].map(atMs => ({ kind: 'scan', atMs }));
function request() {
  return { format: 'GhostFlow/failure-reduction-request-v1',
    program: { filename: 'timer.ghost.md', source },
    scenario: { format: 'GhostFlow/scenario-v1', id: 'timer-failure', initialInputs: [], keyBindings: [],
      actuatorBindings: [{ actuator: 'drive', output: 'drive', type: 'Percent', min: 0, max: 100 }],
      actions: clone(originalActions) },
    predicate: { kind: 'equals', observation: { field: 'safe', name: 'expired' },
      expected: false, at: { actionIndex: 4, logicalTimeMs: 15000 } },
    requirement: { id: 'REQ-LIMIT', revision: 'r1', sha256: sha('external requirement revision r1'),
      reference: 'example:requirements/REQ-LIMIT/r1' },
    maxAttempts: 32 };
}

test('actual WASM shrinking removes noise, keeps necessary start scan and preserves the violation', async () => {
  const result = await reduceFailure(request());
  assert.equal(result.outcome, 'reproduced');
  assert.equal(result.reductionStatus, 'single-deletion-minimal');
  assert.equal(result.originalActionCount, 5);
  assert.deepEqual(result.reducedScenario.actions, [originalActions[2], originalActions[4]]);
  assert.equal(result.reducedActionCount, 2);
  assert.equal(result.target.originalActionIndex, 4);
  assert.equal(result.target.reducedActionIndex, 1);
  assert.equal(result.target.reducedScanId, 1);
  assert.deepEqual(result.scanMapping, [
    { originalActionIndex: 2, newActionIndex: 0, scanId: 0, logicalTimeMs: 5000 },
    { originalActionIndex: 4, newActionIndex: 1, scanId: 1, logicalTimeMs: 15000 },
  ]);
  assert.equal(result.originalObservation.value, true);
  assert.equal(result.reducedObservation.value, true);
  assert.equal(result.source.runtime.kind, 'wasm');
  assert.match(result.source.runtime.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.physicalEffects, false);
  assert.equal(result.condition.binding, 'unlinked');
  assert.ok(result.sourceBinding.nodeId > 0);
  assert.equal(result.sourceBinding.source.filename, 'timer.ghost.md');
  assert.ok(result.sourceBinding.source.line > 0);
  assert.ok(result.sourceBinding.source.column > 0);
  assert.deepEqual(result.history.filter(item => item.status === 'accepted').map(item => item.deletedOriginalActionIndex), [0, 1, 3]);
});

test('candidate runtime errors never count as reproductions or minimality proof', async () => {
  const numeric = `\`\`\`ghost\ncontrol Numeric { input setting: Number; output drive: Number; drive <- setting |> recover(0); }\n\`\`\`\n`;
  const input = request();
  input.program.source = numeric;
  input.scenario.initialInputs = [{ name: 'setting', type: 'Number', value: 101 }];
  input.scenario.actions = [{ kind: 'input', name: 'setting', type: 'Number', value: 50 }, { kind: 'scan', atMs: 0 }];
  input.scenario.actuatorBindings[0].type = 'Number';
  input.predicate = { kind: 'equals', observation: { field: 'safe', name: 'drive' },
    expected: 40, at: { actionIndex: 1, logicalTimeMs: 0 } };
  const result = await reduceFailure(input);
  assert.equal(result.outcome, 'reproduced');
  assert.equal(result.reductionStatus, 'unresolved-candidates');
  assert.equal(result.reducedActionCount, 2);
  assert.equal(result.history[0].status, 'unknown');
  assert.notEqual(result.history[0].outcome, 'completed');
  assert.equal(result.reducedObservation.value, 50);

  input.scenario.initialInputs[0].value = 70;
  const different = await reduceFailure(input);
  assert.equal(different.reductionStatus, 'single-deletion-minimal');
  assert.equal(different.originalObservation.value, 50);
  assert.equal(different.reducedObservation.value, 70);
  assert.equal(different.reducedActionCount, 1);
});

test('same-scan fault guard keeps the fault event even when pump stays ON without it', async () => {
  const input = request();
  input.program.source = `\`\`\`ghost
control Pump {
  input moisture: Percent { sample = 1s; valid = 0% .. 100%; stale_after = 3s; }
  output pump, faulted: Bool;
  pump <- case moisture { ok(value) => value > 20%; fault(_) => true; };
  faulted <- case moisture {
    ok(value) => false;
    fault(reason) => case reason {
      Disconnected => true; Stale => false; Invalid => false; NotReady => false;
    };
  };
}
\`\`\`\n`;
  input.scenario = { format: 'GhostFlow/scenario-v1', id: 'fault-guard', initialInputs: [], keyBindings: [],
    actions: [
      { kind: 'sample', name: 'moisture', epoch: 1, id: 1, timestampMs: 0, value: 50, quality: 'Good' },
      { kind: 'scan', atMs: 0 },
      { kind: 'sample', name: 'moisture', epoch: 1, id: 2, timestampMs: 1000, value: 50, quality: 'Disconnected' },
      { kind: 'scan', atMs: 1000 },
    ] };
  input.predicate = { kind: 'equals', observation: { field: 'safe', name: 'pump' }, expected: false,
    at: { actionIndex: 3, logicalTimeMs: 1000 },
    when: [{ observation: { field: 'safe', name: 'faulted' }, expected: true }] };
  const result = await reduceFailure(input);
  assert.equal(result.outcome, 'reproduced');
  assert.equal(result.originalObservation.value, true);
  assert.equal(result.originalObservation.guards[0].matched, true);
  assert.equal(result.reducedObservation.guards[0].matched, true);
  assert.ok(result.reducedScenario.actions.some(action => action.kind === 'sample' && action.quality === 'Disconnected'));
  assert.ok(result.history.some(item => item.deletedOriginalActionIndex === 2 && item.status === 'rejected'
    && item.value === true && item.guards[0].matched === false));
  assert.equal(result.guardSourceBindings[0].name, 'faulted');

  const absent = clone(input);
  absent.predicate.when[0].expected = false;
  const notApplicable = await reduceFailure(absent);
  assert.equal(notApplicable.outcome, 'original-not-applicable');
  assert.equal(notApplicable.attempts, 0);
});

test('exact #565 condition reference keeps confirmation scope and rejects stale digests', async () => {
  const base = await compileSource(source, { filename: 'timer.ghost.md' });
  const interpretation = { id: 'I-LIMIT', revision: 'r1',
    original: { id: 'U-LIMIT', revision: 'r1', reference: 'example:request' },
    text: 'Timer limit has a stated expectation.', anchorIds: ['LIMIT'] };
  const condition = { id: 'C-LIMIT', revision: 'r1', interpretation: { id: 'I-LIMIT', revision: 'r1' },
    statement: 'The expiry flag remains false at 15 seconds.', scope: 'One virtual scan',
    nodeIds: base.traceMetadata.intentLinks.filter(item => item.anchorId === 'LIMIT').map(item => item.nodeId) };
  interpretation.decision = { kind: 'confirmed', actor: 'fictional-operator', authorityRef: 'example:authority',
    recordRef: 'example:decision', at: '2026-10-19T00:00:00.000Z',
    interpretationSha256: intentInterpretationDigest(interpretation),
    conditions: [{ id: condition.id, revision: condition.revision, sha256: intentConditionDigest(condition) }] };
  const input = request();
  input.program.intentEvidence = { format: 'GhostFlow/intent-evidence-v1', sourceDocumentSha256: base.sourceDocument.sha256,
    interpretations: [interpretation], conditions: [condition], checks: [] };
  input.condition = { id: condition.id, revision: condition.revision, sha256: intentConditionDigest(condition) };
  const result = await reduceFailure(input);
  assert.equal(result.condition.binding, 'recorded');
  assert.equal(result.condition.confirmation, 'recorded');
  assert.equal(result.condition.authority, 'not-authenticated');
  const stale = clone(input);
  stale.condition.sha256 = '0'.repeat(64);
  await assert.rejects(() => reduceFailure(stale), /condition identity, revision or digest mismatch/);
});

test('original equality, incomplete execution and exhausted budget remain distinct', async () => {
  const notFailing = request();
  notFailing.predicate.expected = true;
  const equalResult = await reduceFailure(notFailing);
  assert.equal(equalResult.outcome, 'original-not-failing');
  assert.equal(equalResult.attempts, 0);

  const budget = request();
  budget.maxAttempts = 1;
  const budgetResult = await reduceFailure(budget);
  assert.equal(budgetResult.outcome, 'reproduced');
  assert.equal(budgetResult.reductionStatus, 'budget-exhausted');
  assert.equal(budgetResult.attempts, 1);

  const broken = request();
  broken.program.source = `\`\`\`ghost\ncontrol Bad { output drive: Number; drive <- 101; }\n\`\`\`\n`;
  broken.predicate.observation = { field: 'safe', name: 'drive' };
  broken.scenario.actuatorBindings[0].type = 'Number';
  broken.scenario.actuatorBindings[0].max = 100;
  const incomplete = await reduceFailure(broken);
  assert.equal(incomplete.outcome, 'incomplete');
  assert.equal(incomplete.attempts, 0);
  assert.notEqual(incomplete.originalObservation.outcome, 'completed');

  broken.predicate.when = [{ observation: { field: 'safe', name: 'drive' }, expected: 101 }];
  const guardedIncomplete = await reduceFailure(broken);
  assert.equal(guardedIncomplete.outcome, 'incomplete');
  assert.equal(guardedIncomplete.originalObservation.guards[0].valueStatus, 'unavailable');
});

test('request and action snapshots keep deterministic hashes despite caller mutations', async () => {
  const input = request();
  const pending = reduceFailure(input);
  input.scenario.actions[1].atMs = 2000;
  input.predicate.expected = true;
  const first = await pending;
  const second = await reduceFailure(request());
  assert.deepEqual(first, second);
  assert.equal(first.reducedScenario.actions[1].atMs, 15000);
});

test('strict request and target validation reject malformed or unsupported scope', async () => {
  for (const mutate of [
    item => { item.unknown = true; },
    item => { item.predicate.at.actionIndex = 99; },
    item => { item.predicate.at.logicalTimeMs = 14999; },
    item => { item.predicate.kind = 'eval'; },
    item => { item.scenario.plant = {}; },
    item => { item.maxAttempts = FAILURE_REDUCTION_LIMITS.maxAttempts + 1; },
    item => { item.program.filename = 'plain.ghost'; },
    item => { item.predicate.when = []; },
    item => { item.predicate.when = Array.from({ length: FAILURE_REDUCTION_LIMITS.guards + 1 },
      () => ({ observation: { field: 'safe', name: 'expired' }, expected: true })); },
    item => { item.predicate.when = [{ observation: { field: 'safe', name: 'absent' }, expected: true }]; },
  ]) {
    const input = request(); mutate(input);
    await assert.rejects(() => reduceFailure(input));
  }
});

test('JSON and TOON CLI requests and responses agree; invalid input exits nonzero', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-shrink-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const jsonPath = path.join(directory, 'request.json'), toonPath = path.join(directory, 'request.toon');
  fs.writeFileSync(jsonPath, JSON.stringify(request())); fs.writeFileSync(toonPath, encode(request()));
  const run = (filename, format) => spawnSync(process.execPath, [cli, '--request', filename, '--format', format],
    { cwd: root, encoding: 'utf8', timeout: 30000 });
  const json = run(jsonPath, 'json'), toon = run(jsonPath, 'toon'), inputToon = run(toonPath, 'json');
  assert.equal(json.status, 0, json.stderr + json.stdout);
  assert.equal(toon.status, 0, toon.stderr + toon.stdout);
  assert.equal(inputToon.status, 0, inputToon.stderr + inputToon.stdout);
  assert.deepEqual(JSON.parse(json.stdout), decode(toon.stdout, { strict: true }));
  assert.deepEqual(JSON.parse(json.stdout), JSON.parse(inputToon.stdout));
  fs.writeFileSync(jsonPath, '{broken');
  const bad = run(jsonPath, 'json');
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).outcome, 'rejected');
});
