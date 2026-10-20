import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '@toon-format/toon';
import { BEHAVIOR_COMPARISON_LIMITS, compareBehavior } from '../tools/behavior-comparison.mjs';
import { compileSource, intentConditionDigest, intentInterpretationDigest } from '../tools/toolchain.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'tools/ghostcompare.mjs');
const source = seconds => `<!-- ghostflow:anchor id=LIMIT kind=intent status=confirmed origin=user -->
> Report elapsed active time at the configured limit.

\`\`\`ghost
control Timer {
  state active: Bool = true;
  timer age = elapsed(active);
  // ghostflow:link id=LIMIT relation=implements
  output expired: Bool;
  output drive: Percent;
  // ghostflow:link id=LIMIT relation=implements
  expired <- age >= ${seconds}s;
  drive <- 0%;
}
\`\`\`
`;
const timerScenario = { format: 'GhostFlow/scenario-v1', id: 'timer', initialInputs: [], keyBindings: [],
  actuatorBindings: [{ actuator: 'drive', output: 'drive', type: 'Percent', min: 0, max: 100 }],
  actions: [0, 10000, 15000, 20000, 25000].map(atMs => ({ kind: 'scan', atMs })) };
const safeExpired = { field: 'safe', name: 'expired' };
const point = (scanId, logicalTimeMs) => ({ scanId, logicalTimeMs });
const scope = { from: point(0, 0), to: point(4, 25000) };
const clone = value => JSON.parse(JSON.stringify(value));
const request = (baseline = source(10), candidate = source(15)) => ({
  format: 'GhostFlow/behavior-comparison-request-v1',
  baseline: { filename: 'timer-before.ghost.md', source: baseline },
  candidate: { filename: 'timer-after.ghost.md', source: candidate },
  scenario: clone(timerScenario), observations: [safeExpired, { field: 'faults' }], scope: clone(scope),
  assertions: [
    { id: 'AT-10', kind: 'equals', side: 'baseline', observation: safeExpired, at: point(1, 10000), expected: true },
    { id: 'UNCHANGED-FAULTS', kind: 'unchanged', observation: { field: 'faults' } },
    { id: 'ON-TIME-DELTA', kind: 'bool-on-duration-delta', observation: safeExpired, expectedDeltaMs: -5000 },
  ],
});

test('actual WASM timer change reports selected difference and exact Bool duration delta', async () => {
  const result = await compareBehavior(request());
  assert.equal(result.outcome, 'completed');
  assert.equal(result.physicalEffects, false);
  assert.equal(result.initialState, 'canonical-source-initial-state');
  assert.equal(result.baseline.runtime.kind, 'wasm');
  assert.match(result.baseline.runtime.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.observations.map(row => row.at), timerScenario.actions.map((item, index) => point(index, item.atMs)));
  assert.deepEqual(result.observations.map(row => row.values[0].baseline), [false, true, true, true, true]);
  assert.deepEqual(result.observations.map(row => row.values[0].candidate), [false, false, true, true, true]);
  assert.deepEqual(result.assertions.map(item => item.status), ['satisfied', 'satisfied', 'satisfied']);
  assert.deepEqual(result.assertions[2].actual, { baselineMs: 15000, candidateMs: 10000, deltaMs: -5000 });
});

test('no assertion means observed difference only; no-change is limited to selected scope', async () => {
  const input = request();
  input.scope = { from: point(0, 0), to: point(0, 0) };
  delete input.assertions;
  const limited = await compareBehavior(input);
  assert.equal(limited.outcome, 'completed');
  assert.deepEqual(limited.summary, { changed: 0, unchanged: 2 });
  assert.deepEqual(limited.assertions, []);
  assert.equal(limited.observations.length, 1);
});

test('stateBefore and stateAfter use canonical state trace bindings', async () => {
  const input = request();
  input.observations = [{ field: 'stateBefore', name: 'active' }, { field: 'stateAfter', name: 'active' }];
  input.assertions = [{ id: 'STATE-STABLE', kind: 'unchanged', observation: input.observations[1] }];
  const result = await compareBehavior(input);
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(result.observations.map(row => row.values.map(value => value.baseline)),
    Array(5).fill([true, true]));
  assert.equal(result.assertions[0].status, 'satisfied');
});

