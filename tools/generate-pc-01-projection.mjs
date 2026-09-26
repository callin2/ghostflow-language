#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PC01_DOCUMENT = 'docs/ProgrammingInGhostflow.md';
export const PC01_PROJECTION = 'examples/curriculum/generated/pc-01-e01.generated.ghost.md';
const CATALOG = 'examples/curriculum/catalog.json';
const REPLAY = 'examples/curriculum/replay-scenarios.json';

const root = fileURLToPath(new URL('../', import.meta.url));

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function derivePc01Projection(document, filename = PC01_DOCUMENT) {
  const anchor = '<a id="ch01"></a>';
  const start = document.indexOf(anchor);
  if (start < 0 || document.indexOf(anchor, start + anchor.length) >= 0) {
    throw new Error('PC-01 source anchor ch01 must occur exactly once');
  }
  const nextAnchor = document.indexOf('\n<a id=', start + anchor.length);
  const section = document.slice(start, nextAnchor < 0 ? document.length : nextAnchor);
  const matches = [...section.matchAll(/```ghost\r?\n(\/\/ E01\r?\n[\s\S]*?)\r?\n```/g)];
  if (matches.length !== 1) {
    throw new Error('PC-01 E01 executable source must occur exactly once within ch01');
  }
  const documentSha256 = sha256(document);
  return [
    '<!-- GENERATED FILE: do not edit. -->',
    `<!-- generator=tools/generate-pc-01-projection.mjs source=${filename}#ch01:E01 sourceSha256=${documentSha256} -->`,
    '# PC-01 — E01 executable projection',
    '',
    `This executable projection is generated from \`${filename}#ch01\` example E01.`,
    'The book remains the only canonical source.',
    '',
    '```ghost',
    matches[0][1],
    '```',
    '',
  ].join('\n');
}

export function verifyPc01Projection({ repositoryRoot = root } = {}) {
  const documentPath = path.join(repositoryRoot, PC01_DOCUMENT);
  const projectionPath = path.join(repositoryRoot, PC01_PROJECTION);
  const document = fs.readFileSync(documentPath, 'utf8');
  const expected = derivePc01Projection(document);
  const actual = fs.readFileSync(projectionPath, 'utf8');
  if (actual !== expected) {
    throw new Error(`stale generated PC-01 projection; run node tools/generate-pc-01-projection.mjs --write`);
  }
  return {
    documentSha256: sha256(document),
    projectionSha256: sha256(actual),
    projection: actual,
  };
}

export function writePc01Projection({ repositoryRoot = root } = {}) {
  const document = fs.readFileSync(path.join(repositoryRoot, PC01_DOCUMENT), 'utf8');
  const projection = derivePc01Projection(document);
  const catalogPath = path.join(repositoryRoot, CATALOG);
  const replayPath = path.join(repositoryRoot, REPLAY);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const replay = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
  const lesson = catalog.lessons.filter(entry => entry.id === 'PC-01');
  const scenario = replay.scenarios.filter(entry => entry.id === 'PC-01');
  if (lesson.length !== 1 || scenario.length !== 1
      || lesson[0].source.path !== PC01_DOCUMENT || lesson[0].source.generatedPath !== PC01_PROJECTION
      || scenario[0].source.canonicalPath !== PC01_DOCUMENT || scenario[0].source.executablePath !== PC01_PROJECTION) {
    throw new Error('PC-01 catalog and replay source paths must identify the book and its projection');
  }
  const documentSha256 = sha256(document);
  const projectionSha256 = sha256(projection);
  lesson[0].source.documentSha256 = documentSha256;
  lesson[0].source.projectionSha256 = projectionSha256;
  scenario[0].source.canonicalSha256 = documentSha256;
  scenario[0].source.executableSha256 = projectionSha256;
  const output = path.join(repositoryRoot, PC01_PROJECTION);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, projection);
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  fs.writeFileSync(replayPath, `${JSON.stringify(replay, null, 2)}\n`);
  return projectionSha256;
}

function main() {
  const option = process.argv[2] ?? '--check';
  if (process.argv.length > 3 || !['--check', '--write'].includes(option)) {
    throw new Error('usage: node tools/generate-pc-01-projection.mjs [--check|--write]');
  }
  let projectionSha256;
  if (option === '--write') {
    projectionSha256 = writePc01Projection();
  } else {
    projectionSha256 = verifyPc01Projection().projectionSha256;
  }
  console.log(`PC-01 projection: ${option === '--write' ? 'WROTE' : 'PASS'} ${PC01_PROJECTION} (${projectionSha256})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
