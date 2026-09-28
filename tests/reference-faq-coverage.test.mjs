import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const referenceDir = path.join(root, 'docs/reference');

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

function firstCell(row) {
  return row.slice(1, -1).split('|')[0].trim();
}

function linkedFaqs(cell) {
  return [...cell.matchAll(/\[(\d{1,2})\]\(\.\.\/language_faq\.md#q(\d{2})\)/g)].map(match => {
    const label = Number(match[1]);
    const anchor = Number(match[2]);
    assert.equal(label, anchor, `FAQ label and q-anchor must match: ${match[0]}`);
    return { number: label, index: match.index };
  });
}

function expandRanges(cell) {
  const linked = linkedFaqs(cell);
  const expanded = new Set(linked.map(link => link.number));
  for (let i = 0; i < linked.length - 1; i += 1) {
    const between = cell.slice(linked[i].index, linked[i + 1].index);
    if (/[-–]/.test(between) && linked[i + 1].number > linked[i].number) {
      for (let n = linked[i].number; n <= linked[i + 1].number; n += 1) expanded.add(n);
    }
  }
  return [...expanded].sort((a, b) => a - b);
}

test('REF-08-005: FAQ responsibility table covers every FAQ 1 through 41 exactly by links and ranges', () => {
  const chapter = readReference('08-language-runtime-and-device-boundaries.md');
  const faqSection = section(chapter, '8.3 FAQ 전체 책임표');
  assert.match(faqSection, /범위 표기는 해당 구간의 모든 FAQ를 포함한다\. 예: 27–29는 27, 28, 29다\./);

  const rows = tableRows(faqSection).slice(1);
  assert.equal(rows.length, 18, 'FAQ responsibility table row count should stay reviewable');

  const coverage = new Map();
  for (const row of rows) {
    const cell = firstCell(row);
    const numbers = expandRanges(cell);
    assert.ok(numbers.length > 0, `FAQ row must link at least one FAQ: ${row}`);
    for (const number of numbers) {
      assert.ok(number >= 1 && number <= 41, `FAQ number out of expected 1..41 range: ${number}`);
      const rowsForNumber = coverage.get(number) ?? [];
      rowsForNumber.push(cell);
      coverage.set(number, rowsForNumber);
    }
  }

  assert.deepEqual([...coverage.keys()].sort((a, b) => a - b), Array.from({ length: 41 }, (_, index) => index + 1));
  const duplicates = [...coverage.entries()].filter(([, rowsForNumber]) => rowsForNumber.length > 1);
  assert.deepEqual(duplicates, [], 'FAQ rows must not duplicate coverage without an explicit duplicate allowance');
});
