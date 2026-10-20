import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { decode, encode } from '@toon-format/toon';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { intentConditionDigest, intentInterpretationDigest } from '../tools/intent-evidence.mjs';
import { inspectIntentDecisions, INTENT_DECISIONS_REQUEST } from '../tools/intent-decisions.mjs';

const clone = x => structuredClone(x);
const at = '2000-01-01T00:00:00.000Z';
const text = `# Four decisions\n\n<!-- ghostflow:anchor id=REQ kind=intent status=confirmed origin=user -->\nPump request.\n\n<!-- ghostflow:anchor id=POLICY kind=premise status=confirmed origin=engineer -->\nPolicy.\n\n<!-- ghostflow:anchor id=GUESS kind=assumption status=unconfirmed origin=ai -->\nCandidate.\n\n<!-- ghostflow:anchor id=OPEN kind=intent status=unconfirmed origin=user -->\nOpen question.\n\n\`\`\`ghost\ncontrol Decisions {\n// ghostflow:link id=POLICY relation=constrains\ninput request: Bool;\n// ghostflow:link id=REQ relation=implements\noutput pump: Bool;\n// ghostflow:link id=GUESS relation=assumes\noutput candidate: Bool;\n// ghostflow:link id=OPEN relation=implements\noutput spare: Bool;\n// ghostflow:link id=REQ relation=implements\npump <- request |> recover(false);\n// ghostflow:link id=GUESS relation=assumes\ncandidate <- request |> recover(false);\n// ghostflow:link id=OPEN relation=implements\nspare <- request |> recover(false);\n}\n\`\`\`\n`;
function fixture(policyValidity = 'current') {
  const source = { text, filename: 'decisions.ghost.md', documentId: 'source.decisions', revisionId: 'revision.decisions.1' };
  const base = compileSourceSync(text, { filename: source.filename,
    interactionSourceIdentity: { documentId: source.documentId, revisionId: source.revisionId } });
  const node = anchorId => base.traceMetadata.intentLinks.find(x => x.anchorId === anchorId).nodeId;
  const make = (id, anchorId, kind, extra) => {
    const i = { id, revision: 'r1', original: { id: `ORIG-${id}`, revision: 'r1', reference: `record:${id}` },
      text: `Interpretation ${id}`, anchorIds: [anchorId], decision: null };
    i.decision = kind === 'confirmed' || kind === 'policy-derived'
      ? { kind, actor: 'operator', authorityRef: 'authority:operator', recordRef: `decision:${id}`,
        at, interpretationSha256: intentInterpretationDigest(i), conditions: [], ...extra }
      : kind === 'assumption' ? { kind, actor: 'model', reason: 'candidate only' }
        : { kind, question: 'What should spare do?', owner: null };
    return i;
  };
  const confirmed = make('I-REQ', 'REQ', 'confirmed');
  const policy = make('I-POLICY', 'POLICY', 'policy-derived', { policy: { id: 'P1', revision: 'r1', reference: 'policy:P1' },
    applicationRef: 'installation:1', validity: policyValidity });
  const assumption = make('I-GUESS', 'GUESS', 'assumption');
  const undecided = make('I-OPEN', 'OPEN', 'undecided');
  const condition = (id, i, nodeIds) => ({ id, revision: 'r1', interpretation: { id: i.id, revision: i.revision },
    statement: `Condition ${id}`, scope: `scope:${id}`, nodeIds });
  const conditions = [condition('C-PUMP', confirmed, [node('REQ')]), condition('C-OTHER', confirmed, []),
    condition('C-POLICY', policy, [node('POLICY')])];
  const ref = c => ({ id: c.id, revision: c.revision, sha256: intentConditionDigest(c) });
  confirmed.decision.conditions = [ref(conditions[0])];
  policy.decision.conditions = [ref(conditions[2])];
  const intentEvidence = { format: 'GhostFlow/intent-evidence-v1', sourceDocumentSha256: base.sourceDocument.sha256,
    interpretations: [confirmed, policy, assumption, undecided], conditions, checks: [] };
  return { schema: INTENT_DECISIONS_REQUEST, current: { source, intentEvidence } };
}
const row = (result, id) => result.current.decisions.find(x => x.id === id);
function contract(requirements) { return { id: 'REQ-CONTRACT', revision: 'r1', reference: 'fixture://requirements', requirements }; }
function req(id, interpretation, level, conditionRefs = []) {
  return { id, interpretation, level, conditionRefs, actionRefs: ['action:deploy'], claimRefs: ['claim:ready'], onUnmet: 'hold' };
}

