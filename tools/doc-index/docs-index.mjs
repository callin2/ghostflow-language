#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
let mode = '--write';
let root = process.cwd();
let docsDir = 'docs';
let modeSeen = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (['--write', '--check', '--dates'].includes(arg) && !modeSeen) {
    mode = arg;
    modeSeen = true;
  } else if (arg === '--root' && args[i + 1]) {
    root = path.resolve(args[++i]);
  } else if (arg === '--docs-dir' && args[i + 1]) {
    docsDir = args[++i];
  } else {
    console.error('Usage: node docs-index.mjs [--write|--check|--dates] [--root REPO] [--docs-dir RELATIVE_DIR]');
    process.exit(2);
  }
}
if (path.isAbsolute(docsDir) || docsDir.split(/[\\/]/).includes('..') || docsDir === '') {
  console.error('--docs-dir must be a repository-relative directory without parent traversal');
  process.exit(2);
}
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error('--root must resolve to a Git working directory');
  process.exit(2);
}
const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
if (rootResult.status !== 0) {
  console.error(rootResult.stderr.trim() || '--root must resolve to a Git working directory');
  process.exit(2);
}
root = fs.realpathSync(rootResult.stdout.trim());
const resolvedDocs = path.resolve(root, docsDir);
const insideRoot = candidate => candidate === root || candidate.startsWith(`${root}${path.sep}`);
if (!fs.existsSync(resolvedDocs) || !fs.statSync(resolvedDocs).isDirectory() ||
    !insideRoot(fs.realpathSync(resolvedDocs))) {
  console.error('--docs-dir must resolve to a directory inside --root');
  process.exit(2);
}
docsDir = path.relative(root, resolvedDocs).split(path.sep).join('/') || '.';
const repositoryMode = docsDir === '.';
const indexPath = repositoryMode ? 'INDEX.md' : `${docsDir}/INDEX.md`;
const destination = path.join(root, indexPath);
const destinationStat = fs.lstatSync(destination, { throwIfNoEntry: false });
if (destinationStat && (!destinationStat.isFile() || !insideRoot(fs.realpathSync(destination)))) {
  console.error('Index must be a regular file inside --root');
  process.exit(2);
}
const runCommand = 'node <skill>/scripts/docs-index.mjs --root <repo> --docs-dir <relative-dir>';
const datesCommand = 'node <skill>/scripts/docs-index.mjs --dates --root <repo> --docs-dir <relative-dir>';

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.trim() || result.error?.message}`);
  return result.stdout;
}

function field(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\t', ' ').replaceAll(/\r?\n/g, ' ');
}

const paths = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', docsDir])
  .split('\0').filter(Boolean))]
  .filter(file => {
    const candidate = path.join(root, file);
    return file !== indexPath && (!repositoryMode || /\.(md|html)$/i.test(file)) &&
      fs.existsSync(candidate) && fs.lstatSync(candidate).isFile() && insideRoot(fs.realpathSync(candidate));
  })
  .sort((a, b) => {
    const aGroup = path.dirname(a) === docsDir ? '' : path.dirname(a);
    const bGroup = path.dirname(b) === docsDir ? '' : path.dirname(b);
    return aGroup.localeCompare(bGroup, 'en') || a.localeCompare(b, 'en');
  });

function title(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension !== '.md' && extension !== '.html') return path.basename(file);
  const contents = fs.readFileSync(path.join(root, file), 'utf8');
  const match = extension === '.md'
    ? contents.match(/^#\s+(.+?)\s*$/m)
    : extension === '.html' ? contents.match(/<title[^>]*>([\s\S]*?)<\/title>/i) : null;
  return match ? match[1].replace(/\s+/g, ' ').trim() : path.basename(file);
}

const entries = paths.map(file => ({ file, title: title(file), type: path.extname(file).slice(1) || 'file' }));

if (mode === '--dates') {
  const head = git(['rev-parse', 'HEAD']).trim();
  const shallow = git(['rev-parse', '--is-shallow-repository']).trim();
  const changed = new Set();
  const status = git(['status', '--porcelain=v1', '-z', '--', docsDir]).split('\0').filter(Boolean);
  for (let i = 0; i < status.length; i++) {
    const record = status[i];
    changed.add(record.slice(3));
    if (/^[RC]/.test(record) || /^[RC]/.test(record[1])) changed.add(status[++i]);
  }
  const rows = [`# Git history snapshot ${head} at ${new Date().toISOString()}`,
    `# Shallow repository: ${shallow}; history dates may be incomplete when true.`,
    '# Dates are first/last recorded committer timestamps in available history, not filesystem creation or current uncommitted edit times. Empty dates mean no commit history for this path.',
    'path\ttitle\tfirst_recorded_commit\tlast_recorded_commit\tworking_state'];
  for (const entry of entries) {
    const dates = git(['log', '--follow', '--format=%cI', '--', entry.file]).trim().split('\n').filter(Boolean);
    rows.push([entry.file, field(entry.title), dates.at(-1) ?? '', dates[0] ?? '',
      dates.length ? (changed.has(entry.file) ? 'modified' : 'clean') : 'uncommitted'].join('\t'));
  }
  const output = path.join(root, 'build/docs-index-dates.tsv');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, rows.join('\n') + '\n');
  console.log(`Wrote ${path.relative(root, output)} (${entries.length} documents; Git history snapshot ${head.slice(0, 12)})`);
  process.exit(0);
}

const lines = [
  '# Documentation index',
  ...(repositoryMode ? ['<!-- doc-index: repository -->'] : []),
  '',
  `Generated from Git tracked and nonignored working files in \`${docsDir}/\`. Run \`${runCommand}\` after changing document paths or titles.`,
  'This lists files, not current authority or acceptance status. Read each document and its linked evidence before relying on a claim.',
  `For first and last recorded Git commit dates, run \`${datesCommand}\`; see \`build/docs-index-dates.tsv\`. Dates do not establish original creation or uncommitted edit time.`,
  '',
];
let group = null;
for (const entry of entries) {
  const nextGroup = path.dirname(entry.file) === docsDir ? `${docsDir}/` : `${path.dirname(entry.file)}/`;
  if (nextGroup !== group) {
    if (group !== null) lines.push('');
    lines.push(`## ${nextGroup}`, '', '| Path | Title | Type |', '| --- | --- | --- |');
    group = nextGroup;
  }
  const relative = path.relative(resolvedDocs, path.join(root, entry.file)).split(path.sep).map(encodeURIComponent).join('/');
  lines.push(`| [${field(entry.file)}](${relative}) | ${field(entry.title)} | ${entry.type} |`);
}
lines.push('', `${entries.length} documents.`, '');
const expected = lines.join('\n');
if (mode === '--check') {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== expected) {
    console.error(`${indexPath} is stale; run ${runCommand}`);
    process.exit(1);
  }
  console.log(`${indexPath} current (${entries.length} documents)`);
} else {
  fs.writeFileSync(destination, expected);
  console.log(`Wrote ${indexPath} (${entries.length} documents)`);
}
