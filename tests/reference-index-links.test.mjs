import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const referenceDir = path.join(root, 'docs/reference');

function slug(text) {
  return text.toLowerCase().replace(/`/g, '').replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/ /g, '-');
}

function readReference(file) {
  return fs.readFileSync(path.join(referenceDir, file), 'utf8');
}

function section(markdown, heading) {
  const match = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?$`, 'mu').exec(markdown);
  assert.ok(match, `missing section ${heading}`);
  const next = /^## /mu.exec(markdown.slice(match.index + match[0].length));
  return markdown.slice(match.index, next ? match.index + match[0].length + next.index : markdown.length);
}

function tableRows(markdown) {
  return markdown.split(/\r?\n/).filter(line => /^\|.+\|$/.test(line) && !/^\|[-: ]+\|$/.test(line));
}

function anchors(markdown) {
  const result = new Set();
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const delimiter = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) result.add(slug(heading[2]));
  }
  return result;
}

function links(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]);
}

test('REF-07-008: syntax and symbol index links resolve to exact Reference sections', () => {
  const chapter = readReference('07-semantic-rules-and-index.md');
  const sections = [
    section(chapter, '7.5 선언과 표기 찾아보기'),
    section(chapter, '7.6 기호 찾아보기'),
  ];
  const parsedRows = sections.flatMap(tableRows);
  assert.ok(parsedRows.length > 20, 'index tables must remain substantive');

  const errors = [];
  const cache = new Map();
  const loadAnchors = file => {
    if (!cache.has(file)) cache.set(file, anchors(readReference(file)));
    return cache.get(file);
  };

  for (const target of sections.flatMap(links)) {
    const [file, anchor, extra] = target.split('#');
    if (extra !== undefined) errors.push(`${target}: invalid multi-anchor target`);
    if (!file || file.startsWith('http') || path.basename(file) !== file) errors.push(`${target}: expected same-directory Reference chapter link`);
    if (!fs.existsSync(path.join(referenceDir, file))) {
      errors.push(`${target}: missing target file`);
      continue;
    }
    if (anchor && !loadAnchors(file).has(anchor)) errors.push(`${target}: missing target anchor`);
  }

  assert.deepEqual(errors, []);
});

test('REF-07-008: syntax index status markers do not hide parser support', () => {
  const chapter = readReference('07-semantic-rules-and-index.md');
  const syntaxRows = tableRows(section(chapter, '7.5 선언과 표기 찾아보기'));
  const unsupportedRows = syntaxRows.filter(row => /parser 미지원/.test(row));
  assert.deepEqual(unsupportedRows, [
    '| `check`, `limit`, `once ... per occurrence`; `warn` (설계, parser 미지원) | [4. 센서와 제어](04-sensors-constraints-control.md) |',
  ]);
  for (const row of syntaxRows) {
    assert.doesNotMatch(row, /구현 상태|완료|TODO|todo|지원됨|미완료/, `syntax index row must not become an implementation status table: ${row}`);
  }
});
