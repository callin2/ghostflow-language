# GhostFlow 검증 진행 기록 (2026-10-29, #590)

## 목적과 완료 경계

목적은 사용자가 기술한 제어 의도와 이상 상태 처리가 컴파일, 바이트코드,
실행 과정에서도 같은 의미를 유지하는지 검증하는 것이다. 테스트 통과 수는
컴파일러 전체의 수학적 정확성 증명을 대신하지 않는다. 실제 소스와 실행
소유자를 연결한 Reference 검사, Lean에서 증명한 모델, 실장비 확인을 구분한다.

이번 연속 작업의 시작점에는 Reference TODO 25개가 있었다. build145에서는
18개가 남았다. 아래 7개 사례가 실행 가능한 정확한 관찰 검사로 연결됐다.
상위 [#590](https://github.com/callin2/ghostflow-language/issues/590)은 진행 중이다.

## 완결된 실행 검사

| 사례 | 검증한 동작 | 소유자와 근거 |
|---|---|---|
| REF-03-026 / #215 | Pulse missed, Window 첫 true 한 번, Run admission 이후 단조 deadline | 같은 소스의 native/WASM trace |
| REF-03-030 / #219 | 관측 간격 초과로 종결된 occurrence는 열린 구간에서도 되살리지 않음 | native/WASM clock·ledger trace |
| REF-06-020 / #305 | 잘못된 프로그램 교체 후보를 거절하고 기존 Program·run·trace 유지 | ProgramReplacementHost + ControlRuntime |
| REF-06-022 / #307 | 성공한 교체는 새 source/artifact/run, 이전 입력 폐기, 새 완전 snapshot 요구 | 실제 host 실행과 identity |
| REF-03-040 / #224 | offset/fallback 뒤의 예정 현지 날짜로 요일 판정, admission 뒤에는 자정을 넘어 Run 유지 | Solar/Tide native/WASM |
| REF-06-009 / #297 | 센서의 타입·단위·범위·관측 간격을 검사하고 부적합 교체를 원자적으로 거절 | InstalledControlHost + 실제 conditioner |
| REF-04-039 / #243 | Stale은 선택된 strategy의 Result로 처리, 잘못된 새 profile은 기존 상태를 보존하며 거절 | 설치 검증·strategy activation·완료 step snapshot |

정확한 test selector와 사례 backlink는 `contracts/feature-status/catalog.json`에
등록했다. 처음 네 사례는 [PR595](https://github.com/callin2/ghostflow-language/pull/595)로
`dev`에 병합됐다. merge는 `fe0bc2215a64d110795366cc82a1d7f542b94188`이며
통합 소스 `c53a49a`와 tree가 같음을 확인했다. #215, #219, #305, #307은
검증 근거와 함께 완료 처리했다.

후속 변경은 [PR596](https://github.com/callin2/ghostflow-language/pull/596)과
[PR597](https://github.com/callin2/ghostflow-language/pull/597)에 분리했다.
이 기록 시점에는 두 PR의 병합을 주장하지 않는다.

## 수학적으로 증명한 부분

[Bool 증명 보고서](../../experiments/bool-translation-validation/serializer-report.md)의
Lean 모델은 다음을 보장한다.

- 허용된 typed Bool 식의 canonical 직렬화와 검증 witness가 일치한다.
- 직렬화된 원시 바이트를 독립 decoder가 읽으면 원래 식을 복원한다.
- 역방향도 성립한다. decoder가 어떤 바이트열을 받아들였다면 그 식을 다시
  직렬화한 바이트가 원래 입력과 정확히 같다. 별도 canonicality 가정은 없다.
- 허용된 바이트열은 비어 있지 않고 4096바이트 이하며 각 원소는 0..255이다.
- 명시적인 slot 범위와 stack 여유 조건에서 기존 byte-PC 실행 모델의 의미와
  연결된다. 실제 compiler가 만든 전체 artifact와 식 slice도 kernel equality로 확인한다.

정수 operand 2를 true로 받아들이거나 끝의 알 수 없는 바이트를 버리는 두
변이는 예전 정방향 복원 증명을 통과한다. 새 역방향 증명은 이를 거절하며,
각 변이의 실제 반례도 Lean kernel이 확인한다. 64라는 수는 정리 개수가 아니라
성공해야 할 증명·거절되어야 할 변이 등을 합친 **기대 실행 결과 수**다.

표준 Lean 공리 `propext`, `Classical.choice`, `Quot.sound`를 사용한다.
사용자 정의 공리, `sorry`, `sorryAx`, `native_decide`는 사용하지 않는다.
JavaScript 원문 parsing/projection과 바깥 artifact header/slice 추출은 신뢰
경계에 남는다. 실제 Rust interpreter와 모델 사이의 보편적 대응, 다른 값 타입과
전체 profile, 전략·trace 전반, 물리 효과는 아직 증명하지 않았다.

## 실제 실행 증거

| 검사 | 정확한 소스 / 결과 | 증거 식별 |
|---|---|---|
| 공식 build137 | c53a49a, 13 gate, Rust437, 주 Node3767 pass / 21 TODO / 0 fail | verification SHA-256 `f63eab9136189b25d886b19bcdc1fab85a2640c8e044e3cdb5c6acfd0aa16f93` |
| 공식 build145 | 298fd7a569688187f903a0af329f7fd405a55edf, 13 gate, Rust441, 주 Node3795 pass / 18 TODO / 0 fail, 별도 CLI console15 pass | verification SHA-256 `bb6bf983d179bc794f76038f3825fd28380e0ae5f3b8054022f9ac2fd10abdb5` |
| 로컬 Lean 4.19.0 | 5d97e5f, 64/64 기대 결과, 이후 build145까지 증명 입력 manifest 파일 해시 동일 | verification SHA-256 `659e266398d7a74688223692489a7adcd6f9e474381885d6ce1f1eb245327de0` |
| Linux Lean 4.19.0 | PR596 head76a8449, 64/64, 2026-10-28T15:36:57.9738666Z | [run40717505994 artifact12829491780](https://github.com/callin2/ghostflow-language/actions/runs/40717505994/artifacts/12829491780), ZIP SHA-256 `9ae83fbf57be0b5a98bb7ad08d0b94e252fa0536273063e40258acffc03f85b4` |
| 추가 coverage 검사 | 6240186, 함수469/469, 줄90.10%, V8 block ranges88.17%, 기존 기준100/88/77 유지 | report SHA-256 `becc8366f15403f9fa5e1fed86dd00fa5d68dde46bec67db7c441d64714a3bff` |

build145 완료 시각은 `2026-10-28T15:46:23.432Z`다. 로컬 증거는
`build/evidence/build145/`, `build/bool-second-wave-590/`,
`build/evidence/coverage-6240186/`에 보존했다. 로컬 원본은 Git ignored 경로이며
GitHub에 파일 자체를 게시했다고 주장하지 않는다. 위 Linux artifact는 별도다.

PR596과 PR597의 Linux source verification도 각각 통과했으나, 별도 coverage
목록에서 새 요일 검사 파일이 빠져 99.79% 함수 실행률로 실패했다. 테스트를
추가 등록한 수정은 선행 PR596의 `66dbd11`, 후속 PR597의 `6240186`에 있다.
이 기록 시점에는 그 수정의 GitHub 재검증이 진행 중이다.

## 발견해 수정한 문제

1. 예정 현지 날짜가 일시적으로 Unknown이면 Tide의 within 유예가 보존되지
   않았다. 유예 안의 복구 admission, 정확한 만료, Unknown 중 취소를 검사했다.
2. 센서 교체로 보드 identity/model까지 바꿀 수 있었다. 설치 보드 identity를
   고정하고 거절 후 기존 run과 입력 품질 상태의 보존을 확인했다.
3. Number의 뒤집힌·비유한 valid 범위를 독립 설치 검증이 받아들일 여지가 있었다.
   순서와 유한성 검사를 실제 거절 경로에 추가했다.
4. 기존 패키지 시험의 새 scheduled-date 필드 누락, 문서 색인 누락, 이제 지원하는
   요일 조건을 여전히 거절하던 옛 기대값을 전체 검사에서 찾아 수정했다.
5. 새 입력 전략 지원 문서가 기존 Bool 출력 actuator capability도 제외한다고
   잘못 썼다. 실제 실행으로 확인하고 문서와 회귀 검사를 맞췄다.
6. 별도 coverage 목록 누락은 기준을 낮추지 않고 실제 의미 검사 등록으로 고쳤다.

앞선 실패 기록은 `build/evidence/second-wave-*-failure/`에 보존했다.

## 부분 완료와 다음 일

[#208](https://github.com/callin2/ghostflow-language/issues/208)은 Station의
기존 session applied 누적값을 Rust/WASM에서 조회하도록 연결했다. 10초 ON,
10초 OFF, 20초 ON이면 40초 시점에 30,000ms다. 조회는 시간을 진행하지 않으며
잘못된·종료된·복원된 세션은 거절한다. generic authored job의 시작/종료·reset·재부팅
계약은 별도이므로 REF-03-018 전체는 완료로 세지 않았다.

[#290](https://github.com/callin2/ghostflow-language/issues/290)과
[#302](https://github.com/callin2/ghostflow-language/issues/302)는 실제 조합 runtime의
settings emission과 설치 binding을 같은 완료 scan의 원본·설명에 연결해야 한다.
현재 원본 closure와 instance/node 정보는 재사용할 수 있다. imported intent를
root intent와 혼합하지 않는 인스턴스별 provenance 표현을 다음 단위로 구현 중이다.
임의 revision을 붙이는 독립 helper로 완료 처리하지 않는다.

남은 18개 Reference 사례는 다음과 같다. 이 목록의 구분은 다음 작업 의존성이며
전체 작업을 중단하는 조건이 아니다.

| 사례 / 이슈 | 남은 구체적 의무 |
|---|---|
| REF-01-003 / #196 | 제품의 canonical revision 생성·복구 실제 경로 |
| REF-03-018 / #208 | generic job 누적 의미와 lifecycle |
| REF-03-021 / #211 | safe/confirmed 집계의 실제 producer와 품질 |
| REF-04-051 / #249 | Percent resource 중재와 policy revision |
| REF-04-053 / #251 | Device verified stop과 feedback timeout |
| REF-04-055 / #253 | queue/apply receipt 및 confirmed-flow 품질 연결 |
| REF-04-065 / #259 | Option·bounded state·분석 Unknown/timeout·resource rollback |
| REF-05-017 / #278 | Device durable settings와 재부팅 새 run |
| REF-05-026 / #286 | typed command lifecycle producer/history |
| REF-05-027 / #287 | alarm producer와 active snapshot |
| REF-05-028 / #288 | descriptor/settings/snapshot/explanation/driver identity 연결 |
| REF-06-002 / #290 | 조합 binding·interaction provenance, config/timer는 실행 검증됨 |
| REF-06-005 / #293 | 부분 전기 증거와 Unknown 표현 |
| REF-06-007 / #295 | 실제 typed change planner lifecycle |
| REF-06-008 / #296 | 실제 Device driver 교체 |
| REF-06-016 / #302 | occurrence에서 instance/source/settings/binding으로 추적 |
| REF-07-007 / #314 | 실제 CSE 변환이 생겼을 때의 provenance 보존 |
| REF-08-011 / #328 | 여러 계층의 revision 변경 분류 |
