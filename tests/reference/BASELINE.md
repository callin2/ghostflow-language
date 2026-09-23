# Reference 테스트 작성 후 기준 결과

## 최신 전체 실행: batch11 (2026-09-23)

`npm test` exit 1. Node 1,962건: 1,767 pass, 31 fail, 164 TODO, 0 skip.
Reference executable 204건: 177 pass, 27 fail. 기존 실패
`REF-04-027/028/029`는 GFB4 window 컴파일 연결 후 통과했다.
Rust workspace 검사와 native/WASM 빌드는 통과했다. Tutorial은 Node 실패로 실행하지 않았다.

비Reference 실패 4건은 새 native fixture의 오류 문구 1건, 기존 미래 bytecode
버전 fixture 1건, 이동된 문서 locator 때문에 실패한 catalog 테스트 2건이다.
후속 수정과 부분 재검증은 별도 기록한다. 이 전체 실행의 수치를 소급 변경하지 않는다.

근거: `build/compiler-runtime-batch11-full.log`,
`build/compiler-runtime-batch11-reference-results.json`,
`build/compiler-runtime-batch11-verification.json`.
이후 fixture/catalog/이 기록의 변경으로 전체 실행의 source hash와 현재 트리는 다르다.
전체 Reference 및 compiler/runtime 목표는 미완료다.

후속 부분 재검증: native window 3/3, requirement catalog 5/5 통과.
GFB2 미래 버전 fixture를 4에서 5로 고친 거부 검사도 통과했다.
문서 이동 locator는 기존 hash를 보존했다. GFB4 설명이 추가된 두 문단은
기존 요구문·상태·테스트 관계를 유지하고 인용 범위와 hash만 갱신했다.
비Reference 실패 4건은 모두 부분 재검증으로 해소했다. 전체 gate는 재실행하지 않았다.
근거: `build/window-native-green.log`, `build/catalog-gfb2-focused.log` 및
`node --test tests/requirement-catalog.test.mjs`의 5/5 결과.

2026-09-22, Node.js v25.2.1에서 `npm run test:reference`를 실행했다.
컴파일러·런타임 소스는 수정하지 않았다. 새 테스트는 기존 검증 목록에도 등록했다.

## 범위와 결과

| 구분 | 사례 수 | 결과의 의미 |
|---|---:|---|
| 전체 명세 | 316 | Reference 설계 철학과 1–8장의 개별 규칙·책임 계약 |
| CLI 실행 | 116 | 검사 모드와 실제 산출물 생성 경로 |
| CLI 통과 | 113 | 해당 컴파일 기대값과 원문·산출물 결속 검사 통과 |
| CLI 실패 | 3 | 아래 기대 계약과 현재 컴파일러 결과가 다름 |
| 비실행 계약 명세 | 151 | 런타임·환경·Driver·UI·도구의 given/when/then 작성; 동작 검증은 미실행 |
| 결정 필요 명세 | 49 | 미결 문법·정책과 기대 의미를 기록; 지원 또는 통과로 계산하지 않음 |

카탈로그 검사는 별도로 통과했다. ID 중복, 필수 필드, Reference 링크를 검사하고
설계 철학 10개와 1–8장의 모든 번호 있는 절이 사례에 연결됨을 확인했다.
이 절 연결 검사는 실행 동작의 완전한 검증이나 분기 커버리지 수치를 뜻하지 않는다.

원시 결과: [reference-tests-baseline.json](../../build/reference-tests-baseline.json),
[실행 로그](../../build/reference-test-run.log). 두 파일은 로컬 실행 산출물이며 재실행하면 갱신된다.

## 컴파일러 수정 시 유지할 실패 사례

| ID | Reference 기대값 | 현재 관측 |
|---|---|---|
| `REF-03-005` | Duration의 최대값 `2^53-1`을 넘는 `9007199254740992ms` 리터럴 거부 | `--check`가 성공 코드 0을 반환 |
| `REF-03-042` | 적법한 Solar 예약을 검사하고 산출물로 저장 | `--check` 성공 후 저장 단계에서 `source trace binding shape mismatch` 실패 |
| `REF-03-045` | Solar의 0 offset 및 24시간 offset 경계를 허용하고 산출물로 저장 | `--check` 성공 후 저장 단계에서 같은 오류 |

