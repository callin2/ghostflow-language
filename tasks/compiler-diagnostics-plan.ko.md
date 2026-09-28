<!-- translation-source: tasks/compiler-diagnostics-plan.md -->

[영문 원본](compiler-diagnostics-plan.md)

# 컴파일러 진단 수용

사용자 요청: 모든 compiler 오류를 다루며 문법 오류가 올바르게 보고되는지 테스트한다.
이는 진행 중인 Reference/compiler/runtime TDD 목표를 보완한다.

## 범위와 소유권

| 계층 | 소유자 | 근거 |
|---|---|---|
| Literate source, lexer, parser, source intent link, CLI | Sol | compiler-syntax-diagnostics 테스트와 사례 |
| 이름/타입 검사, 상수, 함수, Result, 한계 | Astra | compiler-semantic-diagnostics 테스트와 사례 |
| 기계적 source 목록과 기존 fixture 관리 | Luna | compiler-diagnostics-inventory.md |
| 범위, 매핑 검토, 통합, 수용 | Root | 실제 assertion과 보존된 실행 결과 검토 |

기계적 목록은 검색 보조다. 일치한 줄이 반드시 진단 하나, 도달 가능한 경로,
검증된 사례라는 뜻은 아니다. Helper 정의, 재throw, 한 줄의 여러 호출,
parameterized 기대값은 명시적으로 검토해야 한다.
정본 소스로 도달 가능한 compiler 오류는 그 공개 경로를 통해 테스트해야 한다.
내부 IR/artifact guard는 별도로 분류한다. 잘못된 IR은 작성된 소스 진단 테스트를 대신하지 않는다.

## 필요한 assertion

- 도달 가능한 각 진단 family에는 안정적이고 독립적으로 보고되는 사례나
  정확한 기존 테스트 locator가 있어야 한다. 같은 텍스트의 다른 callsite를
  동등하다고 가정하지 않는다.
- 특정 category/message assertion으로 의도한 오류를 거부한다.
  일반 thrown exception이나 무관한 앞선 진단으로는 부족하다.
- 소스 위치에 관한 진단에서는 원래 filename, line, column을 확인한다.
  CRLF, Unicode, 여러 실행 fence, EOF를 검사한다.
- 잘못된 소스를 가까운 유효 형태와 짝지어 의도한 parser/type-check 경로를
  입증한다. 한계는 의미 있는 경계에서 검증한다.
- CLI 거부는 0이 아닌 종료 상태와 stderr 진단을 갖는다.
  새 실행 산출물을 쓰면 안 된다. 사용법 오류와 소스 거부는 구분한다.
- 수정할 때까지 실패는 RED로 남긴다. 테스트를 skip하거나 메시지를 약화하거나
  구현 결함에 맞춰 valid/invalid 기대값을 바꾸지 않는다.

## 완료

모든 목록 후보는 매핑하거나, 정당화된 공유 진단 경로로 통합하거나,
구체적인 내부/도달 불가 분류로 제외해야 한다. 필수 사례는 모두 실행해야 한다.
완전한 진단 coverage를 주장하기 전에 새 실패를 고치고 다시 검증해야 한다.
무한히 많은 잘못된 문자열과 외부 OS 실패 조합은 유한한 compiler 진단 catalog가 아니다.

## 수용된 근거 (2026-09-22)

현재 정본 소스와 CLI 진단 family의 audit가 완료됐다.
최초 기계적 일치 450건은 `compiler-diagnostics-inventory.md`에서 범위별로 정리했다.
Parser/ingress 사례와 제외는 `tests/fixtures/compiler-syntax-diagnostics.json`,
semantic/literal/GFB 경로는 `compiler-semantic-diagnostics-coverage.md`,
선택적 interaction 생성은 `compiler-interaction-diagnostics-coverage.md`에 있다.
Branch-coverage 백분율이나 완전한 artifact-restore/runtime-fault coverage는 주장하지 않는다.

| Suite | 독립 leaf 테스트 | 결과 |
|---|---:|---|
| Syntax, literate, intent, CLI | 187 | 통과; 상위 그룹 포함 196 |
| Semantic, 타입, compiler 한계 | 258 | 통과; 최초 257 + 이후 module-size 경계 사례 1 |
| Interaction 식별자와 provenance | 14 | 통과 |
| 합계 | 459 | 통과; 상위 그룹 포함 468 |

테스트는 후행 token 진단, intent 위치 필드, CLI operand 개수와 엄격한 UTF-8 ingress,
quantity 오류 위치, pure-function의 schedule capture, local member shadowing 문제를
발견하고 수정을 이끌었다. CLI 회귀는 BOM source 식별자, filesystem 진단,
기존 출력 파일도 보존한다.

