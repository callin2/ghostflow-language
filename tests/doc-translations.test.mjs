import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { checkTranslations, discoverMarkdown, coverage } from '../tools/check-doc-translations.mjs';
import { autoStamp, migrateV1, stampDocument } from '../tools/stamp-doc-translations.mjs';

const FORMAT = 'GhostFlow/document-translations-v2';
const sha = text => createHash('sha256').update(text).digest('hex');
const SOURCE = '# Guide\n```js\nconst x = 1;\n```\n';
const KO = '<!-- translation-source: guide.md -->\n[Original](guide.md)\n# 안내\n```js\nconst x = 1;\n```\n';
const ZH = '<!-- translation-source: guide.md -->\n[English](guide.md)\n# 指南\n```js\nconst x = 1;\n```\n';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-translations-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => { fs.writeFileSync(path.join(root, file), text); return text; };
  write('guide.md', SOURCE); write('guide.ko.md', KO);
  const manifest = { format: FORMAT, documents: [{
    document: 'guide.md', baseLanguage: 'en', canonical: 'en', files: {
      en: { path: 'guide.md', sha256: sha(SOURCE) },
      ko: { path: 'guide.ko.md', sha256: sha(KO), from: 'en', sourceSha256: sha(SOURCE) },
    },
  }], exclusions: [] };
  const files = ['guide.md', 'guide.ko.md'];
  // Rewrites one language file and refreshes its own digest only.
  const rewrite = (language, text) => {
    const file = manifest.documents[0].files[language];
    write(file.path, text); file.sha256 = sha(text);
  };
  const addZh = (text = ZH) => {
    write('guide.zh.md', text); files.push('guide.zh.md');
    manifest.documents[0].files.zh = { path: 'guide.zh.md', sha256: sha(text), from: 'en', sourceSha256: sha(SOURCE) };
  };
  return { root, manifest, files, write, rewrite, addZh };
}

test('valid en/ko pair and exact reasoned evidence exclusion', t => {
  const f = fixture(t);
  f.write('report.md', '# Measurement\n');
  f.manifest.exclusions.push({ path: 'report.md', reason: 'Historical measurement evidence.' });
  assert.deepEqual(checkTranslations(f.root, f.manifest, [...f.files, 'report.md']), { documents: 1, translations: 1, exclusions: 1 });
});

test('optional zh/es/ja translations are fully validated when present', t => {
  const f = fixture(t); f.addZh();
  const es = ZH.replace('# 指南', '# Guía'), ja = ZH.replace('# 指南', '# ガイド');
  for (const [language, text] of [['es', es], ['ja', ja]]) {
    f.write(`guide.${language}.md`, text); f.files.push(`guide.${language}.md`);
    f.manifest.documents[0].files[language] = { path: `guide.${language}.md`, sha256: sha(text), from: 'en', sourceSha256: sha(SOURCE) };
  }
  assert.deepEqual(checkTranslations(f.root, f.manifest, f.files), { documents: 1, translations: 4, exclusions: 0 });
  const report = coverage(f.manifest);
  assert.equal(report.present.ja, 1);
  assert.deepEqual(report.missing.zh, []);
});

test('translated PlantUML labels are allowed while executable JavaScript remains exact', t => {
  const f = fixture(t);
  const source = SOURCE + '```plantuml\n@startuml\nAlice -> Bob: Start pump\n@enduml\n```\n';
  const translation = KO + '```plantuml\n@startuml\nAlice -> Bob: 펌프 시작\n@enduml\n```\n';
  f.rewrite('en', source); f.rewrite('ko', translation);
  f.manifest.documents[0].files.ko.sourceSha256 = sha(source);
  assert.equal(checkTranslations(f.root, f.manifest, f.files).documents, 1);
});