test('unwanted fault-stop change is visible while external expectation stays a reported scope', async () => {
  const first = `<!-- ghostflow:anchor id=FAULT kind=intent status=confirmed origin=user -->
> A failed moisture sample stops the pump.
\`\`\`ghost
control Pump {
  input moisture: Percent { sample = 1s; valid = 0% .. 100%; stale_after = 3s; }
  // ghostflow:link id=FAULT relation=implements
  output pump: Bool;
  // ghostflow:link id=FAULT relation=implements
  pump <- case moisture { ok(value) => value > 20%; fault(_) => false; };
}
\`\`\`
`;
  const second = first.replace('fault(_) => false', 'fault(_) => true');
  const base = await compileSource(first, { filename: 'pump-before.ghost.md' });
  const interpretation = { id: 'I-FAULT', revision: 'r1',
    original: { id: 'U-FAULT', revision: 'r1', reference: 'example:request' },
    text: 'Pump off on a failed sample.', anchorIds: ['FAULT'] };
  const condition = { id: 'C-FAULT', revision: 'r1', interpretation: { id: 'I-FAULT', revision: 'r1' },
    statement: 'Pump safe intent is false after fault.', scope: 'Faulted scan only',
    nodeIds: base.traceMetadata.intentLinks.filter(item => item.anchorId === 'FAULT').map(item => item.nodeId) };
  interpretation.decision = { kind: 'confirmed', actor: 'example-operator', authorityRef: 'example:authority',
    recordRef: 'example:record', at: '2026-10-19T00:00:00.000Z',
    interpretationSha256: intentInterpretationDigest(interpretation),
    conditions: [{ id: condition.id, revision: condition.revision, sha256: intentConditionDigest(condition) }] };
  const intentEvidence = { format: 'GhostFlow/intent-evidence-v1', sourceDocumentSha256: base.sourceDocument.sha256,
    interpretations: [interpretation], conditions: [condition], checks: [] };
  const input = request(first, second);
  input.baseline = { filename: 'pump-before.ghost.md', source: first, intentEvidence };
  input.candidate = { filename: 'pump-after.ghost.md', source: second };
  input.scenario = { format: 'GhostFlow/scenario-v1', id: 'fault', initialInputs: [], keyBindings: [],
    actions: [
      { kind: 'sample', name: 'moisture', epoch: 1, id: 1, timestampMs: 0, value: 50, quality: 'Good' },
      { kind: 'scan', atMs: 0 },
      { kind: 'sample', name: 'moisture', epoch: 1, id: 2, timestampMs: 1000, value: 50, quality: 'Disconnected' },
      { kind: 'scan', atMs: 1000 },
    ] };
  input.observations = [{ field: 'safe', name: 'pump' }, { field: 'faults' }];
  input.scope = { from: point(0, 0), to: point(1, 1000) };
  input.assertions = [
    { id: 'FAULT-OFF', kind: 'equals', side: 'baseline', observation: { field: 'safe', name: 'pump' },
      at: point(1, 1000), expected: false,
      evidence: { side: 'baseline', condition: { id: condition.id, revision: condition.revision, sha256: intentConditionDigest(condition) } } },
    { id: 'FAULT-UNCHANGED', kind: 'unchanged', observation: { field: 'safe', name: 'pump' } },
  ];
  const result = await compareBehavior(input);
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(result.observations.map(row => row.values[0].baseline), [true, false]);
  assert.deepEqual(result.observations.map(row => row.values[0].candidate), [true, true]);
  assert.equal(result.assertions[0].status, 'satisfied');
  assert.equal(result.assertions[0].evidence.confirmation, 'recorded');
  assert.equal(result.assertions[0].evidence.authority, 'not-authenticated');
  assert.equal(result.assertions[1].status, 'violated');
  assert.equal(result.assertions[1].evidenceBinding, 'unlinked');
  const stale = clone(input);
  stale.assertions[0].evidence.condition.sha256 = '0'.repeat(64);
  await assert.rejects(() => compareBehavior(stale), /condition identity, revision or digest mismatch/);
});