test('four compiler-bound states, partial condition scope, and no contract remain distinct', () => {
  const r = fixture(), out = inspectIntentDecisions(r);
  assert.deepEqual(out.current.decisions.map(x => x.kind), ['confirmed', 'policy-derived', 'assumption', 'undecided']);
  assert.deepEqual(out.current.decisions.map(x => x.authority), Array(4).fill('not-authenticated'));
  assert.equal(row(out, 'I-REQ').conditions[0].confirmation, 'recorded');
  assert.equal(row(out, 'I-REQ').conditions[1].confirmation, 'outside-confirmed-scope');
  assert.equal(row(out, 'I-GUESS').original.decision.reason, 'candidate only');
  assert.equal(row(out, 'I-OPEN').original.decision.owner, null);
  assert.equal(row(out, 'I-OPEN').original.decision.question, 'What should spare do?');
  assert.equal(out.requirements.status, 'not-supplied');
  assert.equal(out.current.judgments.intentFit, 'not-evaluated');
  assert.equal(out.comparison.status, 'not-supplied');
  assert.deepEqual(inspectIntentDecisions(r), out);
});

test('explicit contract checks only supplied requirements and preserves policy metadata', () => {
  const r = fixture(); let out = inspectIntentDecisions(r);
  const pump = row(out, 'I-REQ'), other = pump.conditions[1], policy = row(out, 'I-POLICY');
  r.requirementContract = contract([
    req('R-PUMP', { id: pump.id, revision: pump.revision, sha256: pump.contentSha256 }, 'confirmed',
      [{ id: 'C-PUMP', revision: 'r1', sha256: pump.conditions[0].sha256 }]),
    req('R-OTHER', { id: pump.id }, 'confirmed', [{ id: 'C-OTHER', revision: 'r1', sha256: other.sha256 }]),
    req('R-OPEN', { id: 'I-OPEN' }, 'represented'),
    req('R-MISSING', { id: 'not-present' }, 'represented'),
    req('R-POLICY', { id: policy.id }, 'confirmed'),
  ]);
  out = inspectIntentDecisions(r);
  assert.deepEqual(out.requirements.requirements.map(x => x.status), ['met', 'unmet', 'met', 'unmet', 'met']);
  assert.ok(out.requirements.diagnostics.find(x => x.requirementId === 'R-OTHER').codes.includes('condition-outside-confirmed-scope:C-OTHER'));
  assert.equal(out.requirements.diagnostics.find(x => x.requirementId === 'R-MISSING').onUnmet, 'hold');
  r.requirementContract.requirements = [];
  assert.deepEqual(inspectIntentDecisions(r).requirements, { status: 'supplied', id: 'REQ-CONTRACT', revision: 'r1',
    reference: 'fixture://requirements', requirements: [], diagnostics: [] });
});

test('expired and unknown policy, assumption, wrong pins and absent conditions are unmet only when requested', () => {
  for (const validity of ['expired', 'unknown']) {
    const r = fixture(validity); r.requirementContract = contract([
      req('P', { id: 'I-POLICY' }, 'confirmed'), req('A', { id: 'I-GUESS' }, 'confirmed'),
      req('WRONG', { id: 'I-REQ', revision: 'old', sha256: '0'.repeat(64) }, 'represented'),
      req('COND', { id: 'I-REQ' }, 'confirmed', [{ id: 'no-condition', revision: 'r1', sha256: '0'.repeat(64) }]),
    ]);
    const out = inspectIntentDecisions(r);
    assert.ok(out.requirements.requirements[0].codes.includes('decision-policy-not-current'));
    assert.ok(out.requirements.requirements[1].codes.includes('decision-unconfirmed'));
    assert.ok(out.requirements.requirements[2].codes.includes('interpretation-revision-mismatch'));
    assert.ok(out.requirements.requirements[2].codes.includes('interpretation-content-mismatch'));
    assert.ok(out.requirements.requirements[3].codes.includes('condition-missing:no-condition'));
  }
});

