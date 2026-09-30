<!-- translation-source: docs/OPTIMIZER-PASS-CONTRACT.md -->
[English original](OPTIMIZER-PASS-CONTRACT.md)

# 최적화 패스 계약

상태: **설계 전용**, 이슈 [#42](https://github.com/callin2/ghostflow-language/issues/42).
2026-09-13에 선택한 범위는 컴파일 시점의 typed SMT 제약·동치 검사와
생성/컴파일 시점의 적격 typed Boolean IR BDD 단순화다. 두 엔진 모두
ESP32에서 실행하지 않는다. DBM은 선택하지 않았다. 이 문서는 라이브러리,
컴파일러 구현, 성능 향상, 공개 플래그나 manifest 확장을 승인하지 않는다.
라이브러리 선택은 의도적으로 미뤘으며 계약 작성의 선행 조건이 아니다.
이 문서는 로컬 설계이며 출판된 연구가 아니다.

## 의미의 권위와 범위

[Reference 02](reference/02-types-expressions-state.md),
[Reference 4.7](reference/04-sensors-constraints-control.md),
[물리 경계](LLM-TOOLCHAIN-ARCHITECTURE.md#physical-driver-and-device-boundary),
[의도 anchor map](INTENT-ANCHOR-MAP.md)을 함께 읽는다. 설명과 주석을 포함한
정본 `.ghost.md`가 권위 있는 소스다. 선택적 IR 디버그 자료를 제거하더라도
원문 바이트와 리비전 식별자는 보존해야 한다. 최적화는 의도를 다시 쓰거나
미확인 AI 가정을 형식 공리로 승격할 수 없다. 확인된 설명만으로 typed
기계 전제가 성립하는 것도 아니다.

#31의 기본 anchor mapping과 #342/현재 require lowering provenance는 이미
구현되어 있다. `tools/source-trace.mjs`의 `GhostFlow/source-trace-v1` derivation은
`relation: lowered-as`, `status: compiler-derived`,
`semanticVerification: not-proven`을 기록한다. 결정적 replay는 일관성을
검증할 뿐 의미 동치, 실제 평가나 물리 적용을 증명하지 않는다.
제거된 검사/대체 보장과 병합 노드의 증명은 향후 #42 구현 범위이며
이 설계는 #31의 남은 수용 조건을 닫지 않는다.

현재 `require !(a && b && c)`는 `mutex(a,b,c)`로 lowering된다.
`a=true, b=true, c=false`에서 Boolean not-all은 참이고 at-most-one은 거짓이다.
현재 derivation은 미증명 상태를 유지한다. 이 설계는 세 출력의 소스 의미를
변경·정의하지 않으며 앞 단계의 require lowering을 수정하지 않는다.
최적화기는 raw Boolean AST만 비교하지 않고 typed 제약 효과를 포함한
**의미 해석이 끝난 현재 실행 IR**과 후보를 비교한다. 두 출력의 진리표가
일치해도 최종 safe 출력, 오류와 증거의 동치를 그것만으로 증명할 수 없다.

## 제안하는 패스 경계와 순서

현재 Parser/Lowerer는 타입 검사, 이름 해석과 방출을 통합하며 다음 최적화
경계를 이미 제공하지 않는다. 향후 구현은 파싱, 타입 검사, 이름/enum/
next-state 해석 뒤이자 최종 bytecode 방출 전에 경계를 명시적으로 만들어야
하며 기존 필수 검사를 우회해서는 안 된다.

1. 불변 typed semantic IR, 소스 mapping, 제약 효과와 현재 검사 결과를
   만든다. 원래 실행물은 fallback으로 유지한다.
2. 명시적 도메인과 가정 아래 선택적 typed SMT 속성 검사를 수행한다.
3. 적격인 순수·전체 정의 Boolean 영역에만 BDD 후보를 생성한다.
4. 후보 동치와 제출된 certificate를 독립적으로 검사한다.
5. 최종 bytecode를 방출하고 자원 한계와 provenance 관계를 검사한다.

입력에는 정확한 소스/컴파일러/profile 리비전, typed 연산과 도메인,
상태·출력 binding, 평가 순서, 효과·fault 지점, 제약 적용 단계,
timer/schedule/accounting 의존성, 원본 node ID와 anchor link가 포함된다.
지원되지 않는 인코딩이나 순수성·전체 정의 증거가 없는 영역은 제외한다.
Result 분기, schedule, timer, 오류 가능 표현식과 단락 평가 피연산자를
자동으로 순수하고 전체 정의된 Boolean atom으로 간주하지 않는다.
`Number`는 유한 binary64이며 SMT Real이 아니다. 반올림과 비유한 연산
fault를 모델링해야 한다. `Int`는 검사되는 i32이며 무한 정수나 조용한
wraparound가 아니다. Duration, enum, Result tag, 단위와 유효 입력 도메인을
구별한다.

출력은 제한된 skip 사유와 변경 없는 원본, 또는 정확한 변환/증명 관계를
동반한 검증 후보다. solver나 BDD 생성기가 만들었다는 이유로 배포 가능한
변환이 되지 않는다. BDD 동치는 모델링된 Boolean 영역을 뒷받침할 수 있으나
전체 프로그램 동치의 증명은 아니다.

## 동치 의무

같은 프로그램/profile, run 식별자, clock epoch와 선언된 typed 가정 아래
허용되는 모든 입력, 이전 상태와 환경 이력에 대해 원본과 후보의 전이를
비교한다. 반환 Bool만 비교하지 않는다. 여러 tick의 동치에는 보존된 전이
관계와 일치하는 초기/checkpoint 상태가 필요하다. 유한 trace 테스트는
그 증명을 확립하지 않는다.

| 관측 항목 | 보존 의무 |
| --- | --- |
| 상태 | 이전 상태 읽기, 해석된 next-state 의존성, 병렬 commit과 실패 시 원자적 rollback |
| 출력 | requested 의도, 최종 safe 의도, 고정점 차단과 blocker 식별자; 제약은 false를 true로 만들지 않음 |
| 오류 | 단락 평가와 분기 선택, 최초 관측 fault/error와 순서·origin, 입력 거절과 실패 전이 rollback |
| 시간·생명주기 | run/time 연속성, timer 초기화/reset/elapsed 상태, schedule occurrence/admission 식별자와 경계 |
| 회계 | 선언된 requested/safe/applied 기준, 사용·admission 기록, 한계와 rollback |
| 증거 | 실제 평가 event와 소스 식별자, 유도된 만족, 최종 차단, 보존된 Result/sensor provenance |

applied 명령과 confirmed 물리 feedback은 별도의 Device 사실이다. 이 패스는
둘 다 확립하지 않는다. 증명된 영역 안에서만 내부 명령을 제거하거나 적격
계산을 병합할 수 있다. 허용 자원 profile 안에서 bytecode 크기와 명령 수는
달라질 수 있지만 관측 가능한 자원 한계 fault, 시간/admission 규칙과 증거는
조용히 달라져서는 안 된다. 공개 비용/trace 관측을 완화하려면 별도 계약이
필요하다. 제거한 노드를 실행했다고 기록해서는 안 된다. 재구성한 논리 값이나
유도된 만족은 대체 증거와 함께 derived로 표시하며 실제 평가된 소스 검사,
최종 출력 차단과 구별한다. 현재 trace 소비자가 이를 표현할 수 없으면
해당 변환을 건너뛴다.

## 실패와 증명 수용

| 검사 결과 | 계약 |
| --- | --- |
| UNSAT | typed 불일치/속성 인코딩, 가정 범위와 독립 검증 certificate가 명시된 의무를 확립할 때만 수용 |
| SAT | 원본/후보 의미로 반례를 검증; 실제 불일치이면 후보를 거절하고 원본 유지 |
| Unknown, timeout, solver/checker 오류, 미지원 theory, node/memory/time 예산 초과 | 선택적 최적화를 건너뛰고 원본과 제한된 진단 유지; proved 표시나 유효 소스 거절 금지 |
| 잘못된 certificate, 검증 불가 반례나 불일치 mapping | 후보 거절, 원본 유지; 소스가 잘못되었다고 주장하지 않고 검증 실패 기록 |

기존 필수 언어·artifact·자원 오류는 오류로 유지한다. 선택적 최적화 실패는
새 소스 언어 거절 사유가 아니다. solver 상태만으로 증명되지 않는다.
certificate/인코딩/checker 버전, 가정과 범위를 기록하고 재검증해야 한다.
독립성은 후보 생성기의 검증되지 않은 자체 동치 주장을 신뢰하지 않는다는
뜻이다. 예산 동작은 artifact 선택에 대해 결정적이거나 명시적으로 기록되어야
하며 소스 의미에 영향을 주지 않는다.

## 제안 provenance와 artifact 도입

다음은 향후 관계 기록의 요구사항이며 **승인된 schema field가 아니다**.

- 입력/후보 IR·bytecode hash, 정확한 소스 문서·컴파일러·언어 profile·mapping
  리비전, transform 식별자와 순서가 있는 합성.
- 제거/병합 노드를 포함한 모든 origin anchor와 원본 node ID/range,
  대체 node ID, 관계, 대체 guard와 의미 범위. 다대다 origin과 작성된 분류를
  보존하고 소스 link를 지어내지 않는다.
- typed 의무/인코딩 digest, 명시적 가정, checker/certificate 식별자·버전,
  검증 상태, 사유와 certificate/content digest.
- 미검증/generated 상태와 독립 검증된 대체 상태의 구별. replay로 기존
  `compiler-derived`/`not-proven` lowering 기록을 승격하지 않는다.

각 변환과 합성은 정확한 리비전, 완전한 origin, 대체 coverage와 의미 증거
검증을 통과해야 한다. 존재하는 Markdown/추출 좌표의 소스 위치를 모두
보존한다. 제거된 제약은 원래 차단 효과를 포함한 독립 검증 보장이 필요하며
다른 Bool이 이를 함의한다는 편의상 주장만으로 충분하지 않다.

현재 strict replay/package 검증은 재유도·검증할 수 없는 최적화 bytecode나
새 관계 주장을 계속 거절해야 한다. 도입에는 별도의 proof-aware validator
명세와 source map, package, replay, 소비자에 대한 호환성/버전 결정이 필요하다.
정본 replay를 끄거나 그 일관성 결과를 의미 증명으로 재사용하지 않는다.

## 실행 가능한 conformance 계획과 구현 단위

다음은 계획된 vector이며 구현된 최적화 패스나 통과 결과가 아니다.
아래 제안 ID를 안정적으로 부여하고 정본 literate fixture를 컴파일하여
native와 WASM에서 원본/후보의 전체 전이·증거 기록을 비교한다.
기존 테스트는 seed이며 새 증명 certificate가 아니다.

| 제안 ID / seed | 필수 vector와 oracle |
| --- | --- |
| OPT-STATE / Reference 02 | 병렬 갱신, 이전/다음 상태 의존성, 분기 변화와 여러 tick checkpoint 재개; 같은 commit과 fault rollback |
| OPT-TIMER / `examples/optional-feedback-timer.ghost.md`, `tests/continuous-timer-compatibility.test.mjs` | 문턱 -1ms/정확/+1ms, 초기화/reset, feedback 불가, run/clock epoch 단절과 지원 거절; 같은 timer 상태·실패 |
| OPT-SCHEDULE / `examples/scheduled-watering.ghost.md`, `tests/schedule-missed-reaction.test.mjs` | occurrence 경계, 중복, 놓친 반응, 벽시계 역보정과 회계 한계; 같은 admission 식별자·사용 rollback |
| OPT-INT / `tests/int-compiler.test.mjs`, `tests/int-division-identity.test.mjs` | MIN/MAX, overflow 검사, 0 나눗셈, MIN div -1, 단락 평가로 생략한 fault; 같은 fault origin·순서 |
| OPT-NUMBER / Reference 02 | binary64 반올림/상쇄, 관측 가능한 signed zero, 유한/비유한 경계와 typed 단위 구별; Real 기반 재작성 금지 |
| OPT-RESULT / `tests/result-control.test.mjs`, `tests/result-provenance.test.mjs` | enum 상태, ok/fault 분기, 왼쪽부터 단락 평가, 보존 provenance와 실패 결정 rollback; 같은 선택 증거 |
| OPT-CONSTRAINT / `tests/constraints.test.mjs` | true,true,false를 포함한 두/세 출력 전체 진리표; 현재 lowered 효과, 제약 순서 변경, require chain과 최종 blocker 비교; raw 세 출력 not-all을 mutex로 인증 금지 |
| OPT-PROVENANCE / `tests/intent-anchor-map.test.mjs`, `tests/portable-package.test.mjs` | 제거/병합 origin, 설명만 바뀐 리비전, hash 변경, certificate/mapping 변조, derived/실행 event 구별; 거짓 증명·혼합 리비전 거절 |
| OPT-FALLBACK / 모든 fixture | unknown/timeout/checker 실패와 각 예산 경계를 강제; 원본 artifact 유지, 기존 필수 오류 유지 |

구현은 typed IR/효과 경계와 baseline replay, typed 속성 인코딩과 독립 검증
negative vector, 순수·전체 정의 Bool 적격성과 제한된 BDD 후보 생성,
동치·certificate 검사와 합성, 마지막으로 native/WASM 차등 conformance를
동반한 proof-aware provenance/package 도입의 단위로 나눈다. 각 단위는 자체
수용 조건이 검증될 때까지 원본 경로를 보존한다. 라이브러리 평가는
인코딩/certificate 요구사항을 따른다. 여기서는 엔진이나 ABI를 선택하지 않는다.
