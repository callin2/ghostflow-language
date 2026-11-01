#!/usr/bin/env node
// Deliberate digest stamping for docs/translations.json (GhostFlow/document-translations-v2).
//
//   npm run docs:stamp -- DOCUMENT --languages en,ko,zh   stamp the listed languages
//   npm run docs:stamp -- DOCUMENT --all                  stamp every language file on disk
//   npm run docs:stamp -- DOCUMENT --canonical en --all   make English the canonical source
//   npm run docs:stamp -- NEW.md --base-language en --languages en,ko   add a new document
//   npm run docs:stamp -- --migrate-v1                    one-time v1 -> v2 conversion
//   npm run docs:stamp -- --auto                          stamp every document's full language set
//
// --auto reads the translation-source marker of every language file of every
// manifest document (and of unclassified documents that have a language
// sibling) to find each file's source language and the one canonical file, then
// stamps all files on disk. Options for --auto:
//   --fix-en-markers  when a Korean-base document's NAME.md and NAME.en.md point
//                     at each other, make English canonical by removing the
//                     marker (and, outside literate sources, a link-only
//                     "Korean original" line) from NAME.en.md. This edits Markdown.
//   --flip-ko         for a Korean-base document that is still Korean-canonical,
//                     make English canonical mechanically: add a marker and an
//                     English link to NAME.md (after any front matter) and
//                     remove the header of NAME.en.md. Skips *.ghost.md unless
//                     --flip-literate is also given. This edits Markdown.
//   --require-en      fail documents whose canonical file is not English
//   --partial         write the valid entries and keep invalid ones unchanged
// Common options: --dry-run (write nothing), --manifest PATH (read and write
// another manifest file), --out PATH (write the result elsewhere), --root DIR
// (resolve document paths in another checkout; the manifest defaults to
// DIR/docs/translations.json).
//
// DOCUMENT may be the unsuffixed path or any of its language files. Stamping
// records that a reviewer checked the listed files. The updated entries are
// validated before the manifest is written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FORMAT, LANGUAGES, BASE_LANGUAGES, MANIFEST, sha256, languagePath, defaultFrom, checkDocument, documentHeader, discoverMarkdown,
} from './check-doc-translations.mjs';

export function migrateV1(manifest) {
  if (manifest?.format !== 'GhostFlow/document-translations-v1') throw new Error('manifest is not GhostFlow/document-translations-v1');
  const documents = manifest.documents.map(entry => {
    const target = entry.sourceLanguage === 'en' ? 'ko' : 'en';
    const files = {
      [entry.sourceLanguage]: { path: entry.source, sha256: entry.sourceSha256 },
      [target]: { path: entry.translation, sha256: entry.translationSha256, from: entry.sourceLanguage, sourceSha256: entry.sourceSha256 },
    };
    return { document: entry.source, baseLanguage: entry.sourceLanguage, canonical: entry.sourceLanguage, files: orderFiles(files) };
  });
  return { format: FORMAT, documents, exclusions: manifest.exclusions };
}

function orderFiles(files) {
  return Object.fromEntries(LANGUAGES.filter(language => files[language]).map(language => {
    const { path: file, sha256: digest, from, sourceSha256 } = files[language];
    return [language, from === undefined ? { path: file, sha256: digest } : { path: file, sha256: digest, from, sourceSha256 }];
  }));
}

export function findEntry(manifest, target) {
  return manifest.documents.findIndex(entry => entry.document === target
    || Object.values(entry.files).some(file => file.path === target));
}