Batch6 전체 gate(`build/compiler-runtime-batch6-full.log`)는 종료 코드 1이었다.
Node 테스트 1543건, 1347 pass, 32 fail, 164 TODO, skip 0.
실패 32건은 모두 기존 Reference 사례다. Non-Reference 실패는 남지 않았다.
실패 뒤 tutorial 검증은 실행하지 않았다. 이후 테스트만 추가한 module-size 사례는
별도로 통과했다(`build/compiler-semantic-module-limit.log`). 전체 gate 뒤
production code는 변경하지 않았다. 전체 compiler/runtime 목표는 미완료다.

## 증분 audit (2026-09-23)

Luna는 source/CLI ingress를 검토했고 추가로 미검증된 진단 family를 찾지 못했다.
[Ingress audit](compiler-ingress-diagnostics-extra.md)를 참조한다.
Sol은 현재 parser/lowerer guard를 검토하고 Result payload 타입,
nominal enum initial 타입, 물리 debounce 상태 집계, 생성 sample 입력 집계를 위한
독립 공개 소스 사례 4건을 추가했다.
[사례 매핑](compiler-control-diagnostics-extra.md)을 참조한다.

새 suite는 `tools/verify-language.mjs`에 명시적으로 등록했다.
이로써 기존 459건과 debounce 18건에 더해 독립 사례 481건이 됐다.
이는 유한한 source/CLI 진단 catalog이며 모든 잘못된 문자열,
runtime fault, artifact 무결성 실패를 다룬다는 주장이 아니다.
이전 batch8 전체 gate 근거는 이 테스트 전용 추가보다 앞선 것이다.
집중 검증: `node --test tests/compiler-control-diagnostics-extra.test.mjs`
종료 코드 0; **4/4 통과**, skip/TODO 없음.
근거: `build/compiler-control-diagnostics-extra.log`.
수용된 예산 인접 사례도 각각 서로 다른 생성 상태 126개와 입력 128개를 assertion한다.
Root는 네 사례와 등록을 모두 검토했다. `git diff --check` 통과.
변경하지 않은 기존 suite와 전체 compiler/runtime gate는 재실행하지 않았다.

## Hold 진단과 batch9

다음 measured `hold_last` slice는 `tests/hold-last-diagnostics.test.mjs`에
독립 진단/경계 사례 10건을 추가한다. 변경하지 않은 상태 128개 한계도 포함한다
(single-root hold 9개는 상태 117개, 10개는 130개가 필요하여 거부).
전체 집중 진단/경계 사례: **491**.
`build/hold-last-focused-final.log`는 새 사례 통과를 기록한다.
이후 전체 `build/compiler-runtime-batch9-full.log`에는 모든 진단 suite가 포함됐다.
Non-Reference 실패는 없다. 다른 Reference 실패 30건과 TODO 164건은
여전히 전체 compiler/runtime 완료를 막는다.

## 진단 후속 작업 (2026-09-23)

사용자는 난이도별 위임으로 추가 syntax/error 테스트를 요청했다.
유한 catalog 범위는 작성된 소스의 compiler 진단과 CLI ingress다.
Artifact restore 변조, runtime fault, 임의 OS 실패는 별도 계약이다.
기존 491건은 기준선이며 branch-coverage 주장이 아니다.

- Luna: 모든 syntax fixture를 실제 CLI check/build로 replay하고 정확한
  진단과 모든 실행 산출물 파일의 보존/부재를 확인한다.
- Sol: 중첩 grammar, 누락 구분자, 조기 EOF; 인접 유효 문서와 정확한 원래 Markdown 위치.
- Astra: coverage 제외와 진단 정확성의 적대적 검토.
- Root: 통합, source-position 수정, 테스트 검토, 수용 근거.

새 테스트는 EOF 매핑 결함을 드러냈다. 추출 코드의 합성 마지막 개행이 오류를
복사된 source map 밖에 놓았고 공개 컴파일러는 추출 좌표를 노출했다.
Terminal EOF는 마지막 작성 코드 줄 끝의 삽입 위치를 가리켜야 한다.
생성 구분자와 무관한 잘못된 source-map 좌표는 매핑하지 않아야 한다.

적대적 검토는 유효 filename에 `:1:2: `가 있을 때의 손상도 재현했다.
Prefix 제거는 이제 filename 일부를 소비할 수 있는 regex 대신
정확한 원래 filename/line/column을 사용한다.

수용된 집중 근거:

- `compiler-syntax-boundaries.test.mjs`: 새 leaf 사례 19건, 상위 그룹 포함 23건.
  RED: `build/compiler-syntax-boundaries-red.log`;
  GREEN: `build/compiler-syntax-boundaries-green.log`.
