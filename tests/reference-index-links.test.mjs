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
  return markdown.split(/\r?\n/).filter(line => /^\|.+\|$/.test(line) && !/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|$/.test(line));
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

function cells(row) {
  return row.slice(1, -1).split('|').map(cell => cell.trim());
}

function markdownWithoutLinks(text) {
  return text.replace(/\[[^\]]+\]\([^)]+\)/g, '').trim();
}

function assertResolvableLocalLinks(markdown, baseDir) {
  const errors = [];
  const cache = new Map();
  const loadAnchors = file => {
    const absolute = path.join(baseDir, file);
    if (!cache.has(absolute)) cache.set(absolute, anchors(fs.readFileSync(absolute, 'utf8')));
    return cache.get(absolute);
  };

  for (const target of links(markdown).filter(link => !/^https?:\/\//.test(link))) {
    const [file, anchor, extra] = target.split('#');
    if (extra !== undefined) errors.push(`${target}: invalid multi-anchor target`);
    const absolute = path.join(baseDir, file);
    if (!fs.existsSync(absolute)) {
      errors.push(`${target}: missing target file`);
      continue;
    }
    if (anchor && !loadAnchors(file).has(anchor)) errors.push(`${target}: missing target anchor`);
  }

  assert.deepEqual(errors, []);
}

test('REF-07-008: syntax and symbol index links resolve to exact Reference sections', () => {
  const chapter = readReference('07-semantic-rules-and-index.md');
  const sections = [
    section(chapter, '7.5 선언과 표기 찾아보기'),
    section(chapter, '7.6 기호 찾아보기'),
  ];
  const parsedRows = sections.flatMap(tableRows);
  assert.ok(parsedRows.length > 20, 'index tables must remain substantive');

  assertResolvableLocalLinks(sections.join('\n'), referenceDir);
  const badTargets = sections.flatMap(links).filter(target => !/^https?:\/\//.test(target) && (!target.split('#')[0] || path.basename(target.split('#')[0]) !== target.split('#')[0]));
  assert.deepEqual(badTargets, [], 'index tables must link only to same-directory Reference chapter files');
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

test('REF-07-010: source-to-Reference index links design rationale to exact Reference locations only', () => {
  // Both language versions must preserve exact destinations. Previously only
  // the Korean source was checked, allowing its translation to retain old prose.
  const translation = section(readReference('07-semantic-rules-and-index.en.md'), '7.8 From original documents to the reference');
  assertResolvableLocalLinks(translation, referenceDir);
  const chapter = readReference('07-semantic-rules-and-index.md');
  const sourceIndex = section(chapter, '7.8 원문에서 reference로 찾아가기');
  assertResolvableLocalLinks(sourceIndex, referenceDir);
  assert.deepEqual(links(translation), links(sourceIndex), 'translated index preserves every source link destination');

  const rows = tableRows(sourceIndex).slice(1);
  assert.equal(rows.length, 13, 'source-to-Reference index must cover each design-rationale row');
  for (const row of rows) {
    const [rationale, locations] = cells(row);
    assert.ok(rationale, `missing design rationale: ${row}`);
    assert.ok(locations, `missing Reference location: ${row}`);
    assert.doesNotMatch(row, /이슈 상태|작업 진척|구현 상태|완료|TODO|todo|지원됨|미완료|closed|open/i, `source index row must not be a progress/status table: ${row}`);

    const referenceLinks = links(locations);
    assert.ok(referenceLinks.length > 0, `Reference location cell needs exact links: ${row}`);
    assert.equal(markdownWithoutLinks(locations).replace(/[,.·、，\s]/g, ''), '', `Reference location cell must not contain unlinked target prose: ${row}`);
    for (const target of referenceLinks) {
      assert.match(target, /^0[1-8]-[^#]+\.md#[^#]+$/, `Reference location must be an anchored Reference chapter link: ${target}`);
    }
  }
});