// `from` optionally maps a language to its explicit source language.
export function stampDocument(root, manifest, target, { languages, all = false, canonical, baseLanguage, from: sources = {} } = {}) {
  if (manifest?.format !== FORMAT) throw new Error(`manifest must be ${FORMAT}; run --migrate-v1 first`);
  const index = findEntry(manifest, target);
  let entry;
  if (index >= 0) {
    entry = structuredClone(manifest.documents[index]);
    if (baseLanguage && baseLanguage !== entry.baseLanguage) throw new Error('the base language of an existing document cannot change; paths stay stable');
  } else {
    if (!BASE_LANGUAGES.includes(baseLanguage)) throw new Error(`unknown document ${target}; pass --base-language en|ko to add it`);
    entry = { document: target, baseLanguage, canonical: canonical ?? baseLanguage, files: {} };
  }
  const exists = language => fs.existsSync(path.join(root, languagePath(entry.document, entry.baseLanguage, language)));
  const canonicalChanged = canonical !== undefined && canonical !== entry.canonical;
  if (canonical !== undefined) {
    if (!BASE_LANGUAGES.includes(canonical)) throw new Error(`unsupported canonical language: ${canonical}`);
    entry.canonical = canonical;
  }
  const stamp = all ? LANGUAGES.filter(exists) : [...new Set(languages ?? [])];
  if (!stamp.length) throw new Error('pass --languages LIST or --all');
  for (const language of stamp) {
    if (!LANGUAGES.includes(language)) throw new Error(`unsupported language: ${language}`);
    if (!exists(language)) throw new Error(`missing file: ${languagePath(entry.document, entry.baseLanguage, language)}`);
  }
  if (canonicalChanged) {
    const unstamped = Object.keys(entry.files).filter(language => !stamp.includes(language));
    if (unstamped.length) throw new Error(`changing the canonical language restamps every file; also stamp: ${unstamped.join(',')}`);
  }
  const text = language => fs.readFileSync(path.join(root, languagePath(entry.document, entry.baseLanguage, language)), 'utf8');
  for (const language of stamp) {
    const previous = entry.files[language];
    const file = { path: languagePath(entry.document, entry.baseLanguage, language), sha256: sha256(text(language)) };
    if (language !== entry.canonical) {
      file.from = sources[language] ?? (canonicalChanged || !previous?.from ? defaultFrom(language, entry.canonical) : previous.from);
    }
    entry.files[language] = file;
  }
  for (const language of stamp) {
    const file = entry.files[language];
    if (file.from !== undefined) {
      if (!entry.files[file.from]) throw new Error(`${language} is translated from ${file.from}, which is not recorded; stamp it too`);
      file.sourceSha256 = sha256(text(file.from));
    }
  }
  entry.files = orderFiles(entry.files);
  checkDocument(root, entry);
  const documents = [...manifest.documents];
  if (index >= 0) documents[index] = entry; else documents.push(entry);
  return { manifest: { ...manifest, documents }, entry };
}

// Reads the markers of a document's language files: returns the files on disk,
// each translation's source language and the canonical language.
export function discoverLanguages(root, document, baseLanguage) {
  const present = {}, from = {};
  for (const language of LANGUAGES) {
    const file = languagePath(document, baseLanguage, language);
    if (fs.existsSync(path.join(root, file))) present[language] = file;
  }
  const byPath = Object.fromEntries(Object.entries(present).map(([language, file]) => [file, language]));
  for (const [language, file] of Object.entries(present)) {
    const { marker } = documentHeader(fs.readFileSync(path.join(root, file), 'utf8'));
    if (marker === undefined) continue;
    if (!byPath[marker]) throw new Error(`${file}: translation-source ${marker} is not a language file of ${document}`);
    from[language] = byPath[marker];
  }
  const roots = Object.keys(present).filter(language => from[language] === undefined);
  if (roots.length === 0) {
    throw new Error(`${document}: no canonical file; every language file carries a translation-source marker${from.en && from[from.en] === 'en' ? ' (en and ko point at each other; rerun with --fix-en-markers to make English canonical)' : ''}`);
  }
  if (roots.length > 1) throw new Error(`${document}: several files lack a translation-source marker: ${roots.map(language => present[language]).join(', ')}`);
  return { present, from, canonical: roots[0] };
}

// Removes the old "translated from Korean" header from NAME.en.md: the marker
// line and, outside literate sources (whose note refers to the linked
// compilable original), a link-only line pointing at the Korean file.
function removeEnglishHeader(enText, entry) {
  const ko = entry.document;
  const lines = enText.split('\n');
  const markerAt = lines.findIndex(line => line.trim() === `<!-- translation-source: ${ko} -->`);
  if (markerAt < 0) return null;
  const removed = [lines[markerAt]];
  lines.splice(markerAt, 1);
  if (!ko.endsWith('.ghost.md')) {
    const targets = [path.posix.basename(ko), `/${ko}`, ko];
    const linkAt = lines.findIndex((line, at) => at < markerAt + 4 && /^\[[^\]]*\]\(([^)\s]+)\)\s*$/.test(line.trim())
      && targets.includes(/\(([^)\s]+)\)/.exec(line)[1].split('#')[0]));
    if (linkAt >= 0) { removed.push(lines[linkAt]); lines.splice(linkAt, 1); }
  }
  return { text: lines.join('\n').replace(/^\s*\n/, ''), removed };
}

const parseLinks = text => [...text.matchAll(/\]\(([^)\s]+)\)/g)].map(match => match[1]);
const englishFile = entry => languagePath(entry.document, 'ko', 'en');
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

