#!/usr/bin/env node
// Issue #357: exact-diff CI routing. Uncertain comparisons always require full verification.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const LANGUAGES = Object.freeze(['en', 'ko', 'zh', 'es', 'ja']);
const ORDINARY_DOCUMENTS = Object.freeze(['README.md', 'CONTRIBUTING.md', 'docs/DOCUMENTATION.md']);
const languagePath = (document, language) => language === 'en' ? document : document.replace(/\.md$/, `.${language}.md`);
const DOC_PATHS = new Set([
  ...ORDINARY_DOCUMENTS.flatMap(document => LANGUAGES.map(language => languagePath(document, language))),
  'INDEX.md', 'docs/INDEX.md',
  ...['hero', 'intent', 'replay', 'trace'].map(name => `docs/assets/readme-${name}.svg`),
]);
const MANIFEST = 'docs/translations.json';
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;

function ordinaryFile(document, language, file) {
  if (!file || typeof file !== 'object' || file.path !== languagePath(document, language) || !HASH.test(file.sha256)) return false;
  if (language === 'en') return isDeepStrictEqual(Object.keys(file).sort(), ['path', 'sha256']);
  return isDeepStrictEqual(Object.keys(file).sort(), ['from', 'path', 'sha256', 'sourceSha256'])
    && file.from === 'en' && HASH.test(file.sourceSha256);
}

function manifestPolicy(text) {
  const parsed = JSON.parse(text);
  if (!parsed || parsed.format !== 'GhostFlow/document-translations-v2' || !Array.isArray(parsed.documents)
    || !Array.isArray(parsed.exclusions)) throw new Error('invalid translation manifest');
  const ordinary = new Set();
  const documents = parsed.documents.filter(entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.document !== 'string' || !entry.files
      || typeof entry.files !== 'object' || Array.isArray(entry.files)) throw new Error('invalid document entry');
    const paths = Object.values(entry.files).map(file => file?.path);
    if (!ORDINARY_DOCUMENTS.includes(entry.document) && !paths.some(file => DOC_PATHS.has(file))) return true;
    if (!ORDINARY_DOCUMENTS.includes(entry.document) || ordinary.has(entry.document)
      || !isDeepStrictEqual(Object.keys(entry).sort(), ['baseLanguage', 'canonical', 'document', 'files'])
      || entry.baseLanguage !== 'en' || entry.canonical !== 'en' || !entry.files.en || !entry.files.ko
      || !Object.entries(entry.files).every(([language, file]) => LANGUAGES.includes(language) && ordinaryFile(entry.document, language, file))) {
      throw new Error('invalid ordinary document entry');
    }
    ordinary.add(entry.document);
    return false;
  });
  if (parsed.exclusions.some(entry => !entry || typeof entry.path !== 'string' || typeof entry.reason !== 'string' || !entry.reason.trim())) throw new Error('invalid exclusion');
  // All nonordinary entries and all policy metadata must remain identical.
  return { ...parsed, documents };
}

export function classifyChanges({ cwd, eventName, event, sha }) {
  if (eventName === 'workflow_dispatch') return 'full';
  try {
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    let before, after;
    if (eventName === 'pull_request') { before = event.pull_request.base.sha; after = event.pull_request.head.sha; }
    else if (eventName === 'push') { before = event.before; after = sha; }
    else return 'full';
    if (!SHA.test(before) || !SHA.test(after)) return 'full';
    for (const commit of [before, after]) git('cat-file', '-e', `${commit}^{commit}`);
    if (eventName === 'pull_request') before = git('merge-base', before, after).trim();
    if (!SHA.test(before)) return 'full';
    const raw = git('diff', '--raw', '-z', '--no-renames', before, after, '--');
    if (!raw) return 'full';
    const fields = raw.split('\0'); fields.pop();
    if (fields.length % 2 !== 0) return 'full';
    let manifestChanged = false;
    for (let at = 0; at < fields.length; at += 2) {
      const header = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ [AMD]$/.exec(fields[at]);
      if (!header || !header.slice(1).every(mode => mode === '100644' || mode === '000000')) return 'full';
      const filename = fields[at + 1];
      if (filename === MANIFEST) manifestChanged = true;
      else if (!DOC_PATHS.has(filename)) return 'full';
    }
    if (manifestChanged && !isDeepStrictEqual(
      manifestPolicy(git('show', `${before}:${MANIFEST}`)),
      manifestPolicy(git('show', `${after}:${MANIFEST}`)),
    )) return 'full';
    return 'docs';
  } catch {
    // Missing history, malformed events/manifests and Git failures are full, never docs.
    return 'full';
  }
}

export function verificationResult(needs) {
  if (needs.classify?.result !== 'success') throw new Error('classification did not succeed');
  const mode = needs.classify.outputs?.mode;
  if (mode !== 'docs' && mode !== 'full') throw new Error('classification mode is missing or unknown');
  const selected = mode === 'docs' ? 'docs' : 'verify';
  if (needs[selected]?.result !== 'success') throw new Error(`${selected} verification did not succeed`);
  const other = needs[mode === 'docs' ? 'verify' : 'docs']?.result;
  if (other !== 'skipped' && other !== 'success') throw new Error('nonselected verification has an unexpected result');
  return mode === 'docs' ? 'Documentation checks passed; no WASM artifact was built.' : 'Full WASM verification passed.';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'classify') {
    const mode = classifyChanges({ cwd: process.cwd(), eventName: process.env.GITHUB_EVENT_NAME,
      event: JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')), sha: process.env.GITHUB_SHA });
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is missing');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\n`);
    console.log(`Verification mode: ${mode}`);
  } else if (process.argv[2] === 'result') {
    console.log(verificationResult(JSON.parse(process.env.VERIFICATION_NEEDS)));
  } else throw new Error('expected classify or result');
}
