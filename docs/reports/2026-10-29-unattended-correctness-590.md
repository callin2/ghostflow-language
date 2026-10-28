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
  연결된다. 실제 compiler artifact에서 JavaScript가 추출한 식 slice와 witness의 equality를 kernel에서 확인한다. 바깥 metadata 전체를 검증하는 정리는 아직 없다.

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

## build150 후속 확인

인스턴스별 원본 의도 연결은 [PR598](https://github.com/callin2/ghostflow-language/pull/598)에 있다.
root의 anchor/link와 imported definition의 anchor/link를 분리하고, 각 instance에
원본 파일·revision·digest·node·span을 유지한다. 같은 정의를 두 번 사용하거나
원본에서 지워지는 논리 port에도 연결을 보존한다. canonical source closure를
다시 컴파일해 package의 provenance를 검증한다. 독립 검토에서 10개 변조 후보의
거절과 standalone artifact 세 개의 동일성을 확인했다.

소스 `a5c3ef9d3d4998c9d9b551e1865b0073232a3fb1`의 공식 build150은
`2026-10-28T16:14:31.901Z`에 exit 0으로 완료됐다. 13 gate, Rust441,
주 Node3813 pass / 18 TODO / 0 fail, 별도 CLI console15 pass다.
verification SHA-256은 `c971ce5f1cc8ed2cf4d1c170ca321932c298379daa0bd5f9b419bd368d33b137`이다.
로컬 기록은 `build/evidence/build150/`에 보존했다.

같은 소스에서 Lean 4.19.0의 기대 실행 결과 64개가 통과했다.
완료 시각은 `2026-10-28T16:08:28.670Z`이며 verification SHA-256은
`b1dd5ff9f412891201e8757aa95d368167293427687c4552a68f41446acf1290`이다.
별도 coverage 검사는 함수469/469(100%), 줄90.10%, V8 ranges88.17%였다.
보고서 SHA-256은 `a48354d032647b2ff6c179327df8da3d4cfe77b627175f3f351fa4e16fc3bed3`이다.

PR596의 head66dbd11과 PR597의 head6403cae는 모든 필수 CI가 통과했다.
PR598의 heada5c3ef9도 [전체·coverage·frontend-pin 검사](https://github.com/callin2/ghostflow-language/actions/runs/40722998085)와
[Lean 검사](https://github.com/callin2/ghostflow-language/actions/runs/40722997779)가 통과했다.
이 확인은 해당 head의 검사 결과다. 병합과 전체 컴파일러 증명을 뜻하지 않는다.

현재 다음 세 단위를 병행한다.

- #290/#302에서 실제 TemporarySettingsHost의 완료 scan에 인스턴스별 state·timer·setting 관측을 연결한다.
- #211에서 requested/safe를 기존 applied ledger와 분리해 집계하고, 피드백이 없을 때 confirmed를 Unknown으로 반환하는 실제 실행 경로를 만든다.
- #590에서 Lean이 원본 Bool module의 전체 envelope를 재구성하도록 보강한다. 기존 JS 검증기가 거절하는 metadata 변이도 Lean kernel 자체에서 거절되는지 확인한다.

이 세 단위는 구현 중이며, 이 기록의 통과 수나 Reference 완료 수에 포함하지 않았다.


## build156: 실제 관측·단계 집계와 전체 Bool 모듈 증명

[PR599](https://github.com/callin2/ghostflow-language/pull/599)는 다음 세 단위를 통합한다.

- 조합 프로그램의 실제 완료 scan에서 instance별 state·timer·setting을 관측한다. 원본 closure의 파일·revision·digest·node·span을 유지한다. 조회는 실행을 진행하지 않으며, commit 뒤 관측 투영에 실패해도 같은 scan을 다시 실행시키지 않는다. 조합 binding과 explanation 연결은 #290/#302에 남는다.
- #211의 requested/safe 집계를 Rust scan 소유자에 연결했다. 같은 소스에서 request 20초, 저수위 차단으로 safe 0초, apply receipt 없음, feedback 없음이 각각 구분된다. 누락·재부팅 경계·저장하지 못한 revision은 Unknown으로 남는다. REF-03-021은 실제 native/WASM 관찰과 일치하며 이 묶음의 Reference TODO는 18개에서 17개로 줄었다.
- Lean이 Bool 모듈 전체 바이트를 원본 투영에서 재구성하고, 그 일치에서 실제 코드 조각과 모든 값 조합의 tick 동작을 증명한다. 이전 인증서가 놓쳤던 transition target metadata 변이는 새 인증서에서 거절된다. 이는 증명 범위의 보완이며 기존 JavaScript 검증기의 취약점으로 보고하지 않는다.

최종 소스는 `2a16c9877b4127ed28bda409f7fcc2234f1882db`다.
공식 build156은 `2026-10-28T17:14:45.959Z`에 exit 0으로 완료됐다.
13 gate, Rust441, 주 Node3835 pass / 17 TODO / 0 fail, 별도 console15 pass다.
verification SHA-256은 `0fce403dfb6b4c53c58a269c5c2bcbca0445f28c8e6669c8099336d38a05d28b`다.
WASM SHA-256은 `fdd4811caa17e823a6535345245b9c511c14cf8aaaf6ad3ca9515ad165272775`다.
기록은 `build/evidence/build156/`에 보존했다.

같은 소스의 Lean 검사는 `2026-10-28T17:08:52.743Z`에 완료됐다.
실제 Lean 호출81개는 성공26개와 의도된 거절55개이며, 별도 JavaScript admission 거절11개도 통과했다.
합계92개는 증명 정리 수가 아니다. 보고서 SHA-256은
`7c4aee629ce4047b027beac89052558f195bca06b604d3adbfc032acc371c4f0`다.
실행 기록은 `build/bool-wave5-final-590/verification.json`에 있다.
원본 파서·typed projection과 실제 Rust 구현의 모델 대응은 아직 증명하지 않았다.

별도 coverage gate도 exit 0이다. 함수469/469, 줄7314/8108(90.21%), V8 ranges5503/6234(88.27%)다.
V8 range는 문법상의 branch coverage와 구분한다. 보고서 SHA-256은
`19f0d7413ab09d9b8091941e79cb22023c341ef25d3c631e9428e1590ba8579e`이며
`build/evidence/coverage-2a16c98/`에 보존했다.

독립 검토에서 applied-only 집계의 잘못된 scalar/context profile 선택을 찾아 고쳤다.
네 단계 단독 선언과 기존 applied limit/count_events 바이트 동일성도 확인했다.
첫 통합 검사에서 FramedHandle 테스트 두 곳의 새 필드 누락이 발생했다.
공통 생성자를 재사용하도록 수정한 뒤 Rust WASM 테스트21개와 전체 검사가 통과했다.
실패 기록은 `build/evidence/wave5-rust-test-fixture-failure/`에 보존했다.
검증 완료 여부를 분류하는 feature-status catalog·validator도 source identity에 포함했다.

최신 dev `6937b8c95c0b028fbf107b41baf52ae634722fda`에는 PR596·597·598이 병합돼 있다.
그 tree는 검증했던 `a5c3ef9`와 동일하다. 이 세 병합을 이 작업자가 실행한 것은 아니다.
PR599의 병합 및 현재 CI 결과는 이 기록의 로컬 통과와 별도로 추적한다.

다음 묶음은 #249의 source-bound Percent 중재, #293의 실제 설치 경로에서 물리 Unknown 표시,
#590의 Lean raw module reader와 초기 상태부터 반복 실행하는 증명이다.
#293은 물리 증거 부재를 가상 실행 중단 조건으로 추가하지 않는다.

## build160: Percent 중재·설치 판정과 원시 모듈 읽기 증명

사용자 의도가 실제 실행에서 유지되는지 확인하는 다음 세 단위를 완료했다.

- #249의 한 scalar control에서 Percent 요청70과40을 max로 선택하고 ceiling20으로 제한한다. 요청·제한·선택·최종값·오류 원인은 실제 Rust 기록에 남고 native/WASM 결과가 일치한다. 독립 producer 모듈과 PID 통합은 범위 밖이다.
- #293의 설치 및 프로그램 교체 소유자가 metadata admission과 물리 적합성 Unknown을 함께 보존한다. 물리 증거가 없어도 가상 실행은 계속된다. 독립 검토가 찾은 변경 가능한 getter의 identity 불일치는 검증 전에 데이터를 소유하도록 수정했다.
- Lean 원시 module reader가 전체 바이트를 읽고 초기 Bool state를 복원한다. canonical 재인코딩과 남은 바이트 검사를 거쳐 받아들인 모듈은 초기 상태부터 임의 횟수의 실행에서 모델과 일치한다. 중복 transition target을 허용하는 parser-only 변형은 반례로 거절된다.

최종 실행 소스는 `0c5c00a03634d725bdfdf4b9b70fde8e324969e4`다.
공식 build160은 `2026-10-28T18:09:05.388Z`에 exit 0으로 완료됐다.
13 gate, Rust441, 주 Node3848 pass / 15 TODO / 0 fail, 별도 console15 pass다.
verification SHA-256은 `d35652843975f46c60b85b7bf88c495af6fdd6bfc416747ca6b7e4fc1382a8a9`다.
WASM SHA-256은 `1d0af12b5c6aa73ff7815027f0c8f8472f43f27d2b0d7af5ab04a2202a08c398`다.
기록은 `build/evidence/build160/`에 보존했다.

첫 통합 검사는 framed replay의 고정 예상 크기216바이트가 실제224바이트와 달라 실패했다.
별도 wasm32 컴파일러 `size_of` probe로224바이트를 확인했다. 실행기는 이미 실제 크기를 계산했다.
테스트 예상값 갱신 후 예산1바이트 부족 거부와 정확한 예산 허용을 포함한22개 검사가 통과했다.
실패와 LLVM probe는 `build/evidence/wave6-replay-failure/`에 보존했다.

Lean 보고서는 `67545be0eb07320889b219c5b1971b64b9f56641`에서
`2026-10-28T17:51:01.685Z`에 완료됐다. 실제 Lean 호출119개는 성공58개와 의도된 거절61개다.
별도 JavaScript admission 검사11개도 통과했다. 합계130개는 정리 수가 아니다.
보고서 SHA-256은 `6d1f54e184574e9a77299961ee900c2e8c005974a28882fbca9d22eaa2e9fe48`다.
이후 replay 테스트 한 파일만 바뀌었다. 보고서에 묶인106개 파일의 SHA-256은 최종 실행 소스와 모두 같다.
기록은 `build/bool-wave6-590/`에 있다. 원본 파서와 typed projection, 수치 연산,
모델과 production Rust 사이의 일반적 대응은 전체 컴파일러 정확성의 미증명 범위로 남는다.

지정된 coverage 대상은 함수475/475, 줄7438/8235(90.32%), V8 ranges5560/6301(88.24%)다.
전체 저장소의 모든 함수나 문법 branch 비율을 뜻하지 않는다. 보고서 SHA-256은
`b6d9cebdf04af337561d4e21ee9f31af5005109df796ce67d429c89bfd718b5e`이며
`build/evidence/coverage-0c5c00a/`에 보존했다.

PR599의 필수 CI는 모두 통과했지만 `2026-10-28` 조회 시 아직 미병합이다.
다음 단위는 #287의 실제 알람 발생·해제 이력과 Bool 입력 오류 복구 증명이다.
알람 독립 검토에서 원문에 없는 intent anchor를 허용하는 공유 복원 결함을 재현했다.
수정 과정에서 기존 profile 문서 복원 회귀도 발견해 보완 중이다.
이 후속 단위의 결과는 build160이나 TODO15개 수치에 포함하지 않았다.

## build164: 알람 발생 기록과 Bool 입력 오류 복구 증명

실행 중 짧게 발생했다 사라진 알람도 실제 Rust scan owner가 발생·해제 순서로 기록한다.
조회는 실행 상태를 바꾸지 않으며, 실패한 스캔은 알람 이력을 진행시키지 않는다.
유한 보존으로 누락된 구간은 명시적인 gap으로 전달한다. 실제 native/WASM 실행에서
동일한 전체 레코드와 거절 동작을 확인했다. REF-05-027을 구현 검증 대상으로 전환했다.

독립 검토가 찾은 원문에 없는 intent anchor 위조를 canonical source replay로 거절한다.
이 수정 과정에서 발견한 compact-profile 복원 회귀도 고쳤다. 원본 소스·바이트의 출처 복원과
외부 프로필을 통한 설치 허용 판단을 구분한다. 일반 컴파일의 프로필 검사는 계속 적용된다.
최종 독립 검토의 관련 검사124개가 통과했다.

최종 실행 소스는 `20ac08ec0a5d54915132bad15ae9f4f4a402bd7a`다.
공식 build164는 `2026-10-28T18:45:05.207Z`에 통과했다.
13 gate, Rust441, 주 Node3865 pass / 14 TODO / 0 fail, 별도 console15 pass다.
verification SHA-256은 `6d1ec1714ff3eee74bfd0a369629765e707e7e56c1a8dc29250ee70e68afc972`다.
WASM SHA-256은 `98d3bb473dc90f68681d974277dc01b17e69516d45c69e55147b7805a608d423`다.
기록은 `build/evidence/build164/`에 보존했다. 첫 통합 시 Rust 형식 검사에서 발견한
세 파일의 차이를 수정한 뒤 전체 검사와 두 Lean 검사를 같은 소스에서 다시 실행했다.
실패 기록은 `build/evidence/wave7-format-failure/`에 있다.

기존 Bool translation 검사는 실제 Lean 호출119개(성공58, 의도된 거절61)와
별도 JavaScript admission 검사11개가 통과했다. 이130개는 정리 개수가 아니다.
보고서 `build/bool-wave7-final-590/verification.json`의 SHA-256은
`6906571055b9f44221ac582538878eccb1ec3cb4635859c7b746ee5679d41f9e`다.

새 Bool 입력 검사는 `di |> recover(false)`의 정상 false와 오류 대체 false를 구분한다.
Disconnected·Stale·Invalid·NotReady와 이전 Bool payload에 관계없이 복구 경로를 증명한다.
실제 Lean 호출44개(성공32, 의도된 거절12)가 통과했다. 보고서
`build/bool-sensor-wave7-final-590/verification.json`의 SHA-256은
`709e39195fa21d363a7c635778ca78868564d7b91bca3340a4af8767ef908fe2`다.
두 보고서의 원본 파일107개와145개 해시는 모두 최종 실행 소스와 일치한다.
수치 연산 법칙은 명시적 가정이다. 일반적인 production f64 대응은 아직 증명하지 않았다.
실제 native/WASM 값 비교50개와 경계 검사25개는 공식 host gate에 등록한 별도 검사로 통과했다.

coverage 검사2539개가 통과했다. 지정된 대상 함수475/475, 줄7439/8235(90.33%),
V8 ranges5564/6304(88.26%)다. 전체 저장소나 문법 branch 비율을 뜻하지 않는다.
보고서 SHA-256은 `591859258319e1eef0d444dfd0ec51da2cf9a5791da9f107119530f96cf69547`이며
`build/evidence/coverage-20ac08e/`에 보존했다.

PR599는 이후 외부에서 dev에 병합됐고, PR600의 필수 CI는 모두 통과했다.
이 작업자가 두 PR을 병합한 것은 아니다. 다음 단위는 합성 프로그램의 실제 출력 원인과
설치·설정 식별자 연결, 그리고 Lean이 원본 문서를 직접 읽는 제한 문법 검증이다.
원본 파서 전체·전체 언어·실제 Rust 실행기 대응을 포함한 컴파일러 전체 증명은 계속 미완료다.

## build169: 설치된 합성 실행과 인스턴스별 출력 설명

하나의 InstalledControlHost가 실제 합성 설정 런타임을 소유한다. 같은 완료 scan에서
원본 문서·import closure·instance·설정·설치 binding과 입출력 endpoint를 연결한다.
입력 계약 거절은 설정 적용 전에 일어나며, 잘못된 교체 후보는 기존 소유자 전체를 보존한다.
승인한 binding 교체는 새 run으로 시작한다. 물리 적합성이 Unknown이어도 가상 실행은 진행한다.

REF-06-002는 east의 상태와 설정을 바꿔도 west의 상태·타이머·설정·경로를 유지하는
native/WASM 및 설치 호스트 검사로 연결했다. REF-06-016은 같은 definition을 사용하는
east/west 각각의 실제 출력 설명을 원본 노드·위치·리비전·해시·설정·서로 다른 endpoint와
대조한다. 두 사례를 등록해 미실행 TODO는12개다. 이전 기록은 REF-06-016에 더 넓은
6.7절의 제약 설명 기능까지 묶었다. 정확한 사례의 완료 조건과 이를 구분해 수정했다.
requested부터 safe까지의 전체 제약 원인과 config/timer 식 설명은 여전히 미완료다.

독립 검토에서 실제 WASM 스캔이 0으로 나누기 오류로 실패한 뒤에도 이전 완료의 설명을
현재 설명으로 돌려주는 결함을 재현했다. 실행 소유자가 현재 완료 표식을 관리하도록
수정했다. 실제 dispatch 실패는 현재 설명을 무효화하고, 실행 전 입력 거절은 직전 유효
완료를 보존한다. 이미 반환한 과거 기록은 변경하지 않는다. 관련 실패·거절 검사가 통과했다.

최종 실행 소스는 `cf1844700ca8835e08a69d13bf60fadc8a22d493`다.
공식 build169는 `2026-10-28T19:36:16.486Z`에 exit0으로 완료됐다.
13 gate, Rust441, 주 Node3884 pass / 12 TODO / 0 fail, 별도 console15 pass다.
verification SHA-256은 `d0728d6606d0ce401b945aadd237a48c90043a9664f70d33950b04a9b5b842c2`다.
WASM SHA-256은 `98d3bb473dc90f68681d974277dc01b17e69516d45c69e55147b7805a608d423`다.
원본 로그·identity·receipt는 `build/evidence/build169/`에 보존했다.

첫 공식 build166은 통과했으나, 별도 병렬 coverage에서2556개 중1개가 공유 WASM 파일
읽기에 실패했다. 캐시된 Cargo build도 파일을 교체하는 것을 재현했다. 80회 빌드와 겹친
21,069회 읽기 중57회 ENOENT가 발생했다. coverage도 기존 공식 검사처럼 테스트 파일을
직렬 실행하고600초 제한을 적용했다. 테스트 목록이나 기준은 낮추지 않았다. 독립 검토와
집중12개·원래 writer/reader25개 검사에 이어 전체 coverage2557개가 exit0으로 통과했다.
실패 로그는 `build/coverage-wave8.log`, 재현 근거는 #590 comment6478679499에 있다.

지정된 coverage 대상은 함수476/476, 줄7450/8246(90.35%), V8 ranges5570/6312(88.24%)다.
전체 저장소나 문법 branch의 비율이 아니다. 보고서 SHA-256은
`e09fdcd0da40d385eadd4c633144864c2a782779eac9607d5d21bf940e6c6b86`이며
`build/evidence/coverage-cf18447/`에 보존했다. 게시 직전 재조회에서 PR600·601이 외부에서
dev에 병합된 것을 확인했다. dev `5f64f4eb702535cbc72c97dc158fa900b21e0383`의 tree는
검토된 선행 head `f2f88f2`와 같다. 이 작업자는 두 PR을 병합하지 않았다.

다음 단위는 독립 Lean reader가 원본 문서 바이트를 읽어 실제 artifact 및 metadata와
대조하는 증명이다. 그 뒤에는 센서 복구와 상태 전이를 모든 입력 이력에 대해 합성한다.
이 후속 단위와 생산 Rust refinement는 build169의 완료 주장에 포함하지 않는다.

## build170: 원본 문서 바이트에서 시작하는 Lean 증명

Lean의 독립 reader가 원본 `.ghost.md` UTF-8 바이트, 제한된 문서 envelope, 토큰과
이름을 읽는다. JavaScript가 제안한 AST나 프로필만으로 소스의 의미를 승인하지 않는다.
각 인증서에서 원본 읽기 결과와 실제 compiler가 만든 전체 원시 artifact를 따로 검사한다.

Bool 상태 프로필은 초기 상태에서 임의 횟수의 tick trace를 증명한다. 센서 프로필은
변경하지 않은 canonical `input Bool |> recover(false)` 문서를 읽고, 구문을 소비하며
배정한 origin/site와 실제 Result metadata까지 연결한다. 모든 Reading과 이전 payload에
대해 정상 false와 오류를 복구한 false가 관측에서 구분됨을 증명한다.

독립 검토는 별도 Lean 모듈 빌드와 원본 고정·실행물/metadata 동반 위조를 검사했다.
동반 위조는 원본 읽기 equality에서 거절됐다. 잘못된 HTML anchor 위치와 문서 문맥도
거절됐다. 이전 reserved `__gf_` 이름 허용 문제를 수정했고, 최종 전체 검사에는 그 거절도
포함했다. 첫 sensor 경계 검사의 recursion 예산 실패는 별도로 보존한 뒤 검사 예산을
명시하고 재실행했다. 실제 proof의 가정이나 문법을 느슨하게 바꾸지 않았다.

최종 실행 소스는 `ce7d1ce9`로 시작하는 커밋이다. 공식 build170은
`2026-10-28T19:51:48.518Z`에 exit0으로 완료됐다. 13 gate, Rust441,
주 Node3887 pass / 12 TODO / 0 fail, 별도 console15 pass다.
verification SHA-256은 `dfa874110209c65946fdad72fe51f1d9fd28167fdd8f962d8acaddc283d26a2f`다.
WASM SHA-256은 `98d3bb473dc90f68681d974277dc01b17e69516d45c69e55147b7805a608d423`다.
기록은 `build/evidence/build170/`에 보존했다. 이후 병합한 선행 PR602의 변경은
앞 절의 결과 보고서와 dev 병합 이력이며 실행 및 증명 소스는 바뀌지 않았다.

| 증명 검사 | 실제 결과 | 보고서 SHA-256 |
|---|---|---|
| Bool 원본·module·byte-PC | Lean173회:106성공·67예상거절, 별도 JS admission11개 | `ee18d623320137b611291b0c2a66f74ae657d3b6541c06b4fab736d66b7f0a51` |
| 센서 원본·artifact·metadata·관측 | Lean125회:94성공·31예상거절 | `c80cded0cc4a0899fe156c866e2e29b902e8bfc73475174ce3ca5b90e7c09832` |

이는 정리 수가 아니라 기대 실행 결과 수다. 완료 시각은 각각
`2026-10-28T19:48:01.224Z`, `2026-10-28T19:44:06.993Z`다. 각 보고서가 묶은111개와
156개 소스 해시는 모두 통합 실행 소스와 일치한다. 근거는
`build/bool-wave9-590/`와 `build/sensor-wave9-590/`에 있다.
원본 및 bridge Node16개와 문서 검사도 통과했다. 첫 별도 작업 공간의 Node 실행은
의존성 설치 전이라 실패했고, 잠금 파일대로 offline 설치 후 재실행했다.

이 단위는 실험·그 검사·문서만 변경했다. production code와 coverage 검사 목록은
build169와 같으므로 앞 절의 coverage 근거를 유지하며 새 coverage 실행으로 세지 않는다.
sensor 증명 runner의 선택적 runtime differential은 실행하지 않았다. 같은 생산 경로의
native/WASM 비교는 공식 host gate의 별도 등록 검사에서 실행됐다.

허용 문법은 전체 GhostFlow나 CommonMark가 아니다. 자연어 의도와 코드의 일치,
파일 전달 경로, 일반 production parser 의미, Rust 실행기와 모델 사이의 대응은
이 증명으로 확정하지 않는다. 센서 수치 연산의 SmallNumberLaws도 명시적 가정으로 남는다.
다음 단위는 입력 복구와 상태 전이를 임의 입력 이력에 대해 합성하고, 별도로 실제
Rust Reader 함수에서 Lean으로 이어지는 추출 도구의 적용 가능성을 확인하는 것이다.

## build173: 센서 복구와 상태 전이를 임의 입력 이력에 대해 합성

한 Bool 입력을 `recover(false)`로 처리하고, 정상 true인 스캔마다 Bool 상태를 뒤집은 뒤
그 후보 상태를 출력하는 제한 프로필을 추가했다. 초기값은 true/false 모두 허용한다.
이는 상승 에지 감지가 아니다. true를 유지하면 매 스캔 상태가 바뀌며, false 또는 오류이면
현재 상태를 보존한다. 프로필 문서와 실제 예제도 이 의미를 명시한다.

원본 문서 reader가 배정한 입력 origin과 recover site, 독립 reader가 실제 전체 바이너리에서
읽은 transition/output 코드, 실제 compiler의 metadata를 연결한다. 복구 정리는 임의의
기존 스택 꼬리와 오류 기록을 보존하고, 상태 정리는 old state와 candidate state를 구분한다.
이들을 귀납적으로 합성하여 모든 유한 입력 이력의 상태·출력·Result 기록을 증명한다.

첫 독립 실행은 네 경계 예제의 `decide`가 필요한 판정 인스턴스를 찾지 못해 실패했다.
해당 닫힌 식의 계산에 맞게 `rfl`로 고쳤다. 정리·가정·실행 의미를 바꾸지 않았다.
실패 근거는 별도 작업 공간의 `build/sensor-state-proof-590/`에 보존했다. 수정본에 대한
독립 검토에서 열린 P1/P2 결함은 없었고, 통합 소스에서도 커널 검사를 새로 실행했다.

통합 검증 소스는 `645b6899f325b0d1d24a1398f2f70af8d9f44787`다.
Lean 80회(성공48·기대거절32)가 `2026-10-28T20:14:10.520Z`에 exit0으로 끝났다.
151개 기록 소스 해시가 모두 일치한다. 영수증 SHA-256은
`9940c5325ab03e18dec0b26950fd458bbbda8817408decbd1b93eaab48c28f5c`이며
근거는 `build/sensor-state-wave10-590/`에 있다.

실제 native/plain-WASM/framed-WASM 관측168개도 같은 최종 증명 단위에서 통과했다.
이 검사는 build169의 확인된 실행물을 복사해 재사용했고 Rust/Cargo100개 소스 해시를
대조했다. fresh runtime build나 수학적 Rust 대응 증명으로 세지 않는다. 최종 관측 영수증은
`build/evidence/sensor-state-differential-0a5fb1d/differential.json`이며 SHA-256은
`75e082bbf4bfc4a4366634a00991a89b3549829d36f60f747e45f08f044acd7b`다.

공식 build173은 `2026-10-28T20:18:39.101Z`에 exit0으로 완료됐다. 13 gate, Rust441,
주 Node3891 pass / 11 TODO / 0 fail, 별도 console15 pass다. 영수증 SHA-256은
`cb0722c04d8d9eece0409268f033d4005579eaef1e01f8db3e1d8a7240e9e261`이며
원본 로그·identity·receipt는 `build/evidence/build173/`에 보존했다. WASM 해시는
앞선 build169/170과 같은 `98d3bb473dc90f68681d974277dc01b17e69516d45c69e55147b7805a608d423`다.

같이 등록한 REF-03-018은 10초 ON → 10초 OFF → 20초 ON에서 경과40초·연속ON20초·
작업 누적ON30초를 구분한다. 작업은 기존에 허용한 Station 세션 하나, 관측 단계는 applied다.
WASM에서 세션의30초를 직접 조회하고, native/WASM의 별도 시간·ledger 관측도 검사한다.
범용 작업 문법, 여러 세션을 묶는 누적, 실제 접점 확인을 추가로 완료한 것이 아니다.
정확한 사례를 실행 검사에 연결하여 TODO가12개에서11개로 줄었다.

생산 실행 코드는 변경하지 않았다. coverage 수치는 build169의 지정 대상 측정으로 남기며
새로운 측정이라고 주장하지 않는다. 이전 원본 증명 PR602·603은 각 고정 head의 GitHub
검사가 모두 통과했다. 전체 compiler, production Rust/model 대응, f64 SmallNumberLaws,
원본 전달 경로와 장치 동작은 여전히 전체 증명의 남은 범위다. 다음 실험은 생산 Rust
Reader의 실제 본문을 Charon/Aeneas로 추출하고 Lean에서 불변조건부터 확인하는 것이다.

## build176: 생산 Rust Reader 추출물의 첫 커널 증명

생산 Rust `Reader::new`와 `Reader::finished` 본문을 고정된 Charon/Aeneas로 추출했다.
생성 Lean 파일을 그대로 보존하고, 초기 cursor0·bytes 보존·범위 불변식·종료 판정과
잔여 바이트 리스트의 관계를7개 정리로 증명했다. 마지막 관계는 cursor가 범위 안에 있다는
전제가 필요하며, 전제를 제거했을 때의 실제 반례도 확인했다. outer Result의 panic·divergence를
평범한 파싱 거절로 바꾸지 않았다. 독립 검토도 별도 출력 경로에서 커널 검사를 통과했다.

통합 검증 소스는 `1bcb1771f69d78ca1c1d78f391ef67eea232163d`다.
Lean4.35 실행은 `2026-10-28T20:52:38.906824Z`에 exit0으로 완료됐다.
정리7개를 검증하는 baseline과 잘못된 초기 위치·반전된 종료 조건·누락된 범위 전제의
거절3개가 통과했다. 기록된8개 입력 파일 해시는 모두 일치한다. 영수증 SHA-256은
`d8a2a82d1f213cdd702d5d6dcc76f764775c5f38a95f6fd9a5558f4aee079437`이며
`build/rust-reader-wave11-590/`에 보존했다. 표준 Lean 공리3개만 허용한다.

검증기 자체의 잘못된 성공 기록도 막았다. 새 실행은 검사 전에 원자적으로 `running`을
기록하고, 정상 종료 시 최종 상태를 바꾼다. 강제 종료·일반 실패가 예전 `passed`를 남기지
않는지 검사한다. assertion을 제거하는 Python 최적화 옵션은 명시적으로 거부한다.
이3개 회귀 검사를 공식 host gate에 등록했으며, 실제 Lean 실행과는 별도로 센다.
과거 영수증은 ignored build evidence로 보존하고 source에서 제거했다.

공식 build176은 `2026-10-28T21:02:51.206Z`에 exit0으로 완료됐다.14 gate, Rust441,
주 Node3891 pass /11 TODO /0 fail, 별도 console15 pass 및 Python3 pass다.
verification SHA-256은 `2c05ac70cffead88937815489b7d837ef84017d58d00696694816f9e74cf2261`이다.
WASM은 앞선 build173과 같은968394bytes 및
`98d3bb473dc90f68681d974277dc01b17e69516d45c69e55147b7805a608d423`이다.
실행물과 전체 로그·identity·receipt는 `build/evidence/build176/`에 보존했다.
첫 시도는 GitHub 이름 해석이 제한되어 빌드 번호 발급 전에 종료됐고, 허용된 네트워크에서
정상 경로로 다시 실행했다. 빌드 번호를 우회하거나 임의로 정하지 않았다.

`take`/정수 reader는 오류 문자열과 ownership 표준 함수의 추출 의존성이 남는다.
실제 `Value::value_type` 추출물도 고정된 Lean backend에 `F64`가 없어 컴파일되지 않았다.
임의의 타입·추가 공리를 넣어 통과시킨 것으로 세지 않는다. 자세한 도구 판본과 실패는
[Rust proof report](../../experiments/rust-reader-validation/proof-report.md)와
[F64 진단](../../experiments/rust-reader-validation/ValueType-extraction-diagnosis.md)에 있다.
Rust compiler, Charon/Aeneas translator, 표준 라이브러리 모델은 신뢰 경계이며
호스트64bit 추출은 ESP32 실행 증명이 아니다. 새 Rust 증명은 로컬 실행·독립 검토 근거다.
기존 Lean4.19 CI가 이4.35 증명까지 실행한다고 주장하지 않는다.

[현행 증명 의무 목록](2026-10-29-compiler-proof-obligations-590.md)은7개 진입 분기와
GFB23/24 및 별도25 wrapper까지 구분한다. 이전 수치와 미해결 결함을 현재 것으로 재사용하지
않으며 전체 컴파일러 의미 보존 의무는 계속 열어 둔다. 다음 독립 검증에서 발견한
binding 교체 시 일반 설정 소실은 #295에서 별도 실패 재현과 수정으로 진행한다.

## build178: 센서 연결 교체에서 사용자의 설정 보존

REF-06-007의 parameter·운영 설정·의존 문서·설치 binding을 실제로 각각 변경하는
부분 검사를 만들다가 결함을 발견했다. `allow=false`로 설정하고 같은 프로그램의 센서
binding만 교체하면, 기존 host가 설정을 초기값 true와 revision0으로 되돌렸다.
수정 전 검사 `cb5056a06df69eb873cf3bac4335ee96eb9427ef`를 별도 폴더에서 다시 실행해
실제 `0 !== 1` 실패와 exit1을 보존했다. 관련 컴파일러·host·검사 소스는 통합 전 실패 커밋
`1e54e5b`와 동일하다. 실패 영수증은 `build/evidence/binding-settings-regression-cb5056a/`
아래에 있으며 SHA-256은 `dc1729aebc48d1d0f8c0f64ad9d02d8ce1a86a208175b228425ed7ff1bf6dfdb`다.

교체 후보가 기존 host 소유의 설정 checkpoint를 검증·복원한 뒤에만 게시하도록 고쳤다.
일반 설정 Result와 revision, 설정 이력을 보존하며 VM 상태·타이머·입력 수집은 새 실행으로
시작한다. Run 임시 설정은 첫 새 실행 판단 전에 반환하고 Until 설정은 기존 기한까지
유지한다. 후보 준비 중 합성 host의 scan을 거절해 checkpoint 이후 설정 유실도 막았다.
후보 준비 실패는 기존 실행을 보존한다. 새로운 외부 checkpoint API는 추가하지 않았다.

독립 검토는 집중13개를 통과했고 열린 P1/P2 지적은 없었다. 통합본의 관련 검사36개도
통과했다. 전체 검증의 고정 소스는 `dab5051c0f6d3bdc9a25aad88f48eb45a8ded8a6`다.
공식 build178은 `2026-10-28T21:20:44.794Z`에 exit0으로 완료됐으며14 gate, Rust441,
주 Node3894 pass /11 TODO /0 fail, 별도 console15와 Python3 pass다. 영수증 SHA-256은
`d315a143b2961e61d05acdf5c372ce090dc15e85f77dfb71b906c020f150efb3`이다.
전체 로그·identity·receipt는 `build/evidence/build178/`에 보존했다.

전체 검증 종료 후 coverage를 순차 실행해2560개 검사를 통과했다. 기존 지정12개 JS 파일의
함수476/476, 줄90.35%, V8 block range88.25%다. 수정한 installed host 자체는 이12개
측정 대상에 포함되지 않으므로 이 수치를 해당 host의 coverage로 주장하지 않는다.
coverage 영수증 SHA-256은 `a830a9c94e390ecca58752af7ba4a050d05d62f56d65bd4f7bce2c561f4ce86d`다.

#295는 전체 완료로 닫지 않는다. 네 실제 소유 경로의 부분 검사를 추가했으나 통합 변경
계획 출력은 아직 없고, parameter가 있는 합성 manifest는 현재 설치 host의 허용 범위 밖이다.
이번 근거는 참조 host 실행이며 Device 영속 저장·재부팅·물리 출력 확인을 뜻하지 않는다.

## build182: 생성된 원본 프로그램의 Bool 인증서

고정 seed `0x590b001`로16개 정본 문서를 생성했다. 상태1–4개·출력1–3개이며 이전 상태
교환, 생략된 상태의 보존, 앞선 참조, 후보 상태 출력, 분기·부정·논리 연산을 포함한다.
실패한 사례를 버리거나 다시 뽑지 않는다. 각 원본을 실제 compiler로 컴파일하고 원본 UTF-8
바이트와 전체 GFB를 기존 독립 reader 및 모든 tick 수에 대한 초기화된 실행 정리에 연결했다.
이는 고정된 제한 Bool 사례군의 인증이며 임의 GhostFlow 프로그램 전체의 증명이 아니다.

소스 초기값과 GFB 초기값을 각각 바꾼 두 변이는 여전히 유효하게 컴파일·해독되지만,
기존 소스 또는 module과 같다는 Lean 명제에서는 거절됐다. 검증기의 기대거절 판정도
process 오류·signal·import/unknown identifier 오류를 통과로 세지 않도록 보완했다.
독립 검토는16개 사례의 원본·GFB·증명 입력·로그 해시와 두 변이의 실제 오류 위치를 확인했다.

통합 고정 소스는 `ded2875bbf3a5dd4c4a4f4d0528a8e93a6a8a4af`다. 강화된 판정으로 새로
실행한 Lean 검증은 `2026-10-28T21:42:19.790Z`에 exit0으로 끝났다. **Lean191회**
(성공122·기대거절69)와 별도 JS admission11개가 통과했다. 합계202를 Lean 실행 수로
세지 않는다.113개 입력 파일 해시가 모두 일치하며 receipt SHA-256은
`8b10da31be9da352c120e5bee6f03bb3b438490d58242d86b2b08a0845289585`다.
각 원본과 GFB·Lean 입력·로그는 `build/bool-generated-wave13-590/`에 보존했다.

공식 build182는 같은 고정 소스에서 `2026-10-28T21:41:17.559Z`에 exit0으로 완료됐다.
14 gate, Rust441, 주 Node3898 pass /11 TODO /0 fail, 별도 console15와 Python3 pass다.
receipt SHA-256은 `dffea02e0266dd3cf932ed42563e5ded3433ac8aaf774cb48fe841b85fd26886`이며
전체 로그·identity·receipt를 `build/evidence/build182/`에 보존했다. WASM은 앞선 build178과
동일한968394bytes 및 `98d3bb473dc90f68681d974277dc01b17e69516d45c69e55147b7805a608d423`다.
생산 compiler/runtime는 바뀌지 않았고 coverage를 새로 측정했다고 주장하지 않는다.

후속 검토에서 sensor·sensor-state 실행기에도 같은 기대거절 판정 중복을 확인했다.
공통 판정기로 묶고 실제 혼합 오류로 회귀를 확인하는 작업과 signed i32 코덱 검증을
다음 독립 단위로 진행한다. 전체 compiler·실제 Rust 의미 대응·물리 출력의 증명은 남아 있다.

## build183: signed i32 코덱과 공통 Lean 오류 판정

모든 `-2147483648 ≤ n < 2147483648`에 대해4바이트 little-endian 표현의 길이·바이트
범위·부호·왕복·정규성·유일성을 Lean으로 증명했다. 기존 base-256 증명 방식을 사용하며
생산 Rust나 Bool 모델을 바꾸지 않았다. 실제 compiler가 만든27개 경계값의 초기값과
리터럴54개를 전체 GFB 바이트의 정확한 위치에서 읽어 증명에 연결했다. 전체 module
reader와 원본 해석은 아직 이 수학적 코덱 정리의 신뢰 경계다.

통합 고정 소스 `8c4b407a46f596cffb950ea4a310adeb4accaf51`에서 Lean5회(모델·54개
바이트 증인 성공, 의도한 등식 거절3개)가 `2026-10-28T21:38:48.511Z`에 exit0으로 끝났다.
122개 입력 해시는 모두 일치한다. receipt SHA-256은
`6f63586907781cb0b3fc043a06abba39685d0fdd488355a9a498c116ed688b6a`이며
`build/int32-wave14-590/`에 보존했다. 재귀 깊이를 넘겼던 첫 시도도 별도 작업 공간에
보존했고 유한 한도를 명시한 뒤 다시 검사했다. 정리의 의미나 커널 검사를 생략하지 않았다.

build178의 실제 native/WASM 실행물을 해시와 Rust/Cargo100개 소스로 확인해 재사용했다.
native·plain WASM·framed WASM의2 tick씩, 총6개 trace가 원본 정수와 일치한다. 실제 WASM
로더가 수용한 변이3개는 각각65537→16777472, MIN→0, -1→16777215로 실행됐지만
원본 값과 같다는 인증서는 거절됐다. 재사용 관측이며 새로운 runtime build 또는 실제 Rust
전체 대응 증명으로 세지 않는다. 세부 범위는 [코덱 보고서](../../experiments/int32-codec-validation/proof-report.md)에 있다.

네 JS Lean 실행기의 process 판정을 `experiments/lean-outcome.mjs`로 모으고 각각 입력
해시에 포함했다. 정수 종료 코드·signal/process 오류·도구 오류·명시된 기대 진단을 검사한다.
Int 변이는 정확한 등식과 오류 하나라는 추가 조건도 유지한다. 실제 Lean 혼합 오류 로그에
기존 sensor-state predicate를 적용하면 잘못 통과했고 새 판정은 거절했다. 정상 성공,
의도한 명제 거절, 혼합 오류, import 오류의4개 실제 probe도 확인했다.

이 공통 판정으로 기존 sensor125·state80 로그를 해시 확인 후 재판정했다. 이는205개
기존 로그 감사이며 새로운 증명이 아니다. 영수증은 `build/lean-outcome-wave14-590/verification.json`,
SHA-256 `08517ada1594cea167c541470f82ba724d5cad731747072d556313d8495f0944`다.
build182의 Bool191개 로그도 같은 방식으로 통과했으며 별도 receipt SHA-256은
`8598c5fb50844070c0a5dbbcfa82a6bf4d21169d8b5b1c34cb2fef4b073094bd`다.
독립 검토에서 공통 판정 연결·해시 목록·Int 추가 조건의 열린 P1/P2 결함은 없었다.

공식 build183은 `2026-10-28T21:51:26.651Z`에 exit0으로 완료됐다.14 gate, Rust441,
주 Node3907 pass /11 TODO /0 fail, 별도 console15와 Python3 pass다. 전체 receipt SHA-256은
`1f1d03c4919cf4bd8b7be803069d8a158e46a327438bc4e7d1306f2177ca5d1f`이며
로그·identity·receipt는 `build/evidence/build183/`에 있다. WASM 해시는 build182와 같다.
생산 compiler/runtime 변경은 없고 coverage 신규 측정 및 장치 시험은 주장하지 않는다.

전체 증명은 계속 열려 있다. 다음 단위는 실제 Rust 표준 정수 checked 연산의 추출이며,
직접 생성된 본문과 기존 Aeneas primitive 모델을 구분해 의존성을 기록한다.

## build187: 실제 Rust 정수 추출의 한계와 감사기 보완

생산 `ghostflow-core`의 Cargo 문맥에서 실제 표준 라이브러리 `i32::checked_add`와
`checked_neg`를 세 번 추출했다. 마지막 시도는 두 본문을 transparent Structured LLBC로
얻었지만 Aeneas가 외부 진입 함수를 Lean 출력에 남기지 않았고, 남은 종속 함수에는
미지원 `cold_path` 선언이 있었다. 모두 증명 입력으로 거절했다. 새 Rust 정리나 커널
증명 성공은 없다. 정확한 도구 핀·원본 해시·실패 원인은 [추출 보고서](../../experiments/rust-int-primitives/proof-report.md)에 있다.

감사기는 오래된 성공 영수증, 자기 자신을 포함하는 해시, 미승인 선언, 로컬 wrapper를
거부하도록 보완했다. 실제로 호출되는 `charon-driver`를 포함해 도구·helper·생산 소스의
실행 전후 해시를 검사한다. Python 회귀8개와 독립 검토가 통과했다. 이 구조 검사는 증명
입력 후보의 허용 검사이며 완전한 source-equivalence나 Lean 증명은 아니다.

고정 소스 `4fb732ff9c9fcbe7d4dacda1f52f706ff2a48787`에서 과거 세 산출물의 사본을 다시
감사해 모두 exit1·rejected를 확인했다. 원본 파일 해시는 그대로였다. 새 추출이나 Lean
실행을 반복하지 않았다. `2026-10-28T22:16:06.120018Z`의 재검사 receipt는
`build/rust-int-guard-wave15-590/verification.json`, SHA-256
`f88f2452b03efd003c84b68903acc3d2e0c1b972c2730522b842c2bb5e3a4035`다.

공식 build187은 같은 소스에서 `2026-10-28T22:24:37.228Z`에 exit0으로 끝났다.
15 gate, Rust441, 주 Node3907 pass /11 TODO /0 fail, 별도 console15와 Python3+8 pass다.
receipt SHA-256은 `288f8b6f2d21586f088f8425e062067db60ed940157118bb6f7ca7cfdab82bb3`이며
전체 로그·identity·receipt를 `build/evidence/build187/`에 보존했다. WASM은 build183과
같은968394bytes/해시다. 생산 compiler/runtime는 바꾸지 않았고 장치 시험은 하지 않았다.

이 도구 의존성은 실제 Rust 정수 본문 증명만 막는다. 두 입력의 오류 출처 연결과
`elapsed(state)` 시작 시각 전이 검증은 독립 단위로 계속 진행한다. 전체 compiler 증명은 열려 있다.

## build190: 두 입력의 독립 회복과 오류 출처

두 Bool 입력이 각자 `recover(false)`를 거쳐 자기 출력으로 연결되는373바이트 실제 GFB를
검증했다. 여섯 입력 slot, 두45바이트 식, 전체 module 소비 및 trace metadata를 묶었다.
모든 두 입력 Reading과 오래된 payload 조합에 대해 각각의 출력 식이 자기 입력의 값과
오류 출처만 사용한다는 명제가 Lean 커널을 통과했다. 기존 `SensorMachine`과 trace 용량1은
변경하지 않았다. 식마다 새 trace로 평가하는 정리이며 전체 scan collector의 증명은 아니다.

최종 소스는 `fa6d3b44e04d91636c4568d97525a2d61fd1284c`다. Lean40회(성공23·목표 정리
거절17)가 `2026-10-28T22:38:48.286Z`에 exit0으로 끝났고102개 입력 해시가 일치했다.
receipt SHA-256은 `7c8fe4c16b08d926258bc529c52a6e9200c05ed8179ba208352fee029ebeac1d`이며
`build/two-sensor-wave16-final-590/`에 있다. 각 slot·site·origin 교환과 source 변경은
구조적으로 유효한 module임을 먼저 확인한 후 정확한 목표 등식에서 거절했다. 별도 metadata와
원본 바이트 변이도 해당 정리에서 거절했다. 독립 검토는 증명 입력·로그·해시와 경계를 확인했다.

build183 바이너리를 실제 Rust/Cargo100개 및 바이너리 해시로 확인해 재사용했다. 입력100조합을
native·WASM·framed·canonical·canonical framed의5경로에서 실행한500scan이 요청·안전 값,
두 event와 센서 출처에 일치했다. 관측 시각은 `2026-10-28T22:36:44.438Z`, runtime receipt
SHA-256은 `4b8bd469559ccbc582c86b571073083f43e3ddf9355214f2407ee0f736e14d8c`다.
새 runtime build, 물리 장치 시험 또는 전체 Rust 의미 대응 증명으로 세지 않는다.

검토 중 runtime helper의 실패 재실행이 과거 passed 파일을 남기는 반례를 재현했다.
시작 시 running·실패 시 failed를 원자적으로 기록하도록 수정하고 회귀 검사를 추가했다.
수정 전 build188와 Lean/관측 기록은 보존했고, 최종 소스로 위 검증을 다시 실행했다.

공식 build190은 `2026-10-28T22:42:52.581Z`에 exit0으로 끝났다.15 gate, Rust441,
주 Node3915 pass /11 TODO /0 fail, console15, Python3+8 pass다. receipt SHA-256은
`020200989e5812d04c6a3c9d1c526d58566629a63818aee9c5bbab77915a5671`이며
전체 로그·identity·receipt를 `build/evidence/build190/`에 보존했다. WASM 해시는 build187과 같다.
CI에도 실제 두 입력 Lean 검사를 추가했다. JS 원본 AST 투영, 일반 f64/Rust 대응과 전체
compiler 증명은 남는다. 자세한 범위는 [두 입력 보고서](../../experiments/two-sensor-provenance/proof-report.md)에 있다.

## build192: elapsed 시작 시각과 두 관측 시점

원본 문서와 실제 419바이트 GFB 전체를 연결해, 모든 유한 입력 이력에서 초기화 시 현재
시각 선택·상태 유지 시 시작 시각 보존·상태 변경 시 시작 시각 갱신을 증명했다. 생성된
회복 식의 반복 평가로 생기는 event도 그대로 모델링했다. Number는 선택·전달만 하며
Duration 뺄셈이나 실제 Rust VM 대응을 증명한 것은 아니다.

고정 소스 `106beff40020b5b1185f20704f98b2c6e9fa85bd`에서 Lean 51회(성공 32·목표 정리
거절 19)가 `2026-10-28T23:10:14.752Z`에 exit 0으로 끝났다. 입력 109개와 모든 결과의
소스·로그 해시가 일치했다. receipt SHA-256은
`f88e61116dceca0bb69584e3c47c119fa6eaa6d19c158950476c5ce49338c665`다.
빌드183의 Rust/Cargo 100개 및 바이너리 해시를 확인해 재사용한 101개 이력·1,015 scan도
5개 실행 경로에서 일치했다. 시각은 `2026-10-28T23:05:21.972Z`, receipt SHA-256은
`327e9e689fb6f1cd03045a23b7afb80e52213261d3453b4f7bd33d5e28f4d268`다.

검토에서 proof helper의 외부 Lean 버전 조회 중 이전 passed 기록이 남는 문제를 재현하고
수정했다. 시작 시 running과 실패 시 failed를 원자적으로 남기는 회귀 검사 6개를 통과했다.
또한 상태 변경 scan에서 제어식은 이전 구간의 시간을 읽고, 확정 후 timer 관측은 새 구간의
0을 표시한다는 기존 동작을 두 언어의 reference와 같은 실행의 회귀 검사에 명시했다.

공식 build192는 `2026-10-28T23:15:07.294Z`에 exit 0으로 끝났다. 15 gate, Rust 441,
주 Node 3,923 pass / 11 TODO / 0 fail, console 15, Python 3+8 pass다. 전체 로그·identity·
receipt는 `build/evidence/build192/`에 보존했다. receipt SHA-256은
`a4a9a3f4eec40edfd907288c90719c0b739b5bf8436c98df52cd256099e09f91`이다.
새 WASM은 build183과 같은 해시다. 실제 장치 시험은 하지 않았다.

후속으로 시계의 정수 범위·비감소 전제 아래 경과 시간 범위를 증명하고, 실제 실행 경로의
상한·역행·거부 뒤 상태 보존을 검사한다. 전체 compiler 증명과 Rust/f64 대응은 열려 있다.