// For a Korean-base document whose Korean NAME.md was retranslated from
// NAME.en.md while NAME.en.md still points back at NAME.md, makes English
// canonical by removing the stale header from NAME.en.md.
export function fixEnglishMarker(root, entry) {
  if (entry.baseLanguage !== 'ko') return null;
  const en = englishFile(entry), ko = entry.document;
  if (!fs.existsSync(path.join(root, en))) return null;
  if (documentHeader(read(root, en)).marker !== ko || documentHeader(read(root, ko)).marker !== en) return null;
  const result = removeEnglishHeader(read(root, en), entry);
  if (!result) return null;
  fs.writeFileSync(path.join(root, en), result.text);
  return { file: en, removed: result.removed };
}

// Mechanical flip for a Korean-base document that is still Korean-canonical
// (NAME.en.md translates NAME.md): NAME.md gains a marker and an English link
// (after any front matter) and NAME.en.md loses its header. Literate sources
// are flipped only when `literate` is set, because NAME.ghost.md is a compile input.
export function flipToEnglish(root, entry, { literate = false } = {}) {
  if (entry.baseLanguage !== 'ko' || (entry.document.endsWith('.ghost.md') && !literate)) return null;
  const en = englishFile(entry), ko = entry.document;
  if (!fs.existsSync(path.join(root, en))) return null;
  const koText = read(root, ko);
  const koHeader = documentHeader(koText);
  if (documentHeader(read(root, en)).marker !== ko || koHeader.marker !== undefined) return null;
  const result = removeEnglishHeader(read(root, en), entry);
  if (!result) return null;
  const linksEnglish = parseLinks(koText).some(link => [path.posix.basename(en), `./${path.posix.basename(en)}`, `/${en}`].includes(link.split('#')[0]));
  const header = `<!-- translation-source: ${en} -->\n${linksEnglish ? '' : `[영문 원문](${path.posix.basename(en)})\n`}\n`;
  const body = koText.replace(/^\uFEFF/, '');
  const opening = koHeader.frontMatter !== null && body.startsWith(koHeader.frontMatter) ? koHeader.frontMatter : '';
  const nextKo = opening ? `${opening}${header}${body.slice(opening.length).replace(/^\s*\n/, '')}` : `${header}${body.replace(/^\s*\n/, '')}`;
  fs.writeFileSync(path.join(root, en), result.text);
  fs.writeFileSync(path.join(root, ko), nextKo);
  return { file: en, removed: result.removed, added: ko };
}

// Unclassified unsuffixed Markdown that already has a language sibling becomes
// a new document; the base language follows from its siblings.
function newDocuments(root, manifest, discovered) {
  const claimed = new Set([...manifest.documents.flatMap(entry => Object.values(entry.files).map(file => file.path)), ...manifest.exclusions.map(item => item.path)]);
  const suffix = new RegExp(`\\.(?:${LANGUAGES.join('|')})\\.md$`);
  const found = [];
  for (const file of discovered) {
    if (claimed.has(file) || suffix.test(file) || !file.endsWith('.md') || manifest.documents.some(entry => entry.document === file)) continue;
    const has = language => discovered.includes(file.replace(/\.md$/, `.${language}.md`));
    if (has('en') && has('ko')) continue;
    if (has('en')) found.push({ document: file, baseLanguage: 'ko' });
    else if (['ko', 'zh', 'es', 'ja'].some(has)) found.push({ document: file, baseLanguage: 'en' });
  }
  return found;
}

export function autoStamp(root, manifest, { fixEnMarkers = false, flipKo = false, flipLiterate = false, requireEn = false, partial = false, discovered } = {}) {
  if (manifest?.format !== FORMAT) throw new Error(`manifest must be ${FORMAT}; run --migrate-v1 first`);
  let next = structuredClone(manifest);
  const report = { stamped: [], added: [], fixed: [], notEnglish: [], errors: [] };
  const additions = newDocuments(root, manifest, discovered ?? discoverMarkdown(root));
  const targets = [...manifest.documents.map(({ document, baseLanguage }) => ({ document, baseLanguage, existing: true })), ...additions];
  for (const target of targets) {
    try {
      if (fixEnMarkers) {
        const fixed = fixEnglishMarker(root, target);
        if (fixed) report.fixed.push(fixed);
      }
      if (flipKo) {
        const flipped = flipToEnglish(root, target, { literate: flipLiterate });
        if (flipped) report.fixed.push(flipped);
      }
      const { present, from, canonical } = discoverLanguages(root, target.document, target.baseLanguage);
      if (canonical !== 'en') {
        if (requireEn) throw new Error(`${target.document}: canonical file is ${present[canonical]}, not English`);
        report.notEnglish.push(`${target.document} (${canonical})`);
      }
      const result = stampDocument(root, next, target.document, {
        all: true, canonical, from, baseLanguage: target.existing ? undefined : target.baseLanguage,
      });
      next = result.manifest;
      (target.existing ? report.stamped : report.added).push(`${result.entry.document}: ${Object.entries(result.entry.files)
        .map(([language, file]) => `${language}${language === result.entry.canonical ? '*' : `<-${file.from}`}`).join(' ')}`);
    } catch (error) { report.errors.push(error.message); }
  }
  if (report.errors.length && !partial) {
    const error = new Error(`auto stamp failed for ${report.errors.length} document(s); nothing written:\n${report.errors.join('\n')}`);
    error.report = report;
    throw error;
  }
  return { manifest: next, report };
}