- `compiler-cli-diagnostics.test.mjs`: 기존 syntax fixture 135개 모두를
  check/build 둘 다로 검사하고 유효 build 대조군 1개를 추가했다.
  Leaf 136건, 상위 그룹 포함 137건. 교대로 쓰는 build 목적지는
  `.gfb`, `.manifest.json`, `.map.json`의 미생성 또는 byte 동일 보존을 증명한다.
- 두 suite는 `tools/verify-language.mjs`에 명시적으로 등록했다.
- 진단과 literate/source-validation/toolchain 회귀 결합:
  `build/compiler-diagnostics-followup.log`, 종료 코드 0,
  **729 pass / 0 fail / 0 skip / 0 TODO**, 상위 그룹 포함.
  전체 `npm test`는 재실행하지 않았다.

진단/경계 catalog는 이제 **독립 사례 646건**이다(기존 491 + 경계 19 + CLI 136).
이는 서로 다른 오류 종류 646개가 아니며 완전한 Reference 구현을 주장하지 않는다.
검토에서는 `Int` 운영 설정의 별도 유효 소스 수용 사례 누락을 찾았다.
기대 수용을 변경하지 않고 `REF-05-108`을 추가했으며 최초 집중 check/build는 RED였다.
이후 batch10에서 compiler/runtime metadata와 서명 package 테스트로 수정했다.
[별도 공백 기록](compiler-int-settings-gap.md)을 참조한다.
이 사례는 batch9 suite에 없었다.

## 추가 syntax audit (2026-09-23)

- Luna는 현재 Int 진단 guard를 기존 사례에 매핑하고 목록의 원래 `UNMAPPED` 행은
  과거 발견 기록임을 명확히 했다.
- Astra는 공개 compiled-module 바이트 한계의 잘못된 제외를 수정했다.
  이름 있는 식 재사용으로 도달할 수 있고 기존 semantic 경계 테스트가 이미 다룬다.
  Syntax fixture는 이제 그 테스트에 명시적으로 위임한다.
- 새 token 경계 테스트 6건은 정확히 token 8,192개인 유효 문서와
  8,193번째 identifier, number, symbol, tagged date, JSON string을 검사한다.
  각 거부는 정확한 메시지, 원래 filename, line, column을 확인한다.
- String 사례는 실제 진단 결함을 드러냈다. `JSON.parse`와 token 삽입을 모두
  감싼 catch가 token-limit 실패를 `invalid string literal`로 바꿨다.
  Catch는 이제 JSON decoding만 다룬다. Astra는 token 수와 좁은 수정을 독립적으로 검토했다.
- Sol은 정확한 진단 위치와 인접 유효 문서를 갖춘 중첩 function/case/if/pipeline 및
  delimiter 사례 11건을 추가했다. 집중 실행:
  `build/compiler-syntax-structure.log`, **11/11 통과**, 종료 코드 0.
- 새 두 suite는 `tools/verify-language.mjs`에 명시적으로 등록했다.
  Root는 assertion과 수정을 검토했다. CLI check/build, semantics,
  Int settings, debounce, hold 오류를 포함한 결합 진단 suite는
  **687/687 통과**, 종료 코드 0, skip/TODO 없음:
  `build/compiler-diagnostics-audit-final.log`.
  별도의 구조 테스트 11건을 합쳐 검증은 **통과 테스트 698건**이다
  (상위 그룹 포함). 전체 compiler/runtime gate는 재실행하지 않았다.

이 증분은 이전 진단 catalog에 **독립 사례 17건**을 추가한다.

## Bare-CR 개행 후속 작업

추가 공개 소스 사례 4건은 단독 carriage-return 개행 위치와 진단을 다룬다.
RED 근거는 `build/compiler-newline-diagnostics-red.log`에 보존한다.
영향받은 suite는 `build/compiler-newline-affected.log`에서 **233/233** 통과했다.
현재 catalog는 **독립 사례 687건**이다.
집중 근거일 뿐이며 전체 gate 결과를 주장하지 않는다.

따라서 catalog는 **독립 진단/경계 사례 663건**을 포함한다.
Luna의 마지막 제한된 검토는 구체적으로 매핑되지 않은 활성 작성 소스 또는
CLI 진단 family를 찾지 못했다. 이는 catalog audit이며 완전한 branch coverage가 아니다.
Batch11 전체 host gate도 이 suite들을 진단 실패 없이 실행했다.
그 gate는 여전히 다른 Reference 사례 27건과 integration-test/catalog 유지보수 실패
4건에서 실패했다. 후속 내용은 최신 Reference baseline을 참조한다.