test('independently validated revisions require exact full-record transition links', () => {
  const r = fixture(); r.previous = clone(r.current);
  let out = inspectIntentDecisions(r);
  assert.ok(out.comparison.changes.every(x => x.status === 'unchanged'));
  // Decision-only revision changes the full record but not interpreted content.
  r.current.intentEvidence.interpretations[3].decision.question = 'Who decides spare behavior?';
  out = inspectIntentDecisions(r);
  let changed = out.comparison.changes.find(x => x.before?.id === 'I-OPEN');
  assert.equal(changed.status, 'changed');
  assert.ok(changed.diagnostics.includes('transition-link-missing'));
  assert.ok(!changed.diagnostics.includes('interpretation-revision-reused'));
  const link = { from: { id: changed.before.id, revision: changed.before.revision, sha256: changed.before.recordSha256 },
    to: { id: changed.after.id, revision: changed.after.revision, sha256: changed.after.recordSha256 },
    actor: 'operator', recordRef: 'fixture://transition', at };
  r.transitions = [link];
  assert.deepEqual(inspectIntentDecisions(r).comparison.changes.find(x => x.before?.id === 'I-OPEN').diagnostics, []);
  const stale = clone(r); stale.transitions[0].to.sha256 = '0'.repeat(64);
  assert.throws(() => inspectIntentDecisions(stale), /stale or mismatched/);
  const duplicate = clone(r); duplicate.transitions.push(clone(link));
  assert.throws(() => inspectIntentDecisions(duplicate), /duplicate or ambiguous/);
});

test('condition-only changes alter transition scope; reused interpretation revision is diagnosed', () => {
  const r = fixture(); r.previous = clone(r.current);
  r.current.intentEvidence.conditions.push({ id: 'C-NEW', revision: 'r1',
    interpretation: { id: 'I-OPEN', revision: 'r1' }, statement: 'New unconfirmed condition',
    scope: 'future', nodeIds: [] });
  let out = inspectIntentDecisions(r);
  let changed = out.comparison.changes.find(x => x.before?.id === 'I-OPEN');
  assert.equal(changed.status, 'changed');
  assert.equal(changed.before.contentSha256, changed.after.contentSha256);
  assert.notEqual(changed.before.recordSha256, changed.after.recordSha256);
  assert.ok(changed.diagnostics.includes('transition-link-missing'));
  r.transitions = [{ from: { id: changed.before.id, revision: changed.before.revision, sha256: changed.before.recordSha256 },
    to: { id: changed.after.id, revision: changed.after.revision, sha256: changed.after.recordSha256 },
    actor: 'operator', recordRef: 'fixture://condition-transition', at }];
  assert.deepEqual(inspectIntentDecisions(r).comparison.changes.find(x => x.before?.id === 'I-OPEN').diagnostics, []);
  const stale = clone(r); stale.transitions[0].to.sha256 = changed.before.recordSha256;
  assert.throws(() => inspectIntentDecisions(stale), /stale or mismatched/);
  const drift = fixture(); drift.previous = clone(drift.current);
  drift.current.intentEvidence.interpretations[2].text = 'Changed interpreted assumption';
  out = inspectIntentDecisions(drift);
  changed = out.comparison.changes.find(x => x.before?.id === 'I-GUESS');
  assert.ok(changed.diagnostics.includes('interpretation-revision-reused'));
  const conditionDrift = fixture(); conditionDrift.previous = clone(conditionDrift.current);
  conditionDrift.current.intentEvidence.conditions[1].statement = 'Revised outside-scope condition';
  out = inspectIntentDecisions(conditionDrift);
  changed = out.comparison.changes.find(x => x.before?.id === 'I-REQ');
  assert.ok(changed.diagnostics.includes('condition-revision-reused:C-OTHER'));
});

