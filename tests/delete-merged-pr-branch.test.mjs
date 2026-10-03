import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deleteMergedPrBranch } from '../tools/delete-merged-pr-branch.mjs';

const sha = 'a'.repeat(40);
function event() {
  return { action: 'closed', repository: { full_name: 'owner/language', default_branch: 'stable' }, pull_request: { merged: true, base: { ref: 'dev', repo: { full_name: 'owner/language' } }, head: { ref: 'fix/example', sha, repo: { full_name: 'owner/language' } } } };
}
function mock(output = `${sha}\trefs/heads/fix/example\n`, failPush = false) {
  const calls = [];
  return { calls, git(args) { calls.push(args); if (args[0] === 'push' && failPush) throw new Error('lease rejected'); return args[0] === 'ls-remote' ? output : ''; } };
}

test('only closed, merged, same-repository dev PRs are eligible', () => {
  for (const mutate of [ e => e.action = 'opened', e => e.pull_request.merged = false, e => e.pull_request.base.ref = 'main', e => e.pull_request.head.repo.full_name = 'fork/language', e => e.pull_request.base.repo.full_name = 'other/language' ]) {
    const e = event(); mutate(e); const m = mock();
    assert.match(deleteMergedPrBranch(e, m.git), /^skip:/); assert.deepEqual(m.calls, []);
  }
});
test('permanent and release branches are preserved', () => {
  for (const branch of ['main', 'dev', 'stable', 'release', 'releases', 'release/0.1', 'release-0.1', 'releases/0.1']) {
    const e = event(); e.pull_request.head.ref = branch; const m = mock();
    assert.equal(deleteMergedPrBranch(e, m.git), 'skip: permanent branch'); assert.deepEqual(m.calls, []);
  }
});
test('missing and advanced remote tips are preserved', () => {
  for (const [output, expected] of [['', 'absent'], [`${'b'.repeat(40)}\trefs/heads/fix/example\n`, 'advanced'], [`${sha}\trefs/heads/other\n`, 'absent']]) {
    const m = mock(output); assert.equal(deleteMergedPrBranch(event(), m.git), `skip: branch ${expected}`);
    assert.equal(m.calls.some(args => args[0] === 'push'), false);
  }
});
test('matching remote tip is deleted with an exact lease', () => {
  const m = mock(); assert.match(deleteMergedPrBranch(event(), m.git), /^deleted:/);
  assert.deepEqual(m.calls, [['check-ref-format', '--branch', 'fix/example'], ['ls-remote', '--heads', 'origin', 'refs/heads/fix/example'], ['push', `--force-with-lease=refs/heads/fix/example:${sha}`, 'origin', ':refs/heads/fix/example']]);
});
test('concurrent advancement rejects deletion and remains a failure', () => {
  const m = mock(undefined, true); assert.throws(() => deleteMergedPrBranch(event(), m.git), /lease rejected/);
});
test('workflow uses trusted dev source and limits event and permissions', () => {
  const workflow = readFileSync(new URL('../.github/workflows/delete-merged-dev-branch.yml', import.meta.url), 'utf8');
  assert.match(workflow, /types: \[closed\]/); assert.match(workflow, /branches: \[dev\]/);
  assert.match(workflow, /pull_request\.merged == true/); assert.match(workflow, /head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /contents: write/); assert.match(workflow, /ref: dev/);
  assert.match(workflow, /run: node tools\/delete-merged-pr-branch\.mjs/);
});