이 기록은 이름 있는 진단 family와 테스트된 경계를 확립한다.
모든 복합 조건 branch나 잘못된 조합을 증명하지는 않는다.
무관한 GFB4/window 통합은 미완료이며 이 집중 진단 실행이 인증하지 않는다.

## 현재 window/rate 진단 후속 작업 (2026-09-23)

- Luna는 현재 매핑과 등록을 audit했다. Root는 도달 가능한 parser-size 진단과
  내부 helper guard, 테스트 사례와 suite의 구분을
  `compiler-diagnostics-current-audit.md`에서 수정했다.
- Sol은 `tests/compiler-window-diagnostics.test.mjs`에 독립적으로 보고되는
  window/rate 진단 및 경계 사례 10건을 추가했다.
  매핑은 `compiler-window-diagnostics-coverage.md`에 있다.
- 모든 새 거부는 `ControlCompileError`, 정확한 메시지,
  원래 Markdown filename/line/column을 assertion한다.
  각 사례는 유효 인접 사례를 컴파일한다. Temporal 예산 테스트는
  scalar 상태 127개 + window 1개를 받고 128개 + window 1개를 거부한다.
- Root는 assertion을 검토하고 `tools/verify-language.mjs`에 suite를 등록했다.
  이 후속 작업에서 compiler/runtime 동작은 변경하지 않았다.
- 기존 진단 suite 10개: **677/677 통과**, skip/TODO 0, 종료 코드 0,
  `build/compiler-diagnostics-current-regression.log`.
- 새 suite: **10/10 통과**, skip/TODO 0, 종료 코드 0,
  `build/compiler-window-diagnostics.log`.
  두 집중 실행은 합계 **통과 테스트 687건**이며 기존 suite의 상위 그룹을 포함한다.
  전체 compiler/runtime gate는 재실행하지 않았다.

이름 있는 진단/경계 catalog는 663에서 **독립 사례 673건**으로 증가한다.
이 수는 서로 다른 오류 종류 수가 아니다. Audit는 완전한 compound-branch,
malformed-artifact, runtime-fault, OS-error coverage를 확립하지 않는다.

## Parser callsite와 nested-window byte-limit 후속 작업

- Luna는 lexer/literate/CLI ingress 매핑을 audit했다. 누락 family는 발견되지 않았다.
- Sol은 활성 parser helper를 매핑하고 반복 port 이름 누락, 반복 enum member,
  첫 Result payload type, 반복 mutex 이름의 사례 4건을 추가했다.
  각각 유효 인접 사례와 정확한 오류 클래스, filename, line, column,
  메시지를 포함한다. `build/compiler-parser-callsites.log`: 4/4 통과, 종료 코드 0.
- Astra는 GFB4 window source-expression byte-limit guard에 도달하는 별도 공개 소스
  경로를 찾았다. Luna는 transform 7개 수용과 8개 거부 사례를 추가했다.
  `build/compiler-window-byte-limit.log`: 2/2 통과, 종료 코드 0.
- Root는 assertion을 검토하고 두 suite를 등록하며 derived window가 거부된다는
  오래된 주장을 제거했다. Compiler/runtime 동작은 변경하지 않았다.

Catalog: **독립 진단/경계 사례 679건**(673 + 4 + 2).
이 증분은 테스트 6건을 검증한다. 679건 모두를 재실행했다고 주장하지 않는다.
기존 수용 근거는 위 기록과 batch13에 남는다. 테스트만 추가했으므로
전체 host gate를 재실행하지 않았다. 임의의 잘못된 문자열,
artifact/runtime fault, OS 실패는 완전한 syntax 테스트 영역이 아니다.

## DailySlots 중복 필드 — batch15 이후

Reference §3.5는 각 schedule 필드를 정확히 한 번 요구한다.
Luna는 같은 값과 다른 값의 반복 `timezone`, `selected`에 대해
공개 `.ghost.md` 거부 사례 4건을 추가했다.
RED: 컴파일이 중복을 수용하여 4/4 실패
(`build/compiler-schedule-duplicates-red.log`).
최소 parser seen-set은 이제 반복 필드를 보고한다.
Root는 정확한 오류 클래스, 메시지, filename, line, column assertion과
유효 인접 사례를 요청했다. GREEN: 긍정 대조군을 포함해 5/5
(`build/compiler-schedule-duplicates.log`).
Root의 영향받은 회귀 suite는 231/231 통과했다
(`build/schedule-duplicates-regression.log`).
이 제한된 parser guard에는 전체 gate 재실행이 필요하지 않았다.
Batch15는 과거의 특정 소스 근거로 남는다.

현재 catalog: **진단/경계 사례 683건**(679 + 4).
긍정 대조군은 또 다른 거부로 세지 않는다.
전체 schedule 정책 의미는 별도 작업이며 이 수정이 암시하지 않는다.