for (const [name, mutate, pattern] of [
  ['missing counterpart', f => fs.unlinkSync(path.join(f.root, 'guide.ko.md')), /missing/],
  ['missing required language', f => { delete f.manifest.documents[0].files.ko; f.files.pop(); }, /required ko/],
  ['stale source digest', f => fs.appendFileSync(path.join(f.root, 'guide.md'), 'Changed\n'), /stale source/],
  ['stale translation digest', f => fs.appendFileSync(path.join(f.root, 'guide.ko.md'), '변경\n'), /stale translation digest/],
  ['source edited without restamping translation', f => f.rewrite('en', SOURCE + 'More\n'), /stale translation source digest/],
  ['unclassified document', f => { f.files.push('new.md'); f.write('new.md', '# New'); }, /unclassified/],
  ['unclassified new-language file', f => { f.files.push('guide.zh.md'); f.write('guide.zh.md', ZH); }, /unclassified/],
  ['empty exclusion reason', f => f.manifest.exclusions.push({ path: 'other.md', reason: '' }), /reason/],
  ['duplicate classification', f => f.manifest.exclusions.push({ path: 'guide.md', reason: 'Evidence' }), /duplicate/],
  ['unsafe path', f => { f.manifest.documents[0].document = '../guide.md'; }, /unsafe/],
  ['wrong language suffix', f => { f.manifest.documents[0].baseLanguage = 'ko'; }, /suffix|base language file/],
  ['unsupported language', f => { f.manifest.documents[0].files.fr = { path: 'guide.fr.md' }; }, /unsupported language/],
  ['missing exclusion file', f => f.manifest.exclusions.push({ path: 'absent.md', reason: 'Historical evidence' }), /missing/],
  ['empty document', f => f.write('guide.md', '  \n'), /empty/],
  ['v1 manifest', f => { f.manifest.format = 'GhostFlow/document-translations-v1'; }, /invalid translation manifest/],
  ['unknown entry field', f => { f.manifest.documents[0].policy = true; }, /fields/],
  ['canonical with translation fields', f => { f.manifest.documents[0].files.en.from = 'ko'; }, /canonical file must record/],
  ['canonical with translation marker', f => f.rewrite('en', '<!-- translation-source: guide.ko.md -->\n' + SOURCE), /canonical file carries/],
  ['zh translated from Korean', f => { f.addZh(ZH.replace('guide.md -->', 'guide.ko.md -->')); Object.assign(f.manifest.documents[0].files.zh, { from: 'ko', sourceSha256: sha(KO) }); }, /canonical or English|from English/],
  ['zh missing marker', f => f.addZh(ZH.replace('<!-- translation-source: guide.md -->\n', '')), /marker/],
  ['zh missing backlink', f => f.addZh(ZH.replace('[English](guide.md)', 'English')), /backlink/],
  ['zh changed code', f => f.addZh(ZH.replace('x = 1', 'x = 2')), /code blocks/],
  ['zh dropped heading', f => f.addZh(ZH.replace('# 指南\n', '')), /heading-level/],
  ['missing ordinary backlink', f => f.rewrite('ko', KO.replace('[Original](guide.md)', 'Original')), /backlink/],
  ['missing provenance marker', f => f.rewrite('ko', KO.replace('<!-- translation-source: guide.md -->', '')), /marker/],
  ['changed executable fence', f => f.rewrite('ko', KO.replace('x = 1', 'x = 2')), /code blocks/],
  ['literate code differs between translations', f => {
    const en = '# Lesson\n```ghost\nlet x = 1\n```\n';
    const ko = '<!-- translation-source: lesson.ghost.en.md -->\n[영문 원문](lesson.ghost.en.md)\n# 수업\n```ghost\nlet x = 2\n```\n';
    for (const file of ['lesson.ghost.md', 'lesson.ghost.en.md']) f.files.push(file);
    f.write('lesson.ghost.md', ko); f.write('lesson.ghost.en.md', en);
    f.manifest.documents.push({ document: 'lesson.ghost.md', baseLanguage: 'ko', canonical: 'en', files: {
      en: { path: 'lesson.ghost.en.md', sha256: sha(en) },
      ko: { path: 'lesson.ghost.md', sha256: sha(ko), from: 'en', sourceSha256: sha(en) },
    } });
  }, /code blocks/],
  ['changed front matter', f => {
    const source = '---\nprofile: a@1\n---\n' + SOURCE, translation = '---\nprofile: b@1\n---\n' + KO;
    f.rewrite('en', source); f.rewrite('ko', translation); f.manifest.documents[0].files.ko.sourceSha256 = sha(source);
  }, /front matter/],
  ['marker pointing at another file', f => f.rewrite('ko', KO.replace('<!-- translation-source: guide.md -->', '<!-- translation-source: other.md -->')), /marker.*points to other\.md/],
  ['canonical language outside en/ko', f => { f.addZh(); f.manifest.documents[0].canonical = 'zh'; }, /invalid canonical language/],
]) test(`rejects ${name}`, t => {
  const f = fixture(t); mutate(f);
  assert.throws(() => checkTranslations(f.root, f.manifest, f.files), pattern);
});

