#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { inspectSourceChanges } from './source-changes.mjs';

const usage = `GhostFlow 변경 비교 (읽기 전용)
사용법: node tools/ghostdiff.mjs before.ghost.md after.ghost.md [--json]

두 원문을 기존 GhostFlow 파서로 읽어 다섯 종류의 구조 변경을 비교합니다.
  --json  브라우저 공용 비교 모듈의 결과를 JSON으로 출력
  --help  이 도움말 표시

종료 코드: 0 비교 완료, 2 잘못된 인자·파일·원문
컴파일/실행 검증이나 설치를 수행하지 않으며 두 파일을 수정하지 않습니다.
현재 운전 설정 스트림의 값과 외부 프로파일 내용은 원문만으로 비교하지 못합니다.
`;
const categories = [
  ['config-default', '설정 기본값'],
  ['config-definition', '설정 정의'],
  ['control-rule', '제어 규칙'],
  ['logical-io', '논리 입력·출력'],
  ['hardware', '장치·배선'],
];
const operations = { add: '추가', remove: '삭제', modify: '변경' };
const args = process.argv.slice(2);
const json = args.includes('--json');

function readSource(path) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error(`${path}: 1 MiB 이하의 일반 파일이 필요합니다.`);
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path)); }
  catch (error) {
    if (error instanceof TypeError) throw new Error(`${path}: 올바른 UTF-8 원문이 아닙니다.`);
    throw error;
  }
}

try {
  if (!args.length || args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(usage);
  } else {
    const paths = args.filter(arg => arg !== '--json');
    if (args.filter(arg => arg === '--json').length > 1 || paths.length !== 2 || paths.some(path => path.startsWith('-'))) {
      throw new Error('변경 전과 변경 후 파일 두 개를 지정해 주세요. 사용법: node tools/ghostdiff.mjs before.ghost.md after.ghost.md [--json]');
    }
    const report = inspectSourceChanges(readSource(paths[0]), readSource(paths[1]));
    if (json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    else {
      const lines = ['GhostFlow 변경 비교'];
      for (const [category, label] of categories) {
        const changes = report.changes.filter(change => change.category === category);
        lines.push(`${label}: ${changes.length}개`);
        for (const { target, operation } of changes) lines.push(`  ${operations[operation]} — ${target.kind}/${target.name}/${target.part}`);
      }
      if (!report.changes.length) lines.push(report.documentChanged
        ? '원문 바이트는 달라졌지만 비교한 언어 구조에는 변경이 없습니다. 설명·호스트 전용 메타데이터는 별도 확인이 필요합니다.'
        : '동일한 원문입니다.');
      lines.push('구조 비교 결과입니다. 설치 가능 여부와 실제 동작은 별도 검증해야 합니다.');
      process.stdout.write(lines.join('\n') + '\n');
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : '비교하지 못했습니다.';
  if (json) process.stdout.write(JSON.stringify({ format: 'GhostFlow/source-changes-error-v1', ok: false, message }) + '\n');
  else process.stderr.write(`비교 실패: ${message}\n`);
  process.exitCode = 2;
}
