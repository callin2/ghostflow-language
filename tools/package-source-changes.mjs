#!/usr/bin/env node
// Source-only distribution. This does not build or relabel a compiler/VM/firmware.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.argv[2];
if (!output || ['--help', '-h'].includes(output) || process.argv.length !== 3) {
  console.log('Usage: node tools/package-source-changes.mjs <output-directory>\nCreates a source-only @ghostflow/source-changes package from committed files.');
  if (output && !['--help', '-h'].includes(output)) process.exitCode = 2;
} else if (!['--help', '-h'].includes(output)) {
  const stage = await mkdtemp(join(tmpdir(), 'ghostflow-source-changes-'));
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const dependencies = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).dependencies;
    const selected = new Map(), imports = new Set();
    async function collect(path) {
      if (selected.has(path)) return;
      const code = await readFile(join(root, path), 'utf8');
      if (execFileSync('git', ['show', `HEAD:${path}`], { cwd: root, encoding: 'utf8' }) !== code) throw new Error(`Uncommitted package source: ${path}`);
      selected.set(path, code);
      for (const match of code.matchAll(/^(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
        const name = match[1];
        if (name.startsWith('.')) {
          const child = relative(root, resolve(root, dirname(path), name));
          if (child.startsWith('..')) throw new Error('Package import leaves owner repository');
          await collect(child);
        } else if (!name.startsWith('node:')) {
          if (!dependencies[name]) throw new Error(`Unpinned source dependency: ${name}`);
          imports.add(name);
        }
      }
    }
    for (const path of ['tools/source-changes.mjs', 'tools/update-request.mjs', 'tools/ghostdiff.mjs']) await collect(path);
    for (const path of ['LICENSE', 'docs/SOURCE-UPDATES.md', 'docs/SOURCE-UPDATES.ko.md']) {
      selected.set(path, execFileSync('git', ['show', `HEAD:${path}`], { cwd: root, encoding: 'utf8' }));
    }
    const files = {};
    for (const [path, code] of selected) {
      await mkdir(join(stage, dirname(path)), { recursive: true });
      await writeFile(join(stage, path), code);
      files[path] = createHash('sha256').update(code).digest('hex');
    }
    await writeFile(join(stage, 'package.json'), JSON.stringify({
      name: '@ghostflow/source-changes', version: '0.1.0', private: true, type: 'module',
      description: 'Shared GhostFlow structural comparison and update-scope preflight; no runtime or hardware effects',
      license: 'MIT', engines: { node: '>=22' },
      exports: { '.': './tools/source-changes.mjs', './update-request': './tools/update-request.mjs' },
      bin: { ghostdiff: './tools/ghostdiff.mjs' },
      dependencies: Object.fromEntries([...imports].sort().map(name => [name, dependencies[name]])),
    }, null, 2) + '\n');
    await writeFile(join(stage, 'provenance.json'), JSON.stringify({
      format: 'GhostFlow/source-changes-package-v1', repository: 'callin2/ghostflow-language', sourceRevision: revision,
      scope: 'source analysis only; does not change or certify the execution compiler/runtime', files,
    }, null, 2) + '\n');
    const destination = resolve(output);
    await mkdir(destination, { recursive: true });
    const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], {
      cwd: stage, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(tmpdir(), 'ghostflow-source-changes-npm-cache') },
    }));
    const archive = join(destination, packed[0].filename);
    const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
    console.log(JSON.stringify({ archive, sha256, sourceRevision: revision, sourceFiles: selected.size }));
  } finally { await rm(stage, { recursive: true, force: true }); }
}
