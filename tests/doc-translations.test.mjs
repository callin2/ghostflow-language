import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { checkTranslations, discoverMarkdown } from '../tools/check-doc-translations.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-translations-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = '# Guide\n```js\nconst x = 1;\n```\n';
  const translation = '<!-- translation-source: guide.md -->\n[Original](guide.md)\n# 안내\n```js\nconst x = 1;\n```\n';
  fs.writeFileSync(path.join(root, 'guide.md'), source);
  fs.writeFileSync(path.join(root, 'guide.ko.md'), translation);
  const manifest = { format: 'GhostFlow/document-translations-v1', documents: [{
    source: 'guide.md', sourceLanguage: 'en', translation: 'guide.ko.md',
    sourceSha256: sha(source), translationSha256: sha(translation),
  }], exclusions: [] };
  return { root, manifest, source, translation, files: ['guide.md', 'guide.ko.md'] };
}
test('valid bilingual pair and exact reasoned evidence exclusion', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'report.md'), '# Measurement\n');
  f.manifest.exclusions.push({ path: 'report.md', reason: 'Historical measurement evidence.' });
  assert.deepEqual(checkTranslations(f.root, f.manifest, [...f.files, 'report.md']), { documents: 1, exclusions: 1 });
});
test('translated PlantUML labels are allowed while executable JavaScript remains exact', t => {
  const f = fixture(t), entry = f.manifest.documents[0];
  const source = f.source + '```plantuml\n@startuml\nAlice -> Bob: Start pump\n@enduml\n```\n';
  const translation = f.translation + '```plantuml\n@startuml\nAlice -> Bob: 펌프 시작\n@enduml\n```\n';
  fs.writeFileSync(path.join(f.root, entry.source), source);
  fs.writeFileSync(path.join(f.root, entry.translation), translation);
  entry.sourceSha256 = sha(source); entry.translationSha256 = sha(translation);
  assert.equal(checkTranslations(f.root, f.manifest, f.files).documents, 1);
});
for (const [name, mutate, pattern] of [
  ['missing counterpart', f => fs.unlinkSync(path.join(f.root, 'guide.ko.md')), /missing/],
  ['stale source digest', f => fs.appendFileSync(path.join(f.root, 'guide.md'), 'Changed\n'), /stale source/],
  ['stale translation digest', f => fs.appendFileSync(path.join(f.root, 'guide.ko.md'), '변경\n'), /stale translation/],
  ['unclassified document', f => { f.files.push('new.md'); fs.writeFileSync(path.join(f.root, 'new.md'), '# New'); }, /unclassified/],
  ['empty exclusion reason', f => f.manifest.exclusions.push({ path: 'other.md', reason: '' }), /reason/],
  ['duplicate classification', f => f.manifest.exclusions.push({ path: 'guide.md', reason: 'Evidence' }), /duplicate/],
  ['unsafe path', f => { f.manifest.documents[0].source = '../guide.md'; }, /unsafe/],
  ['wrong language suffix', f => { f.manifest.documents[0].sourceLanguage = 'ko'; }, /suffix/],
  ['missing exclusion file', f => f.manifest.exclusions.push({ path: 'absent.md', reason: 'Historical evidence' }), /missing/],
  ['empty document', f => fs.writeFileSync(path.join(f.root, 'guide.md'), '  \n'), /empty/],
  ['missing ordinary backlink', f => { const text = f.translation.replace('[Original](guide.md)', 'Original'); fs.writeFileSync(path.join(f.root, 'guide.ko.md'), text); f.manifest.documents[0].translationSha256 = sha(text); }, /backlink/],
  ['missing provenance marker', f => { const text = f.translation.replace('<!-- translation-source: guide.md -->', ''); fs.writeFileSync(path.join(f.root, 'guide.ko.md'), text); f.manifest.documents[0].translationSha256 = sha(text); }, /marker/],
  ['changed executable fence', f => { const text = f.translation.replace('x = 1', 'x = 2'); fs.writeFileSync(path.join(f.root, 'guide.ko.md'), text); f.manifest.documents[0].translationSha256 = sha(text); }, /code blocks/],
]) test(`rejects ${name}`, t => {
  const f = fixture(t); mutate(f);
  assert.throws(() => checkTranslations(f.root, f.manifest, f.files), pattern);
});
test('Korean literate original has an English projection and repository-root backlink', t => {
  const f = fixture(t), entry = f.manifest.documents[0];
  const translation = f.translation.replaceAll('guide.md', 'lesson.ghost.md').replace('(lesson.ghost.md)', '(/lesson.ghost.md)');
  fs.renameSync(path.join(f.root, 'guide.md'), path.join(f.root, 'lesson.ghost.md'));
  fs.writeFileSync(path.join(f.root, 'lesson.ghost.en.md'), translation);
  Object.assign(entry, { source: 'lesson.ghost.md', sourceLanguage: 'ko', translation: 'lesson.ghost.en.md', translationSha256: sha(translation) });
  assert.equal(checkTranslations(f.root, f.manifest, ['lesson.ghost.md', 'lesson.ghost.en.md']).documents, 1);
});
for (const [name, section, pattern] of [
  ['omitted prose section', '', /heading-level sequence/],
  ['changed heading level', '### 사용\n<a id="q01"></a>\n설명\n', /heading-level sequence/],
  ['missing explicit anchor', '## 사용\n설명\n', /anchor IDs/],
  ['renamed explicit anchor', '## 사용\n<a id="q02"></a>\n설명\n', /anchor IDs/],
  ['localized heading and preserved anchor', "## 사용\n<a id='q01'></a>\n설명\n", null],
]) test(name, t => {
  const f = fixture(t), entry = f.manifest.documents[0];
  const source = f.source + '## Usage\n<a id="q01"></a>\nExplanation\n';
  const translation = f.translation + section;
  fs.writeFileSync(path.join(f.root, entry.source), source);
  fs.writeFileSync(path.join(f.root, entry.translation), translation);
  entry.sourceSha256 = sha(source); entry.translationSha256 = sha(translation);
  if (pattern) assert.throws(() => checkTranslations(f.root, f.manifest, f.files), pattern);
  else assert.equal(checkTranslations(f.root, f.manifest, f.files).documents, 1);
});
test('Git discovery includes tracked and nonignored untracked Markdown in every directory', t => {
  const f = fixture(t);
  execFileSync('git', ['init', '-q'], { cwd: f.root });
  execFileSync('git', ['add', 'guide.md'], { cwd: f.root });
  fs.writeFileSync(path.join(f.root, '.gitignore'), 'ignored.md\n');
  fs.writeFileSync(path.join(f.root, 'ignored.md'), '# Ignored');
  fs.mkdirSync(path.join(f.root, 'tasks'));
  fs.writeFileSync(path.join(f.root, 'tasks/new.md'), '# Task');
  assert.deepEqual(discoverMarkdown(f.root), ['guide.ko.md', 'guide.md', 'tasks/new.md']);
});
