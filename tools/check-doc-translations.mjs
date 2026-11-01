#!/usr/bin/env node
// Documentation translation gate: GhostFlow/document-translations-v2.
// One canonical file per document plus translations in en/ko/zh/es/ja.
//
//   node tools/check-doc-translations.mjs [--manifest PATH] [--root DIR]
//   node tools/check-doc-translations.mjs --coverage [--missing] [--manifest PATH]
//
// --manifest checks another manifest file (for example a dry-run copy) against
// the repository files.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Parser } from 'commonmark';

export const FORMAT = 'GhostFlow/document-translations-v2';
export const LANGUAGES = Object.freeze(['en', 'ko', 'zh', 'es', 'ja']);
// Rollout floor: every authored document keeps at least its en/ko pair.
export const REQUIRED_LANGUAGES = Object.freeze(['en', 'ko']);
export const BASE_LANGUAGES = Object.freeze(['en', 'ko']);
const LANGUAGE_SUFFIX = new RegExp(`\\.(?:${LANGUAGES.join('|')})\\.md$`);
const HASH = /^[a-f0-9]{64}$/;

export const MANIFEST = 'docs/translations.json';
export const sha256 = text => createHash('sha256').update(text).digest('hex');

export function discoverMarkdown(root) {
  return [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(file => /\.md$/i.test(file) && !file.split('/').includes('.git')))].sort();
}

export function languagePath(document, baseLanguage, language) {
  return language === baseLanguage ? document : document.replace(/\.md$/, `.${language}.md`);
}

// Default translation source: English translates the canonical file; every
// other translation is made from English.
export function defaultFrom(language, canonical) {
  if (language === canonical) return undefined;
  return language === 'en' ? canonical : 'en';
}

const MARKER = /^<!-- translation-source: (\S+) -->[ \t]*(?:\r?\n|$)/;
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const LINK_LINE = /^\[[^\]\n]*\]\([^)\s]+\)[ \t]*(?:\r?\n|$)/;

// Splits a file into its translation header and YAML front matter. The marker
// is either the first content or follows front matter that opens the file;
// front matter may also follow the marker and/or an optional link-only line.
export function documentHeader(text) {
  let rest = text.replace(/^\uFEFF/, ''), marker, frontMatter = null;
  const take = pattern => { const match = pattern.exec(rest); if (match) rest = rest.slice(match[0].length); return match; };
  const opening = FRONT_MATTER.exec(rest);
  if (opening) { frontMatter = opening[0]; rest = rest.slice(opening[0].length); }
  rest = rest.replace(/^\s+/, '');
  const found = take(MARKER);
  if (found) marker = found[1];
  if (frontMatter === null) {
    const before = rest;
    rest = rest.replace(/^\s+/, '');
    take(LINK_LINE);
    rest = rest.replace(/^\s+/, '');
    const late = FRONT_MATTER.exec(rest);
    if (late) frontMatter = late[0];
    else rest = before;
  }
  return { marker, frontMatter };
}

function stripFrontMatter(text, frontMatter) {
  if (frontMatter === null) return text;
  const at = text.indexOf(frontMatter);
  return text.slice(0, at) + text.slice(at + frontMatter.length);
}

function markdown(text) {
  const header = documentHeader(text);
  const walker = new Parser().parse(stripFrontMatter(text, header.frontMatter)).walker();
  const links = [], code = [], headings = [], anchors = [];
  let event;
  while ((event = walker.next())) {
    if (!event.entering) continue;
    const node = event.node;
    if (node.type === 'link') links.push(node.destination);
    if (node.type === 'heading') headings.push(node.level);
    if (node.type === 'html_inline' || node.type === 'html_block') {
      const html = node.literal.replace(/<!--[\s\S]*?-->/g, '');
      for (const tag of html.matchAll(/<[A-Za-z][^>]*>/g)) {
        const id = /\s+id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[0]);
        if (id) anchors.push(id[1] ?? id[2] ?? id[3]);
      }
    }
    if (node.type === 'code_block' && !['text', 'mermaid', 'plantuml'].includes((node.info || '').trim().split(/\s/)[0])) {
      code.push([node.info || '', node.literal]);
    }
  }
  return { links, code, headings, anchors: anchors.sort(), marker: header.marker, frontMatter: header.frontMatter };
}

const fail = message => { throw new Error(message); };

