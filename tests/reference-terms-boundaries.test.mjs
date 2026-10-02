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

const controlChapters = [
  '02-types-expressions-state', '03-time-and-schedules',
  '04-sensors-constraints-control', '05-settings-and-observation',
  '06-composition-and-replay',
];

function controlDocuments() {
  return new Map(controlChapters.flatMap(stem => ['.md', '.en.md']
    .map(extension => [stem + extension, readReference(stem + extension)])));
}

function numberedSection(markdown, number) {
  const heading = markdown.split(/\r?\n/).find(line => line.startsWith(`## ${number} `));
  assert.ok(heading, `missing owner section ${number}`);
  return section(markdown, heading.slice(3));
}

function headingSlug(heading) {
  return heading.toLowerCase().replaceAll(String.fromCharCode(96), '')
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/ /g, '-');
}

// A documentation contract oracle, not a compiler/runtime completion oracle.
function assertControlChapterBoundaries(documents) {
  for (const extension of ['.md', '.en.md']) {
    const english = extension === '.en.md';
    const control = documents.get('04-sensors-constraints-control' + extension);
    const boundary = numberedSection(control, '4.16');
    const introduction = boundary.split('\n- ')[0];
    assert.match(introduction, english ? /establishes the surfaces/ : /표면을 확정했다/,
      'selected control surfaces must not be downgraded to pending design');
    for (const surface of english
      ? ['Result transforms', 'bounded signals/windows', 'capability strategies', 'named constraints',
        'shared resources', 'objectives/PI/PID', 'degraded control', 'bounded adaptation']
      : ['Result transform', 'bounded signal/window', 'capability strategy', 'named constraints',
        'shared resource', 'objective·PI/PID', 'degraded control', 'bounded adaptation']) {
      assert.ok(introduction.includes(surface), `missing selected surface ${surface}`);
    }

    const rows = boundary.split(/\r?\n/).filter(line => line.startsWith('- '));
    const delegates = [
      { terms: english ? ['Rolling-budget', 'history', 'scan boundaries', 'reboot policy']
        : ['rolling budget', 'history', 'scan boundary', 'reboot policy'], owners: [[1, '3.10']] },
      { terms: english ? ['quantity', 'delta', 'Result', 'quality predicates']
        : ['quantity', 'delta', 'Result', 'quality predicate'], owners: [[0, '2.5'], [0, '2.9']] },
      { terms: english ? ['Installation binding', 'live-settings event records']
        : ['installation binding', 'live settings event record'], owners: [[3, '5.2'], [3, '5.4'], [4, '6.3']] },
    ];
    assert.equal(rows.length, delegates.length, 'only the three selected detail families delegate ownership');
    delegates.forEach(({ terms, owners }, index) => {
      const row = rows[index];
      for (const term of terms) assert.ok(row.includes(term), `missing delegated detail ${term}`);
      const links = [...row.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]);
      const expected = owners.map(([chapter, number]) => {
        const file = controlChapters[chapter] + extension;
        const target = documents.get(file);
        assert.ok(target, `missing owner chapter ${file}`);
        const body = numberedSection(target, number);
        return `${file}#${headingSlug(body.split(/\r?\n/)[0].slice(3))}`;
      });
      assert.deepEqual(links, expected, 'delegated details must link to their exact owner sections');
    });

    const invariants = boundary.slice(boundary.lastIndexOf('\n- '));
    for (const invariant of english
      ? ['Result/Option distinction', 'requested→safe→applied→confirmed sequence',
        'mandatory constraint precedence', 'bounded state', 'atomic live settings', 'explicit fallback semantics']
      : ['Result/Option 구분', 'requested→safe→applied→confirmed 순서',
        '필수 constraint의\n우선성', 'bounded state', 'atomic live settings', '명시 fallback 의미']) {
      assert.ok(invariants.replace(/\r/g, '').includes(invariant), `missing preserved invariant ${invariant}`);
    }
    assert.match(invariants, english ? /do not change/ : /바꾸지 않는다/);

    // Resolve the references into actual owner bodies, not just chapter names.
    const ownerContracts = [
      [0, '2.5', ['Result<T, E>', 'SensorFault', 'SettingsFault', 'ok(expr)', 'fault(reason)', 'map', 'and_then', 'recover']],
      [0, '2.9', ['TemperatureDelta', 'Rate<Q>', 'quality: measured', 'RelativeHumidity / RelativeHumidity -> Number']],
      [1, '3.10', ['rolling(d)', '(t-d,t]', 'on_unknown = block', 'LedgerMissing', 'LedgerCorrupt']],
      [3, '5.2', ['atomic live', 'settings revision', 'effective', 'Program', 'runId']],
      [3, '5.4', ['source document + immutable revision + source digest', 'settings revision + effective event position']],
      [4, '6.3', ['operator setting', 'binding', 'Program', 'Driver']],
    ];
    for (const [chapter, number, terms] of ownerContracts) {
      const body = numberedSection(documents.get(controlChapters[chapter] + extension), number);
      for (const term of terms) assert.ok(body.includes(term), `missing owner contract ${number}: ${term}`);
    }
  }
}

test('REF-04-067: selected control surfaces delegate only accounting types and settings binding records to exact bilingual owner sections', () => {
  const cases = JSON.parse(fs.readFileSync(path.join(root, 'tests/reference/cases/02-time-control.json'), 'utf8')).cases;
  const entry = cases.find(value => value.id === 'REF-04-067');
  assert.equal(entry.scope, 'tooling');
  assert.equal(entry.status, 'specified');
  assert.equal(entry.issue, 'https://github.com/callin2/ghostflow-language/issues/261');
  assertControlChapterBoundaries(controlDocuments());
});

