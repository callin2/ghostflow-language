#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Parser } from 'commonmark';

export function discoverMarkdown(root) {
  return [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(file => /\.md$/i.test(file) && !file.split('/').includes('.git')))].sort();
}

function markdown(text) {
  const walker = new Parser().parse(text).walker();
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
  return { links, code, headings, anchors: anchors.sort() };
}

export function checkTranslations(root, manifest, files = discoverMarkdown(root)) {
  const fail = message => { throw new Error(message); };
  if (manifest?.format !== 'GhostFlow/document-translations-v1' || !Array.isArray(manifest.documents) || !Array.isArray(manifest.exclusions)) fail('invalid translation manifest');
  const discovered = new Set(files), classified = new Set();
  const repository = fs.realpathSync(root);
  function claim(file) {
    if (typeof file !== 'string' || !file.endsWith('.md') || file.includes('\\') || path.posix.isAbsolute(file)
      || file.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')) fail(`unsafe Markdown path: ${file}`);
    if (classified.has(file)) fail(`duplicate classification: ${file}`);
    classified.add(file);
    if (!discovered.has(file) || !fs.existsSync(path.join(root, file))) fail(`missing or undiscovered Markdown: ${file}`);
    const actual = fs.realpathSync(path.join(root, file));
    if (!actual.startsWith(repository + path.sep) || !fs.statSync(actual).isFile()) fail(`unsafe Markdown file: ${file}`);
    const text = fs.readFileSync(actual, 'utf8');
    if (!text.trim()) fail(`empty Markdown: ${file}`);
    return text;
  }
  for (const entry of manifest.documents) {
    if (!entry || !['en', 'ko'].includes(entry.sourceLanguage)) fail('invalid source language');
    const source = claim(entry.source), translation = claim(entry.translation);
    const targetLanguage = entry.sourceLanguage === 'en' ? 'ko' : 'en';
    if (/\.(?:en|ko)\.md$/.test(entry.source) || entry.translation !== entry.source.replace(/\.md$/, `.${targetLanguage}.md`)) fail(`invalid counterpart suffix: ${entry.translation}`);
    for (const [label, text, expected] of [['source', source, entry.sourceSha256], ['translation', translation, entry.translationSha256]]) {
      if (!/^[a-f0-9]{64}$/.test(expected || '') || createHash('sha256').update(text).digest('hex') !== expected) fail(`stale ${label} digest: ${entry[label]}`);
    }
    if (!translation.trimStart().startsWith(`<!-- translation-source: ${entry.source} -->`)) fail(`missing translation-source marker: ${entry.translation}`);
    const original = markdown(source), translated = markdown(translation);
    const hasBacklink = translated.links.some(destination => {
      try {
        const link = decodeURIComponent(destination.split('#')[0]);
        if (!link || /^[a-z][a-z\d+.-]*:/i.test(link) || link.startsWith('//')) return false;
        return path.posix.normalize(link.startsWith('/') ? link.slice(1) : path.posix.join(path.posix.dirname(entry.translation), link)) === entry.source;
      } catch { return false; }
    });
    if (!hasBacklink) fail(`missing source backlink: ${entry.translation}`);
    if (JSON.stringify(original.code) !== JSON.stringify(translated.code)) fail(`changed executable code blocks: ${entry.translation}`);
    if (JSON.stringify(original.headings) !== JSON.stringify(translated.headings)) fail(`changed heading-level sequence: ${entry.translation}`);
    if (JSON.stringify(original.anchors) !== JSON.stringify(translated.anchors)) fail(`changed explicit HTML anchor IDs: ${entry.translation}`);
  }
  for (const exclusion of manifest.exclusions) {
    if (!exclusion || typeof exclusion.reason !== 'string' || !exclusion.reason.trim()) fail('exclusion requires a human-readable reason');
    claim(exclusion.path);
  }
  for (const file of discovered) if (!classified.has(file)) fail(`unclassified Markdown: ${file}`);
  return { documents: manifest.documents.length, exclusions: manifest.exclusions.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const result = checkTranslations(root, JSON.parse(fs.readFileSync(path.join(root, 'docs/translations.json'), 'utf8')));
    console.log(`Documentation translations: PASS (${result.documents} pairs, ${result.exclusions} exclusions)`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