test('Korean literate original keeps canonical status; zh chains from the English projection', t => {
  const f = fixture(t);
  const ko = '# 수업\n```ghost\nlet x = 1\n```\n';
  const en = '<!-- translation-source: lesson.ghost.md -->\n[Original](/lesson.ghost.md)\n# Lesson\n```ghost\nlet x = 1\n```\n';
  const zh = '<!-- translation-source: lesson.ghost.en.md -->\n[English](lesson.ghost.en.md)\n# 课程\n```ghost\nlet x = 1\n```\n';
  f.write('lesson.ghost.md', ko); f.write('lesson.ghost.en.md', en); f.write('lesson.ghost.zh.md', zh);
  f.manifest.documents = [{ document: 'lesson.ghost.md', baseLanguage: 'ko', canonical: 'ko', files: {
    en: { path: 'lesson.ghost.en.md', sha256: sha(en), from: 'ko', sourceSha256: sha(ko) },
    ko: { path: 'lesson.ghost.md', sha256: sha(ko) },
    zh: { path: 'lesson.ghost.zh.md', sha256: sha(zh), from: 'en', sourceSha256: sha(en) },
  } }];
  assert.equal(checkTranslations(f.root, f.manifest, ['lesson.ghost.md', 'lesson.ghost.en.md', 'lesson.ghost.zh.md']).translations, 2);
});

for (const [name, section, pattern] of [
  ['omitted prose section', '', /heading-level sequence/],
  ['changed heading level', '### 사용\n<a id="q01"></a>\n설명\n', /heading-level sequence/],
  ['missing explicit anchor', '## 사용\n설명\n', /anchor IDs/],
  ['renamed explicit anchor', '## 사용\n<a id="q02"></a>\n설명\n', /anchor IDs/],
  ['localized heading and preserved anchor', "## 사용\n<a id='q01'></a>\n설명\n", null],
]) test(name, t => {
  const f = fixture(t);
  const source = SOURCE + '## Usage\n<a id="q01"></a>\nExplanation\n';
  f.rewrite('en', source); f.rewrite('ko', KO + section);
  f.manifest.documents[0].files.ko.sourceSha256 = sha(source);
  if (pattern) assert.throws(() => checkTranslations(f.root, f.manifest, f.files), pattern);
  else assert.equal(checkTranslations(f.root, f.manifest, f.files).documents, 1);
});

test('v1 migration preserves digests and does not bless stale files', t => {
  const f = fixture(t);
  const v1 = { format: 'GhostFlow/document-translations-v1', documents: [{
    source: 'guide.md', sourceLanguage: 'en', translation: 'guide.ko.md', sourceSha256: sha(SOURCE), translationSha256: sha(KO),
  }], exclusions: [{ path: 'report.md', reason: 'Evidence' }] };
  const migrated = migrateV1(v1);
  assert.deepEqual(migrated.documents, f.manifest.documents);
  assert.deepEqual(migrated.exclusions, v1.exclusions);
  v1.documents[0].translationSha256 = 'f'.repeat(64);
  assert.throws(() => checkTranslations(f.root, { ...migrateV1(v1), exclusions: [] }, f.files), /stale translation digest/);
});