test('added and removed interpretation records remain explicit', () => {
  const r = fixture(); r.previous = clone(r.current);
  r.current.intentEvidence.interpretations = r.current.intentEvidence.interpretations.filter(x => x.id !== 'I-OPEN');
  const out = inspectIntentDecisions(r);
  assert.equal(out.comparison.changes.find(x => x.before?.id === 'I-OPEN').status, 'removed');
  const reversed = fixture(); reversed.previous = clone(reversed.current);
  reversed.previous.intentEvidence.interpretations = reversed.previous.intentEvidence.interpretations.filter(x => x.id !== 'I-OPEN');
  assert.equal(inspectIntentDecisions(reversed).comparison.changes.find(x => x.after?.id === 'I-OPEN').status, 'added');
});

test('explicit cross-ID rename binds exact records without same-ID revision warning', () => {
  const r = fixture(); r.previous = clone(r.current);
  r.current.intentEvidence.interpretations[3].id = 'I-RENAMED';
  const old = inspectIntentDecisions({ ...r, current: r.previous }).current.decisions.find(x => x.id === 'I-OPEN');
  const now = inspectIntentDecisions({ schema: r.schema, current: r.current }).current.decisions.find(x => x.id === 'I-RENAMED');
  r.transitions = [{ from: { id: old.id, revision: old.revision, sha256: old.recordSha256 },
    to: { id: now.id, revision: now.revision, sha256: now.recordSha256 },
    actor: 'operator', recordRef: 'fixture://rename', at }];
  const comparison = inspectIntentDecisions(r).comparison;
  const changed = comparison.changes.find(x => x.before?.id === 'I-OPEN');
  assert.equal(changed.status, 'changed');
  assert.equal(changed.after.id, 'I-RENAMED');
  assert.ok(!changed.diagnostics.includes('interpretation-revision-reused'));
});

test('unchanged bytecode cannot carry stale confirmation into changed canonical source', () => {
  const r = fixture(); r.previous = clone(r.current);
  r.current.source.text = r.current.source.text.replace('Pump request.', 'Pump request revised.');
  assert.throws(() => inspectIntentDecisions(r), /sourceDocumentSha256|source revision mismatch/);
  const base = compileSourceSync(r.current.source.text, { filename: r.current.source.filename,
    interactionSourceIdentity: { documentId: r.current.source.documentId, revisionId: r.current.source.revisionId } });
  r.current.intentEvidence.sourceDocumentSha256 = base.sourceDocument.sha256;
  // Existing interpretation content and confirmation can only remain if explicitly supplied and validated for this source.
  const out = inspectIntentDecisions(r);
  assert.notEqual(out.current.source.sha256, out.comparison.previousSource.sha256);
  assert.equal(out.current.source.bytecodeSha256, out.comparison.previousSource.bytecodeSha256);
  assert.ok(out.comparison.diagnostics.includes('source-revision-reused'));
  r.current.intentEvidence.interpretations[0].text = 'Changed interpretation';
  assert.throws(() => inspectIntentDecisions(r), /confirmation belongs to another interpretation/);
});