사례 원문은 [02-time-control.json](cases/02-time-control.json)에 있다.
근거는 [Reference §3.1 Duration](../../docs/reference/03-time-and-schedules.md#duration)과
[§3.9 선택된 Solar 표기](../../docs/reference/03-time-and-schedules.md#선택된-solar-표기)다.
위 실패를 TODO나 기대 실패로 숨기지 않았다. 명령의 종료 코드는 1이다.

## 작성 중 수정한 테스트 자체의 오류

- 문법과 관계없는 예약어 `ok`를 출력 이름으로 쓴 fixture를 중립 이름으로 변경했다.
- JavaScript 정규식에서 지원하지 않는 `(?i)`를 제거했다. 실행기의 `i` flag는 유지했다.
- 특정 진단 문구를 과하게 제한하던 패턴을 규칙에 맞는 문법 오류 범주로 조정했다.
- 원본 위치 사례는 실제 fixture의 `11:11` 위치를 검사하도록 구체화했다.
- 잘못된 PI/PID 절 링크를 수정했다.

정상/오류 기대값은 컴파일러 결과에 맞추어 뒤집지 않았다.
다음 작업은 컴파일러의 위 세 사례를 수정하는 것과, 각 비실행 명세에 맞는 관찰 경계를
연결하는 것이다. 이 기준 결과만으로 전체 Reference의 실행 지원을 주장하지 않는다.

## 2026-09-22 정책 확정 후 결과

기존 316건 기준은 위에 그대로 보존했다. 정책 확정과 개별 사례 추가 뒤 전체 suite를 한 번
실행했다. 컴파일러·런타임 소스는 수정하지 않았다.

| 구분 | 사례 수 |
|---|---:|
| 전체 명세 | 367 |
| CLI 실행 | 203 |
| CLI 통과 | 148 |
| CLI 실패 | 55 |
| 비실행 계약 명세 | 164 |
| 결정 필요 명세 | 0 |

카탈로그 검사는 통과했다. 실패 ID는 다음과 같다.

`REF-01-044`, `REF-01-056`, `REF-01-060`, `REF-01-065`, `REF-01-078`,
`REF-01-106`, `REF-01-109`, `REF-01-110`, `REF-01-113`, `REF-01-114`,
`REF-01-115`, `REF-01-117`, `REF-01-118`, `REF-01-121`, `REF-01-123`,
`REF-03-005`, `REF-03-008`, `REF-03-015`, `REF-03-024`, `REF-03-032`,
`REF-03-036`, `REF-03-038`, `REF-03-042`, `REF-03-045`, `REF-03-050`,
`REF-03-057`, `REF-03-059`, `REF-03-060`, `REF-03-062`, `REF-04-004`,
`REF-04-020`, `REF-04-021`, `REF-04-022`, `REF-04-025`, `REF-04-026`,
`REF-04-027`, `REF-04-028`, `REF-04-029`, `REF-04-031`, `REF-04-035`,
`REF-04-044`, `REF-04-045`, `REF-04-050`, `REF-04-058`, `REF-04-061`,
`REF-04-063`, `REF-04-068`, `REF-05-101`, `REF-06-010`, `REF-06-023`,
`REF-06-101`, `REF-06-102`, `REF-06-103`, `REF-06-105`, `REF-06-106`.

전체 결과는 [reference-policy-results.json](../../build/reference-policy-results.json),
전체 로그는 [reference-policy-run.log](../../build/reference-policy-run.log)에 보존했다.

## 2026-09-22 컴파일러 개선 후 결과

동결 전 상태에서 `npm test` 전체 gate를 한 번 실행했다. 이 실행은 종료 코드 1이었다.
Node test 763건 가운데 551건이 통과하고 48건이 실패했으며, 164건은 실행하지 않는
`specified` TODO였다.

Reference catalog는 통과했다. 전체 367건 중 compiler 실행 사례는 203건이며 159건이
통과하고 44건이 실패했다. `specified` 164건은 계속 미실행이다. 이전 55개 실패에서
다음 11개가 해결되었고 새 Reference 실패는 생기지 않았다.

`REF-01-044`, `REF-01-056`, `REF-01-060`, `REF-01-065`, `REF-01-110`,
`REF-01-113`, `REF-01-114`, `REF-01-115`, `REF-03-005`, `REF-03-015`,
`REF-05-101`.

전체 gate의 나머지 4개 실패는 requirement catalog locator 3건과 timer source dependency
1건이었다. 전체 실행 뒤 locator를 현재 동일 assertion 위치와 digest로 갱신했고 catalog
focused test 5/5가 통과했다. timer strict restore 검증을 보강한 뒤 관련
source-dependencies·toolchain·portable focused test 23/23이 통과했다. 이 후속 수정 뒤 전체
gate는 다시 실행하지 않았으므로 전체 suite가 green이라고 주장하지 않는다.

현재 주요 제한은 다음과 같다.

- 동적 numeric conversion은 새 ABI가 정해지지 않아 지원하지 않는다.
- config의 `apply` source 필드는 제거했으며 runtime의 live 설정 계약과 host 기본 정책은 별도다.
- 새 schedule 공통 policy 문법과 Reference에 남은 quantity·control·composition 문법은 아직
  compiler가 지원하지 않는다.

전체 gate 로그는 [compiler-improvement-full.log](../../build/compiler-improvement-full.log),
해당 실행의 Reference 결과는
[compiler-improvement-reference-results.json](../../build/compiler-improvement-reference-results.json)에
보존했다.

## 2026-09-22 compiler/runtime 통합 두 번째 gate

`npm test` 종료 코드 1. Node 899건: 672 pass, 63 fail, 164 specified TODO,
0 skip. Reference executable 203건은 check/build 모두 실행했고 161 pass, 42 fail이다.
`REF-04-021`, `REF-04-068`의 moving_average가 해결됐다. specified TODO는 실행 증거로
승격하지 않았다.

기존 재현 4종(Duration 상수 상한, MIN remainder, sensor recovery NotReady, short circuit)은
이 gate에서 통과했다. EMA Number/Percent의 실제 WASM 실행과 유한 극값 회귀도 통과했다.
GFB3는 단락 평가를 제공하며 PC10의 최대 식을 5934에서 3918바이트로 줄였다.
기존 식 4096바이트 제한은 유지했다. JS/Rust signed package 경로도 profiles 1/2/3의
실제 header와 descriptor 일치를 검증한다.

Reference 외 21개 실패는 interaction fixture identity 12개, catalog locator 3개,
GFB 경계/진단/기존 eager 기대값 및 source hash 4개, sensor 진단 2개다.
후속으로 interaction fixture의 module fingerprint·bytecode hash·schema hash만 갱신했고,
관련 4개 suite 26/26이 통과했다. 나머지는 후속 수정 중이며 전체 green은 아니다.

증거: [전체 로그](../../build/compiler-runtime-batch2-full.log),
[Reference 결과](../../build/compiler-runtime-batch2-reference-results.json),
[host 보고서](../../build/compiler-runtime-batch2-verification.json),
[interaction 후속 검사](../../build/branch-interaction-fixtures.log).

## 2026-09-22 compiler/runtime 세 번째 gate

`npm test` 종료 코드 1. Node 1020건: 818 pass, 38 fail, 164 specified TODO,
0 skip. Reference executable 203건 중 165 pass, 38 fail이며 **Reference 외 실패는 0건**이다.
Node 단계 실패로 후속 tutorial gate는 실행하지 않았다.

이번 gate는 동적 정수 변환, Duration 중간값 guard, DateTime backend guard,
87개 signed division identity 경계 쌍, 물리량 17종의 compiler/host/설정/관찰/package
연결을 포함한다. `REF-01-106`, `REF-01-121`, `REF-01-123`, `REF-04-022`가 해결됐다.
DateTime public syntax는 아직 미연결이며 Result·schedule·control·composition 등의
Reference 38건과 specified 실행 근거 연결은 남아 있다.

gate 뒤 검토에서 signed whole literal의 기대 Number 타입 추론 누락을 재현했다.
`1m * -2`, `-2 * 1m`, `input a: Number; let x = a < -2;`가 부당하게 거부된다.
이는 후속 TDD 수정 대상이며 이 gate가 모든 Reference 경계를 증명한다는 뜻은 아니다.

증거: [전체 로그](../../build/compiler-runtime-batch3-full.log),
[Reference 결과](../../build/compiler-runtime-batch3-reference-results.json),
[host 보고서](../../build/compiler-runtime-batch3-verification.json).

### batch3 이후 날짜·시각 연결

`Date`, `TimeOfDay`, `DateTime`의 compiler, 두 WASM host, 설정 원문 재작성,
Interaction 관찰과 signed package 경계를 연결했다. 집중 검사에서
`tests/date-time-control.test.mjs` 6건, time helper 56건, Rust package 18건이 통과했다.
Reference `REF-01-109`, `REF-03-008`도 통과했다. 전체 회귀 결과는 batch4에서 별도로 판정한다.

`REF-03-008`의 literal 경계 fixture에는 Date의 `<=` 비교가 섞여 있었다.
Reference §3.1은 DateTime과 TimeOfDay 순서 비교를 정의하므로, Date 양 끝값을
소비하는 식은 `!=`로 바로잡았다. DateTime/TimeOfDay 리터럴과 범위 기대값은 유지했다.
`tests/date-time-control.test.mjs`는 정의되지 않은 Date 순서 비교의 거부를 별도로 검사한다.


## Batch4 evidence

Batch4 전체 gate는 Node 1,044건 중 843 pass, 37 fail, 164 TODO, 0 skip이었다. Reference executable은 203건 중 167 pass, 36 fail이었다. 비Reference 실패는 quantity diagnostic assertion 1건이었고 `tests/quantities.test.mjs`에서 focused 수정 후 통과했다. 전체 gate는 실패했으며 tutorial은 실행되지 않았다. 최종 acceptance와 specified 164건 evidence 연결은 완료되지 않았다.


## Batch5 evidence

Batch5 full gate exited 1: Node 1,076 total, 878 pass, 34 fail, 164 TODO, 0 skip. Reference executable: 203 total, 171 pass, 32 fail. Non-Reference failures: 2 (control manifest faultInput fixture and toolchain reserved control name fixture); both were fixed and the focused control/toolchain suite passed 18/18. Tutorial did not run. Reports: `build/compiler-runtime-batch5-full.log`, `build/compiler-runtime-batch5-reference-results.json`, `build/compiler-runtime-batch5-verification.json`. Overall completion, specified evidence linkage, and canonical package replay remain incomplete.

## Batch6 evidence

Batch6 full gate exited 1: Node 1,543 total, 1,347 pass, 32 fail, 164 TODO, 0 skip. Reference executable: 203 total, 171 pass, 32 fail. Non-Reference failures: 0. The host gate stopped before tutorial execution. Diagnostic runners contain 467 named tests (syntax 196, semantic 257, interaction 14) and 458 independent leaf tests (syntax 187, semantic 257, interaction 14). Suites are green, but diagnostic branch coverage acceptance remains pending reconciliation. Reports: `build/compiler-runtime-batch6-full.log`, `build/compiler-runtime-batch6-reference-results.json`, `build/compiler-runtime-batch6-verification.json`; coverage note: `tasks/compiler-interaction-diagnostics-coverage.md`. Overall completion remains unchecked.

After batch6, the diagnostic-family audit was reconciled in
`tasks/compiler-diagnostics-plan.md` and `tasks/compiler-diagnostics-inventory.md`.
One additional public compiled-module-size test passed separately: exact
`compiled module byte limit exceeded` rejection and a valid 1,044,663-byte
neighbor (`build/compiler-semantic-module-limit.log`). This brings the diagnostic
suites to 459 independent leaf tests, 468 including parent groups. This was a
test-only addition; no second full-gate result is inferred. Artifact-only guards
and runtime faults remain separately scoped, and no measured branch-coverage
percentage is claimed.