function safePath(file) {
  if (typeof file !== 'string' || !file.endsWith('.md') || file.includes('\\') || path.posix.isAbsolute(file)
    || file.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')) fail(`unsafe Markdown path: ${file}`);
}

export function readMarkdown(root, file) {
  safePath(file);
  const repository = fs.realpathSync(root);
  if (!fs.existsSync(path.join(root, file))) fail(`missing or undiscovered Markdown: ${file}`);
  const actual = fs.realpathSync(path.join(root, file));
  if (!actual.startsWith(repository + path.sep) || !fs.statSync(actual).isFile()) fail(`unsafe Markdown file: ${file}`);
  const text = fs.readFileSync(actual, 'utf8');
  if (!text.trim()) fail(`empty Markdown: ${file}`);
  return text;
}

function hasBacklink(links, from, to) {
  return links.some(destination => {
    try {
      const link = decodeURIComponent(destination.split('#')[0]);
      if (!link || /^[a-z][a-z\d+.-]*:/i.test(link) || link.startsWith('//')) return false;
      return path.posix.normalize(link.startsWith('/') ? link.slice(1) : path.posix.join(path.posix.dirname(from), link)) === to;
    } catch { return false; }
  });
}

// Validates one manifest document entry against files on disk and returns the
// repository paths it covers.
export function checkDocument(root, entry) {
  if (!entry || typeof entry !== 'object') fail('invalid document entry');
  if (Object.keys(entry).sort().join(',') !== 'baseLanguage,canonical,document,files') fail(`invalid document fields: ${entry.document}`);
  const { document, baseLanguage, canonical, files } = entry;
  safePath(document);
  if (LANGUAGE_SUFFIX.test(document)) fail(`document must be the unsuffixed path: ${document}`);
  if (!BASE_LANGUAGES.includes(baseLanguage)) fail(`invalid base language: ${document}`);
  if (!files || typeof files !== 'object' || Array.isArray(files)) fail(`invalid files: ${document}`);
  for (const language of Object.keys(files)) if (!LANGUAGES.includes(language)) fail(`unsupported language ${language}: ${document}`);
  for (const language of REQUIRED_LANGUAGES) if (!files[language]) fail(`missing required ${language} file: ${document}`);
  if (!files[baseLanguage]) fail(`missing base language file: ${document}`);
  if (!BASE_LANGUAGES.includes(canonical) || !files[canonical]) fail(`invalid canonical language: ${document}`);
  // A literate NAME.ghost.md stays the only compile input whichever file is
  // canonical for prose; its code is compared across every language below.

  const texts = {}, parsed = {}, paths = [];
  for (const [language, file] of Object.entries(files)) {
    if (!file || typeof file !== 'object') fail(`invalid ${language} file: ${document}`);
    const expected = languagePath(document, baseLanguage, language);
    if (file.path !== expected) fail(`invalid counterpart suffix: ${file.path} (expected ${expected})`);
    texts[language] = readMarkdown(root, file.path);
    parsed[language] = markdown(texts[language]);
    paths.push(file.path);
  }
  for (const [language, file] of Object.entries(files)) {
    const keys = Object.keys(file).sort().join(',');
    if (language === canonical) {
      if (keys !== 'path,sha256') fail(`canonical file must record only path and sha256: ${file.path}`);
    } else if (keys !== 'from,path,sha256,sourceSha256') fail(`translation must record path, sha256, from and sourceSha256: ${file.path}`);
    if (!HASH.test(file.sha256 || '') || sha256(texts[language]) !== file.sha256) {
      fail(`stale ${language === canonical ? 'source' : 'translation'} digest: ${file.path}`);
    }
    if (language === canonical) {
      if (parsed[language].marker !== undefined) fail(`canonical file carries a translation-source marker: ${file.path}`);
      continue;
    }
    const from = file.from;
    if (from === language || !files[from]) fail(`invalid translation source language ${from}: ${file.path}`);
    if (from !== canonical && from !== 'en') fail(`translations must be made from the canonical or English file: ${file.path}`);
    if (['zh', 'es', 'ja'].includes(language) && from !== 'en') fail(`${language} must be translated from English: ${file.path}`);
    const source = files[from];
    if (!HASH.test(file.sourceSha256 || '') || file.sourceSha256 !== sha256(texts[from])) fail(`stale translation source digest: ${file.path} (from ${source.path})`);
    if (parsed[language].marker !== source.path) fail(`missing translation-source marker: ${file.path}${parsed[language].marker ? ` (points to ${parsed[language].marker})` : ''}`);
    if (!hasBacklink(parsed[language].links, file.path, source.path)) fail(`missing source backlink: ${file.path}`);
    if (JSON.stringify(parsed[from].code) !== JSON.stringify(parsed[language].code)) fail(`changed executable code blocks: ${file.path}`);
    if (JSON.stringify(parsed[from].headings) !== JSON.stringify(parsed[language].headings)) fail(`changed heading-level sequence: ${file.path}`);
    if (JSON.stringify(parsed[from].anchors) !== JSON.stringify(parsed[language].anchors)) fail(`changed explicit HTML anchor IDs: ${file.path}`);
    if (parsed[from].frontMatter !== parsed[language].frontMatter) fail(`changed front matter: ${file.path}`);
    // Links are not compared: translations may use translated implicit heading
    // slugs and same-language targets.
  }
  // Literate sources: every language carries exactly the compiled code.
  if (document.endsWith('.ghost.md')) {
    const reference = JSON.stringify(parsed[baseLanguage].code);
    for (const [language, file] of Object.entries(files)) {
      if (JSON.stringify(parsed[language].code) !== reference) fail(`changed executable code blocks: ${file.path} (literate code must match ${files[baseLanguage].path})`);
    }
  }
  return paths;
}

export function checkTranslations(root, manifest, files = discoverMarkdown(root)) {
  if (manifest?.format === 'GhostFlow/document-translations-v1') fail('invalid translation manifest: GhostFlow/document-translations-v1 must be migrated with node tools/stamp-doc-translations.mjs --migrate-v1');
  if (manifest?.format !== FORMAT || !Array.isArray(manifest.documents) || !Array.isArray(manifest.exclusions)
    || Object.keys(manifest).sort().join(',') !== 'documents,exclusions,format') fail('invalid translation manifest');
  const discovered = new Set(files), classified = new Set(), errors = [];
  // Every problem is collected so one run reports all of them.
  const collect = action => { try { return action(); } catch (error) { errors.push(error.message); return undefined; } };
  const claim = file => {
    safePath(file);
    if (classified.has(file)) fail(`duplicate classification: ${file}`);
    classified.add(file);
    if (!discovered.has(file)) fail(`missing or undiscovered Markdown: ${file}`);
  };
  let translations = 0;
  for (const entry of manifest.documents) {
    const paths = collect(() => checkDocument(root, entry));
    for (const file of paths ?? Object.values(entry?.files ?? {}).map(item => item?.path).filter(item => typeof item === 'string')) collect(() => claim(file));
    if (paths) translations += Object.keys(entry.files).length - 1;
  }
  for (const exclusion of manifest.exclusions) {
    collect(() => {
      if (!exclusion || typeof exclusion.reason !== 'string' || !exclusion.reason.trim()) fail('exclusion requires a human-readable reason');
      claim(exclusion.path);
      readMarkdown(root, exclusion.path);
    });
  }
  for (const file of discovered) if (!classified.has(file)) errors.push(`unclassified Markdown: ${file}`);
  if (errors.length) fail(errors.length === 1 ? errors[0] : `${errors.length} documentation translation problems:\n${errors.join('\n')}`);
  return { documents: manifest.documents.length, translations, exclusions: manifest.exclusions.length };
}

export function coverage(manifest) {
  const present = Object.fromEntries(LANGUAGES.map(language => [language, 0]));
  const canonical = Object.fromEntries(LANGUAGES.map(language => [language, 0]));
  const missing = Object.fromEntries(LANGUAGES.map(language => [language, []]));
  for (const entry of manifest.documents) {
    canonical[entry.canonical] += 1;
    for (const language of LANGUAGES) {
      if (entry.files[language]) present[language] += 1;
      else missing[language].push(entry.document);
    }
  }
  return { documents: manifest.documents.length, present, canonical, missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    const option = name => { const at = argv.indexOf(name); if (at < 0) return undefined; if (!argv[at + 1]) throw new Error(`${name} needs a value`); return argv[at + 1]; };
    const root = path.resolve(option('--root') ?? fileURLToPath(new URL('../', import.meta.url)));
    const manifestPath = path.resolve(root, option('--manifest') ?? MANIFEST);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (process.argv.includes('--coverage')) {
      const report = coverage(manifest);
      console.log(`Documents: ${report.documents}`);
      for (const language of LANGUAGES) {
        console.log(`${language}: ${report.present[language]} present, ${report.canonical[language]} canonical, ${report.missing[language].length} missing`);
      }
      if (process.argv.includes('--missing')) {
        for (const language of LANGUAGES) for (const document of report.missing[language]) console.log(`missing ${language}: ${document}`);
      }
    } else {
      const result = checkTranslations(root, manifest);
      console.log(`Documentation translations: PASS (${result.documents} documents, ${result.translations} translations, ${result.exclusions} exclusions)`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