function parseArgs(argv) {
  const options = { positional: [] };
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    const value = () => { const next = argv[++at]; if (next === undefined) throw new Error(`${arg} needs a value`); return next; };
    if (arg === '--languages') options.languages = value().split(',').map(item => item.trim()).filter(Boolean);
    else if (arg === '--all') options.all = true;
    else if (arg === '--canonical') options.canonical = value();
    else if (arg === '--base-language') options.baseLanguage = value();
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--migrate-v1') options.migrate = true;
    else if (arg === '--auto') options.auto = true;
    else if (arg === '--fix-en-markers') options.fixEnMarkers = true;
    else if (arg === '--require-en') options.requireEn = true;
    else if (arg === '--flip-ko') options.flipKo = true;
    else if (arg === '--flip-literate') options.flipLiterate = true;
    else if (arg === '--partial') options.partial = true;
    else if (arg === '--manifest') options.manifest = value();
    else if (arg === '--out') options.out = value();
    else if (arg === '--root') options.root = value();
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else options.positional.push(arg);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const root = options.root ? path.resolve(options.root) : fileURLToPath(new URL('../', import.meta.url));
    const input = options.manifest ? path.resolve(options.manifest) : path.join(root, MANIFEST);
    const output = options.out ? path.resolve(options.out) : input;
    let next = JSON.parse(fs.readFileSync(input, 'utf8'));
    const messages = [];
    if (options.migrate) {
      // Structural conversion only; digests are copied unchanged, so docs:check
      // still reports any file that was already stale.
      next = migrateV1(next);
      messages.push(`Migrated to ${FORMAT} (${next.documents.length} documents, ${next.exclusions.length} exclusions); digests preserved`);
    }
    if (options.auto) {
      if (options.dryRun && (options.fixEnMarkers || options.flipKo)) throw new Error('--fix-en-markers and --flip-ko edit Markdown and cannot be combined with --dry-run');
      if (options.flipLiterate && !options.flipKo) throw new Error('--flip-literate requires --flip-ko');
      const result = autoStamp(root, next, options);
      next = result.manifest;
      const { report } = result;
      for (const fixed of report.fixed) messages.push(`fixed ${fixed.file}: removed ${fixed.removed.map(line => JSON.stringify(line)).join(', ')}${fixed.added ? `; added marker to ${fixed.added}` : ''}`);
      for (const line of report.added) messages.push(`added ${line}`);
      for (const line of report.notEnglish) messages.push(`warning: canonical file is not English: ${line}`);
      for (const line of report.errors) messages.push(`error: ${line}`);
      messages.push(`Auto-stamped ${report.stamped.length} document(s), added ${report.added.length}, fixed ${report.fixed.length} English marker(s), ${report.notEnglish.length} not English-canonical, ${report.errors.length} error(s)`);
    } else if (!options.migrate) {
      if (options.positional.length !== 1) throw new Error('usage: stamp-doc-translations.mjs DOCUMENT (--languages LIST | --all) [--canonical LANG] [--base-language en|ko] [--dry-run] | --auto | --migrate-v1');
      const target = options.positional[0].replace(/^\.\//, '');
      const result = stampDocument(root, next, target, options);
      next = result.manifest;
      messages.push(`Stamped ${result.entry.document}: ${Object.entries(result.entry.files)
        .map(([language, file]) => `${language}${language === result.entry.canonical ? '*' : `<-${file.from}`}`).join(' ')}`);
    }
    if (!options.dryRun) fs.writeFileSync(output, `${JSON.stringify(next, null, 2)}\n`);
    messages.push(options.dryRun ? '(dry run, not written)' : `Wrote ${path.relative(root, output) || output}`);
    console.log(messages.join('\n'));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