test('stamping is explicit, per language, validated and supports a canonical flip to English', t => {
  const f = fixture(t);
  const korean = { format: FORMAT, exclusions: [], documents: [] };
  const ko = '# 안내\n본문\n';
  const en = '<!-- translation-source: lesson.md -->\n[Original](lesson.md)\n# Guide\nBody\n';
  f.write('lesson.md', ko); f.write('lesson.en.md', en);
  let { manifest } = stampDocument(f.root, korean, 'lesson.md', { baseLanguage: 'ko', languages: ['ko', 'en'] });
  assert.deepEqual(Object.keys(manifest.documents[0].files), ['en', 'ko']);
  assert.equal(manifest.documents[0].files.en.from, 'ko');

  // Editing the canonical file without restamping translations is rejected.
  f.write('lesson.md', ko + '추가\n');
  assert.throws(() => stampDocument(f.root, manifest, 'lesson.md', { languages: ['ko'] }), /stale translation source digest/);
  f.write('lesson.md', ko);

  // Flip to English canonical: move the marker to the Korean file and add zh from English.
  const enCanonical = '# Guide\nBody\n';
  const koTranslation = '<!-- translation-source: lesson.en.md -->\n[English](lesson.en.md)\n# 안내\n본문\n';
  const zh = '<!-- translation-source: lesson.en.md -->\n[English](lesson.en.md)\n# 指南\n正文\n';
  f.write('lesson.en.md', enCanonical); f.write('lesson.md', koTranslation); f.write('lesson.zh.md', zh);
  assert.throws(() => stampDocument(f.root, manifest, 'lesson.en.md', { canonical: 'en', languages: ['en', 'zh'] }), /also stamp: ko/);
  ({ manifest } = stampDocument(f.root, manifest, 'lesson.en.md', { canonical: 'en', all: true }));
  const entry = manifest.documents[0];
  assert.equal(entry.canonical, 'en');
  assert.deepEqual(entry.files.en, { path: 'lesson.en.md', sha256: sha(enCanonical) });
  assert.deepEqual(entry.files.ko, { path: 'lesson.md', sha256: sha(koTranslation), from: 'en', sourceSha256: sha(enCanonical) });
  assert.equal(entry.files.zh.from, 'en');
  assert.equal(checkTranslations(f.root, { ...manifest, documents: [entry] }, ['lesson.en.md', 'lesson.md', 'lesson.zh.md']).translations, 2);

  // A broken translation is never stamped.
  f.write('lesson.ja.md', '# ガイド\n');
  assert.throws(() => stampDocument(f.root, manifest, 'lesson.md', { languages: ['ja'] }), /marker/);
  assert.throws(() => stampDocument(f.root, manifest, 'missing.md', { languages: ['en'] }), /base-language/);
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

test('Korean-original document flipped to English canonical with zh/es/ja from English', t => {
  const f = fixture(t);
  const en = '# Pump\n\nSee [usage](#usage).\n\n## Usage\n<a id="u1"></a>\n```ghost\nlet x = 1\n```\n';
  const ko = '<!-- translation-source: pump.en.md -->\n[영문 원문](pump.en.md)\n\n# 펌프\n\n[사용법](#사용법)을 보세요.\n\n## 사용법\n<a id="u1"></a>\n```ghost\nlet x = 1\n```\n';
  const translated = label => `<!-- translation-source: pump.en.md -->\n[${label}](pump.en.md)\n\n# P\n\n[x](#translated-slug).\n\n## U\n<a id="u1"></a>\n\`\`\`ghost\nlet x = 1\n\`\`\`\n`;
  const files = { 'pump.en.md': en, 'pump.md': ko, 'pump.zh.md': translated('英文原文'), 'pump.es.md': translated('Original en inglés'), 'pump.ja.md': translated('英語の原文') };
  for (const [file, text] of Object.entries(files)) f.write(file, text);
  const entry = { document: 'pump.md', baseLanguage: 'ko', canonical: 'en', files: { en: { path: 'pump.en.md', sha256: sha(en) } } };
  for (const [language, file] of [['ko', 'pump.md'], ['zh', 'pump.zh.md'], ['es', 'pump.es.md'], ['ja', 'pump.ja.md']]) {
    entry.files[language] = { path: file, sha256: sha(files[file]), from: 'en', sourceSha256: sha(en) };
  }
  assert.deepEqual(checkTranslations(f.root, { format: FORMAT, documents: [entry], exclusions: [] }, Object.keys(files)), { documents: 1, translations: 4, exclusions: 0 });
});

test('literate source with front matter: Korean compile input carries the marker after its front matter', t => {
  const f = fixture(t);
  const fm = '---\nprofile: ess3h32@1\ndevices:\n  relay: { profile: r@1 }\n---\n';
  const en = '[Korean compile input](relay.ghost.md)\n\n' + fm + '\n# Relay\n```ghost\nlet x = 1\n```\n';
  const ko = fm + '<!-- translation-source: relay.ghost.en.md -->\n[영문 원문](relay.ghost.en.md)\n\n# 릴레이\n```ghost\nlet x = 1\n```\n';
  const zh = '<!-- translation-source: relay.ghost.en.md -->\n[英文原文](relay.ghost.en.md)\n\n' + fm + '\n# 继电器\n```ghost\nlet x = 1\n```\n';
  const files = { 'relay.ghost.md': ko, 'relay.ghost.en.md': en, 'relay.ghost.zh.md': zh };
  for (const [file, text] of Object.entries(files)) f.write(file, text);
  const entry = { document: 'relay.ghost.md', baseLanguage: 'ko', canonical: 'en', files: {
    en: { path: 'relay.ghost.en.md', sha256: sha(en) },
    ko: { path: 'relay.ghost.md', sha256: sha(ko), from: 'en', sourceSha256: sha(en) },
    zh: { path: 'relay.ghost.zh.md', sha256: sha(zh), from: 'en', sourceSha256: sha(en) },
  } };
  assert.equal(checkTranslations(f.root, { format: FORMAT, documents: [entry], exclusions: [] }, Object.keys(files)).translations, 2);
});

test('all problems are reported in one run', t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, 'guide.ko.md'), '변경\n');
  f.write('extra.md', '# Extra\n'); f.files.push('extra.md');
  assert.throws(() => checkTranslations(f.root, f.manifest, f.files), error => /2 documentation translation problems/.test(error.message)
    && /stale translation digest: guide\.ko\.md/.test(error.message) && /unclassified Markdown: extra\.md/.test(error.message));
});

function autoFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-auto-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => fs.writeFileSync(path.join(root, file), text);
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  // A v1-era Korean original whose English file still says "translated from Korean".
  const koOriginal = '# 안내\n```js\nconst x = 1;\n```\n';
  const enFromKo = '<!-- translation-source: lesson.md -->\n[Korean original](lesson.md)\n\n# Guide\n```js\nconst x = 1;\n```\n';
  write('lesson.md', koOriginal); write('lesson.en.md', enFromKo);
  write('guide.md', SOURCE); write('guide.ko.md', KO); write('guide.zh.md', ZH);
  const v1 = { format: 'GhostFlow/document-translations-v1', documents: [
    { source: 'lesson.md', sourceLanguage: 'ko', translation: 'lesson.en.md', sourceSha256: sha(koOriginal), translationSha256: sha(enFromKo) },
    { source: 'guide.md', sourceLanguage: 'en', translation: 'guide.ko.md', sourceSha256: sha(SOURCE), translationSha256: 'f'.repeat(64) },
  ], exclusions: [] };
  const list = () => fs.readdirSync(root).filter(file => file.endsWith('.md')).sort();
  return { root, write, read, v1, list };
}

test('auto stamp discovers every language file and its source from markers', t => {
  const f = autoFixture(t);
  f.write('policy.md', '# Policy\n'); f.write('policy.ko.md', '<!-- translation-source: policy.md -->\n[영문 원문](policy.md)\n# 정책\n');
  const { manifest, report } = autoStamp(f.root, migrateV1(f.v1), { discovered: f.list() });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.notEnglish, ['lesson.md (ko)']);
  assert.deepEqual(report.added, ['policy.md: en* ko<-en']);
  const guide = manifest.documents.find(entry => entry.document === 'guide.md');
  assert.deepEqual(Object.keys(guide.files), ['en', 'ko', 'zh']);
  assert.equal(guide.files.zh.from, 'en');
  assert.deepEqual(checkTranslations(f.root, manifest, f.list()), { documents: 3, translations: 4, exclusions: 0 });
  assert.throws(() => autoStamp(f.root, migrateV1(f.v1), { discovered: f.list(), requireEn: true }), /not English/);
});

test('auto stamp flips a retranslated Korean original to English canonical with --fix-en-markers', t => {
  const f = autoFixture(t);
  f.write('lesson.md', '<!-- translation-source: lesson.en.md -->\n[영문 원문](lesson.en.md)\n\n# 안내\n```js\nconst x = 1;\n```\n');
  f.write('lesson.ja.md', '<!-- translation-source: lesson.en.md -->\n[英語の原文](lesson.en.md)\n\n# ガイド\n```js\nconst x = 1;\n```\n');
  const before = f.read('lesson.md');
  assert.throws(() => autoStamp(f.root, migrateV1(f.v1), { discovered: f.list() }), /no canonical file.*--fix-en-markers/s);
  assert.equal(f.read('lesson.md'), before);
  const { manifest, report } = autoStamp(f.root, migrateV1(f.v1), { discovered: f.list(), fixEnMarkers: true });
  assert.deepEqual(report.fixed, [{ file: 'lesson.en.md', removed: ['<!-- translation-source: lesson.md -->', '[Korean original](lesson.md)'] }]);
  assert.equal(f.read('lesson.en.md'), '# Guide\n```js\nconst x = 1;\n```\n');
  const lesson = manifest.documents.find(entry => entry.document === 'lesson.md');
  assert.equal(lesson.canonical, 'en');
  assert.deepEqual(Object.fromEntries(Object.entries(lesson.files).map(([language, file]) => [language, file.from ?? '*'])), { en: '*', ko: 'en', ja: 'en' });
  assert.equal(checkTranslations(f.root, manifest, f.list()).documents, 2);
});

