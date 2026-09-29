#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PROGRAMMING_BOOK_IMPORT_REVISION = '7e135b93ea4c4988d305f992db277a6d8581a271';
export const PROGRAMMING_BOOK_DOCUMENT = 'docs/ProgrammingInGhostflow.md';
export const PROGRAMMING_BOOK_IMPORT_DIRECTORY = 'examples/programming-book-imports';

const reviewed = Object.freeze({
  E19: 'ef80061222c5c671b8b78d8fae733b543e51149c7e5d2c7d5e2bb2cc41fbdb30',
  E20: 'bbf57007c5973684660747c515bb2534124d50341647b2282bd2ca32852a724b',
  E21: 'd461a2a0f722271a172ce4c3d66665dad8f3a58a54079712e4bd3adb55f003a0',
});
const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = text => createHash('sha256').update(text).digest('hex');

function repositoryPath(value) {
  return value instanceof URL ? fileURLToPath(value) : path.resolve(value);
}

function section(document, id) {
  const marker = `### ${id} —`;
  const start = document.indexOf(marker);
  if (start < 0 || document.indexOf(marker, start + marker.length) >= 0) throw new Error(`${id} canonical section must occur exactly once`);
  const end = document.indexOf('\n### ', start + marker.length);
  if (end < 0) throw new Error(`${id} canonical section requires a following example boundary`);
  return document.slice(start, end);
}

export function deriveProgrammingBookImportPackage(document) {
  if (typeof document !== 'string') throw new TypeError('Programming in GhostFlow document must be text');
  const files = new Map(['E19', 'E20', 'E21', 'E22', 'E31'].map(id => [`${id}.ghost.md`, section(document, id)]));
  for (const [id, expected] of Object.entries(reviewed)) {
    const actual = sha256(files.get(`${id}.ghost.md`));
    if (actual !== expected) throw new Error(`${id} reviewed canonical section changed: expected ${expected}, actual ${actual}`);
  }
  const canonicalSource = example => ({ path: PROGRAMMING_BOOK_DOCUMENT, example });
  const source = example => ({
    filename: `${example}.ghost.md`,
    revision: PROGRAMMING_BOOK_IMPORT_REVISION,
    sha256: sha256(files.get(`${example}.ghost.md`)),
    canonicalSource: canonicalSource(example),
  });
  const manifest = {
    format: 'GhostFlow/programming-book-import-package-v1',
    root: {
      filename: 'E22.ghost.md',
      sha256: sha256(files.get('E22.ghost.md')),
      canonicalSource: canonicalSource('E22'),
    },
    imports: ['E19', 'E20'].map(example => ({
      filename: `${example}.ghost.md`,
      revision: PROGRAMMING_BOOK_IMPORT_REVISION,
      sha256: sha256(files.get(`${example}.ghost.md`)),
      canonicalSource: canonicalSource(example),
    })),
    compositions: [{
      root: {
        filename: 'E31.ghost.md',
        sha256: sha256(files.get('E31.ghost.md')),
        canonicalSource: canonicalSource('E31'),
      },
      imports: ['E21', 'E20'].map(source),
    }],
  };
  return { manifest, files };
}

export function verifyProgrammingBookImportPackage({ repositoryRoot = root } = {}) {
  const base = repositoryPath(repositoryRoot);
  const document = fs.readFileSync(path.join(base, PROGRAMMING_BOOK_DOCUMENT), 'utf8');
  const expected = deriveProgrammingBookImportPackage(document);
  const directory = path.join(base, PROGRAMMING_BOOK_IMPORT_DIRECTORY);
  const actualManifest = fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8');
  const expectedManifest = `${JSON.stringify(expected.manifest, null, 2)}\n`;
  if (actualManifest !== expectedManifest) throw new Error('stale Programming in GhostFlow import package manifest; run npm run generate:pig-imports');
  for (const [filename, text] of expected.files) {
    if (fs.readFileSync(path.join(directory, filename), 'utf8') !== text) {
      throw new Error(`stale generated Programming in GhostFlow import source ${filename}; run npm run generate:pig-imports`);
    }
  }
  return expected;
}

export function writeProgrammingBookImportPackage({ repositoryRoot = root } = {}) {
  const base = repositoryPath(repositoryRoot);
  const document = fs.readFileSync(path.join(base, PROGRAMMING_BOOK_DOCUMENT), 'utf8');
  const derived = deriveProgrammingBookImportPackage(document);
  const directory = path.join(base, PROGRAMMING_BOOK_IMPORT_DIRECTORY);
  fs.mkdirSync(directory, { recursive: true });
  for (const [filename, text] of derived.files) fs.writeFileSync(path.join(directory, filename), text);
  fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(derived.manifest, null, 2)}\n`);
  return derived;
}

function main() {
  const option = process.argv[2] ?? '--check';
  if (process.argv.length > 3 || !['--check', '--write'].includes(option)) throw new Error('usage: node tools/generate-programming-book-import-package.mjs [--check|--write]');
  const result = option === '--write' ? writeProgrammingBookImportPackage() : verifyProgrammingBookImportPackage();
  console.log(`PIG import package: ${option === '--write' ? 'WROTE' : 'PASS'} ${result.manifest.root.sha256}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