test('composed canonical source reports the compiler-bound closure digest', () => {
  const child = '```ghost\ncontrol Child { output lamp: Bool; lamp <- true; }\n```\n';
  const root = '```ghost\nimport Child from "./child.ghost.md" revision "r1" sha256 "' + sha256Hex(child)
    + '";\ncontrol Root { output lamp: Bool; instance child: Child; connect lamp <- child.lamp; }\n```\n';
  const source = { text: root, filename: 'root.ghost.md', documentId: 'source.composed', revisionId: 'revision.composed.1' };
  const sourceClosure = [{ filename: 'child.ghost.md', revision: 'r1', text: child }];
  const compiled = compileSourceSync(root, { filename: source.filename, sourceClosure,
    interactionSourceIdentity: { documentId: source.documentId, revisionId: source.revisionId } });
  const intentEvidence = { format: 'GhostFlow/intent-evidence-v1', sourceDocumentSha256: compiled.sourceDocument.sha256,
    interpretations: [], conditions: [], checks: [] };
  const out = inspectIntentDecisions({ schema: INTENT_DECISIONS_REQUEST, current: { source, sourceClosure, intentEvidence } });
  assert.match(out.current.source.sourceClosureSha256, /^[a-f0-9]{64}$/);
  assert.equal(out.current.source.bytecodeSha256, compiled.manifest.bytecodeSha256);
  const tampered = clone(sourceClosure); tampered[0].text += '\n';
  assert.throws(() => inspectIntentDecisions({ schema: INTENT_DECISIONS_REQUEST,
    current: { source, sourceClosure: tampered, intentEvidence } }), /sha256|digest|mismatch/);
});

test('malformed bounds, immutable inputs, and JSON/TOON CLI parity', () => {
  const r = fixture(), before = clone(r);
  const out = inspectIntentDecisions(r);
  assert.deepEqual(r, before);
  out.current.decisions[0].original.text = 'local mutation';
  assert.equal(r.current.intentEvidence.interpretations[0].text, before.current.intentEvidence.interpretations[0].text);
  const bad = clone(r); bad.current.intentEvidence.interpretations = Array(2); bad.current.intentEvidence.interpretations[0] = r.current.intentEvidence.interpretations[0];
  assert.throws(() => inspectIntentDecisions(bad), /sparse|array/);
  const huge = clone(r); huge.current.source.text = 'x'.repeat(524289);
  assert.throws(() => inspectIntentDecisions(huge), /byte limit/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostdecisions-'));
  try {
    const json = path.join(directory, 'request.json'), toon = path.join(directory, 'request.toon');
    fs.writeFileSync(json, JSON.stringify(r)); fs.writeFileSync(toon, encode(r));
    const cli = new URL('../tools/ghostdecisions.mjs', import.meta.url).pathname;
    const run = (file, format) => spawnSync(process.execPath, [cli, '--request', file, '--format', format], { encoding: 'utf8' });
    const j = run(json, 'json'), t = run(toon, 'toon');
    assert.equal(j.status, 0, j.stdout + j.stderr); assert.equal(t.status, 0, t.stdout + t.stderr);
    assert.deepEqual(decode(t.stdout, { strict: true }), JSON.parse(j.stdout));
    fs.writeFileSync(json, 'x'.repeat(524289));
    assert.equal(JSON.parse(run(json, 'json').stdout).outcome, 'rejected');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('expanded output limit returns only an explicit incomplete envelope', () => {
  const r = fixture(); r.previous = clone(r.current);
  for (let i = 0; i < 48; i++) {
    const c = { id: `C-LARGE-${i}`, revision: 'r1', interpretation: { id: 'I-OPEN', revision: 'r1' },
      statement: `Condition ${i} ${'x'.repeat(4000)}`, scope: 'large', nodeIds: [] };
    r.current.intentEvidence.conditions.push(c);
    r.previous.intentEvidence.conditions.push(clone(c));
  }
  const out = inspectIntentDecisions(r);
  assert.equal(out.outcome, 'incomplete');
  assert.equal(out.current, undefined);
  assert.equal(out.requirements, undefined);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostdecisions-large-'));
  try {
    const json = path.join(directory, 'request.json'); fs.writeFileSync(json, JSON.stringify(r));
    const cli = new URL('../tools/ghostdecisions.mjs', import.meta.url).pathname;
    const run = spawnSync(process.execPath, [cli, '--request', json, '--format', 'json'], { encoding: 'utf8' });
    assert.equal(run.status, 1); assert.equal(JSON.parse(run.stdout).outcome, 'incomplete');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