test('auto stamp --flip-ko mechanically flips a Korean original; literate sources need --flip-literate', t => {
  const f = autoFixture(t);
  const fm = '---\nprofile: p@1\n---\n';
  const lit = fm + '# 수업\n```ghost\nlet x = 1\n```\n';
  const litEn = '<!-- translation-source: x.ghost.md -->\n[Korean original](x.ghost.md)\n\n' + fm + '# Lesson\n```ghost\nlet x = 1\n```\n';
  f.write('x.ghost.md', lit); f.write('x.ghost.en.md', litEn);
  const v1 = structuredClone(f.v1);
  v1.documents.push({ source: 'x.ghost.md', sourceLanguage: 'ko', translation: 'x.ghost.en.md', sourceSha256: sha(lit), translationSha256: sha(litEn) });
  let { manifest } = autoStamp(f.root, migrateV1(v1), { discovered: f.list(), flipKo: true });
  assert.equal(manifest.documents.find(entry => entry.document === 'lesson.md').canonical, 'en');
  assert.equal(manifest.documents.find(entry => entry.document === 'x.ghost.md').canonical, 'ko');
  assert.match(f.read('lesson.md'), /^<!-- translation-source: lesson\.en\.md -->\n\[영문 원문\]\(lesson\.en\.md\)\n\n# 안내/);
  ({ manifest } = autoStamp(f.root, manifest, { discovered: f.list(), flipKo: true, flipLiterate: true }));
  assert.equal(manifest.documents.find(entry => entry.document === 'x.ghost.md').canonical, 'en');
  assert.ok(f.read('x.ghost.md').startsWith(fm + '<!-- translation-source: x.ghost.en.md -->\n'));
  assert.ok(f.read('x.ghost.en.md').startsWith('[Korean original](x.ghost.md)\n\n' + fm));
  assert.equal(checkTranslations(f.root, manifest, f.list()).documents, 3);
});

test('CLI checks and stamps a manifest copy without touching docs/translations.json', t => {
  const f = autoFixture(t);
  const tool = name => path.join(process.cwd(), 'tools', name);
  const v1Path = path.join(f.root, 'v1.json'), v2Path = path.join(f.root, 'v2.json');
  fs.writeFileSync(v1Path, JSON.stringify(f.v1));
  const run = (name, args) => spawnSync(process.execPath, [tool(name), ...args], { encoding: 'utf8' });
  let result = run('stamp-doc-translations.mjs', ['--migrate-v1', '--manifest', v1Path, '--out', v2Path]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(v2Path, 'utf8')).format, FORMAT);
  assert.equal(JSON.parse(fs.readFileSync(v1Path, 'utf8')).format, 'GhostFlow/document-translations-v1');
  result = run('check-doc-translations.mjs', ['--manifest', v2Path, '--coverage']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Documents: 2/);
  execFileSync('git', ['init', '-q'], { cwd: f.root });
  result = run('stamp-doc-translations.mjs', ['--auto', '--dry-run', '--root', f.root, '--manifest', v2Path]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /warning: canonical file is not English: lesson\.md \(ko\)/);
  assert.match(result.stdout, /Auto-stamped 2 document\(s\).*0 error\(s\)/);
  assert.match(result.stdout, /dry run, not written/);
  result = run('stamp-doc-translations.mjs', ['--auto', '--root', f.root, '--manifest', v2Path]);
  assert.equal(result.status, 0, result.stderr);
  result = run('check-doc-translations.mjs', ['--root', f.root, '--manifest', v2Path]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS \(2 documents, 3 translations, 0 exclusions\)/);
});

// Live gate: the only test that reads the repository manifest. It fails until
// docs/translations.json is migrated to v2 and every document is stamped.
test('live repository: docs/translations.json passes the translation gate', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/translations.json'), 'utf8'));
  assert.ok(checkTranslations(root, manifest).documents > 0);
});
