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

function termDefinitions() {
  const chapter = readReference('07-semantic-rules-and-index.md');
  const rows = tableRows(section(chapter, '7.7 용어')).slice(1);
  return new Map(rows.map(row => cells(row)));
}

test('REF-07-009: boundary terms have separate identity and effect definitions', () => {
  const terms = termDefinitions();
  assert.equal(terms.get('Program'), '실행 규칙의 identity를 가진 프로그램');
  assert.equal(terms.get('Run'), '그 프로그램을 한 번 시작하여 이어가는 실행의 identity');
  assert.equal(terms.get('Tick / scan'), '입력을 받아 논리 판단을 확정하는 단위. 문맥별 관측 경계를 함께 읽는다.');
  assert.equal(terms.get('Requested / safe intent'), '제어식이 요청한 출력 / 제약을 거친 출력 의도');
  assert.equal(terms.get('Logical port / physical binding'), '제어의 의미 있는 연결점 / 그것을 실제 설비에 연결하는 관계');
  assert.equal(terms.get('Driver'), '논리 입력과 물리 신호, 출력 의도와 실제 효과를 연결하는 경계');
});

test('REF-07-009: Reference prose does not collapse Program/Run, requested/safe, or logical/physical', () => {
  const chapter02 = readReference('02-types-expressions-state.md');
  const chapter04 = readReference('04-sensors-constraints-control.md');
  const chapter07 = readReference('07-semantic-rules-and-index.md');

  assert.match(chapter02, /`<-`로 만든 값은 requested intent다\. 출력 제약이 이를\s+safe intent로 제한한 뒤 상태와 논리 결과를 함께 확정한다\./);
  assert.match(chapter04, /이 결과는 safe intent다\. GPIO\/relay를 실제로 적용했다는 증거도, valve가 실제로\s+열렸다는 증거도 아니다\./);
  assert.match(chapter07, /\| Program \| 실행 규칙의 identity를 가진 프로그램 \|/);
  assert.match(chapter07, /\| Run \| 그 프로그램을 한 번 시작하여 이어가는 실행의 identity \|/);
  assert.match(chapter07, /\| Logical port \/ physical binding \| 제어의 의미 있는 연결점 \/ 그것을 실제 설비에 연결하는 관계 \|/);

  const combined = [chapter02, chapter04, chapter07].join('\n');
  const forbidden = [
    /Program(?:과|와)?\s*Run(?:은|는)?\s*(?:같은|동일한)\s*identity/,
    /Run(?:과|와)?\s*Program(?:은|는)?\s*(?:같은|동일한)\s*identity/,
    /requested(?:\s+intent)?(?:와|과)?\s*safe(?:\s+intent)?(?:은|는)?\s*(?:같은|동일한)\s*(?:뜻|값|의도)/i,
    /safe(?:\s+intent)?(?:와|과)?\s*requested(?:\s+intent)?(?:은|는)?\s*(?:같은|동일한)\s*(?:뜻|값|의도)/i,
    /logical(?:\s+port)?(?:와|과)?\s*physical(?:\s+binding)?(?:은|는)?\s*(?:같은|동일한)\s*(?:뜻|경계|identity)/i,
    /physical(?:\s+binding)?(?:와|과)?\s*logical(?:\s+port)?(?:은|는)?\s*(?:같은|동일한)\s*(?:뜻|경계|identity)/i,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(combined, pattern, `Reference prose must not collapse boundary terms: ${pattern}`);
  }
});
