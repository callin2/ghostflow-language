import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';

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

test('REF-08-003: data providers expose data identity, coverage, validity, and failures without a second control language', () => {
  const chapter08 = readReference('08-language-runtime-and-device-boundaries.md');
  const layers = tableByFirstCell(section(chapter08, '8.2 계층별 책임'));
  const provider = layers.get('실행 환경·데이터 제공자');
  assert.ok(provider, 'missing execution-environment/data-provider layer row');
  const [responsibility, boundary] = provider;

  assert.match(responsibility, /시계와 신뢰도/);
  assert.match(responsibility, /날짜·자연 사건 자료/);
  assert.match(boundary, /공급한 자료의 판본·적용 범위·유효성·실패를 드러낸다\./);
  assert.match(boundary, /별도 제어 언어를 만들지 않는다\./);

  const faqRows = tableRows(section(chapter08, '8.3 FAQ 전체 책임표')).slice(1).map(cells);
  const calendarRow = faqRows.find(([faq]) => /language_faq\.md#q21/.test(faq) && /language_faq\.md#q27/.test(faq) && /language_faq\.md#q29/.test(faq));
  assert.ok(calendarRow, 'missing weekday/holiday/DST FAQ row');
  assert.match(calendarRow[3], /달력·시간대 자료와 판본·범위 공급/);

  const timeJudgment = section(chapter08, '8.4 기능별로 지켜야 하는 경계');
  assert.match(timeJudgment, /생성 입력은 원인과 판본을 잃은 임의 Bool 펄스로 축소하지 않는다\./);

  const chapter03 = readReference('03-time-and-schedules.md');
  assert.match(chapter03, /`calendar_is`는\s+`Result<Bool, CalendarFault>`를 반환한다\./);
  assert.match(chapter03, /Schedule의 `on`은 같은 fault를 Unknown으로\s+보존해 명시 fallback으로 보내지만 일반 식은 `case` 없이 Bool로 바꾸지 않는다\./);
  assert.match(chapter03, /언어는 자료의 ID, revision, coverage, expiry를 요구할 뿐 인터넷을\s+요구하지 않는다\./);

  const combined = [boundary, calendarRow.join(' '), timeJudgment, chapter03].join('\n');
  assert.doesNotMatch(combined, /(?:공휴일|holiday|calendar).{0,40}(?:임의|arbitrary).{0,20}Bool/i);
  assert.doesNotMatch(combined, /(?:expiry|만료).{0,40}(?:true|false|Bool|불리언)\s*(?:로|으로)?\s*(?:대체|변환|축소)/i);
});

test('REF-08-004: host execution does not require Android, cloud, or internet and distinguishes offline data states', () => {
  const chapter08 = readReference('08-language-runtime-and-device-boundaries.md');
  const layerSection = section(chapter08, '8.2 계층별 책임');

  assert.match(layerSection, /실행 환경\(host\)은 제어 프로그램을 실행시키는 장치 또는 프로세스/);
  assert.match(layerSection, /Android 게이트웨이나 클라우드를 필수 구성으로 뜻하지 않는다\./);
  assert.match(layerSection, /장치가 필요한 시계와 유효 자료를 로컬에 갖고 있으면 인터넷 없이도 계약을 이행할 수 있다\./);
  assert.match(layerSection, /네트워크 단절과 자료 만료·시각 불명은 각각 다른 상태다\./);

  const chapter03 = readReference('03-time-and-schedules.md');
  assert.match(chapter03, /일정의 실제 시계·달력·예측 자료는 로컬 장치나 선택적 gateway가 공급할 수 있다\./);
  assert.match(chapter03, /네트워크나 특정 gateway는 언어 요구가 아니다\./);
  assert.match(chapter03, /언어는 자료의 ID, revision, coverage, expiry를 요구할 뿐 인터넷을\s+요구하지 않는다\./);

  const combined = [layerSection, chapter03].join('\n');
  assert.doesNotMatch(combined, /(?:Android|cloud|클라우드|인터넷|gateway|게이트웨이).{0,30}(?:필수 구성이다|필수 요구다|must be required|is required)/i);
  assert.doesNotMatch(combined, /(?:네트워크 단절|network disconnected).{0,30}(?:자료 만료|data expired|시각 불명|time unknown).{0,20}(?:같은 상태|동일 상태|same state)/i);
});

test('REF-08-016 [host] 설치 binding과 Driver 배포 형식은 source grammar 밖의 환경 계약이다.', async () => {
  const referenceCases = JSON.parse(fs.readFileSync(
    path.join(root, 'tests/reference/cases/03-settings-boundaries.json'), 'utf8')).cases;
  const ref08016 = referenceCases.find(entry => entry.id === 'REF-08-016');
  const chapter08 = readReference('08-language-runtime-and-device-boundaries.md');
  const chapter06 = readReference('06-composition-and-replay.md');
  assert.equal(ref08016?.issue, 'https://github.com/callin2/ghostflow-language/issues/333');
  assert.match(ref08016.rule, /설치 binding과 Driver 배포 형식은 source grammar 밖의 환경 계약이다/);
  assert.match(ref08016.given, /GPIO와 RS485 Driver binding 후보/);
  assert.match(ref08016.then, /source\/Program identity를 유지/);
  assert.match(ref08016.then, /binding\/Driver 판본을 별도로 식별/);
  assert.match(ref08016.then, /FAQ 화살표를 source 문법으로 해석하지 않는다/);

  const layers = tableByFirstCell(section(chapter08, '8.2 계층별 책임'));
  const language = layers.get('언어 사양');
  const binding = layers.get('설치 profile·binding');
  assert.ok(language, 'missing language layer row');
  assert.ok(binding, 'missing installation profile/binding row');
  assert.match(language[1], /장치 주소, UI 모양, 저장 매체를 제어 문법으로 만들지 않는다/);
  assert.match(binding[0], /논리 역할과 실제 endpoint 연결/);
  assert.match(binding[1], /연결만 바뀌는 것과 소스 규칙 변경을 구분한다/);
  assert.match(chapter08, /직접 GPIO, 확장 채널, RS485 장치 주소는\s+설치 binding과 Driver의 책임이다/);
  assert.match(chapter08, /호환 교체만으로 소스 수정·재컴파일을 요구하지 않는다/);
  assert.match(chapter08, /설치 저장 형식·실제 핀\/주소·Driver 배포 방식/);
  assert.match(chapter08, /저장 매체, UI component, 통신 protocol도 언어 문법을 결정하기 위한 선행 조건이 아니다/);
  assert.match(chapter06, /physical endpoint는 별도 profile과 binding revision이 소유한다/);
  assert.match(chapter06, /버스 주소·채널 선택·전송 절차는 Driver와 설치 연결이 소유한다/);
  assert.match(chapter06, /Driver 자체의 배포 판본은 실행 환경에서 관리한다/);
  assert.match(chapter06, /`bind`는 제어 소스 문법이 아니다/);

  const source = `# Logical port\n\n\`\`\`ghost\ncontrol LogicalPump {
  input start: Bool;
  output pump: Bool;
  pump <- start |> recover(false);
}\n\`\`\`\n`;
  const compiled = await compileSource(source, { filename: 'logical-pump.ghost.md' });
  const sourceIdentity = {
    source: compiled.sourceDocument.sha256,
    program: compiled.manifest.bytecodeSha256,
  };
  const gpioBinding = { bindingRevision: 'install-gpio-r1', driverRevision: 'gpio-relay-1.0.0', endpoint: 'gpio:17' };
  const rs485Binding = { bindingRevision: 'install-rs485-r2', driverRevision: 'rs485-relay-2.1.0', endpoint: 'rs485:7/channel/1' };
  assert.notDeepEqual(gpioBinding, rs485Binding);
  assert.deepEqual(sourceIdentity, { source: compiled.sourceDocument.sha256, program: compiled.manifest.bytecodeSha256 });

  const grammarSketches = [
    'control BadArrow { input start: Bool; output pump: Bool; start -> pump; }',
    'control BadBind { bind pump to GPIO17; output pump: Bool; pump <- false; }',
    'control BadRs485 { output pump: Bool; pump <- RS485(7, 1); }',
  ];
  for (const sketch of grammarSketches) {
    await assert.rejects(() => compileSource(`\`\`\`ghost\n${sketch}\n\`\`\`\n`, { filename: 'external-binding-sketch.ghost.md' }));
  }
});

test('REF-08-006: ordinary control combinations stay in language constructs and input-capture contracts', () => {
  const chapter08 = readReference('08-language-runtime-and-device-boundaries.md');
  const featureBoundaries = section(chapter08, '8.4 기능별로 지켜야 하는 경계');
  const [generalControl] = featureBoundaries.split(/\n### 시간 판단과 자료 제공\n/);

  assert.match(generalControl, /자기유지, 탱크 충전, 단계별 취소는 기존 state·Bool·enum·case의 조합이다\./);
  assert.match(generalControl, /런타임은 상태 전이 의미를 제공하고 작성자는 재시작·취소·완료 정책을 선택한다\./);
  assert.match(generalControl, /Driver에 별도 자기유지나 취소 순서를 숨기지 않는다\./);
  assert.match(generalControl, /FAQ의 Bool 알람 래치도 자동으로 alarm record나 외부 통지 서비스가 되지는 않는다\./);
  assert.match(generalControl, /FAQ 11의 `done`은 3회에 도달한 뒤 유지되는 Bool 값이며 1회성 완료 펄스가 아니다\./);
  assert.match(generalControl, /3에서 계수를 멈추는 것도 그 예제의 조건식이며 Int 연산 자체의 포화 규칙이 아니다\./);
  assert.match(generalControl, /판단 사이에 발생했다 사라진 물리 펄스까지\s+세어야 한다면 Driver·입력 생산자의 캡처와 전달 계약이 필요하다\./);
  assert.match(generalControl, /정확 정수 타입만으로\s+물리 사건의 무손실 관측을 보장하지 않는다\./);

  assert.doesNotMatch(generalControl, /(?:자기유지|탱크 충전|단계별 취소|알람 래치|세 번 감지).{0,30}(?:내장 mode|내장 모드|특수 keyword|special built-in|primitive)/i);
  assert.doesNotMatch(generalControl, /Driver.{0,30}(?:숨긴다|숨겨야|hidden policy|별도 자기유지.*제공)/i);
});
