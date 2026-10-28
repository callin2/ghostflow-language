import test from 'node:test';
import assert from 'node:assert/strict';
import { leanOutcomeMatches } from '../experiments/lean-outcome.mjs';

const diagnostic = "tactic 'decide' proved that the proposition";
const contradiction = `error: ${diagnostic}\n  False\nis false`;
const failed = { status: 1, signal: null, error: undefined };

// Synthetic child results exercise the acceptance predicate, not Lean proofs.
test('Lean outcome predicate accepts normal success and the expected normal failure', () => {
  assert.equal(leanOutcomeMatches({ status: 0 }, '', true), true);
  assert.equal(leanOutcomeMatches(failed, contradiction, false, diagnostic), true);
  assert.equal(leanOutcomeMatches({ status: 0 }, contradiction, false, diagnostic), false);
  assert.equal(leanOutcomeMatches(failed, contradiction, true), false);
  assert.equal(leanOutcomeMatches(failed, 'other failure', false, diagnostic), false);
  assert.equal(leanOutcomeMatches({ status: 0 }, 'theorem uses sorryAx', true), false);
});

test('Lean outcome predicate rejects interrupted or unavailable child outcomes', () => {
  for (const result of [
    { ...failed, error: new Error('spawn ENOENT') },
    { ...failed, error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) },
    { ...failed, signal: 'SIGTERM' },
    { ...failed, signal: 'SIGKILL', status: null },
    { ...failed, status: null },
    { ...failed, status: undefined },
    { ...failed, status: 1.5 },
  ]) assert.equal(leanOutcomeMatches(result, contradiction, false, diagnostic), false);
});

test('Lean outcome predicate rejects infrastructure diagnostics mixed with expected failure', () => {
  for (const problem of [
    'could not import SourceReader', 'unknown module ModuleLoader',
    'unknown identifier sourceModule', 'unknown constant sourceModule',
    'failed to load olean', 'No such file or directory', 'timed out',
    'maximum recursion depth has been reached', 'maximum number of heartbeats has been reached', 'out of memory',
  ]) {
    const log = `${problem}\n${contradiction}`;
    assert.equal(leanOutcomeMatches(failed, log, false, diagnostic), false, problem);
    assert.equal(leanOutcomeMatches({ status: 0 }, log, true), false, problem);
  }
});
