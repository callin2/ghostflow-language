#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const indexer = fileURLToPath(new URL('./docs-index.mjs', import.meta.url));
const usage = 'Usage: node docs-find.mjs [--root REPO] [--docs-dir RELATIVE_DIR ...] [--limit 1..100] QUERY [TERM ...]';

function stop(code, kind, detail) {
  console.error(`${kind}: ${detail}`);
  process.exit(code);
}

let requestedRoot = process.cwd();
const directories = [];
let limit = 12;
const query = [];
const args = process.argv.slice(2);
let termsOnly = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--') { termsOnly = true; continue; }
  if (!termsOnly && arg === '--root' && args[i + 1]) requestedRoot = args[++i];
  else if (!termsOnly && arg === '--docs-dir' && args[i + 1]) directories.push(args[++i]);
  else if (!termsOnly && arg === '--limit' && args[i + 1]) {
    limit = Number(args[++i]);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) stop(2, 'USAGE', usage);
  } else if (!termsOnly && arg.startsWith('--')) stop(2, 'USAGE', usage);
  else query.push(arg);
}
const terms = query.flatMap(value => value.trim().split(/\s+/)).filter(Boolean).map(value => value.toLocaleLowerCase());
if (!terms.length) stop(2, 'USAGE', usage);

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) stop(2, 'INVALID_REPOSITORY', result.stderr.trim() || result.error?.message || root);
  return result.stdout.trim();
}

const root = path.resolve(requestedRoot);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) stop(2, 'INVALID_REPOSITORY', root);
const gitRoot = git(root, ['rev-parse', '--show-toplevel']);
const head = git(gitRoot, ['rev-parse', 'HEAD']);
const branchResult = spawnSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: gitRoot, encoding: 'utf8' });
const branch = branchResult.status === 0 ? branchResult.stdout.trim() : '(detached)';
console.log(`repo: ${gitRoot}`);
console.log(`branch: ${branch}`);
console.log(`head: ${head}`);
const rootIndex = path.join(gitRoot, 'INDEX.md');
const generatedRoot = fs.existsSync(rootIndex) && fs.lstatSync(rootIndex).isFile() &&
  fs.readFileSync(rootIndex, 'utf8').split('\n').includes('<!-- doc-index: repository -->');
const selected = [...new Set(directories.length ? directories : [generatedRoot ? '.' : 'docs'])];
const rows = [];
for (const directory of selected) {
  if (!directory || path.isAbsolute(directory) || directory.split(/[\\/]/).includes('..')) {
    stop(2, 'USAGE', `invalid --docs-dir ${directory}`);
  }
  const dir = directory.split(path.sep).join('/');
  const absolute = path.join(gitRoot, dir);
  const indexPath = dir === '.' ? 'INDEX.md' : `${dir}/INDEX.md`;
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    const staged = git(gitRoot, ['ls-files', '--stage', '--', dir]);
    if (staged.split('\n').some(line => line.startsWith('160000 ') && line.endsWith(`\t${dir}`))) {
      stop(5, 'UNINITIALIZED_DIRECTORY', `${dir} is a Git submodule; initialize it before finding documents`);
    }
    stop(3, 'MISSING_INDEX', `${indexPath} (directory is missing)`);
  }
  if (!fs.existsSync(path.join(gitRoot, indexPath))) stop(3, 'MISSING_INDEX', indexPath);
  const checked = spawnSync(process.execPath, [indexer, '--check', '--root', gitRoot, '--docs-dir', dir], { encoding: 'utf8' });
  if (checked.status !== 0) {
    if (checked.status === 1) stop(4, 'STALE_INDEX', `${indexPath}; regenerate with docs-index.mjs`);
    stop(2, 'INVALID_INDEX_DIRECTORY', checked.stderr.trim() || dir);
  }
  const content = fs.readFileSync(path.join(gitRoot, indexPath), 'utf8');
  for (const line of content.split('\n')) {
    if (line.startsWith('| [') && terms.every(term => line.toLocaleLowerCase().includes(term))) rows.push(line);
  }
}

if (!rows.length) stop(1, 'NO_HITS', `no indexed path/title/type matches for ${query.join(' ')}`);
for (const row of rows.slice(0, limit)) console.log(row);
console.log(`${Math.min(rows.length, limit)} of ${rows.length} matches (limit ${limit})`);
