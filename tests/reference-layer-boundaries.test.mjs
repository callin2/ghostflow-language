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

function cells(row) {
  return row.slice(1, -1).split('|').map(cell => cell.trim());
}

function tableByFirstCell(markdown) {
  return new Map(tableRows(markdown).slice(1).map(row => {
    const [key, ...rest] = cells(row);
    return [key, rest];
  }));
}

test('REF-08-002: compiler/tooling preserves source metadata but does not prove physical operation', () => {
  const chapter = readReference('08-language-runtime-and-device-boundaries.md');
  const layers = tableByFirstCell(section(chapter, '8.2 계층별 책임'));
  const compiler = layers.get('컴파일러·도구');
  assert.ok(compiler, 'missing compiler/tooling layer row');
  const [responsibility, boundary] = compiler;

  assert.match(responsibility, /정본 문서 해석/);
  assert.match(responsibility, /타입·이름·분기 검사/);
  assert.match(responsibility, /선언·의도·설정 설명 보존/);
  assert.match(boundary, /물리 배선이나 실제 작동을 정적 타입 검사만으로 증명하지 않는다\./);

  const runtime = layers.get('제어 런타임');
  assert.ok(runtime, 'missing runtime layer row');
  assert.match(runtime[1], /출력을 물리 확인으로 간주하지 않는다\./);

  const driver = layers.get('Driver');
  assert.ok(driver, 'missing Driver layer row');
  assert.match(driver[0], /장치 통신/);
  assert.match(driver[0], /출력 적용 결과/);
});

test('REF-08-002: FAQ compiler row separates compile checks from physical verification', () => {
  const chapter = readReference('08-language-runtime-and-device-boundaries.md');
  const faqRows = tableRows(section(chapter, '8.3 FAQ 전체 책임표')).slice(1).map(cells);
  const canonicalRow = faqRows.find(([faq]) => /language_faq\.md#q01/.test(faq) && /language_faq\.md#q41/.test(faq));
  assert.ok(canonicalRow, 'missing FAQ 1/41 canonical document/compiler row');

  const [, languageCompilerNeed, runtimeNeed, externalNeed] = canonicalRow;
  assert.match(languageCompilerNeed, /literate 해석/);
  assert.match(languageCompilerNeed, /소스·의도 위치 보존과 검사/);
  assert.match(runtimeNeed, /식별된 Program 실행/);
  assert.match(externalNeed, /컴파일 검사는 물리 동작 검증과 구분/);

  const combined = [languageCompilerNeed, runtimeNeed, externalNeed].join(' ');
  assert.doesNotMatch(combined, /컴파일(?:\s|·|-)*(?:성공|검사).{0,20}(?:물리(?:\s|·|-)*(?:검증|작동).{0,10}(?:완료|성공|증명)|실제(?:\s|·|-)*작동.{0,10}(?:완료|성공|증명))/);
  assert.doesNotMatch(combined, /physical(?:\s|_|-)*verification.{0,20}(?:compile|success)/i);
});