test('stale evidence and malformed or empty observation scope reject before execution', async () => {
  for (const change of [
    item => { item.observations = []; },
    item => { item.observations = [{ field: 'safe', name: 'unknown' }]; },
    item => { item.observations = [{ field: 'physical', name: 'relay' }]; },
    item => { item.scope.to = point(4, 25001); },
    item => { item.scenario.plant = {}; },
    item => { item.assertions[0].observation = { field: 'safe', name: 'not-selected' }; },
    item => { item.baseline.intentEvidence = { format: 'GhostFlow/intent-evidence-v1', sourceDocumentSha256: '0'.repeat(64),
      interpretations: [], conditions: [], checks: [] }; },
  ]) {
    const input = clone(request());
    change(input);
    await assert.rejects(() => compareBehavior(input));
  }
});

test('runtime host failure is incomplete and every supplied assertion becomes unknown', async () => {
  const numeric = value => `\`\`\`ghost\ncontrol Numeric { output drive: Number; drive <- ${value}; }\n\`\`\`\n`;
  const input = request(numeric(50), numeric(101));
  input.scenario.actuatorBindings = [{ actuator: 'drive', output: 'drive', type: 'Number', min: 0, max: 100 }];
  input.scenario.actions = [{ kind: 'scan', atMs: 0 }];
  input.scope = { from: point(0, 0), to: point(0, 0) };
  input.observations = [{ field: 'requested', name: 'drive' }];
  input.assertions = [{ id: 'SAME', kind: 'unchanged', observation: input.observations[0] }];
  const result = await compareBehavior(input);
  assert.equal(result.outcome, 'incomplete');
  assert.equal(result.runs.baseline.outcome, 'completed');
  assert.notEqual(result.runs.candidate.outcome, 'completed');
  assert.deepEqual(result.assertions.map(item => item.status), ['unknown']);
  assert.deepEqual(result.observations, []);
});

test('caller mutations after invocation cannot change the captured scenario or expectations', async () => {
  const input = request();
  const pending = compareBehavior(input);
  input.scenario.actions[1].atMs = 11000;
  input.assertions[0].expected = false;
  const result = await pending;
  assert.equal(result.outcome, 'completed');
  assert.equal(result.scenario.scanCount, 5);
  assert.equal(result.assertions[0].status, 'satisfied');
});

test('structured JSON and TOON CLI results agree for the same request', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-compare-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const requestPath = path.join(directory, 'request.json');
  fs.writeFileSync(requestPath, JSON.stringify(request()));
  const run = format => spawnSync(process.execPath, [cli, '--request', requestPath, '--format', format],
    { cwd: root, encoding: 'utf8', timeout: 30000 });
  const json = run('json'), toon = run('toon');
  assert.equal(json.status, 0, json.stderr + json.stdout);
  assert.equal(toon.status, 0, toon.stderr + toon.stdout);
  assert.deepEqual(JSON.parse(json.stdout), decode(toon.stdout, { strict: true }));
  const toonRequestPath = path.join(directory, 'request.toon');
  fs.writeFileSync(toonRequestPath, encode(request()));
  const fromToon = spawnSync(process.execPath, [cli, '--request', toonRequestPath, '--format', 'json'],
    { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(fromToon.status, 0, fromToon.stderr + fromToon.stdout);
  assert.deepEqual(JSON.parse(fromToon.stdout), JSON.parse(json.stdout));
  fs.writeFileSync(requestPath, '{broken');
  const bad = run('json');
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).outcome, 'rejected');
  fs.writeFileSync(requestPath, 'x'.repeat(BEHAVIOR_COMPARISON_LIMITS.requestBytes + 1));
  const oversized = run('json');
  assert.equal(oversized.status, 1);
  assert.match(JSON.parse(oversized.stdout).error.message, /byte limit exceeded/);
});
