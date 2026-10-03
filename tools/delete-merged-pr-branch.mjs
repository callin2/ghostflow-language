import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function deleteMergedPrBranch(event, git = args => execFileSync('git', args, { encoding: 'utf8' })) {
  const pr = event.pull_request;
  const repository = event.repository;
  if (event.action !== 'closed' || pr?.merged !== true || pr.base?.ref !== 'dev') return 'skip: not a merged dev PR';
  if (!repository?.full_name || pr.head?.repo?.full_name !== repository.full_name || pr.base?.repo?.full_name !== repository.full_name) return 'skip: fork or different repository';
  const branch = pr.head.ref;
  if ([ 'main', 'dev', repository.default_branch ].includes(branch) || /^releases?(?:[/-]|$)/.test(branch)) return 'skip: permanent branch';
  if (typeof branch !== 'string' || !/^[0-9a-f]{40}$/.test(pr.head.sha)) throw new Error('Invalid PR head identity');
  git(['check-ref-format', '--branch', branch]);
  const ref = `refs/heads/${branch}`;
  const row = git(['ls-remote', '--heads', 'origin', ref]).trim().split('\n').find(line => line.split(/\s+/)[1] === ref);
  if (!row) return 'skip: branch absent';
  if (row.split(/\s+/)[0] !== pr.head.sha) return 'skip: branch advanced';
  git(['push', `--force-with-lease=${ref}:${pr.head.sha}`, 'origin', `:${ref}`]);
  return `deleted: ${branch} at ${pr.head.sha}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(deleteMergedPrBranch(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))));
}
