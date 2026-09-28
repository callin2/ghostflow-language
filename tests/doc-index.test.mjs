import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const scripts = process.env.DOC_INDEX_TEST_SCRIPTS ?? path.join(root, 'tools/doc-index');
function run(name, args, cwd = root) {
  return spawnSync(process.execPath, [path.join(scripts, `${name}.mjs`), '--root', cwd, ...args], { cwd, encoding: 'utf8' });
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-doc-index-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '-q', dir]).status, 0);
  assert.equal(spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--allow-empty', '-qm', 'fixture'], { cwd: dir }).status, 0);
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'examples/nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Root guidance\n');
  fs.writeFileSync(path.join(dir, 'docs/guide.md'), '# Guide\n');
  fs.writeFileSync(path.join(dir, 'examples/nested/control.ghost.md'), '# Nested control\n');
  fs.writeFileSync(path.join(dir, 'examples/view.html'), '<title>HTML control</title>');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.md\n');
  fs.writeFileSync(path.join(dir, 'ignored.md'), '# Ignored\n');
  fs.symlinkSync('AGENTS.md', path.join(dir, 'linked.md'));
  return dir;
}
function generate(dir) {
  for (const docsDir of ['docs', '.']) {
    const result = run('docs-index', ['--docs-dir', docsDir], dir);
    assert.equal(result.status, 0, result.stderr);
  }
}

test('root index covers root and nested Markdown/HTML without non-docs, ignored files or symlinks', t => {
  const dir = fixture(t);
  generate(dir);
  const index = fs.readFileSync(path.join(dir, 'INDEX.md'), 'utf8');
  for (const name of ['AGENTS.md', 'examples/nested/control.ghost.md', 'examples/view.html']) assert.ok(index.includes(name), name);
  for (const name of ['package.json', 'ignored.md', 'linked.md']) assert.ok(!index.includes(name), name);
});

test('root discovery detects add, rename, delete and title edits until regeneration; find stays read-only', t => {
  const dir = fixture(t);
  generate(dir);
  for (const mutate of [
    () => fs.writeFileSync(path.join(dir, 'new.md'), '# New\n'),
    () => fs.renameSync(path.join(dir, 'new.md'), path.join(dir, 'renamed.md')),
    () => fs.rmSync(path.join(dir, 'renamed.md')),
    () => fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Updated root guidance\n'),
  ]) {
    mutate();
    const before = fs.readFileSync(path.join(dir, 'INDEX.md'));
    assert.equal(run('docs-index', ['--check', '--docs-dir', '.'], dir).status, 1);
    const stale = run('docs-find', ['root'], dir);
    assert.equal(stale.status, 4, stale.stderr);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'INDEX.md')), before);
    generate(dir);
    assert.equal(run('docs-index', ['--check', '--docs-dir', '.'], dir).status, 0);
  }
  const before = fs.readFileSync(path.join(dir, 'INDEX.md'));
  const found = run('docs-find', ['--limit', '8', 'root'], dir);
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, /AGENTS\.md/);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'INDEX.md')), before);
});

test('repository root index covers every manifest source and translation and both indexes are fresh', () => {
  for (const docsDir of ['docs', '.']) {
    const checked = run('docs-index', ['--check', '--docs-dir', docsDir]);
    assert.equal(checked.status, 0, checked.stderr);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/translations.json')));
  const index = fs.readFileSync(path.join(root, 'INDEX.md'), 'utf8');
  for (const document of manifest.documents) {
    for (const file of [document.source, document.translation]) assert.ok(index.includes(`[${file}]`), file);
  }
  const found = run('docs-find', ['--limit', '8', 'AGENTS']);
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, /AGENTS\.md/);
});

test('vendored scripts match exact upstream provenance', () => {
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'tools/doc-index/provenance.json')));
  assert.match(provenance.commit, /^[a-f0-9]{40}$/);
  assert.deepEqual(Object.keys(provenance.files).sort(), ['docs-find.mjs', 'docs-index.mjs']);
  for (const [file, hash] of Object.entries(provenance.files)) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, 'tools/doc-index', file))).digest('hex'), hash, file);
  }
});

test('provenance rejects script tampering and an expanded vendor allowlist', async t => {
  const { checkDocIndexProvenance } = await import('../tools/check-doc-index-provenance.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-provenance-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of ['docs-index.mjs', 'docs-find.mjs', 'provenance.json']) {
    fs.copyFileSync(path.join(root, 'tools/doc-index', file), path.join(dir, file));
  }
  const directory = new URL(`file://${dir}/`);
  checkDocIndexProvenance(directory);
  fs.appendFileSync(path.join(dir, 'docs-find.mjs'), '\n// tampered\n');
  assert.throws(() => checkDocIndexProvenance(directory), /provenance mismatch: docs-find\.mjs/);
  fs.copyFileSync(path.join(root, 'tools/doc-index/docs-find.mjs'), path.join(dir, 'docs-find.mjs'));
  const manifestPath = path.join(dir, 'provenance.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.files['private.md'] = '0'.repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => checkDocIndexProvenance(directory), /Invalid doc-index upstream provenance/);
});

test('both documentation catalogs link the unified workflow pair', () => {
  for (const name of ['docs/DOCUMENTATION.md', 'docs/DOCUMENTATION.ko.md']) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    for (const file of ['DEVELOPMENT-WORKFLOW.md', 'DEVELOPMENT-WORKFLOW.ko.md']) {
      assert.ok(text.includes(`](${file})`), `${name}: ${file}`);
      assert.ok(fs.existsSync(path.join(root, 'docs', file)), file);
    }
  }
});