test('REF-04-067: boundary oracle rejects wrong missing and malformed owner links and selected contract downgrades', () => {
  const mutations = [
    ['.en.md', '03-time-and-schedules.en.md#310-time-based-usage-constraints',
      '02-types-expressions-state.en.md#29-physical-quantities-and-units'],
    ['.md', '03-time-and-schedules.md#310-시간-기반-사용량-제약', 'missing-owner.md#310-시간-기반-사용량-제약'],
    ['.en.md', '#52-source-changes-and-operating-settings-changes', '#52-source-changes-and-operating-settings-changes#extra'],
    ['.md', '[6장 조합 계약](06-composition-and-replay.md#63-parameters-settings-dependencies와-bindings)', '6장 조합 계약'],
    ['.en.md', 'establishes the surfaces', 'leaves the surfaces pending'],
    ['.md', 'named constraints,', ''],
    ['.en.md', 'mandatory constraint precedence', 'optional constraint precedence'],
    ['.md', '바꾸지 않는다', '바꾼다'],
    ['.en.md', 'atomic live settings', 'partial live settings'],
    ['.md', '명시 fallback 의미', '자동 fallback 의미'],
    ['.en.md', 'Result/Option distinction', 'Result/Option equivalence'],
  ];
  for (const [extension, before, after] of mutations) {
    const documents = controlDocuments();
    const file = '04-sensors-constraints-control' + extension;
    assert.ok(documents.get(file).includes(before), `mutation must apply: ${before}`);
    const boundary = numberedSection(documents.get(file), '4.16');
    assert.ok(boundary.includes(before), `boundary mutation must apply: ${before}`);
    documents.set(file, documents.get(file).replace(boundary, boundary.replace(before, after)));
    assert.throws(() => assertControlChapterBoundaries(documents), undefined, before);
  }
  for (const [chapter, number] of [[1, '3.10'], [0, '2.5'], [0, '2.9'], [3, '5.2'], [3, '5.4'], [4, '6.3']]) {
    const documents = controlDocuments();
    const file = controlChapters[chapter] + '.en.md';
    documents.set(file, documents.get(file).replace(`## ${number} `, '## Missing '));
    assert.throws(() => assertControlChapterBoundaries(documents), /missing owner section/);
    documents.delete(file);
    assert.throws(() => assertControlChapterBoundaries(documents), /missing owner chapter/);
  }
  for (const [chapter, number, term] of [[0, '2.5', 'SettingsFault'], [0, '2.9', 'TemperatureDelta'],
    [1, '3.10', '(t-d,t]'], [3, '5.2', 'atomic live'], [3, '5.4', 'settings revision + effective event position'],
    [4, '6.3', 'operator setting']]) {
    const documents = controlDocuments();
    const file = controlChapters[chapter] + '.en.md';
    const body = numberedSection(documents.get(file), number);
    assert.ok(body.includes(term));
    documents.set(file, documents.get(file).replace(body, body.replaceAll(term, 'removed contract')));
    assert.throws(() => assertControlChapterBoundaries(documents), /missing owner contract/);
  }
});

const implementationQualifiers = [
    ['.en.md', '4.6', /`where` and presence-only matches omitting type are not yet supported/, /The `where` example below is design notation/],
    ['.md', '4.6', /`where`와 type을 생략한\s+presence-only match는 아직 지원하지 않는다/, /아래 `where` 예시는 설계 표기다/],
    ['.en.md', '4.12', /`degraded Name` is a selected design alternative unsupported by the current native Temperature PID profile/, /`checkpoint` is a selected design alternative unsupported by the current native Temperature PID profile/],
    ['.md', '4.12', /`degraded Name`은 선택된 설계 대안이며 현재 native Temperature PID profile이 받지 않는다/, /`checkpoint`는\s+선택된 설계 대안이며 현재 native Temperature PID profile이 받지 않는다/],
    ['.en.md', '4.13', /A full fallback branch in `otherwise` is a selected design alternative not yet supported/,
      /structurally validated degraded descriptors marked `requires-native-fallback-binding`/,
      /native Temperature PID profile rejects degraded control until an executable fallback binding exists/],
    ['.md', '4.13', /`otherwise`의 완전한 fallback branch는 선택된 설계 대안이며 아직 지원하지 않는다/,
      /구조 검증된 degraded descriptor를 `requires-native-fallback-binding`으로 받지만/,
      /native Temperature PID profile이 degraded control을 거부한다/],
];

function assertImplementationQualifiers(documents) {
  for (const [extension, number, ...patterns] of implementationQualifiers) {
    const body = numberedSection(documents.get('04-sensors-constraints-control' + extension), number);
    for (const pattern of patterns) assert.match(body, pattern, `missing explicit implementation qualifier ${number}`);
  }
}

test('REF-04-067: explicit implementation qualifiers do not turn selected surfaces into production completion', () => {
  assertControlChapterBoundaries(controlDocuments());
  assertImplementationQualifiers(controlDocuments());
  for (const [extension, number, ...patterns] of implementationQualifiers) {
    for (const pattern of patterns) {
      const documents = controlDocuments();
      const file = '04-sensors-constraints-control' + extension;
      const body = numberedSection(documents.get(file), number);
      documents.set(file, documents.get(file).replace(body, body.replace(pattern, 'production implementation complete')));
      assert.throws(() => assertImplementationQualifiers(documents), /missing explicit implementation qualifier/);
    }
  }
});

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
